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
- The same immutable event snapshot across City, Machine, and Diagnose, with
  exact-event URLs and same-receipt looping
- Explicit separation of non-retryable deadlock, retryable statement deadlock,
  lock-wait timeout, transaction 2PC, and Region Raft
- Visible TiCity model-policy labels for cycle-closing victim selection and
  smallest-`start_ts` wake priority

## v0.6

- A model-4 Raft Failure Lab with one representative Region expanded across
  27 deterministic, immutable events
- A cached old-leader request, process-unreachable failure, TiDB-internal
  backoff and Region-cache invalidation, and same-logical-request recovery
- Three voter peers with explicit role, health, term, vote, log, commit, and
  apply state across separate Pre-Vote and Vote 2-of-3 quorums
- A configured 10–20 tick election window kept separate from the deterministic
  13-tick elapsed and candidate-selection TiCity model policies
- A current-term leader no-op persisted, committed, and leader-applied before
  route refresh and retry, with follower apply marked as background work
- PD limited to observing elected leader metadata and serving routing
  information, never choosing a candidate, voting, or electing a Region leader
- Exact-event City, Machine, and Diagnose projections over the same snapshot,
  with fixed-capacity, bilingual, accessible, and immutable-loop presentation
- Explicit boundaries for a read with no user-data entry, no application
  retry, no client-visible transient error, and no live timing guarantee

## v0.7

- A model-5 Protocol Lab that expands 1PC, Async Commit, and regular 2PC into
  one deterministic 74-event immutable comparison receipt
- Three independent representative optimistic transaction fixtures that
  compare protocol shape, not executions of the displayed SQL or latency
- Explicit feature eligibility, no runtime fallback, and pinned 256-key,
  4,096-byte, and two-second implementation-profile defaults labeled as
  non-stable, non-prescriptive values
- Exact timestamp provenance across PD `start_ts`/`latest_ts`, TiCity request
  bounds, TiKV `one_pc_commit_ts` and per-Region `min_commit_ts`, and regular
  2PC's post-prewrite PD `commit_ts`
- One-Region `TryOnePc` Prewrite, two-Region Async Commit prewrite and
  background resolution, and regular 2PC prewrite/primary/background-secondary
  paths with explicit client-response boundaries
- Nine independent per-Region Raft mutation chains, each showing propose,
  two-voter persistence, 2-of-3 commit, apply, and conceptual MVCC state
  without conflating transaction commit optimization with consensus
- Exact-event City, Machine, and Diagnose projections over the same snapshot,
  with fixed-capacity, bilingual, accessible, privacy-preserving, and
  immutable-loop presentation
- Four mechanism-level scenarios in total, with the remaining five scenarios
  explicitly retained as compact teaching traces

## v0.8 (in development; not released)

- A model-6 GC/Storage Lab that expands `gc-safe-point` into one deterministic
  43-event immutable receipt with two coordinator and storage rounds
- A first-round lifetime candidate capped exactly to global
  `minStartTS - 1` by an active transaction within the 86,400-second maximum
  wait, followed by a second round that advances after an explicit teaching
  boundary completes that blocker
- Separate service-safe-point selection, `mysql.tidb` status staging, Region
  ScanLock and ResolveLock outcome, saved visibility safe point plus the pinned
  100-second implementation cache barrier, Delete Ranges, and PD global
  publication
- A classic raftstore-v1 three-Store `UnsafeDestroyRange` fan-out that bypasses
  Region Raft, while ResolveLock's normal TiKV write-command Raft detail
  remains explicitly outside this slice
- Three asynchronous TiKV safe-point detections per round and the pinned
  v8.5.0 default Compaction Filter path instead of the legacy per-Region GC
  loop
- A counted-once logical MVCC board with retained Put anchors, one old
  Delete-chain example, long DEFAULT CF value cleanup, and no claim about
  physical bytes, SST layout, compaction timing, or Raft log GC
- Exact-event City, Machine, and Diagnose projections over the same deeply
  frozen snapshot, including a fixed-capacity 3D cutaway, a two-round semantic
  pipeline separate from the causal DAG, and mechanism-specific diagnostics
- Bilingual, accessible, responsive, reduced-motion, privacy-preserving,
  synthetic-only, non-benchmark documentation and regression gates
- Exact implementation provenance pinned to TiDB/TiKV v8.5.0, client-go, and
  PD source commits; later patch releases and raftstore-v2 remain separate
  profiles
- Five mechanism-level scenarios in the development tree, with the remaining
  four scenarios explicitly retained as compact teaching traces

## Deliberately outside the current offline model

- Connecting to or changing a live TiDB cluster
- Executing SQL, showing real `EXPLAIN`, returning rows, or querying metrics
- TiCDC, BR/PITR, placement across multiple geographic regions
- Resource Control and a complete optimizer or storage-engine emulator

Future work may add a read-only adapter for user-supplied exported diagnostics,
but only with a separate, unmistakable `OBSERVED` data provenance.
