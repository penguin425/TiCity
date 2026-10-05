// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

// Observe the source-audit fixtures; --verify checks the corrected model-8 flows.
// This observes the educational model; it neither executes SQL nor uses a network.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = await build({
  stdin: {
    contents: `
      export { createTiDBSimulation } from './src/tidb/model/simulation';
      export { analyzeSql } from './src/tidb/model/sql';
      export { createRaftLabState, reduceRaftLabState } from './src/tidb/model/raft-lab';
      export { presentSql } from './src/tidb/ui/sql';
      export { traceEventCopy } from './src/tidb/ui/event-copy';
      export { TIDB_MODEL_VERSION } from './src/tidb/model/types';
    `,
    resolveDir: root,
    sourcefile: 'source-audit.ts',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
})
const {
  createTiDBSimulation, analyzeSql, createRaftLabState, reduceRaftLabState,
  presentSql, traceEventCopy, TIDB_MODEL_VERSION,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

const fresh = () => createTiDBSimulation({ seed: 425 })
const operators = (nodes) => nodes.flatMap((node) => [node.operator, ...operators(node.children)])
const findings = []

const raft = fresh()
raft.runScenario('cross-region-transaction')
const readAnalysis = analyzeSql('SELECT * FROM accounts WHERE id = 425')
raft.requestTrace({ analysis: readAnalysis, scenarioId: 'tikv-failover', regionIds: [0] })
const region = structuredClone(raft.state.regions.find((candidate) => candidate.id === 19))
const read = raft.requestTrace({ analysis: readAnalysis, scenarioId: 'point-read', regionIds: [19] })
const write = raft.requestTrace({
  analysis: analyzeSql('UPDATE accounts SET balance = balance + 1 WHERE id = 425'),
  scenarioId: 'point-read', regionIds: [19], forceProtocol: '2pc',
})
let lab = createRaftLabState(0, 'tikv-1', [
  { storeId: 'tikv-1', lastLogIndex: 42, lastLogTerm: 1, commitIndex: 41, appliedIndex: 41 },
  { storeId: 'tikv-2', lastLogIndex: 42, lastLogTerm: 1, commitIndex: 41, appliedIndex: 41 },
  { storeId: 'tikv-3', lastLogIndex: 41, lastLogTerm: 1, commitIndex: 41, appliedIndex: 41 },
])
lab = reduceRaftLabState(lab, {
  kind: 'raft_peer_health', regionId: 0, storeId: 'tikv-1', from: 'up', to: 'down',
})
let electionResult = 'allowed'
try {
  reduceRaftLabState(lab, {
    kind: 'raft_election_timeout', regionId: 0, candidateStoreId: 'tikv-2',
    configuredElectionTimeoutTicks: 10, configuredMaxElectionTimeoutTicks: 20,
    elapsedTicks: 13, candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
  })
} catch (error) {
  electionResult = String(error)
}
findings.push({
  id: 'F1', leader: region.leaderStoreId, commitIndex: region.commitIndex,
  peers: region.peers.map(({ storeId, healthy, matchIndex }) => ({ storeId, healthy, matchIndex })),
  readOutcome: read.outcome, writeOutcome: write.outcome,
  warning: read.warnings[0], staggeredElection: electionResult,
})

findings.push({
  id: 'F2', cases: [
    'SELECT * FROM accounts WHERE NOT (id = 1)',
    'UPDATE accounts SET balance = 0 WHERE NOT (id = 1)',
    'DELETE FROM accounts WHERE NOT id = 1',
    'SELECT * FROM accounts a, orders o WHERE a.id = 1',
    'SELECT COUNT(*) OVER () FROM events',
  ].map((sql) => {
    const analysis = analyzeSql(sql)
    return { sql, status: analysis.status, kind: analysis.kind, table: analysis.table, accessPath: analysis.accessPath }
  }),
})

const point = fresh().submitSql('SELECT * FROM accounts WHERE id = 425')
findings.push({ id: 'F3', route: presentSql(point).route })

const mpp = fresh()
const mppLab = mpp.runScenario('tiflash-mpp')
const scalar = mpp.submitSql('SELECT COUNT(*) FROM events')
findings.push({
  id: 'F4', scalarOperators: operators(scalar.analysis.plan),
  afterGroupedScenario: {
    aggregateShape: scalar.analysis.aggregateShape,
    detailedGroupedLab: scalar.receipt.events.some((event) => Boolean(event.snapshot?.tiflashMppLab)),
  },
})

const compact = fresh()
compact.setControl('qps', 0)
compact.setControl('tiflashLagSeconds', 2)
compact.submitSql('INSERT INTO events (id, account_id) VALUES (1, 7)')
const compactRead = compact.submitSql('SELECT COUNT(*) FROM events').receipt
findings.push({
  id: 'F5', detailed: mppLab.events.filter((event) => [
    'tiflash_mpp_tunnels_planned', 'tiflash_mpp_tunnels_registered',
    'tiflash_mpp_dispatch_batch', 'tiflash_mpp_tasks_prepared',
  ].includes(event.kind)).map((event) => ({
    id: event.id, kind: event.kind, dependsOn: event.dependsOn,
    taskStages: event.snapshot.tiflashMppLab.tasks.map((task) => task.stage),
    tunnelStatuses: event.snapshot.tiflashMppLab.tunnels.map((tunnel) => tunnel.status),
  })),
  compactEventOrder: compactRead.events.map((event) => ({
    id: event.id, kind: event.kind, dependsOn: event.dependsOn,
  })),
})

const protocols = fresh().runScenario('commit-protocols')
const twoPc = protocols.events.at(-1).snapshot.protocolLab.lanes.find((lane) => lane.id === 'two_pc')
findings.push({
  id: 'F6', enable1Pc: twoPc.eligibility.enable1Pc,
  enableAsyncCommit: twoPc.eligibility.enableAsyncCommit,
  consistency: twoPc.eligibility.consistency, mutationCount: twoPc.eligibility.mutationCount,
  latestTs: twoPc.latestTs,
  timestampKinds: protocols.events.filter((event) => event.deltas?.some((delta) =>
    delta.kind === 'protocol_timestamp' && delta.laneId === 'two_pc')).map((event) => event.kind),
})

findings.push({
  id: 'F7', protocols: ['1pc', 'async_commit'].map((protocol) => {
    const sim = fresh()
    sim.setControl('transactionMode', 'optimistic')
    sim.setControl('commitProtocol', protocol)
    const receipt = sim.requestTrace({
      analysis: analyzeSql('INSERT INTO events (id, account_id) VALUES (425, 7)'),
      regionIds: protocol === '1pc' ? [24] : [25, 26],
    })
    return {
      protocol, commitTs: receipt.commitTs, pdLastAllocated: sim.state.tso.lastAllocated,
      pdAllocations: sim.state.tso.allocations,
      pdEvents: receipt.events.filter((event) => event.domain === 'tso').map((event) => ({ kind: event.kind, metadata: event.metadata })),
      unexplainedKinds: receipt.events.filter((event) => traceEventCopy(event, 'en').detail.startsWith('This event is rendered')).map((event) => event.kind),
    }
  }),
})

const gc = fresh().runScenario('gc-safe-point')
findings.push({
  id: 'F8', compactions: gc.events.filter((event) => event.kind === 'gc_compaction_filter_apply').map((event) => {
    const snapshot = event.snapshot.gcLab
    return {
      round: snapshot.round, filteredCount: snapshot.storage.filteredVersionCount,
      deleteMarker: snapshot.keyChains.flatMap((chain) => chain.versions).find((version) => version.id === 'b-v2'),
    }
  }),
  cleanup: gc.events.filter((event) => event.kind === 'gc_delete_marker_cleanup_complete').map((event) => ({
    gcKeyDeletedCount: event.snapshot.gcLab.storage.gcKeyDeletedVersionCount,
    deleteMarker: event.snapshot.gcLab.keyChains.flatMap((chain) => chain.versions).find((version) => version.id === 'b-v2'),
  })),
})

if (process.argv.includes('--verify')) {
  const byId = Object.fromEntries(findings.map((finding) => [finding.id, finding]))
  assert.equal(TIDB_MODEL_VERSION, 'tidb-v8.5-model-8')
  assert.equal(byId.F1.readOutcome, 'succeeded')
  assert.equal(byId.F1.writeOutcome, 'committed')
  assert.equal(byId.F1.staggeredElection, 'allowed')
  assert.ok(byId.F2.cases.every((item) => item.status === 'unsupported'))
  assert.ok(byId.F3.route.every((stop) => !stop.startsWith('pd-')))
  assert.ok(!byId.F4.scalarOperators.some((operator) => operator.includes('HashPartition')))
  assert.equal(byId.F4.afterGroupedScenario.aggregateShape, 'scalar')
  assert.equal(byId.F4.afterGroupedScenario.detailedGroupedLab, false)
  const [planned, dispatched, prepared] = byId.F5.detailed
  assert.ok(planned.tunnelStatuses.every((status) => status === 'planned'))
  assert.ok(dispatched.tunnelStatuses.every((status) => status === 'planned'))
  assert.ok(prepared.tunnelStatuses.every((status) => status === 'registered'))
  const dispatchIndex = byId.F5.compactEventOrder.findIndex((event) => event.kind === 'mpp_dispatch')
  const gates = byId.F5.compactEventOrder.filter((event) => event.kind === 'learner_snapshot_gate')
  assert.ok(dispatchIndex >= 0 && gates.length > 0)
  assert.ok(gates.every((gate) => byId.F5.compactEventOrder.indexOf(gate) > dispatchIndex))
  assert.ok(byId.F6.latestTs > 0)
  assert.ok(byId.F7.protocols.every((protocol) => protocol.commitTs > protocol.pdLastAllocated && protocol.pdAllocations === 2 && protocol.unexplainedKinds.length === 0))
  assert.equal(byId.F8.compactions[0].filteredCount, 3)
  assert.equal(byId.F8.compactions[0].deleteMarker.state, 'present')
  assert.equal(byId.F8.compactions[1].filteredCount, 5)
  assert.equal(byId.F8.cleanup[0].gcKeyDeletedCount, 1)
  assert.equal(byId.F8.cleanup[0].deleteMarker.state, 'gc_deleted')
}

console.log(JSON.stringify({ modelVersion: TIDB_MODEL_VERSION, seed: 425, verified: process.argv.includes('--verify'), findings }, null, 2))
