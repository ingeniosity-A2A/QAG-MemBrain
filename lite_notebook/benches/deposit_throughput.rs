//! Benchmark: Lite Notebook deposit throughput.
//!
//! Measures how many Receipts/second the Lite Notebook can accept
//! through the deposit() → WAL → ring buffer path.

use criterion::{criterion_group, criterion_main, Criterion};
use lite_notebook::receipt::{Origin, Receipt, ReceiptKind};
use lite_notebook::notebook::LiteNotebook;

fn bench_deposit_throughput(c: &mut Criterion) {
    c.bench_function("deposit_64_receipts", |b| {
        b.iter_batched(
            || {
                let dir = tempfile::tempdir().unwrap();
                LiteNotebook::open(
                    &dir.path().join("bench.wal"),
                    16,
                ).unwrap()
            },
            |(nb, _rx)| {
                for i in 0..64 {
                    let r = Receipt::new(
                        format!("s{i}").into(),
                        Origin::User,
                        ReceiptKind::Perception,
                        format!("bench content {i}").into(),
                        None,
                    );
                    let _ = nb.deposit(r);
                }
            },
            criterion::BatchSize::SmallInput,
        );
    });
}

criterion_group!(benches, bench_deposit_throughput);
criterion_main!(benches);
