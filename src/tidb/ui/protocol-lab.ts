// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceProtocolEligibilitySnapshot,
  TraceProtocolLabSnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolLaneStage,
  TraceProtocolRaftOperation,
  TraceProtocolRaftStage,
  TraceProtocolRegionSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

type ProtocolLabPhase = TraceProtocolLabSnapshot['phase']
type SelectionReason =
  TraceProtocolEligibilitySnapshot['selectionReason']
type OnePcDecisionPoint =
  TraceProtocolEligibilitySnapshot['onePcDecisionPoint']
type AsyncDecisionPoint =
  TraceProtocolEligibilitySnapshot['asyncDecisionPoint']
type RegionRole = TraceProtocolRegionSnapshot['role']

const LANE_IDS = [
  'one_pc',
  'async_commit',
  'two_pc',
] as const satisfies readonly TraceProtocolLaneId[]

interface ProtocolLabCopy {
  readonly title: string
  readonly model: string
  readonly phase: string
  readonly overview: string
  readonly boundary: string
  readonly coordinatorLayer: string
  readonly coordinatorLayerValue: string
  readonly raftLayer: string
  readonly raftLayerValue: string
  readonly boundaryNote: string
  readonly assumptions: string
  readonly consistency: string
  readonly linearizable: string
  readonly asyncApplyPrewrite: string
  readonly disabled: string
  readonly backgroundPolicy: string
  readonly backgroundPolicyValue: string
  readonly maxCommitTsPolicy: string
  readonly maxCommitTsPolicyValue: string
  readonly privacy: string
  readonly privacyNote: string
  readonly selectionProfile: string
  readonly requestId: string
  readonly transactionId: string
  readonly selectedProtocol: string
  readonly laneStage: string
  readonly featureFlags: string
  readonly enabled: string
  readonly fixtureShape: string
  readonly aggregateMutations: string
  readonly totalKeyBytes: string
  readonly regions: string
  readonly eligibility: string
  readonly eligible: string
  readonly ineligible: string
  readonly selectionReason: string
  readonly decisionPoints: string
  readonly rpcFlags: string
  readonly sent: string
  readonly notSent: string
  readonly rejected: string
  readonly accepted: string
  readonly clientPrecheck: string
  readonly limits: string
  readonly keys: string
  readonly bytes: string
  readonly runtimeFallback: string
  readonly no: string
  readonly yes: string
  readonly timestamps: string
  readonly pending: string
  readonly notUsed: string
  readonly modelBound: string
  readonly clientPath: string
  readonly clientAwaiting: string
  readonly clientResponded: string
  readonly backgroundPath: string
  readonly backgroundNotRequired: string
  readonly backgroundNotStarted: string
  readonly backgroundPending: string
  readonly backgroundActive: string
  readonly backgroundComplete: string
  readonly regionRole: Readonly<Record<RegionRole, string>>
  readonly leader: string
  readonly mutationCount: string
  readonly raftOperation: string
  readonly raftStage: string
  readonly raftIndex: string
  readonly persistenceQuorum: string
  readonly voters: string
  readonly persistedVoters: string
  readonly none: string
  readonly mvcc: string
  readonly defaultCf: string
  readonly lockCf: string
  readonly writeCf: string
  readonly asyncLockMetadata: string
  readonly secondaryCount: string
  readonly returnedMinCommitTs: string
  readonly phases: Readonly<Record<ProtocolLabPhase, string>>
  readonly laneNames: Readonly<Record<TraceProtocolLaneId, string>>
  readonly stages: Readonly<Record<TraceProtocolLaneStage, string>>
  readonly reasons: Readonly<Record<SelectionReason, string>>
  readonly onePcDecisionPoints:
    Readonly<Record<OnePcDecisionPoint, string>>
  readonly asyncDecisionPoints:
    Readonly<Record<AsyncDecisionPoint, string>>
  readonly raftOperations:
    Readonly<Record<TraceProtocolRaftOperation, string>>
  readonly raftStages: Readonly<Record<TraceProtocolRaftStage, string>>
}

const COPY: Readonly<Record<Locale, ProtocolLabCopy>> = {
  ja: {
    title: 'コミットプロトコル Lab',
    model: 'MODEL / SIMULATED',
    phase: 'フェーズ',
    overview:
      '独立した3つの楽観的トランザクションで、1PC・Async Commit・通常2PCのメッセージ形状を比較します。',
    boundary: 'トランザクションとRaftの境界',
    coordinatorLayer: 'トランザクション層',
    coordinatorLayerValue: 'TiDB transaction commit coordinator',
    raftLayer: 'レプリケーション層',
    raftLayerValue: 'RegionごとのRaft consensus（3 voter / quorum 2）',
    boundaryNote:
      '1PC・Async Commit・2PCはトランザクションのcommit方式です。各Regionの変更は、それとは別にRegion固有のRaft quorumで複製されます。',
    assumptions: '比較条件',
    consistency: '整合性',
    linearizable: 'linear consistency',
    asyncApplyPrewrite: 'TiKV async apply prewrite',
    disabled: '無効',
    backgroundPolicy: '背景処理の順序',
    backgroundPolicyValue: 'client応答後に決定的に表示（TiCity MODEL POLICY）',
    maxCommitTsPolicy: 'max_commit_ts',
    maxCommitTsPolicyValue: '代表的なsafe-window境界（MODEL値）',
    privacy: 'プライバシー境界',
    privacyNote:
      '集計数と合成IDだけを表示します。SQL文、literal、実key、encoded key、row値、結果行は保持も投影もしません。',
    selectionProfile: '選択プロファイル',
    requestId: '合成Request ID',
    transactionId: '合成Transaction ID',
    selectedProtocol: '選択結果',
    laneStage: '状態',
    featureFlags: '有効な候補',
    enabled: 'ON',
    fixtureShape: '代表fixture',
    aggregateMutations: '集計mutation',
    totalKeyBytes: '合計key bytes',
    regions: 'Regions',
    eligibility: '候補判定',
    eligible: '対象',
    ineligible: '対象外',
    selectionReason: '選択理由',
    decisionPoints: '判定点',
    rpcFlags: 'RPC前の判定 / flag',
    sent: '送信',
    notSent: '未送信',
    rejected: '除外',
    accepted: '除外なし',
    clientPrecheck: 'client precheck',
    limits: 'Async Commit client既定上限',
    keys: 'keys',
    bytes: 'bytes',
    runtimeFallback: '実行時fallback',
    no: 'なし',
    yes: 'あり',
    timestamps: 'Timestamp経路',
    pending: '未確定',
    notUsed: 'この方式では未使用',
    modelBound: 'MODEL境界',
    clientPath: 'Client境界',
    clientAwaiting: '応答待ち',
    clientResponded: 'commit応答済み',
    backgroundPath: '背景cleanup',
    backgroundNotRequired: '不要',
    backgroundNotStarted: '未開始',
    backgroundPending: 'client応答後に待機',
    backgroundActive: '実行中',
    backgroundComplete: '完了',
    regionRole: {
      primary: 'PRIMARY',
      secondary: 'SECONDARY',
    },
    leader: 'Leader',
    mutationCount: '集計mutation',
    raftOperation: 'Raft entry',
    raftStage: 'Raft状態',
    raftIndex: 'Raft index',
    persistenceQuorum: '永続化quorum',
    voters: '3 voters',
    persistedVoters: '永続化voter',
    none: 'なし',
    mvcc: '概念的MVCC投影',
    defaultCf: 'DEFAULT CF',
    lockCf: 'LOCK CF',
    writeCf: 'WRITE CF',
    asyncLockMetadata: 'Async Commit lock metadata',
    secondaryCount: 'primary上のsecondary count',
    returnedMinCommitTs: '返却 min_commit_ts',
    phases: {
      idle: '待機',
      running: '比較を実行中',
      complete: '比較完了',
    },
    laneNames: {
      one_pc: '1PC',
      async_commit: 'Async Commit',
      two_pc: '通常2PC',
    },
    stages: {
      idle: '待機',
      requested: 'request受付',
      started: 'start_ts取得',
      selected: '方式選択',
      latest_ts: 'latest_ts取得',
      prewriting: 'Prewrite中',
      prewritten: 'Prewrite完了',
      commit_ts: 'commit_ts取得',
      committing: 'Commit中',
      client_acknowledged: 'client応答済み',
      background: '背景cleanup',
      complete: '完了',
    },
    reasons: {
      single_region_one_pc_model_case:
        '単一Regionの代表fixtureで1PCを優先（MODEL CASE）',
      multi_region_async_commit_model_case:
        '複数Regionかつ上限内の代表fixtureでAsync Commitを選択（MODEL CASE）',
      async_key_count_limit_model_case:
        '集計mutation数がclient既定上限を超える代表fixtureのため通常2PC（MODEL CASE）',
    },
    onePcDecisionPoints: {
      region_batching: 'Region batching',
      tikv_prewrite: 'TiKV Prewrite',
    },
    asyncDecisionPoints: {
      client_precheck: 'client precheck',
      tikv_prewrite: 'TiKV Prewrite',
    },
    raftOperations: {
      one_pc_prewrite: '1PC Prewrite',
      prewrite: 'Prewrite',
      commit_primary: 'Commit primary',
      commit_secondary: 'Commit secondary',
      commit_async: 'Async Commit cleanup',
    },
    raftStages: {
      idle: '待機',
      proposed: '提案済み',
      persisted_quorum: 'quorum永続化',
      committed: 'commit済み',
      applied: 'apply済み',
    },
  },
  en: {
    title: 'Commit Protocol Lab',
    model: 'MODEL / SIMULATED',
    phase: 'Phase',
    overview:
      'Three independent optimistic transactions compare the message shapes of 1PC, Async Commit, and regular 2PC.',
    boundary: 'Transaction / Raft boundary',
    coordinatorLayer: 'Transaction layer',
    coordinatorLayerValue: 'TiDB transaction commit coordinator',
    raftLayer: 'Replication layer',
    raftLayerValue: 'Per-Region Raft consensus (3 voters / quorum 2)',
    boundaryNote:
      '1PC, Async Commit, and 2PC are transaction commit protocols. Each Region replicates its mutations through a separate, Region-local Raft quorum.',
    assumptions: 'Comparison assumptions',
    consistency: 'Consistency',
    linearizable: 'Linear consistency',
    asyncApplyPrewrite: 'TiKV async apply prewrite',
    disabled: 'Disabled',
    backgroundPolicy: 'Background ordering',
    backgroundPolicyValue:
      'Shown deterministically after the client boundary (TiCity MODEL POLICY)',
    maxCommitTsPolicy: 'max_commit_ts',
    maxCommitTsPolicyValue:
      'Representative safe-window bound (MODEL value)',
    privacy: 'Privacy boundary',
    privacyNote:
      'Only aggregate counts and synthetic IDs are shown. SQL text, literals, real or encoded keys, row values, and result rows are neither retained nor projected.',
    selectionProfile: 'Selection profile',
    requestId: 'Synthetic request ID',
    transactionId: 'Synthetic transaction ID',
    selectedProtocol: 'Selected',
    laneStage: 'State',
    featureFlags: 'Enabled candidates',
    enabled: 'ON',
    fixtureShape: 'Representative fixture',
    aggregateMutations: 'aggregate mutations',
    totalKeyBytes: 'total key bytes',
    regions: 'Regions',
    eligibility: 'Eligibility',
    eligible: 'eligible',
    ineligible: 'ineligible',
    selectionReason: 'Selection reason',
    decisionPoints: 'Decision points',
    rpcFlags: 'Pre-RPC decisions / flag',
    sent: 'sent',
    notSent: 'not sent',
    rejected: 'rejected',
    accepted: 'not rejected',
    clientPrecheck: 'client precheck',
    limits: 'Async Commit client defaults',
    keys: 'keys',
    bytes: 'bytes',
    runtimeFallback: 'Runtime fallback',
    no: 'No',
    yes: 'Yes',
    timestamps: 'Timestamp path',
    pending: 'Pending',
    notUsed: 'Not used by this protocol',
    modelBound: 'MODEL bound',
    clientPath: 'Client boundary',
    clientAwaiting: 'Awaiting response',
    clientResponded: 'Committed response sent',
    backgroundPath: 'Background cleanup',
    backgroundNotRequired: 'Not required',
    backgroundNotStarted: 'Not started',
    backgroundPending: 'Pending after client response',
    backgroundActive: 'In progress',
    backgroundComplete: 'Complete',
    regionRole: {
      primary: 'PRIMARY',
      secondary: 'SECONDARY',
    },
    leader: 'Leader',
    mutationCount: 'Aggregate mutations',
    raftOperation: 'Raft entry',
    raftStage: 'Raft state',
    raftIndex: 'Raft index',
    persistenceQuorum: 'Persistence quorum',
    voters: '3 voters',
    persistedVoters: 'Persisted voters',
    none: 'None',
    mvcc: 'Conceptual MVCC projection',
    defaultCf: 'DEFAULT CF',
    lockCf: 'LOCK CF',
    writeCf: 'WRITE CF',
    asyncLockMetadata: 'Async Commit lock metadata',
    secondaryCount: 'Secondary count on primary',
    returnedMinCommitTs: 'Returned min_commit_ts',
    phases: {
      idle: 'Idle',
      running: 'Comparison running',
      complete: 'Comparison complete',
    },
    laneNames: {
      one_pc: '1PC',
      async_commit: 'Async Commit',
      two_pc: 'Regular 2PC',
    },
    stages: {
      idle: 'Idle',
      requested: 'Request received',
      started: 'start_ts allocated',
      selected: 'Protocol selected',
      latest_ts: 'latest_ts obtained',
      prewriting: 'Prewriting',
      prewritten: 'Prewrite complete',
      commit_ts: 'commit_ts allocated',
      committing: 'Committing',
      client_acknowledged: 'Client acknowledged',
      background: 'Background cleanup',
      complete: 'Complete',
    },
    reasons: {
      single_region_one_pc_model_case:
        'Single-Region representative fixture; 1PC takes precedence (MODEL CASE)',
      multi_region_async_commit_model_case:
        'Multi-Region representative fixture within both limits; select Async Commit (MODEL CASE)',
      async_key_count_limit_model_case:
        'Aggregate mutation count exceeds the client default; select regular 2PC (MODEL CASE)',
    },
    onePcDecisionPoints: {
      region_batching: 'Region batching',
      tikv_prewrite: 'TiKV Prewrite',
    },
    asyncDecisionPoints: {
      client_precheck: 'Client precheck',
      tikv_prewrite: 'TiKV Prewrite',
    },
    raftOperations: {
      one_pc_prewrite: '1PC Prewrite',
      prewrite: 'Prewrite',
      commit_primary: 'Commit primary',
      commit_secondary: 'Commit secondary',
      commit_async: 'Async Commit cleanup',
    },
    raftStages: {
      idle: 'Idle',
      proposed: 'Proposed',
      persisted_quorum: 'Quorum persisted',
      committed: 'Committed',
      applied: 'Applied',
    },
  },
}

interface MetricView {
  readonly root: HTMLElement
  readonly label: HTMLElement
  readonly value: HTMLElement
}

interface RegionView {
  readonly root: HTMLElement
  readonly heading: HTMLElement
  readonly role: HTMLElement
  readonly leader: MetricView
  readonly mutations: MetricView
  readonly raftOperation: MetricView
  readonly raftStage: MetricView
  readonly raftIndex: MetricView
  readonly quorum: MetricView
  readonly persisted: MetricView
  readonly mvccHeading: HTMLElement
  readonly defaultCf: MetricView
  readonly lockCf: MetricView
  readonly writeCf: MetricView
  readonly asyncMetadata: MetricView
  readonly secondaryCount: MetricView
  readonly returnedMinCommitTs: MetricView
}

interface LaneView {
  readonly root: HTMLElement
  readonly heading: HTMLElement
  readonly protocolBadge: HTMLElement
  readonly profileHeading: HTMLElement
  readonly requestId: MetricView
  readonly transactionId: MetricView
  readonly selected: MetricView
  readonly stage: MetricView
  readonly featureFlags: MetricView
  readonly fixture: MetricView
  readonly eligibility: MetricView
  readonly reason: MetricView
  readonly decisionPoints: MetricView
  readonly rpcFlags: MetricView
  readonly limits: MetricView
  readonly runtimeFallback: MetricView
  readonly timestampsHeading: HTMLElement
  readonly startTs: MetricView
  readonly latestTs: MetricView
  readonly requestMinCommitTs: MetricView
  readonly maxCommitTs: MetricView
  readonly commitTs: MetricView
  readonly client: MetricView
  readonly background: MetricView
  readonly regionsHeading: HTMLElement
  readonly regionList: HTMLElement
  readonly regions: readonly [RegionView, RegionView]
}

function createMetric(className: string): MetricView {
  const label = element('dt')
  const value = element('dd')
  return {
    root: element('div', { className }, label, value),
    label,
    value,
  }
}

function updateMetric(
  metric: MetricView,
  label: string,
  value: string,
): void {
  metric.label.textContent = label
  metric.value.textContent = value
}

function datasetKey(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase())
}

function setData(node: HTMLElement, name: string, value: string): void {
  node.setAttribute(`data-${name}`, value)
  node.dataset[datasetKey(name)] = value
}

function removeData(node: HTMLElement, name: string): void {
  node.removeAttribute(`data-${name}`)
  delete node.dataset[datasetKey(name)]
}

function createRegionView(slot: number): RegionView {
  const heading = element('h4')
  const role = element('span', {
    className: 'tidb-protocol-lab__region-role',
  })
  const leader = createMetric('tidb-protocol-lab__metric')
  const mutations = createMetric('tidb-protocol-lab__metric')
  const raftOperation = createMetric('tidb-protocol-lab__metric')
  const raftStage = createMetric('tidb-protocol-lab__metric')
  const raftIndex = createMetric('tidb-protocol-lab__metric')
  const quorum = createMetric('tidb-protocol-lab__metric')
  const persisted = createMetric('tidb-protocol-lab__metric')
  const mvccHeading = element('h5')
  const defaultCf = createMetric('tidb-protocol-lab__cf')
  const lockCf = createMetric('tidb-protocol-lab__cf')
  const writeCf = createMetric('tidb-protocol-lab__cf')
  const asyncMetadata = createMetric('tidb-protocol-lab__metric')
  const secondaryCount = createMetric('tidb-protocol-lab__metric')
  const returnedMinCommitTs = createMetric('tidb-protocol-lab__metric')
  const root = element(
    'article',
    {
      className: 'tidb-protocol-lab__region',
      attrs: {
        role: 'listitem',
        'data-region-slot': String(slot),
      },
    },
    element(
      'header',
      { className: 'tidb-protocol-lab__region-head' },
      heading,
      role,
    ),
    element(
      'dl',
      { className: 'tidb-protocol-lab__facts' },
      leader.root,
      mutations.root,
      raftOperation.root,
      raftStage.root,
      raftIndex.root,
      quorum.root,
      persisted.root,
    ),
    mvccHeading,
    element(
      'dl',
      { className: 'tidb-protocol-lab__mvcc' },
      defaultCf.root,
      lockCf.root,
      writeCf.root,
      asyncMetadata.root,
      secondaryCount.root,
      returnedMinCommitTs.root,
    ),
  )
  root.hidden = true
  root.setAttribute('aria-hidden', 'true')
  return {
    root,
    heading,
    role,
    leader,
    mutations,
    raftOperation,
    raftStage,
    raftIndex,
    quorum,
    persisted,
    mvccHeading,
    defaultCf,
    lockCf,
    writeCf,
    asyncMetadata,
    secondaryCount,
    returnedMinCommitTs,
  }
}

function createLaneView(id: TraceProtocolLaneId): LaneView {
  const heading = element('h3')
  const protocolBadge = element('span', {
    className: 'tidb-protocol-lab__protocol',
  })
  const profileHeading = element('h4')
  const requestId = createMetric('tidb-protocol-lab__metric')
  const transactionId = createMetric('tidb-protocol-lab__metric')
  const selected = createMetric('tidb-protocol-lab__metric')
  const stage = createMetric('tidb-protocol-lab__metric')
  const featureFlags = createMetric('tidb-protocol-lab__metric')
  const fixture = createMetric('tidb-protocol-lab__metric')
  const eligibility = createMetric('tidb-protocol-lab__metric')
  const reason = createMetric('tidb-protocol-lab__metric')
  const decisionPoints = createMetric('tidb-protocol-lab__metric')
  const rpcFlags = createMetric('tidb-protocol-lab__metric')
  const limits = createMetric('tidb-protocol-lab__metric')
  const runtimeFallback = createMetric('tidb-protocol-lab__metric')
  const timestampsHeading = element('h4')
  const startTs = createMetric('tidb-protocol-lab__metric')
  const latestTs = createMetric('tidb-protocol-lab__metric')
  const requestMinCommitTs = createMetric('tidb-protocol-lab__metric')
  const maxCommitTs = createMetric('tidb-protocol-lab__metric')
  const commitTs = createMetric('tidb-protocol-lab__metric')
  const client = createMetric('tidb-protocol-lab__path-marker')
  const background = createMetric('tidb-protocol-lab__path-marker')
  const regionsHeading = element('h4')
  const regions = [
    createRegionView(0),
    createRegionView(1),
  ] as const
  const regionList = element(
    'div',
    {
      className: 'tidb-protocol-lab__region-list',
      attrs: { role: 'list' },
    },
    regions[0].root,
    regions[1].root,
  )
  const root = element(
    'article',
    {
      className: 'tidb-protocol-lab__lane',
      attrs: {
        role: 'listitem',
        'data-protocol-lane': id,
      },
    },
    element(
      'header',
      { className: 'tidb-protocol-lab__lane-head' },
      heading,
      protocolBadge,
    ),
    element(
      'section',
      { className: 'tidb-protocol-lab__profile' },
      profileHeading,
      element(
        'dl',
        { className: 'tidb-protocol-lab__facts' },
        requestId.root,
        transactionId.root,
        selected.root,
        stage.root,
        featureFlags.root,
        fixture.root,
        eligibility.root,
        reason.root,
        decisionPoints.root,
        rpcFlags.root,
        limits.root,
        runtimeFallback.root,
      ),
    ),
    element(
      'section',
      { className: 'tidb-protocol-lab__timestamps' },
      timestampsHeading,
      element(
        'dl',
        { className: 'tidb-protocol-lab__facts' },
        startTs.root,
        latestTs.root,
        requestMinCommitTs.root,
        maxCommitTs.root,
        commitTs.root,
      ),
    ),
    element(
      'section',
      { className: 'tidb-protocol-lab__paths' },
      element(
        'dl',
        { className: 'tidb-protocol-lab__path-list' },
        client.root,
        background.root,
      ),
    ),
    element(
      'section',
      { className: 'tidb-protocol-lab__regions' },
      regionsHeading,
      regionList,
    ),
  )
  return {
    root,
    heading,
    protocolBadge,
    profileHeading,
    requestId,
    transactionId,
    selected,
    stage,
    featureFlags,
    fixture,
    eligibility,
    reason,
    decisionPoints,
    rpcFlags,
    limits,
    runtimeFallback,
    timestampsHeading,
    startTs,
    latestTs,
    requestMinCommitTs,
    maxCommitTs,
    commitTs,
    client,
    background,
    regionsHeading,
    regionList,
    regions,
  }
}

function booleanValue(value: boolean, copy: ProtocolLabCopy): string {
  return value ? copy.yes : copy.no
}

function timestampValue(
  value: number | null,
  applicable: boolean,
  copy: ProtocolLabCopy,
): string {
  if (!applicable) return copy.notUsed
  return value === null ? copy.pending : String(value)
}

function updateRegionView(
  view: RegionView,
  region: TraceProtocolRegionSnapshot | undefined,
  copy: ProtocolLabCopy,
): void {
  view.root.hidden = region === undefined
  view.root.setAttribute('aria-hidden', String(region === undefined))
  if (!region) {
    removeData(view.root, 'protocol-region')
    removeData(view.root, 'region-role')
    removeData(view.root, 'raft-operation')
    removeData(view.root, 'raft-stage')
    return
  }

  setData(view.root, 'protocol-region', String(region.regionId))
  setData(view.root, 'region-role', region.role)
  setData(view.root, 'raft-operation', region.raft.operation ?? 'none')
  setData(view.root, 'raft-stage', region.raft.stage)
  setData(view.root, 'mvcc-default', region.mvcc.defaultCf)
  setData(view.root, 'mvcc-lock', region.mvcc.lockCf)
  setData(view.root, 'mvcc-write', region.mvcc.writeCf)
  view.heading.textContent = `Region ${region.regionId}`
  view.role.textContent = copy.regionRole[region.role]
  updateMetric(view.leader, copy.leader, region.leaderStoreId)
  updateMetric(view.mutations, copy.mutationCount, String(region.mutationCount))
  updateMetric(
    view.raftOperation,
    copy.raftOperation,
    region.raft.operation === null
      ? copy.none
      : copy.raftOperations[region.raft.operation],
  )
  updateMetric(view.raftStage, copy.raftStage, copy.raftStages[region.raft.stage])
  updateMetric(
    view.raftIndex,
    copy.raftIndex,
    region.raft.index === null ? copy.none : String(region.raft.index),
  )
  updateMetric(
    view.quorum,
    copy.persistenceQuorum,
    `${region.raft.acknowledgements}/${region.raft.quorum} · ${copy.voters}`,
  )
  updateMetric(
    view.persisted,
    copy.persistedVoters,
    region.raft.persistedStoreIds.length === 0
      ? copy.none
      : region.raft.persistedStoreIds.join(' · '),
  )
  view.mvccHeading.textContent = copy.mvcc
  updateMetric(view.defaultCf, copy.defaultCf, region.mvcc.defaultCf)
  updateMetric(view.lockCf, copy.lockCf, region.mvcc.lockCf)
  updateMetric(view.writeCf, copy.writeCf, region.mvcc.writeCf)
  updateMetric(
    view.asyncMetadata,
    copy.asyncLockMetadata,
    booleanValue(region.mvcc.asyncCommit, copy),
  )
  updateMetric(
    view.secondaryCount,
    copy.secondaryCount,
    String(region.mvcc.secondaryCount),
  )
  updateMetric(
    view.returnedMinCommitTs,
    copy.returnedMinCommitTs,
    region.returnedMinCommitTs === null
      ? copy.none
      : String(region.returnedMinCommitTs),
  )
}

type BackgroundState =
  | 'not_required'
  | 'not_started'
  | 'pending'
  | 'active'
  | 'complete'

function backgroundState(lane: TraceProtocolLaneSnapshot): BackgroundState {
  if (lane.protocol === '1pc') return 'not_required'
  if (lane.backgroundComplete) return 'complete'
  if (lane.stage === 'background') return 'active'
  if (lane.clientResponded) return 'pending'
  return 'not_started'
}

function updateLaneView(
  view: LaneView,
  lane: TraceProtocolLaneSnapshot,
  focused: boolean,
  copy: ProtocolLabCopy,
): void {
  setData(view.root, 'selected-protocol', lane.protocol)
  setData(view.root, 'lane-stage', lane.stage)
  setData(view.root, 'focused', String(focused))
  setData(view.root, 'client-responded', String(lane.clientResponded))
  setData(view.root, 'background-complete', String(lane.backgroundComplete))
  view.heading.textContent = copy.laneNames[lane.id]
  view.protocolBadge.textContent = lane.protocol === '2pc'
    ? copy.laneNames.two_pc
    : copy.laneNames[lane.id]
  view.profileHeading.textContent = copy.selectionProfile
  updateMetric(view.requestId, copy.requestId, lane.requestId)
  updateMetric(view.transactionId, copy.transactionId, lane.transactionId)
  updateMetric(view.selected, copy.selectedProtocol, copy.laneNames[lane.id])
  updateMetric(view.stage, copy.laneStage, copy.stages[lane.stage])
  updateMetric(
    view.featureFlags,
    copy.featureFlags,
    `1PC ${copy.enabled} · Async Commit ${copy.enabled}`,
  )
  updateMetric(
    view.fixture,
    copy.fixtureShape,
    `${lane.eligibility.mutationCount} ${copy.aggregateMutations} · ` +
      `${lane.eligibility.totalKeyBytes} ${copy.totalKeyBytes} · ` +
      `${lane.eligibility.regionCount} ${copy.regions}`,
  )
  updateMetric(
    view.eligibility,
    copy.eligibility,
    `1PC ${lane.eligibility.onePcEligible
      ? copy.eligible
      : copy.ineligible} · Async Commit ${lane.eligibility.asyncCommitEligible
      ? copy.eligible
      : copy.ineligible}`,
  )
  updateMetric(
    view.reason,
    copy.selectionReason,
    copy.reasons[lane.eligibility.selectionReason],
  )
  updateMetric(
    view.decisionPoints,
    copy.decisionPoints,
    `1PC: ${copy.onePcDecisionPoints[lane.eligibility.onePcDecisionPoint]} · ` +
      `Async Commit: ${copy.asyncDecisionPoints[lane.eligibility.asyncDecisionPoint]}`,
  )
  updateMetric(
    view.rpcFlags,
    copy.rpcFlags,
    `TryOnePc ${lane.eligibility.tryOnePcSent
      ? copy.sent
      : copy.notSent} · ` +
      `1PC ${lane.eligibility.onePcRejectedBeforeRpc
        ? copy.rejected
        : copy.accepted} · ` +
      `Async ${copy.clientPrecheck} ${lane.eligibility.asyncRejectedAtClientPrecheck
        ? copy.rejected
        : copy.accepted}`,
  )
  updateMetric(
    view.limits,
    copy.limits,
    `${lane.eligibility.mutationCount}/${lane.eligibility.asyncKeyCountLimit} ${copy.keys} · ` +
      `${lane.eligibility.totalKeyBytes}/${lane.eligibility.asyncTotalKeyBytesLimit} ${copy.bytes}`,
  )
  updateMetric(
    view.runtimeFallback,
    copy.runtimeFallback,
    booleanValue(lane.eligibility.runtimeFallback, copy),
  )

  view.timestampsHeading.textContent = copy.timestamps
  updateMetric(
    view.startTs,
    'start_ts · PD',
    timestampValue(lane.startTs, true, copy),
  )
  updateMetric(
    view.latestTs,
    'latest_ts · PD',
    timestampValue(lane.latestTs, lane.protocol !== '2pc', copy),
  )
  updateMetric(
    view.requestMinCommitTs,
    'request min_commit_ts',
    timestampValue(
      lane.requestMinCommitTs,
      lane.protocol !== '2pc',
      copy,
    ),
  )
  updateMetric(
    view.maxCommitTs,
    `max_commit_ts · ${copy.modelBound}`,
    timestampValue(lane.maxCommitTs, lane.protocol !== '2pc', copy),
  )
  updateMetric(
    view.commitTs,
    lane.commitTsSource === 'tikv_one_pc_result'
      ? 'one_pc_commit_ts · TiKV'
      : lane.commitTsSource === 'max_prewrite_min_commit_ts'
        ? 'commit_ts · max Region min_commit_ts'
        : lane.commitTsSource === 'pd_tso_after_prewrite'
          ? 'commit_ts · PD after Prewrite'
          : lane.protocol === '1pc'
            ? 'one_pc_commit_ts · TiKV'
            : lane.protocol === 'async_commit'
              ? 'commit_ts · max Region min_commit_ts'
              : 'commit_ts · PD after Prewrite',
    timestampValue(lane.commitTs, true, copy),
  )

  const clientState = lane.clientResponded ? 'responded' : 'awaiting'
  setData(view.client.root, 'client-state', clientState)
  updateMetric(
    view.client,
    copy.clientPath,
    lane.clientResponded ? copy.clientResponded : copy.clientAwaiting,
  )
  const cleanupState = backgroundState(lane)
  setData(view.background.root, 'background-state', cleanupState)
  const backgroundText: Readonly<Record<BackgroundState, string>> = {
    not_required: copy.backgroundNotRequired,
    not_started: copy.backgroundNotStarted,
    pending: copy.backgroundPending,
    active: copy.backgroundActive,
    complete: copy.backgroundComplete,
  }
  updateMetric(
    view.background,
    copy.backgroundPath,
    backgroundText[cleanupState],
  )

  view.regionsHeading.textContent = copy.regions
  view.regionList.setAttribute(
    'aria-label',
    `${copy.laneNames[lane.id]} · ${copy.regions}`,
  )
  updateRegionView(view.regions[0], lane.regions[0], copy)
  updateRegionView(view.regions[1], lane.regions[1], copy)
}

export interface ProtocolLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

export function createProtocolLabPanel(
  initialLocale: Locale,
): ProtocolLabPanel {
  const eyebrow = element('p', {
    className: 'tidb-protocol-lab__eyebrow',
  })
  const heading = element('h2')
  const phase = element('p', {
    className: 'tidb-protocol-lab__phase',
    attrs: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-protocol-phase': 'idle',
    },
  })
  const overview = element('p', {
    className: 'tidb-protocol-lab__overview',
  })
  const boundaryHeading = element('h3')
  const coordinatorLayer = createMetric('tidb-protocol-lab__metric')
  const raftLayer = createMetric('tidb-protocol-lab__metric')
  const boundaryNote = element('p', {
    className: 'tidb-protocol-lab__boundary-note',
  })
  const assumptionsHeading = element('h3')
  const consistency = createMetric('tidb-protocol-lab__metric')
  const asyncApply = createMetric('tidb-protocol-lab__metric')
  const backgroundPolicy = createMetric('tidb-protocol-lab__metric')
  const maxCommitTsPolicy = createMetric('tidb-protocol-lab__metric')
  const privacyHeading = element('h3')
  const privacyNote = element('p', {
    className: 'tidb-protocol-lab__privacy-note',
  })
  const laneViews = {
    one_pc: createLaneView('one_pc'),
    async_commit: createLaneView('async_commit'),
    two_pc: createLaneView('two_pc'),
  } satisfies Record<TraceProtocolLaneId, LaneView>
  const root = element(
    'section',
    {
      className: 'tidb-protocol-lab',
      attrs: {
        'data-protocol-lab': '',
        tabindex: '0',
      },
    },
    element(
      'header',
      { className: 'tidb-protocol-lab__head' },
      element('div', {}, eyebrow, heading, overview),
      phase,
    ),
    element(
      'section',
      {
        className: 'tidb-protocol-lab__boundary',
        attrs: { 'data-layer-boundary': 'transaction-vs-region-raft' },
      },
      boundaryHeading,
      element(
        'dl',
        { className: 'tidb-protocol-lab__facts' },
        coordinatorLayer.root,
        raftLayer.root,
      ),
      boundaryNote,
    ),
    element(
      'section',
      { className: 'tidb-protocol-lab__assumptions' },
      assumptionsHeading,
      element(
        'dl',
        { className: 'tidb-protocol-lab__facts' },
        consistency.root,
        asyncApply.root,
        backgroundPolicy.root,
        maxCommitTsPolicy.root,
      ),
    ),
    element(
      'div',
      {
        className: 'tidb-protocol-lab__lane-list',
        attrs: { role: 'list' },
      },
      ...LANE_IDS.map((id) => laneViews[id].root),
    ),
    element(
      'section',
      {
        className: 'tidb-protocol-lab__privacy',
        attrs: { 'data-privacy-projection': 'aggregate-synthetic-only' },
      },
      privacyHeading,
      privacyNote,
    ),
  )
  root.hidden = true

  let locale = initialLocale
  let renderedLocale: Locale | null = null
  let currentSnapshot: TraceProtocolLabSnapshot | undefined
  let renderedSnapshot: TraceProtocolLabSnapshot | undefined
  let disposed = false

  const render = (): void => {
    if (
      disposed ||
      (
        currentSnapshot === renderedSnapshot &&
        locale === renderedLocale
      )
    ) {
      return
    }
    renderedSnapshot = currentSnapshot
    renderedLocale = locale
    root.hidden = currentSnapshot === undefined
    if (!currentSnapshot) {
      root.removeAttribute('aria-label')
      removeData(root, 'focus-lane')
      return
    }

    const snapshot = currentSnapshot
    const copy = COPY[locale]
    root.setAttribute('aria-label', copy.title)
    setData(root, 'protocol-phase', snapshot.phase)
    setData(root, 'focus-lane', snapshot.focusLaneId ?? '')
    eyebrow.textContent = copy.model
    heading.textContent = copy.title
    overview.textContent = copy.overview
    const focusLane = snapshot.focusLaneId === null
      ? undefined
      : snapshot.lanes.find((lane) => lane.id === snapshot.focusLaneId)
    phase.textContent = focusLane
      ? `${copy.phase}: ${copy.phases[snapshot.phase]} · ` +
        `${copy.laneNames[focusLane.id]} · ${copy.stages[focusLane.stage]}`
      : `${copy.phase}: ${copy.phases[snapshot.phase]}`

    boundaryHeading.textContent = copy.boundary
    updateMetric(
      coordinatorLayer,
      copy.coordinatorLayer,
      copy.coordinatorLayerValue,
    )
    updateMetric(raftLayer, copy.raftLayer, copy.raftLayerValue)
    boundaryNote.textContent = copy.boundaryNote

    assumptionsHeading.textContent = copy.assumptions
    updateMetric(consistency, copy.consistency, copy.linearizable)
    updateMetric(asyncApply, copy.asyncApplyPrewrite, copy.disabled)
    updateMetric(
      backgroundPolicy,
      copy.backgroundPolicy,
      copy.backgroundPolicyValue,
    )
    updateMetric(
      maxCommitTsPolicy,
      copy.maxCommitTsPolicy,
      `${copy.maxCommitTsPolicyValue} · ${snapshot.safeWindowMs} ms`,
    )

    for (const id of LANE_IDS) {
      const lane = snapshot.lanes.find((candidate) => candidate.id === id)
      if (!lane) continue
      updateLaneView(
        laneViews[id],
        lane,
        snapshot.focusLaneId === id,
        copy,
      )
    }

    privacyHeading.textContent = copy.privacy
    privacyNote.textContent = copy.privacyNote
  }

  return {
    root,
    update(event, activeEvents = []): void {
      // Active labels and event detail are deliberately ignored. The immutable
      // model projection is the only source for this privacy-safe surface.
      void activeEvents
      currentSnapshot = event?.snapshot?.protocolLab
      render()
    },
    setLocale(next): void {
      if (locale === next) return
      locale = next
      render()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      root.remove()
      currentSnapshot = undefined
      renderedSnapshot = undefined
    },
  }
}
