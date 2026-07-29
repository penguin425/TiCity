# TiCity contributor rules

## Accuracy boundary

TiCity is a deterministic educational model of TiDB v8.5 LTS. It is not a
TiDB emulator, SQL executor, optimizer, metrics endpoint, or live-cluster
client. UI copy and code must never present model values as measured values.
Every diagnostic projection must remain visibly labelled `MODEL / SIMULATED`.

Verify TiDB claims against current primary documentation before changing them.
Keep these distinctions explicit:

- transaction 2PC provides atomic commit across keys/Regions;
- Region Raft replicates each Region and establishes quorum;
- PD provides timestamps and scheduling metadata; SQL row data does not pass
  through PD;
- TiFlash is a learner replica and must not count toward TiKV voter quorum;
- 1PC and Async Commit are transaction commit optimizations, not Raft modes.

## Architecture

- `src/tidb/model/` is pure TypeScript and must never import `three`.
- `src/tidb/world/layout.ts` is the single source of truth for geography.
- `src/tidb/world/` and `src/tidb/engine/` read but never mutate
  `TiCityState`.
- UI, Machine, and Diagnose receive model snapshots or typed callbacks. They do
  not create competing simulation state.
- 2PC and Raft keep separate state transitions, trace domains, visual lanes,
  and semantic colours.
- With the same model version, seed, controls, fixed steps, and request, state
  and `TraceReceipt` must be identical.

## Privacy and input

The static application makes no analytics or live-cluster requests. Free-form
SQL is limited to one statement and 64 KiB, remains in memory, and is only
classified into a model route. Never persist it, transmit it, execute it, or
invent result rows. `ReplaySpec` must not contain SQL text or literals.

## Implementation

- TypeScript is strict. Prefer immutable projections and explicit public types.
- Avoid per-frame allocations in rendering loops; reuse Three.js temporaries.
- Dispose geometries, materials, listeners, audio nodes, and animation handles.
- Keep all visible and ARIA text in the Japanese/English catalog.
- Keyboard operation, reduced motion, colour-independent state, and readable
  focus rings are required.
- New model behavior needs deterministic invariant tests. Visible changes need
  a browser smoke check and screenshot review.
- Preserve Apache-2.0 headers and the upstream attribution in `NOTICE`.

Run before submitting:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```
