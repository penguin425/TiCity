// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceTiFlashMppLabSnapshot,
  TraceTiFlashMppLearnerSnapshot,
  TraceTiFlashMppPhase,
  TraceTiFlashMppReadGate,
  TraceTiFlashMppTaskSnapshot,
  TraceTiFlashMppTunnelSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

interface TiFlashMppLabCopy {
  readonly title: string
  readonly model: string
  readonly overview: string
  readonly phase: string
  readonly privacy: string
  readonly privacyNote: string
  readonly provisioning: string
  readonly provisioningDisclaimer: string
  readonly available: string
  readonly progress: string
  readonly replicaCount: string
  readonly optimizerFixture: string
  readonly staleRead: string
  readonly initialSnapshot: string
  readonly modeled: string
  readonly notModeled: string
  readonly yes: string
  readonly no: string
  readonly planes: string
  readonly replicationPlane: string
  readonly exchangePlane: string
  readonly planeBoundary: string
  readonly learners: string
  readonly region: string
  readonly role: string
  readonly learnerNonVoter: string
  readonly leaderStore: string
  readonly learnerStore: string
  readonly leaderCommit: string
  readonly received: string
  readonly raftCommand: string
  readonly deltaMergeFlushed: string
  readonly applied: string
  readonly requiredReadIndex: string
  readonly readGate: string
  readonly gateReason: string
  readonly safeTs: string
  readonly pendingReadIndex: string
  readonly appliedBehind: string
  readonly appliedReady: string
  readonly safeTsReason: string
  readonly readIndexReason: string
  readonly noGateReason: string
  readonly fragments: string
  readonly fragment: string
  readonly operators: string
  readonly fragmentTasks: string
  readonly tasks: string
  readonly task: string
  readonly store: string
  readonly taskRegions: string
  readonly stage: string
  readonly rootFragment: string
  readonly tunnels: string
  readonly tunnel: string
  readonly exchange: string
  readonly route: string
  readonly locality: string
  readonly local: string
  readonly remote: string
  readonly tidbRoot: string
  readonly packets: string
  readonly bytes: string
  readonly rootGather: string
  readonly rootStage: string
  readonly rootStreams: string
  readonly chunks: string
  readonly columnsSent: string
  readonly rowsBucket: string
  readonly clientComplete: string
  readonly retryBoundary: string
  readonly retryCount: string
  readonly fallback: string
  readonly phases: Readonly<Record<TraceTiFlashMppPhase, string>>
  readonly gates: Readonly<Record<TraceTiFlashMppReadGate, string>>
  readonly taskStages:
    Readonly<Record<TraceTiFlashMppTaskSnapshot['stage'], string>>
  readonly tunnelStatuses:
    Readonly<Record<TraceTiFlashMppTunnelSnapshot['status'], string>>
  readonly resultStages:
    Readonly<Record<TraceTiFlashMppLabSnapshot['result']['stage'], string>>
}

const COPY: Readonly<Record<Locale, TiFlashMppLabCopy>> = {
  ja: {
    title: 'TiFlash Replication / MPP Lab',
    model: 'MODEL / SIMULATED',
    overview:
      '定常的なTiFlash learner複製、Regionごとのsnapshot gate、2 fragment / 4 taskのMPP実行、6 tunnel、TiDB root gatherを、選択したexact event時点で表示します。',
    phase: 'フェーズ',
    privacy: 'プライバシー境界',
    privacyNote:
      '合成ID、index、状態、集計数だけを表示します。SQL文、literal、実key、encoded key、value、row、結果行は保持も投影もしません。',
    provisioning: 'Replica provisioning',
    provisioningDisclaimer:
      'provisioning availableはplacement完了だけを意味します。このqueryのsnapshot read readinessは各Regionのgateで別に判定します。',
    available: 'placement利用可能',
    progress: 'placement進捗',
    replicaCount: 'TiFlash store',
    optimizerFixture: 'access path選択',
    staleRead: 'stale read',
    initialSnapshot: '初回snapshot転送',
    modeled: 'モデル化',
    notModeled: '対象外',
    yes: 'はい',
    no: 'いいえ',
    planes: '永続複製面と一時的query面',
    replicationPlane: '複製面',
    exchangePlane: 'MPP exchange面',
    planeBoundary:
      'learnerは非voterでTiKV quorumには参加しません。Region Raftの永続複製経路と、query単位のephemeral MPP block交換は別の経路です。',
    learners: 'Region learner / snapshot gates',
    region: 'Region',
    role: '役割',
    learnerNonVoter: 'learner / 非voter',
    leaderStore: 'TiKV leader',
    learnerStore: 'TiFlash store',
    leaderCommit: 'leader commit',
    received: 'learner receive',
    raftCommand: 'Raft command',
    deltaMergeFlushed: 'Delta Merge flush',
    applied: 'learner apply',
    requiredReadIndex: 'required ReadIndex',
    readGate: 'snapshot gate',
    gateReason: 'gate理由',
    safeTs: 'leader / self safe TS',
    pendingReadIndex: 'ReadIndex応答待ち',
    appliedBehind: 'applied indexがrequired ReadIndex未満',
    appliedReady: 'applied indexがrequired ReadIndex以上',
    safeTsReason: 'self safe TSで確認',
    readIndexReason: 'ReadIndexとapplied indexで確認',
    noGateReason: '未判定',
    fragments: 'MPP fragments',
    fragment: 'Fragment',
    operators: 'Operator tokens',
    fragmentTasks: 'Task',
    tasks: 'MPP tasks',
    task: '合成Task ID',
    store: 'Store',
    taskRegions: 'Region',
    stage: '段階',
    rootFragment: 'TiDB rootへ送信',
    tunnels: 'MPP tunnels',
    tunnel: '合成Tunnel ID',
    exchange: 'Exchange',
    route: '経路',
    locality: 'locality',
    local: 'local',
    remote: 'cross-store',
    tidbRoot: 'TiDB root',
    packets: 'packet数',
    bytes: 'byte bucket',
    rootGather: 'TiDB root gather',
    rootStage: '結果stream段階',
    rootStreams: 'root stream数',
    chunks: 'decode済みchunk',
    columnsSent: 'column metadata送信',
    rowsBucket: 'row bucket',
    clientComplete: 'client完了',
    retryBoundary: '失敗・retry境界',
    retryCount: 'retry数',
    fallback: 'TiKV fallback',
    phases: {
      replicating: 'learner複製',
      planning: 'fragment計画',
      dispatching: 'task dispatch',
      snapshot_gating: 'snapshot gate',
      scanning: 'scan / partial aggregate',
      exchanging: 'hash exchange',
      streaming: 'TiDB rootへstream',
      complete: '完了',
    },
    gates: {
      unchecked: '未確認',
      safe_ts_checked: 'safe TS確認済み',
      read_index_requested: 'ReadIndex要求済み',
      read_index_returned: 'ReadIndex応答済み',
      waiting_applied: 'applied index待ち',
      ready: 'snapshot read可能',
      mvcc_checked: 'MVCC確認済み',
      validated: 'post-read検証済み',
    },
    taskStages: {
      built: 'build済み',
      dispatched: 'dispatch済み',
      prepared: 'prepare済み',
      snapshot_gating: 'snapshot gate待ち',
      scanning: 'scan中',
      partial_aggregated: 'partial aggregate完了',
      exchange_sending: 'exchange送信中',
      exchange_receiving: 'exchange受信中',
      final_aggregated: 'final aggregate完了',
      root_streaming: 'rootへstream中',
      complete: '完了',
    },
    tunnelStatuses: {
      registered: '登録済み',
      sent: '送信済み',
      received: '受信済み',
    },
    resultStages: {
      idle: '待機',
      chunks_decoded: 'chunk decode済み',
      columns_sent: 'column metadata送信済み',
      rows_streaming: 'row stream中',
      streams_eof: '全stream EOF',
      client_complete: 'client完了',
    },
  },
  en: {
    title: 'TiFlash Replication / MPP Lab',
    model: 'MODEL / SIMULATED',
    overview:
      'Shows steady-state TiFlash learner replication, per-Region snapshot gates, two fragments and four MPP tasks, six tunnels, and TiDB root gather at the selected exact event.',
    phase: 'Phase',
    privacy: 'Privacy boundary',
    privacyNote:
      'Only synthetic identifiers, indexes, states, and aggregate counts are shown. SQL text, literals, real or encoded keys, values, rows, and result rows are neither retained nor projected.',
    provisioning: 'Replica provisioning',
    provisioningDisclaimer:
      'Provisioning available means placement is complete only. Per-query snapshot read readiness is decided separately by each Region gate.',
    available: 'Placement available',
    progress: 'Placement progress',
    replicaCount: 'TiFlash stores',
    optimizerFixture: 'Access-path selection',
    staleRead: 'Stale read',
    initialSnapshot: 'Initial snapshot transfer',
    modeled: 'Modeled',
    notModeled: 'Out of scope',
    yes: 'Yes',
    no: 'No',
    planes: 'Persistent replication and ephemeral query planes',
    replicationPlane: 'Replication plane',
    exchangePlane: 'MPP exchange plane',
    planeBoundary:
      'Learners are non-voters and never join the TiKV quorum. Persistent Region Raft replication and per-query ephemeral MPP block exchange are separate paths.',
    learners: 'Region learners / snapshot gates',
    region: 'Region',
    role: 'Role',
    learnerNonVoter: 'learner / non-voter',
    leaderStore: 'TiKV leader',
    learnerStore: 'TiFlash store',
    leaderCommit: 'Leader commit',
    received: 'Learner received',
    raftCommand: 'Raft command',
    deltaMergeFlushed: 'Delta Merge flushed',
    applied: 'Learner applied',
    requiredReadIndex: 'Required ReadIndex',
    readGate: 'Snapshot gate',
    gateReason: 'Gate reason',
    safeTs: 'Leader / self safe TS',
    pendingReadIndex: 'Waiting for ReadIndex response',
    appliedBehind: 'Applied index is below required ReadIndex',
    appliedReady: 'Applied index reached required ReadIndex',
    safeTsReason: 'Confirmed by self safe TS',
    readIndexReason: 'Confirmed by ReadIndex and applied index',
    noGateReason: 'Not evaluated',
    fragments: 'MPP fragments',
    fragment: 'Fragment',
    operators: 'Operator tokens',
    fragmentTasks: 'Tasks',
    tasks: 'MPP tasks',
    task: 'Synthetic task ID',
    store: 'Store',
    taskRegions: 'Regions',
    stage: 'Stage',
    rootFragment: 'Feeds TiDB root',
    tunnels: 'MPP tunnels',
    tunnel: 'Synthetic tunnel ID',
    exchange: 'Exchange',
    route: 'Route',
    locality: 'Locality',
    local: 'local',
    remote: 'cross-store',
    tidbRoot: 'TiDB root',
    packets: 'Packets',
    bytes: 'Bytes bucket',
    rootGather: 'TiDB root gather',
    rootStage: 'Result stream stage',
    rootStreams: 'Root streams',
    chunks: 'Chunks decoded',
    columnsSent: 'Column metadata sent',
    rowsBucket: 'Rows bucket',
    clientComplete: 'Client complete',
    retryBoundary: 'Failure and retry boundary',
    retryCount: 'Retries',
    fallback: 'TiKV fallback',
    phases: {
      replicating: 'Learner replication',
      planning: 'Fragment planning',
      dispatching: 'Task dispatch',
      snapshot_gating: 'Snapshot gating',
      scanning: 'Scan / partial aggregate',
      exchanging: 'Hash exchange',
      streaming: 'Stream to TiDB root',
      complete: 'Complete',
    },
    gates: {
      unchecked: 'Unchecked',
      safe_ts_checked: 'Safe TS checked',
      read_index_requested: 'ReadIndex requested',
      read_index_returned: 'ReadIndex returned',
      waiting_applied: 'Waiting for applied index',
      ready: 'Snapshot read ready',
      mvcc_checked: 'MVCC checked',
      validated: 'Post-read validated',
    },
    taskStages: {
      built: 'Built',
      dispatched: 'Dispatched',
      prepared: 'Prepared',
      snapshot_gating: 'Snapshot gating',
      scanning: 'Scanning',
      partial_aggregated: 'Partial aggregate complete',
      exchange_sending: 'Sending exchange blocks',
      exchange_receiving: 'Receiving exchange blocks',
      final_aggregated: 'Final aggregate complete',
      root_streaming: 'Streaming to root',
      complete: 'Complete',
    },
    tunnelStatuses: {
      registered: 'Registered',
      sent: 'Sent',
      received: 'Received',
    },
    resultStages: {
      idle: 'Idle',
      chunks_decoded: 'Chunks decoded',
      columns_sent: 'Column metadata sent',
      rows_streaming: 'Rows streaming',
      streams_eof: 'All streams EOF',
      client_complete: 'Client complete',
    },
  },
}

export interface TiFlashMppLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

function metric(label: string, value: string): HTMLElement {
  return element(
    'div',
    { className: 'tidb-tiflash-mpp-lab__metric' },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function booleanText(value: boolean, copy: TiFlashMppLabCopy): string {
  return value ? copy.yes : copy.no
}

function textIndex(index: number | null): string {
  return index === null ? '—' : String(index)
}

function gateReason(
  learner: TraceTiFlashMppLearnerSnapshot,
  copy: TiFlashMppLabCopy,
): string {
  if (learner.gateReason === 'self_safe_ts') return copy.safeTsReason
  if (learner.gateReason === 'read_index_applied') {
    return copy.readIndexReason
  }
  if (learner.readGate === 'read_index_requested') {
    return copy.pendingReadIndex
  }
  if (
    learner.requiredReadIndex !== null &&
    learner.learnerAppliedIndex < learner.requiredReadIndex
  ) {
    return copy.appliedBehind
  }
  if (
    learner.requiredReadIndex !== null &&
    learner.learnerAppliedIndex >= learner.requiredReadIndex
  ) {
    return copy.appliedReady
  }
  return copy.noGateReason
}

function learnerRow(
  learner: TraceTiFlashMppLearnerSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLTableRowElement {
  return element(
    'tr',
    {
      attrs: {
        'data-region-id': String(learner.regionId),
        'data-read-gate': learner.readGate,
        'data-gate-reason': learner.gateReason ?? 'none',
        'data-learner-voter': 'false',
      },
    },
    element('th', {
      text: `Region ${learner.regionId}`,
      attrs: { scope: 'row' },
    }),
    element('td', { text: copy.learnerNonVoter }),
    element('td', { text: learner.leaderStoreId }),
    element('td', { text: learner.learnerStoreId }),
    element('td', { text: String(learner.leaderCommitIndex) }),
    element('td', { text: String(learner.learnerReceivedIndex) }),
    element('td', { text: String(learner.learnerRaftCommandIndex) }),
    element('td', { text: String(learner.deltaMergeFlushedIndex) }),
    element('td', { text: String(learner.learnerAppliedIndex) }),
    element('td', { text: textIndex(learner.requiredReadIndex) }),
    element('td', { text: copy.gates[learner.readGate] }),
    element('td', { text: gateReason(learner, copy) }),
    element('td', {
      text: `${learner.leaderSafeTs} / ${learner.selfSafeTs}`,
    }),
  )
}

function learnersSection(
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-tiflash-mpp-lab__learners' },
    element('h3', { text: copy.learners }),
    element(
      'div',
      {
        className: 'tidb-tiflash-mpp-lab__table-scroll',
        attrs: { tabindex: '0' },
      },
      element(
        'table',
        { className: 'tidb-tiflash-mpp-lab__table' },
        element('caption', { text: copy.learners }),
        element(
          'thead',
          {},
          element(
            'tr',
            {},
            ...[
              copy.region,
              copy.role,
              copy.leaderStore,
              copy.learnerStore,
              copy.leaderCommit,
              copy.received,
              copy.raftCommand,
              copy.deltaMergeFlushed,
              copy.applied,
              copy.requiredReadIndex,
              copy.readGate,
              copy.gateReason,
              copy.safeTs,
            ].map((label) =>
              element('th', { text: label, attrs: { scope: 'col' } })),
          ),
        ),
        element(
          'tbody',
          {},
          ...snapshot.learners.map((learner) =>
            learnerRow(learner, copy)),
        ),
      ),
    ),
  )
}

function fragmentsSection(
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-tiflash-mpp-lab__fragments' },
    element('h3', { text: copy.fragments }),
    element(
      'div',
      {
        className: 'tidb-tiflash-mpp-lab__fragment-list',
        attrs: { role: 'list' },
      },
      ...snapshot.fragments.map((fragment) =>
        element(
          'article',
          {
            className: 'tidb-tiflash-mpp-lab__fragment',
            attrs: {
              role: 'listitem',
              'data-fragment-id': fragment.id,
              'data-fragment-kind': fragment.kind,
            },
          },
          element('h4', { text: fragment.id }),
          element(
            'dl',
            { className: 'tidb-tiflash-mpp-lab__facts' },
            metric(copy.fragment, fragment.kind),
            metric(copy.operators, fragment.operatorTokens.join(' → ')),
            metric(copy.fragmentTasks, fragment.taskIds.join(' · ')),
          ),
        )),
    ),
  )
}

function tasksSection(
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-tiflash-mpp-lab__tasks' },
    element('h3', { text: copy.tasks }),
    element(
      'div',
      {
        className: 'tidb-tiflash-mpp-lab__task-list',
        attrs: {
          role: 'list',
          'aria-label': copy.tasks,
        },
      },
      ...snapshot.tasks.map((task) =>
        element(
          'article',
          {
            className: 'tidb-tiflash-mpp-lab__task',
            attrs: {
              role: 'listitem',
              'data-task-id': task.id,
              'data-task-stage': task.stage,
              'data-fragment-id': task.fragmentId,
            },
          },
          element('h4', { text: task.id }),
          element(
            'dl',
            { className: 'tidb-tiflash-mpp-lab__facts' },
            metric(copy.store, task.storeId),
            metric(copy.fragment, task.fragmentId),
            metric(
              copy.taskRegions,
              task.regionIds.length > 0 ? task.regionIds.join(', ') : '—',
            ),
            metric(copy.stage, copy.taskStages[task.stage]),
            metric(
              copy.rootFragment,
              booleanText(task.feedsTiDBRoot, copy),
            ),
          ),
        )),
    ),
  )
}

function tunnelLocality(
  tunnel: TraceTiFlashMppTunnelSnapshot,
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): string {
  if (tunnel.targetTaskId === 'tidb-root') return copy.tidbRoot
  const source = snapshot.tasks.find((task) =>
    task.id === tunnel.sourceTaskId)
  const target = snapshot.tasks.find((task) =>
    task.id === tunnel.targetTaskId)
  return source && target && source.storeId === target.storeId
    ? copy.local
    : copy.remote
}

function tunnelsSection(
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-tiflash-mpp-lab__tunnels' },
    element('h3', { text: copy.tunnels }),
    element(
      'div',
      {
        className: 'tidb-tiflash-mpp-lab__table-scroll',
        attrs: { tabindex: '0' },
      },
      element(
        'table',
        { className: 'tidb-tiflash-mpp-lab__table' },
        element('caption', { text: copy.tunnels }),
        element(
          'thead',
          {},
          element(
            'tr',
            {},
            ...[
              copy.tunnel,
              copy.exchange,
              copy.route,
              copy.locality,
              copy.stage,
              copy.packets,
              copy.bytes,
            ].map((label) =>
              element('th', { text: label, attrs: { scope: 'col' } })),
          ),
        ),
        element(
          'tbody',
          {},
          ...snapshot.tunnels.map((tunnel) =>
            element(
              'tr',
              {
                attrs: {
                  'data-tunnel-id': tunnel.id,
                  'data-tunnel-status': tunnel.status,
                  'data-tunnel-persistence': tunnel.persistence,
                },
              },
              element('th', {
                text: tunnel.id,
                attrs: { scope: 'row' },
              }),
              element('td', { text: tunnel.exchangeType }),
              element('td', {
                text: `${tunnel.sourceTaskId} → ${tunnel.targetTaskId}`,
              }),
              element('td', {
                text: tunnelLocality(tunnel, snapshot, copy),
              }),
              element('td', {
                text: copy.tunnelStatuses[tunnel.status],
              }),
              element('td', { text: String(tunnel.packetCount) }),
              element('td', { text: tunnel.bytesBucket }),
            )),
        ),
      ),
    ),
  )
}

function rootSection(
  snapshot: TraceTiFlashMppLabSnapshot,
  copy: TiFlashMppLabCopy,
): HTMLElement {
  return element(
    'section',
    {
      className: 'tidb-tiflash-mpp-lab__root',
      attrs: {
        'data-root-stage': snapshot.result.stage,
        'data-result-rows-projected': 'false',
      },
    },
    element('h3', { text: copy.rootGather }),
    element(
      'dl',
      { className: 'tidb-tiflash-mpp-lab__facts' },
      metric(copy.rootStage, copy.resultStages[snapshot.result.stage]),
      metric(copy.rootStreams, String(snapshot.result.rootStreamCount)),
      metric(copy.chunks, String(snapshot.result.chunksDecoded)),
      metric(copy.columnsSent, booleanText(snapshot.result.columnsSent, copy)),
      metric(copy.rowsBucket, snapshot.result.rowsBucket),
      metric(
        copy.clientComplete,
        booleanText(snapshot.result.clientComplete, copy),
      ),
    ),
  )
}

export function createTiFlashMppLabPanel(
  initialLocale: Locale,
): TiFlashMppLabPanel {
  const titleId = 'tidb-tiflash-mpp-lab-title'
  const root = element('section', {
    className: 'tidb-tiflash-mpp-lab',
    attrs: {
      tabindex: '0',
      role: 'region',
      'aria-labelledby': titleId,
      'data-tiflash-mpp-lab': '',
      'data-result-representation': 'aggregate_counts_only',
      'data-result-rows-projected': 'false',
    },
  })
  root.hidden = true

  let locale = initialLocale
  let currentSnapshot: TraceTiFlashMppLabSnapshot | undefined
  let renderedSnapshot: TraceTiFlashMppLabSnapshot | undefined
  let renderedLocale: Locale | null = null
  let disposed = false

  const render = (): void => {
    if (disposed) return
    if (
      currentSnapshot === renderedSnapshot &&
      locale === renderedLocale
    ) {
      return
    }
    renderedSnapshot = currentSnapshot
    renderedLocale = locale
    root.hidden = currentSnapshot === undefined
    if (!currentSnapshot) {
      root.replaceChildren()
      root.removeAttribute('aria-label')
      root.removeAttribute('data-tiflash-mpp-phase')
      return
    }

    const snapshot = currentSnapshot
    const copy = COPY[locale]
    root.setAttribute('aria-label', copy.title)
    root.setAttribute('data-tiflash-mpp-phase', snapshot.phase)
    root.replaceChildren(
      element(
        'header',
        { className: 'tidb-tiflash-mpp-lab__head' },
        element(
          'div',
          {},
          element('p', {
            className: 'tidb-tiflash-mpp-lab__eyebrow',
            text: copy.model,
          }),
          element('h2', { text: copy.title, attrs: { id: titleId } }),
          element('p', {
            className: 'tidb-tiflash-mpp-lab__overview',
            text: copy.overview,
          }),
        ),
        element('p', {
          className: 'tidb-tiflash-mpp-lab__phase',
          text: `${copy.phase}: ${copy.phases[snapshot.phase]}`,
          attrs: {
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
            'data-phase': snapshot.phase,
          },
        }),
      ),
      element(
        'section',
        { className: 'tidb-tiflash-mpp-lab__privacy' },
        element('h3', { text: copy.privacy }),
        element('p', {
          className: 'tidb-tiflash-mpp-lab__boundary-note',
          text: copy.privacyNote,
        }),
      ),
      element(
        'section',
        {
          className: 'tidb-tiflash-mpp-lab__provisioning',
          attrs: {
            'data-provisioning-available': String(
              snapshot.configuration.provisioningAvailable,
            ),
            'data-provisioning-meaning':
              snapshot.configuration.provisioningMeaning,
          },
        },
        element('h3', { text: copy.provisioning }),
        element('p', {
          className: 'tidb-tiflash-mpp-lab__boundary-note',
          text: copy.provisioningDisclaimer,
        }),
        element(
          'dl',
          { className: 'tidb-tiflash-mpp-lab__facts' },
          metric(
            copy.available,
            booleanText(
              snapshot.configuration.provisioningAvailable,
              copy,
            ),
          ),
          metric(
            copy.progress,
            `${Math.round(snapshot.configuration.provisioningProgress * 100)}%`,
          ),
          metric(
            copy.replicaCount,
            String(snapshot.configuration.replicaCount),
          ),
          metric(
            copy.optimizerFixture,
            snapshot.configuration.optimizerChoice,
          ),
          metric(
            copy.staleRead,
            booleanText(snapshot.configuration.staleRead, copy),
          ),
          metric(
            copy.initialSnapshot,
            snapshot.configuration.initialSnapshotTransferModeled
              ? copy.modeled
              : copy.notModeled,
          ),
        ),
      ),
      element(
        'section',
        { className: 'tidb-tiflash-mpp-lab__planes' },
        element('h3', { text: copy.planes }),
        element(
          'dl',
          { className: 'tidb-tiflash-mpp-lab__facts' },
          metric(
            copy.replicationPlane,
            snapshot.configuration.replicationPlane,
          ),
          metric(
            copy.exchangePlane,
            snapshot.configuration.exchangePlane,
          ),
        ),
        element('p', {
          className: 'tidb-tiflash-mpp-lab__boundary-note',
          text: copy.planeBoundary,
        }),
      ),
      learnersSection(snapshot, copy),
      fragmentsSection(snapshot, copy),
      tasksSection(snapshot, copy),
      tunnelsSection(snapshot, copy),
      rootSection(snapshot, copy),
      element(
        'section',
        { className: 'tidb-tiflash-mpp-lab__retry' },
        element('h3', { text: copy.retryBoundary }),
        element(
          'dl',
          { className: 'tidb-tiflash-mpp-lab__facts' },
          metric(copy.retryCount, String(snapshot.retry.retryCount)),
          metric(
            copy.fallback,
            booleanText(snapshot.retry.fallbackToTiKV, copy),
          ),
        ),
      ),
    )
  }

  return {
    root,
    update(event): void {
      /*
       * Deliberately retain only the synthetic model-7 snapshot. Event labels,
       * details, metadata, SQL, and active-event payloads never enter this UI.
       */
      currentSnapshot = event?.snapshot?.tiflashMppLab
      render()
    },
    setLocale(next): void {
      if (locale === next) return
      locale = next
      renderedLocale = null
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
