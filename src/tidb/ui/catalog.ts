// SPDX-License-Identifier: Apache-2.0

export type Locale = 'ja' | 'en'

export const DEFAULT_LOCALE: Locale = 'ja'
export const LOCALE_STORAGE_KEY = 'tidb-city:lang'

export interface LocaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Messages {
  appName: string
  citySubtitle: string
  language: string
  japanese: string
  english: string
  sqlTitle: string
  sqlHelp: string
  sqlPlaceholder: string
  analyze: string
  clear: string
  route: string
  modelPlan: string
  warning: string
  supported: string
  unsupported: string
  invalid: string
  noAnalysis: string
  noResultRows: string
  sqlMemoryOnly: string
  sqlTooLong: string
  tourTitle: string
  previous: string
  next: string
  chapter: string
  modelBadge: string
  modelDisclosure: string
  legalTitle: string
  legalAttribution: string
  legalIndependence: string
  legalPrivacy: string
  projectLicense: string
  projectNotice: string
  thirdPartyLicenses: string
  machineTitle: string
  machineSubtitle: string
  emptyTrace: string
  play: string
  pause: string
  step: string
  reset: string
  event: string
  simulatedTiming: string
  diagnoseTitle: string
  diagnoseSubtitle: string
  modelLabel: string
  noRows: string
  symptomGuides: string
  realClusterCheck: string
}

const ja: Messages = {
  appName: 'TiDB City',
  citySubtitle: '分散SQLデータベースの内部を歩いて学ぶ',
  language: '言語',
  japanese: '日本語',
  english: 'English',
  sqlTitle: 'SQL経路ラボ',
  sqlHelp: '対応する単一statementを分類し、モデル上の経路と計画だけを表示します。',
  sqlPlaceholder: 'SELECT * FROM accounts WHERE id = 42;',
  analyze: '経路を解析',
  clear: 'クリア',
  route: 'モデル経路',
  modelPlan: 'モデル計画',
  warning: '注意',
  supported: '対応',
  unsupported: '未対応',
  invalid: '無効',
  noAnalysis: 'SQLを入力して経路を解析してください。',
  noResultRows: '結果行は生成しません。この画面はSQL実行環境ではありません。',
  sqlMemoryOnly: 'SQLはこのタブのメモリだけに保持され、保存・送信されません。',
  sqlTooLong: '入力は64 KiBに切り詰められました。',
  tourTitle: 'ガイドツアー',
  previous: '前へ',
  next: '次へ',
  chapter: '章',
  modelBadge: 'MODEL / SIMULATED',
  modelDisclosure: 'これはTiDBの学習用モデルです。実クラスタやエミュレーターではありません。',
  legalTitle: '帰属とモデルの範囲',
  legalAttribution: 'Apache-2.0のPGSimCityから派生し、同じライセンスで提供します。',
  legalIndependence: 'PingCAP, Inc.とは独立した教育プロジェクトで、公式製品・承認・後援を示すものではありません。',
  legalPrivacy: '入力SQLを保存・外部送信せず、実データへ接続しません。',
  projectLicense: 'Apache-2.0ライセンス',
  projectNotice: 'NOTICE / 帰属',
  thirdPartyLicenses: '第三者ライセンス',
  machineTitle: 'TiDB Machine',
  machineSubtitle: '同じtraceを層ごとに再生し、2PCとRaft commitを分けて観察します。',
  emptyTrace: '再生できるイベントはありません。',
  play: '再生',
  pause: '一時停止',
  step: '1ステップ',
  reset: '先頭へ',
  event: 'イベント',
  simulatedTiming: '時間軸は説明用に縮尺されたモデル値です。',
  diagnoseTitle: 'TiDB Diagnose',
  diagnoseSubtitle: '同じシミュレーション状態を、運用診断に近い表へ投影します。',
  modelLabel: 'MODEL / SIMULATED',
  noRows: '該当するモデル行はありません。',
  symptomGuides: '症状から調べる',
  realClusterCheck: '実クラスタで確認するSQL例',
}

const en: Messages = {
  appName: 'TiDB City',
  citySubtitle: 'Walk through the internals of a distributed SQL database',
  language: 'Language',
  japanese: '日本語',
  english: 'English',
  sqlTitle: 'SQL route lab',
  sqlHelp: 'Classifies one supported statement and shows only its model route and plan.',
  sqlPlaceholder: 'SELECT * FROM accounts WHERE id = 42;',
  analyze: 'Analyze route',
  clear: 'Clear',
  route: 'Model route',
  modelPlan: 'Model plan',
  warning: 'Notice',
  supported: 'Supported',
  unsupported: 'Unsupported',
  invalid: 'Invalid',
  noAnalysis: 'Enter SQL to analyze its route.',
  noResultRows: 'No result rows are generated. This surface does not execute SQL.',
  sqlMemoryOnly: 'SQL stays only in this tab’s memory. It is neither saved nor sent.',
  sqlTooLong: 'The input was truncated to 64 KiB.',
  tourTitle: 'Guided tour',
  previous: 'Previous',
  next: 'Next',
  chapter: 'Chapter',
  modelBadge: 'MODEL / SIMULATED',
  modelDisclosure: 'This is an educational TiDB model, not a real cluster or emulator.',
  legalTitle: 'Attribution and model limits',
  legalAttribution: 'Derived from Apache-2.0 PGSimCity and distributed under the same license.',
  legalIndependence: 'An independent educational project; it is not affiliated with, endorsed by, or sponsored by PingCAP, Inc.',
  legalPrivacy: 'Entered SQL is never persisted or sent, and this site does not connect to real data.',
  projectLicense: 'Apache-2.0 license',
  projectNotice: 'NOTICE / attribution',
  thirdPartyLicenses: 'Third-party licenses',
  machineTitle: 'TiDB Machine',
  machineSubtitle: 'Replay one trace by layer and keep 2PC separate from Raft commit.',
  emptyTrace: 'There are no events to replay.',
  play: 'Play',
  pause: 'Pause',
  step: 'Step',
  reset: 'Reset',
  event: 'Event',
  simulatedTiming: 'The timeline uses scaled model timing for explanation.',
  diagnoseTitle: 'TiDB Diagnose',
  diagnoseSubtitle: 'Project the same simulation state into operations-oriented tables.',
  modelLabel: 'MODEL / SIMULATED',
  noRows: 'There are no matching model rows.',
  symptomGuides: 'Start from a symptom',
  realClusterCheck: 'Example SQL for a real cluster',
}

export const CATALOG = { ja, en } satisfies Record<Locale, Messages>

export function isLocale(value: unknown): value is Locale {
  return value === 'ja' || value === 'en'
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

function browserStorage(): LocaleStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function resolveLocale(
  search = browserSearch(),
  storage: LocaleStorage | undefined = browserStorage(),
): Locale {
  const fromUrl = new URLSearchParams(search).get('lang')
  if (isLocale(fromUrl)) return fromUrl
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(stored)) return stored
  } catch {
    // A disabled storage API must not prevent the static application booting.
  }
  return DEFAULT_LOCALE
}

export function persistLocale(
  locale: Locale,
  storage: LocaleStorage | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Language still changes for this page when private-mode storage rejects.
  }
}

export function message<K extends keyof Messages>(locale: Locale, key: K): Messages[K] {
  return CATALOG[locale][key]
}
