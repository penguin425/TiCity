# TiCity

English | [日本語](README.ja.md)

**A deterministic 3D model of TiDB's distributed SQL architecture that you can walk through and inspect.**

TiCity is an independent Apache-2.0 educational project derived from
[PGSimCity](https://github.com/NikolayS/PGSimCity). It is an educational
scale model, not a TiDB emulator, an implementation of TiDB, TiKV, or TiFlash,
or a client connected to a live cluster. It is designed for understanding the
main processing boundaries and execution order. The interface defaults to
Japanese and can be switched to English.

Live site: <https://penguin425.github.io/TiCity/>

![TiCity Transaction Lab showing a two-Region pessimistic transaction at primary commit](docs/screenshot.png)

> [!IMPORTANT]
> TiCity v0.5.0 is a static, offline model targeting TiDB v8.5 LTS. It does not
> execute SQL or return real data or invented result rows. A single SQL
> statement entered by the user is classified entirely in the browser, and
> only a modeled route and explanation are generated.

## What you can inspect

- A Transaction Lab cutaway for one detailed two-Region pessimistic
  transaction, opened with **Inspect**
- Leader-memory pessimistic locks, parallel prewrite branches, independent
  2-of-3 Raft quorums, apply, and conceptual MVCC `LOCK`, `DEFAULT`, and
  `WRITE` column-family state
- A separate Lock Lab cutaway for two explicit pessimistic transactions and
  two opaque resources, with lock owners, wait queues, waiter-to-holder edges,
  a two-transaction cycle, full victim rollback, and application retry
- A cluster-wide deadlock detector leader on TiKV, with PD used only to locate
  that leader; deterministic victim and wake rules are visibly labeled
  **TiCity MODEL POLICY**, not TiDB guarantees
- A causal event graph with immutable post-event snapshots, explicit
  fork/join dependencies, a client-response boundary, and background
  secondary cleanup
- One immutable receipt projected across the 3D City, Machine, and Diagnose;
  the Lock Lab adds a separate semantic wait-for graph without turning its
  cycle into a causal dependency cycle
- Stable cross-view links that carry the scenario and selected event among all
  three views
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
| [`…/TiCity/?scenario=cross-region-transaction`](https://penguin425.github.io/TiCity/?scenario=cross-region-transaction) | 3D City and the scenario-selected detailed Lab |
| [`…/machine/?scenario=cross-region-transaction&event=trace-1-event-7`](https://penguin425.github.io/TiCity/machine/?scenario=cross-region-transaction&event=trace-1-event-7) | Causal event DAG and, for Lock Lab, the separate semantic wait-for graph |
| [`…/diagnose/?scenario=cross-region-transaction&event=trace-1-event-7`](https://penguin425.github.io/TiCity/diagnose/?scenario=cross-region-transaction&event=trace-1-event-7) | Event-time transaction, Raft, MVCC, lock-wait, deadlock, and retry diagnostics |

Choose **Inspect** in the 3D City to focus the cutaway. Replay controls move
through the same immutable receipt; looping reuses that receipt and never
re-executes a transaction.

Open the Lock Lab directly with the
[`lock-deadlock` scenario](https://penguin425.github.io/TiCity/?scenario=lock-deadlock).
Its classic non-retryable deadlock returns Error 1213, not the separate
lock-wait timeout Error 1205. The failed transaction is rolled back in full;
the application retry creates a new transaction ID and `start_ts` instead of
being presented as an internal TiDB retry.

![TiCity Lock Lab stopped at a two-transaction wait-for cycle](docs/lock-lab.png)

## Representative scenarios

1. Point reads and routing
2. A pessimistic transaction spanning multiple Regions
3. Pessimistic lock wait, deadlock, rollback, and application retry
4. An optimistic transaction conflict
5. A comparison of 1PC, Async Commit, and regular 2PC
6. A sequential-key hotspot and Region split
7. A TiKV failure and leader election
8. A long-running transaction and the GC safe point
9. TiFlash catch-up and MPP aggregation

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
- In the model-3 Lock Lab, wait-for edges run from waiter to current holder.
  The cycle-closing waiter is the deterministic model victim, and the smallest
  `start_ts` is the deterministic wake priority. Both are TiCity model
  policies, not claimed TiDB selection guarantees.
- The initial 36 Regions are representative educational values. Additional
  Regions created by splits appear in the 2D diagnostics, while the 3D City
  retains 36 stable Region slots. This does not reproduce the scale or timing
  of a live cluster.

Detailed mechanism-level projections currently apply to the cross-Region
transaction and Lock Lab scenarios. The former expands transaction 2PC,
per-Region Raft, and conceptual MVCC; the latter expands leader-memory lock
contention and deliberately hands off its commit path instead of duplicating
that pipeline. The other seven scenarios remain compact teaching traces and
do not yet claim the same mechanism depth.

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
