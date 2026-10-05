/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'
import {
  isTiFlashMppLabDelta,
  reduceTiFlashMppLabState,
  type TiFlashMppLabDelta,
} from './tiflash-mpp-lab'
import type {
  TraceReceipt,
  TraceTiFlashMppLabSnapshot,
  TraceTiFlashMppTaskId,
  TraceTiFlashMppTaskStage,
  TraceTiFlashMppTunnelId,
} from './types'

function fixture(): TraceReceipt {
  return createTiDBSimulation({ seed: 2026 }).runScenario('tiflash-mpp')
}

function at(
  receipt: TraceReceipt,
  kind: string,
  before = false,
  regionId?: number,
): TraceTiFlashMppLabSnapshot {
  const index = receipt.events.findIndex((event) => event.kind === kind &&
    (regionId === undefined || event.regionId === regionId))
  const lab = receipt.events[index - Number(before)]?.snapshot?.tiflashMppLab
  if (index < 0 || !lab) throw new Error(`Missing TiFlash snapshot for ${kind}.`)
  return lab
}

function taskStage(
  lab: TraceTiFlashMppLabSnapshot,
  taskId: TraceTiFlashMppTaskId,
  to: TraceTiFlashMppTaskStage,
): TraceTiFlashMppLabSnapshot {
  const task = lab.tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Missing ${taskId}.`)
  return reduceTiFlashMppLabState(lab, {
    kind: 'tiflash_mpp_task_stage',
    taskId,
    from: task.stage,
    to,
  })
}

function receive(
  lab: TraceTiFlashMppLabSnapshot,
  tunnelId: TraceTiFlashMppTunnelId,
): TraceTiFlashMppLabSnapshot {
  return reduceTiFlashMppLabState(lab, {
    kind: 'tiflash_mpp_tunnel_data',
    tunnelId,
    action: 'receive',
    packetCount: 1,
    bytesBucket: 'small',
  })
}

function apply(
  lab: TraceTiFlashMppLabSnapshot,
  deltas: readonly TiFlashMppLabDelta[],
): TraceTiFlashMppLabSnapshot {
  return deltas.reduce(reduceTiFlashMppLabState, lab)
}

function observe(lab: TraceTiFlashMppLabSnapshot): TraceTiFlashMppLabSnapshot {
  const learner = lab.learners[0]!
  return reduceTiFlashMppLabState(lab, {
    kind: 'tiflash_mpp_safe_ts_observed',
    regionId: learner.regionId,
    leaderSafeTs: learner.leaderSafeTs,
    selfSafeTs: learner.selfSafeTs,
    lagBucket: learner.safeTsLagBucket,
  })
}

describe('TiFlash source-order invariants', () => {
  it('keeps query waiting out of the causal ancestors of persistent learner application', () => {
    const receipt = fixture()
    const byId = new Map(receipt.events.map((event) => [event.id, event]))
    for (const regionId of [25, 26]) {
      const applied = receipt.events.find((event) =>
        event.kind === 'tiflash_learner_apply_command' && event.regionId === regionId)!
      const ancestors = new Set<string>()
      const visit = (id: string): void => {
        if (ancestors.has(id)) return
        ancestors.add(id)
        for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
      }
      for (const dependency of applied.dependsOn ?? []) visit(dependency)
      const events = [...ancestors].map((id) => byId.get(id)!)
      expect(events.some((event) => event.kind === 'tiflash_learner_receive' &&
        event.regionId === regionId)).toBe(true)
      expect(events.every((event) => event.deltas?.every((delta) =>
        !delta.kind.startsWith('tiflash_mpp_')))).toBe(true)
    }
  })

  it('publishes the first client row bucket while the other root packet is still pending', () => {
    const receipt = fixture()
    const firstRows = at(receipt, 'tiflash_client_rows_streamed')
    const laterPacket = at(receipt, 'tiflash_mpp_gather_progress')
    expect(firstRows.result).toMatchObject({
      stage: 'rows_streaming', columnsSent: true, rootStreamCount: 1, chunksDecoded: 1,
    })
    expect(firstRows.tunnels.find((tunnel) => tunnel.id === 'tunnel-root-2')?.status).toBe('sent')
    expect(laterPacket.result).toMatchObject({
      stage: 'rows_streaming', rootStreamCount: 2, chunksDecoded: 2, clientComplete: false,
    })
    expect(at(receipt, 'tiflash_root_streams_eof').result.stage).toBe('streams_eof')
  })

  it('replays every published learner/MPP snapshot from only its ordered typed deltas', () => {
    const receipt = fixture()
    let lab = receipt.events[0]!.snapshot!.tiflashMppLab!
    for (const event of receipt.events.slice(1)) {
      const deltas = event.deltas ?? []
      expect(deltas.length, event.kind).toBeGreaterThan(0)
      for (const delta of deltas) {
        if (!isTiFlashMppLabDelta(delta)) throw new Error(`Unexpected ${delta.kind}.`)
        lab = reduceTiFlashMppLabState(lab, delta)
      }
      expect(lab, event.kind).toEqual(event.snapshot!.tiflashMppLab)
    }
  })

  // LearnerReadWorker.cpp:386-395 calls waitIndex even when the replica has
  // already caught up during the RPC. Only an actual index gap needs waiting.
  it('releases ReadIndex immediately if independent replica application already caught up', () => {
    const returned = at(fixture(), 'tiflash_read_index_returned', false, 25)
    const release = {
      kind: 'tiflash_mpp_snapshot_gate', regionId: 25, action: 'ready_read_index',
    } as const
    expect(() => reduceTiFlashMppLabState(returned, release)).toThrow(/before learner apply/)
    const applied = apply(returned, [
      { kind: 'tiflash_replica_apply', regionId: 25, index: 251 },
      { kind: 'tiflash_replica_dm_flush', regionId: 25, index: 251, aggregateVersionCount: 1 },
      { kind: 'tiflash_replica_applied_advance', regionId: 25, from: 250, to: 251 },
    ])
    expect(applied.learners.find((learner) => learner.regionId === 25)?.readGate)
      .toBe('read_index_returned')
    expect(() => reduceTiFlashMppLabState(applied, {
      ...release, action: 'wait_applied',
    })).toThrow(/actual learner index gap/)
    expect(reduceTiFlashMppLabState(applied, release).learners.find((learner) =>
      learner.regionId === 25)).toMatchObject({
      readGate: 'ready', gateReason: 'read_index_applied', readIndexSkipped: false,
    })
  })

  // TiFlash 6e12ba23c70f358f2ffbee837feac24118a3e988:
  // LearnerReadWorker.cpp:386-419 waits for local apply and resolves locks;
  // DAGStorageInterpreter.cpp:615-629 does this before building storage readers.
  it('requires every owned Region MVCC gate while allowing the other scan task to lag', () => {
    let lab = at(fixture(), 'tiflash_mvcc_lock_checks_complete', true)

    expect(lab.learners.every((learner) => learner.readGate === 'ready')).toBe(true)
    expect(() => taskStage(lab, 'task-scan-1', 'scanning')).toThrow(/every owned Region MVCC gate/)
    lab = apply(lab, [24, 26].map((regionId) => ({
      kind: 'tiflash_mpp_snapshot_gate',
      regionId,
      action: 'lock_check',
      lockCount: 0,
    })))
    lab = taskStage(lab, 'task-scan-1', 'scanning')
    expect(lab.tasks.find((task) => task.id === 'task-scan-1')?.stage).toBe('scanning')
    expect(lab.learners.find((learner) => learner.regionId === 25)?.readGate).toBe('ready')
    expect(() => taskStage(lab, 'task-scan-2', 'scanning')).toThrow(/every owned Region MVCC gate/)

    lab = reduceTiFlashMppLabState(lab, {
      kind: 'tiflash_mpp_snapshot_gate', regionId: 25, action: 'lock_check', lockCount: 0,
    })
    expect(taskStage(lab, 'task-scan-2', 'scanning').tasks.every((task) =>
      task.fragmentId !== 'fragment-scan' || task.stage === 'scanning')).toBe(true)
  })

  // DAGStorageInterpreter.cpp:1034-1058 builds readers, then revalidates the
  // Region epoch/ranges before their output can be trusted after split/merge.
  it('prevents completed partial aggregation until the task Regions are revalidated', () => {
    let lab = at(fixture(), 'tiflash_dm_snapshot_scans_started')

    expect(() => taskStage(lab, 'task-scan-1', 'partial_aggregated')).toThrow(/post-read Region validation/)
    lab = apply(lab, [24, 26].map((regionId) => ({
      kind: 'tiflash_mpp_snapshot_gate', regionId, action: 'post_read_validate',
    })))
    lab = taskStage(lab, 'task-scan-1', 'partial_aggregated')
    expect(lab.learners.find((learner) => learner.regionId === 25)?.postReadValidated).toBe(false)
    expect(() => taskStage(lab, 'task-scan-2', 'partial_aggregated')).toThrow(/post-read Region validation/)
  })

  // TiDB d13e52ed6e22cc5789bed7c64c861578cd2ed55b fragment.go:353-428
  // connects every sender to the receiving fragment's tasks. The fixture
  // marks final hash aggregation complete after both sender partitions end:
  // TiFlash PhysicalAggregation.cpp:356-398 splits build/convergent pipelines;
  // AggregatingBlockInputStream.cpp:28-88 aggregates before returning output.
  it('requires both input partitions of each final task, rather than a global exchange barrier', () => {
    let lab = at(fixture(), 'tiflash_hash_exchange_received', true)
    lab = taskStage(lab, 'task-final-1', 'exchange_receiving')
    lab = receive(lab, 'tunnel-hash-1')
    expect(() => taskStage(lab, 'task-final-1', 'final_aggregated')).toThrow(/both received input partitions/)
    lab = receive(lab, 'tunnel-hash-3')
    lab = taskStage(lab, 'task-final-1', 'final_aggregated')
    expect(lab.tasks.find((task) => task.id === 'task-final-1')?.stage).toBe('final_aggregated')
    expect(lab.tasks.find((task) => task.id === 'task-final-2')?.stage).toBe('prepared')
    expect(lab.tunnels.filter((tunnel) => tunnel.targetTaskId === 'task-final-2')
      .every((tunnel) => tunnel.status === 'sent')).toBe(true)
  })

  // TiDB local_mpp_coordinator.go:499-524 forwards each independent root
  // stream to respChan; :676-681 yields the next packet without waiting for
  // other roots. conn.go:2318-2337 consumes Next before sending columns/rows.
  it('allows first response rows before the second root packet, and requires both streams before EOF', () => {
    const rootSent = at(fixture(), 'tiflash_root_passthrough_sent')
    const firstDecode = {
      kind: 'tiflash_mpp_result_stage',
      from: 'idle',
      to: 'chunks_decoded',
      rootStreamCount: 1,
      chunksDecoded: 1,
      rowsBucket: 'none',
    } as const
    expect(() => reduceTiFlashMppLabState(rootSent, firstDecode)).toThrow(/received root packet/)
    let lab = receive(rootSent, 'tunnel-root-1')
    expect(() => reduceTiFlashMppLabState(lab, {
      ...firstDecode, rootStreamCount: 2,
    })).toThrow(/packets received so far/)
    lab = apply(lab, [
      firstDecode,
      { ...firstDecode, from: 'chunks_decoded', to: 'columns_sent' },
      { ...firstDecode, from: 'columns_sent', to: 'rows_streaming', rowsBucket: 'small' },
    ])
    expect(lab.result).toMatchObject({ columnsSent: true, rootStreamCount: 1, chunksDecoded: 1 })
    expect(lab.tunnels.find((tunnel) => tunnel.id === 'tunnel-root-2')?.status).toBe('sent')
    expect(() => reduceTiFlashMppLabState(lab, {
      ...firstDecode, from: 'rows_streaming', to: 'streams_eof', rowsBucket: 'small',
    })).toThrow(/both fixture streams/)
    expect(() => reduceTiFlashMppLabState(lab, {
      ...firstDecode, from: 'rows_streaming', to: 'rows_streaming', rowsBucket: 'small',
    })).toThrow(/another decoded chunk/)

    lab = receive(lab, 'tunnel-root-2')
    lab = reduceTiFlashMppLabState(lab, {
      ...firstDecode, from: 'rows_streaming', to: 'rows_streaming',
      rootStreamCount: 2, chunksDecoded: 2, rowsBucket: 'small',
    })
    lab = reduceTiFlashMppLabState(lab, {
      ...firstDecode, from: 'rows_streaming', to: 'streams_eof',
      rootStreamCount: 2, chunksDecoded: 2, rowsBucket: 'small',
    })
    expect(lab.result.stage).toBe('streams_eof')
    expect(lab.result.clientComplete).toBe(false)
  })

  it('rejects duplicated sender links and misplaced scan Regions despite matching tunnel counts', () => {
    const lab = at(fixture(), 'tiflash_mpp_tunnels_planned')
    const firstHash = lab.tunnels.find((tunnel) => tunnel.id === 'tunnel-hash-1')!
    const duplicatePair: TraceTiFlashMppLabSnapshot = {
      ...lab,
      tunnels: lab.tunnels.map((tunnel) => tunnel.id === 'tunnel-hash-4'
        ? { ...firstHash, id: tunnel.id }
        : tunnel),
    }
    expect(() => observe(duplicatePair)).toThrow(/each scan-to-final task pair exactly once/)
    const duplicatedRoot: TraceTiFlashMppLabSnapshot = {
      ...lab,
      tunnels: lab.tunnels.map((tunnel) => tunnel.id === 'tunnel-root-2'
        ? { ...tunnel, sourceTaskId: 'task-final-1' }
        : tunnel),
    }
    expect(() => observe(duplicatedRoot)).toThrow(/one root stream from each final task/)
    const wrongStore: TraceTiFlashMppLabSnapshot = {
      ...lab,
      tasks: lab.tasks.map((task) => task.id === 'task-scan-1'
        ? { ...task, storeId: 'tiflash-2' }
        : task),
    }
    expect(() => observe(wrongStore)).toThrow(/task placement must match its selected learner Regions/)
  })
})

describe('compact TiFlash snapshot authority', () => {
  // LearnerReadWorker.cpp:127-155 skips ReadIndex only when a per-Region
  // selfSafeTS or cached ReadIndex proves this snapshot. Compact fresh reads
  // preserve neither proof, so require TiKV's live voter quorum for ReadIndex.
  it('fails a fresh analytical snapshot after two public voter outages', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const analysis = analyzeSql('SELECT * FROM accounts WHERE id = 425')
    for (let outage = 0; outage < 2; outage++) {
      simulation.requestTrace({ analysis, scenarioId: 'tikv-failover', regionIds: [0] })
    }
    const replicationBefore = {
      resolvedTs: simulation.state.tiflash.resolvedTs,
      pendingVersions: simulation.state.tiflash.pendingVersions,
    }
    expect(simulation.state.topology.tikv.filter((store) => store.status === 'down')).toHaveLength(2)
    const receipt = simulation.submitSql('SELECT COUNT(*) FROM events').receipt!

    expect(receipt.outcome).toBe('failed')
    expect(receipt.succeeded).toBe(false)
    expect(receipt.events.at(-1)?.kind).toBe('error')
    expect(receipt.events.some((event) => event.kind === 'complete')).toBe(false)
    expect(simulation.state.tiflash).toMatchObject(replicationBefore)
    expect(simulation.state.regions.every((region) =>
      region.peers.filter((peer) => peer.healthy).length === 1)).toBe(true)
  })

  it('can confirm a fresh analytical snapshot with two live voters without reviving the failed store', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.requestTrace({
      analysis: analyzeSql('SELECT * FROM accounts WHERE id = 425'),
      scenarioId: 'tikv-failover',
      regionIds: [0],
    })
    const failedStore = simulation.state.topology.tikv.find((store) => store.status === 'down')!
    const receipt = simulation.submitSql('SELECT COUNT(*) FROM events').receipt!

    expect(receipt.outcome).toBe('succeeded')
    expect(simulation.state.topology.tikv.find((store) => store.id === failedStore.id)?.status)
      .toBe('down')
    expect(simulation.state.regions.every((region) =>
      region.peers.find((peer) => peer.storeId === failedStore.id)?.healthy === false)).toBe(true)
  })
})
