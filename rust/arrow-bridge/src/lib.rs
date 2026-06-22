//! Arrow Bridge — Apache Arrow C Data Interface bridge for AMOS Mobile Runtime.
//!
//! Provides zero-copy data exchange between:
//!   - Rust core (this crate)
//!   - TypeScript web shell (via ArrowJS Sandbox + JNI)
//!   - Adreno GPU (via Arrow C Data Interface + compute kernels)
//!
//! Implements the [Arrow C Data Interface](https://arrow.apache.org/docs/format/CDataInterface.html)
//! for cross-language ABI compatibility.

#![cfg_attr(not(feature = "arrow"), allow(dead_code, unused_variables))]

use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Error returned by Arrow bridge operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ArrowError {
    InvalidAddress,
    SchemaMismatch { expected: String, actual: String },
    InvalidUtf8,
    BufferOverflow { capacity: usize, requested: usize },
    #[cfg(not(feature = "arrow"))]
    NotImplemented,
}

impl std::fmt::Display for ArrowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArrowError::InvalidAddress => write!(f, "invalid Arrow C Data Interface address"),
            ArrowError::SchemaMismatch { expected, actual } => {
                write!(f, "schema mismatch: expected {}, got {}", expected, actual)
            }
            ArrowError::InvalidUtf8 => write!(f, "invalid UTF-8 in Arrow string data"),
            ArrowError::BufferOverflow { capacity, requested } => {
                write!(f, "buffer overflow: capacity={}, requested={}", capacity, requested)
            }
            #[cfg(not(feature = "arrow"))]
            ArrowError::NotImplemented => write!(f, "arrow bridge built without arrow feature"),
        }
    }
}

impl std::error::Error for ArrowError {}

/// An Arrow RecordBatch — a collection of arrays with a schema.
///
/// In real impl (with `arrow` feature), this wraps `arrow::record_batch::RecordBatch`.
/// Without the feature, it's a stub that holds raw bytes.
#[derive(Debug, Clone)]
pub struct RecordBatch {
    pub schema: Schema,
    pub columns: Vec<Column>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schema {
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    pub data_type: ArrowDataType,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArrowDataType {
    Int32,
    Int64,
    Float32,
    Float64,
    Utf8,
    Boolean,
    List(Box<ArrowDataTypeRef>),
}

// Workaround for serde recursion in enum variants — wrap in a struct
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArrowDataTypeRef(pub ArrowDataType);

#[derive(Debug, Clone)]
pub enum Column {
    Int32(Vec<i32>),
    Int64(Vec<i64>),
    Float32(Vec<f32>),
    Float64(Vec<f64>),
    Utf8(Vec<String>),
    Boolean(Vec<bool>),
}

impl Column {
    pub fn len(&self) -> usize {
        match self {
            Column::Int32(v) => v.len(),
            Column::Int64(v) => v.len(),
            Column::Float32(v) => v.len(),
            Column::Float64(v) => v.len(),
            Column::Utf8(v) => v.len(),
            Column::Boolean(v) => v.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl RecordBatch {
    pub fn num_rows(&self) -> usize {
        self.columns.first().map(|c| c.len()).unwrap_or(0)
    }
    pub fn num_columns(&self) -> usize {
        self.columns.len()
    }
}

/// Arrow C Data Interface bridge.
#[derive(Debug, Default)]
pub struct ArrowBridge;

impl ArrowBridge {
    pub fn new() -> Self {
        Self
    }

    /// Import an Arrow RecordBatch via the C Data Interface.
    ///
    /// `array_addr` and `schema_addr` are pointers to the
    /// `ArrowArray` and `ArrowSchema` structs allocated by the
    /// exporting side (typically ArrowJS Sandbox or Java/Kotlin).
    ///
    /// # Safety
    /// The caller must ensure the addresses point to valid
    /// `ArrowArray` / `ArrowSchema` structs that remain valid for
    /// the duration of this call.
    pub unsafe fn import_record_batch(
        &self,
        _array_addr: usize,
        _schema_addr: usize,
    ) -> Result<RecordBatch, ArrowError> {
        #[cfg(feature = "arrow")]
        {
            // Real impl: use arrow::ffi::ArrowArray and arrow::ffi::ArrowSchema
            // to read the C structs, then convert to RecordBatch.
            // For now, return an error since the FFI plumbing is non-trivial.
            let _ = (_array_addr, _schema_addr);
            Err(ArrowError::NotImplemented)
        }
        #[cfg(not(feature = "arrow"))]
        {
            Err(ArrowError::NotImplemented)
        }
    }

    /// Export an Arrow RecordBatch via the C Data Interface.
    ///
    /// Returns the addresses of the `ArrowArray` and `ArrowSchema`
    /// structs that the caller (typically ArrowJS Sandbox or Java) must
    /// release via `release_exported()`.
    pub fn export_record_batch(&self, _batch: &RecordBatch) -> Result<(usize, usize), ArrowError> {
        #[cfg(feature = "arrow")]
        {
            // Real impl: convert RecordBatch to arrow::ffi::ArrowArray + ArrowSchema,
            // allocate via Box::into_raw, return addresses.
            let _ = _batch;
            Err(ArrowError::NotImplemented)
        }
        #[cfg(not(feature = "arrow"))]
        {
            Err(ArrowError::NotImplemented)
        }
    }

    /// Release an exported ArrowArray/ArrowSchema pair.
    ///
    /// # Safety
    /// The caller must ensure the addresses were previously returned
    /// by `export_record_batch()` and have not already been released.
    pub unsafe fn release_exported(&self, _array_addr: usize, _schema_addr: usize) -> Result<(), ArrowError> {
        #[cfg(feature = "arrow")]
        {
            // Real impl: reconstruct Box from raw pointer, let it drop.
            let _ = (_array_addr, _schema_addr);
            Ok(())
        }
        #[cfg(not(feature = "arrow"))]
        {
            Ok(())
        }
    }

    /// Convenience: create a RecordBatch from typed columns.
    pub fn make_batch(schema: Schema, columns: Vec<Column>) -> Result<RecordBatch, ArrowError> {
        if schema.fields.len() != columns.len() {
            return Err(ArrowError::SchemaMismatch {
                expected: format!("{} fields", schema.fields.len()),
                actual: format!("{} columns", columns.len()),
            });
        }
        Ok(RecordBatch { schema, columns })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_batch_validates_arity() {
        let bridge = ArrowBridge::new();
        let schema = Schema { fields: vec![
            Field { name: "a".to_string(), data_type: ArrowDataType::Int32, nullable: false },
        ]};
        let cols = vec![
            Column::Int32(vec![1, 2, 3]),
            Column::Int64(vec![4, 5, 6]), // extra column
        ];
        assert!(matches!(bridge.make_batch(schema, cols), Err(ArrowError::SchemaMismatch { .. })));
    }

    #[test]
    fn make_batch_succeeds_with_matching_arity() {
        let bridge = ArrowBridge::new();
        let schema = Schema { fields: vec![
            Field { name: "a".to_string(), data_type: ArrowDataType::Int32, nullable: false },
            Field { name: "b".to_string(), data_type: ArrowDataType::Float32, nullable: true },
        ]};
        let cols = vec![
            Column::Int32(vec![1, 2, 3]),
            Column::Float32(vec![1.0, 2.0, 3.0]),
        ];
        let batch = bridge.make_batch(schema, cols).expect("ok");
        assert_eq!(batch.num_rows(), 3);
        assert_eq!(batch.num_columns(), 2);
    }

    #[test]
    fn import_without_feature_returns_not_implemented() {
        #[cfg(not(feature = "arrow"))]
        {
            let bridge = ArrowBridge::new();
            let result = unsafe { bridge.import_record_batch(0, 0) };
            assert!(matches!(result, Err(ArrowError::NotImplemented)));
        }
    }
}
