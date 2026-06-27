//! A2A (Agent-to-Agent) Protocol — enables AVA007 instances to communicate.
//!
//! Phone A can delegate to Phone B. Main Brain can coordinate tasks across
//! both mobile runtimes. A2A messages route through Main Brain as relay.
//!
//! # Topology
//!
//! ```text
//!   Phone A ←──→ Main Brain ←──→ Phone B
//!                  (relay)
//! ```
//!
//! Main Brain maintains device registry:
//!   - Device capabilities
//!   - Current load
//!   - Last heartbeat
//!   - Availability
//!
//! # Message types
//!
//!   - TaskDelegation: "Please do this for me"
//!   - TaskResult:     "Here's the result of your delegation"
//!   - Heartbeat:      "I'm alive, here's my status"
//!   - MemorySync:     "Here are receipts + configs to sync"
//!   - Collaborate:    "Let's work on this together"

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn};

// ── Types ───────────────────────────────────────────────────────────────────

/// A2A message envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AMessage {
    pub id: String,
    pub from_device: DeviceId,
    pub to_device: DeviceId,
    pub timestamp_ns: i64,
    pub payload: A2APayload,
    pub ttl_seconds: u32,
    pub reply_to: Option<String>,
}

/// Device identifier. MainBrain is the central relay; MobileRuntime is any
/// AVA007 instance running on a phone.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DeviceId {
    MainBrain,
    MobileRuntime(String), // Device UUID
}

impl DeviceId {
    pub fn as_str(&self) -> &str {
        match self {
            DeviceId::MainBrain => "main_brain",
            DeviceId::MobileRuntime(s) => s.as_str(),
        }
    }
}

impl std::fmt::Display for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// What an A2A message contains.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum A2APayload {
    /// Request help from another device
    TaskDelegation {
        task: String,
        intent: String,
        context: serde_json::Value,
        required_capability: Capability,
    },

    /// Response to a delegation
    TaskResult {
        delegation_id: String,
        success: bool,
        result: serde_json::Value,
        receipts: Vec<String>, // Receipt IDs generated
    },

    /// Health/status check
    Heartbeat {
        device_id: DeviceId,
        battery_pct: f32,
        thermal_state: String,
        capabilities: Vec<Capability>,
        load: f32, // 0.0–1.0
    },

    /// Sync memory between devices
    MemorySync {
        receipts: Vec<serde_json::Value>,
        processor_configs: HashMap<String, serde_json::Value>,
        skill_cache: Vec<serde_json::Value>,
    },

    /// Request real-time collaboration
    Collaborate {
        session_id: String,
        shared_context: serde_json::Value,
        role: CollaborationRole,
    },
}

/// What a device can do — used for routing decisions.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Capability {
    BrowserAutomation,
    CodeExecution,
    CameraVision,
    WhatsAppMessaging,
    HeavyInference,
    DataAnalysis,
}

impl Capability {
    pub fn as_str(&self) -> &'static str {
        match self {
            Capability::BrowserAutomation => "browser_automation",
            Capability::CodeExecution => "code_execution",
            Capability::CameraVision => "camera_vision",
            Capability::WhatsAppMessaging => "whatsapp_messaging",
            Capability::HeavyInference => "heavy_inference",
            Capability::DataAnalysis => "data_analysis",
        }
    }
}

impl std::fmt::Display for Capability {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Role a device plays in a collaboration session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CollaborationRole {
    /// Plans and delegates
    Leader,
    /// Executes sub-tasks
    Executor,
    /// Receives updates, provides memory
    Observer,
}

// ── Device registry ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub device_id: DeviceId,
    pub last_heartbeat_ns: i64,
    pub battery_pct: f32,
    pub thermal_state: ThermalState,
    pub capabilities: Vec<Capability>,
    pub current_load: f32,
    pub connected: bool,
}

/// Thermal state for device registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThermalState {
    Normal,
    Warm,
    Critical,
}

impl Default for ThermalState {
    fn default() -> Self {
        ThermalState::Normal
    }
}

// ── A2A Relay ───────────────────────────────────────────────────────────────

/// A2A routing relay — runs on Main Brain.
///
/// Maintains device registry, forwards messages, queues offline messages.
pub struct A2ARelay {
    devices: Arc<RwLock<HashMap<DeviceId, DeviceStatus>>>,
    message_queue: Arc<RwLock<Vec<A2AMessage>>>,
    /// Outbound message channel (consumed by the WebSocket/gRPC sender)
    outbound_tx: mpsc::Sender<A2AMessage>,
    /// Heartbeat timeout — devices that haven't pinged are marked disconnected
    heartbeat_timeout: Duration,
}

impl A2ARelay {
    pub fn new(outbound_tx: mpsc::Sender<A2AMessage>) -> Self {
        Self {
            devices: Arc::new(RwLock::new(HashMap::new())),
            message_queue: Arc::new(RwLock::new(Vec::new())),
            outbound_tx,
            heartbeat_timeout: Duration::from_secs(60),
        }
    }

    /// Route a message to the best available device that has the required capability.
    pub fn route_to_best(
        &self,
        required: &Capability,
        exclude: &DeviceId,
    ) -> Option<DeviceId> {
        let devices = self.devices.read();
        let now_ns = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let cutoff_ns = now_ns - (self.heartbeat_timeout.as_nanos() as i64);

        devices.values()
            .filter(|d| {
                d.connected
                && d.last_heartbeat_ns >= cutoff_ns
                && d.capabilities.contains(required)
                && d.current_load < 0.8
                && d.device_id != *exclude
            })
            .min_by(|a, b| {
                // Prefer lower load, higher battery
                let score_a = a.current_load - a.battery_pct;
                let score_b = b.current_load - b.battery_pct;
                score_a.partial_cmp(&score_b).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|d| d.device_id.clone())
    }

    /// Relay a message through Main Brain.
    pub async fn relay(&self, message: A2AMessage) -> anyhow::Result<()> {
        // Store for offline delivery
        self.message_queue.write().push(message.clone());

        // If target device is connected, forward immediately
        let connected = {
            let devices = self.devices.read();
            devices.get(&message.to_device).map(|d| d.connected).unwrap_or(false)
        };

        if connected {
            self.outbound_tx.send(message).await
                .map_err(|e| anyhow::anyhow!("outbound channel closed: {e}"))?;
            Ok(())
        } else {
            warn!(
                "Target device {} not connected — message queued for later delivery",
                message.to_device.as_str()
            );
            Ok(())
        }
    }

    /// Process an inbound Heartbeat — update device registry.
    pub fn process_heartbeat(&self, payload: &A2APayload) {
        if let A2APayload::Heartbeat {
            device_id, battery_pct, thermal_state, capabilities, load,
        } = payload {
            let mut devices = self.devices.write();
            let now_ns = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
            let thermal = match thermal_state.as_str() {
                "Warm" => ThermalState::Warm,
                "Critical" => ThermalState::Critical,
                _ => ThermalState::Normal,
            };
            let status = DeviceStatus {
                device_id: device_id.clone(),
                last_heartbeat_ns: now_ns,
                battery_pct: *battery_pct,
                thermal_state: thermal,
                capabilities: capabilities.clone(),
                current_load: *load,
                connected: true,
            };
            info!(
                "Heartbeat from {}: battery={:.0}%, load={:.0}%, thermal={:?}",
                device_id.as_str(), battery_pct * 100.0, load * 100.0, thermal
            );
            devices.insert(device_id.clone(), status);
        }
    }

    /// Mark a device as disconnected (called when WebSocket drops).
    pub fn mark_disconnected(&self, device_id: &DeviceId) {
        let mut devices = self.devices.write();
        if let Some(status) = devices.get_mut(device_id) {
            status.connected = false;
            info!("Device {} disconnected", device_id.as_str());
        }
    }

    /// Sweep — mark devices with stale heartbeats as disconnected.
    pub fn sweep_stale(&self) {
        let now_ns = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0);
        let cutoff_ns = now_ns - (self.heartbeat_timeout.as_nanos() as i64);
        let mut devices = self.devices.write();
        for status in devices.values_mut() {
            if status.last_heartbeat_ns < cutoff_ns && status.connected {
                status.connected = false;
                warn!(
                    "Device {} marked disconnected (heartbeat stale)",
                    status.device_id.as_str()
                );
            }
        }
    }

    /// Drain the offline message queue for a now-connected device.
    pub async fn drain_queue_for(&self, device_id: &DeviceId) -> Vec<A2AMessage> {
        let mut queue = self.message_queue.write();
        let (to_send, keep): (Vec<_>, Vec<_>) = queue.drain(..).partition(|m| m.to_device == *device_id);
        *queue = keep;
        to_send
    }

    /// Snapshot all device statuses (for UI display / debugging).
    pub fn device_snapshot(&self) -> Vec<DeviceStatus> {
        self.devices.read().values().cloned().collect()
    }

    /// Get a specific device's status.
    pub fn get_device(&self, id: &DeviceId) -> Option<DeviceStatus> {
        self.devices.read().get(id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn relay_forwards_to_connected_device() {
        let (tx, mut rx) = mpsc::channel(8);
        let relay = A2ARelay::new(tx);

        // Register a connected device
        relay.process_heartbeat(&A2APayload::Heartbeat {
            device_id: DeviceId::MobileRuntime("phone-B".into()),
            battery_pct: 0.8,
            thermal_state: "Normal".into(),
            capabilities: vec![Capability::HeavyInference],
            load: 0.3,
        });

        let msg = A2AMessage {
            id: "msg-1".into(),
            from_device: DeviceId::MobileRuntime("phone-A".into()),
            to_device: DeviceId::MobileRuntime("phone-B".into()),
            timestamp_ns: 0,
            payload: A2APayload::TaskDelegation {
                task: "summarize this article".into(),
                intent: "Synthesis".into(),
                context: serde_json::json!({"url": "https://example.com"}),
                required_capability: Capability::HeavyInference,
            },
            ttl_seconds: 60,
            reply_to: None,
        };

        relay.relay(msg).await.unwrap();
        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, "msg-1");
    }

    #[tokio::test]
    async fn relay_queues_for_offline_device() {
        let (tx, _rx) = mpsc::channel(8);
        let relay = A2ARelay::new(tx);

        // Don't register any device — target is offline
        let msg = A2AMessage {
            id: "msg-2".into(),
            from_device: DeviceId::MainBrain,
            to_device: DeviceId::MobileRuntime("phone-X".into()),
            timestamp_ns: 0,
            payload: A2APayload::TaskResult {
                delegation_id: "del-1".into(),
                success: true,
                result: serde_json::json!({"answer": 42}),
                receipts: vec![],
            },
            ttl_seconds: 60,
            reply_to: None,
        };

        relay.relay(msg.clone()).await.unwrap();
        // Message should be in the queue
        assert_eq!(relay.message_queue.read().len(), 1);
    }

    #[test]
    fn route_to_best_picks_least_loaded() {
        let (tx, _rx) = mpsc::channel(8);
        let relay = A2ARelay::new(tx);

        // Register two devices with the same capability, different loads
        for (id, load, battery) in &[("low-load", 0.2, 0.9), ("high-load", 0.7, 0.5)] {
            relay.process_heartbeat(&A2APayload::Heartbeat {
                device_id: DeviceId::MobileRuntime(id.to_string()),
                battery_pct: *battery,
                thermal_state: "Normal".into(),
                capabilities: vec![Capability::HeavyInference],
                load: *load,
            });
        }

        let best = relay.route_to_best(&Capability::HeavyInference, &DeviceId::MainBrain);
        assert_eq!(best, Some(DeviceId::MobileRuntime("low-load".into())));
    }

    #[test]
    fn route_to_best_excludes_high_load() {
        let (tx, _rx) = mpsc::channel(8);
        let relay = A2ARelay::new(tx);

        // Register one device at 90% load
        relay.process_heartbeat(&A2APayload::Heartbeat {
            device_id: DeviceId::MobileRuntime("busy".into()),
            battery_pct: 0.9,
            thermal_state: "Normal".into(),
            capabilities: vec![Capability::HeavyInference],
            load: 0.9, // exceeds 0.8 threshold
        });

        let best = relay.route_to_best(&Capability::HeavyInference, &DeviceId::MainBrain);
        assert!(best.is_none());
    }

    #[tokio::test]
    async fn drain_queue_returns_pending_messages() {
        let (tx, _rx) = mpsc::channel(8);
        let relay = A2ARelay::new(tx);

        // Queue 2 messages for phone-X
        for i in 0..2 {
            relay.message_queue.write().push(A2AMessage {
                id: format!("msg-{i}"),
                from_device: DeviceId::MainBrain,
                to_device: DeviceId::MobileRuntime("phone-X".into()),
                timestamp_ns: 0,
                payload: A2APayload::TaskResult {
                    delegation_id: format!("del-{i}"),
                    success: true,
                    result: serde_json::json!({}),
                    receipts: vec![],
                },
                ttl_seconds: 60,
                reply_to: None,
            });
        }
        // And one for phone-Y
        relay.message_queue.write().push(A2AMessage {
            id: "msg-y".into(),
            from_device: DeviceId::MainBrain,
            to_device: DeviceId::MobileRuntime("phone-Y".into()),
            timestamp_ns: 0,
            payload: A2APayload::TaskResult {
                delegation_id: "del-y".into(),
                success: true,
                result: serde_json::json!({}),
                receipts: vec![],
            },
            ttl_seconds: 60,
            reply_to: None,
        });

        let drained = relay.drain_queue_for(&DeviceId::MobileRuntime("phone-X".into())).await;
        assert_eq!(drained.len(), 2);
        // phone-Y's message should still be queued
        assert_eq!(relay.message_queue.read().len(), 1);
    }
}
