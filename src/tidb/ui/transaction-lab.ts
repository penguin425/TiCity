// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceRegionSnapshot,
  TraceStateSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

interface TransactionLabCopy {
  readonly region: string
  readonly model: string
  readonly stage: string
  readonly timestamps: string
  readonly active: string
  readonly primary: string
  readonly secondary: string
  readonly leader: string
  readonly memoryLock: string
  readonly noMemoryLock: string
  readonly raft: string
  readonly voters: string
  readonly quorum: string
  readonly mvcc: string
  readonly cfLock: string
  readonly cfDefault: string
  readonly cfWrite: string
}

const COPY: Readonly<Record<Locale, TransactionLabCopy>> = {
  ja: {
    region: 'Transaction Lab 内部断面',
    model: 'MODEL / SIMULATED',
    stage: 'Transaction段階',
    timestamps: 'TSO',
    active: '同時進行',
    primary: 'PRIMARY',
    secondary: 'SECONDARY',
    leader: 'Leader',
    memoryLock: 'Leaderメモリ上の悲観ロック',
    noMemoryLock: '悲観ロックなし',
    raft: 'Region Raft',
    voters: '3 voter',
    quorum: 'quorum',
    mvcc: '概念的MVCC投影',
    cfLock: 'LOCK CF',
    cfDefault: 'DEFAULT CF',
    cfWrite: 'WRITE CF',
  },
  en: {
    region: 'Transaction Lab cutaway',
    model: 'MODEL / SIMULATED',
    stage: 'Transaction stage',
    timestamps: 'TSO',
    active: 'In parallel',
    primary: 'PRIMARY',
    secondary: 'SECONDARY',
    leader: 'Leader',
    memoryLock: 'Leader-memory pessimistic lock',
    noMemoryLock: 'No pessimistic lock',
    raft: 'Region Raft',
    voters: '3 voters',
    quorum: 'quorum',
    mvcc: 'Conceptual MVCC projection',
    cfLock: 'LOCK CF',
    cfDefault: 'DEFAULT CF',
    cfWrite: 'WRITE CF',
  },
}

export interface TransactionLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

function metric(label: string, value: string): HTMLElement {
  return element(
    'div',
    { className: 'tidb-transaction-lab__metric' },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function cfCell(label: string, value: string): HTMLElement {
  return element(
    'div',
    {
      className: 'tidb-transaction-lab__cf',
      attrs: { 'data-cf-state': value },
    },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function regionCard(
  region: TraceRegionSnapshot,
  copy: TransactionLabCopy,
): HTMLElement {
  const role = region.mvcc.primary ? copy.primary : copy.secondary
  const lock = region.pessimisticLock === null
    ? copy.noMemoryLock
    : copy.memoryLock
  const peers = region.peers
    .map((peer) =>
      `${peer.storeId.replace('tikv-', 'S')}:${peer.matchIndex}/${peer.appliedIndex}`)
    .join(' · ')

  return element(
    'article',
    {
      className: 'tidb-transaction-lab__region',
      attrs: {
        'data-region-id': String(region.regionId),
        'data-key-role': region.mvcc.primary ? 'primary' : 'secondary',
      },
    },
    element(
      'header',
      { className: 'tidb-transaction-lab__region-head' },
      element('h3', { text: `Region ${region.regionId}` }),
      element('span', {
        className: 'tidb-transaction-lab__key-role',
        text: role,
      }),
    ),
    element(
      'dl',
      { className: 'tidb-transaction-lab__region-meta' },
      metric(copy.leader, region.leaderStoreId),
      metric(
        copy.raft,
        `${copy.voters} · ${region.acknowledgements}/${region.quorum} ${copy.quorum}`,
      ),
      metric('commit / apply', `${region.commitIndex} / ${region.appliedIndex}`),
    ),
    element('p', {
      className: 'tidb-transaction-lab__lock',
      attrs: {
        'data-lock-state': region.pessimisticLock === null ? 'empty' : 'leader-memory',
      },
      text: lock,
    }),
    element('p', {
      className: 'tidb-transaction-lab__peers',
      text: peers,
    }),
    element('p', {
      className: 'tidb-transaction-lab__mvcc-label',
      text: copy.mvcc,
    }),
    element(
      'dl',
      { className: 'tidb-transaction-lab__mvcc' },
      cfCell(copy.cfLock, region.mvcc.lockCf),
      cfCell(copy.cfDefault, region.mvcc.defaultCf),
      cfCell(copy.cfWrite, region.mvcc.writeCf),
    ),
  )
}

function snapshotKey(
  event: TraceEvent | null,
  activeEvents: readonly TraceEvent[],
  locale: Locale,
): string {
  return `${locale}|${event?.id ?? ''}|${activeEvents.map((entry) => entry.id).join(',')}`
}

export function createTransactionLabPanel(
  initialLocale: Locale,
): TransactionLabPanel {
  const root = element('section', {
    className: 'tidb-transaction-lab',
    attrs: {
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-transaction-lab': '',
    },
  })
  root.hidden = true
  let locale = initialLocale
  let currentEvent: TraceEvent | null = null
  let currentActive: readonly TraceEvent[] = []
  let renderedKey = ''
  let renderedSnapshot: TraceStateSnapshot | undefined
  let disposed = false

  const render = () => {
    if (disposed) return
    const eventSnapshot = currentEvent?.snapshot
    // Dedicated Lab snapshots deliberately retain the shared Region projection,
    // but their matching view is the sole DOM detail surface.
    const snapshot =
      eventSnapshot?.lockLab === undefined &&
      eventSnapshot?.raftLab === undefined &&
      eventSnapshot?.protocolLab === undefined &&
      eventSnapshot?.gcLab === undefined
      ? eventSnapshot
      : undefined
    const nextKey = snapshotKey(currentEvent, currentActive, locale)
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
    root.setAttribute('aria-label', copy.region)
    const transaction = snapshot.transaction
    const active = currentActive.length > 0
      ? currentActive.map((event) => event.label).join(' · ')
      : currentEvent?.label ?? '—'
    const timestamp = transaction
      ? `start_ts ${transaction.startTs} · commit_ts ${transaction.commitTs ?? '—'}`
      : `last ${snapshot.tsoLastAllocated}`

    root.replaceChildren(
      element(
        'header',
        { className: 'tidb-transaction-lab__head' },
        element(
          'div',
          {},
          element('p', {
            className: 'tidb-transaction-lab__eyebrow',
            text: copy.model,
          }),
          element('h2', { text: copy.region }),
        ),
        element('strong', {
          className: 'tidb-transaction-lab__stage',
          text: transaction?.stage ?? 'request',
        }),
      ),
      element(
        'dl',
        { className: 'tidb-transaction-lab__summary' },
        metric(copy.stage, transaction?.stage ?? 'request'),
        metric(copy.timestamps, timestamp),
        metric(copy.active, active),
      ),
      element(
        'div',
        {
          className: 'tidb-transaction-lab__regions',
          attrs: { role: 'list' },
        },
        ...snapshot.regions.map((region) => {
          const card = regionCard(region, copy)
          card.setAttribute('role', 'listitem')
          return card
        }),
      ),
    )
  }

  return {
    root,
    update(event, activeEvents = []): void {
      currentEvent = event
      currentActive = activeEvents
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
      currentActive = []
      renderedSnapshot = undefined
    },
  }
}
