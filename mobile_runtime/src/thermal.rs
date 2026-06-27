//! Thermal Monitor — polls SoC temperature every 5s.
//!
//! On Android (S25 Ultra, non-rooted), the thermal zones are exposed at:
//!   /sys/class/thermal/thermal_zone*/temp
//!
//! Each zone reports temperature in millidegrees Celsius. The relevant
//! zones for Snapdragon 8 Elite:
//!   - thermal_zone0  : SoC main (CPU/GPU composite)
//!   - thermal_zone1  : CPU cluster 0 (Oryon)
//!   - thermal_zone4  : GPU
//!   - thermal_zone8  : Skin (back of phone)
//!   - thermal_zone15 : Battery
//!
//! We take the max of all zones and report it to the Meta Harness
//! budget tracker, which auto-degrades inference under thermal pressure.
//!
//! Polling interval: 5 seconds (matches the budget's thermal check cadence).
//! If sysfs is unavailable (e.g. test/dev machine), falls back to a
//! constant 35°C so the budget never falsely throttles.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use tokio::sync::watch;
use tracing::{debug, info, warn};

/// Thermal config.
#[derive(Clone, Debug)]
pub struct ThermalConfig {
    /// Polling interval (default 5s).
    pub poll_interval: Duration,

    /// Path to thermal class directory.
    pub thermal_class_path: PathBuf,

    /// Fallback temperature (millidegrees C) when sysfs unavailable.
    pub fallback_temp_mc: i32,

    /// Zone name filter — None = use all zones, Some = only named zones.
    pub zone_filter: Option<Vec<String>>,
}

impl Default for ThermalConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(5),
            thermal_class_path: PathBuf::from("/sys/class/thermal"),
            fallback_temp_mc: 35_000, // 35°C
            zone_filter: None,
        }
    }
}

/// Current thermal snapshot.
#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
pub struct ThermalSnapshot {
    /// Max temperature across all zones, millidegrees C
    pub max_temp_mc: i32,

    /// Max temperature in degrees C (rounded)
    pub max_temp_c: u32,

    /// Number of zones read
    pub zones_read: u32,

    /// Whether sysfs was available
    pub sysfs_available: bool,

    /// Hottest zone index (None if sysfs unavailable)
    pub hottest_zone_idx: Option<u32>,
}

pub struct ThermalMonitor {
    config: ThermalConfig,
    latest: Arc<RwLock<ThermalSnapshot>>,
    /// Watch channel — fires on every update
    watch_tx: watch::Sender<ThermalSnapshot>,
}

impl ThermalMonitor {
    pub fn new(config: ThermalConfig) -> Arc<Self> {
        let initial = ThermalSnapshot::default();
        let (watch_tx, _) = watch::channel(initial);
        Arc::new(Self {
            config,
            latest: Arc::new(RwLock::new(initial)),
            watch_tx,
        })
    }

    /// Spawn the polling loop. Returns a handle that can be awaited or aborted.
    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        info!(
            "Thermal monitor started (poll={:?}, path={:?})",
            self.config.poll_interval, self.config.thermal_class_path
        );

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(self.config.poll_interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                ticker.tick().await;
                let snapshot = self.poll_once().await;
                *self.latest.write() = snapshot;
                let _ = self.watch_tx.send(snapshot);

                debug!(
                    "thermal: max={}°C zones={} sysfs={}",
                    snapshot.max_temp_c, snapshot.zones_read, snapshot.sysfs_available
                );
            }
        })
    }

    /// Read all thermal zones once.
    pub async fn poll_once(&self) -> ThermalSnapshot {
        let zones = self.list_zones();

        if zones.is_empty() {
            return ThermalSnapshot {
                max_temp_mc: self.config.fallback_temp_mc,
                max_temp_c: (self.config.fallback_temp_mc / 1000) as u32,
                zones_read: 0,
                sysfs_available: false,
                hottest_zone_idx: None,
            };
        }

        let mut max_temp_mc = i32::MIN;
        let mut hottest_idx: Option<u32> = None;
        let mut zones_read = 0u32;

        for (idx, zone_path) in zones.iter().enumerate() {
            if let Ok(temp_mc) = self.read_zone_temp(zone_path).await {
                zones_read += 1;
                if temp_mc > max_temp_mc {
                    max_temp_mc = temp_mc;
                    hottest_idx = Some(idx as u32);
                }
            }
        }

        if zones_read == 0 {
            return ThermalSnapshot {
                max_temp_mc: self.config.fallback_temp_mc,
                max_temp_c: (self.config.fallback_temp_mc / 1000) as u32,
                zones_read: 0,
                sysfs_available: false,
                hottest_zone_idx: None,
            };
        }

        let max_temp_c = (max_temp_mc / 1000).max(0) as u32;

        ThermalSnapshot {
            max_temp_mc,
            max_temp_c,
            zones_read,
            sysfs_available: true,
            hottest_zone_idx: hottest_idx,
        }
    }

    fn list_zones(&self) -> Vec<PathBuf> {
        let thermal_class = &self.config.thermal_class_path;
        if !thermal_class.exists() {
            return vec![];
        }

        let mut zones = Vec::new();
        if let Ok(entries) = std::fs::read_dir(thermal_class) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("thermal_zone") {
                    let zone_path = entry.path().join("temp");
                    if zone_path.exists() {
                        zones.push(zone_path);
                    }
                }
            }
        }
        zones.sort();
        zones
    }

    async fn read_zone_temp(&self, zone_path: &PathBuf) -> anyhow::Result<i32> {
        // Use blocking read with spawn_blocking since sysfs reads can block
        let path = zone_path.clone();
        let temp = tokio::task::spawn_blocking(move || -> anyhow::Result<i32> {
            let s = std::fs::read_to_string(&path)?;
            let trimmed = s.trim();
            let v: i32 = trimmed.parse()
                .map_err(|e| anyhow::anyhow!("parse {} as int: {e}", trimmed))?;
            Ok(v)
        }).await??;
        Ok(temp)
    }

    pub fn snapshot(&self) -> ThermalSnapshot {
        *self.latest.read()
    }

    pub fn subscribe(&self) -> watch::Receiver<ThermalSnapshot> {
        self.watch_tx.subscribe()
    }
}

/// Bridge between the thermal monitor and the Meta Harness budget.
/// Spawns a task that watches thermal updates and calls
/// `harness.update_thermal(temp_c)` on every change.
pub fn spawn_thermal_bridge(
    monitor: Arc<ThermalMonitor>,
    harness: Arc<meta_harness::MetaHarness>,
) -> tokio::task::JoinHandle<()> {
    let mut rx = monitor.subscribe();
    tokio::spawn(async move {
        while let Ok(snapshot) = rx.changed().await {
            let temp_c = snapshot.max_temp_c;
            harness.update_thermal(temp_c);

            if temp_c >= meta_harness::THERMAL_THROTTLE_TEMP_C {
                warn!("THERMAL THROTTLING: {}°C — FABLE disabled", temp_c);
            } else if temp_c >= meta_harness::THERMAL_BACKOFF_TEMP_C {
                warn!("THERMAL WARM: {}°C — backing off", temp_c);
            }
        }
        info!("Thermal bridge exited");
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fallback_when_sysfs_unavailable() {
        let config = ThermalConfig {
            thermal_class_path: PathBuf::from("/nonexistent/path"),
            fallback_temp_mc: 30_000,
            ..Default::default()
        };
        let monitor = ThermalMonitor::new(config);
        let snap = monitor.poll_once().await;

        assert!(!snap.sysfs_available);
        assert_eq!(snap.max_temp_c, 30);
        assert_eq!(snap.zones_read, 0);
    }

    #[tokio::test]
    async fn reads_real_zones_if_available() {
        // On Linux dev machines, /sys/class/thermal usually exists
        let monitor = ThermalMonitor::new(ThermalConfig::default());
        let snap = monitor.poll_once().await;

        if snap.sysfs_available {
            assert!(snap.zones_read > 0);
            assert!(snap.max_temp_c > 0 && snap.max_temp_c < 200);
        }
        // On non-Linux test runners, the fallback kicks in — both are valid
    }

    #[tokio::test]
    async fn snapshot_returns_last_reading() {
        let monitor = ThermalMonitor::new(ThermalConfig {
            thermal_class_path: PathBuf::from("/nonexistent"),
            fallback_temp_mc: 25_000,
            ..Default::default()
        });

        let _ = monitor.poll_once().await;
        let snap = monitor.snapshot();
        assert_eq!(snap.max_temp_c, 25);
    }
}
