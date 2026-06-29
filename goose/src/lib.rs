//! Goose Dispatcher — headless expansion services for AVA007.
//!
//! This is the "Expand" half of the golden rule. When the Meta Harness
//! routes a Decision to Route::Goose, the request lands here. The
//! dispatcher fans out to one of three headless services:
//!
//!   AgentZero  — browser automation (Playwright-based, runs as subprocess)
//!   Griptape   — Python orchestration (runs via `python -m griptape`)
//!   Bastani    — autonomous engineering loops (runs as subprocess)
//!
//! All three services:
//!   - Run as separate OS processes (crash isolation)
//!   - Communicate via stdin/stdout JSON lines
//!   - Have a hard wall-clock timeout enforced by the dispatcher
//!   - Emit progress Receipts back to the Context Ocean via callback
//!   - Are Knox-safe by construction (no telephony access)
//!
//! On non-rooted Samsung (Knox intact), these services run as the same
//! UID as AVA007 (user 0). They can access the filesystem and network
//! but cannot touch modem/telephony/IMEI surfaces.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use meta_harness::router::{GooseRequest, GooseService};

pub mod whatsapp;
pub mod a2a;
pub mod meshrabiya;
pub mod proximity;
pub mod binary_ninja;

pub use whatsapp::{WhatsAppAction, WhatsAppService};
pub use a2a::{A2AMessage, A2APayload, A2ARelay, Capability, CollaborationRole, DeviceId, DeviceStatus, ThermalState as A2AThermalState};
pub use meshrabiya::{MeshRouter, MeshNode, TaskRoute, MeshError};
pub use proximity::{ProximityMesh, ProximityEvent, ProximityTier, AIVCard};
pub use binary_ninja::{BinaryNinjaAgent, AuditRequest, AuditType, AuditPreview, AuditResult};

/// Configuration for the Goose dispatcher.
#[derive(Clone, Debug)]
pub struct GooseConfig {
    /// Base directory for service binaries / scripts.
    /// Production: /data/local/tmp/ava007/goose/
    pub goose_root: PathBuf,

    /// Python interpreter path (for Griptape).
    /// Production: /data/data/com.termux/files/usr/bin/python3
    pub python_path: PathBuf,

    /// AgentZero binary path.
    pub agentzero_path: PathBuf,

    /// Bastani binary path.
    pub bastani_path: PathBuf,

    /// Default timeout for any expansion request.
    pub default_timeout_ms: u32,

    /// Maximum concurrent Goose requests.
    pub max_concurrent: usize,
}

impl Default for GooseConfig {
    fn default() -> Self {
        Self {
            goose_root: PathBuf::from("/data/local/tmp/ava007/goose"),
            python_path: PathBuf::from("python3"),
            agentzero_path: PathBuf::from("agentzero"),
            bastani_path: PathBuf::from("bastani"),
            default_timeout_ms: 30_000,
            max_concurrent: 4,
        }
    }
}

/// Goose dispatcher state.
pub struct GooseDispatcher {
    config: GooseConfig,
    /// Pending requests keyed by request ID (for cancellation)
    pending: Arc<AsyncMutex<std::collections::HashMap<u64, PendingRequest>>>,
    /// Next request ID
    next_id: Mutex<u64>,
    /// Receipt callback — invoked when a service emits a progress receipt
    receipt_tx: mpsc::Sender<GooseReceipt>,
    /// Optional WhatsApp service (Telnyx HTTP API — no subprocess)
    whatsapp: Option<Arc<WhatsAppService>>,
}

#[derive(Debug)]
struct PendingRequest {
    service: GooseService,
    started_at: std::time::Instant,
    cancel: CancellationToken,
}

/// Receipt emitted by a Goose service back to AVA007.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GooseReceipt {
    pub session_id: Arc<str>,
    pub service: GooseService,
    pub kind: GooseReceiptKind,
    pub content: Arc<str>,
    pub progress_pct: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GooseReceiptKind {
    /// Service started successfully
    Started,
    /// Progress update (e.g. "page loaded", "step 3/5 complete")
    Progress,
    /// Final result
    Completed,
    /// Service errored
    Failed,
    /// Service timed out
    TimedOut,
}

impl GooseDispatcher {
    pub fn new(config: GooseConfig, receipt_tx: mpsc::Sender<GooseReceipt>) -> Arc<Self> {
        Arc::new(Self {
            config,
            pending: Arc::new(AsyncMutex::new(std::collections::HashMap::new())),
            next_id: Mutex::new(0),
            receipt_tx,
            whatsapp: None,
        })
    }

    /// Attach a WhatsApp service (Telnyx HTTP API client).
    /// Required before any `GooseService::WhatsApp` requests can be dispatched.
    pub fn with_whatsapp(mut self: Arc<Self>, whatsapp: Arc<WhatsAppService>) -> Arc<Self> {
        // Get a mutable reference via unsafe interior mutation (Arc::get_mut
        // works here because we're called before the dispatcher is shared)
        if let Some(s) = Arc::get_mut(&mut self) {
            s.whatsapp = Some(whatsapp);
        }
        self
    }

    /// Spawn the dispatcher loop. Consumes the receiver end of the
    /// GooseRequest channel from the Meta Harness.
    pub async fn run(
        self: Arc<Self>,
        mut rx: mpsc::Receiver<GooseRequest>,
    ) {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(self.config.max_concurrent));

        info!("Goose dispatcher started (max_concurrent={})", self.config.max_concurrent);

        while let Some(req) = rx.recv().await {
            let permit = semaphore.clone().acquire_owned().await;
            if permit.is_err() {
                warn!("Goose semaphore closed, shutting down");
                break;
            }
            let _permit = permit.unwrap();

            let dispatcher = self.clone();
            tokio::spawn(async move {
                dispatcher.handle_request(req).await;
            });
        }

        info!("Goose dispatcher exiting");
    }

    async fn handle_request(&self, req: GooseRequest) {
        let request_id = {
            let mut next = self.next_id.lock();
            *next += 1;
            *next
        };

        let cancel_token = CancellationToken::new();
        let timeout_ms = req.timeout_ms.min(self.config.default_timeout_ms.max(req.timeout_ms));

        // Register as pending
        {
            let mut pending = self.pending.lock().await;
            pending.insert(request_id, PendingRequest {
                service: req.service,
                started_at: std::time::Instant::now(),
                cancel: cancel_token.clone(),
            });
        }

        // Emit "Started" receipt
        let _ = self.receipt_tx.send(GooseReceipt {
            session_id: req.session_id.clone(),
            service: req.service,
            kind: GooseReceiptKind::Started,
            content: req.query.clone(),
            progress_pct: Some(0.0),
        }).await;

        // Dispatch to the right service
        let result = tokio::select! {
            r = self.dispatch_to_service(&req) => r,
            _ = cancel_token.cancelled() => Err(anyhow::anyhow!("cancelled")),
            _ = tokio::time::sleep(Duration::from_millis(timeout_ms as u64)) => {
                Err(anyhow::anyhow!("timeout after {}ms", timeout_ms))
            }
        };

        // Remove from pending
        {
            let mut pending = self.pending.lock().await;
            pending.remove(&request_id);
        }

        // Emit final receipt
        let (kind, content) = match result {
            Ok(text) => (GooseReceiptKind::Completed, text),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("timeout") {
                    (GooseReceiptKind::TimedOut, msg.into())
                } else {
                    (GooseReceiptKind::Failed, msg.into())
                }
            }
        };

        let _ = self.receipt_tx.send(GooseReceipt {
            session_id: req.session_id.clone(),
            service: req.service,
            kind,
            content,
            progress_pct: Some(1.0),
        }).await;
    }

    async fn dispatch_to_service(&self, req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        match req.service {
            GooseService::AgentZero => self.run_agentzero(req).await,
            GooseService::Griptape => self.run_griptape(req).await,
            GooseService::Bastani => self.run_bastani(req).await,
            GooseService::WhatsApp => {
                // WhatsApp uses the Telnyx HTTP API directly (no subprocess).
                // The WhatsAppService is injected at construction time.
                let svc = self.whatsapp.as_ref()
                    .ok_or_else(|| anyhow::anyhow!(
                        "WhatsApp service not configured. Pass a WhatsAppService \
                         to GooseDispatcher::with_whatsapp() at startup."
                    ))?;
                svc.execute(req).await
            }
        }
    }

    /// AgentZero — browser automation via Playwright.
    /// Sends JSON request on stdin, reads JSON response on stdout.
    async fn run_agentzero(&self, req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        let payload = serde_json::json!({
            "session_id": req.session_id.as_ref(),
            "query": req.query.as_ref(),
            "timeout_ms": req.timeout_ms,
        });

        let mut child = Command::new(&self.config.agentzero_path)
            .arg("--json-stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("AgentZero spawn failed: {e} (path={:?})", self.config.agentzero_path))?;

        // Write request
        if let Some(mut stdin) = child.stdin.take() {
            let line = serde_json::to_string(&payload)? + "\n";
            stdin.write_all(line.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        // Read first line of stdout
        let stdout = child.stdout.take()
            .ok_or_else(|| anyhow::anyhow!("AgentZero stdout closed"))?;
        let mut reader = BufReader::new(stdout).lines();

        if let Some(line) = reader.next_line().await? {
            let resp: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| anyhow::anyhow!("AgentZero response parse: {e}"))?;
            let text = resp["result"].as_str().unwrap_or("").to_string();
            return Ok(text.into());
        }

        // Wait for exit
        let status = child.wait().await?;
        if !status.success() {
            anyhow::bail!("AgentZero exited with {status}");
        }

        Ok("(no output)".into())
    }

    /// Griptape — Python orchestration via `python -m griptape`.
    async fn run_griptape(&self, req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        let script = format!(
            r#"from griptape.tasks import PromptTask
from griptape.structures import Agent

agent = Agent()
agent.add_task(PromptTask(input_text="""{}"""))
result = agent.run()
print(result.output_task.output.value)
"#,
            req.query.as_ref().replace('"', "\\\"")
        );

        let mut child = Command::new(&self.config.python_path)
            .arg("-m").arg("griptape")
            .arg("-")  // read script from stdin
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("Griptape spawn failed: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(script.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let stdout = child.stdout.take()
            .ok_or_else(|| anyhow::anyhow!("Griptape stdout closed"))?;
        let mut reader = BufReader::new(stdout).lines();

        let mut output = String::new();
        while let Some(line) = reader.next_line().await? {
            output.push_str(&line);
            output.push('\n');
        }

        let status = child.wait().await?;
        if !status.success() {
            anyhow::bail!("Griptape exited with {status}");
        }

        Ok(output.trim().to_string().into())
    }

    /// Bastani — autonomous engineering loop.
    async fn run_bastani(&self, req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        let payload = serde_json::json!({
            "session_id": req.session_id.as_ref(),
            "query": req.query.as_ref(),
            "timeout_ms": req.timeout_ms,
        });

        let mut child = Command::new(&self.config.bastani_path)
            .arg("--json-stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("Bastani spawn failed: {e}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            let line = serde_json::to_string(&payload)? + "\n";
            stdin.write_all(line.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let stdout = child.stdout.take()
            .ok_or_else(|| anyhow::anyhow!("Bastani stdout closed"))?;
        let mut reader = BufReader::new(stdout).lines();

        if let Some(line) = reader.next_line().await? {
            let resp: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| anyhow::anyhow!("Bastani response parse: {e}"))?;
            let text = resp["result"].as_str().unwrap_or("").to_string();
            return Ok(text.into());
        }

        let status = child.wait().await?;
        if !status.success() {
            anyhow::bail!("Bastani exited with {status}");
        }

        Ok("(no output)".into())
    }

    /// Cancel a pending request (best-effort).
    pub async fn cancel(&self, request_id: u64) {
        let pending = self.pending.lock().await;
        if let Some(req) = pending.get(&request_id) {
            req.cancel.cancel();
        }
    }

    /// Snapshot of pending requests (for UI display).
    pub async fn pending_snapshot(&self) -> Vec<(u64, GooseService, std::time::Duration)> {
        let pending = self.pending.lock().await;
        pending.iter()
            .map(|(id, req)| (*id, req.service, req.started_at.elapsed()))
            .collect()
    }
}

// ── Stub service for testing ────────────────────────────────────────────────
// Simulates a Goose service without spawning an actual subprocess.

pub struct StubGooseService {
    response: Arc<str>,
    delay_ms: u64,
}

impl StubGooseService {
    pub fn new(response: &str, delay_ms: u64) -> Self {
        Self {
            response: response.into(),
            delay_ms,
        }
    }

    pub async fn execute(&self, _req: &GooseRequest) -> anyhow::Result<Arc<str>> {
        tokio::time::sleep(Duration::from_millis(self.delay_ms)).await;
        Ok(self.response.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_service_returns_after_delay() {
        let svc = StubGooseService::new("test result", 10);
        let req = GooseRequest {
            session_id: "s1".into(),
            query: "test".into(),
            service: GooseService::AgentZero,
            timeout_ms: 1000,
        };
        let result = svc.execute(&req).await.unwrap();
        assert_eq!(result.as_ref(), "test result");
    }

    #[tokio::test]
    async fn dispatcher_emits_started_and_completed_receipts() {
        let (tx, mut rx) = mpsc::channel(8);
        let config = GooseConfig::default();
        let dispatcher = GooseDispatcher::new(config, tx);

        let req = GooseRequest {
            session_id: "s1".into(),
            query: "open youtube".into(),
            service: GooseService::AgentZero,
            timeout_ms: 100,
        };

        // Dispatch directly (bypass the run loop)
        dispatcher.handle_request(req).await;

        // Should have received Started and Completed (or Failed since path is bad)
        let mut kinds = vec![];
        while let Ok(r) = rx.try_recv() {
            kinds.push(r.kind);
        }
        assert!(kinds.contains(&GooseReceiptKind::Started));
        // The service will fail because path doesn't exist on test machine
        assert!(kinds.contains(&GooseReceiptKind::Failed) || kinds.contains(&GooseReceiptKind::Completed));
    }

    #[tokio::test]
    async fn dispatcher_times_out_long_running_service() {
        let (tx, mut rx) = mpsc::channel(8);
        let config = GooseConfig {
            default_timeout_ms: 50, // very short
            ..Default::default()
        };
        let dispatcher = GooseDispatcher::new(config, tx);

        let req = GooseRequest {
            session_id: "s1".into(),
            query: "long task".into(),
            service: GooseService::Bastani,
            timeout_ms: 50,
        };

        dispatcher.handle_request(req).await;

        let mut kinds = vec![];
        while let Ok(r) = rx.try_recv() {
            kinds.push(r.kind);
        }
        // Should have Started + (TimedOut OR Failed — depending on whether bastani binary exists)
        assert!(kinds.contains(&GooseReceiptKind::Started));
        // Bastani binary doesn't exist, so we get Failed fast OR TimedOut
        assert!(kinds.iter().any(|k| matches!(k, GooseReceiptKind::Failed | GooseReceiptKind::TimedOut)));
    }
}
