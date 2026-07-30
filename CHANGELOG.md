# Changelog

All notable TiCity changes are documented here. The inherited PGSimCity
history remains available in Git before the TiCity derivation baseline
recorded in `NOTICE`.

## [0.9.0] — 2026-07-31

- Complete the model-7 TiFlash/MPP Lab vertical slice across exact-event City,
  Machine, and Diagnose, with every surface reading the same selected snapshot
  from one deterministic 56-event immutable receipt.
- Replace query-driven node-global `resolved_ts` catch-up with per-Region
  safe-ts or ReadIndex/applied-index gates and keep persistent learner
  replication separate from ephemeral MPP Exchange data.
- Keep `AVAILABLE`/`PROGRESS` provisioning separate from snapshot readiness
  and present one scheduled learner replica per selected query Region rather
  than claiming a complete table or Store replica inventory.
- Pin the TiDB, TiKV, TiFlash, TiFlash proxy, client-go, and PD v8.5.0 source
  profile while labeling topology, indexes, counts, timing, optimizer choice,
  and the successful no-retry/no-fallback path as synthetic teaching fixtures.
- Include bilingual release documentation and the TiFlash/MPP Lab screenshot
  in the release archive, with deterministic, accessibility, responsive,
  fixed-capacity, reduced-motion, privacy, source-provenance, and
  production-build gates.

## [0.9.0-beta.1] — 2026-07-31

- Extend Machine with a persistent learner-replication rail and a separate
  fragment/task/Exchange semantic graph without replacing its causal event
  DAG.
- Extend Diagnose with exact-event learner replication, per-Region read gates,
  four TiFlash tasks, six Exchange tunnels, and the distinct TiDB root stream.
- Preserve the selected `scenario` and exact `event` among City, Machine, and
  Diagnose for all 56 snapshots, including each learner catch-up branch and
  client-streaming stage.
- Add browser coverage for the shared snapshot, immutable looping, bilingual
  accessibility, privacy, responsive layouts, fixed capacities, and the
  replication-versus-Exchange boundary.
- Keep the successful baseline at zero retries and no fallback while
  documenting wait-index, Region/storage reconstruction, Exchange connection,
  dispatch/root-stream, and configured query-level fallback as different
  failure boundaries.

## [0.9.0-alpha.2] — 2026-07-31

- Add a fixed-capacity 3D TiFlash/MPP Lab cutaway with two scenario-local
  TiFlash Stores, three selected-query learner projections, four tasks, and
  six tunnels.
- Project each immutable snapshot into an accessible bilingual City inspector
  with per-Region safe-ts, ReadIndex, apply, DeltaMerge, task, tunnel, result,
  retry, and fallback state synchronized to the Trace Dock.
- Keep persistent learner replication and ephemeral MPP Exchange on separate
  visual rails, with Regions, fragments, tasks, and the TiDB root represented
  as distinct concepts.
- Reuse the same immutable 56-event receipt during playback and looping
  without reapplying learner commands, allocating another query TSO,
  reconstructing tasks, or rerunning the aggregate.

## [0.9.0-alpha.1] — 2026-07-31

- Introduce the model-7 `tiflash-mpp` mechanism slice with 56 deeply frozen
  exact-event snapshots and nonempty typed deltas. The receipt begins with a
  fixed steady-state learner backlog and completes one successful two-stage
  MPP aggregate.
- Replace the old query-driven node-global `resolved_ts` catch-up shortcut in
  this scenario with per-Region `self_safe_ts` and
  ReadIndex-to-learner-applied-index gates; a Region either passes the safe-ts
  fast path or waits for the exact required applied index, never returns a
  stale teaching result.
- Keep TiKV Region commit, proxy learner-command delivery, TiFlash apply,
  committed DeltaMerge write, and learner applied-index notification on a
  persistent replication plane distinct from ephemeral MPP Exchange blocks.
- Use a scenario-local two-TiFlash-Store fixture with one learner projection
  for each of three selected query Regions, two fragments, four tasks, four
  all-to-all HashPartition tunnels, and two PassThrough root streams. The
  projection is not a complete table or Store replica inventory and does not
  equate Regions, fragments, or tasks.
- Keep the successful baseline at `retryCount=0` and
  `fallbackToTiKV=false`; document terminal wait-index timeout, bounded
  Region/storage reconstruction, pre-data Exchange connection retry,
  non-independent dispatch/root-stream retry, and configured query-level
  fallback before client-visible output as distinct failure boundaries.
- Pin TiDB, TiKV, TiFlash, TiFlash proxy, client-go, and PD implementation
  commits and retain only synthetic tokens, indexes, enum state, and bucketed
  counts.

## [0.8.0] — 2026-07-31

- Complete the model-6 GC/Storage Lab vertical slice across exact-event City,
  Machine, and Diagnose, with every surface reading the same selected snapshot
  from one deterministic 43-event, two-round immutable receipt.
- Keep candidate calculation, `minStartTS - 1`, service-safe-point selection,
  `mysql.tidb` staging, Region ScanLock, saved visibility and its pinned
  100-second cache barrier, Delete Ranges, PD global publication, asynchronous
  Store detection, and Compaction Filter as separate mechanism boundaries.
- Pin implementation claims to exact TiDB/TiKV v8.5.0, client-go, and PD source
  commits while labeling synthetic timestamps, counts, bottommost-compaction
  placement, and durations as non-benchmark teaching fixtures.
- Include bilingual release documentation and the GC/Storage Lab screenshot in
  the release archive, with deterministic, accessibility, responsive,
  fixed-capacity, reduced-motion, privacy, source-provenance, and
  production-build gates.

## [0.8.0-beta.1] — 2026-07-31

- Extend Machine with a two-round semantic GC pipeline kept separate from its
  causal DAG, plus exact safe-point, ResolveLock, Delete Range, Store filter,
  retained-anchor, Delete-chain, and DEFAULT CF cleanup state.
- Extend Diagnose with exact-event candidate, active-transaction and service
  bounds, all three safe-point storage boundaries, ResolveLock outcomes,
  Delete Range state, Store detection/filter state, and logical MVCC
  retention/cleanup projections.
- Preserve the selected `scenario` and exact `event` among City, Machine, and
  Diagnose for all 43 snapshots, including each parallel Store branch and
  both Compaction Filter rounds.
- Add browser coverage for the shared snapshot, causal fork/join structure,
  immutable looping, bilingual accessibility, privacy, responsive layouts,
  fixed resource capacity, and cross-view mechanism boundaries.
- Keep ResolveLock's internal Raft detail outside this bounded slice, classic
  raftstore-v1 `UnsafeDestroyRange` explicitly no-Raft, and Compaction Filter
  distinct from Raft log GC.

## [0.8.0-alpha.2] — 2026-07-31

- Add a fixed-capacity 3D GC/Storage Lab cutaway and accessible bilingual DOM
  inspector synchronized with the City Trace Dock and exact selected event.
- Project the coordinator gate, two-round state, three distinct safe-point
  values, Region ScanLock/lock outcomes, classic Delete Range fan-out, three
  Store detectors/filters, and four logical MVCC chains without retaining key
  material.
- Reuse the same immutable 43-event receipt during playback and looping
  without rerunning GC, recomputing a candidate, advancing PD, or changing
  filter results.

## [0.8.0-alpha.1] — 2026-07-31

- Introduce the model-6 `gc-safe-point` vertical slice with 43 deeply frozen
  exact-event snapshots and typed deltas across two deterministic GC/storage
  rounds.
- Cap round 1 to global `minStartTS - 1` without killing the within-max-wait
  teaching blocker, then advance round 2 only after an explicit fixture
  boundary completes that blocker.
- Model service-point selection, `mysql.tidb` staging, Region ScanLock and
  commit/rollback ResolveLock outcomes, saved visibility plus the pinned
  100-second cache barrier, one classic raftstore-v1
  `UnsafeDestroyRange` fan-out, PD publication, and asynchronous TiKV
  detection.
- Pin the v8.5.0 default Compaction Filter path with logical chains counted
  once, retained Put anchors, old Delete-chain removal, long DEFAULT CF value
  cleanup, zero modeled compaction Raft entries, and no SQL text, real or
  encoded keys, values, rows, or live observations.

## [0.7.0] — 2026-07-31

- Complete the model-5 Protocol Lab vertical slice across exact-event City,
  Machine, and Diagnose views, with every surface reading the same selected
  snapshot from one deterministic 74-event immutable receipt.
- Compare one-Region 1PC, two-Region Async Commit, and regular 2PC using three
  independent representative optimistic fixtures rather than executions of
  the displayed SQL or a latency benchmark.
- Keep eligibility, timestamp authority, client-response/background cleanup,
  conceptual MVCC, and nine independent per-Region Raft mutation chains
  explicit without presenting transaction commit optimizations as Raft modes.
- Separate declared fixture outcomes from exact-event temporal state and use a
  non-causal presentation fence so independent sibling Region branches remain
  visually monotonic during deterministic replay.
- Add bilingual release documentation and the Protocol Lab screenshot to the
  release archive, with deterministic, accessibility, responsive,
  fixed-capacity, privacy, source-provenance, and production-build gates.

## [0.7.0-beta.1] — 2026-07-31

- Extend Machine with the three protocol lanes, their exact causal
  fork/join/background paths, timestamp authorities, eligibility outcomes,
  client boundaries, and separate per-Region Raft/MVCC state.
- Extend Diagnose with exact-event 1PC, Async Commit, and regular 2PC
  projections, including feature flags, aggregate fixture limits, commit
  timestamp sources, outstanding locks, and background-completion state.
- Preserve the selected `scenario` and exact `event` among City, Machine, and
  Diagnose for all 74 snapshots, including each client response and
  post-response commit-record cleanup.
- Add responsive, accessibility, privacy, event-cursor, deterministic DAG,
  immutable-loop, and transaction-versus-Raft boundary regression coverage.

## [0.7.0-alpha.2] — 2026-07-31

- Add a fixed-capacity 3D Protocol Lab cutaway with three distinct protocol
  lanes, two Region slots per lane, three voters per Region, conceptual MVCC
  cells, timestamp signals, client boundaries, and background paths.
- Project each immutable Protocol Lab snapshot into an accessible bilingual
  DOM inspector with exact eligibility, timestamp provenance, Raft quorum,
  MVCC, client-response, and cleanup state synchronized to the Trace Dock.
- Keep Transaction, Lock, Raft Failure, and Protocol Labs mutually exclusive
  while sharing Inspect focus, theme, reduced-motion, replay, looping,
  responsive layout, and disposal lifecycle.
- Reuse the same immutable receipt during playback and looping without
  rerunning a fixture, changing its selected protocol, or allocating another
  timestamp.

## [0.7.0-alpha.1] — 2026-07-31

- Introduce the model-5 `commit-protocols` vertical slice with 74 immutable
  events across three independent representative optimistic transactions.
- Model a one-Region `TryOnePc` Prewrite returning TiKV
  `one_pc_commit_ts`, two-Region Async Commit deriving `commit_ts` from the
  maximum TiKV-returned `min_commit_ts`, and regular 2PC obtaining PD
  `commit_ts` after all prewrites.
- Pin Async Commit eligibility fixtures to the target client's 256-key and
  4,096-byte implementation defaults while labeling them as non-stable,
  non-prescriptive values; model no runtime fallback.
- Put all nine TiKV mutations behind independent four-step Region Raft chains,
  place client/background boundaries per protocol, deep-freeze every snapshot
  and delta, and retain no SQL text, literal, real key, secondary-key list,
  value, or result row.

## [0.6.0] — 2026-07-31

- Complete the model-4 Raft Failure Lab vertical slice across exact-event
  City, Machine, and Diagnose views, with every surface reading the same
  selected snapshot from one 27-event immutable receipt.
- Keep the cached old-leader attempt, process-unreachable failure, TiDB
  backoff/cache invalidation, Pre-Vote, Vote, leader confirmation, PD
  observation/routing, same-logical-request retry, and background follower
  apply boundaries explicit.
- Document and visibly label the deterministic 13-tick elapsed and candidate
  selection as TiCity model policies within the configured 10–20 tick window,
  not live timing or TiDB winner guarantees.
- Add the bilingual release documentation and Raft Lab screenshot to the
  release archive, with deterministic, accessibility, responsive,
  fixed-capacity, privacy, and production-build gates.

## [0.6.0-beta.1] — 2026-07-31

- Extend Machine with a separate Pre-Vote/Vote semantic graph and peer
  role, health, term, vote, log, commit, apply, policy, PD, and retry state
  without turning election messages into causal dependencies.
- Extend Diagnose with exact-event failure, election, leader-confirmation,
  routing, retry, severity, and completion projections.
- Preserve the selected `scenario` and exact `event` among City, Machine, and
  Diagnose for all 27 snapshots, including the client response and background
  follower apply.
- Keep PD observer/routing-only and the same logical Region request's
  TiDB-internal retry distinct from application retry and client-visible error.

## [0.6.0-alpha.2] — 2026-07-31

- Add a fixed-capacity 3D Raft Failure Lab cutaway and accessible bilingual DOM
  inspector synchronized with the City Trace Dock and exact selected event.
- Project three peers with role, health, term, vote, log, commit, and apply
  state; distinguish failure, Pre-Vote, Vote, no-op, PD, routing, and retry
  phases with redundant shape and text cues.
- Keep Transaction, Lock, and Raft Labs mutually exclusive while sharing the
  authored cutaway location, Inspect focus, theme, reduced-motion, replay,
  looping, responsive layout, and disposal lifecycle.
- Reuse the same immutable 27-event receipt without re-running the request or
  producing a different election outcome when playback loops.

## [0.6.0-alpha.1] — 2026-07-31

- Introduce the model-4 `tikv-failover` vertical slice with 27 immutable
  events spanning a cached old-leader request, TiKV process loss,
  TiDB-internal backoff/cache invalidation, election, route refresh, and
  recovery of the same logical point read.
- Model a configured 10–20 tick election window, deterministic 13-tick
  elapsed/candidate policy, separate Pre-Vote and Vote 2-of-3 quorums, and a
  new leader current-term no-op that is persisted, committed, and applied
  before serving.
- Keep PD limited to observing elected leader metadata and serving routing
  information; it does not select a candidate, grant votes, or elect a leader.
- Record no SQL text, key, value, or result row; the read creates no user-data
  Raft entry, the retry is internal rather than application-originated, and
  no transient failure is client-visible in this deterministic trace.

## [0.5.0] — 2026-07-31

- Complete the Lock Lab vertical slice across City, Machine, and Diagnose,
  with every surface reading the same immutable event-time model snapshots.
- Teach a non-retryable pessimistic deadlock without conflating it with
  lock-wait timeout Error 1205, retryable single-statement deadlocks,
  transaction 2PC, or Region Raft.
- Keep exact-event URLs, same-receipt looping, bilingual accessibility,
  reduced-motion behavior, privacy boundaries, and fixed-capacity rendering
  under deterministic unit, browser, and production-build gates.
- Document the TiKV detector-leader and PD lookup boundary and label the
  deterministic cycle-closing victim and smallest-`start_ts` wake rules as
  TiCity model policies rather than TiDB guarantees.

## [0.5.0-beta.1] — 2026-07-31

- Extend Machine with the Lock Lab event-time state and a cyclic semantic
  waiter-to-holder graph kept separate from its acyclic causal event DAG.
- Extend Diagnose with separate active lock-wait, retained deadlock-history,
  and application-retry projections, including detector scope, Error 1213,
  whole-transaction rollback, and the new retry transaction.
- Preserve the selected `scenario` and exact `event` when navigating among
  City, Machine, and Diagnose, including parallel causal siblings.
- Add responsive, accessibility, privacy, event-cursor, and immutable-loop
  regression coverage for the new vertical slice.

## [0.5.0-alpha.2] — 2026-07-31

- Add a fixed-capacity 3D Lock Lab cutaway with three transaction slots for
  the two original transactions and the retry, two opaque resources,
  lock-owner and wait-queue state, directed wait edges, detector state,
  deadlock history, rollback, survivor wake-up, and retry.
- Project each immutable Lock Lab snapshot into an accessible bilingual DOM
  inspector synchronized with the City Trace Dock and exact selected event.
- Keep Transaction Lab and Lock Lab mutually exclusive while sharing the same
  authored cutaway location, Inspect focus, theme, reduced-motion, replay,
  looping, and disposal lifecycle.
- Show resource identity without keys or values and visibly distinguish
  TiCity victim/wake model policies from TiDB behavior guarantees.

## [0.5.0-alpha.1] — 2026-07-31

- Introduce the model-3 `lock-deadlock` scenario with two explicit
  pessimistic transactions, two synthetic lock resources, immutable wait
  queues, and waiter-to-holder wait-for edges.
- Model a classic non-retryable two-transaction cycle, a TiKV-side detector
  handoff, a visibly labeled deterministic TiCity victim policy, Error 1213,
  full victim rollback, survivor wake-up, and an application-originated retry
  with a new transaction ID and `start_ts`.
- Keep leader-memory lock, wait, rollback, and retry operations separate from
  Region Raft indexes and use an explicit handoff for the already-documented
  transaction commit pipeline.
- Deep-freeze every Lock Lab projection and typed delta, retain no SQL text,
  literal, real key, or value, and distinguish whole-transaction application
  retry from TiDB's retryable statement-deadlock path and lock-wait timeout.

## [0.4.0] — 2026-07-31

- Complete the first Transaction Lab vertical slice: one deterministic
  two-Region pessimistic transaction can be inspected from coordinator
  routing through parallel prewrite, per-Region Raft quorum/apply, conceptual
  MVCC state, primary response, and background secondary cleanup.
- Keep the 3D cutaway and Trace Dock synchronized to City playback, and let
  Machine and Diagnose share a stable selected-event URL.
- Add bilingual and accessible Inspect controls, shareable event URLs,
  fixed-capacity rendering, reduced-motion behavior, release documentation,
  and a current Transaction Lab screenshot.
- Preserve compact traces for the other seven scenarios and explicitly bound
  their current level of detail.

## [0.4.0-beta.1] — 2026-07-31

- Make Machine draw explicit causal fork/join edges instead of inventing a
  serial predecessor chain, with dashed background-cleanup paths.
- Let Machine and Diagnose share a stable `scenario` + `event` URL cursor.
- Project event-time transaction, Raft, leader-memory lock, and MVCC state in
  Diagnose while retaining the final-state view.
- Add browser coverage for the detailed cutaway, dynamic event counts, shared
  event URLs, transport controls, accessibility, and immutable looping.

## [0.4.0-alpha.2] — 2026-07-31

- Add an Inspect-mode Transaction Lab cutaway with a TiDB coordinator,
  two mutation slots, PD timestamp pulse, two Regions with three voters each,
  Raft quorum/apply indicators, leader-memory locks, and conceptual
  `LOCK`/`DEFAULT`/`WRITE` MVCC cells.
- Project the same immutable event snapshot into the 3D cutaway and an
  accessible bilingual DOM inspector, including shape-based primary/secondary
  markers and reduced-motion behavior.
- Keep the cutaway fixed-capacity and resource-stable across repeated updates,
  theme changes, replay, and disposal.

## [0.4.0-alpha.1] — 2026-07-31

- Introduce the model-2 causal event graph with immutable post-event snapshots
  and typed state deltas.
- Model a two-Region pessimistic 2PC transaction with different Region
  leaders, leader-memory pessimistic locks, parallel prewrite branches,
  independent 2-of-3 Raft quorum/apply paths, conceptual MVCC column families,
  and background secondary cleanup after the client response.
- Preserve overlapping causal branches on the renderer teaching clock and
  expose stable active/completed event IDs without re-executing a receipt.
- Document and test the TiDB v8.5 model boundary, deterministic DAG,
  transaction/Raft separation, immutable projections, and privacy invariants.

## [0.3.4] — 2026-07-30

- Make English the default GitHub project README while preserving the complete
  Japanese documentation as `README.ja.md` with reciprocal language links.
- Include both language versions and their linked screenshot and model boundary
  document in GitHub Release archives.
- Keep the TiDB model and application behavior unchanged.

## [0.3.3] — 2026-07-30

- Keep the current pose when entering Fly, move along the full view vector,
  reset stuck input on blur, and restore the last Orbit view on return.
- Start Walk from a collision-free street with a level view, add the missing
  TiKV and PD collision geometry, and hide overview labels at pedestrian height.
- Add responsive hold-to-move controls for Fly and Walk on touch layouts,
  including Fly altitude controls and bilingual accessible labels.

## [0.3.2] — 2026-07-30

- Expand the orbit overview from a nearly fixed 620-unit ceiling to a
  PGSimCity-scale 1,650-unit range, with matching camera, fog, and
  camera-following atmosphere limits.
- Fade overview labels at long distance so the complete topology remains
  readable instead of becoming a stack of fixed-size signs.
- Loop the same immutable `TraceReceipt` after a readable final-state hold,
  with an explicit Loop toggle, iteration state, pause/resume support, and no
  model or transaction re-execution.
- Keep looping opt-in for reduced-motion users, suppress repeated live-region
  narration, and preserve usable controls from 320 px mobile layouts through
  narrow panel-open desktop layouts.

## [0.3.1] — 2026-07-29

- Replace sub-second overlapping City traffic with a renderer-only teaching
  clock that preserves the original deterministic `TraceReceipt` timestamps.
- Add a persistent Trace Dock with the current event, source and target,
  event rail, progress, pause, previous/next step, and replay controls.
- Highlight the active route with moving directional chevrons, a larger data
  pod, source/target rings, local-operation pulses, and dimmed background links.
- Keep the causal route readable on mobile and with reduced-motion preferences,
  with regression gates for timing, controls, accessibility, and render budgets.

## [0.3.0] — 2026-07-29

- Rebuild the 3D City presentation with a procedural sky, clouds, stars,
  finite ground plate, road grid, street furniture, skyline, district pulses,
  and persistent collision-aware labels.
- Give TiProxy, TiDB, PD, TiKV, GC, and TiFlash distinct layered architecture,
  facade details, semantic lighting, and clearer daytime and night-time themes.
- Add adaptive desktop bloom, capped pixel ratios, reduced night shadow cost,
  a collapsible control panel, and guarded scene-rendering budgets.
- Enrich Machine with a temporal execution rail and Diagnose with compact
  model-health telemetry while preserving responsive and accessible layouts.
- Add a current product screenshot and social-preview image.

## [0.2.0] — 2026-07-29

- Rename the project from TiDB City to TiCity.
- Move the package, browser API, storage keys, Pages URL, repository URL,
  release tag namespace, and archive names to the TiCity identity.

## [0.1.0] — 2026-07-29

- Fork PGSimCity under Apache-2.0 and introduce the initial TiDB City release.
- Replace the PostgreSQL model with a deterministic TiDB v8.5 LTS topology.
- Separate transaction 2PC, Region Raft, KV apply, and TiFlash learner traces.
- Add eight guided scenarios and conservative, non-executing SQL classification.
- Add immersive 3D City, 2D Machine, and model-only Diagnose surfaces.
- Add Japanese-first and English interfaces with an explicit accuracy boundary.
- Remove PGlite, analytics, and all runtime network requests.
- Add deterministic, browser, accessibility, license, and static build checks.
