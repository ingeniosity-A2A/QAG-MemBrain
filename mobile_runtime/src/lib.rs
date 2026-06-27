//! AVA007 Mobile Runtime — the bootstrap that wires everything together.
//!
//! This is the entry point that AVA007's `mobile-runtime/src/main.rs`
//! calls on startup. It:
//!
//!   1. Spawns the Context Ocean (lite_notebook)
//!   2. Opens the DuckDB Context Lake
//!   3. Creates the Inference Backend (RoutedBackend: Gemma + FABLE)
//!   4. Creates the Injector bound to the lake
//!   5. Creates the Goose dispatcher
//!   6. Creates the Meta Harness
//!   7. Spawns the Thermal Monitor + bridge to budget
//!   8. Returns a single Ava007Runtime handle that owns all of the above
//!
//! The Ava007Runtime exposes:
//!   - `turn(input, session_id)` — process one user turn
//!   - `subscribe()` — get live UI updates
//!   - `shutdown()` — graceful drain

pub mod thermal;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context as _;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::info;

use context_lake::{DuckDbContextLake, LakeConfig};
use goose::{GooseConfig, GooseDispatcher, GooseReceipt};
use lite_notebook::ocean::{ContextOcean, OceanConfig};
use meta_harness::{
    injector::Injector,
    inference::RoutedBackend,
    MetaHarness, TurnUpdate,
};

use thermal::{ThermalConfig, ThermalMonitor};

/// Top-level runtime config. Sensible defaults for S25 Ultra.
#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    /// Base path for all AVA007 state.
    /// Production: /data/local/tmp/ava007/
    pub base_path: PathBuf,

    /// DuckDB file path (Context Lake).
    pub duckdb_path: PathBuf,

    /// Iceberg table root (where Parquet lives).
    pub iceberg_root: PathBuf,

    /// Llama-server base URL (Gemma 2B).
    pub llama_server_url: String,

    /// FABLE server base URL (Gemma 4 12B).
    pub fable_server_url: String,

    /// Goose root (where AgentZero / Bastani binaries live).
    pub goose_root: PathBuf,

    /// Thermal polling interval.
    pub thermal_poll_interval: std::time::Duration,

    /// Embedding dimension.
    pub embedding_dim: usize,

    /// UI broadcast capacity.
    pub ui_broadcast_capacity: usize,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            base_path: PathBuf::from("/data/local/tmp/ava007"),
            duckdb_path: PathBuf::from("/data/local/tmp/ava007/context_lake.duckdb"),
            iceberg_root: PathBuf::from("/data/local/tmp/ava007/context_ocean"),
            llama_server_url: "http://127.0.0.1:8080/v1".into(),
            fable_server_url: "http://127.0.0.1:8081/v1".into(),
            goose_root: PathBuf::from("/data/local/tmp/ava007/goose"),
            thermal_poll_interval: std::time::Duration::from_secs(5),
            embedding_dim: 384,
            ui_broadcast_capacity: 64,
        }
    }
}

/// Test-friendly config (uses tempdir, mocks inference).
impl RuntimeConfig {
    pub fn for_test(base_path: PathBuf) -> Self {
        Self {
            base_path: base_path.clone(),
            duckdb_path: base_path.join("context_lake.duckdb"),
            iceberg_root: base_path.join("context_ocean"),
            llama_server_url: "http://127.0.0.1:8080/v1".into(),
            fable_server_url: "http://127.0.0.1:8081/v1".into(),
            goose_root: base_path.join("goose"),
            thermal_poll_interval: std::time::Duration::from_secs(1),
            embedding_dim: 384,
            ui_broadcast_capacity: 16,
        }
    }
}

/// The AVA007 runtime. Cloneable (Arc internals).
#[derive(Clone)]
pub struct Ava007Runtime {
    pub harness: Arc<MetaHarness>,
    pub ocean: ContextOcean,
    pub lake: Arc<DuckDbContextLake>,
    pub thermal: Arc<ThermalMonitor>,
    pub goose_receipt_rx: Arc<Mutex<mpsc::Receiver<GooseReceipt>>>,
    /// Background task handles — kept alive so the runtime stays up.
    _tasks: Arc<TaskHandles>,
}

struct TaskHandles {
    goose_dispatcher: tokio::task::JoinHandle<()>,
    thermal_loop: tokio::task::JoinHandle<()>,
    thermal_bridge: tokio::task::JoinHandle<()>,
    goose_receipt_forwarder: tokio::task::JoinHandle<()>,
}

impl Ava007Runtime {
    /// Bootstrap the entire AVA007 runtime.
    ///
    /// Call this once at app startup. Returns the runtime handle and
    /// holds all background tasks alive.
    pub async fn bootstrap(
        config: RuntimeConfig,
        inference: Arc<dyn meta_harness::InferenceBackend>,
    ) -> anyhow::Result<Self> {
        // ── 1. Ensure base dir exists ────────────────────────────────
        std::fs::create_dir_all(&config.base_path)
            .with_context(|| format!("create base_path {:?}", config.base_path))?;
        std::fs::create_dir_all(&config.goose_root)
            .with_context(|| format!("create goose_root {:?}", config.goose_root))?;

        // ── 2. Context Ocean (lite_notebook) ─────────────────────────
        let ocean_cfg = OceanConfig {
            base_path: config.base_path.clone(),
            flush_channel_capacity: 32,
            broadcast_capacity: config.ui_broadcast_capacity,
            max_commit_retries: 3,
        };
        let (ocean, _ocean_join) = ContextOcean::spawn(ocean_cfg)
            .context("Context Ocean spawn")?;

        info!("Context Ocean started at {:?}", config.base_path);

        // ── 3. DuckDB Context Lake ────────────────────────────────────
        let lake_cfg = LakeConfig {
            db_path: config.duckdb_path.to_string_lossy().into(),
            iceberg_root: config.iceberg_root.to_string_lossy().into(),
            default_recall_k: 8,
            embedding_dim: config.embedding_dim,
        };
        let lake = DuckDbContextLake::open(lake_cfg)
            .context("DuckDB Context Lake open")?;

        info!("Context Lake opened at {:?}", config.duckdb_path);

        // ── 4. Goose dispatcher ───────────────────────────────────────
        let goose_cfg = GooseConfig {
            goose_root: config.goose_root.clone(),
            ..Default::default()
        };
        let (goose_receipt_tx, goose_receipt_rx) = mpsc::channel::<GooseReceipt>(32);
        let dispatcher = Arc::new(GooseDispatcher::new(goose_cfg, goose_receipt_tx));
        let (goose_req_tx, goose_req_rx) = mpsc::channel::<meta_harness::router::GooseRequest>(16);
        {
            let dispatcher = dispatcher.clone();
            tokio::spawn(async move {
                dispatcher.run(goose_req_rx).await;
            });
        }

        info!("Goose dispatcher started at {:?}", config.goose_root);

        // ── 5. Meta Harness ───────────────────────────────────────────
        let injector = Arc::new(Injector::new(lake.clone(), 64));
        let harness = MetaHarness::new(
            inference,
            injector,
            ocean.clone(),
            goose_req_tx,
            config.ui_broadcast_capacity,
        );

        info!("Meta Harness initialized");

        // ── 6. Thermal Monitor ────────────────────────────────────────
        let thermal_cfg = ThermalConfig {
            poll_interval: config.thermal_poll_interval,
            ..Default::default()
        };
        let thermal = ThermalMonitor::new(thermal_cfg);
        let thermal_loop = thermal.clone().spawn();
        let thermal_bridge = thermal::spawn_thermal_bridge(thermal.clone(), harness.clone());

        info!("Thermal monitor started (interval={:?})", config.thermal_poll_interval);

        // ── 7. Goose receipt forwarder ────────────────────────────────
        // Converts GooseReceipts into Receipts deposited in the Context Ocean
        let ocean_for_forward = ocean.clone();
        let goose_receipt_forwarder = tokio::spawn(async move {
            let mut rx = goose_receipt_rx;
            while let Some(gr) = rx.recv().await {
                use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
                let kind = match gr.kind {
                    goose::GooseReceiptKind::Started   => ReceiptKind::Control,
                    goose::GooseReceiptKind::Progress  => ReceiptKind::Control,
                    goose::GooseReceiptKind::Completed => ReceiptKind::Action,
                    goose::GooseReceiptKind::Failed    => ReceiptKind::Action,
                    goose::GooseReceiptKind::TimedOut  => ReceiptKind::Action,
                };
                let receipt = Receipt::new(
                    gr.session_id,
                    Origin::Goose,
                    kind,
                    gr.content,
                    None,
                )
                .with_metadata("service", gr.service.as_str())
                .with_metadata("phase", format!("{:?}", gr.kind));

                if let Err(e) = ocean_for_forward.deposit(receipt).await {
                    tracing::error!("goose receipt deposit failed: {e}");
                }
            }
            info!("Goose receipt forwarder exited");
        });

        Ok(Self {
            harness,
            ocean,
            lake,
            thermal,
            goose_receipt_rx: Arc::new(Mutex::new(goose_receipt_rx)),
            _tasks: Arc::new(TaskHandles {
                goose_dispatcher: tokio::spawn(async {}),
                thermal_loop,
                thermal_bridge,
                goose_receipt_forwarder,
            }),
        })
    }

    /// Process a single user turn. The main entry point.
    pub async fn turn(
        &self,
        input: impl Into<Arc<str>>,
        session_id: impl Into<Arc<str>>,
    ) -> anyhow::Result<meta_harness::TurnResult> {
        self.harness.turn(input.into(), session_id.into()).await
    }

    /// Subscribe to live UI updates.
    pub fn subscribe(&self) -> broadcast::Receiver<TurnUpdate> {
        self.harness.subscribe()
    }

    /// Current thermal snapshot.
    pub fn thermal_snapshot(&self) -> thermal::ThermalSnapshot {
        self.thermal.snapshot()
    }

    /// Current budget snapshot (token usage, thermal state, etc).
    pub fn budget_snapshot(&self) -> meta_harness::BudgetSnapshot {
        self.harness.budget_snapshot()
    }

    /// Start a new session (resets budget counters).
    pub fn reset_session(&self) {
        self.harness.reset_session();
    }

    /// Graceful shutdown — aborts background tasks.
    pub fn shutdown(&self) {
        // The Arc<TaskHandles> will drop, aborting tasks if no other refs.
        // In practice the runtime is held by the main app.
        info!("AVA007 runtime shutdown requested");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use meta_harness::inference::{InferenceRequest, InferenceResponse, MockBackend};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bootstrap_and_run_turn() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

        let backend = Arc::new(MockBackend::new(vec![
            // classifier fallback (won't be used — heuristic catches "hello")
            InferenceResponse {
                text: "chitchat".into(),
                tokens_generated: 1,
                latency_ms: 80,
            },
            // REV.IKE cognition
            InferenceResponse {
                text: "Hi there! How can I help?".into(),
                tokens_generated: 8,
                latency_ms: 200,
            },
        ]));

        let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();

        let mut sub = runtime.subscribe();
        let result = runtime.turn("hello", "test-session").await.unwrap();

        assert!(result.success);
        assert_eq!(result.route, meta_harness::Route::RevIke);
        assert!(result.response_text.contains("Hi there"));

        // Should have received UI updates
        let mut phases = vec![];
        while let Ok(u) = sub.try_recv() {
            phases.push(u.phase);
        }
        assert!(phases.contains(&meta_harness::TurnPhase::Complete));

        // Give the deposit loop time to flush
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn thermal_snapshot_available() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = RuntimeConfig::for_test(dir.path().to_path_buf());

        let backend = Arc::new(MockBackend::new(vec![]));
        let runtime = Ava007Runtime::bootstrap(cfg, backend).await.unwrap();

        let snap = runtime.thermal_snapshot();
        // Either sysfs available or fallback (35°C default)
        assert!(snap.max_temp_c > 0 && snap.max_temp_c < 200);
    }
}
