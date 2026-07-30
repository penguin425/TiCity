// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceLockLabSnapshot,
  TraceLockResourceSnapshot,
  TraceLockTransactionSnapshot,
  TraceLockTransactionStatus,
  TraceWaitForEdgeSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

type LockLabPhase =
  | 'starting'
  | 'transactions'
  | 'locking'
  | 'waiting'
  | 'detecting'
  | 'deadlock'
  | 'victim'
  | 'rollback'
  | 'error'
  | 'resolved'
  | 'waking'
  | 'committing'
  | 'retry_backoff'
  | 'retrying'
  | 'complete'

type DeadlockResolution = NonNullable<TraceLockLabSnapshot['deadlock']>['resolution']
type ApplicationRetryStatus =
  NonNullable<TraceLockLabSnapshot['applicationRetry']>['status']

interface EdgeCopyArgs {
  waiter: string
  holder: string
  resource: string
  regionId: number
}

interface RetryPathCopyArgs {
  client: string
  fromAttempt: string
  toAttempt: string
  fromTransaction: string
  toTransaction: string
}

interface LockLabCopy {
  readonly title: string
  readonly model: string
  readonly phase: string
  readonly detector: string
  readonly detectorScope: string
  readonly detectorLeader: string
  readonly clusterWide: string
  readonly detectorNote: string
  readonly transactions: string
  readonly client: string
  readonly transactionId: string
  readonly attempt: string
  readonly startTs: string
  readonly commitTs: string
  readonly state: string
  readonly heldResources: string
  readonly waitingFor: string
  readonly retryOf: string
  readonly resources: string
  readonly region: string
  readonly leader: string
  readonly storage: string
  readonly leaderMemory: string
  readonly holder: string
  readonly orderedWaiters: string
  readonly noWaiters: string
  readonly wakePolicy: string
  readonly smallestStartTs: string
  readonly waitForGraph: string
  readonly noWaitForEdges: string
  readonly deadlock: string
  readonly noDeadlock: string
  readonly cycle: string
  readonly victim: string
  readonly victimPending: string
  readonly selectionPolicy: string
  readonly cycleClosingModelPolicy: string
  readonly resolution: string
  readonly clientError: string
  readonly error1213: string
  readonly errorNotReturned: string
  readonly internalRetryable: string
  readonly falseValue: string
  readonly nonRetryableNote: string
  readonly applicationRetry: string
  readonly noApplicationRetry: string
  readonly retrySource: string
  readonly application: string
  readonly retryStatus: string
  readonly fixedBackoff: string
  readonly newTransaction: string
  readonly newStartTs: string
  readonly none: string
  readonly pending: string
  readonly phases: Readonly<Record<LockLabPhase, string>>
  readonly transactionStates:
    Readonly<Record<TraceLockTransactionStatus, string>>
  readonly deadlockResolutions: Readonly<Record<DeadlockResolution, string>>
  readonly retryStates: Readonly<Record<ApplicationRetryStatus, string>>
  edgeSentence(args: EdgeCopyArgs): string
  retryPath(args: RetryPathCopyArgs): string
}

const COPY: Readonly<Record<Locale, LockLabCopy>> = {
  ja: {
    title: '悲観ロック Lock Lab',
    model: 'MODEL / SIMULATED',
    phase: 'フェーズ',
    detector: 'TiKV デッドロック検出器',
    detectorScope: '検出範囲',
    detectorLeader: '検出器Leader',
    clusterWide: 'クラスタ全体',
    detectorNote: '検出器LeaderはTiKV上でwait-for関係を追跡します。',
    transactions: 'トランザクション',
    client: 'クライアント',
    transactionId: 'Transaction ID',
    attempt: '試行',
    startTs: 'start_ts',
    commitTs: 'commit_ts',
    state: '状態',
    heldResources: '保持リソース',
    waitingFor: '待機対象',
    retryOf: '再試行元',
    resources: '合成ロックリソース',
    region: 'Region',
    leader: 'TiKV Leader',
    storage: '格納場所',
    leaderMemory: 'Region Leaderメモリ',
    holder: '保持者',
    orderedWaiters: '順序付き待機キュー',
    noWaiters: '待機中のトランザクションはありません。',
    wakePolicy: '起床ポリシー',
    smallestStartTs: '最小の start_ts を優先（TiCity MODEL POLICY）',
    waitForGraph: 'wait-for関係',
    noWaitForEdges: 'wait-for edgeはありません。',
    deadlock: 'デッドロック結果',
    noDeadlock: 'デッドロックは検出されていません。',
    cycle: '循環',
    victim: 'Victim',
    victimPending: '選択待ち',
    selectionPolicy: '選択ポリシー',
    cycleClosingModelPolicy:
      '循環を閉じたwaiter（TiCityの決定的MODEL POLICY。TiDBの保証ではありません）',
    resolution: '解決状態',
    clientError: 'クライアントエラー',
    error1213: 'Error 1213',
    errorNotReturned: '未返却',
    internalRetryable: 'TiDB内部retryable',
    falseValue: 'false',
    nonRetryableNote:
      'single-statementの内部再試行ではなく、トランザクション境界で失敗します。',
    applicationRetry: 'アプリケーション再試行',
    noApplicationRetry: 'アプリケーション再試行はまだありません。',
    retrySource: '再試行元',
    application: 'application',
    retryStatus: '再試行状態',
    fixedBackoff: '固定backoff',
    newTransaction: '新しいTransaction ID',
    newStartTs: '新しい start_ts',
    none: 'なし',
    pending: '待機中',
    phases: {
      starting: '開始',
      transactions: 'トランザクション開始',
      locking: 'ロック取得',
      waiting: 'ロック待機',
      detecting: '循環を検査',
      deadlock: 'デッドロック検出',
      victim: 'Victim選択',
      rollback: 'Victimをrollback',
      error: 'Error 1213を返却',
      resolved: '循環を解消',
      waking: 'waiterを起床',
      committing: 'commitへ引き継ぎ',
      retry_backoff: 'アプリケーションbackoff',
      retrying: '新しいトランザクションで再試行',
      complete: '完了',
    },
    transactionStates: {
      active: '実行中',
      waiting: '待機中',
      victim: 'victim',
      rolled_back: 'rollback済み',
      commit_handoff: 'commit引き継ぎ',
      completed: '完了',
    },
    deadlockResolutions: {
      detected: '検出済み',
      rolling_back: 'rollback中',
      resolved: '解消済み',
    },
    retryStates: {
      backoff: 'backoff中',
      started: '開始済み',
      completed: '完了',
    },
    edgeSentence: ({ waiter, holder, resource, regionId }) =>
      `${waiter} は ${resource}（Region ${regionId}）を保持する ${holder} を待機しています。`,
    retryPath: ({
      client,
      fromAttempt,
      toAttempt,
      fromTransaction,
      toTransaction,
    }) =>
      `${client}: ${fromAttempt} → ${toAttempt} · ${fromTransaction} → ${toTransaction}`,
  },
  en: {
    title: 'Pessimistic Lock Lab',
    model: 'MODEL / SIMULATED',
    phase: 'Phase',
    detector: 'TiKV deadlock detector',
    detectorScope: 'Detector scope',
    detectorLeader: 'Detector leader',
    clusterWide: 'Cluster-wide',
    detectorNote: 'The detector leader tracks wait-for relationships on TiKV.',
    transactions: 'Transactions',
    client: 'Client',
    transactionId: 'Transaction ID',
    attempt: 'Attempt',
    startTs: 'start_ts',
    commitTs: 'commit_ts',
    state: 'State',
    heldResources: 'Held resources',
    waitingFor: 'Waiting for',
    retryOf: 'Retry of',
    resources: 'Synthetic lock resources',
    region: 'Region',
    leader: 'TiKV leader',
    storage: 'Storage',
    leaderMemory: 'Region leader memory',
    holder: 'Holder',
    orderedWaiters: 'Ordered wait queue',
    noWaiters: 'No transactions are waiting.',
    wakePolicy: 'Wake policy',
    smallestStartTs: 'Smallest start_ts first (TiCity MODEL POLICY)',
    waitForGraph: 'Wait-for relationships',
    noWaitForEdges: 'No wait-for edges.',
    deadlock: 'Deadlock result',
    noDeadlock: 'No deadlock has been detected.',
    cycle: 'Cycle',
    victim: 'Victim',
    victimPending: 'Selection pending',
    selectionPolicy: 'Selection policy',
    cycleClosingModelPolicy:
      'Cycle-closing waiter (deterministic TiCity MODEL POLICY; not a TiDB guarantee)',
    resolution: 'Resolution',
    clientError: 'Client error',
    error1213: 'Error 1213',
    errorNotReturned: 'Not returned yet',
    internalRetryable: 'TiDB internal retryable',
    falseValue: 'false',
    nonRetryableNote:
      'This fails at the transaction boundary; it is not an internal single-statement retry.',
    applicationRetry: 'Application retry',
    noApplicationRetry: 'No application retry yet.',
    retrySource: 'Retry source',
    application: 'application',
    retryStatus: 'Retry status',
    fixedBackoff: 'Fixed backoff',
    newTransaction: 'New transaction ID',
    newStartTs: 'New start_ts',
    none: 'None',
    pending: 'Pending',
    phases: {
      starting: 'Starting',
      transactions: 'Starting transactions',
      locking: 'Acquiring locks',
      waiting: 'Waiting for locks',
      detecting: 'Checking for a cycle',
      deadlock: 'Deadlock detected',
      victim: 'Selecting a victim',
      rollback: 'Rolling back the victim',
      error: 'Returning Error 1213',
      resolved: 'Cycle resolved',
      waking: 'Waking a waiter',
      committing: 'Handing off to commit',
      retry_backoff: 'Application backoff',
      retrying: 'Retrying as a new transaction',
      complete: 'Complete',
    },
    transactionStates: {
      active: 'Active',
      waiting: 'Waiting',
      victim: 'Victim',
      rolled_back: 'Rolled back',
      commit_handoff: 'Commit handoff',
      completed: 'Completed',
    },
    deadlockResolutions: {
      detected: 'Detected',
      rolling_back: 'Rolling back',
      resolved: 'Resolved',
    },
    retryStates: {
      backoff: 'Backoff',
      started: 'Started',
      completed: 'Completed',
    },
    edgeSentence: ({ waiter, holder, resource, regionId }) =>
      `${waiter} waits for ${holder}, which holds ${resource} in Region ${regionId}.`,
    retryPath: ({
      client,
      fromAttempt,
      toAttempt,
      fromTransaction,
      toTransaction,
    }) =>
      `${client}: ${fromAttempt} → ${toAttempt} · ${fromTransaction} → ${toTransaction}`,
  },
}

const EVENT_PHASE = {
  lock_lab_start: 'starting',
  start_ts: 'transactions',
  lock_acquired: 'locking',
  lock_wait_enqueued: 'waiting',
  deadlock_detector_lookup: 'detecting',
  deadlock_detected: 'deadlock',
  deadlock_victim_selected: 'victim',
  deadlock_victim_rollback: 'rollback',
  deadlock_resolved: 'resolved',
  deadlock_error_1213: 'error',
  application_retry_backoff: 'retry_backoff',
  lock_waiter_woken: 'waking',
  commit_handoff: 'committing',
  commit_summary: 'committing',
  lock_release_after_commit: 'committing',
  application_retry_begin: 'retrying',
  retry_lock_acquired: 'retrying',
  lock_lab_summary: 'complete',
} as const satisfies Readonly<Record<string, LockLabPhase>>

export interface LockLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

function metric(label: string, value: string): HTMLElement {
  return element(
    'div',
    { className: 'tidb-lock-lab__metric' },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function clientAlias(clientId: string): string {
  const suffix = /^client-([a-z])$/i.exec(clientId)?.[1]
  return suffix ? suffix.toUpperCase() : clientId
}

function attemptAlias(clientId: string, attempt: number): string {
  const base = clientAlias(clientId)
  if (attempt <= 1) return base
  if (attempt <= 4) return `${base}${'′'.repeat(attempt - 1)}`
  return `${base}(${attempt})`
}

function phaseFor(
  event: TraceEvent | null,
  snapshot: TraceLockLabSnapshot,
): LockLabPhase {
  const explicit = event
    ? EVENT_PHASE[event.kind as keyof typeof EVENT_PHASE]
    : undefined
  if (explicit) return explicit
  if (snapshot.applicationRetry?.status === 'completed') return 'complete'
  if (snapshot.applicationRetry?.status === 'started') return 'retrying'
  if (snapshot.applicationRetry?.status === 'backoff') return 'retry_backoff'
  if (snapshot.deadlock?.resolution === 'rolling_back') return 'rollback'
  if (snapshot.deadlock?.resolution === 'detected') return 'deadlock'
  if (snapshot.deadlock?.resolution === 'resolved') return 'resolved'
  if (snapshot.waitForEdges.length > 0) return 'waiting'
  if (snapshot.transactions.length > 0) return 'locking'
  return 'starting'
}

function transactionCard(
  transaction: TraceLockTransactionSnapshot,
  copy: LockLabCopy,
): HTMLElement {
  const alias = attemptAlias(transaction.clientId, transaction.attempt)
  return element(
    'article',
    {
      className: 'tidb-lock-lab__transaction',
      attrs: {
        'data-transaction-id': transaction.transactionId,
        'data-transaction-state': transaction.status,
      },
    },
    element(
      'header',
      { className: 'tidb-lock-lab__card-head' },
      element('h4', { text: `${copy.client} ${alias}` }),
      element('code', { text: transaction.transactionId }),
    ),
    element(
      'dl',
      { className: 'tidb-lock-lab__facts' },
      metric(copy.transactionId, transaction.transactionId),
      metric(copy.attempt, String(transaction.attempt)),
      metric(copy.startTs, String(transaction.startTs)),
      metric(copy.commitTs, transaction.commitTs === null
        ? copy.none
        : String(transaction.commitTs)),
      metric(copy.state, copy.transactionStates[transaction.status]),
      metric(
        copy.heldResources,
        transaction.heldResourceIds.length > 0
          ? transaction.heldResourceIds.join(' · ')
          : copy.none,
      ),
      metric(copy.waitingFor, transaction.waitingForResourceId ?? copy.none),
      ...(transaction.retryOfTransactionId === null
        ? []
        : [metric(copy.retryOf, transaction.retryOfTransactionId)]),
    ),
  )
}

function resourceCard(
  resource: TraceLockResourceSnapshot,
  copy: LockLabCopy,
): HTMLElement {
  const waiters = element(
    'ol',
    {
      className: 'tidb-lock-lab__waiters',
      attrs: {
        'data-wait-queue': resource.id,
        'aria-label': `${copy.orderedWaiters}: ${resource.id}`,
      },
    },
    ...resource.waiterTransactionIds.map((transactionId, index) =>
      element('li', {
        text: transactionId,
        attrs: {
          'data-waiter-transaction-id': transactionId,
          'data-wait-position': String(index),
        },
      })),
  )

  return element(
    'article',
    {
      className: 'tidb-lock-lab__resource',
      attrs: {
        'data-lock-resource-id': resource.id,
        'data-region-id': String(resource.regionId),
      },
    },
    element('h4', { text: resource.id }),
    element(
      'dl',
      { className: 'tidb-lock-lab__facts' },
      metric(copy.region, `Region ${resource.regionId}`),
      metric(copy.leader, resource.leaderStoreId),
      metric(copy.storage, copy.leaderMemory),
      metric(copy.holder, resource.holderTransactionId ?? copy.none),
      metric(copy.wakePolicy, copy.smallestStartTs),
    ),
    element('h5', { text: copy.orderedWaiters }),
    waiters,
    resource.waiterTransactionIds.length === 0
      ? element('p', {
        className: 'tidb-lock-lab__empty',
        text: copy.noWaiters,
      })
      : null,
  )
}

function waitForEdgeItem(
  edge: TraceWaitForEdgeSnapshot,
  copy: LockLabCopy,
): HTMLElement {
  return element('li', {
    text: copy.edgeSentence({
      waiter: edge.waiterTransactionId,
      holder: edge.holderTransactionId,
      resource: edge.resourceId,
      regionId: edge.regionId,
    }),
    attrs: {
      'data-wait-for-edge-id': edge.id,
      'data-edge-direction': 'waiter-to-holder',
      'data-waiter-transaction-id': edge.waiterTransactionId,
      'data-holder-transaction-id': edge.holderTransactionId,
    },
  })
}

function deadlockSection(
  snapshot: TraceLockLabSnapshot,
  copy: LockLabCopy,
): HTMLElement {
  const deadlock = snapshot.deadlock
  if (deadlock === null) {
    return element(
      'section',
      { className: 'tidb-lock-lab__deadlock' },
      element('h3', { text: copy.deadlock }),
      element('p', {
        className: 'tidb-lock-lab__empty',
        text: copy.noDeadlock,
      }),
    )
  }

  return element(
    'section',
    {
      className: 'tidb-lock-lab__deadlock',
      attrs: {
        'data-deadlock-id': deadlock.id,
        'data-retryable': String(deadlock.retryable),
        ...(deadlock.victimTransactionId === null
          ? {}
          : { 'data-victim-transaction-id': deadlock.victimTransactionId }),
      },
    },
    element('h3', { text: copy.deadlock }),
    element(
      'dl',
      { className: 'tidb-lock-lab__facts' },
      metric(copy.cycle, deadlock.cycleTransactionIds.join(' → ')),
      metric(copy.victim, deadlock.victimTransactionId ?? copy.victimPending),
      metric(copy.selectionPolicy, copy.cycleClosingModelPolicy),
      metric(copy.resolution, copy.deadlockResolutions[deadlock.resolution]),
      metric(
        copy.clientError,
        deadlock.clientErrorCode === 1213
          ? copy.error1213
          : copy.errorNotReturned,
      ),
      metric(copy.internalRetryable, copy.falseValue),
    ),
    element('p', {
      className: 'tidb-lock-lab__boundary-note',
      text: copy.nonRetryableNote,
    }),
  )
}

function applicationRetrySection(
  snapshot: TraceLockLabSnapshot,
  copy: LockLabCopy,
): HTMLElement {
  const retry = snapshot.applicationRetry
  if (retry === null) {
    return element(
      'section',
      { className: 'tidb-lock-lab__retry' },
      element('h3', { text: copy.applicationRetry }),
      element('p', {
        className: 'tidb-lock-lab__empty',
        text: copy.noApplicationRetry,
      }),
    )
  }

  const sourceTransaction = snapshot.transactions.find((transaction) =>
    transaction.transactionId === retry.retryOfTransactionId)
  const newTransaction = snapshot.transactions.find((transaction) =>
    transaction.transactionId === retry.newTransactionId)
  const fromAttempt = sourceTransaction
    ? attemptAlias(sourceTransaction.clientId, sourceTransaction.attempt)
    : clientAlias(retry.clientId)
  const toAttempt = newTransaction
    ? attemptAlias(newTransaction.clientId, newTransaction.attempt)
    : `${clientAlias(retry.clientId)}′`
  const nextTransactionId = retry.newTransactionId ?? copy.pending

  return element(
    'section',
    {
      className: 'tidb-lock-lab__retry',
      attrs: {
        'data-retry-source': retry.source,
        'data-retry-status': retry.status,
      },
    },
    element('h3', { text: copy.applicationRetry }),
    element('p', {
      className: 'tidb-lock-lab__retry-path',
      text: copy.retryPath({
        client: `${copy.client} ${clientAlias(retry.clientId)}`,
        fromAttempt,
        toAttempt,
        fromTransaction: retry.retryOfTransactionId,
        toTransaction: nextTransactionId,
      }),
    }),
    element(
      'dl',
      { className: 'tidb-lock-lab__facts' },
      metric(copy.retrySource, copy.application),
      metric(copy.retryStatus, copy.retryStates[retry.status]),
      metric(copy.fixedBackoff, `${retry.fixedBackoffMs} ms`),
      metric(copy.newTransaction, nextTransactionId),
      metric(
        copy.newStartTs,
        newTransaction ? String(newTransaction.startTs) : copy.pending,
      ),
    ),
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

export function createLockLabPanel(initialLocale: Locale): LockLabPanel {
  const root = element('section', {
    className: 'tidb-lock-lab',
    attrs: {
      'data-lock-lab': '',
      tabindex: '0',
    },
  })
  root.hidden = true

  let locale = initialLocale
  let currentEvent: TraceEvent | null = null
  let currentActiveEvents: readonly TraceEvent[] = []
  let renderedKey = ''
  let renderedSnapshot: TraceLockLabSnapshot | undefined
  let disposed = false

  const render = (): void => {
    if (disposed) return
    const snapshot = currentEvent?.snapshot?.lockLab
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
    const phase = phaseFor(currentEvent, snapshot)
    root.setAttribute('aria-label', copy.title)
    root.replaceChildren(
      element(
        'header',
        { className: 'tidb-lock-lab__head' },
        element(
          'div',
          {},
          element('p', {
            className: 'tidb-lock-lab__eyebrow',
            text: copy.model,
          }),
          element('h2', { text: copy.title }),
        ),
        element('p', {
          className: 'tidb-lock-lab__phase',
          text: `${copy.phase}: ${copy.phases[phase]}`,
          attrs: {
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
            'data-lock-phase': phase,
          },
        }),
      ),
      element(
        'section',
        {
          className: 'tidb-lock-lab__detector',
          attrs: {
            'data-detector-leader-store-id':
              snapshot.detectorLeaderStoreId,
          },
        },
        element('h3', { text: copy.detector }),
        element(
          'dl',
          { className: 'tidb-lock-lab__facts' },
          metric(copy.detectorScope, copy.clusterWide),
          metric(copy.detectorLeader, snapshot.detectorLeaderStoreId),
        ),
        element('p', {
          className: 'tidb-lock-lab__boundary-note',
          text: copy.detectorNote,
        }),
      ),
      element(
        'section',
        { className: 'tidb-lock-lab__transactions' },
        element('h3', { text: copy.transactions }),
        element(
          'div',
          {
            className: 'tidb-lock-lab__transaction-list',
            attrs: { role: 'list' },
          },
          ...snapshot.transactions.map((transaction) => {
            const card = transactionCard(transaction, copy)
            card.setAttribute('role', 'listitem')
            return card
          }),
        ),
      ),
      element(
        'section',
        { className: 'tidb-lock-lab__resources' },
        element('h3', { text: copy.resources }),
        element(
          'div',
          {
            className: 'tidb-lock-lab__resource-list',
            attrs: { role: 'list' },
          },
          ...snapshot.resources.map((resource) => {
            const card = resourceCard(resource, copy)
            card.setAttribute('role', 'listitem')
            return card
          }),
        ),
      ),
      element(
        'section',
        { className: 'tidb-lock-lab__edges' },
        element('h3', { text: copy.waitForGraph }),
        snapshot.waitForEdges.length > 0
          ? element(
            'ul',
            { className: 'tidb-lock-lab__edge-list' },
            ...snapshot.waitForEdges.map((edge) =>
              waitForEdgeItem(edge, copy)),
          )
          : element('p', {
            className: 'tidb-lock-lab__empty',
            text: copy.noWaitForEdges,
          }),
      ),
      deadlockSection(snapshot, copy),
      applicationRetrySection(snapshot, copy),
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
