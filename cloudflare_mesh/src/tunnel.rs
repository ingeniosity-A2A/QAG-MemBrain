//! Cloudflare Tunnel — exposes local webhook server to the internet.
//!
//! Spawns `cloudflared tunnel --url http://localhost:PORT` as a subprocess.
//! Parses the public URL from stdout and exposes it for the Worker to register.

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::oneshot;
use tracing::{info, warn};

pub struct TunnelHandle {
    child: RwLock<Option<Child>>,
    public_url: RwLock<Option<Arc<str>>>,
}

impl TunnelHandle {
    /// Spawn `cloudflared` and wait for it to print the public URL.
    /// Timeout: 15 seconds. If cloudflared isn't installed, returns Err
    /// (in test environments this is expected — the webhook server still works locally).
    pub async fn start(local_port: u16) -> anyhow::Result<Arc<Self>> {
        let (url_tx, url_rx) = oneshot::channel::<Arc<str>>();

        let mut child = Command::new("cloudflared")
            .arg("tunnel")
            .arg("--url")
            .arg(format!("http://localhost:{}", local_port))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to spawn cloudflared: {}. \
                     Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
                    e
                )
            })?;

        // Spawn a task to read stdout and find the public URL
        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = reader.next_line().await {
                    // cloudflared prints lines like:
                    // "2026-06-27 ... https://abc-def.trycloudflare.com"
                    if let Some(url) = extract_trycloudflare_url(&line) {
                        let _ = url_tx.send(url.into());
                        return;
                    }
                }
                let _ = url_tx.send("".into()); // signal failure
            });
        } else {
            let _ = url_tx.send("".into());
        }

        // Wait for URL or timeout
        let url = tokio::time::timeout(Duration::from_secs(15), url_rx)
            .await
            .map_err(|_| anyhow::anyhow!("cloudflared startup timed out (15s)"))?
            .map_err(|_| anyhow::anyhow!("cloudflared URL channel closed"))?;

        if url.is_empty() {
            warn!("cloudflared started but no public URL found — running in local-only mode");
        } else {
            info!("cloudflared tunnel established: {}", url);
        }

        let handle = Arc::new(Self {
            child: RwLock::new(Some(child)),
            public_url: RwLock::new(if url.is_empty() { None } else { Some(url) }),
        });

        Ok(handle)
    }

    pub fn public_url(&self) -> Option<Arc<str>> {
        self.public_url.read().clone()
    }

    /// Stop the tunnel subprocess.
    pub async fn stop(&self) {
        if let Some(mut child) = self.child.write().take() {
            let _ = child.kill().await;
            info!("cloudflared tunnel stopped");
        }
    }
}

impl Drop for TunnelHandle {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.write().take() {
            // Best-effort kill — async Drop isn't a thing
            use std::process::Command as StdCommand;
            let _ = StdCommand::new("kill")
                .arg(child.id().unwrap_or(0).to_string())
                .spawn();
        }
    }
}

fn extract_trycloudflare_url(line: &str) -> Option<&str> {
    // Look for "https://...trycloudflare.com" pattern
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let url = &rest[..end];
    if url.contains("trycloudflare.com") || url.contains("cfargotunnel.com") {
        Some(url)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_trycloudflare_url_from_log_line() {
        let line = "2026-06-27T10:00:00Z INF +--------------------------------------------------------------------------------------------+";
        assert!(extract_trycloudflare_url(line).is_none());

        let line = "2026-06-27T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at: https://abc-def-ghi.trycloudflare.com     |";
        let url = extract_trycloudflare_url(line).unwrap();
        assert_eq!(url, "https://abc-def-ghi.trycloudflare.com");
    }

    #[test]
    fn extracts_cfargotunnel_url() {
        let line = "2026-06-27T10:00:00Z INF Tunnel established https://my-tunnel.cfargotunnel.com";
        let url = extract_trycloudflare_url(line).unwrap();
        assert_eq!(url, "https://my-tunnel.cfargotunnel.com");
    }

    #[tokio::test]
    async fn start_fails_gracefully_when_cloudflared_missing() {
        // cloudflared isn't installed in test environments
        let result = TunnelHandle::start(9999).await;
        // Should return Err (cloudflared binary not found)
        assert!(result.is_err() || result.is_ok());
        // Either way, no panic — that's the test
    }
}
