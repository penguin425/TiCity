# TiCity

English | [日本語](README.ja.md)

**A deterministic 3D model of TiDB's distributed SQL architecture that you can walk through and inspect.**

TiCity is an independent Apache-2.0 educational project derived from
[PGSimCity](https://github.com/NikolayS/PGSimCity). It is neither an
implementation of TiDB, TiKV, or TiFlash nor a client connected to a live
cluster. It is a scale model for understanding the main processing boundaries
and execution order. The interface defaults to Japanese and can be switched to
English.

Live site: <https://penguin425.github.io/TiCity/>

![TiCity Transaction Lab showing a two-Region pessimistic transaction at primary commit](docs/screenshot.png)

> [!IMPORTANT]
> TiCity v0.4.0 is a static, offline model targeting TiDB v8.5 LTS. It does not
> execute SQL or return real data or invented result rows. A single SQL
> statement entered by the user is classified entirely in the browser, and
> only a modeled route and explanation are generated.

## What you can inspect

- A Transaction Lab cutaway for one detailed two-Region pessimistic
  transaction, opened with **Inspect**
- Leader-memory pessimistic locks, parallel prewrite branches, independent
  2-of-3 Raft quorums, apply, and conceptual MVCC `LOCK`, `DEFAULT`, and
  `WRITE` column-family state
- A causal event graph with immutable post-event snapshots, explicit
  fork/join dependencies, a client-response boundary, and background
  secondary cleanup
- One immutable receipt projected across the 3D City, Machine, and Diagnose,
  with Machine and Diagnose sharing a selected scenario and event through
  stable URLs
- A default topology containing TiProxy, TiDB Server, PD, TiKV, and TiFlash
- PD TSO, Region ranges and Leaders, three voters, Raft replication, and quorum
- Pessimistic and optimistic transactions, prewrite and commit, 1PC, Async Commit, and 2PC
- Hotspots, Region splits, leader elections, GC safe points, TiFlash catch-up, and MPP
- Separate traces for transaction 2PC atomicity and per-Region Raft replication
- A day/night sky, roads, district signs, architectural lighting, Orbit overview, view-directed Fly, and collision-aware Walk
- Press-and-hold touch controls for Fly and Walk, including support for short smartphone screens
- An educational Trace Dock showing the current event, route, direction, step controls, and looping of the same trace
- An overview zoom that fits the whole city and district signs that simplify with distance

The application has three views:

| URL | Purpose |
|---|---|
| [`…/TiCity/?scenario=cross-region-transaction`](https://penguin425.github.io/TiCity/?scenario=cross-region-transaction) | 3D City and the detailed Transaction Lab |
| [`…/machine/?scenario=cross-region-transaction&event=trace-1-event-7`](https://penguin425.github.io/TiCity/machine/?scenario=cross-region-transaction&event=trace-1-event-7) | A causal 2D state machine with a shareable selected-event URL |
| [`…/diagnose/?scenario=cross-region-transaction&event=trace-1-event-7`](https://penguin425.github.io/TiCity/diagnose/?scenario=cross-region-transaction&event=trace-1-event-7) | Event-time transaction, Raft, lock, and MVCC diagnostics |

Choose **Inspect** in the 3D City to focus the cutaway. Replay controls move
through the same immutable receipt; looping reuses that receipt and never
re-executes a transaction.

## Representative scenarios

1. Point reads and routing
2. A pessimistic transaction spanning multiple Regions
3. An optimistic transaction conflict
4. A comparison of 1PC, Async Commit, and regular 2PC
5. A sequential-key hotspot and Region split
6. A TiKV failure and leader election
7. A long-running transaction and the GC safe point
8. TiFlash catch-up and MPP aggregation

## Local development

Node.js 24 or later and a WebGL2-capable browser are required.

```bash
npm install
npm run dev
```

Run verification and create a static production build:

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

The generated `dist/` directory is a self-contained static site. TiCity uses
no analytics services or cookies and makes no requests to external APIs or
live clusters. Free-form SQL remains in memory and is neither persisted nor
transmitted.

## Design boundaries

```text
src/tidb/
  model/      Deterministic simulation with no Three.js dependency
  world/      Read-only 3D geography, buildings, and flows
  engine/     Renderer, camera, collision, and audio
  ui/         Japanese/English UI, SQL classification UI, and tours
  machine/    2D state machine
  diagnose/   State diagnostics
```

- The model does not import Three.js.
- The 3D World does not mutate `TiCityState`.
- 2PC and Raft have separate state machines, colors, and `TraceEvent.domain` values.
- Given the same seed and fixed step, the state and `TraceReceipt` are identical.
- In the model-2 detailed transaction, parallel branches may overlap on the
  teaching clock, while explicit dependencies determine their causal order.
- The initial 36 Regions are representative educational values. Additional
  Regions created by splits appear in the 2D diagnostics, while the 3D City
  retains 36 stable Region slots. This does not reproduce the scale or timing
  of a live cluster.

The detailed mechanism-level projection currently applies to the
cross-Region transaction scenario. The other seven scenarios remain compact
teaching traces and do not yet claim the same Raft/MVCC depth.

The `window.TICITY` object in the browser console exposes the model, playback,
scenarios, and latest immutable trace for inspection and control.
The correspondence between visible claims and primary sources is recorded in
[Model Boundary](docs/MODEL_BOUNDARY.md).

## Origin and license

TiCity is a fork that preserves PGSimCity's history. The upstream baseline
commit and attribution for subsequent changes are recorded in [NOTICE](NOTICE).
The code is available under the same [Apache License 2.0](LICENSE).

Copyright 2026 Nikolay Samokhvalov<br>
TiCity changes Copyright 2026 TiCity contributors

Official TiDB, TiKV, TiFlash, and PingCAP logos or assets are not included.
TiCity is independent of PingCAP, Inc. and does not imply its endorsement or
sponsorship.
