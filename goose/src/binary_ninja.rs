//! Binary Ninja Agent (`bn`) — Preview-then-Commit binary audits.
//!
//! White paper §5: "A situated tool loop that allows Ava-007 to perform
//! deep-system audits of technician swarm firmware. It utilizes a
//! 'Preview then Commit' mutation path to resolve Strategic Ambiguity
//! in machine code."
//!
//! # Protocol
//!
//!   1. PREVIEW: Analyze a binary WITHOUT modifying it — produce a
//!      diff of what WOULD change
//!   2. REVIEW: The Meta Harness (or user) reviews the preview diff
//!   3. COMMIT: If approved, apply the changes for real
//!
//! This prevents irreversible mutations during autonomous audits.

use std::sync::Arc;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// A binary audit request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRequest {
    /// Path to the binary to audit
    pub binary_path: String,
    /// What to look for (e.g., "vulnerabilities", "backdoors", "firmware version")
    pub audit_type: AuditType,
    /// Whether to actually modify the binary (false = preview only)
    pub commit: bool,
    /// Maximum bytes to analyze (default: full binary)
    pub max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditType {
    /// Look for known vulnerability patterns
    VulnerabilityScan,
    /// Check for backdoor signatures
    BackdoorDetection,
    /// Extract firmware version + build info
    FirmwareVersion,
    /// Full disassembly + annotation
    FullDisassembly,
    /// Patch a specific offset (requires commit=true)
    PatchOffset,
}

/// A preview of what the audit WOULD change (before committing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditPreview {
    pub binary_path: String,
    pub audit_type: AuditType,
    /// Proposed changes (offset, old bytes, new bytes)
    pub changes: Vec<ProposedChange>,
    /// Findings (vulnerabilities, backdoors, version info)
    pub findings: Vec<AuditFinding>,
    /// Whether the audit is safe to commit
    pub safe_to_commit: bool,
    /// Human-readable summary
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposedChange {
    pub offset: u64,
    pub old_bytes: Vec<u8>,
    pub new_bytes: Vec<u8>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditFinding {
    pub severity: FindingSeverity,
    pub category: String,
    pub description: String,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FindingSeverity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

/// The result of a committed audit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditResult {
    pub preview: AuditPreview,
    pub committed: bool,
    pub bytes_modified: u64,
    pub backup_path: Option<String>,
}

/// The Binary Ninja agent — performs Preview-then-Commit binary audits.
pub struct BinaryNinjaAgent {
    /// Path to the Binary Ninja headless binary (if installed)
    bn_path: Option<PathBuf>,
}

impl BinaryNinjaAgent {
    pub fn new() -> Arc<Self> {
        // Check if Binary Ninja is installed
        let bn_path = which::which("bn")
            .or_else(|_| which::which("binaryninja"))
            .ok();

        if bn_path.is_none() {
            warn!("Binary Ninja not found in PATH — audits will use built-in heuristics only");
        }

        Arc::new(Self { bn_path })
    }

    /// PREVIEW: Analyze a binary WITHOUT modifying it.
    /// Returns what WOULD change if the audit were committed.
    pub async fn preview(&self, request: AuditRequest) -> anyhow::Result<AuditPreview> {
        info!(
            "Binary Ninja PREVIEW: {} (type={:?})",
            request.binary_path, request.audit_type
        );

        let findings = self.analyze_binary(&request).await?;
        let changes = self.propose_changes(&request, &findings);
        let safe_to_commit = changes.iter().all(|c| !c.old_bytes.is_empty());
        let summary = format!(
            "Found {} findings, proposed {} changes (safe={})",
            findings.len(), changes.len(), safe_to_commit
        );

        Ok(AuditPreview {
            binary_path: request.binary_path,
            audit_type: request.audit_type,
            changes,
            findings,
            safe_to_commit,
            summary,
        })
    }

    /// COMMIT: Apply the changes from a preview.
    /// Returns the result with bytes modified + backup path.
    pub async fn commit(&self, preview: AuditPreview) -> anyhow::Result<AuditResult> {
        if !preview.safe_to_commit {
            anyhow::bail!("Preview is not safe to commit — review findings first");
        }

        info!(
            "Binary Ninja COMMIT: {} ({} changes)",
            preview.binary_path, preview.changes.len()
        );

        // Create backup
        let backup_path = format!("{}.bak", preview.binary_path);
        tokio::fs::copy(&preview.binary_path, &backup_path).await?;

        let mut bytes_modified = 0u64;
        for change in &preview.changes {
            // In production: open file, seek to offset, write new_bytes
            bytes_modified += change.new_bytes.len() as u64;
            info!(
                "  Patched offset 0x{:x}: {} bytes → {} bytes ({})",
                change.offset,
                change.old_bytes.len(),
                change.new_bytes.len(),
                change.reason
            );
        }

        Ok(AuditResult {
            preview,
            committed: true,
            bytes_modified,
            backup_path: Some(backup_path),
        })
    }

    /// Analyze a binary for findings (vulnerabilities, backdoors, version).
    async fn analyze_binary(&self, request: &AuditRequest) -> anyhow::Result<Vec<AuditFinding>> {
        // In production: use Binary Ninja API to disassemble + analyze
        // For now: return empty findings (stub)
        Ok(Vec::new())
    }

    /// Propose changes based on findings.
    fn propose_changes(
        &self,
        request: &AuditRequest,
        findings: &[AuditFinding],
    ) -> Vec<ProposedChange> {
        // In production: generate patches based on findings
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preview_returns_empty_findings_for_stub() {
        let agent = BinaryNinjaAgent::new();
        let req = AuditRequest {
            binary_path: "/tmp/test.bin".into(),
            audit_type: AuditType::VulnerabilityScan,
            commit: false,
            max_bytes: None,
        };
        let preview = agent.preview(req).await.unwrap();
        assert!(preview.findings.is_empty());
        assert!(preview.changes.is_empty());
        assert!(preview.safe_to_commit); // no changes = safe
    }

    #[tokio::test]
    async fn commit_fails_without_preview() {
        let agent = BinaryNinjaAgent::new();
        // A preview with no changes but safe_to_commit=false
        let preview = AuditPreview {
            binary_path: "/nonexistent".into(),
            audit_type: AuditType::PatchOffset,
            changes: vec![],
            findings: vec![],
            safe_to_commit: false,
            summary: "test".into(),
        };
        let result = agent.commit(preview).await;
        assert!(result.is_err());
    }
}
