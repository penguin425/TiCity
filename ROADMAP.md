# TiCity roadmap

## v0.2

- Deterministic offline model targeting TiDB v8.5 LTS
- 3D City, 2D Machine, and model Diagnose pages
- Eight scenarios covering reads, transactions, Raft, hotspots, GC, and HTAP
- Japanese and English UI
- GitHub Pages release with automated verification
- TiCity product, package, browser API, repository, and release identity

## v0.3

- Procedural sky, weather dressing, roads, skyline, and distinct district architecture
- Collision-aware world labels, adaptive night bloom, and a collapsible City control panel
- Layered Machine timeline with duration and causal flow
- Diagnose health summary, severity hierarchy, and compact visual telemetry
- Rendering, responsive-layout, accessibility, and social-preview gates

## v0.3.1

- Renderer-only teaching clock that keeps model timestamps unchanged
- Foreground Trace Dock with event progress and true pause/step/replay controls
- Directional route chevrons, endpoint rings, local-operation pulses, and background dimming
- Compact mobile and reduced-motion trace presentation

## v0.3.2

- PGSimCity-scale orbit zoom-out with coordinated camera, atmosphere, fog, and label LOD
- Same-receipt trace looping with a final-state hold and visible iteration state
- Independent Loop control with reduced-motion opt-in and bounded screen-reader announcements
- Five-control responsive Trace Dock across mobile and narrow panel-open layouts

## v0.3.3

- Pose-preserving Fly mode with full view-vector movement and stable Pointer Lock
- Collision-safe Walk entry, restored Orbit views, and complete TiKV/PD collision geometry
- Hold-to-move Fly and Walk controls across touch layouts
- Non-overlapping 44 px camera controls on short mobile viewports

## v0.3.4

- English-first repository documentation with a complete Japanese mirror
- Reciprocal language navigation and bilingual GitHub Release archives
- Documentation-only release with no simulation or runtime behavior changes

## v0.4

- A model-2 causal event graph with immutable post-event snapshots and typed deltas
- A mechanism-level two-Region pessimistic transaction vertical slice
- Parallel prewrite, independent per-Region Raft quorum/apply, conceptual MVCC state,
  primary response, and background secondary cleanup
- An Inspect-mode 3D Transaction Lab cutaway synchronized with the Trace Dock
- Causal fork/join rendering in Machine and shared selected-event URLs with Diagnose
- Bilingual, accessible, reduced-motion, fixed-capacity presentation and release gates

## v0.5

- A model-3 Lock Lab with explicit lock owners, wait queues, and wait-for edges
- Deterministic two-transaction deadlock detection and a visibly labeled model victim policy
- Error 1213, full victim rollback, survivor wake-up, and application-originated retry
- A fixed-capacity 3D contention cutaway and event-time Machine/Diagnose projections
- Explicit separation of non-retryable deadlock, retryable statement deadlock,
  lock-wait timeout, transaction 2PC, and Region Raft

## Deliberately outside the current offline model

- Connecting to or changing a live TiDB cluster
- Executing SQL, showing real `EXPLAIN`, returning rows, or querying metrics
- TiCDC, BR/PITR, placement across multiple geographic regions
- Resource Control and a complete optimizer or storage-engine emulator

Future work may add a read-only adapter for user-supplied exported diagnostics,
but only with a separate, unmistakable `OBSERVED` data provenance.
