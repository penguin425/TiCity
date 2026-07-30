// SPDX-License-Identifier: Apache-2.0

import type {
  TraceDomain,
  TraceEvent,
  TraceLockLabSnapshot,
  TraceRaftLabPeerSnapshot,
  TraceRaftLabSnapshot,
  TraceReceipt,
  TraceStateSnapshot,
} from '../model/types'
import { CATALOG, resolveLocale, type Locale } from '../ui/catalog'
import { element, svgElement } from '../ui/dom'
import { createModelBadge } from '../ui/legal'
import { installCityUiStyles } from '../ui/styles'
import { installMachineStyles } from './styles'

export {
  MACHINE_PAGE_COPY,
  MACHINE_SCENARIOS,
  resolveMachineScenario,
} from './catalog'
export { MACHINE_CSS, installMachineStyles } from './styles'

export const MACHINE_LANES = ['sql', 'tso', 'txn2pc', 'raft', 'kv', 'tiflash'] as const
export type MachineLane = (typeof MACHINE_LANES)[number]

export interface MachineEvent {
  id: string
  atMs: number
  durationMs: number
  domain: MachineLane
  /** Canonical model event kind, retained independently from its visible label. */
  kind?: string
  label: string
  detail: string
  source?: string
  target?: string
  status?: string
  /** Explicit causal parents. Legacy receipts fall back to the prior event. */
  dependsOn?: readonly string[]
  /** False marks work that continues after the client critical path. */
  criticalPath?: boolean
  regionId?: number
  transactionId?: string
  /** Stable parallel-branch identity from the canonical receipt. */
  branchId?: string
  /** The exact immutable post-event model projection; never reconstructed here. */
  snapshot?: TraceStateSnapshot
}

export interface MachineReceipt {
  id: string
  events: readonly MachineEvent[]
}

export interface MachineOptions {
  receipt: TraceReceipt | MachineReceipt | unknown
  locale?: Locale
  search?: string
  initialIndex?: number
  /** Preferred cursor contract. Resolved after receipt adaptation. */
  initialEventId?: string
  stepIntervalMs?: number
  autoplay?: boolean
  adaptReceipt?: (receipt: unknown) => MachineReceipt
  onSeek?: (event: MachineEvent | null, index: number) => void
}

const LANE_LABELS: Record<Locale, Record<MachineLane, string>> = {
  ja: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
  en: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
}

const LANE_CODES: Record<MachineLane, string> = {
  sql: 'SQL',
  tso: 'TSO',
  txn2pc: '2PC',
  raft: 'RAFT',
  kv: 'KV',
  tiflash: 'MPP',
}

const MACHINE_COPY = {
  ja: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'トレース再生の概要',
    step: '段階',
    modelTime: 'モデル時刻',
    activeLayer: '現在の層',
    timeWindow: '時間幅',
    progress: 'トレース再生位置',
    duration: '継続時間',
    route: '経路',
    current: '現在のイベント',
    eventKind: 'イベント種別',
    branch: '並列ブランチ',
    lockEyebrow: 'LOCK LAB / SEMANTIC STATE',
    lockTitle: 'ロック待機とデッドロック',
    waitGraph: 'Wait-for グラフ',
    waitDirection: '矢印は待機者 → 現在の保持者です。上の因果 DAG とは別の意味グラフです。',
    noWaitEdges: '現在の wait-for edge はありません。',
    resource: '合成リソース',
    waiter: '待機者',
    holder: '保持者',
    detector: 'デッドロック検出器',
    detectorScope: 'クラスタ全体',
    detectorLeader: '検出器 leader',
    deadlock: 'デッドロック判定',
    noDeadlock: 'この時点ではデッドロックは検出されていません。',
    cycle: '循環',
    victim: 'victim',
    pending: '未選択',
    modelPolicy: 'MODEL POLICY：循環を閉じた待機者を決定論的に選択',
    retryableFalse: 'RETRYABLE=false（このトランザクション全体を終了）',
    applicationRetry: 'アプリケーション再試行',
    noApplicationRetry: 'アプリケーション再試行はまだ予定されていません。',
    retrySource: 'TiDB 内部再試行ではなくアプリケーション',
    retryOf: '再試行元',
    newTransaction: '新しい transaction',
    fixedBackoff: '固定 teaching backoff',
    raftEyebrow: 'RAFT FAILURE LAB / SEMANTIC STATE',
    raftTitle: 'Region Raft選出と内部retry',
    raftPhase: 'Raft Labフェーズ',
    raftGraph: 'Pre-Vote / Vote グラフ',
    raftGraphDirection: '矢印は投票するvoter → 候補です。この選出意味グラフは上の因果 DAG とは別です。',
    raftGraphContract: 'PRE-VOTE / VOTE · 2-OF-3',
    region: 'Region',
    electionState: '選出状態',
    candidate: '候補',
    preVote: 'Pre-Vote',
    enabled: '有効',
    oldToNewLeader: 'Leader遷移',
    noLeader: 'Leader不在',
    failedStore: '障害Store',
    liveVoters: '稼働voter',
    electionQuorum: '選出quorum',
    twoOfThree: '3 voter中2（2-of-3）',
    grant: '獲得',
    noGrants: 'この時点では獲得票はありません。',
    voter: '投票者',
    peerStates: '3 voter peer状態',
    raftRole: 'Raft role',
    health: 'Health',
    healthy: '稼働',
    down: '停止',
    currentTerm: 'current term',
    votedFor: '投票先',
    lastLog: 'last log index / term',
    matchIndex: 'match index',
    commitIndex: 'commit index',
    appliedIndex: 'apply index',
    electionPolicy: '候補とtiming',
    candidatePolicy: '候補決定',
    candidatePolicyValue: '稼働中でlogが最新のStore ID最小',
    configuredWindow: '設定上のtimeout範囲',
    elapsedTicks: 'この断面の経過',
    ticks: 'ticks',
    deterministicPolicy: '候補と正確なtick進行は決定的なTiCity MODEL POLICYです。TiDB/TiKVの実運用結果を保証しません。',
    postElectionLog: '選出後log',
    logEntry: 'Entry',
    noEntry: 'まだありません',
    persistedStores: '永続化Store',
    committed: 'Commit済み',
    appliedStores: 'Apply済みStore',
    yes: 'はい',
    no: 'いいえ',
    pdBoundary: 'PDの境界',
    pdRole: 'PD role',
    pdObserveRouteOnly: '監視とroute metadataのみ',
    observedLeader: '観測Leader',
    routeLookup: 'route lookup',
    pdDoesNotVote: 'PDはLeader情報を観測してrouteを支援しますが、候補選択・Pre-Vote・Vote・Leader選出は行いません。',
    tidbRetry: 'TiDB内部request retry',
    logicalRequest: 'Logical request',
    raftRetrySource: '再試行元',
    tidbInternal: 'TiDB内部',
    retryAttempt: '内部試行',
    cachedLeader: 'cache上のLeader',
    cacheState: 'Leader cache',
    requestState: 'Request状態',
    internalBackoff: '内部backoff',
    clientVisibleError: 'client-visible error',
    clientBoundary: 'Client境界',
    clientPending: '応答待ち（エラー未返却）',
    clientSuccess: '成功（エラーなし）',
    sameLogicalRetry: '同じlogical requestに対するTiDB内部retryです。アプリケーションretryではありません。',
    completeValue: '完了',
    incompleteValue: '未完了',
    empty: '—',
  },
  en: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'Trace replay overview',
    step: 'Step',
    modelTime: 'Model time',
    activeLayer: 'Active layer',
    timeWindow: 'Time window',
    progress: 'Trace replay position',
    duration: 'Duration',
    route: 'Route',
    current: 'Current event',
    eventKind: 'Event kind',
    branch: 'Parallel branch',
    lockEyebrow: 'LOCK LAB / SEMANTIC STATE',
    lockTitle: 'Lock waits and deadlock',
    waitGraph: 'Wait-for graph',
    waitDirection: 'Arrows run waiter → current holder. This semantic graph is separate from the causal DAG above.',
    noWaitEdges: 'There are no active wait-for edges at this event.',
    resource: 'Synthetic resource',
    waiter: 'Waiter',
    holder: 'Holder',
    detector: 'Deadlock detector',
    detectorScope: 'Cluster-wide',
    detectorLeader: 'Detector leader',
    deadlock: 'Deadlock decision',
    noDeadlock: 'No deadlock has been detected at this event.',
    cycle: 'Cycle',
    victim: 'Victim',
    pending: 'Pending',
    modelPolicy: 'MODEL POLICY: deterministically select the cycle-closing waiter',
    retryableFalse: 'RETRYABLE=false (end this whole transaction)',
    applicationRetry: 'Application retry',
    noApplicationRetry: 'No application retry has been scheduled yet.',
    retrySource: 'Application, not an internal TiDB retry',
    retryOf: 'Retry of',
    newTransaction: 'New transaction',
    fixedBackoff: 'Fixed teaching backoff',
    raftEyebrow: 'RAFT FAILURE LAB / SEMANTIC STATE',
    raftTitle: 'Region Raft election and internal retry',
    raftPhase: 'Raft Lab phase',
    raftGraph: 'Pre-Vote / Vote graph',
    raftGraphDirection: 'Arrows run granting voter → candidate. This election semantic graph is separate from the causal DAG above.',
    raftGraphContract: 'PRE-VOTE / VOTE · 2-OF-3',
    region: 'Region',
    electionState: 'Election state',
    candidate: 'Candidate',
    preVote: 'Pre-Vote',
    enabled: 'Enabled',
    oldToNewLeader: 'Leader transition',
    noLeader: 'No leader',
    failedStore: 'Failed store',
    liveVoters: 'Live voters',
    electionQuorum: 'Election quorum',
    twoOfThree: '2 of 3 voters (2-of-3)',
    grant: 'Granted',
    noGrants: 'No votes have been granted at this event.',
    voter: 'Voter',
    peerStates: 'Three voter peer states',
    raftRole: 'Raft role',
    health: 'Health',
    healthy: 'Healthy',
    down: 'Down',
    currentTerm: 'Current term',
    votedFor: 'Voted for',
    lastLog: 'Last log index / term',
    matchIndex: 'Match index',
    commitIndex: 'Commit index',
    appliedIndex: 'Apply index',
    electionPolicy: 'Candidate and timing',
    candidatePolicy: 'Candidate selection',
    candidatePolicyValue: 'Lowest live, up-to-date Store ID',
    configuredWindow: 'Configured timeout window',
    elapsedTicks: 'Elapsed at this snapshot',
    ticks: 'ticks',
    deterministicPolicy: 'The exact candidate and tick progression are deterministic TiCity MODEL POLICY, not a TiDB/TiKV production guarantee.',
    postElectionLog: 'Post-election log',
    logEntry: 'Entry',
    noEntry: 'Not present yet',
    persistedStores: 'Persisted stores',
    committed: 'Committed',
    appliedStores: 'Applied stores',
    yes: 'Yes',
    no: 'No',
    pdBoundary: 'PD boundary',
    pdRole: 'PD role',
    pdObserveRouteOnly: 'Observe and route metadata only',
    observedLeader: 'Observed leader',
    routeLookup: 'Route lookup',
    pdDoesNotVote: 'PD observes leader metadata and assists routing; it does not choose a candidate, grant Pre-Votes or Votes, or elect the leader.',
    tidbRetry: 'TiDB internal request retry',
    logicalRequest: 'Logical request',
    raftRetrySource: 'Retry source',
    tidbInternal: 'TiDB internal',
    retryAttempt: 'Internal attempt',
    cachedLeader: 'Cached leader',
    cacheState: 'Leader cache',
    requestState: 'Request state',
    internalBackoff: 'Internal backoff',
    clientVisibleError: 'Client-visible error',
    clientBoundary: 'Client boundary',
    clientPending: 'Response pending; no error returned',
    clientSuccess: 'Succeeded with no error',
    sameLogicalRetry: 'This is a TiDB internal retry of the same logical request, not an application retry.',
    completeValue: 'Complete',
    incompleteValue: 'Incomplete',
    empty: '—',
  },
} as const

interface TimelineEventLayout {
  event: MachineEvent
  index: number
  x: number
  endX: number
  y: number
  state: 'complete' | 'current' | 'future'
  status: 'queued' | 'active' | 'success' | 'warning' | 'failed'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0)
  return strings.length > 0 ? strings : undefined
}

function asTraceSnapshot(value: unknown): TraceStateSnapshot | undefined {
  return value && typeof value === 'object'
    ? value as TraceStateSnapshot
    : undefined
}

function machineDomain(value: unknown): MachineLane | null {
  if (value === 'client' || value === 'return' || value === 'sql') return 'sql'
  if (value === 'tso') return 'tso'
  if (value === 'txn' || value === 'transaction' || value === 'txn2pc') return 'txn2pc'
  if (value === 'raft') return 'raft'
  if (value === 'kv') return 'kv'
  if (value === 'tiflash') return 'tiflash'
  return null
}

function machineStatus(value: string | undefined): TimelineEventLayout['status'] {
  if (value === 'queued' || value === 'active' || value === 'warning' || value === 'failed') {
    return value
  }
  return 'success'
}

function receiptEndMs(receipt: MachineReceipt): number {
  return Math.max(
    1,
    ...receipt.events.map((event) => event.atMs + Math.max(0, event.durationMs)),
  )
}

function formatModelTime(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ms`
}

function shortLabel(label: string, maxLength = 32): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}

function lockAttemptLabel(clientId: string, attempt: number): string {
  if (attempt <= 1) return clientId
  if (attempt <= 4) return `${clientId}${'′'.repeat(attempt - 1)}`
  return `${clientId} (${attempt})`
}

function appendSvgText(
  parent: SVGElement,
  className: string,
  text: string,
  x: number,
  y: number,
  attrs: Record<string, string> = {},
): SVGTextElement {
  const node = svgElement('text', {
    class: className,
    x: String(x),
    y: String(y),
    ...attrs,
  })
  node.textContent = text
  parent.append(node)
  return node
}

const LOCK_TRANSACTION_STATUS_COPY = {
  ja: {
    active: '実行中',
    waiting: '待機中',
    victim: 'victim',
    rolled_back: 'ロールバック済み',
    commit_handoff: 'commit modelへ引き渡し',
    completed: '完了',
  },
  en: {
    active: 'Active',
    waiting: 'Waiting',
    victim: 'Victim',
    rolled_back: 'Rolled back',
    commit_handoff: 'Commit-model handoff',
    completed: 'Completed',
  },
} as const

const DEADLOCK_RESOLUTION_COPY = {
  ja: {
    detected: '循環を検出',
    rolling_back: 'victimをロールバック中',
    resolved: '解消済み（履歴を保持）',
  },
  en: {
    detected: 'Cycle detected',
    rolling_back: 'Rolling back victim',
    resolved: 'Resolved (history retained)',
  },
} as const

const APPLICATION_RETRY_STATUS_COPY = {
  ja: {
    backoff: 'backoff中',
    started: '新しいtransactionを開始',
    completed: '再試行完了',
  },
  en: {
    backoff: 'In backoff',
    started: 'New transaction started',
    completed: 'Retry completed',
  },
} as const

const RAFT_PHASE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['phase'], string>>
>> = {
  ja: {
    healthy: '正常',
    requesting: '旧Leaderへrequest',
    leader_lost: 'Leader喪失',
    backoff: 'TiDB内部backoff',
    timeout: '選出timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: '新Leader選出',
    confirming: '新Leaderを確認',
    routing: 'routeを更新',
    serving: 'requestを再実行',
    complete: '完了',
  },
  en: {
    healthy: 'Healthy',
    requesting: 'Requesting the old leader',
    leader_lost: 'Leader lost',
    backoff: 'TiDB internal backoff',
    timeout: 'Election timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: 'New leader elected',
    confirming: 'Confirming the new leader',
    routing: 'Refreshing the route',
    serving: 'Serving the retried request',
    complete: 'Complete',
  },
}

const RAFT_ELECTION_PHASE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['election']['phase'], string>>
>> = {
  ja: {
    idle: '待機',
    timeout: 'Timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: '選出済み',
  },
  en: {
    idle: 'Idle',
    timeout: 'Timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: 'Elected',
  },
}

const RAFT_ROLE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabPeerSnapshot['role'], string>>
>> = {
  ja: {
    leader: 'Leader',
    follower: 'Follower',
    pre_candidate: 'Pre-Candidate',
    candidate: 'Candidate',
    offline: 'Offline',
  },
  en: {
    leader: 'Leader',
    follower: 'Follower',
    pre_candidate: 'Pre-Candidate',
    candidate: 'Candidate',
    offline: 'Offline',
  },
}

const RAFT_REQUEST_STATUS_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['request']['status'], string>>
>> = {
  ja: {
    idle: '待機',
    sent: '送信済み',
    transport_error: 'transport error',
    backoff: 'backoff',
    retrying: '再試行中',
    served: 'TiKVで処理済み',
    completed: '完了',
  },
  en: {
    idle: 'Idle',
    sent: 'Sent',
    transport_error: 'Transport error',
    backoff: 'Backoff',
    retrying: 'Retrying',
    served: 'Served by TiKV',
    completed: 'Completed',
  },
}

const RAFT_CACHE_STATE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['request']['cacheState'], string>>
>> = {
  ja: {
    cached: 'cache済み',
    invalidated: '無効化',
    refreshed: '更新済み',
  },
  en: {
    cached: 'Cached',
    invalidated: 'Invalidated',
    refreshed: 'Refreshed',
  },
}

function raftFact(label: string, value: string): HTMLElement {
  return element('div', {},
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function renderRaftElectionGraph(
  raftLab: TraceRaftLabSnapshot,
  locale: Locale,
): HTMLDivElement {
  const copy = MACHINE_COPY[locale]
  const candidate = raftLab.election.candidateStoreId
  const wrapper = element('div', {
    className: 'tidb-machine__raft-election-graph',
    attrs: {
      role: 'group',
      tabindex: '0',
      'aria-label': `${copy.raftGraph}. ${copy.raftGraphDirection}`,
      'data-raft-election-graph': 'semantic',
      'data-graph-kind': 'raft-election',
      'data-election-phase': raftLab.election.phase,
      'data-election-candidate': candidate ?? '',
      'data-election-quorum': String(raftLab.quorum),
      'data-edge-count': String(
        raftLab.election.preVotesGranted.length +
        raftLab.election.votesGranted.length,
      ),
    },
  })
  const graphHead = element('div', {
    className: 'tidb-machine__raft-card-head',
  },
  element('h3', { text: copy.raftGraph }),
  element('span', {
    className: 'tidb-machine__raft-graph-contract',
    text: copy.raftGraphContract,
  }),
  )
  const direction = element('p', {
    className: 'tidb-machine__raft-direction',
    text: copy.raftGraphDirection,
  })

  const width = 680
  const height = 250
  const peerY = 28
  const peerWidth = 150
  const peerHeight = 58
  const candidateY = 190
  const positions = new Map<string, number>()
  raftLab.peers.forEach((peer, index) => {
    positions.set(peer.storeId, 105 + index * 235)
  })
  const diagram = svgElement('svg', {
    class: 'tidb-machine__raft-election-svg',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    'data-graph-kind': 'raft-election-visual',
  })
  const defs = svgElement('defs')
  const preVoteMarker = svgElement('marker', {
    id: 'tidb-machine-raft-prevote-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  preVoteMarker.append(svgElement('path', {
    class: 'tidb-machine__raft-prevote-arrow',
    d: 'M 1 1 L 9 5 L 1 9',
  }))
  const voteMarker = svgElement('marker', {
    id: 'tidb-machine-raft-vote-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  voteMarker.append(svgElement('path', {
    class: 'tidb-machine__raft-vote-arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(preVoteMarker, voteMarker)
  diagram.append(defs)

  const grants = [
    {
      stage: 'pre_vote',
      label: 'PV',
      stores: raftLab.election.preVotesGranted,
      endX: width / 2 - 26,
      endY: candidateY,
    },
    {
      stage: 'vote',
      label: 'V',
      stores: raftLab.election.votesGranted,
      endX: width / 2 + 26,
      endY: candidateY,
    },
  ] as const
  for (const grant of grants) {
    grant.stores.forEach((storeId, index) => {
      const startX = positions.get(storeId)
      if (startX === undefined || candidate === null) return
      const controlX = (startX + grant.endX) / 2 +
        (grant.stage === 'pre_vote' ? -22 : 22)
      const controlY = 116 + index * 16
      diagram.append(svgElement('path', {
        class: `tidb-machine__raft-grant is-${grant.stage}`,
        d: `M ${startX} ${peerY + peerHeight} Q ${controlX} ${controlY} ${grant.endX} ${grant.endY}`,
        'data-raft-grant': grant.stage,
        'data-grant-from': storeId,
        'data-grant-to': candidate,
        'data-grant-counted': 'true',
        'marker-end': grant.stage === 'pre_vote'
          ? 'url(#tidb-machine-raft-prevote-arrow)'
          : 'url(#tidb-machine-raft-vote-arrow)',
      }))
      appendSvgText(
        diagram,
        `tidb-machine__raft-grant-label is-${grant.stage}`,
        grant.label,
        controlX,
        controlY - 4,
        { 'text-anchor': 'middle' },
      )
    })
  }

  for (const peer of raftLab.peers) {
    const x = positions.get(peer.storeId)
    if (x === undefined) continue
    const node = svgElement('g', {
      class: `tidb-machine__raft-node is-${peer.role} ${peer.healthy ? 'is-healthy' : 'is-down'}`,
      'data-raft-peer-node': peer.storeId,
      'data-peer-role': peer.role,
      'data-peer-health': peer.healthy ? 'healthy' : 'down',
      'data-node-shape': peer.role === 'leader'
        ? 'double'
        : peer.role === 'candidate' || peer.role === 'pre_candidate'
          ? 'notched'
          : peer.role === 'offline'
            ? 'crossed'
            : 'rounded',
    })
    node.append(svgElement('rect', {
      class: 'tidb-machine__raft-node-box',
      x: String(x - peerWidth / 2),
      y: String(peerY),
      width: String(peerWidth),
      height: String(peerHeight),
      rx: peer.role === 'candidate' || peer.role === 'pre_candidate'
        ? '2'
        : '11',
    }))
    appendSvgText(
      node,
      'tidb-machine__raft-node-store',
      `${peer.healthy ? '●' : '×'} ${peer.storeId}`,
      x,
      peerY + 23,
      { 'text-anchor': 'middle' },
    )
    appendSvgText(
      node,
      'tidb-machine__raft-node-role',
      `${RAFT_ROLE_COPY[locale][peer.role]} · term ${peer.currentTerm}`,
      x,
      peerY + 43,
      { 'text-anchor': 'middle' },
    )
    diagram.append(node)
  }

  diagram.append(svgElement('rect', {
    class: 'tidb-machine__raft-candidate-box',
    x: String(width / 2 - 112),
    y: String(candidateY),
    width: '224',
    height: '44',
    rx: '4',
    'data-candidate-shape': 'notched',
  }))
  appendSvgText(
    diagram,
    'tidb-machine__raft-candidate-label',
    `${copy.candidate}: ${candidate ?? copy.pending}`,
    width / 2,
    candidateY + 19,
    { 'text-anchor': 'middle' },
  )
  appendSvgText(
    diagram,
    'tidb-machine__raft-candidate-quorum',
    copy.twoOfThree,
    width / 2,
    candidateY + 35,
    { 'text-anchor': 'middle' },
  )

  const grantList = element('ul', {
    className: 'tidb-machine__raft-grant-list',
    attrs: {
      'aria-label': copy.raftGraph,
      'data-raft-grant-list': 'accessible',
    },
  })
  for (const grant of grants) {
    for (const storeId of grant.stores) {
      grantList.append(element('li', {
        attrs: {
          'data-raft-grant': grant.stage,
          'data-grant-from': storeId,
          'data-grant-to': candidate ?? '',
        },
      },
      element('strong', {
        text: grant.stage === 'pre_vote' ? 'PRE-VOTE' : 'VOTE',
      }),
      element('span', {
        text: `${copy.voter}: ${storeId} → ${copy.candidate}: ${candidate ?? copy.pending}`,
      }),
      element('small', { text: copy.grant }),
      ))
    }
  }
  if (
    raftLab.election.preVotesGranted.length === 0 &&
    raftLab.election.votesGranted.length === 0
  ) {
    grantList.append(element('li', {
      className: 'tidb-machine__raft-empty',
      text: copy.noGrants,
      attrs: { 'data-raft-grant-empty': 'true' },
    }))
  }

  wrapper.append(graphHead, direction, diagram, grantList)
  return wrapper
}

function renderWaitForDiagram(
  lockLab: TraceLockLabSnapshot,
  locale: Locale,
): HTMLDivElement {
  const copy = MACHINE_COPY[locale]
  const wrapper = element('div', {
    className: 'tidb-machine__wait-graph',
    attrs: {
      role: 'group',
      'aria-label': `${copy.waitGraph}. ${copy.waitDirection}`,
      'data-wait-for-graph': 'semantic',
      'data-edge-count': String(lockLab.waitForEdges.length),
      tabindex: '0',
    },
  })
  const graphHead = element('div', { className: 'tidb-machine__lock-card-head' },
    element('h3', { text: copy.waitGraph }),
    element('span', {
      className: 'tidb-machine__graph-contract',
      text: 'WAITER → HOLDER',
    }),
  )
  const direction = element('p', {
    className: 'tidb-machine__graph-direction',
    text: copy.waitDirection,
  })

  const width = 620
  const height = 170
  const centerY = 82
  const transactions = lockLab.transactions
  const positionByTransactionId = new Map<string, number>()
  const diagram = svgElement('svg', {
    class: 'tidb-machine__wait-svg',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    'data-graph-kind': 'wait-for',
  })
  const defs = svgElement('defs')
  const marker = svgElement('marker', {
    id: 'tidb-machine-wait-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  marker.append(svgElement('path', {
    class: 'tidb-machine__wait-arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(marker)
  diagram.append(defs)

  transactions.forEach((transaction, index) => {
    const x = transactions.length === 1
      ? width / 2
      : 76 + index * ((width - 152) / Math.max(1, transactions.length - 1))
    positionByTransactionId.set(transaction.transactionId, x)
  })

  for (const [index, edge] of lockLab.waitForEdges.entries()) {
    const waiterX = positionByTransactionId.get(edge.waiterTransactionId)
    const holderX = positionByTransactionId.get(edge.holderTransactionId)
    if (waiterX === undefined || holderX === undefined) continue
    const directionSign = holderX >= waiterX ? 1 : -1
    const startX = waiterX + directionSign * 54
    const endX = holderX - directionSign * 54
    const midX = (startX + endX) / 2
    const hasReverse = lockLab.waitForEdges.some((candidate) =>
      candidate.waiterTransactionId === edge.holderTransactionId &&
      candidate.holderTransactionId === edge.waiterTransactionId)
    const controlY = hasReverse
      ? directionSign > 0 ? 19 : 145
      : 42 + (index % 2) * 80
    diagram.append(svgElement('path', {
      class: 'tidb-machine__wait-edge',
      d: `M ${startX} ${centerY} Q ${midX} ${controlY} ${endX} ${centerY}`,
      'data-wait-for-edge': edge.id,
      'data-wait-for-from': edge.waiterTransactionId,
      'data-wait-for-to': edge.holderTransactionId,
      'data-resource-id': edge.resourceId,
      'data-direction': 'waiter-to-holder',
      'marker-end': 'url(#tidb-machine-wait-arrow)',
    }))
    appendSvgText(
      diagram,
      'tidb-machine__wait-resource',
      edge.resourceId,
      midX,
      controlY < centerY ? controlY + 14 : controlY - 8,
      { 'text-anchor': 'middle' },
    )
  }

  for (const transaction of transactions) {
    const x = positionByTransactionId.get(transaction.transactionId)
    if (x === undefined) continue
    const clientLabel = lockAttemptLabel(
      transaction.clientId,
      transaction.attempt,
    )
    const node = svgElement('g', {
      class: `tidb-machine__wait-node is-${transaction.status}`,
      'data-lock-transaction': transaction.transactionId,
      'data-lock-client': transaction.clientId,
      'data-lock-status': transaction.status,
    })
    node.append(svgElement('rect', {
      class: 'tidb-machine__wait-node-box',
      x: String(x - 54),
      y: String(centerY - 24),
      width: '108',
      height: '48',
      rx: '10',
    }))
    appendSvgText(
      node,
      'tidb-machine__wait-node-client',
      clientLabel,
      x,
      centerY - 3,
      { 'text-anchor': 'middle' },
    )
    appendSvgText(
      node,
      'tidb-machine__wait-node-id',
      shortLabel(transaction.transactionId, 18),
      x,
      centerY + 13,
      { 'text-anchor': 'middle' },
    )
    diagram.append(node)
  }

  const edgeList = element('ul', {
    className: 'tidb-machine__wait-list',
    attrs: { 'aria-label': copy.waitGraph },
  })
  for (const edge of lockLab.waitForEdges) {
    edgeList.append(element('li', {
      attrs: {
        'data-wait-for-edge': edge.id,
        'data-wait-for-from': edge.waiterTransactionId,
        'data-wait-for-to': edge.holderTransactionId,
        'data-resource-id': edge.resourceId,
        'data-direction': 'waiter-to-holder',
      },
    },
    element('span', { text: `${copy.waiter}: ${edge.waiterTransactionId}` }),
    element('strong', { text: '→' }),
    element('span', { text: `${copy.holder}: ${edge.holderTransactionId}` }),
    element('small', { text: `${copy.resource}: ${edge.resourceId}` }),
    ))
  }
  if (lockLab.waitForEdges.length === 0) {
    edgeList.append(element('li', {
      className: 'tidb-machine__lock-empty',
      text: copy.noWaitEdges,
      attrs: { 'data-wait-for-empty': 'true' },
    }))
  }

  wrapper.append(graphHead, direction, diagram, edgeList)
  return wrapper
}

function renderLockState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const lockLab = event.snapshot?.lockLab
  if (!lockLab) return null
  const copy = MACHINE_COPY[locale]
  const detector = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-lock-detector': lockLab.detectorLeaderStoreId,
      'data-detector-scope': lockLab.detectorScope,
    },
  },
  element('h3', { text: copy.detector }),
  element('strong', { text: copy.detectorScope }),
  element('p', {
    text: `${copy.detectorLeader}: ${lockLab.detectorLeaderStoreId}`,
  }),
  )

  const deadlock = lockLab.deadlock
  const deadlockCard = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-deadlock-state': deadlock?.resolution ?? 'none',
      'data-deadlock-victim': deadlock?.victimTransactionId ?? '',
      'data-deadlock-retryable': deadlock ? String(deadlock.retryable) : 'not-applicable',
    },
  },
  element('h3', { text: copy.deadlock }),
  )
  if (deadlock) {
    deadlockCard.append(
      element('strong', {
        text: DEADLOCK_RESOLUTION_COPY[locale][deadlock.resolution],
      }),
      element('p', {
        className: 'tidb-machine__deadlock-cycle',
        text: `${copy.cycle}: ${deadlock.cycleTransactionIds.join(' → ')}`,
      }),
      element('p', {
        text: `${copy.victim}: ${deadlock.victimTransactionId ?? copy.pending}`,
      }),
      element('p', {
        className: 'tidb-machine__model-policy',
        text: copy.modelPolicy,
        attrs: {
          'data-selection-policy': 'model-policy',
          'data-policy-contract': deadlock.selectionPolicy,
        },
      }),
      element('p', {
        className: 'tidb-machine__retryable-false',
        text: copy.retryableFalse,
        attrs: { 'data-retryable': 'false' },
      }),
    )
  } else {
    deadlockCard.append(element('p', {
      className: 'tidb-machine__lock-empty',
      text: copy.noDeadlock,
    }))
  }

  const retry = lockLab.applicationRetry
  const retryCard = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-application-retry': retry?.status ?? 'none',
      'data-retry-source': retry?.source ?? 'none',
    },
  },
  element('h3', { text: copy.applicationRetry }),
  )
  if (retry) {
    retryCard.append(
      element('strong', {
        text: APPLICATION_RETRY_STATUS_COPY[locale][retry.status],
      }),
      element('p', { text: copy.retrySource }),
      element('p', { text: `${copy.retryOf}: ${retry.retryOfTransactionId}` }),
      element('p', {
        text: `${copy.newTransaction}: ${retry.newTransactionId ?? copy.pending}`,
      }),
      element('p', {
        text: `${copy.fixedBackoff}: ${retry.fixedBackoffMs} ms`,
      }),
    )
  } else {
    retryCard.append(element('p', {
      className: 'tidb-machine__lock-empty',
      text: copy.noApplicationRetry,
    }))
  }

  const transactionLegend = element('ul', {
    className: 'tidb-machine__lock-transactions',
    attrs: {
      'aria-label': locale === 'ja'
        ? 'Lock Lab transactionの状態'
        : 'Lock Lab transaction states',
    },
  })
  for (const transaction of lockLab.transactions) {
    const clientLabel = lockAttemptLabel(
      transaction.clientId,
      transaction.attempt,
    )
    transactionLegend.append(element('li', {
      attrs: {
        'data-lock-transaction-summary': transaction.transactionId,
        'data-lock-status': transaction.status,
        'data-lock-attempt': String(transaction.attempt),
      },
    },
    element('span', { text: clientLabel }),
    element('code', { text: transaction.transactionId }),
    element('strong', {
      text: LOCK_TRANSACTION_STATUS_COPY[locale][transaction.status],
    }),
    ))
  }

  return element('section', {
    className: 'tidb-machine__lock-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-lock-title',
      'data-lock-lab-state': 'true',
      'data-lock-event-id': event.id,
      'data-lock-event-kind': event.kind ?? '',
      'data-lock-event-branch': event.branchId ?? '',
    },
  },
  element('header', { className: 'tidb-machine__lock-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__lock-eyebrow',
        text: copy.lockEyebrow,
      }),
      element('h2', {
        text: copy.lockTitle,
        attrs: { id: 'tidb-machine-lock-title' },
      }),
    ),
    element('span', {
      className: 'tidb-machine__lock-snapshot',
      text: `SNAPSHOT · ${event.id}`,
    }),
  ),
  renderWaitForDiagram(lockLab, locale),
  transactionLegend,
  element('div', { className: 'tidb-machine__lock-grid' },
    detector,
    deadlockCard,
    retryCard,
  ),
  )
}

function renderRaftPeerCard(
  peer: TraceRaftLabPeerSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  return element('li', {
    className: 'tidb-machine__raft-peer',
    attrs: {
      'data-raft-peer': peer.storeId,
      'data-peer-role': peer.role,
      'data-peer-health': peer.healthy ? 'healthy' : 'down',
      'data-peer-term': String(peer.currentTerm),
      'data-peer-voted-for': peer.votedFor ?? '',
    },
  },
  element('div', { className: 'tidb-machine__raft-peer-head' },
    element('strong', {
      text: `${peer.healthy ? '●' : '×'} ${peer.storeId}`,
    }),
    element('span', {
      className: 'tidb-machine__raft-role',
      text: RAFT_ROLE_COPY[locale][peer.role],
      attrs: {
        'aria-label': `${copy.raftRole}: ${RAFT_ROLE_COPY[locale][peer.role]}`,
      },
    }),
  ),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.health, peer.healthy ? copy.healthy : copy.down),
    raftFact(copy.currentTerm, String(peer.currentTerm)),
    raftFact(copy.votedFor, peer.votedFor ?? copy.empty),
    raftFact(copy.lastLog, `${peer.lastLogIndex} / ${peer.lastLogTerm}`),
    raftFact(copy.matchIndex, String(peer.matchIndex)),
    raftFact(copy.commitIndex, String(peer.commitIndex)),
    raftFact(copy.appliedIndex, String(peer.appliedIndex)),
  ),
  )
}

function renderRaftState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const raftLab = event.snapshot?.raftLab
  if (!raftLab) return null
  const copy = MACHINE_COPY[locale]
  const election = raftLab.election
  const log = raftLab.log
  const request = raftLab.request
  const pd = raftLab.pd
  const clientResult = request.status === 'completed' ? 'success' : 'pending'
  const logEntry =
    log.entryKind === null || log.index === null || log.term === null
      ? copy.noEntry
      : `${log.entryKind} · index ${log.index} · term ${log.term}`

  const policyCard = element('section', {
    className: 'tidb-machine__raft-card',
    attrs: {
      'data-raft-policy': 'model-policy',
      'data-candidate-policy': election.candidatePolicy,
      'data-prevote-enabled': String(election.prevoteEnabled),
      'data-configured-timeout-min': String(
        election.configuredElectionTimeoutTicks,
      ),
      'data-configured-timeout-max': String(
        election.configuredMaxElectionTimeoutTicks,
      ),
      'data-elapsed-ticks': String(election.elapsedTicks),
    },
  },
  element('h3', { text: copy.electionPolicy }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(
      copy.electionState,
      RAFT_ELECTION_PHASE_COPY[locale][election.phase],
    ),
    raftFact(copy.candidate, election.candidateStoreId ?? copy.pending),
    raftFact(
      copy.preVote,
      election.prevoteEnabled ? copy.enabled : copy.no,
    ),
    raftFact(copy.candidatePolicy, copy.candidatePolicyValue),
    raftFact(
      copy.configuredWindow,
      `${election.configuredElectionTimeoutTicks}–${election.configuredMaxElectionTimeoutTicks} ${copy.ticks}`,
    ),
    raftFact(
      copy.elapsedTicks,
      `${election.elapsedTicks} ${copy.ticks}`,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-policy-note',
    text: copy.deterministicPolicy,
    attrs: {
      'data-policy-contract': election.candidatePolicy,
    },
  }),
  )

  const logCard = element('section', {
    className: 'tidb-machine__raft-card',
    attrs: {
      'data-raft-log-entry': log.entryKind ?? 'none',
      'data-raft-log-committed': String(log.committed),
    },
  },
  element('h3', { text: copy.postElectionLog }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.logEntry, logEntry),
    raftFact(
      copy.persistedStores,
      log.persistedStoreIds.length > 0
        ? log.persistedStoreIds.join(' · ')
        : copy.empty,
    ),
    raftFact(copy.committed, log.committed ? copy.yes : copy.no),
    raftFact(
      copy.appliedStores,
      log.appliedStoreIds.length > 0
        ? log.appliedStoreIds.join(' · ')
        : copy.empty,
    ),
  ),
  )

  const pdCard = element('section', {
    className: 'tidb-machine__raft-card is-pd-boundary',
    attrs: {
      'data-pd-role': pd.role,
      'data-pd-votes': 'false',
      'data-pd-route-lookup': String(pd.routeLookupCompleted),
    },
  },
  element('h3', { text: copy.pdBoundary }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.pdRole, copy.pdObserveRouteOnly),
    raftFact(copy.observedLeader, pd.observedLeaderStoreId ?? copy.empty),
    raftFact(
      copy.routeLookup,
      pd.routeLookupCompleted ? copy.completeValue : copy.incompleteValue,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-boundary-note',
    text: copy.pdDoesNotVote,
  }),
  )

  const retryCard = element('section', {
    className: 'tidb-machine__raft-card is-retry-boundary',
    attrs: {
      'data-raft-request': request.logicalRequestId,
      'data-retry-source': request.source,
      'data-same-logical-request': 'true',
      'data-application-retry': 'false',
      'data-request-status': request.status,
      'data-request-attempt': String(request.attempt),
      'data-client-visible-error': String(request.clientVisibleError),
      'data-client-result': clientResult,
    },
  },
  element('h3', { text: copy.tidbRetry }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.logicalRequest, request.logicalRequestId),
    raftFact(copy.raftRetrySource, copy.tidbInternal),
    raftFact(copy.retryAttempt, String(request.attempt)),
    raftFact(copy.cachedLeader, request.cachedLeaderStoreId ?? copy.empty),
    raftFact(
      copy.cacheState,
      RAFT_CACHE_STATE_COPY[locale][request.cacheState],
    ),
    raftFact(
      copy.requestState,
      RAFT_REQUEST_STATUS_COPY[locale][request.status],
    ),
    raftFact(copy.internalBackoff, `${request.backoffMs} ms`),
    raftFact(copy.clientVisibleError, String(request.clientVisibleError)),
    raftFact(
      copy.clientBoundary,
      clientResult === 'success' ? copy.clientSuccess : copy.clientPending,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-boundary-note',
    text: copy.sameLogicalRetry,
  }),
  )

  return element('section', {
    className: 'tidb-machine__raft-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-raft-title',
      'data-raft-lab-state': 'true',
      'data-raft-event-id': event.id,
      'data-raft-event-kind': event.kind ?? '',
      'data-raft-event-branch': event.branchId ?? '',
      'data-raft-phase': raftLab.phase,
      'data-region-id': String(raftLab.regionId),
    },
  },
  element('header', { className: 'tidb-machine__raft-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__raft-eyebrow',
        text: copy.raftEyebrow,
      }),
      element('h2', {
        text: copy.raftTitle,
        attrs: { id: 'tidb-machine-raft-title' },
      }),
    ),
    element('div', { className: 'tidb-machine__raft-head-meta' },
      element('span', {
        className: 'tidb-machine__raft-phase',
        text: `${copy.raftPhase}: ${RAFT_PHASE_COPY[locale][raftLab.phase]}`,
        attrs: { 'data-phase-state': raftLab.phase },
      }),
      element('span', {
        className: 'tidb-machine__raft-snapshot',
        text: `SNAPSHOT · ${event.id}`,
      }),
    ),
  ),
  element('dl', { className: 'tidb-machine__raft-summary' },
    raftFact(copy.region, `Region ${raftLab.regionId}`),
    raftFact(
      copy.oldToNewLeader,
      `${raftLab.oldLeaderStoreId} → ${raftLab.leaderStoreId ?? copy.noLeader}`,
    ),
    raftFact(copy.failedStore, raftLab.failedStoreId ?? copy.empty),
    raftFact(copy.liveVoters, `${raftLab.liveVoterCount}/3`),
    raftFact(copy.electionQuorum, copy.twoOfThree),
  ),
  renderRaftElectionGraph(raftLab, locale),
  element('section', {
    className: 'tidb-machine__raft-peers',
    attrs: { 'aria-labelledby': 'tidb-machine-raft-peers-title' },
  },
  element('h3', {
    text: copy.peerStates,
    attrs: { id: 'tidb-machine-raft-peers-title' },
  }),
  element('ul', {
    className: 'tidb-machine__raft-peer-list',
    attrs: { 'aria-label': copy.peerStates },
  },
  ...raftLab.peers.map((peer) => renderRaftPeerCard(peer, locale)),
  ),
  ),
  element('div', { className: 'tidb-machine__raft-grid' },
    policyCard,
    logCard,
    pdCard,
    retryCard,
  ),
  )
}

export function adaptTraceReceipt(source: unknown): MachineReceipt {
  const receipt = record(source)
  const rawEvents = Array.isArray(receipt.events) ? receipt.events : []
  const events: MachineEvent[] = []
  for (let index = 0; index < rawEvents.length; index += 1) {
    const raw = record(rawEvents[index])
    const domain = machineDomain(raw.domain)
    if (!domain) continue
    events.push({
      id: asString(raw.id, `event-${index + 1}`),
      atMs: asNumber(raw.atMs, asNumber(raw.at, index)),
      durationMs: asNumber(raw.durationMs, asNumber(raw.duration, 0)),
      domain,
      kind: asString(raw.kind) || undefined,
      label: asString(raw.label, asString(raw.kind, domain)),
      detail: asString(raw.detail),
      source: asString(raw.source) || undefined,
      target: asString(raw.target) || undefined,
      status: asString(raw.status) || undefined,
      dependsOn: asStringArray(raw.dependsOn),
      criticalPath: typeof raw.criticalPath === 'boolean'
        ? raw.criticalPath
        : raw.path === 'background'
          ? false
          : raw.path === 'critical'
            ? true
            : undefined,
      regionId: typeof raw.regionId === 'number' && Number.isInteger(raw.regionId)
        ? raw.regionId
        : undefined,
      transactionId: asString(raw.transactionId) || undefined,
      branchId: asString(raw.branchId) || undefined,
      snapshot: asTraceSnapshot(raw.snapshot),
    })
  }
  /*
   * Canonical receipt order is also snapshot order. Parallel branches can
   * share or revisit model-time positions, so sorting here would detach a URL
   * cursor from the immutable post-event projection that it names.
   */
  return { id: asString(receipt.id, 'trace'), events }
}

export function resolveMachineEventIndex(
  receipt: MachineReceipt,
  eventId: string | undefined,
  fallbackIndex = 0,
): number {
  if (receipt.events.length === 0) return -1
  if (eventId) {
    const requestedIndex = receipt.events.findIndex((event) => event.id === eventId)
    if (requestedIndex >= 0) return requestedIndex
  }
  return Math.max(0, Math.min(receipt.events.length - 1, fallbackIndex))
}

function renderTimeline(
  receipt: MachineReceipt,
  locale: Locale,
  currentIndex: number,
): SVGSVGElement {
  const width = 1120
  const plotLeft = 210
  const plotRight = width - 28
  const top = 72
  const laneHeight = 68
  const height = top + MACHINE_LANES.length * laneHeight + 42
  const maxAt = receiptEndMs(receipt)
  const xOf = (atMs: number) => {
    const ratio = Math.max(0, Math.min(maxAt, atMs)) / maxAt
    return plotLeft + ratio * (plotRight - plotLeft)
  }
  const svg = svgElement('svg', {
    class: 'tidb-machine__svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': locale === 'ja' ? 'TiDB traceの層別タイムライン' : 'Layered TiDB trace timeline',
  })

  const defs = svgElement('defs')
  const arrow = svgElement('marker', {
    id: 'tidb-machine-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '6',
    markerHeight: '6',
    orient: 'auto-start-reverse',
  })
  arrow.append(svgElement('path', {
    class: 'tidb-machine__arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(arrow)
  svg.append(
    defs,
    svgElement('rect', {
      class: 'tidb-machine__backdrop',
      x: '0',
      y: '0',
      width: String(width),
      height: String(height),
      rx: '14',
    }),
  )

  appendSvgText(svg, 'tidb-machine__plot-eyebrow', MACHINE_COPY[locale].eyebrow, 18, 28)
  appendSvgText(
    svg,
    'tidb-machine__time-title',
    `${MACHINE_COPY[locale].modelTime.toUpperCase()} / ms`,
    plotLeft,
    28,
  )

  const tickCount = 5
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = (maxAt * tick) / tickCount
    const x = xOf(value)
    svg.append(svgElement('line', {
      class: 'tidb-machine__gridline',
      x1: String(x),
      x2: String(x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight),
      'data-time-tick': String(tick),
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__tick-label',
      tick === 0 ? '0' : String(Math.round(value * 10) / 10),
      x,
      53,
      { 'text-anchor': tick === 0 ? 'start' : tick === tickCount ? 'end' : 'middle' },
    )
  }

  MACHINE_LANES.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight
    const eventCount = receipt.events.filter((event) => event.domain === lane).length
    const group = svgElement('g', {
      class: 'tidb-machine__lane',
      'data-lane': lane,
      role: 'group',
      'aria-label': LANE_LABELS[locale][lane],
    })
    const background = svgElement('rect', {
      class: 'tidb-machine__lane-bg',
      x: '8',
      y: String(y + 2),
      width: String(width - 16),
      height: String(laneHeight - 4),
      rx: '8',
    })
    const accent = svgElement('rect', {
      class: 'tidb-machine__lane-accent',
      x: '8',
      y: String(y + 12),
      width: '3',
      height: String(laneHeight - 24),
      rx: '1.5',
    })
    const axis = svgElement('line', {
      class: 'tidb-machine__axis',
      x1: String(plotLeft),
      x2: String(plotRight),
      y1: String(y + laneHeight / 2),
      y2: String(y + laneHeight / 2),
    })
    group.append(background, accent)
    appendSvgText(group, 'tidb-machine__lane-code', LANE_CODES[lane], 24, y + 28)
    appendSvgText(group, 'tidb-machine__lane-label', LANE_LABELS[locale][lane], 24, y + 47)
    appendSvgText(
      group,
      'tidb-machine__lane-count',
      String(eventCount).padStart(2, '0'),
      186,
      y + 38,
      { 'text-anchor': 'end', 'aria-label': `${eventCount} events` },
    )
    group.append(axis)
    svg.append(group)
  })

  const lastPlacement = new Map<MachineLane, { x: number; level: number }>()
  const layouts: TimelineEventLayout[] = receipt.events.map((event, index) => {
    const laneIndex = MACHINE_LANES.indexOf(event.domain)
    const x = xOf(event.atMs)
    const previousPlacement = lastPlacement.get(event.domain)
    const level = previousPlacement && x - previousPlacement.x < 30
      ? (previousPlacement.level + 1) % 3
      : 0
    lastPlacement.set(event.domain, { x, level })
    const yOffset = [0, -12, 12][level] ?? 0
    return {
      event,
      index,
      x,
      endX: xOf(event.atMs + Math.max(0, event.durationMs)),
      y: top + laneIndex * laneHeight + laneHeight / 2 + yOffset,
      state: index === currentIndex ? 'current' : index < currentIndex ? 'complete' : 'future',
      status: machineStatus(event.status),
    }
  })

  const durationLayer = svgElement('g', {
    class: 'tidb-machine__duration-layer',
    'aria-hidden': 'true',
  })
  for (const layout of layouts) {
    durationLayer.append(svgElement('rect', {
      class: `tidb-machine__duration is-${layout.state} is-${layout.status}`,
      x: String(layout.x),
      y: String(layout.y - 4),
      width: String(Math.max(10, layout.endX - layout.x)),
      height: '8',
      rx: '4',
      'data-event-duration': String(layout.event.durationMs),
      'data-duration-domain': layout.event.domain,
    }))
  }
  svg.append(durationLayer)

  const causalLayer = svgElement('g', {
    class: 'tidb-machine__causal-layer',
    'aria-hidden': 'true',
    'data-graph-kind': 'causal-dag',
  })
  const layoutById = new Map(layouts.map((layout) => [layout.event.id, layout]))
  for (let index = 0; index < layouts.length; index += 1) {
    const layout = layouts[index]
    if (!layout) continue
    const parentIds = layout.event.dependsOn
      ?? (index > 0 ? [layouts[index - 1].event.id] : [])
    for (const parentId of parentIds) {
      const previous = layoutById.get(parentId)
      if (!previous || previous === layout) continue
      const horizontal = Math.max(0, layout.x - previous.x)
      const distance = Math.max(26, horizontal * 0.42)
      causalLayer.append(svgElement('path', {
        class: `tidb-machine__causal is-${layout.state}`,
        d: [
          `M ${previous.x} ${previous.y}`,
          `C ${previous.x + distance} ${previous.y}`,
          `${layout.x - distance} ${layout.y}`,
          `${layout.x} ${layout.y}`,
        ].join(' '),
        'data-causal-from': previous.event.id,
        'data-causal-to': layout.event.id,
        'data-causal-domain': layout.event.domain,
        'data-causal-path': layout.event.criticalPath === false ? 'background' : 'critical',
        'marker-end': 'url(#tidb-machine-arrow)',
      }))
    }
  }
  svg.append(causalLayer)

  const currentLayout = currentIndex >= 0 ? layouts[currentIndex] : undefined
  if (currentLayout) {
    svg.append(svgElement('line', {
      class: 'tidb-machine__cursor',
      x1: String(currentLayout.x),
      x2: String(currentLayout.x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight + 14),
      'aria-hidden': 'true',
    }))
    const cursorLabelWidth = 74
    const cursorLabelX = Math.max(
      plotLeft,
      Math.min(plotRight - cursorLabelWidth, currentLayout.x - cursorLabelWidth / 2),
    )
    svg.append(svgElement('rect', {
      class: 'tidb-machine__cursor-badge',
      x: String(cursorLabelX),
      y: String(height - 28),
      width: String(cursorLabelWidth),
      height: '21',
      rx: '10.5',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__cursor-label',
      formatModelTime(currentLayout.event.atMs),
      cursorLabelX + cursorLabelWidth / 2,
      height - 14,
      { 'text-anchor': 'middle' },
    )
  }

  for (const layout of layouts) {
    const { event, index, state, status, x, y } = layout
    const accessibleName = [
      `${CATALOG[locale].event} ${index + 1}`,
      LANE_LABELS[locale][event.domain],
      event.label,
      formatModelTime(event.atMs),
      `${MACHINE_COPY[locale].duration}: ${formatModelTime(Math.max(0, event.durationMs))}`,
      `status: ${status}`,
    ].join(', ')
    const eventNode = svgElement('g', {
      class: `tidb-machine__event is-${status} is-${state}`,
      tabindex: '0',
      role: 'button',
      'aria-label': accessibleName,
      'aria-current': state === 'current' ? 'step' : 'false',
      'data-event-id': event.id,
      'data-event-index': String(index),
      'data-event-domain': event.domain,
      'data-event-kind': event.kind ?? '',
      'data-event-branch': event.branchId ?? '',
      'data-event-transaction': event.transactionId ?? '',
      'data-event-has-lock-snapshot': event.snapshot?.lockLab ? 'true' : 'false',
      'data-event-has-raft-snapshot': event.snapshot?.raftLab ? 'true' : 'false',
      'data-event-status': status,
      'data-event-state': state,
    })
    const title = svgElement('title')
    title.textContent = accessibleName
    eventNode.append(
      title,
      svgElement('circle', {
        class: 'tidb-machine__event-hit',
        cx: String(x),
        cy: String(y),
        r: '19',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-halo',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '14' : '12',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-core',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '8.5' : '7',
      }),
    )
    appendSvgText(
      eventNode,
      'tidb-machine__event-glyph',
      status === 'failed' ? '×' : status === 'warning' ? '!' : String(index + 1),
      x,
      y + 3.25,
      { 'text-anchor': 'middle', 'aria-hidden': 'true' },
    )
    svg.append(eventNode)
  }

  if (currentLayout) {
    const calloutWidth = 238
    const calloutHeight = 28
    const calloutOnLeft = currentLayout.x > width - calloutWidth - 46
    const calloutX = calloutOnLeft
      ? currentLayout.x - calloutWidth - 20
      : currentLayout.x + 20
    const calloutY = currentLayout.y - calloutHeight / 2
    svg.append(svgElement('line', {
      class: 'tidb-machine__callout-leader',
      x1: String(currentLayout.x + (calloutOnLeft ? -10 : 10)),
      x2: String(calloutOnLeft ? calloutX + calloutWidth : calloutX),
      y1: String(currentLayout.y),
      y2: String(currentLayout.y),
      'aria-hidden': 'true',
    }))
    svg.append(svgElement('rect', {
      class: 'tidb-machine__callout',
      x: String(calloutX),
      y: String(calloutY),
      width: String(calloutWidth),
      height: String(calloutHeight),
      rx: '7',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__event-label',
      `${String(currentLayout.index + 1).padStart(2, '0')}  ${shortLabel(currentLayout.event.label)}`,
      calloutX + 11,
      currentLayout.y + 4,
      { 'aria-hidden': 'true' },
    )
  }
  return svg
}

export function mountMachine(root: HTMLElement, options: MachineOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const copy = MACHINE_COPY[locale]
  const receipt = options.adaptReceipt
    ? options.adaptReceipt(options.receipt)
    : adaptTraceReceipt(options.receipt)
  const total = receipt.events.length
  const maxAt = receiptEndMs(receipt)
  installCityUiStyles(root.ownerDocument ?? document)
  installMachineStyles(root.ownerDocument ?? document)

  let current = resolveMachineEventIndex(
    receipt,
    options.initialEventId,
    options.initialIndex ?? 0,
  )
  let timer: ReturnType<typeof setInterval> | null = null
  const frame = element('div', { className: 'tidb-machine__frame' })
  const hasLockSnapshots = receipt.events.some((event) => Boolean(event.snapshot?.lockLab))
  const lockSlot = element('div', { className: 'tidb-machine__lock-slot' })
  const hasRaftSnapshots = receipt.events.some((event) => Boolean(event.snapshot?.raftLab))
  const raftSlot = element('div', { className: 'tidb-machine__raft-slot' })
  const detail = element('section', {
    className: 'tidb-machine__detail',
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
  })
  const play = element('button', {
    className: 'tidb-button tidb-button--primary',
    text: CATALOG[locale].play,
    attrs: {
      type: 'button',
      'data-action': 'play',
      'aria-pressed': 'false',
    },
  })
  const step = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].step,
    attrs: { type: 'button', 'data-action': 'step' },
  })
  const reset = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].reset,
    attrs: { type: 'button', 'data-action': 'reset' },
  })
  if (total === 0) {
    play.setAttribute('disabled', '')
    step.setAttribute('disabled', '')
    reset.setAttribute('disabled', '')
  }

  const createMetric = (label: string) => {
    const value = element('strong', { className: 'tidb-machine__metric-value', text: copy.empty })
    return {
      value,
      node: element('div', { className: 'tidb-machine__metric' },
        element('span', { className: 'tidb-machine__metric-label', text: label }),
        value,
      ),
    }
  }
  const stepMetric = createMetric(copy.step)
  const timeMetric = createMetric(copy.modelTime)
  const layerMetric = createMetric(copy.activeLayer)
  const windowMetric = createMetric(copy.timeWindow)
  windowMetric.value.textContent = total > 0 ? formatModelTime(maxAt) : copy.empty
  const overview = element('section', {
    className: 'tidb-machine__overview',
    attrs: { 'aria-label': copy.summary },
  },
  stepMetric.node,
  timeMetric.node,
  layerMetric.node,
  windowMetric.node,
  )
  const progressText = element('span', {
    className: 'tidb-machine__progress-text',
    text: total > 0 ? `1 / ${total}` : `0 / 0`,
  })
  const progress = element('progress', {
    className: 'tidb-machine__progress',
    attrs: {
      max: String(Math.max(1, total)),
      value: total > 0 ? '1' : '0',
      'aria-label': copy.progress,
    },
  })
  const transport = element('div', { className: 'tidb-machine__transport' },
    element('div', { className: 'tidb-machine__controls' }, play, step, reset),
    element('div', { className: 'tidb-machine__progress-wrap' },
      element('div', { className: 'tidb-machine__progress-label' },
        element('span', { text: copy.progress }),
        progressText,
      ),
      progress,
    ),
  )

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    play.textContent = CATALOG[locale].play
    play.setAttribute('aria-pressed', 'false')
  }
  const sync = () => {
    frame.replaceChildren(renderTimeline(receipt, locale, current))
    const event = current >= 0 ? receipt.events[current] : null
    const position = event ? current + 1 : 0
    stepMetric.value.textContent = event ? `${position} / ${total}` : copy.empty
    timeMetric.value.textContent = event ? formatModelTime(event.atMs) : copy.empty
    layerMetric.value.textContent = event
      ? `${LANE_CODES[event.domain]} · ${LANE_LABELS[locale][event.domain]}`
      : copy.empty
    progress.setAttribute('value', String(position))
    progress.setAttribute('aria-valuetext', `${position} / ${total}`)
    progressText.textContent = `${position} / ${total}`

    if (event) {
      const route = [event.source, event.target].filter(Boolean).join(' → ')
      const status = machineStatus(event.status)
      detail.setAttribute('data-current-domain', event.domain)
      detail.setAttribute('data-current-status', status)
      detail.setAttribute('data-current-event-id', event.id)
      detail.setAttribute('data-current-event-kind', event.kind ?? '')
      detail.setAttribute('data-current-event-branch', event.branchId ?? '')
      const eventMeta = element('dl', { className: 'tidb-machine__detail-meta' },
        element('div', {},
          element('dt', { text: copy.modelTime }),
          element('dd', { text: formatModelTime(event.atMs) }),
        ),
        element('div', {},
          element('dt', { text: copy.activeLayer }),
          element('dd', { text: LANE_LABELS[locale][event.domain] }),
        ),
        element('div', {},
          element('dt', { text: copy.duration }),
          element('dd', { text: formatModelTime(Math.max(0, event.durationMs)) }),
        ),
      )
      if (event.kind) {
        eventMeta.append(element('div', {
          attrs: { 'data-detail-event-kind': event.kind },
        },
        element('dt', { text: copy.eventKind }),
        element('dd', { text: event.kind }),
        ))
      }
      if (event.branchId) {
        eventMeta.append(element('div', {
          attrs: { 'data-detail-event-branch': event.branchId },
        },
        element('dt', { text: copy.branch }),
        element('dd', { text: event.branchId }),
        ))
      }
      const detailNodes: Node[] = [
        element('div', { className: 'tidb-machine__detail-head' },
          element('p', {
            className: 'tidb-machine__detail-eyebrow',
            text: `${copy.current} · ${CATALOG[locale].event} ${position} / ${total}`,
          }),
          element('p', {
            className: `tidb-machine__status is-${status}`,
            text: `status: ${status}`,
          }),
        ),
        element('h2', { text: event.label }),
        eventMeta,
      ]
      if (event.detail) {
        detailNodes.push(element('p', { className: 'tidb-machine__detail-copy', text: event.detail }))
      }
      if (route) {
        detailNodes.push(element('p', { className: 'tidb-machine__route' },
          element('strong', { text: `${copy.route}: ` }),
          element('span', { text: route }),
        ))
      }
      detail.replaceChildren(...detailNodes)
    } else {
      detail.removeAttribute('data-current-domain')
      detail.removeAttribute('data-current-status')
      detail.removeAttribute('data-current-event-id')
      detail.removeAttribute('data-current-event-kind')
      detail.removeAttribute('data-current-event-branch')
      detail.replaceChildren(element('p', { className: 'tidb-machine__empty', text: CATALOG[locale].emptyTrace }))
    }
    if (hasLockSnapshots) {
      const lockState = event ? renderLockState(event, locale) : null
      lockSlot.hidden = lockState === null
      lockSlot.setAttribute('aria-hidden', lockState === null ? 'true' : 'false')
      if (lockState) lockSlot.replaceChildren(lockState)
      else lockSlot.replaceChildren()
    }
    if (hasRaftSnapshots) {
      const raftState = event ? renderRaftState(event, locale) : null
      raftSlot.hidden = raftState === null
      raftSlot.setAttribute('aria-hidden', raftState === null ? 'true' : 'false')
      if (raftState) raftSlot.replaceChildren(raftState)
      else raftSlot.replaceChildren()
    }
    options.onSeek?.(event, current)

    for (const marker of frame.querySelectorAll<SVGElement>('[data-event-index]')) {
      marker.addEventListener('click', () => {
        current = Number(marker.dataset.eventIndex)
        stop()
        sync()
      })
      marker.addEventListener('keydown', (rawEvent) => {
        const keyboardEvent = rawEvent as KeyboardEvent
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
        keyboardEvent.preventDefault()
        const selectedIndex = Number(marker.dataset.eventIndex)
        if (!Number.isInteger(selectedIndex)) return
        current = selectedIndex
        stop()
        sync()
        frame.querySelector<SVGElement>(`[data-event-index="${selectedIndex}"]`)?.focus()
      })
    }
  }

  play.addEventListener('click', () => {
    if (timer !== null) {
      stop()
      return
    }
    if (total === 0) return
    play.textContent = CATALOG[locale].pause
    play.setAttribute('aria-pressed', 'true')
    timer = setInterval(() => {
      if (current >= total - 1) {
        stop()
        return
      }
      current += 1
      sync()
    }, Math.max(100, options.stepIntervalMs ?? 750))
  })
  step.addEventListener('click', () => {
    stop()
    if (total > 0) current = Math.min(total - 1, current + 1)
    sync()
  })
  reset.addEventListener('click', () => {
    stop()
    current = total > 0 ? 0 : -1
    sync()
  })

  root.classList.add('tidb-surface', 'tidb-machine')
  root.setAttribute('lang', locale)
  root.replaceChildren(
    element('header', { className: 'tidb-machine__head' },
      element('div', {},
        element('h1', { text: CATALOG[locale].machineTitle }),
        element('p', { text: CATALOG[locale].machineSubtitle }),
      ),
      createModelBadge(locale),
    ),
    overview,
    transport,
    frame,
    ...(hasLockSnapshots ? [lockSlot] : []),
    ...(hasRaftSnapshots ? [raftSlot] : []),
    detail,
    element('p', { className: 'tidb-machine__note', text: CATALOG[locale].simulatedTiming }),
  )
  sync()
  if (options.autoplay) play.click()
}

export type {
  TraceDomain,
  TraceEvent,
  TraceReceipt,
}
