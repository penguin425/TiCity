// SPDX-License-Identifier: Apache-2.0

import type { ScenarioId, TraceEvent } from '../model/types'
import type { Locale } from '../ui/catalog'
import type { DiagnoseCursor } from './cursor'

interface DiagnosePageCopy {
  scenario: string
  event: string
  finalState: string
  snapshotSuffix: string
  scenarioStartSuffix: string
  cursorRule: string
  exactCursor: string
  previousCursor: (eventLabel: string) => string
  scenarioStartCursor: string
  names: Record<ScenarioId, string>
}

export const DIAGNOSE_PAGE_COPY: Record<Locale, DiagnosePageCopy> = {
  ja: {
    scenario: '投影するシナリオ後の状態',
    event: '投影するイベント時点',
    finalState: '最終状態',
    snapshotSuffix: '直前の詳細スナップショットを使用',
    scenarioStartSuffix: 'シナリオ開始時点を使用',
    cursorRule: 'スナップショット規則：選択イベントに詳細状態がない場合は直前の詳細スナップショット、なければシナリオ開始時点を表示します。',
    exactCursor: '選択イベント直後の詳細スナップショットを表示しています。',
    previousCursor: (eventLabel) =>
      `選択イベントに詳細状態がないため、直前の「${eventLabel}」直後を表示しています。`,
    scenarioStartCursor: '選択イベント以前に詳細状態がないため、シナリオ開始時点を表示しています。',
    names: {
      'point-read': 'Point Readとルーティング',
      'cross-region-transaction': '複数Regionの悲観トランザクション',
      'optimistic-conflict': '楽観トランザクションの競合',
      'lock-deadlock': '悲観ロック待機とデッドロック',
      'commit-protocols': '1PC／Async Commit／2PC',
      'hotspot-split': 'hotspot、split、rebalance',
      'tikv-failover': 'TiKV障害とleader election',
      'gc-safe-point': '長時間transactionとGC safe point',
      'tiflash-mpp': 'TiFlash catch-upとMPP',
    },
  },
  en: {
    scenario: 'State after scenario',
    event: 'State at event',
    finalState: 'Final state',
    snapshotSuffix: 'uses nearest earlier detailed snapshot',
    scenarioStartSuffix: 'uses scenario start',
    cursorRule: 'Snapshot rule: when an event has no detailed state, Diagnose shows the nearest earlier detailed snapshot, or scenario start when none exists.',
    exactCursor: 'Showing the detailed snapshot immediately after the selected event.',
    previousCursor: (eventLabel) =>
      `This event has no detailed state; showing the snapshot after “${eventLabel}”.`,
    scenarioStartCursor: 'No earlier detailed state exists; showing scenario start.',
    names: {
      'point-read': 'Point read and routing',
      'cross-region-transaction': 'Cross-Region pessimistic transaction',
      'optimistic-conflict': 'Optimistic transaction conflict',
      'lock-deadlock': 'Pessimistic lock wait and deadlock',
      'commit-protocols': '1PC / Async Commit / 2PC',
      'hotspot-split': 'Hotspot, split, and rebalance',
      'tikv-failover': 'TiKV failure and leader election',
      'gc-safe-point': 'Long transaction and GC safe point',
      'tiflash-mpp': 'TiFlash catch-up and MPP',
    },
  },
}

const LOCK_EVENT_LABELS_JA: Readonly<Record<string, string>> = {
  'Two clients begin a synthetic Lock Lab': '2つのclientが合成Lock Labを開始',
  'PD allocated Client A start_ts': 'PDがClient Aのstart_tsを採番',
  'PD allocated Client B start_ts': 'PDがClient Bのstart_tsを採番',
  'Client A acquired resource-a': 'Client Aがresource-aを獲得',
  'Client B acquired resource-b': 'Client Bがresource-bを獲得',
  'Client A waits for Client B': 'Client AがClient Bを待機',
  'Client B waits for Client A': 'Client BがClient Aを待機',
  'Locate the cluster-wide detector leader': 'クラスタ全体のdetector leaderを検索',
  'Cluster-wide detector found a cycle': 'クラスタ全体のdetectorがcycleを検出',
  'Select Client B as victim (MODEL POLICY)': 'Client Bをvictimに選択（MODEL POLICY）',
  'Roll back Client B and wake Client A': 'Client BをrollbackしClient Aを起床',
  'Break the wait-for cycle': 'wait-for cycleを解消',
  'Return Error 1213 to Client B': 'Client BへError 1213を返却',
  'Application schedules a fixed retry backoff': 'applicationが固定retry backoffを設定',
  'Wake Client A by TiCity MODEL POLICY': 'TiCity MODEL POLICYでClient Aを起床',
  'Hand Client A to the commit model': 'Client Aをcommit modelへ引き渡し',
  'Client A commit completed': 'Client Aのcommitが完了',
  'Release Client A locks after commit': 'commit後にClient Aのlockを解放',
  'Client B starts a new transaction': 'Client Bが新しいtransactionを開始',
  'Retry acquired resource-a first': 'retryがresource-aを先に獲得',
  'Retry acquired resource-b second': 'retryがresource-bを次に獲得',
  'Hand retry attempt to the commit model': 'retry attemptをcommit modelへ引き渡し',
  'Application retry commit completed': 'application retryのcommitが完了',
  'Release retry locks after commit': 'commit後にretryのlockを解放',
  'Lock Lab completed': 'Lock Labが完了',
}

export function diagnoseEventName(locale: Locale, event: TraceEvent): string {
  return locale === 'ja'
    ? LOCK_EVENT_LABELS_JA[event.label] ?? event.label
    : event.label
}

export function diagnoseEventOptionLabel(
  locale: Locale,
  event: TraceEvent,
  index: number,
  cursor: DiagnoseCursor,
): string {
  const copy = DIAGNOSE_PAGE_COPY[locale]
  const suffix = cursor.resolution === 'previous'
    ? ` (${copy.snapshotSuffix})`
    : cursor.resolution === 'scenario-start'
      ? ` (${copy.scenarioStartSuffix})`
      : ''
  return `${index + 1}. ${diagnoseEventName(locale, event)}${suffix}`
}

export function diagnoseCursorNote(
  locale: Locale,
  cursor: DiagnoseCursor,
): string {
  const copy = DIAGNOSE_PAGE_COPY[locale]
  if (cursor.resolution === 'previous' && cursor.snapshotEvent) {
    return `${copy.previousCursor(diagnoseEventName(locale, cursor.snapshotEvent))} ${copy.cursorRule}`
  }
  if (cursor.resolution === 'scenario-start') {
    return `${copy.scenarioStartCursor} ${copy.cursorRule}`
  }
  if (cursor.resolution === 'exact') {
    return `${copy.exactCursor} ${copy.cursorRule}`
  }
  return copy.cursorRule
}
