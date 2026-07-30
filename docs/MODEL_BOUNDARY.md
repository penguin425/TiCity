# TiCity model boundary

TiCity model-3 targets **TiDB v8.5 LTS**. This document records which visible
claims are architectural, which values are deliberately representative, and
which capabilities are not implemented. TiCity is a deterministic educational
model, not a TiDB emulator or a live-cluster observation tool.

## Claims represented directly

| Visible claim | Model invariant | Primary reference |
|---|---|---|
| TiDB Server is stateless SQL compute and sends storage requests to TiKV or TiFlash | TiDB nodes own no Region data; data paths terminate at a storage node | [TiDB architecture](https://docs.pingcap.com/tidb/v8.5/tidb-architecture) |
| PD owns cluster metadata, scheduling, and transaction timestamps | PD appears only on control/TSO paths, never on the row-data route | [TiDB architecture](https://docs.pingcap.com/tidb/v8.5/tidb-architecture) |
| A Region covers a left-closed, right-open key range and normally has three replicas | Region ranges are contiguous; every Region has exactly three voter peers | [TiDB architecture](https://docs.pingcap.com/tidb/v8.5/tidb-architecture) |
| TiDB supports pessimistic and optimistic distributed transactions | Both modes have separate scenario paths and conflict behavior | [Transactions](https://docs.pingcap.com/tidb/v8.5/transaction-overview) |
| In-memory pessimistic locks normally remain on the Region leader instead of being persisted or replicated through Raft | The detailed cross-Region scenario records leader-memory lock ownership and proves that acquisition does not advance any Raft index; prewrite later replaces it with a durable lock-CF entry | [Pessimistic transactions](https://docs.pingcap.com/tidb/v8.5/pessimistic-transaction) |
| Lock View represents a blocked pessimistic transaction and its current lock holder | Lock Lab edges point from waiter to holder and use only opaque synthetic resource IDs | [DATA_LOCK_WAITS](https://docs.pingcap.com/tidb/v8.5/information-schema-data-lock-waits) |
| A pessimistic deadlock is a cycle of transactions waiting for one another; a non-retryable deadlock terminates one transaction and returns Error 1213 | Lock Lab detects a two-edge cycle, rolls back its visibly labeled deterministic model victim, removes that victim's locks and edges, and wakes the survivor | [Pessimistic transactions](https://docs.pingcap.com/tidb/v8.5/pessimistic-transaction), [deadlock troubleshooting](https://docs.pingcap.com/tidb/v8.5/troubleshoot-lock-conflicts) |
| TiKV uses a cluster-wide deadlock-detector leader and consults PD to locate it | The detector is shown on the TiKV side; PD participates only in detector-leader lookup and never becomes the detector | [TiKV v8.5 detector implementation](https://github.com/tikv/tikv/blob/v8.5.0/src/server/lock_manager/deadlock.rs#L611-L723) |
| Optimistic distributed transactions use 2PC | Prewrite precedes commit; a modeled conflict moves the transaction to `rolled_back` without claiming a per-key lock inventory | [Optimistic transaction model](https://docs.pingcap.com/tidb/v8.5/optimistic-transaction) |
| 1PC and Async Commit are transaction optimizations | They alter transaction events but never change Region Raft quorum. Async Commit returns after successful prewrite and shows commit-record resolution as background work; it has no normal Get-commit-ts/Commit phase on the client path | [Latency breakdown](https://docs.pingcap.com/tidb/v8.5/latency-breakdown) |
| Follower Read can offload a Region leader | Read policy changes the selected peer without weakening the model snapshot | [Follower Read](https://docs.pingcap.com/tidb/v8.5/follower-read) |
| TiFlash is an asynchronously replicated Raft learner for HTAP | It never counts toward TiKV voter quorum and has visible catch-up lag | [TiFlash overview](https://docs.pingcap.com/tidb/v8.5/tiflash-overview) |
| Raft Engine stores Raft logs by default in this target line | The TiKV inspector names Raft Engine, not the older RaftDB default | [TiKV configuration](https://docs.pingcap.com/tidb/v8.5/tikv-configuration-file) |
| Active transaction `start_ts` can hold the GC safe point, subject to `tidb_gc_max_wait_time` | The GC scenario shows a short-horizon blocker and names the 86,400-second default; it does not fast-forward the teaching clock by a day | [GC configuration](https://docs.pingcap.com/tidb/v8.5/garbage-collection-configuration) |

## Representative values

The default topology—2 TiProxy, 3 TiDB, 3 PD, 3 TiKV, 1 TiFlash, and 36
Regions—is sized for a legible city. Event durations, QPS, Region sizes,
hot scores, GC backlog, and TiFlash lag are teaching-clock values. They are
deterministic consequences of controls and scenarios, not benchmarks,
recommendations, SLOs, or measurements from a TiDB cluster.

One rendered Region tile on each TiKV store is a peer of the same logical
Region. Three tiles with the same Region ID are not three independent Regions.
The city has 36 stable visual Region slots. A hotspot split can add a 37th
logical Region to the model and 2D inspectors; the original upper-range Region
remains projected in the fixed 3D slot.

The demo schema gives a TiFlash replica only to `events`. Its analytical example
is deliberately routed to MPP so the path can be taught. Real TiDB requires a
table-level replica and lets the cost-based optimizer choose TiKV, TiFlash, or
both; an aggregate is not automatically a TiFlash query.

The model treats its accepted single-row, primary-key-constrained mutation as
small enough for Async Commit when that mode is enabled. Real eligibility also
depends on feature settings, mutation/key size limits, timestamp bounds, and
other runtime conditions—not simply on the number of Regions.

## Detailed mechanism traces

The model-2 `cross-region-transaction` scenario is the first mechanism-level
vertical slice. It uses two representative Regions with different leaders and
publishes an immutable causal event graph. Both prewrite branches begin from the
same coordinator event and independently proceed through Raft propose, two-voter
persistence, 2-of-3 quorum, apply, and conceptual MVCC state. `commit_ts` is
allocated only after both branches join. The primary commit gates the modeled
client response; secondary commit and lock cleanup are explicitly marked as
background work after that response.

Every event in this detailed receipt has a post-event projection and typed
deltas for the transaction, Region voter indexes, leader-memory lock, and
conceptual `default`, `lock`, and `write` column-family state. These projections
are presentation contracts, not byte-accurate RocksDB snapshots. They contain no
SQL text, literals, keys, values, result rows, or live-cluster observations.

The model-3 `lock-deadlock` scenario is a separate concurrency-control vertical
slice. Two explicit pessimistic transactions acquire two opaque resources in
opposite order. Each wait adds a waiter-to-holder edge; the second edge closes
the modeled cycle. The cycle-closing waiter is selected as the victim by a
deterministic **TiCity model policy**, not by a claimed TiDB victim-selection
guarantee. The non-retryable victim receives Error 1213 and is fully rolled
back. Only after its leader-memory locks and wait edges are removed can the
survivor wake and continue.

If a released resource has multiple eligible waiters, Lock Lab selects the
smallest `start_ts` as its deterministic wake priority. Like the
cycle-closing-waiter victim rule, this is a visibly labeled **TiCity model
policy**, not a TiDB selection guarantee. The current two-transaction teaching
trace has one waiter per resource, but the invariant is explicit so future
traces cannot silently imply a different rule.

The retry branch begins at an explicit application boundary after Error 1213.
It creates a new transaction ID and `start_ts`; it is not presented as TiDB
automatically retrying the failed transaction. TiDB's retryable
single-statement deadlock path, which rolls back statement changes and can
retry internally, is deliberately not combined with this scenario. Lock-wait
timeout (Error 1205) is also a different path and is not simulated here.
[DEADLOCKS](https://docs.pingcap.com/tidb/v8.5/information-schema-deadlocks)
records that distinction.

Lock Lab's commit handoff intentionally collapses the transaction 2PC/Raft/MVCC
sequence already expanded by `cross-region-transaction`. Lock ownership, queue,
deadlock, rollback, and application-retry events never advance Region Raft
indexes. Their event-time projections contain no SQL text, literal, real key,
value, result row, digest, or live-cluster observation.

Every Lock Lab event publishes a deeply frozen post-event snapshot. The 3D
City cutaway, semantic inspector, Machine, and Diagnose read that same snapshot
rather than reconstructing independent state. Exact-event navigation and
looping move a cursor over the same immutable `TraceReceipt`; they do not
re-run the transactions or create a new detector outcome.

The other seven scenarios retain compact teaching traces in this model
revision. They use the same causal dependency field but do not yet claim the
detailed concurrency-control or Raft/MVCC projection depth of these two
vertical slices.

## SQL boundary

The workbench accepts at most one 64 KiB statement. A conservative lexer
recognizes only a small educational subset: point/range reads, aggregates,
single-row INSERT with an explicit known primary key, primary-key-constrained
UPDATE/DELETE, and non-ANALYZE EXPLAIN around those forms. `EXPLAIN ANALYZE` is
rejected because a real TiDB server executes it. Classification yields a
deep-frozen `ModelPlanNode` and `TraceReceipt`; it does not parse with TiDB,
execute, optimize, contact a cluster, persist SQL literals, or return rows.

## Provenance labels

- `MODEL / SIMULATED`: generated entirely by TiCity.
- `REFERENCE`: a link or command that a person could use on a real cluster.
- `OBSERVED`: reserved for a future read-only adapter and not used in v0.5.x.
