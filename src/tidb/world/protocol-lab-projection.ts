/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Pure model-to-renderer projection for the fixed three-lane commit-protocol
 * comparison. It never reconstructs transaction state from event labels.
 */

import type {
  StoreId,
  TraceEvent,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolRegionSnapshot,
} from '../model/types'
import {
  PROTOCOL_LAB_LANE_CAPACITY,
  PROTOCOL_LAB_REGION_CAPACITY_PER_LANE,
  type ProtocolLabLanePath,
  type ProtocolLabLaneProjection,
  type ProtocolLabPeerProjection,
  type ProtocolLabProjection,
  type ProtocolLabRegionProjection,
} from './protocol-lab'

export interface ProtocolLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

const LANE_ORDER = Object.freeze([
  'one_pc',
  'async_commit',
  'two_pc',
] as const)

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function lanePath(lane: TraceProtocolLaneSnapshot): ProtocolLabLanePath {
  if (lane.stage === 'idle') return 'idle'
  if (lane.stage === 'complete' || lane.backgroundComplete) return 'complete'
  if (lane.stage === 'client_acknowledged') return 'client-boundary'
  if (lane.stage === 'background' || lane.clientResponded) return 'background'
  return 'critical'
}

function timestampStage(
  lane: TraceProtocolLaneSnapshot,
): ProtocolLabLaneProjection['timestampStage'] {
  if (lane.commitTs !== null) return 'commit'
  if (lane.latestTs !== null) return 'latest'
  if (lane.startTs !== null) return 'start'
  return 'none'
}

function protocolShape(
  laneId: TraceProtocolLaneId,
): ProtocolLabLaneProjection['shape'] {
  switch (laneId) {
    case 'one_pc':
      return 'triangle'
    case 'async_commit':
      return 'diamond'
    case 'two_pc':
      return 'cylinder'
  }
}

function peerProjection(
  region: TraceProtocolRegionSnapshot,
  storeId: StoreId,
): ProtocolLabPeerProjection {
  const leader = storeId === region.leaderStoreId
  let log: ProtocolLabPeerProjection['log'] = 'idle'
  if (region.raft.stage === 'proposed') {
    if (leader) log = 'proposed'
  } else if (region.raft.stage === 'persisted_quorum') {
    if (region.raft.persistedStoreIds.includes(storeId)) {
      log = 'persisted'
    }
  } else if (
    region.raft.stage === 'committed' ||
    region.raft.stage === 'applied'
  ) {
    if (region.raft.persistedStoreIds.includes(storeId)) {
      log = 'committed'
    }
  }
  return {
    storeId,
    leader,
    log,
  }
}

function hiddenPeer(): ProtocolLabPeerProjection {
  return {
    storeId: '',
    leader: false,
    log: 'idle',
  }
}

function hiddenRegion(): ProtocolLabRegionProjection {
  return {
    visible: false,
    regionId: -1,
    role: 'secondary',
    leaderPeer: -1,
    operation: null,
    raftStage: 'idle',
    peers: [hiddenPeer(), hiddenPeer(), hiddenPeer()],
    quorum: {
      acknowledgements: 0,
      required: 2,
      reached: false,
    },
    applied: false,
    mvcc: {
      default: 'empty',
      lock: 'empty',
      write: 'empty',
      asyncCommit: false,
      secondaryCount: 0,
    },
    returnedMinCommitTs: false,
  }
}

function regionProjection(
  region: TraceProtocolRegionSnapshot,
): ProtocolLabRegionProjection {
  const storeIds = [...region.voterStoreIds]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 3)
  const peers = storeIds.map((storeId) =>
    peerProjection(region, storeId))
  while (peers.length < 3) peers.push(hiddenPeer())
  const leaderPeer = storeIds.findIndex(
    (storeId) => storeId === region.leaderStoreId,
  )
  return {
    visible: true,
    regionId: region.regionId,
    role: region.role,
    leaderPeer:
      leaderPeer >= 0 && leaderPeer < 3
        ? leaderPeer as 0 | 1 | 2
        : -1,
    operation: region.raft.operation,
    raftStage: region.raft.stage,
    peers: peers as unknown as ProtocolLabRegionProjection['peers'],
    quorum: {
      acknowledgements: clamp(region.raft.acknowledgements, 0, 3),
      required: 2,
      reached: region.raft.acknowledgements >= region.raft.quorum,
    },
    applied: region.raft.stage === 'applied',
    mvcc: {
      default: region.mvcc.defaultCf,
      lock: region.mvcc.lockCf,
      write: region.mvcc.writeCf,
      asyncCommit: region.mvcc.asyncCommit,
      secondaryCount: region.mvcc.secondaryCount,
    },
    returnedMinCommitTs: region.returnedMinCommitTs !== null,
  }
}

function hiddenLane(id: TraceProtocolLaneId): ProtocolLabLaneProjection {
  return {
    visible: false,
    id,
    protocol:
      id === 'one_pc' ? '1pc'
        : id === 'async_commit' ? 'async_commit'
          : '2pc',
    shape: protocolShape(id),
    focused: false,
    stage: 'idle',
    path: 'idle',
    timestampStage: 'none',
    clientResponded: false,
    backgroundComplete: false,
    regions: [hiddenRegion(), hiddenRegion()],
    overflowRegions: 0,
  }
}

function laneProjection(
  lane: TraceProtocolLaneSnapshot,
  focused: boolean,
): ProtocolLabLaneProjection {
  const projectedRegions = lane.regions
    .slice(0, PROTOCOL_LAB_REGION_CAPACITY_PER_LANE)
    .map(regionProjection)
  while (projectedRegions.length < PROTOCOL_LAB_REGION_CAPACITY_PER_LANE) {
    projectedRegions.push(hiddenRegion())
  }
  return {
    visible: true,
    id: lane.id,
    protocol: lane.protocol,
    shape: protocolShape(lane.id),
    focused,
    stage: lane.stage,
    path: lanePath(lane),
    timestampStage: timestampStage(lane),
    clientResponded: lane.clientResponded,
    backgroundComplete: lane.backgroundComplete,
    regions:
      projectedRegions as unknown as ProtocolLabLaneProjection['regions'],
    overflowRegions: Math.max(
      0,
      lane.regions.length - PROTOCOL_LAB_REGION_CAPACITY_PER_LANE,
    ),
  }
}

export function projectProtocolLab(
  event: TraceEvent | null,
  options: ProtocolLabProjectionOptions,
): ProtocolLabProjection | null {
  const protocolLab = event?.snapshot?.protocolLab
  if (!event || !protocolLab) return null

  const lanes = LANE_ORDER.map((laneId) => {
    const lane = protocolLab.lanes.find((candidate) =>
      candidate.id === laneId)
    return lane
      ? laneProjection(lane, protocolLab.focusLaneId === laneId)
      : hiddenLane(laneId)
  })
  const overflowRegions = lanes.reduce(
    (total, lane) => total + lane.overflowRegions,
    0,
  )
  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: protocolLab.phase,
    reducedMotion: options.reducedMotion,
    pulse: clamp(options.pulse ?? 0, 0, 1),
    focusLaneId: protocolLab.focusLaneId,
    lanes: lanes as unknown as ProtocolLabProjection['lanes'],
    capacities: {
      lanes: PROTOCOL_LAB_LANE_CAPACITY,
      regionsPerLane: PROTOCOL_LAB_REGION_CAPACITY_PER_LANE,
      votersPerRegion: 3,
    },
    overflowRegions,
  }
}
