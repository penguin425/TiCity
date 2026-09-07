// SPDX-License-Identifier: Apache-2.0

import type { CityComponent } from '../world/city'
import type { SemanticDomain } from '../world/palette'
import type { Locale } from './catalog'

export interface CityComponentCopy {
  readonly name: string
  readonly role: string
  readonly domain: string
  readonly disclosure: 'MODEL / SIMULATED'
}

interface ComponentLocaleCopy {
  readonly clientName: string
  readonly tiproxyName: string
  readonly tidbName: string
  readonly pdControlName: string
  readonly pdName: string
  readonly tikvName: string
  readonly regionPeerName: string
  readonly regionPeerFullName: (region: number, store: number) => string
  readonly gcName: string
  readonly tiflashName: string
  readonly clientRole: string
  readonly tiproxyRole: string
  readonly tidbRole: string
  readonly pdControlRole: string
  readonly pdLeaderRole: string
  readonly pdFollowerRole: string
  readonly tikvRole: string
  readonly regionLeaderRole: string
  readonly regionFollowerRole: string
  readonly regionUnavailableRole: string
  readonly gcRole: string
  readonly tiflashRole: string
  readonly unknownRole: string
  readonly unknownName: string
  readonly domains: Readonly<Record<SemanticDomain, string>>
}

const COPY: Readonly<Record<Locale, ComponentLocaleCopy>> = {
  ja: {
    clientName: 'クライアント',
    tiproxyName: 'TiProxy',
    tidbName: 'TiDB サーバー',
    pdControlName: 'PD 制御プレーン',
    pdName: 'PD',
    tikvName: 'TiKV ストア',
    regionPeerName: 'Regionピア',
    regionPeerFullName: (region, store) => `Regionピア · Region ${region} / TiKV ${store}`,
    gcName: 'MVCC GC',
    tiflashName: 'TiFlash',
    clientRole: 'MySQLプロトコルを話すアプリケーション',
    tiproxyRole: '接続ルーティングと負荷分散',
    tidbRole: 'ステートレスなSQL解析・計画・分散実行',
    pdControlRole: 'タイムスタンプ・メタデータ・スケジューリング（行データ経路ではない）',
    pdLeaderRole: 'PDリーダーとTSOサービス',
    pdFollowerRole: 'PDフォロワー',
    tikvRole: '多数の独立したRaftグループのpeerをホストするストレージノード',
    regionLeaderRole: 'Raftリーダー投票者',
    regionFollowerRole: 'Raftフォロワー投票者',
    regionUnavailableRole: '利用不可のRaft投票者',
    gcRole: 'GCセーフポイント・Resolve Locks・古いバージョンの回収',
    tiflashRole: '非同期learner複製と列指向分析実行',
    unknownRole: 'TiCity教育モデルのコンポーネント',
    unknownName: 'コンポーネント',
    domains: {
      structure: '構造',
      client: 'クライアント',
      sql: 'SQL / データ経路',
      tso: 'TSO / 制御',
      txn2pc: 'トランザクション 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      gc: 'MVCC GC',
      tiflash: 'TiFlash / MPP',
      return: '応答',
      fault: '障害',
    },
  },
  en: {
    clientName: 'Client workloads',
    tiproxyName: 'TiProxy',
    tidbName: 'TiDB Server',
    pdControlName: 'PD control plane',
    pdName: 'PD',
    tikvName: 'TiKV Store',
    regionPeerName: 'Region peer',
    regionPeerFullName: (region, store) => `Region ${region} peer on TiKV ${store}`,
    gcName: 'MVCC GC yard',
    tiflashName: 'TiFlash learner and MPP',
    clientRole: 'Applications speaking the MySQL protocol',
    tiproxyRole: 'Connection routing and load balancing',
    tidbRole: 'Stateless SQL parsing, planning, and distributed execution',
    pdControlRole: 'Timestamp oracle, metadata, and scheduling — not a row data path',
    pdLeaderRole: 'PD leader and TSO service',
    pdFollowerRole: 'PD follower',
    tikvRole: 'A storage node hosting peers for many independent Raft groups',
    regionLeaderRole: 'Raft leader voter',
    regionFollowerRole: 'Raft follower voter',
    regionUnavailableRole: 'Unavailable Raft voter',
    gcRole: 'GC safe point, Resolve Locks, and obsolete-version cleanup',
    tiflashRole: 'Asynchronous learner replication and columnar analytical execution',
    unknownRole: 'A component in the TiCity educational model',
    unknownName: 'Component',
    domains: {
      structure: 'Structure',
      client: 'Client',
      sql: 'SQL / data route',
      tso: 'TSO / control',
      txn2pc: 'Transaction 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      gc: 'MVCC GC',
      tiflash: 'TiFlash / MPP',
      return: 'Response',
      fault: 'Fault',
    },
  },
}

const DISCLOSURE = 'MODEL / SIMULATED' as const

function idIndex(id: string, prefix: string): number | null {
  if (!id.startsWith(prefix)) return null
  const value = Number(id.slice(prefix.length))
  return Number.isInteger(value) && value >= 0 ? value : null
}

function indexed(base: string, index: number | null, fallback: string): string {
  return index === null ? fallback : `${base} ${index + 1}`
}

function componentName(copy: ComponentLocaleCopy, component: CityComponent): string {
  switch (component.kind) {
    case 'client':
      return copy.clientName
    case 'tiproxy':
      return indexed(copy.tiproxyName, idIndex(component.id, 'tiproxy.'), copy.tiproxyName)
    case 'tidb':
      return indexed(copy.tidbName, idIndex(component.id, 'tidb.'), copy.tidbName)
    case 'pd':
      return component.id === 'pd.control'
        ? copy.pdControlName
        : indexed(copy.pdName, idIndex(component.id, 'pd.'), copy.pdName)
    case 'tikv':
      return indexed(copy.tikvName, idIndex(component.id, 'tikv.'), copy.tikvName)
    case 'region-peer': {
      // Region ids are canonical model identifiers, not one-based display
      // indices. Keep selection consistent with trace, Machine and Diagnose.
      const region = component.regionId ?? null
      const store = component.storeId === undefined ? null : component.storeId + 1
      if (region === null || store === null) return copy.regionPeerName
      return copy.regionPeerFullName(region, store)
    }
    case 'gc':
      return copy.gcName
    case 'tiflash':
      return copy.tiflashName
    default:
      return copy.unknownName
  }
}

function componentRole(copy: ComponentLocaleCopy, component: CityComponent): string {
  switch (component.kind) {
    case 'client':
      return copy.clientRole
    case 'tiproxy':
      return copy.tiproxyRole
    case 'tidb':
      return copy.tidbRole
    case 'pd':
      return component.id === 'pd.0' ? copy.pdLeaderRole
        : component.id === 'pd.control' ? copy.pdControlRole
          : copy.pdFollowerRole
    case 'tikv':
      return copy.tikvRole
    case 'region-peer':
      return component.domain === 'fault'
        ? copy.regionUnavailableRole
        : component.peerRole === 'leader'
          ? copy.regionLeaderRole
          : copy.regionFollowerRole
    case 'gc':
      return copy.gcRole
    case 'tiflash':
      return copy.tiflashRole
    default:
      return copy.unknownRole
  }
}

export function projectCityComponent(
  locale: Locale,
  component: CityComponent,
): CityComponentCopy {
  const copy = COPY[locale]
  return {
    name: componentName(copy, component),
    role: componentRole(copy, component),
    domain: copy.domains[component.domain],
    disclosure: DISCLOSURE,
  }
}

export { DISCLOSURE as MODEL_DISCLOSURE }
