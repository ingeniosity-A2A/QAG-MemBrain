//! Zero-copy codec: Receipt ↔ Arrow RecordBatch.
//!
//! This is the boundary where Rust-native structs become Arrow columnar memory
//! that can be:
//!   - Written to Parquet via arrow-rs (zero serialization)
//!   - Read by DuckDB-WASM via Arrow IPC stream
//!   - Consumed by EPOCH (ArrowJS) in the UI sandbox via the same IPC stream
//!
//! All allocations use Arc — cloning a Receipt into the batch does NOT copy
//! the content or embedding. The Arrow builders hold Arc references until
//! the batch is finalized into columnar buffers.

use std::sync::Arc;

use arrow::{
    array::*,
    datatypes::Field,
    record_batch::RecordBatch,
};
use uuid::Uuid;

use crate::receipt::{receipt_schema, Origin, Receipt, ReceiptKind};

pub struct ReceiptCodec;

impl ReceiptCodec {
    /// Encode a slice of Receipts into a single RecordBatch.
    ///
    /// Capacity hints: ~64 receipts per batch is the sweet spot for
    /// Snapdragon 8 Elite L2 cache (512KB). Beyond that, batch.
    pub fn encode(receipts: &[Receipt]) -> anyhow::Result<RecordBatch> {
        let schema = receipt_schema();
        let n = receipts.len();

        // ── Fixed-size columns ────────────────────────────────────────────
        let mut id_builder       = FixedSizeBinaryBuilder::new(16);
        let mut ts_builder       = Int64Builder::new();
        let mut session_builder  = StringBuilder::new();
        let mut origin_builder   = StringBuilder::new();
        let mut kind_builder     = StringBuilder::new();
        let mut hash_builder     = FixedSizeBinaryBuilder::new(32);
        let mut content_builder  = StringBuilder::new();
        let mut parent_builder   = FixedSizeBinaryBuilder::new(16);
        let mut trust_builder    = Float32Builder::new();
        let mut knox_builder     = BooleanBuilder::new();
        let mut metadata_builder = StringBuilder::new();

        // ── Variable list column (embedding) ──────────────────────────────
        let emb_values = Float32Builder::new();
        let mut emb_builder = ListBuilder::new(emb_values);

        for r in receipts {
            // id: UUID → 16 bytes big-endian
            id_builder.append_value(r.id.as_bytes())?;

            // timestamp_ns
            ts_builder.append_value(r.timestamp_ns);

            // session_id
            session_builder.append_value(r.session_id.as_ref());

            // origin (string for SQL ergonomics; int8 alternative lives in metadata)
            origin_builder.append_value(r.origin.as_str());

            // kind
            kind_builder.append_value(r.kind.as_str());

            // content_hash
            hash_builder.append_value(&r.content_hash)?;

            // content
            content_builder.append_value(r.content.as_ref());

            // embedding (nullable list<f32>)
            match &r.embedding {
                Some(emb) => {
                    let mut vals = emb_builder.values();
                    for &v in emb.iter() {
                        vals.append_value(v);
                    }
                    emb_builder.append(true);
                }
                None => {
                    emb_builder.append(false);
                }
            }

            // parent_receipt (nullable)
            match r.parent_receipt {
                Some(p) => { parent_builder.append_value(p.as_bytes())?; }
                None    => { parent_builder.append_null(); }
            }

            // trust_score
            trust_builder.append_value(r.trust_score);

            // knox_safe
            knox_builder.append_value(r.knox_safe);

            // metadata (JSON-encoded)
            let json = serde_json::to_string(r.metadata.as_ref())
                .unwrap_or_else(|_| "{}".into());
            metadata_builder.append_value(json);
        }

        // Build columns in schema order
        let columns: Vec<ArrayRef> = vec![
            Arc::new(id_builder.finish()),
            Arc::new(ts_builder.finish()),
            Arc::new(session_builder.finish()),
            Arc::new(origin_builder.finish()),
            Arc::new(kind_builder.finish()),
            Arc::new(hash_builder.finish()),
            Arc::new(content_builder.finish()),
            Arc::new(emb_builder.finish()),
            Arc::new(parent_builder.finish()),
            Arc::new(trust_builder.finish()),
            Arc::new(knox_builder.finish()),
            Arc::new(metadata_builder.finish()),
        ];

        RecordBatch::try_new(schema, columns)
            .map_err(|e| anyhow::anyhow!("Arrow encode failed: {e}"))
    }

    /// Decode a RecordBatch back into Receipts.
    /// Used by the WAL recovery path and by REV.IKE for read-only interpretation.
    pub fn decode(batch: &RecordBatch) -> anyhow::Result<Vec<Receipt>> {
        use std::collections::HashMap;

        let n = batch.num_rows();
        let mut out = Vec::with_capacity(n);

        let ids       = batch.column(0).as_any().downcast_ref::<FixedSizeBinaryArray>().unwrap();
        let tss       = batch.column(1).as_any().downcast_ref::<Int64Array>().unwrap();
        let sessions  = batch.column(2).as_any().downcast_ref::<StringArray>().unwrap();
        let origins   = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
        let kinds     = batch.column(4).as_any().downcast_ref::<StringArray>().unwrap();
        let hashes    = batch.column(5).as_any().downcast_ref::<FixedSizeBinaryArray>().unwrap();
        let contents  = batch.column(6).as_any().downcast_ref::<StringArray>().unwrap();
        let embs      = batch.column(7).as_any().downcast_ref::<ListArray>().unwrap();
        let parents   = batch.column(8).as_any().downcast_ref::<FixedSizeBinaryArray>().unwrap();
        let trusts    = batch.column(9).as_any().downcast_ref::<Float32Array>().unwrap();
        let knox      = batch.column(10).as_any().downcast_ref::<BooleanArray>().unwrap();
        let metas     = batch.column(11).as_any().downcast_ref::<StringArray>().unwrap();

        let emb_values = embs.values();
        let emb_f32 = emb_values.as_any().downcast_ref::<Float32Array>().unwrap();

        for i in 0..n {
            let id_bytes = ids.value(i);
            let id = Uuid::from_slice(id_bytes)?;

            let ts_ns = tss.value(i);

            let session: Arc<str> = sessions.value(i).into();

            let origin = Origin::from_str(origins.value(i))
                .ok_or_else(|| anyhow::anyhow!("bad origin at row {i}"))?;

            let kind = match kinds.value(i) {
                "perception" => ReceiptKind::Perception,
                "cognition"  => ReceiptKind::Cognition,
                "action"     => ReceiptKind::Action,
                "memory"     => ReceiptKind::Memory,
                "control"    => ReceiptKind::Control,
                other => anyhow::bail!("bad kind at row {i}: {other}"),
            };

            let mut content_hash = [0u8; 32];
            content_hash.copy_from_slice(hashes.value(i));

            let content: Arc<str> = contents.value(i).into();

            let embedding = if embs.is_null(i) {
                None
            } else {
                let offsets = embs.value_offsets();
                let start = offsets[i] as usize;
                let end   = offsets[i + 1] as usize;
                let v: Vec<f32> = (start..end).map(|j| emb_f32.value(j)).collect();
                Some(Arc::new(v))
            };

            let parent_receipt = if parents.is_null(i) {
                None
            } else {
                Some(Uuid::from_slice(parents.value(i))?)
            };

            let trust_score = trusts.value(i);
            let knox_safe   = knox.value(i);

            let metadata: HashMap<Arc<str>, Arc<str>> = serde_json::from_str(metas.value(i))
                .unwrap_or_default();

            out.push(Receipt {
                id,
                timestamp_ns: ts_ns,
                session_id: session,
                origin,
                kind,
                content_hash,
                content,
                embedding,
                parent_receipt,
                trust_score,
                knox_safe,
                metadata: Arc::new(metadata),
                signature: None,
                signer_did: None,
                atommem_directive: None,
            });
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receipt::Receipt;

    #[test]
    fn roundtrip_preserves_receipts() {
        let mut receipts = Vec::new();
        for i in 0..16 {
            let r = Receipt::new(
                format!("session-{i}").into(),
                if i % 2 == 0 { Origin::User } else { Origin::Fable },
                ReceiptKind::Perception,
                format!("content line {i}").into(),
                None,
            )
            .with_embedding(vec![0.1 * i as f32, 0.2 * i as f32, 0.3 * i as f32])
            .with_metadata("model", "gemma-2b")
            .with_metadata("latency_ms", format!("{}", i * 12));

            receipts.push(if i == 3 {
                r.mark_knox_unsafe()
            } else {
                r
            });
        }

        let batch = ReceiptCodec::encode(&receipts).unwrap();
        assert_eq!(batch.num_rows(), 16);

        let decoded = ReceiptCodec::decode(&batch).unwrap();
        assert_eq!(decoded.len(), receipts.len());

        for (a, b) in receipts.iter().zip(decoded.iter()) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.origin, b.origin);
            assert_eq!(a.kind, b.kind);
            assert_eq!(a.content.as_ref(), b.content.as_ref());
            assert_eq!(a.content_hash, b.content_hash);
            assert_eq!(a.trust_score, b.trust_score);
            assert_eq!(a.knox_safe, b.knox_safe);
            assert_eq!(a.embedding.as_ref().map(|e| e.len()),
                       b.embedding.as_ref().map(|e| e.len()));
        }
    }
}
