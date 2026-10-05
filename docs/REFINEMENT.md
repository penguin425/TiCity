# TiCity v0.12.0 refinement — model 9

`tidb-v8.5-model-9` strengthens the source ordering, state invariants, SQL
classification, and explanation of the existing educational mechanisms. The
changes address invalid transitions that fixed successful examples could hide,
and ordinary requests that could accidentally replay an earlier guided fixture.

TiCity remains a deterministic, offline educational model of TiDB v8.5 LTS. It
classifies SQL into a declared mechanism subset, retains synthetic state, and
publishes immutable trace receipts. It does not execute SQL, return database
rows, run the optimizer, or measure a live cluster. City, Machine, and Diagnose
remain visibly labelled `MODEL / SIMULATED`.

The historical findings and revision inventory are recorded in
[SOURCE_AUDIT.md](SOURCE_AUDIT.md). That document distinguishes the initial
audit from the fixes delivered in v0.11.0. This refinement builds on those
fixes; the original findings are not a list of unresolved v0.12.0 defects.
[MODEL_BOUNDARY.md](MODEL_BOUNDARY.md) describes the model's broader contract.

## Fixed reference implementations

The review reads implementation paths at exact revisions, rather than assuming
that current documentation or a later patch has the same call order.

| Component | Revision |
| --- | --- |
| TiDB v8.5.0 | [`d13e52ed6e22cc5789bed7c64c861578cd2ed55b`](https://github.com/pingcap/tidb/tree/d13e52ed6e22cc5789bed7c64c861578cd2ed55b) |
| TiDB's client-go dependency | [`006dfb024c26859f2e3757172296d84ef36ff585`](https://github.com/tikv/client-go/tree/006dfb024c26859f2e3757172296d84ef36ff585) |
| TiKV v8.5.0 | [`a2c58c94f89cbb410e66d8f85c236308d6fc64f0`](https://github.com/tikv/tikv/tree/a2c58c94f89cbb410e66d8f85c236308d6fc64f0) |
| TiKV's raft-rs dependency | [`a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e`](https://github.com/tikv/raft-rs/tree/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e) |
| PD v8.5.0 | [`d190c0e9082de46128b756f93b1291768dda645a`](https://github.com/tikv/pd/tree/d190c0e9082de46128b756f93b1291768dda645a) |
| TiFlash v8.5.0 | [`6e12ba23c70f358f2ffbee837feac24118a3e988`](https://github.com/pingcap/tiflash/tree/6e12ba23c70f358f2ffbee837feac24118a3e988) |
| TiFlash proxy / engine FFI | [`b877a976997acb7c552db970c01546b4e82bce18`](https://github.com/pingcap/tidb-engine-ext/tree/b877a976997acb7c552db970c01546b4e82bce18) |

The dependency provenance and original source comparison remain available in
[SOURCE_AUDIT.md](SOURCE_AUDIT.md#対象と方法). The links below identify the
implementation conditions used for this refinement. They are references for
mechanisms, not evidence that TiCity executes those implementations.

## SQL classification and modeled plans

The classifier now validates the complete supported statement shape. Executable
comments and optimizer hints are rejected as unsupported instead of being
discarded in a way that changes meaning. Ordinary block comments terminate at
the first closing delimiter, and `--` comments require the scanner's whitespace
or end-of-input condition. Quoted identifiers remain distinct from keywords
and literals, including escaped backticks and quoted aliases containing dots.
These decisions follow the pinned [comment scanner][sql-comments] and
[quoted-identifier scanner][sql-identifiers].

The pinned [reserved-token profile][sql-reserved] and
[reserved scanner aliases][sql-reserved-aliases] prevent bare keywords such as
`CASE` from becoming simple columns or aliases. Quoted names and
[qualified identifiers][sql-qualified] remain available, as do legal
[unreserved names such as `END`][sql-unreserved]. Bare built-ins with
[optional parentheses or precision][sql-bare-builtins], such as
`CURRENT_TIMESTAMP`, require expression evaluation and are rejected as
unsupported rather than classified as simple columns.

Projection, table/alias binding, every UPDATE assignment, statement endings,
and the plain EXPLAIN wrapper are checked. Unsupported functions, extra clauses,
subqueries, modifiers, primary-key changes, and incompatible key literals are
rejected instead of becoming a simpler supported route. Size and nesting limits
bound input processing; signed integer key checks reject overflow without
coercing an incompatible literal.

The built-in demo tables declare **clustered primary-key row handles**. A full
primary-key equality with an additional predicate retains a root `Selection`
above `Point_Get`, consistent with the [normal PointGet planner][sql-point].
For a composite key, a leading equality prefix and the next range column can
define a `TableRangeScan`. A condition after a leading range remains a residual
filter; a suffix-only condition uses a full scan with Selection. The relevant
source separates [access conditions from residual conditions][sql-ranges] and
keeps [table ranges and table filters separate][sql-table]. The model does not
invent a secondary index for an unindexed predicate.

Aggregate predicates retain Selection between the storage scan and partial
aggregation, matching the [selection pushdown boundary][sql-selection]. A
transactional `KVWrite` is labelled `kv[tikv]` and remains separate from a
coprocessor read. The literal-free `predicateShape` preserves the access/residual
distinction in analysis and replay without retaining SQL, comparison values,
aliases, or encoded keys.

These are declared demo-schema routes. They do not reproduce optimizer cost,
statistics, collation, general type conversion, arbitrary schemas, the complete
SQL grammar, or a server's EXPLAIN output.

## Ordinary requests preserve the current cluster

Guided `runScenario` actions intentionally create isolated teaching fixtures.
Workbench SQL and ordinary `requestTrace` actions operate on the current model
state and do not inherit the last scenario's detailed lab. A request after
failover therefore keeps failed Stores down and retains the current Region
indices. A second outage can remove quorum and fail a request; it cannot revive
an old leader by restoring a fixture.

Background writes use the same compact leader-recovery gate as traced requests.
Two surviving TiKV voters can recover a lost leader while an unavailable peer
keeps its old state. A fresh compact TiFlash read also verifies the required
TiKV authority instead of treating provisioning as snapshot readiness. Because
that compact path retains neither a self-safe-ts proof nor a cached ReadIndex
for the newly allocated snapshot, it requires a live leader and voter quorum
for every queried Region. The real implementation can skip fresh ReadIndex
when [self-safe-ts or a request-local cached index proves readiness][flash-safe].
A TiFlash learner never supplies a missing TiKV voter.

The `forceConflict` API represents the declared optimistic newer-committed-version
fixture. It rejects read-only or pessimistic requests before allocating a trace
or timestamps. A valid optimistic conflict requires an available leader and an
explicit prewrite check before any user-data Raft proposal. An unavailable
Region produces an unavailable-prewrite failure instead of a fabricated MVCC
conflict. The pinned [prewrite implementation distinguishes these checks][txn-conflict];
this fixture does not represent every possible pessimistic WriteConflict.

## Region Raft, routing, and splits

The detailed Raft reducer separates each peer's current election term from the
term of its last log entry. Pre-Vote uses the candidate's own next term; it
does not obtain an unreachable peer's maximum term. Log freshness compares
last-entry term before index, and a real vote cannot decrease the voter's term.
These conditions follow [campaign construction][raft-campaign] and
[vote eligibility][raft-vote].

Proposal advances the leader's log but does not claim local persistence.
Persistence callbacks accumulate distinct voter acknowledgements, including
either leader/follower arrival order. Duplicate callbacks cannot manufacture
quorum. Commit requires persistence quorum, and application stays bounded by
the committed index. Already committed entries cannot be replaced by a
conflicting no-op. The source explicitly separates
[append from local persistence][raft-persist] and protects the
[committed prefix][raft-prefix].

PD can observe an elected leader before the current-term no-op applies. Routing
refresh and client retry dispatch can also precede server-side read readiness.
The detailed recovery lab gates serving on current-term leader application;
compact replacement elections collapse that confirmation into their no-op
commit/apply step. Follower service waits for local application through the
returned ReadIndex. The pinned
paths show [role-change heartbeat][raft-heartbeat] separately from
[server-side read conditions][raft-read]. PD supplies control metadata; it
does not vote, replicate SQL row data, or certify local apply.

A compact Region split now requires its admin Raft operation to reach quorum,
commit, and the collapsed local-apply boundary before ranges or epoch change.
An unavailable quorum leaves that metadata unchanged, and an unavailable peer
remains unavailable in the split siblings. The fixture uses `right_derive`:
the existing Region ID stays on the upper range and a new logical Region owns
the lower range. This follows the [BatchSplit application path][raft-split].

The compact model retains aggregate indices and a Region term, not per-entry
log history. Pre-existing healthy compact leaders are assumed initialized and
read-ready; the historical current-term proof is not retained. Catch-up,
conflict repair, admin application, PD ID allocation,
and new-group bootstrap are collapsed. A new logical Region copies continuity
state; that is not a claim that a real split-created group's initial Raft index
equals its parent's admin index. The detailed lab supplies term-first log
comparison, but neither path is a complete message, snapshot, merge,
joint-consensus, or membership-change simulator. Election timing and the
deterministic winning Store are teaching policies.

## Transaction commit protocol invariants

The existing successful 1PC, Async Commit, and ordinary 2PC comparison keeps
transaction atomicity separate from each Region's Raft replication. Its reducer
now rejects skipped dispatch stages, replacing an unfinished entry, committing
before an applied prewrite lock, and secondary Commit before the primary
decision. Ordinary 2PC allocates commitTS only after all prewrites. 1PC uses
its applied atomic-commit result; Async Commit uses the maximum of the returned
Region prewrite minima. Client response retains the distinct protocol-specific
success boundaries.

Timestamp authority is explicit. Candidate preparation precedes Region
grouping, and the linearizable request floor is `latestTs + 1`. A successful
optimized timestamp must meet that floor and may equal `maxCommitTs`; exceeding
the bound does not describe a successful optimized write. The source shows
[client preparation and result selection][txn-client] and
[TiKV's inclusive optimization bound][txn-bound]. TiKV-returned values do not
increment PD allocation counts. Subsequent ordinary requests continue on a
monotonic modeled timestamp sequence after the comparison.

The lanes remain fixed optimistic, global, successful fixtures with modeled
request bounds. Runtime fallback, unsynchronized max-ts errors, zero optimization
responses, existing-record retry, ambiguous RPC outcomes, and distributed
recovery are outside the implemented comparison. The real client also checks
candidate conditions and clears 1PC when actual prewrite batching needs more
than one batch; [one Region alone is not a universal 1PC guarantee][txn-batches].
Background secondary cleanup after the visible client boundary is deterministic
presentation policy: [source goroutines can start before the application
observes return][txn-secondary]. The release adds guards for the declared paths,
not a new general fallback planner.

## GC safe points, compaction, and marker cleanup

The GC reducer now distinguishes the lifetime candidate, active-transaction
bound, accepted PD service minimum, staged status, visibility save, global
publication, and Store observation. An external service can impose a lower
safe-point cap even when the active transaction also provides a cap. Accepted
values cannot exceed either applicable cap. The source first subtracts one
from the [reported minimum start timestamp][gc-active] and then accepts the
[minimum service safe point][gc-service]. Nonadvancing rounds are outside this
successful fixture; real TiDB can skip the job.

Coordinator guards enforce staging before Resolve Locks, old-lock resolution
before visibility save/cache wait, and the declared Delete Range stage before
global publication. ScanLock's maximum is inclusive:
`lock.start_ts == safe_point` is eligible and a newer lock stays protected.
DDL range eligibility is strict: `drop_ts < safe_point`. Equal Store polls
cannot reset compaction. These boundaries follow the pinned
[ScanLock predicate][gc-lock], [coordinator sequence][gc-order], and
[Store safe-point update][gc-observer].

Both compactions derive their decisions from a pure **complete logical-chain,
bottommost-compaction fixture**. Eligible Rollback/Lock records and obsolete
versions are filtered, the first eligible Put or Delete is kept, and future
records remain. Long Put removal accounts for its DEFAULT CF value cleanup;
an inline value does not. Wrong anchors, removed-version resurrection, partial
decision lists, and invalid CF representations are rejected. The compatibility
field `commitTs` represents a WRITE-CF suffix timestamp: a Rollback suffix is
its startTS, as shown by the [rollback write][gc-rollback].

Delete-marker eligibility is evidence about **compaction input**. Removing an
older Put in this pass cannot immediately prove that the same input lacked an
overlap. A later compaction can supply that proof. A per-round input-pass marker
prevents replaying filter decisions to erase the evidence; an empty/no-op pass
still must be recorded before completion. The source
[counts input overlap and keeps the newest eligible write][gc-filter].

`GcTask::GcKeys` remains separate from inline filtering. Eligible work is
enqueued at filter Drop **before** the compaction result is installed, according
to the [pinned Drop ordering][gc-drop]. The reducer checks scheduling before
cleanup and can also clean an initially nonoverlapping Delete in round one;
"second round" is a property of the displayed example, not an eligibility rule.
Actual task execution after displayed compaction completion is a fixture timing
choice. Upstream [rereads MVCC state and changes the local engine][gc-key-task].

The following successful-fixture conditions are deliberate:

- All eligible DDL range branches complete before global publication in this
  receipt. Real [per-range RPC failures can leave work pending while the
  coordinator continues][gc-range-errors].
- Every eligible marker is successfully queued before completion. Real
  [full/stopped scheduler errors do not necessarily abort compaction][gc-queue-errors].
- Three Store observers can progress independently, but the logical chain board
  is counted once and filters at an aggregate join. Physical SST subsets,
  RocksDB sequence numbers and tombstones, replica-level copies, overlapping
  compactions, and concurrent writes are omitted.
- The visibility event includes the implementation cache wait as a teaching
  boundary; it does not collect actual TiDB cache acknowledgements. ResolveLock
  is a normal TiKV write command whose detailed Raft persistence is omitted.
  Classic raftstore-v1 UnsafeDestroyRange is a separate whole-range path that
  bypasses Region Raft; the model does not claim this path for raftstore-v2.

## TiFlash learner reads and MPP output

Learner replication advances independently of a query waiting for it. The causal
parent of learner application is committed replication; a query wait can order
the presentation but cannot authorize the write. The displayed apply path writes
committed Region-cache data to DeltaMerge before advancing the local applied
index, following [Raft command application][flash-apply]. A DeltaMerge write is
storage visibility here, **not disk fsync or SST compaction**, as reflected in
the [storage write path][flash-write].

Each scan task needs snapshot readiness and MVCC checks for **all of its own
Regions**, while another task's Regions can lag. ReadIndex can become ready
directly on response when independent application already reached the required
index; an artificial waiting stage is not required. Reader construction follows
[learner read and lock handling][flash-prepare], and partial aggregation cannot
complete until [post-reader Region validation][flash-validation]. The successful
fixture declares no conflicting locks and stable Regions, and does not execute
split/merge recovery or remote read fallback.

Every completed blocking final HashAgg requires that task's own sender
partitions. Task identities, selected addresses, and sender/receiver links must
agree; matching object counts alone cannot hide a duplicate link or a missing
sender. The source derives [task addresses][mpp-addresses] and
[target links][mpp-links]. The
fixed HashPartition topology describes routing, not duplication of each row.

TiDB can decode a received root packet and publish the first result bucket while
another root packet is pending. Counters describe packets actually received,
and EOF requires the declared streams to be consumed. This follows the
[coordinator response channel][mpp-response]. The one-packet-per-stream fixture
assumes the first packet contains a chunk large enough for `Next` to return:
the real [chunk decoder can combine smaller chunks and wait][mpp-chunks].
TiCity retains only row/byte buckets, never actual rows or packet payloads.

The model's virtual TiDB root and TiFlash final senders are explicit roles;
their labels are not a one-to-one copy of upstream runtime enums or internal
root flags. Successful dispatch and draining do not implement transport retries,
Region rescheduling, timeout fallback, disaggregated memory-limit recovery, or
all production task lifecycle states. First rows do not require a global
all-task completion barrier.

## Reviewable observations and validation

The shared event inspector shows direct `dependsOn` parents and children,
presentation-order fences separately, and critical/background paths within the
model. Adjacent events are not automatically causal. The UI labels linked
sources as **reference implementations**: fixed mechanism references do not
promise a line-by-line source mapping for every synthetic event or a measured
production critical path. Reference URLs are constants and cannot incorporate
SQL, event IDs, or user metadata.

Validation exercises the declared behavior through:

- SQL lexical/binding boundaries, key type and overflow rejection, residual
  predicates, supported demo routes, privacy, size/nesting limits, and replay
  determinism.
- Public-operation continuity, repeated Store outages, background recovery,
  failed split quorum, and read authority without restoring fixture state.
- Raft term/log freshness, acknowledgement order and duplicates, committed-prefix
  protection, routing/read readiness, and valid partial peer progress.
- Protocol timestamp source, inclusive bounds, proposal/persistence/commit/apply
  ordering, primary/secondary decisions, and later request timestamp continuity.
- An independent MVCC read oracle across combinations of all WRITE types and
  safe-point boundaries, plus GC stage order, service caps, protected future
  records, compaction-input replay, and separate marker scheduling/execution.
- TiFlash task-owned Region gates, independent apply, post-read validation,
  incoming-partition completeness, incremental root output, and reconstruction
  of published snapshots from typed deltas.
- City/Machine/Diagnose projections, bilingual inspector semantics, exact-event
  navigation, accessibility, and browser smoke/screenshot review.

The release checks use Node.js 26, unit tests, strict TypeScript checking,
production build, license/offline-boundary verification, and browser tests.
Release results are recorded with the release rather than fixing a test count
in this document. The offline source-audit verifier remains available:

```bash
npm test
npm run typecheck
npm run build
npm run test:license
node tools/reproduce-source-audit.mjs --verify
npm run test:e2e
```

These checks validate TiCity's model and projections. They do not constitute
Go/Rust/C++ integration tests, live SQL execution, a server EXPLAIN comparison,
or measured TiDB/TiKV/TiFlash performance.

[sql-comments]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/lexer.go#L491-L600
[sql-identifiers]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/lexer.go#L687-L710
[sql-reserved]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/parser.y#L79-L311
[sql-reserved-aliases]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/misc.go#L982-L986
[sql-qualified]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/misc.go#L1100-L1116
[sql-unreserved]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/parser.y#L6729-L6783
[sql-bare-builtins]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/parser/parser.y#L8093-L8106
[sql-point]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/find_best_task.go#L2682-L2740
[sql-ranges]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/util/ranger/detacher.go#L687-L803
[sql-table]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/find_best_task.go#L2879-L2896
[sql-selection]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/find_best_task.go#L2832-L2860
[txn-conflict]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/actions/prewrite.rs#L500-L550
[raft-campaign]: https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1271-L1306
[raft-vote]: https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1401-L1503
[raft-persist]: https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft.rs#L1040-L1078
[raft-prefix]: https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/src/raft_log.rs#L261-L287
[raft-heartbeat]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/fsm/peer.rs#L2181-L2191
[raft-read]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/peer.rs#L2492-L2520
[raft-split]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/components/raftstore/src/store/fsm/apply.rs#L2593-L2679
[txn-client]: https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1745-L1898
[txn-bound]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/actions/prewrite.rs#L815-L853
[txn-batches]: https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L1577-L1582
[txn-secondary]: https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/txnkv/transaction/2pc.go#L998-L1034
[gc-active]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L536-L559
[gc-service]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L717-L740
[gc-lock]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/mod.rs#L1668-L1675
[gc-order]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L742-L809
[gc-observer]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/gc_manager.rs#L377-L391
[gc-rollback]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/storage/txn/actions/check_txn_status.rs#L348-L349
[gc-filter]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L457-L530
[gc-drop]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L668-L675
[gc-key-task]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/gc_worker.rs#L352-L519
[gc-range-errors]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/store/gcworker/gc_worker.go#L840-L911
[gc-queue-errors]: https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/src/server/gc_worker/compaction_filter.rs#L415-L435
[flash-safe]: https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/Read/LearnerReadWorker.cpp#L123-L155
[flash-apply]: https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/MultiRaft/RaftCommands.cpp#L460-L514
[flash-write]: https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Storages/KVStore/Decode/PartitionStreams.cpp#L81-L103
[flash-prepare]: https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Flash/Coprocessor/DAGStorageInterpreter.cpp#L595-L629
[flash-validation]: https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/dbms/src/Flash/Coprocessor/DAGStorageInterpreter.cpp#L1028-L1073
[mpp-addresses]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/fragment.go#L183-L223
[mpp-links]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/planner/core/fragment.go#L418-L428
[mpp-response]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/executor/internal/mpp/local_mpp_coordinator.go#L499-L536
[mpp-chunks]: https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/pkg/distsql/select_result.go#L438-L472
