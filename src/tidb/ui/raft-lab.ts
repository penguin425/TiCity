// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceRaftLabSnapshot,
  TraceRaftLabPeerSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

type RaftLabPhase = TraceRaftLabSnapshot['phase']
type ElectionPhase = TraceRaftLabSnapshot['election']['phase']
type PeerRole = TraceRaftLabPeerSnapshot['role']
type RequestStatus = TraceRaftLabSnapshot['request']['status']
type CacheState = TraceRaftLabSnapshot['request']['cacheState']

interface RaftLabCopy {
  readonly title: string
  readonly model: string
  readonly phase: string
  readonly region: string
  readonly leaderTransition: string
  readonly noLeader: string
  readonly failedStore: string
  readonly none: string
  readonly election: string
  readonly electionState: string
  readonly candidate: string
  readonly pending: string
  readonly preVote: string
  readonly enabled: string
  readonly preVotes: string
  readonly votes: string
  readonly quorum: string
  readonly quorumValue: string
  readonly liveVoters: string
  readonly configuredWindow: string
  readonly elapsed: string
  readonly ticks: string
  readonly candidatePolicy: string
  readonly candidatePolicyValue: string
  readonly timingPolicyNote: string
  readonly peers: string
  readonly health: string
  readonly healthy: string
  readonly unavailable: string
  readonly role: string
  readonly term: string
  readonly votedFor: string
  readonly lastLog: string
  readonly matchIndex: string
  readonly commitIndex: string
  readonly appliedIndex: string
  readonly log: string
  readonly entry: string
  readonly noEntry: string
  readonly persisted: string
  readonly committed: string
  readonly applied: string
  readonly yes: string
  readonly no: string
  readonly pdBoundary: string
  readonly pdRole: string
  readonly pdRoleValue: string
  readonly observedLeader: string
  readonly routeLookup: string
  readonly completeValue: string
  readonly incompleteValue: string
  readonly pdBoundaryNote: string
  readonly requestRetry: string
  readonly logicalRequest: string
  readonly retrySource: string
  readonly tidbInternal: string
  readonly attempt: string
  readonly cachedLeader: string
  readonly cacheState: string
  readonly requestState: string
  readonly backoff: string
  readonly clientResult: string
  readonly clientPending: string
  readonly clientSuccess: string
  readonly retryBoundaryNote: string
  readonly phases: Readonly<Record<RaftLabPhase, string>>
  readonly electionPhases: Readonly<Record<ElectionPhase, string>>
  readonly peerRoles: Readonly<Record<PeerRole, string>>
  readonly requestStates: Readonly<Record<RequestStatus, string>>
  readonly cacheStates: Readonly<Record<CacheState, string>>
}

const COPY: Readonly<Record<Locale, RaftLabCopy>> = {
  ja: {
    title: 'Raft Failure Lab',
    model: 'MODEL / SIMULATED',
    phase: 'フェーズ',
    region: 'Region',
    leaderTransition: 'Leader遷移',
    noLeader: 'Leader不在',
    failedStore: '障害Store',
    none: 'なし',
    election: 'Raft選出',
    electionState: '選出状態',
    candidate: '候補',
    pending: '未決定',
    preVote: 'Pre-Vote',
    enabled: '有効',
    preVotes: 'Pre-Vote獲得',
    votes: 'Vote獲得',
    quorum: '選出quorum',
    quorumValue: '3 voter中2（2-of-3）',
    liveVoters: '稼働voter',
    configuredWindow: '設定上の選出timeout範囲',
    elapsed: '経過',
    ticks: 'ticks',
    candidatePolicy: '候補決定',
    candidatePolicyValue:
      '稼働中でlogが最新のStore ID最小（TiCity MODEL POLICY）',
    timingPolicyNote:
      'この候補と正確なtick進行は決定的なTiCity MODEL POLICYです。TiDB/TiKVの実運用結果を保証しません。',
    peers: '3 voter peers',
    health: 'Health',
    healthy: '稼働',
    unavailable: '停止',
    role: 'Raft role',
    term: 'current term',
    votedFor: '投票先',
    lastLog: 'last log index / term',
    matchIndex: 'match index',
    commitIndex: 'commit index',
    appliedIndex: 'apply index',
    log: '選出後log',
    entry: 'Entry',
    noEntry: 'まだありません',
    persisted: '永続化Store',
    committed: 'Commit済み',
    applied: 'Apply済みStore',
    yes: 'はい',
    no: 'いいえ',
    pdBoundary: 'PDの境界',
    pdRole: 'PD role',
    pdRoleValue: '監視とroute metadataのみ',
    observedLeader: 'PDが観測したLeader',
    routeLookup: 'route lookup',
    completeValue: '完了',
    incompleteValue: '未完了',
    pdBoundaryNote:
      'PDはLeader情報を観測してrouteを支援しますが、Raft候補の選択・Pre-Vote・Vote・Leader選出は行いません。',
    requestRetry: 'TiDB request retry',
    logicalRequest: 'Logical request',
    retrySource: 'Retry source',
    tidbInternal: 'TiDB内部',
    attempt: '内部試行',
    cachedLeader: 'cache上のLeader',
    cacheState: 'Leader cache',
    requestState: 'Request状態',
    backoff: '内部backoff',
    clientResult: 'Client境界',
    clientPending: '応答待ち（client-visible errorは未返却）',
    clientSuccess: '成功（client-visible errorなし）',
    retryBoundaryNote:
      'これは同じlogical requestに対するTiDB内部retryで、アプリケーションretryではありません。',
    phases: {
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
    electionPhases: {
      idle: '待機',
      timeout: 'Timeout',
      pre_vote: 'Pre-Vote',
      vote: 'Vote',
      elected: '選出済み',
    },
    peerRoles: {
      leader: 'Leader',
      follower: 'Follower',
      pre_candidate: 'Pre-Candidate',
      candidate: 'Candidate',
      offline: 'Offline',
    },
    requestStates: {
      idle: '待機',
      sent: '送信済み',
      transport_error: 'transport error',
      backoff: 'backoff',
      retrying: '再試行中',
      served: 'TiKVで処理済み',
      completed: '完了',
    },
    cacheStates: {
      cached: 'cache済み',
      invalidated: '無効化',
      refreshed: '更新済み',
    },
  },
  en: {
    title: 'Raft Failure Lab',
    model: 'MODEL / SIMULATED',
    phase: 'Phase',
    region: 'Region',
    leaderTransition: 'Leader transition',
    noLeader: 'No leader',
    failedStore: 'Failed store',
    none: 'None',
    election: 'Raft election',
    electionState: 'Election state',
    candidate: 'Candidate',
    pending: 'Pending',
    preVote: 'Pre-Vote',
    enabled: 'Enabled',
    preVotes: 'Pre-Votes granted',
    votes: 'Votes granted',
    quorum: 'Election quorum',
    quorumValue: '2 of 3 voters (2-of-3)',
    liveVoters: 'Live voters',
    configuredWindow: 'Configured election timeout window',
    elapsed: 'Elapsed',
    ticks: 'ticks',
    candidatePolicy: 'Candidate selection',
    candidatePolicyValue:
      'Lowest live, up-to-date Store ID (TiCity MODEL POLICY)',
    timingPolicyNote:
      'This exact candidate and tick progression are deterministic TiCity MODEL POLICY, not a TiDB/TiKV production guarantee.',
    peers: '3 voter peers',
    health: 'Health',
    healthy: 'Healthy',
    unavailable: 'Down',
    role: 'Raft role',
    term: 'Current term',
    votedFor: 'Voted for',
    lastLog: 'Last log index / term',
    matchIndex: 'Match index',
    commitIndex: 'Commit index',
    appliedIndex: 'Apply index',
    log: 'Post-election log',
    entry: 'Entry',
    noEntry: 'Not present yet',
    persisted: 'Persisted stores',
    committed: 'Committed',
    applied: 'Applied stores',
    yes: 'Yes',
    no: 'No',
    pdBoundary: 'PD boundary',
    pdRole: 'PD role',
    pdRoleValue: 'Observe and route metadata only',
    observedLeader: 'Leader observed by PD',
    routeLookup: 'Route lookup',
    completeValue: 'Complete',
    incompleteValue: 'Incomplete',
    pdBoundaryNote:
      'PD observes leader metadata and assists routing; it does not choose a Raft candidate, grant Pre-Votes or Votes, or elect the leader.',
    requestRetry: 'TiDB request retry',
    logicalRequest: 'Logical request',
    retrySource: 'Retry source',
    tidbInternal: 'TiDB internal',
    attempt: 'Internal attempt',
    cachedLeader: 'Cached leader',
    cacheState: 'Leader cache',
    requestState: 'Request state',
    backoff: 'Internal backoff',
    clientResult: 'Client boundary',
    clientPending: 'Response pending; no client-visible error returned',
    clientSuccess: 'Succeeded with no client-visible error',
    retryBoundaryNote:
      'This is a TiDB internal retry of the same logical request, not an application retry.',
    phases: {
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
    electionPhases: {
      idle: 'Idle',
      timeout: 'Timeout',
      pre_vote: 'Pre-Vote',
      vote: 'Vote',
      elected: 'Elected',
    },
    peerRoles: {
      leader: 'Leader',
      follower: 'Follower',
      pre_candidate: 'Pre-Candidate',
      candidate: 'Candidate',
      offline: 'Offline',
    },
    requestStates: {
      idle: 'Idle',
      sent: 'Sent',
      transport_error: 'Transport error',
      backoff: 'Backoff',
      retrying: 'Retrying',
      served: 'Served by TiKV',
      completed: 'Completed',
    },
    cacheStates: {
      cached: 'Cached',
      invalidated: 'Invalidated',
      refreshed: 'Refreshed',
    },
  },
}

export interface RaftLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

function metric(label: string, value: string): HTMLElement {
  return element(
    'div',
    { className: 'tidb-raft-lab__metric' },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function peerCard(
  peer: TraceRaftLabPeerSnapshot,
  copy: RaftLabCopy,
): HTMLElement {
  return element(
    'article',
    {
      className: 'tidb-raft-lab__peer',
      attrs: {
        'data-raft-peer': peer.storeId,
        'data-peer-role': peer.role,
        'data-peer-health': peer.healthy ? 'healthy' : 'down',
        'data-voted-for': peer.votedFor ?? '',
      },
    },
    element(
      'header',
      { className: 'tidb-raft-lab__card-head' },
      element('h4', { text: peer.storeId }),
      element('span', {
        className: 'tidb-raft-lab__role',
        text: copy.peerRoles[peer.role],
      }),
    ),
    element(
      'dl',
      { className: 'tidb-raft-lab__facts' },
      metric(copy.health, peer.healthy ? copy.healthy : copy.unavailable),
      metric(copy.term, String(peer.currentTerm)),
      metric(copy.votedFor, peer.votedFor ?? copy.none),
      metric(copy.lastLog, `${peer.lastLogIndex} / ${peer.lastLogTerm}`),
      metric(copy.matchIndex, String(peer.matchIndex)),
      metric(copy.commitIndex, String(peer.commitIndex)),
      metric(copy.appliedIndex, String(peer.appliedIndex)),
    ),
  )
}

function electionSection(
  snapshot: TraceRaftLabSnapshot,
  copy: RaftLabCopy,
): HTMLElement {
  const election = snapshot.election
  return element(
    'section',
    {
      className: 'tidb-raft-lab__election',
      attrs: {
        'data-election-phase': election.phase,
        'data-election-candidate': election.candidateStoreId ?? '',
        'data-election-quorum': String(snapshot.quorum),
      },
    },
    element('h3', { text: copy.election }),
    element(
      'dl',
      { className: 'tidb-raft-lab__facts' },
      metric(copy.electionState, copy.electionPhases[election.phase]),
      metric(copy.candidate, election.candidateStoreId ?? copy.pending),
      metric(copy.preVote, election.prevoteEnabled ? copy.enabled : copy.no),
      metric(
        copy.preVotes,
        `${election.preVotesGranted.length}/${snapshot.quorum}`,
      ),
      metric(copy.votes, `${election.votesGranted.length}/${snapshot.quorum}`),
      metric(copy.quorum, copy.quorumValue),
      metric(copy.liveVoters, `${snapshot.liveVoterCount}/3`),
      metric(
        copy.configuredWindow,
        `${election.configuredElectionTimeoutTicks}–${election.configuredMaxElectionTimeoutTicks} ${copy.ticks}`,
      ),
      metric(copy.elapsed, `${election.elapsedTicks} ${copy.ticks}`),
      metric(copy.candidatePolicy, copy.candidatePolicyValue),
    ),
    element('p', {
      className: 'tidb-raft-lab__policy-note',
      text: copy.timingPolicyNote,
    }),
  )
}

function logSection(
  snapshot: TraceRaftLabSnapshot,
  copy: RaftLabCopy,
): HTMLElement {
  const log = snapshot.log
  const entry = log.entryKind === null || log.index === null || log.term === null
    ? copy.noEntry
    : `${log.entryKind} · index ${log.index} · term ${log.term}`
  return element(
    'section',
    {
      className: 'tidb-raft-lab__log',
      attrs: {
        'data-log-entry': log.entryKind ?? 'none',
        'data-log-committed': String(log.committed),
      },
    },
    element('h3', { text: copy.log }),
    element(
      'dl',
      { className: 'tidb-raft-lab__facts' },
      metric(copy.entry, entry),
      metric(
        copy.persisted,
        log.persistedStoreIds.length > 0
          ? log.persistedStoreIds.join(' · ')
          : copy.none,
      ),
      metric(copy.committed, log.committed ? copy.yes : copy.no),
      metric(
        copy.applied,
        log.appliedStoreIds.length > 0
          ? log.appliedStoreIds.join(' · ')
          : copy.none,
      ),
    ),
  )
}

function pdSection(
  snapshot: TraceRaftLabSnapshot,
  copy: RaftLabCopy,
): HTMLElement {
  return element(
    'section',
    {
      className: 'tidb-raft-lab__pd',
      attrs: { 'data-pd-role': snapshot.pd.role },
    },
    element('h3', { text: copy.pdBoundary }),
    element(
      'dl',
      { className: 'tidb-raft-lab__facts' },
      metric(copy.pdRole, copy.pdRoleValue),
      metric(
        copy.observedLeader,
        snapshot.pd.observedLeaderStoreId ?? copy.none,
      ),
      metric(
        copy.routeLookup,
        snapshot.pd.routeLookupCompleted
          ? copy.completeValue
          : copy.incompleteValue,
      ),
    ),
    element('p', {
      className: 'tidb-raft-lab__boundary-note',
      text: copy.pdBoundaryNote,
    }),
  )
}

function requestSection(
  snapshot: TraceRaftLabSnapshot,
  copy: RaftLabCopy,
): HTMLElement {
  const request = snapshot.request
  const clientResult = request.status === 'completed' ? 'success' : 'pending'
  return element(
    'section',
    {
      className: 'tidb-raft-lab__request',
      attrs: {
        'data-retry-source': request.source,
        'data-request-status': request.status,
        'data-client-result': clientResult,
        'data-client-visible-error': String(request.clientVisibleError),
      },
    },
    element('h3', { text: copy.requestRetry }),
    element(
      'dl',
      { className: 'tidb-raft-lab__facts' },
      metric(copy.logicalRequest, request.logicalRequestId),
      metric(copy.retrySource, copy.tidbInternal),
      metric(copy.attempt, String(request.attempt)),
      metric(copy.cachedLeader, request.cachedLeaderStoreId ?? copy.none),
      metric(copy.cacheState, copy.cacheStates[request.cacheState]),
      metric(copy.requestState, copy.requestStates[request.status]),
      metric(copy.backoff, `${request.backoffMs} ms`),
      metric(
        copy.clientResult,
        clientResult === 'success' ? copy.clientSuccess : copy.clientPending,
      ),
    ),
    element('p', {
      className: 'tidb-raft-lab__boundary-note',
      text: copy.retryBoundaryNote,
    }),
  )
}

function cacheKey(
  event: TraceEvent | null,
  activeEvents: readonly TraceEvent[],
  locale: Locale,
): string {
  return [
    locale,
    event?.id ?? '',
    event?.kind ?? '',
    activeEvents.map((active) => active.id).join(','),
  ].join('|')
}

export function createRaftLabPanel(initialLocale: Locale): RaftLabPanel {
  const root = element('section', {
    className: 'tidb-raft-lab',
    attrs: {
      'data-raft-lab': '',
      tabindex: '0',
    },
  })
  root.hidden = true

  let locale = initialLocale
  let currentEvent: TraceEvent | null = null
  let currentActiveEvents: readonly TraceEvent[] = []
  let renderedKey = ''
  let renderedSnapshot: TraceRaftLabSnapshot | undefined
  let disposed = false

  const render = (): void => {
    if (disposed) return
    const snapshot = currentEvent?.snapshot?.raftLab
    const nextKey = cacheKey(currentEvent, currentActiveEvents, locale)
    if (nextKey === renderedKey && snapshot === renderedSnapshot) return
    renderedKey = nextKey
    renderedSnapshot = snapshot

    root.hidden = snapshot === undefined
    if (!snapshot) {
      root.replaceChildren()
      root.removeAttribute('aria-label')
      return
    }

    const copy = COPY[locale]
    root.setAttribute('aria-label', copy.title)
    root.replaceChildren(
      element(
        'header',
        { className: 'tidb-raft-lab__head' },
        element(
          'div',
          {},
          element('p', {
            className: 'tidb-raft-lab__eyebrow',
            text: copy.model,
          }),
          element('h2', { text: copy.title }),
        ),
        element('p', {
          className: 'tidb-raft-lab__phase',
          text: `${copy.phase}: ${copy.phases[snapshot.phase]}`,
          attrs: {
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
            'data-raft-phase': snapshot.phase,
          },
        }),
      ),
      element(
        'section',
        { className: 'tidb-raft-lab__summary' },
        element(
          'dl',
          { className: 'tidb-raft-lab__facts' },
          metric(copy.region, `Region ${snapshot.regionId}`),
          metric(
            copy.leaderTransition,
            `${snapshot.oldLeaderStoreId} → ${snapshot.leaderStoreId ?? copy.noLeader}`,
          ),
          metric(copy.failedStore, snapshot.failedStoreId ?? copy.none),
        ),
      ),
      electionSection(snapshot, copy),
      element(
        'section',
        { className: 'tidb-raft-lab__peers' },
        element('h3', { text: copy.peers }),
        element(
          'div',
          {
            className: 'tidb-raft-lab__peer-list',
            attrs: {
              role: 'list',
              'aria-label': copy.peers,
            },
          },
          ...snapshot.peers.map((peer) => {
            const card = peerCard(peer, copy)
            card.setAttribute('role', 'listitem')
            return card
          }),
        ),
      ),
      logSection(snapshot, copy),
      pdSection(snapshot, copy),
      requestSection(snapshot, copy),
    )
  }

  return {
    root,
    update(event, activeEvents = []): void {
      currentEvent = event
      currentActiveEvents = activeEvents
      render()
    },
    setLocale(next): void {
      if (locale === next) return
      locale = next
      renderedKey = ''
      render()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      root.remove()
      currentEvent = null
      currentActiveEvents = []
      renderedSnapshot = undefined
    },
  }
}
