//! Context Injector — pulls relevant context from the Context Ocean
//! BEFORE inference, then formats it into a prompt prefix.
//!
//! This is the "Inject" half of the golden rule. Every inference call
//! in AVA007 is preceded by an injection step that retrieves:
//!
//!   1. **Semantic neighbors** — VSS recall_similar() on the query embedding
//!   2. **Session timeline** — recent receipts from the same session
//!   3. **Lineage chain** — parent_receipt DAG walk (if responding to a thread)
//!   4. **User preferences** — TASHI-compacted memory receipts for this user
//!
//! The injector does NOT call the LLM. It only formats text. This keeps
//! the injection path sub-millisecond and fully auditable.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use lite_notebook::receipt::Receipt;

/// The injected context bundle. Passed to the InferenceBackend as a
/// prompt prefix, BEFORE the actual user query.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectedContext {
    /// Formatted prompt prefix (ready to prepend to the user query)
    pub prompt_prefix: Arc<str>,

    /// Total estimated tokens in the prefix
    pub estimated_tokens: u32,

    /// Source receipts used to build this context (for audit trail)
    pub source_receipt_ids: Vec<uuid::Uuid>,

    /// Which retrieval strategies were used
    pub strategies_used: Vec<RetrievalStrategy>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RetrievalStrategy {
    /// VSS cosine similarity over embeddings
    SemanticRecall,
    /// Same-session recent receipts
    SessionTimeline,
    /// parent_receipt DAG walk
    LineageChain,
    /// TASHI-compacted user memories
    UserMemory,
    /// Knox audit log (when query touches sensitive surfaces)
    KnoxAudit,
}

/// Trait abstracting the Context Ocean query surface.
/// In production this is implemented by a DuckDB-WASM client.
/// In tests it's a mock.
#[async_trait::async_trait]
pub trait ContextLake: Send + Sync {
    /// Semantic recall: find k receipts whose embedding is closest to query_emb.
    async fn recall_similar(
        &self,
        query_emb: &[f32],
        k: usize,
    ) -> anyhow::Result<Vec<Receipt>>;

    /// Get the N most recent receipts in a session.
    async fn session_recent(
        &self,
        session_id: &str,
        n: usize,
    ) -> anyhow::Result<Vec<Receipt>>;

    /// Walk the parent_receipt DAG up to the root.
    async fn lineage_chain(
        &self,
        receipt_id: uuid::Uuid,
    ) -> anyhow::Result<Vec<Receipt>>;

    /// Fetch TASHI-compacted memory receipts for the user.
    async fn user_memories(&self, limit: usize) -> anyhow::Result<Vec<Receipt>>;
}

pub struct Injector {
    lake: Arc<dyn ContextLake>,
    /// Cache embeddings to avoid recomputing for the same query
    embedding_cache: RwLock<lru::LruCache<u64, Arc<Vec<f32>>>>,
}

impl Injector {
    pub fn new(lake: Arc<dyn ContextLake>, cache_cap: usize) -> Self {
        Self {
            lake,
            embedding_cache: RwLock::new(lru::LruCache::new(
                std::num::NonZeroUsize::new(cache_cap).unwrap(),
            )),
        }
    }

    /// Build the injected context for a query.
    ///
    /// `query_emb` is optional — if None, only session/lineage/memory
    /// strategies are used (no semantic recall).
    pub async fn inject(
        &self,
        query: &str,
        query_emb: Option<&[f32]>,
        session_id: &str,
        parent_receipt: Option<uuid::Uuid>,
        budget: u32,
    ) -> anyhow::Result<InjectedContext> {
        let mut sections: Vec<String> = Vec::new();
        let mut source_ids: Vec<uuid::Uuid> = Vec::new();
        let mut strategies: Vec<RetrievalStrategy> = Vec::new();
        let mut tokens_used: u32 = 0;

        // ── 1. Semantic recall (VSS) ─────────────────────────────────
        if let Some(emb) = query_emb {
            if budget > tokens_used {
                let k = ((budget - tokens_used) / 64).min(8) as usize; // ~64 tok per receipt
                let neighbors = self.lake.recall_similar(emb, k).await?;
                if !neighbors.is_empty() {
                    sections.push(format_section(
                        "Related context",
                        &neighbors.iter().map(|r| (r.origin.as_str(), r.content.as_ref())).collect::<Vec<_>>(),
                    ));
                    source_ids.extend(neighbors.iter().map(|r| r.id));
                    tokens_used += estimate_section_tokens(&sections.last().unwrap());
                    strategies.push(RetrievalStrategy::SemanticRecall);
                }
            }
        }

        // ── 2. Session timeline ──────────────────────────────────────
        if budget > tokens_used {
            let n = ((budget - tokens_used) / 48).min(6) as usize;
            let recent = self.lake.session_recent(session_id, n).await?;
            if !recent.is_empty() {
                sections.push(format_section(
                    "Recent conversation",
                    &recent.iter().map(|r| (r.origin.as_str(), r.content.as_ref())).collect::<Vec<_>>(),
                ));
                source_ids.extend(recent.iter().map(|r| r.id));
                tokens_used += estimate_section_tokens(&sections.last().unwrap());
                strategies.push(RetrievalStrategy::SessionTimeline);
            }
        }

        // ── 3. Lineage chain ─────────────────────────────────────────
        if let Some(parent_id) = parent_receipt {
            if budget > tokens_used {
                let chain = self.lake.lineage_chain(parent_id).await?;
                if !chain.is_empty() {
                    sections.push(format_section(
                        "Thread history",
                        &chain.iter().map(|r| (r.origin.as_str(), r.content.as_ref())).collect::<Vec<_>>(),
                    ));
                    source_ids.extend(chain.iter().map(|r| r.id));
                    tokens_used += estimate_section_tokens(&sections.last().unwrap());
                    strategies.push(RetrievalStrategy::LineageChain);
                }
            }
        }

        // ── 4. User memories (TASHI) ─────────────────────────────────
        if budget > tokens_used {
            let limit = ((budget - tokens_used) / 80).min(4) as usize;
            let memories = self.lake.user_memories(limit).await?;
            if !memories.is_empty() {
                sections.push(format_section(
                    "What I remember about you",
                    &memories.iter().map(|r| (r.origin.as_str(), r.content.as_ref())).collect::<Vec<_>>(),
                ));
                source_ids.extend(memories.iter().map(|r| r.id));
                tokens_used += estimate_section_tokens(&sections.last().unwrap());
                strategies.push(RetrievalStrategy::UserMemory);
            }
        }

        // ── Assemble prefix ──────────────────────────────────────────
        let prompt_prefix: Arc<str> = if sections.is_empty() {
            "".into()
        } else {
            format!(
                "<context>\n{}\n</context>\n\n",
                sections.join("\n\n")
            ).into()
        };

        Ok(InjectedContext {
            prompt_prefix,
            estimated_tokens: tokens_used,
            source_receipt_ids: source_ids,
            strategies_used: strategies,
        })
    }
}

fn format_section(title: &str, items: &[( &str, &str )]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let body = items.iter()
        .map(|(origin, content)| format!("  [{origin}] {content}"))
        .collect::<Vec<_>>()
        .join("\n");
    format!("## {title}\n{body}")
}

fn estimate_section_tokens(s: &str) -> u32 {
    (s.chars().count() as f32 / 4.0).ceil() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use lite_notebook::receipt::{Origin, ReceiptKind};
    use uuid::Uuid;

    struct MockLake {
        receipts: Vec<Receipt>,
    }

    #[async_trait::async_trait]
    impl ContextLake for MockLake {
        async fn recall_similar(&self, _emb: &[f32], k: usize) -> anyhow::Result<Vec<Receipt>> {
            Ok(self.receipts.iter().take(k).cloned().collect())
        }
        async fn session_recent(&self, _s: &str, n: usize) -> anyhow::Result<Vec<Receipt>> {
            Ok(self.receipts.iter().rev().take(n).cloned().collect())
        }
        async fn lineage_chain(&self, _id: Uuid) -> anyhow::Result<Vec<Receipt>> {
            Ok(self.receipts.iter().take(2).cloned().collect())
        }
        async fn user_memories(&self, limit: usize) -> anyhow::Result<Vec<Receipt>> {
            Ok(self.receipts.iter().take(limit).cloned().collect())
        }
    }

    fn make_receipts() -> Vec<Receipt> {
        vec![
            Receipt::new("s1".into(), Origin::User, ReceiptKind::Perception,
                "I love hiking in the Alps".into(), None),
            Receipt::new("s1".into(), Origin::RevIke, ReceiptKind::Cognition,
                "User enjoys outdoor mountain activities".into(), None),
            Receipt::new("s1".into(), Origin::User, ReceiptKind::Perception,
                "What gear do I need for Mont Blanc?".into(), None),
        ]
    }

    #[tokio::test]
    async fn inject_builds_prefix_from_context() {
        let lake = Arc::new(MockLake { receipts: make_receipts() });
        let inj = Injector::new(lake, 16);

        let emb = vec![0.1; 384];
        let ctx = inj.inject("Alps hiking gear", Some(&emb), "s1", None, 512).await.unwrap();

        assert!(!ctx.prompt_prefix.is_empty());
        assert!(ctx.prompt_prefix.contains("<context>"));
        assert!(ctx.prompt_prefix.contains("Related context"));
        assert!(ctx.source_receipt_ids.len() > 0);
        assert!(ctx.strategies_used.contains(&RetrievalStrategy::SemanticRecall));
    }

    #[tokio::test]
    async fn inject_returns_empty_when_no_context() {
        let lake = Arc::new(MockLake { receipts: vec![] });
        let inj = Injector::new(lake, 16);

        let ctx = inj.inject("test", None, "s1", None, 100).await.unwrap();
        assert!(ctx.prompt_prefix.is_empty());
        assert!(ctx.source_receipt_ids.is_empty());
    }
}
