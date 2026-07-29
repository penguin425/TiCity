/*
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ClusterNode,
  RegionPeerState,
  RegionState,
  StoreId,
  TiDBTopology,
} from './types'

export const INITIAL_REGION_COUNT = 36
export const KEYSPACE_END = 36_000_000

function node(
  id: string,
  kind: ClusterNode['kind'],
  index: number,
  leader = false,
): ClusterNode {
  const zone = (['zone-a', 'zone-b', 'zone-c'] as const)[index % 3]
  return {
    id,
    kind,
    label: id,
    zone,
    status: 'up',
    leader,
  }
}

export function createTopology(): TiDBTopology {
  return {
    tiproxy: [
      node('tiproxy-1', 'tiproxy', 0),
      node('tiproxy-2', 'tiproxy', 1),
    ],
    tidb: [
      node('tidb-1', 'tidb', 0),
      node('tidb-2', 'tidb', 1),
      node('tidb-3', 'tidb', 2),
    ],
    pd: [
      node('pd-1', 'pd', 0, true),
      node('pd-2', 'pd', 1),
      node('pd-3', 'pd', 2),
    ],
    tikv: [
      node('tikv-1', 'tikv', 0),
      node('tikv-2', 'tikv', 1),
      node('tikv-3', 'tikv', 2),
    ],
    tiflash: [
      node('tiflash-1', 'tiflash', 1),
    ],
  }
}

function createPeers(leaderStoreId: StoreId): RegionPeerState[] {
  return (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
    storeId,
    role: 'voter',
    raftRole: storeId === leaderStoreId ? 'leader' : 'follower',
    matchIndex: 0,
    appliedIndex: 0,
    healthy: true,
  }))
}

export function createRegions(): RegionState[] {
  const width = KEYSPACE_END / INITIAL_REGION_COUNT
  const stores: StoreId[] = ['tikv-1', 'tikv-2', 'tikv-3']
  const regions: RegionState[] = []

  for (let index = 0; index < INITIAL_REGION_COUNT; index++) {
    const leaderStoreId = stores[index % stores.length]
    regions.push({
      id: index,
      startKey: index * width,
      endKey: (index + 1) * width,
      peers: createPeers(leaderStoreId),
      leaderStoreId,
      term: 1,
      commitIndex: 0,
      appliedIndex: 0,
      sizeMiB: 42 + (index % 7),
      hotScore: 0,
      epoch: 1,
      health: 'healthy',
      /* The last third represents the analytical `events` key range. */
      tiflashReplica: index >= INITIAL_REGION_COUNT * 2 / 3,
    })
  }

  return regions
}

export function regionForKey(regions: readonly RegionState[], key: number): RegionState {
  let low = 0
  let high = regions.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const region = regions[middle]
    if (key < region.startKey) {
      high = middle - 1
    } else if (key >= region.endKey) {
      low = middle + 1
    } else {
      return region
    }
  }
  return key < regions[0].startKey ? regions[0] : regions[regions.length - 1]
}

export function clonePeers(peers: readonly RegionPeerState[]): RegionPeerState[] {
  return peers.map((peer) => ({ ...peer }))
}
