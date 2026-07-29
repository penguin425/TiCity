# Changelog

All notable TiCity changes are documented here. The inherited PGSimCity
history remains available in Git before the TiCity derivation baseline
recorded in `NOTICE`.

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
