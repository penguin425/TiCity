# TiCity model boundary

The unreleased TiCity model-6 development tree targets the **TiDB v8.5 LTS**
line and pins mechanism details to TiDB v8.5.0 source commit
`d13e52ed6e22cc5789bed7c64c861578cd2ed55b`, TiKV v8.5.0 source commit
`a2c58c94f89cbb410e66d8f85c236308d6fc64f0`, client-go commit
`006dfb024c26859f2e3757172296d84ef36ff585`, and PD commit
`d190c0e9082de46128b756f93b1291768dda645a`. This document records which
visible claims are architectural, which values are deliberately
representative, and which capabilities are not implemented. TiCity is a
deterministic educational model, not a TiDB emulator or a live-cluster
observation tool.

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
| `tidb_enable_1pc` and `tidb_enable_async_commit` make the optimizations available; TiDB still chooses the suitable commit mode | Both switches are on in Protocol Lab's three isolated fixtures, while each lane records its explicit eligibility decision and has no runtime fallback | [TiDB v8.5 system variables](https://docs.pingcap.com/tidb/v8.5/system-variables/#tidb_enable_1pc), [pinned client eligibility logic](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1504-L1583) |
| Default linear consistency obtains a latest TSO for 1PC and Async Commit; causal consistency is a separate opt-in transaction mode | All three Protocol Lab fixtures are explicitly linearizable. The 1PC and Async lanes obtain modeled `latest_ts` from PD before prewrite; Protocol Lab does not model the causal-consistency path | [Transactions](https://docs.pingcap.com/tidb/v8.5/transaction-overview/#causal-consistency-transactions), [latency breakdown](https://docs.pingcap.com/tidb/v8.5/latency-breakdown) |
| 1PC is attempted in a Prewrite request and can return a TiKV-calculated one-phase commit timestamp without a normal Commit phase | The one-Region lane sends `TryOnePc`, crosses that Region's Raft quorum/apply once, records the TiKV-returned `one_pc_commit_ts`, and has no durable lock-CF intermediate or background commit cleanup | [pinned Prewrite flags](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/prewrite.go#L177-L203), [pinned client commit paths](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1707-L1980), [pinned TiKV v8.5 1PC MVCC path](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/commands/prewrite.rs#L949-L988) |
| Async Commit establishes the commit timestamp from successful prewrites and performs commit-record resolution asynchronously | Both Region prewrites independently cross Raft apply and return `min_commit_ts`; the lane uses their maximum as `commit_ts`, responds to the client, then shows both Region Commit RPC/apply paths as background work | [latency breakdown](https://docs.pingcap.com/tidb/v8.5/latency-breakdown), [pinned client commit paths](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1707-L1980), [pinned TiKV v8.5 prewrite path](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/commands/prewrite.rs#L565-L798) |
| Regular 2PC obtains `commit_ts` after prewrite, commits the primary on the client path, and can commit secondaries in the background | The two Region prewrite branches join before modeled PD TSO allocation; primary Raft apply gates the response, and secondary Commit/Raft apply follows on an explicitly background path | [latency breakdown](https://docs.pingcap.com/tidb/v8.5/latency-breakdown), [pinned primary/secondary client path](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L998-L1054) |
| The target client source has Async Commit defaults of 256 keys, 4 KiB total key bytes, and a two-second safe window | Protocol Lab pins 256, 4,096, and two seconds as implementation-profile values. They are not a public stable TiDB contract, benchmark, recommendation, or claim about another patch release | [pinned client defaults](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/config/client.go#L123-L167) |
| Follower Read can offload a Region leader | Read policy changes the selected peer without weakening the model snapshot | [Follower Read](https://docs.pingcap.com/tidb/v8.5/follower-read) |
| TiFlash is an asynchronously replicated Raft learner for HTAP | It never counts toward TiKV voter quorum and has visible catch-up lag | [TiFlash overview](https://docs.pingcap.com/tidb/v8.5/tiflash-overview) |
| Raft Engine stores Raft logs by default in this target line | The TiKV inspector names Raft Engine, not the older RaftDB default | [TiKV configuration](https://docs.pingcap.com/tidb/v8.5/tikv-configuration-file) |
| A Region's Raft leader replicates logs and requires a majority of replicas for a successful write | Raft Failure Lab has three configured voters and independent 2-of-3 Pre-Vote, Vote, and no-op persistence quorums | [TiDB storage and Raft](https://docs.pingcap.com/tidb/v8.5/tidb-storage) |
| TiKV enables Pre-Vote by default; its default election timeout is 10 ticks and a zero maximum resolves to twice that value | The configured window is shown as 10–20 ticks, separately from the deterministic 13-tick elapsed and candidate-selection model policies | [TiKV configuration](https://docs.pingcap.com/tidb/v8.5/tikv-configuration-file) |
| TiDB can back off and retry transient TiKV, not-leader, and timeout failures before exposing an error to the client | The modeled transport failure remains client-pending, invalidates the Region route, and retries the same logical request internally without an application retry | [TiDB troubleshooting map](https://docs.pingcap.com/tidb/v8.5/tidb-troubleshooting-map), [TiDB error codes](https://docs.pingcap.com/tidb/v8.5/error-codes) |
| TiKV peers perform Region leader election while PD maintains Region metadata used for routing | PD observes the completed election and answers a route lookup; it never selects the candidate, grants Pre-Votes or Votes, or elects the leader | [TiDB architecture](https://docs.pingcap.com/tidb/v8.5/tidb-architecture), [TiDB storage and Raft](https://docs.pingcap.com/tidb/v8.5/tidb-storage), [Follower Read](https://docs.pingcap.com/tidb/v8.5/follower-read) |
| Real Region, Raft, and apply state must be inspected from a cluster | TiCity's peer log, commit, and apply indexes are labeled model snapshots rather than `tikv-ctl` observations | [TiKV Control User Guide](https://docs.pingcap.com/tidb/v8.5/tikv-control) |
| TiDB instances report active transaction state and the GC worker caps the candidate to global `minStartTS - 1`; `tidb_gc_max_wait_time` bounds how long an active transaction can keep doing so | Round 1 uses one synthetic active transaction within the 86,400-second default, caps the candidate exactly to `start_ts - 1`, does not kill the transaction, and does not fast-forward a day | [GC configuration](https://docs.pingcap.com/tidb/v8.5/garbage-collection-configuration), [pinned active-transaction reporter](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/domain/infosync/info.go#L745-L825), [pinned global-min calculation and cap](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L515-L559) |
| The lifetime candidate is constrained by the minimum service safe point and must advance monotonically | Both rounds have an explicit candidate and service-safe-point decision. The fixture has no BR, CDC, or other external service requesting an older point; round 2 advances only after the teaching blocker completes | [pinned candidate and service-safe-point path](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L677-L740), [PD monotonic safe-point storage](https://github.com/tikv/pd/blob/d190c0e9082de46128b756f93b1291768dda645a/pkg/gc/safepoint.go#L43-L101) |
| The `mysql.tidb` status value staged before a GC job, TiDB's saved visibility safe point, and the global safe point published to PD are distinct boundaries | Every exact snapshot carries `staged`, `visibilitySaved`, and `published` separately. Resolve Locks precedes the visibility save; the model names the pinned 100-second implementation cache barrier but does not claim a live timing guarantee | [pinned `mysql.tidb` staging](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L455-L513), [pinned worker ordering](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L742-L806), [pinned visibility-cache constants](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/tikv/safepoint.go#L53-L64), [pinned saved visibility path](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/tikv/safepoint.go#L198-L223), [pinned PD publication](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L1236-L1267) |
| TiDB v8.5.0's pinned Resolve Locks path traverses Regions, issues ScanLock, checks primary outcome, and resolves old locks | The cutaway expands Regions 8 and 20 with one commit resolution and one rollback resolution. It records the ResolveLock outcome but deliberately does not expand the normal TiKV write command's internal Raft entry | [pinned Region traversal](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L1195-L1231), [pinned Region ScanLock path](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/tikv/gc.go#L167-L265), [pinned TiKV ResolveLock command](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/commands/resolve_lock.rs#L25-L82) |
| Delete Ranges is distinct from per-key MVCC GC; the classic raftstore-v1 branch sends `UnsafeDestroyRange` to relevant Stores and bypasses Region Raft | Round 1 uses one synthetic dropped range and a three-Store fan-out. Per-Store acknowledgement state and actual key-range boundaries are not retained; round 2 has no pending range. This fixture does not claim raftstore-v2 behavior | [pinned Delete Range branches](https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L809-L912), [pinned classic bypass contract](https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/tikv/gc.go#L303-L367) |
| With the pinned v8.5.0 default Compaction Filter path enabled, each TiKV detects a greater global safe point asynchronously and does not schedule the legacy per-Region GC round | Each round forks three background Store-detection events, joins them before one representative bottommost-compaction fixture, and records no Compaction Filter Raft entry | [TiKV configuration](https://docs.pingcap.com/tidb/v8.5/tikv-configuration-file), [pinned TiKV polling and legacy-round decision](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/gc_manager.rs#L315-L394) |
| The Compaction Filter removes obsolete MVCC records, can retain the last eligible Put as a snapshot anchor, can remove an old chain whose last eligible write is Delete, and deletes corresponding long values from DEFAULT CF | The version board contains 12 synthetic versions counted once across four logical chains. Round 1 filters four and retains two Put anchors; the final snapshot filters six, retains three anchors, and counts three deleted DEFAULT CF values | [pinned TiKV Compaction Filter retention and DEFAULT cleanup](https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L457-L530) |

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

Protocol Lab does not derive its three lanes from the SQL visible in the
workbench. It uses independent, aggregate-only optimistic transaction
fixtures: two mutations totaling 16 key bytes in one Region for 1PC, two
mutations totaling 16 key bytes across two Regions for Async Commit, and 257
mutations totaling 2,056 key bytes across two Regions for regular 2PC. The
last fixture exceeds the pinned 256-key client default even though it remains
below the pinned 4,096-byte default. These profiles make the selected path
deterministic; they are not production sizing examples.

Each lane's `eligibility` snapshot is a declared representative fixture
profile and outcome, present from `protocol_comparison_start`. It describes the
path that the immutable receipt is constructed to exercise; it does not mean
that selection, Prewrite, or an RPC has already happened at the current cursor.
Lane stage, timestamps, per-Region Raft/MVCC, client response, and background
cleanup are the temporal post-event state for the selected exact event.

The 256-key, 4,096-byte, and two-second safe-window values are pinned from the
target client implementation rather than declared as stable public TiDB
contracts. Real eligibility also depends on feature settings, Region batching,
timestamp and schema bounds, client/TiKV decisions, runtime errors, and the
exact version and configuration. Protocol Lab deliberately takes no runtime
fallback branch and must not be used to infer that Region count alone selects
Async Commit.

GC/Storage Lab fixes `tidb_gc_run_interval` and `tidb_gc_life_time` to 600
seconds, `tidb_gc_max_wait_time` to 86,400 seconds, and the minimum-`start_ts`
report interval to 30 seconds. The pinned 100-second visibility-cache barrier
is an implementation constant, not a sleep performed in real time by the
teaching clock, a recommendation, or a guarantee of observed latency. Numeric
TSO spacing, event durations, two selected Regions, three Stores, one dropped
range, two old locks, four logical chains, and 12 versions are deterministic
fixtures selected for legibility.

The storage board is deliberately one logical MVCC projection. It is not
multiplied by the three TiKV replicas, and its bottommost-compaction level is a
model fixture rather than an observation of a live RocksDB level. Filtered
version counts, retained-anchor counts, and deleted DEFAULT CF values are
logical records, not SST bytes, write amplification, reclaimed disk space,
throughput, or a production capacity estimate.

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

The model-4 `tikv-failover` scenario is a separate Region Raft failure vertical
slice. Its 27 immutable events follow one logical point read: TiDB first uses a
cached route to the old Region leader; that TiKV process becomes unreachable;
TiDB keeps the client response pending, invalidates the stale leader route, and
enters an internal teaching backoff. The failed process affects its peers in
all modeled Regions, while this detailed slice expands only representative
Region 0.

The two live peers then proceed through distinct Pre-Vote and Vote phases, each
reaching a 2-of-3 quorum. TiKV's configured default election timeout is 10
ticks, and a zero maximum resolves to 20 ticks. The exact 13-tick elapsed value
and choice of the lowest live, up-to-date store ID as candidate are
deterministic **TiCity model policies**. They are not measurements, scheduler
predictions, live failover timing, or TiDB guarantees about which peer wins.

After election, the new leader appends one modeled current-term no-op. The two
live voters persist it, it commits at quorum, and the leader applies it before
the recovery path continues. The point read itself creates no user-data Raft
entry and no modeled result row. This sequence is a deterministic educational
mechanism contract, not a packet-, byte-, implementation-, or timing-accurate
emulation of TiKV.

Only after the peers complete election and the leader applies the no-op does PD
observe the new leader metadata. PD then answers TiDB's routing lookup; it does
not choose the candidate, grant a Pre-Vote or Vote, or elect the Region leader.
TiDB refreshes its Region cache and issues attempt 2 with the same synthetic
logical request ID. This is a TiDB-internal Region-request retry, not an
application retry, and this bounded trace completes without a client-visible
error. After the response, the surviving follower applies the committed no-op
as explicitly marked background work; the failed peer remains behind.

Every Raft Failure Lab event publishes a deeply frozen snapshot of peer role,
health, term, vote, log, commit and apply state, election policy, PD state, and
request state. The 3D City cutaway and semantic inspector, Machine's acyclic
causal DAG and separate Pre-Vote/Vote graph, and Diagnose all read the exact
same selected snapshot. Exact-event navigation and looping only move a cursor
over that receipt; they do not resend the request, rerun the election, or
choose a different winner. The snapshots retain no SQL text, literal, key,
value, or result row and have `MODEL / SIMULATED` provenance.

The model-5 `commit-protocols` scenario is a fourth mechanism-level vertical
slice. Its single immutable 74-event receipt contains three independent,
representative optimistic global transactions in a fixed teaching order. The
lanes compare protocol message and state-transition shape; they are not three
executions of the displayed SQL, a race, a latency benchmark, or a prediction
of which mode a production transaction will use. Event durations, timestamp
gaps, and the sequential lane order are deterministic presentation values and
must not be compared as performance data.
Independent Region sibling branches retain separate causal dependencies; a
non-causal fence only serializes their replay presentation and is not a
latency or benchmark claim.

Both optional commit features are enabled for all three fixtures, consistency
is fixed to linearizable, and TiKV async-apply-prewrite is fixed off. Each
fixture receives a distinct synthetic request/transaction ID and its own
Region set. No Region is shared across lanes. The model deliberately exercises
successful, preselected paths with no runtime fallback:

- The **1PC** fixture has two aggregate mutations in one Region. PD supplies
  `start_ts` and `latest_ts`; TiCity records `latest_ts + 1` as a representative
  request floor and records a separate representative `max_commit_ts` model
  bound. TiDB sends one Prewrite carrying `TryOnePc=true`. One Region Raft
  propose/persist-quorum/commit/apply chain atomically projects the non-short
  value into default CF and the commit record into write CF. TiKV returns
  `one_pc_commit_ts`, which is the lane's commit timestamp. There is no normal
  Commit RPC, durable lock-CF intermediate, or post-response cleanup.
- The **Async Commit** fixture has two aggregate mutations in two Regions.
  Region batching rejects 1PC before a `TryOnePc` RPC. PD supplies `start_ts`
  and `latest_ts`; TiCity again records representative request and maximum
  timestamp bounds. The two Prewrite branches run independently, and each
  reaches its own Region Raft apply before TiKV returns that Region's
  `min_commit_ts`. The maximum returned value becomes `commit_ts`; PD does not
  allocate a separate commit timestamp on this path. Both prewrite locks still
  exist at the client-response event. Two background Commit branches then
  independently cross Region Raft and replace the locks with write-CF commit
  records.
- The **regular 2PC** fixture has 257 aggregate mutations in two Regions.
  Region batching rejects 1PC, and the 257 count rejects Async Commit at the
  pinned 256-key client precheck; this is preselection, not a failed TiKV
  optimization attempt. Both regular Prewrite branches independently cross
  Region Raft and join. PD then supplies `commit_ts`. The primary Commit and
  its Region Raft apply gate the client response, while the secondary still
  has a prewrite lock. A background secondary Commit/Raft/apply path then
  removes that lock and writes its commit record.

Timestamp authority is therefore explicit: all three `start_ts` values and the
1PC/Async `latest_ts` values come from modeled PD TSO calls; the request floor
and maximum bound are labeled TiCity model projections; the 1PC commit
timestamp comes from TiKV's one-phase result; the Async Commit timestamp is the
maximum of the two TiKV-returned `min_commit_ts` values; and regular 2PC
`commit_ts` comes from PD only after all prewrites. None is a wall-clock
measurement or a value observed from a cluster.

Transaction protocol and Region consensus remain separate layers. Protocol Lab
contains nine TiKV mutation operations. Every operation has its own four-step
Region chain—Raft propose, persistence by two distinct voters, 2-of-3 commit,
and leader apply—before conceptual MVCC state changes. Selecting 1PC or Async
Commit never weakens or replaces a Region's Raft quorum.

Every Protocol Lab event publishes a deeply frozen post-event snapshot and
typed deltas. City, Machine, and Diagnose read that exact selected snapshot;
exact-event navigation and looping never rerun a fixture. The receipt retains
only aggregate mutation/key-byte counts, opaque synthetic IDs, Region/Store
identifiers, and modeled timestamps. It contains no SQL text, literal, real
key, secondary-key list, value, result row, digest, packet, or live-cluster
observation.

The unreleased model-6 `gc-safe-point` scenario is a fifth mechanism-level
vertical slice. Its single immutable 43-event receipt contains two
deterministic coordinator and storage rounds. It is not a trace captured from
a cluster, a full GC-worker emulator, a timing benchmark, or an execution of
the displayed SQL.

Round 1 computes a lifetime candidate greater than the existing safe point.
The oldest reported synthetic transaction is within
`tidb_gc_max_wait_time`, so global `minStartTS` caps the candidate exactly to
`start_ts - 1`; GC does not kill the transaction. The fixture has no older BR,
CDC, or other external service safe point. The GC worker records the accepted
service point and stages the human-readable `tikv_gc_safe_point` status in
`mysql.tidb`; this staged status is not presented as PD's global value.

The pinned coordinator order remains explicit. TiDB traverses representative
Regions 8 and 20 through Region ScanLock, checks the two synthetic primaries,
resolves one old secondary as committed and the other as rolled back, then
saves the visibility safe point and crosses the pinned 100-second
implementation cache barrier. ResolveLock is a normal TiKV write command, but
the detailed Raft proposal, quorum, apply, and storage mutation behind that
command are outside this bounded GC slice. No event in this receipt is used to
claim that ResolveLock bypasses Raft.

Delete Ranges follows the visibility boundary and remains distinct from
per-version MVCC filtering. One synthetic DDL range older than the accepted
safe point becomes eligible. In this deliberately classic raftstore-v1
fixture, three independent `UnsafeDestroyRange` Store branches bypass Region
Raft and join at an aggregate deletion event. The snapshot retains neither the
real start/end key boundaries nor a per-Store acknowledgement history, and it
makes no claim about raftstore-v2's different internal path.

Only after Delete Ranges joins does TiDB publish the monotonic global safe
point to PD. The coordinator can finish while three independent background
TiKV branches detect the greater PD value. With the pinned v8.5.0 default
Compaction Filter enabled, those Stores do not schedule the legacy per-Region
GC round. Their branches join before a representative RocksDB bottommost
compaction opens the filters. Compaction Filter is physical storage work and
creates no modeled Raft entry; its scheduling, duration, SST layout, and disk
reclamation are outside the model.

At a visible teaching boundary, the synthetic blocker completes without
replaying its commit protocol. Round 2 computes a later candidate, accepts it
without an active-transaction or external-service cap, repeats Region ScanLock
with no remaining old fixture locks, finds no pending Delete Range, publishes
the later global value, and repeats asynchronous Store detection and
Compaction Filter. This boundary must not be read as GC committing, killing,
or otherwise controlling the application transaction.

The MVCC fixture demonstrates the pinned filter semantics without storing key
material. At the first filter event, four of 12 synthetic records are
filtered and two last eligible Puts are retained as anchors. In the final
snapshot, six records are filtered, three Put anchors remain, one filtered
Delete demonstrates removal of its older logical history, and three filtered
long Puts count corresponding DEFAULT CF cleanup. These are logical chains
counted once, not replica-level copies.

Every GC/Storage Lab event publishes a deeply frozen `gcLab` post-event
snapshot and typed deltas. City projects it into a fixed-capacity 3D cutaway
and bilingual semantic inspector. Machine keeps its two-round semantic
pipeline separate from the causal DAG and never serializes the three
Store-detection or Delete Range siblings into causal dependencies. Diagnose
projects the same selected candidate/bounds, coordinator stages, locks,
ranges, Store detectors, filter state, logical versions, and boundary
statements. Exact-event navigation and looping move over the same receipt and
do not rerun a round or recompute a safe point.

The receipt retains modeled timestamps, aggregate counts, Region/Store IDs,
and visibly synthetic transaction, lock, range, chain, and version IDs. It
contains no SQL text, literal, real or encoded key, key range, row value,
result row, packet, SST content, or live-cluster observation.

The other four scenarios retain compact teaching traces in this development
revision. They use the same causal dependency field but do not yet claim the
detailed transaction, concurrency-control, Region-election, commit-protocol,
or GC/storage projection depth of these five vertical slices.

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
- `OBSERVED`: reserved for a future read-only adapter and not used in this
  unreleased v0.8 development tree.
