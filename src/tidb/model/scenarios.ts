/*
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CommitProtocol,
  ScenarioId,
  TiDBControls,
} from './types'

export interface TiDBScenarioDefinition {
  id: ScenarioId
  name: string
  description: string
  sql: string
  controls: Partial<TiDBControls>
  regionIds: readonly number[]
  forceProtocol?: CommitProtocol
  forceConflict?: boolean
}

export const TIDB_SCENARIOS: readonly TiDBScenarioDefinition[] = [
  {
    id: 'point-read',
    name: 'Point read and Region routing',
    description: 'Route one primary-key lookup through TiDB to a TiKV Region leader.',
    sql: 'SELECT * FROM accounts WHERE id = 425',
    controls: { readPolicy: 'leader' },
    regionIds: [0],
  },
  {
    id: 'cross-region-transaction',
    name: 'Cross-Region pessimistic transaction',
    description: 'Keep distributed transaction 2PC separate from each Region Raft quorum.',
    sql: 'UPDATE accounts SET balance = balance + 1 WHERE id = 425',
    controls: { transactionMode: 'pessimistic', commitProtocol: '2pc' },
    /* Region 0 and Region 19 have different leaders in the teaching topology. */
    regionIds: [0, 19],
    forceProtocol: '2pc',
  },
  {
    id: 'optimistic-conflict',
    name: 'Optimistic write conflict',
    description: 'Detect a conflicting version during prewrite and roll COMMIT back.',
    sql: 'UPDATE inventory SET stock = stock - 1 WHERE sku = "A-425"',
    controls: { transactionMode: 'optimistic', commitProtocol: '2pc' },
    regionIds: [6, 7],
    forceProtocol: '2pc',
    forceConflict: true,
  },
  {
    id: 'lock-deadlock',
    name: 'Pessimistic lock deadlock and retry',
    description: 'Inspect leader-memory lock queues, a wait-for cycle, victim rollback, and an application retry.',
    sql: 'UPDATE inventory SET stock = stock - 1 WHERE sku = "LOCK-LAB-425"',
    controls: { transactionMode: 'pessimistic', commitProtocol: '2pc' },
    /* Two synthetic resources on Regions with different leaders. */
    regionIds: [6, 7],
    forceProtocol: '2pc',
  },
  {
    id: 'commit-protocols',
    name: '1PC, Async Commit, and 2PC',
    description: 'Compare 1PC, Async Commit, and classic 2PC without conflating them with Region Raft.',
    sql: 'INSERT INTO events (id, account_id) VALUES (425, 7)',
    controls: { commitProtocol: 'auto', transactionMode: 'optimistic' },
    regionIds: [24],
    forceProtocol: 'auto',
  },
  {
    id: 'hotspot-split',
    name: 'Sequential hotspot and Region split',
    description: 'Grow the right-most Region, split its key range, and redistribute heat.',
    sql: 'INSERT INTO events (id, account_id) VALUES (999999, 7)',
    controls: { keyDistribution: 'sequential', regionSplitThresholdMiB: 64 },
    regionIds: [35],
  },
  {
    id: 'tikv-failover',
    name: 'TiKV failure and leader election',
    description: 'Lose a Region leader, retain quorum, and elect a live voter.',
    sql: 'SELECT * FROM accounts WHERE id = 425',
    controls: {},
    regionIds: [0],
  },
  {
    id: 'gc-safe-point',
    name: 'GC safe point and storage compaction',
    description: 'Follow two GC rounds from a start_ts bound through locks, ranges, PD, and TiKV Compaction Filters.',
    sql: 'UPDATE orders SET status = "archived" WHERE id = 425',
    controls: { gcLifetimeSeconds: 600, transactionMode: 'pessimistic' },
    regionIds: [8, 20],
    forceProtocol: '2pc',
  },
  {
    id: 'tiflash-mpp',
    name: 'TiFlash catch-up and MPP query',
    description: 'Replicate through TiKV Raft first, then read a resolved TiFlash snapshot.',
    sql: 'SELECT account_id, count(*) FROM events GROUP BY account_id',
    controls: { tiflashLagSeconds: 2 },
    regionIds: [24, 25, 26],
  },
] as const

const SCENARIO_BY_ID = new Map(TIDB_SCENARIOS.map((scenario) => [scenario.id, scenario]))

export function getScenario(id: ScenarioId): TiDBScenarioDefinition {
  const scenario = SCENARIO_BY_ID.get(id)
  if (!scenario) throw new Error(`Unknown TiCity scenario: ${id}`)
  return scenario
}
