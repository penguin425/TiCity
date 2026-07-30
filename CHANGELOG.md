# Changelog

All notable TiCity changes are documented here. The inherited PGSimCity
history remains available in Git before the TiCity derivation baseline
recorded in `NOTICE`.

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
