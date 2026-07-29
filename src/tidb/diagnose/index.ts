// SPDX-License-Identifier: Apache-2.0

import type { TiDBCityState } from '../model/types'
import { CATALOG, resolveLocale, type Locale } from '../ui/catalog'
import { element } from '../ui/dom'
import { createModelBadge } from '../ui/legal'
import { installCityUiStyles } from '../ui/styles'
import { installDiagnoseStyles } from './styles'

export { DIAGNOSE_CSS, installDiagnoseStyles } from './styles'

export const DIAGNOSE_SECTIONS = [
  'cluster',
  'transactions',
  'hot-regions',
  'regions',
  'gc',
  'tiflash',
] as const
export type DiagnoseSection = (typeof DIAGNOSE_SECTIONS)[number]

export type DiagnosticRow = Readonly<Record<string, string>>

export interface DiagnosticProjection {
  id: DiagnoseSection
  label: 'MODEL / SIMULATED'
  rows: readonly DiagnosticRow[]
}

export interface SymptomGuide {
  id: string
  ja: { symptom: string; guidance: string }
  en: { symptom: string; guidance: string }
  sql: string
}

export const SYMPTOM_GUIDES: readonly SymptomGuide[] = [
  {
    id: 'slow-query',
    ja: {
      symptom: 'queryが急に遅い',
      guidance: 'slow query、実行計画、TiKV/TiFlashのtask時間を同じ時間帯で確認します。',
    },
    en: {
      symptom: 'Queries suddenly became slow',
      guidance: 'Correlate slow queries, plans, and TiKV or TiFlash task time in the same interval.',
    },
    sql: `SELECT time, query_time, digest, query
FROM INFORMATION_SCHEMA.CLUSTER_SLOW_QUERY
ORDER BY time DESC LIMIT 20;`,
  },
  {
    id: 'lock-wait',
    ja: {
      symptom: 'transactionがlock待ちになる',
      guidance: 'waiting transaction、blocking transaction、primary keyを特定して長時間transactionを調べます。',
    },
    en: {
      symptom: 'Transactions are waiting on locks',
      guidance: 'Identify waiting and blocking transactions and their primary keys, then inspect long transactions.',
    },
    sql: `SELECT * FROM INFORMATION_SCHEMA.DATA_LOCK_WAITS
ORDER BY KEY_INFO LIMIT 50;`,
  },
  {
    id: 'hot-region',
    ja: {
      symptom: '一部のTiKVだけが高負荷',
      guidance: 'hot Regionとleader分布を確認し、順序keyや偏ったaccess patternを疑います。',
    },
    en: {
      symptom: 'Only some TiKV stores are overloaded',
      guidance: 'Inspect hot Regions and leader distribution, then look for sequential keys or skewed access.',
    },
    sql: `SELECT h.TABLE_NAME, h.INDEX_NAME, h.REGION_ID, p.STORE_ID,
       h.TYPE, h.MAX_HOT_DEGREE, h.FLOW_BYTES
FROM INFORMATION_SCHEMA.TIDB_HOT_REGIONS AS h
LEFT JOIN INFORMATION_SCHEMA.TIKV_REGION_PEERS AS p
  ON p.REGION_ID = h.REGION_ID AND p.IS_LEADER = 1
ORDER BY h.FLOW_BYTES DESC LIMIT 50;`,
  },
  {
    id: 'region-health',
    ja: {
      symptom: 'writeが止まる、Regionが利用不能',
      guidance: '各peerのleader、learner、稼働状態、down時間を確認します。voterのquorum喪失中は安全なwriteを続行できません。',
    },
    en: {
      symptom: 'Writes stop or a Region is unavailable',
      guidance: 'Inspect each peer’s leader, learner, status, and down time. Safe writes cannot continue without a voter quorum.',
    },
    sql: `SELECT r.REGION_ID, r.START_KEY, r.END_KEY, r.APPROXIMATE_SIZE,
       p.PEER_ID, p.STORE_ID, p.IS_LEARNER, p.IS_LEADER,
       p.STATUS, p.DOWN_SECONDS
FROM INFORMATION_SCHEMA.TIKV_REGION_STATUS AS r
JOIN INFORMATION_SCHEMA.TIKV_REGION_PEERS AS p
  ON p.REGION_ID = r.REGION_ID
ORDER BY r.REGION_ID, p.IS_LEADER DESC, p.STORE_ID
LIMIT 300;`,
  },
  {
    id: 'gc-backlog',
    ja: {
      symptom: 'MVCC versionとstorage使用量が増える',
      guidance: 'GC safe point、retention、最大待機時間と長時間transactionを確認し、古いsnapshotが進行を止めていないか調べます。',
    },
    en: {
      symptom: 'MVCC versions and storage keep growing',
      guidance: 'Check the GC safe point, retention, maximum wait, and long transactions for an old snapshot holding back progress.',
    },
    sql: `SELECT
  @@GLOBAL.tidb_gc_life_time AS GC_LIFE_TIME,
  @@GLOBAL.tidb_gc_max_wait_time AS GC_MAX_WAIT_TIME,
  VARIABLE_VALUE AS GC_SAFE_POINT
FROM mysql.tidb
WHERE VARIABLE_NAME = 'tikv_gc_safe_point';`,
  },
  {
    id: 'tiflash-lag',
    ja: {
      symptom: 'TiFlashが選ばれない、分析queryが待機・timeoutする',
      guidance: 'TiFlashは要求snapshotまで複製が進むのを待ちます。lagは古い結果ではなく待機やtimeoutとして現れるため、AVAILABLEとPROGRESSを確認します。',
    },
    en: {
      symptom: 'TiFlash is not chosen, or analytical queries wait or time out',
      guidance: 'TiFlash waits until replication covers the requested snapshot. Lag appears as waiting or timeout, not stale results, so check AVAILABLE and PROGRESS.',
    },
    sql: `SELECT TABLE_SCHEMA, TABLE_NAME, REPLICA_COUNT, LOCATION_LABELS, AVAILABLE, PROGRESS
FROM INFORMATION_SCHEMA.TIFLASH_REPLICA
ORDER BY TABLE_SCHEMA, TABLE_NAME;`,
  },
] as const

const SECTION_TITLES: Record<Locale, Record<DiagnoseSection, string>> = {
  ja: {
    cluster: 'Cluster topology',
    transactions: 'Transactions / locks',
    'hot-regions': 'Hot Regions',
    regions: 'Regions / stores',
    gc: 'MVCC / GC',
    tiflash: 'TiFlash replicas',
  },
  en: {
    cluster: 'Cluster topology',
    transactions: 'Transactions / locks',
    'hot-regions': 'Hot Regions',
    regions: 'Regions / stores',
    gc: 'MVCC / GC',
    tiflash: 'TiFlash replicas',
  },
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function value(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && !Number.isFinite(value)) return '—'
  return String(value)
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return undefined
}

function clusterRows(state: Record<string, unknown>): DiagnosticRow[] {
  const topology = record(state.topology)
  const listed = array(topology.nodes)
  const nodes = listed.length > 0
    ? listed
    : ['tiproxy', 'tidb', 'pd', 'tikv', 'tiflash'].flatMap((kind) => array(topology[kind]))
  return nodes.map((entry) => {
    const node = record(entry)
    return {
      id: value(node.id),
      kind: value(node.kind),
      status: value(node.status),
      role: value(node.role ?? (node.leader === true ? 'leader' : 'member')),
      zone: value(node.zone),
    }
  })
}

function transactionRows(state: Record<string, unknown>): DiagnosticRow[] {
  return array(state.transactions).map((entry) => {
    const transaction = record(entry)
    return {
      id: value(transaction.id),
      mode: value(transaction.mode),
      phase: value(pick(transaction, 'phase', 'state')),
      protocol: value(transaction.protocol),
      startTs: value(transaction.startTs),
      commitTs: value(transaction.commitTs),
      regions: value(pick(transaction, 'regionIds', 'regions')),
      primaryRegion: value(pick(transaction, 'primaryRegionId', 'primaryRegion')),
      lockAgeMs: value(transaction.lockAgeMs),
      conflict: value(transaction.conflict),
    }
  })
}

function regionSource(state: Record<string, unknown>): Record<string, unknown>[] {
  return array(state.regions).map(record)
}

function hotRegionRows(state: Record<string, unknown>): DiagnosticRow[] {
  return regionSource(state)
    .filter((region) => Number(region.hotScore ?? 0) > 0)
    .sort((a, b) => Number(b.hotScore ?? 0) - Number(a.hotScore ?? 0))
    .map((region) => ({
      id: value(region.id),
      leader: value(pick(region, 'leaderStoreId', 'leader')),
      sizeMiB: value(region.sizeMiB),
      hotScore: value(region.hotScore),
      health: value(region.health),
    }))
}

function regionRows(state: Record<string, unknown>): DiagnosticRow[] {
  return regionSource(state).map((region) => {
    const peerIds = array(pick(region, 'peerStoreIds', 'peers')).map((peer) => {
      const peerRecord = record(peer)
      return peerRecord.storeId === undefined ? value(peer) : value(peerRecord.storeId)
    })
    const range = region.startKey !== undefined || region.endKey !== undefined
      ? `[${value(region.startKey)}, ${value(region.endKey)})`
      : '—'
    return {
      id: value(region.id),
      range,
      leader: value(pick(region, 'leaderStoreId', 'leader')),
      peers: peerIds.join(', ') || '—',
      term: value(region.term),
      commitIndex: value(region.commitIndex),
      appliedIndex: value(region.appliedIndex),
      epoch: value(region.epoch),
      health: value(region.health),
    }
  })
}

function gcRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gc = record(state.gc)
  if (Object.keys(gc).length === 0) return []
  return [{
    safePoint: value(gc.safePoint),
    blockedBy: value(pick(gc, 'blockedBy', 'blockedByStartTs')),
    backlog: value(pick(gc, 'backlog', 'backlogVersions')),
    obsoleteVersions: value(gc.obsoleteVersions),
    collectedVersions: value(gc.collectedVersions),
  }]
}

function tiflashRows(state: Record<string, unknown>): DiagnosticRow[] {
  const tiflash = record(state.tiflash)
  if (Object.keys(tiflash).length === 0) return []
  return [{
    available: value(pick(tiflash, 'available', 'ready')),
    resolvedTs: value(tiflash.resolvedTs),
    targetTs: value(tiflash.targetTs),
    lagSeconds: value(pick(tiflash, 'lagSeconds', 'lagMs')),
    progress: value(tiflash.progress),
    pendingVersions: value(tiflash.pendingVersions),
    mppQueries: value(tiflash.mppQueries),
  }]
}

export function projectDiagnostics(snapshot: TiDBCityState | unknown): DiagnosticProjection[] {
  const state = record(snapshot)
  const sources: Record<DiagnoseSection, () => DiagnosticRow[]> = {
    cluster: () => clusterRows(state),
    transactions: () => transactionRows(state),
    'hot-regions': () => hotRegionRows(state),
    regions: () => regionRows(state),
    gc: () => gcRows(state),
    tiflash: () => tiflashRows(state),
  }
  return DIAGNOSE_SECTIONS.map((id) => ({
    id,
    label: 'MODEL / SIMULATED',
    rows: sources[id](),
  }))
}

export interface DiagnoseOptions {
  snapshot: TiDBCityState | unknown
  locale?: Locale
  search?: string
  project?: (snapshot: unknown) => readonly DiagnosticProjection[]
}

function projectionTable(
  locale: Locale,
  projection: DiagnosticProjection,
): HTMLElement {
  const panel = element('section', {
    className: 'tidb-diagnose__panel',
    attrs: { 'data-diagnose-section': projection.id },
  })
  panel.append(
    element('div', { className: 'tidb-diagnose__panel-head' },
      element('h2', { text: SECTION_TITLES[locale][projection.id] }),
      createModelBadge(locale),
    ),
  )
  if (projection.rows.length === 0) {
    panel.append(element('p', { className: 'tidb-diagnose__empty', text: CATALOG[locale].noRows }))
    return panel
  }

  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of projection.rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  const head = element('tr')
  for (const column of columns) head.append(element('th', { text: column, attrs: { scope: 'col' } }))
  const body = element('tbody')
  for (const row of projection.rows) {
    const line = element('tr')
    for (const column of columns) line.append(element('td', { text: row[column] ?? '—' }))
    body.append(line)
  }
  panel.append(element('div', {
    className: 'tidb-diagnose__scroll',
    attrs: {
      tabindex: '0',
      role: 'region',
      'aria-label': `${SECTION_TITLES[locale][projection.id]} table`,
    },
  },
    element('table', { className: 'tidb-diagnose__table' },
      element('thead', {}, head),
      body,
    ),
  ))
  return panel
}

export function mountDiagnose(root: HTMLElement, options: DiagnoseOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const projections = options.project
    ? options.project(options.snapshot)
    : projectDiagnostics(options.snapshot)
  installCityUiStyles(root.ownerDocument ?? document)
  installDiagnoseStyles(root.ownerDocument ?? document)

  const grid = element('div', { className: 'tidb-diagnose__grid' })
  for (const projection of projections) grid.append(projectionTable(locale, projection))

  const guideGrid = element('div', { className: 'tidb-diagnose__guide-grid' })
  for (const guide of SYMPTOM_GUIDES) {
    const copy = guide[locale]
    guideGrid.append(
      element('article', { className: 'tidb-diagnose__guide', attrs: { 'data-guide': guide.id } },
        element('h3', { text: copy.symptom }),
        element('p', { text: copy.guidance }),
        element('p', { text: CATALOG[locale].realClusterCheck }),
        element('pre', {
          attrs: {
            tabindex: '0',
            role: 'region',
            'aria-label': `${copy.symptom} SQL`,
          },
        }, element('code', { text: guide.sql })),
      ),
    )
  }

  root.classList.add('tidb-surface', 'tidb-diagnose')
  root.setAttribute('lang', locale)
  root.replaceChildren(
    element('header', { className: 'tidb-diagnose__head' },
      element('div', {},
        element('h1', { text: CATALOG[locale].diagnoseTitle }),
        element('p', { text: CATALOG[locale].diagnoseSubtitle }),
      ),
      createModelBadge(locale),
    ),
    grid,
    element('section', { className: 'tidb-diagnose__guides' },
      element('h2', { text: CATALOG[locale].symptomGuides }),
      guideGrid,
    ),
  )
}
