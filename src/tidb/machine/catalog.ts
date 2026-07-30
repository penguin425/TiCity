// SPDX-License-Identifier: Apache-2.0

import type { ScenarioId } from '../model/types'
import type { Locale } from '../ui/catalog'

export const MACHINE_SCENARIOS: readonly ScenarioId[] = [
  'point-read',
  'cross-region-transaction',
  'optimistic-conflict',
  'lock-deadlock',
  'commit-protocols',
  'hotspot-split',
  'tikv-failover',
  'gc-safe-point',
  'tiflash-mpp',
]

interface MachinePageCopy {
  scenario: string
  names: Readonly<Record<ScenarioId, string>>
}

export const MACHINE_PAGE_COPY: Readonly<Record<Locale, MachinePageCopy>> = {
  ja: {
    scenario: '再生するシナリオ',
    names: {
      'point-read': 'Point Readとルーティング',
      'cross-region-transaction': '複数Regionの悲観トランザクション',
      'optimistic-conflict': '楽観トランザクションの競合',
      'lock-deadlock': 'ロック待機、デッドロック、アプリケーション再試行',
      'commit-protocols': '1PC／Async Commit／2PC',
      'hotspot-split': 'hotspot、split、rebalance',
      'tikv-failover': 'TiKV障害とleader election',
      'gc-safe-point': '長時間transactionとGC safe point',
      'tiflash-mpp': 'TiFlash learner複製とMPP Exchange',
    },
  },
  en: {
    scenario: 'Scenario to replay',
    names: {
      'point-read': 'Point read and routing',
      'cross-region-transaction': 'Cross-Region pessimistic transaction',
      'optimistic-conflict': 'Optimistic transaction conflict',
      'lock-deadlock': 'Lock wait, deadlock, and application retry',
      'commit-protocols': '1PC / Async Commit / 2PC',
      'hotspot-split': 'Hotspot, split, and rebalance',
      'tikv-failover': 'TiKV failure and leader election',
      'gc-safe-point': 'Long transaction and GC safe point',
      'tiflash-mpp': 'TiFlash learner replication and MPP Exchange',
    },
  },
}

export function resolveMachineScenario(search: string): ScenarioId {
  const value = new URLSearchParams(search).get('scenario')
  return MACHINE_SCENARIOS.includes(value as ScenarioId)
    ? value as ScenarioId
    : 'cross-region-transaction'
}
