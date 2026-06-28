//! WASM-native Capabilities IR — evolvable capability sandboxes.
//!
//! White paper §5: "Capabilities are packaged as evolvable units that
//! run in secure, isolated sandboxes."
//!
//! Each Capability is a WASM module with:
//!   - A semantic name (what it does)
//!   - Input/output schema (JSON Schema)
//!   - Resource limits (max memory, max execution time)
//!   - A fitness score (updated by FAPO Arena)
//!   - A content hash (for integrity + dedup)
//!
//! Capabilities are loaded into a WASM runtime (wasmer/wasmtime) and
//! invoked via a standardized interface. The sandbox prevents them
//! from accessing the filesystem, network, or host APIs except through
//! explicitly granted capabilities.

use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use uuid::Uuid;

/// A capability — a unit of evolvable functionality.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capability {
    pub id: Uuid,
    pub name: String,
    pub version: u32,
    pub description: String,
    /// WASM module bytes (or URL to fetch from)
    pub wasm_source: WasmSource,
    /// Input schema (JSON Schema format)
    pub input_schema: serde_json::Value,
    /// Output schema (JSON Schema format)
    pub output_schema: serde_json::Value,
    /// Resource limits for the sandbox
    pub limits: ResourceLimits,
    /// Fitness score (0.0–1.0, updated by FAPO Arena)
    pub fitness: f64,
    /// Content hash (SHA-256 of wasm bytes + schema)
    pub content_hash: String,
    /// Parent capability (for evolution lineage)
    pub parent_id: Option<Uuid>,
    /// When this capability was created
    pub created_at: i64,
}

/// Where the WASM module lives.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WasmSource {
    /// Embedded bytes
    Embedded(Vec<u8>),
    /// URL to fetch from (e.g., Cloudflare R2)
    Url(String),
    /// Named registry entry (resolved at load time)
    Registry(String),
}

/// Resource limits for the WASM sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Max memory in bytes (default: 64MB)
    pub max_memory_bytes: u64,
    /// Max execution time in ms (default: 5000)
    pub max_execution_ms: u64,
    /// Max fuel (wasmtime metering)
    pub max_fuel: u64,
    /// Whether filesystem access is granted
    pub allow_fs: bool,
    /// Whether network access is granted
    pub allow_network: bool,
    /// Allowed environment variables
    pub allowed_env: Vec<String>,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_memory_bytes: 64 * 1024 * 1024, // 64MB
            max_execution_ms: 5000,
            max_fuel: 1_000_000,
            allow_fs: false,
            allow_network: false,
            allowed_env: vec![],
        }
    }
}

/// The result of invoking a capability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityResult {
    pub capability_id: Uuid,
    pub success: bool,
    pub output: serde_json::Value,
    pub error: Option<String>,
    pub execution_ms: u64,
    pub memory_used_bytes: u64,
    pub fuel_consumed: u64,
}

impl Capability {
    /// Create a new capability with the given WASM source + schemas.
    pub fn new(
        name: &str,
        description: &str,
        wasm_source: WasmSource,
        input_schema: serde_json::Value,
        output_schema: serde_json::Value,
    ) -> Self {
        let content_hash = compute_hash(&wasm_source, &input_schema, &output_schema);
        Self {
            id: Uuid::now_v7(),
            name: name.into(),
            version: 1,
            description: description.into(),
            wasm_source,
            input_schema,
            output_schema,
            limits: ResourceLimits::default(),
            fitness: 0.5,
            content_hash,
            parent_id: None,
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        }
    }

    /// Create a child capability (evolution — parent + mutation).
    pub fn evolve(&self, new_wasm: WasmSource, new_input: serde_json::Value, new_output: serde_json::Value) -> Self {
        let content_hash = compute_hash(&new_wasm, &new_input, &new_output);
        Self {
            id: Uuid::now_v7(),
            name: self.name.clone(),
            version: self.version + 1,
            description: self.description.clone(),
            wasm_source: new_wasm,
            input_schema: new_input,
            output_schema: new_output,
            limits: self.limits.clone(),
            fitness: 0.5, // Reset — will be updated by FAPO Arena
            content_hash,
            parent_id: Some(self.id),
            created_at: chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        }
    }

    /// Check if this capability is allowed to access a resource.
    pub fn can_access(&self, resource: &Resource) -> bool {
        match resource {
            Resource::Filesystem => self.limits.allow_fs,
            Resource::Network => self.limits.allow_network,
            Resource::EnvVar(name) => self.limits.allowed_env.contains(name),
        }
    }
}

/// Resources that a capability might request access to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resource {
    Filesystem,
    Network,
    EnvVar(String),
}

/// Compute the content hash of a capability.
fn compute_hash(
    wasm: &WasmSource,
    input: &serde_json::Value,
    output: &serde_json::Value,
) -> String {
    let mut hasher = Sha256::new();
    match wasm {
        WasmSource::Embedded(bytes) => hasher.update(bytes),
        WasmSource::Url(url) => hasher.update(url.as_bytes()),
        WasmSource::Registry(name) => hasher.update(name.as_bytes()),
    }
    hasher.update(input.to_string().as_bytes());
    hasher.update(output.to_string().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The capability registry — stores all known capabilities.
pub struct CapabilityRegistry {
    capabilities: std::collections::HashMap<Uuid, Capability>,
    /// Name → latest version ID
    latest: std::collections::HashMap<String, Uuid>,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        Self {
            capabilities: std::collections::HashMap::new(),
            latest: std::collections::HashMap::new(),
        }
    }

    pub fn register(&mut self, cap: Capability) {
        let id = cap.id;
        let name = cap.name.clone();
        self.latest.insert(name, id);
        self.capabilities.insert(id, cap);
    }

    pub fn get(&self, id: &Uuid) -> Option<&Capability> {
        self.capabilities.get(id)
    }

    pub fn get_latest(&self, name: &str) -> Option<&Capability> {
        self.latest.get(name).and_then(|id| self.capabilities.get(id))
    }

    pub fn all(&self) -> Vec<&Capability> {
        self.capabilities.values().collect()
    }
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_gets_unique_id_and_hash() {
        let cap1 = Capability::new(
            "test",
            "test capability",
            WasmSource::Embedded(vec![0x00, 0x61, 0x73, 0x6d]), // WASM magic bytes
            serde_json::json!({"type": "string"}),
            serde_json::json!({"type": "string"}),
        );
        let cap2 = Capability::new(
            "test",
            "test capability",
            WasmSource::Embedded(vec![0x00, 0x61, 0x73, 0x6d]),
            serde_json::json!({"type": "string"}),
            serde_json::json!({"type": "string"}),
        );
        assert_ne!(cap1.id, cap2.id); // Different UUIDs
        assert_eq!(cap1.content_hash, cap2.content_hash); // Same content
    }

    #[test]
    fn evolve_creates_child_with_lineage() {
        let parent = Capability::new(
            "search",
            "search capability",
            WasmSource::Registry("search-v1".into()),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        let child = parent.evolve(
            WasmSource::Registry("search-v2".into()),
            serde_json::json!({}),
            serde_json::json!({}),
        );
        assert_eq!(child.version, 2);
        assert_eq!(child.parent_id, Some(parent.id));
        assert_ne!(child.content_hash, parent.content_hash);
    }

    #[test]
    fn registry_tracks_latest_version() {
        let mut reg = CapabilityRegistry::new();
        let v1 = Capability::new("search", "v1", WasmSource::Registry("s1".into()), serde_json::json!({}), serde_json::json!({}));
        let v2 = v1.evolve(WasmSource::Registry("s2".into()), serde_json::json!({}), serde_json::json!({}));
        reg.register(v1);
        reg.register(v2);
        let latest = reg.get_latest("search").unwrap();
        assert_eq!(latest.version, 2);
    }

    #[test]
    fn resource_limits_default_is_sandboxed() {
        let limits = ResourceLimits::default();
        assert!(!limits.allow_fs);
        assert!(!limits.allow_network);
        assert!(limits.allowed_env.is_empty());
    }
}
