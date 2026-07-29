# TiDB City roadmap

## v0.1

- Deterministic offline model targeting TiDB v8.5 LTS
- 3D City, 2D Machine, and model Diagnose pages
- Eight scenarios covering reads, transactions, Raft, hotspots, GC, and HTAP
- Japanese and English UI
- GitHub Pages release with automated verification

## Deliberately outside v0.1

- Connecting to or changing a live TiDB cluster
- Executing SQL, showing real `EXPLAIN`, returning rows, or querying metrics
- TiCDC, BR/PITR, placement across multiple geographic regions
- Resource Control and a complete optimizer or storage-engine emulator

Future work may add a read-only adapter for user-supplied exported diagnostics,
but only with a separate, unmistakable `OBSERVED` data provenance.
