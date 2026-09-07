// SPDX-License-Identifier: Apache-2.0

export type Locale = 'ja' | 'en'

export const DEFAULT_LOCALE: Locale = 'ja'
export const LOCALE_STORAGE_KEY = 'ticity:lang'

export interface LocaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface NavigationMessages {
  city: string
  machine: string
  diagnose: string
  source: string
  day: string
  night: string
  model: string
  ariaLabel: string
  relatedSurfaces: string
  switchToDay: string
  switchToNight: string
}

export interface CityCopy {
  skip: string
  qps: string
  txn: string
  regions: string
  trace: string
  protocol: Readonly<Record<'1pc' | 'async_commit' | '2pc', string>>
  protocolSummary: string
  none: string
  succeeded: string
  committed: string
  rolledBack: string
  failed: string
  playing: string
  paused: string
  orbit: string
  fly: string
  walk: string
  sound: string
  inspect: string
  showInspect: string
  hideInspect: string
  panel: string
  showPanel: string
  hidePanel: string
  canvas: string
  hint: Readonly<Record<'orbit' | 'fly' | 'walk', string>>
  selected: string
  noWebgl: string
  startupError: string
  movement: Readonly<Record<
    'flyControls' | 'walkControls' | 'forward' | 'backward' | 'left' |
    'right' | 'ascend' | 'descend' | 'sprint',
    string
  >>
  legend: Readonly<Record<'sql' | 'tso' | 'txn2pc' | 'raft' | 'kv' | 'tiflash', string>>
  legendLabel: string
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
  navigation: NavigationMessages
  city: CityCopy
}

const ja: Messages = {
  appName: 'TiCity',
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
  machineTitle: 'TiCity Machine',
  machineSubtitle: '同じtraceを層ごとに再生し、2PCとRaft commitを分けて観察します。',
  emptyTrace: '再生できるイベントはありません。',
  play: '再生',
  pause: '一時停止',
  step: '1ステップ',
  reset: '先頭へ',
  event: 'イベント',
  simulatedTiming: '時間軸は説明用に縮尺されたモデル値です。',
  diagnoseTitle: 'TiCity Diagnose',
  diagnoseSubtitle: '同じシミュレーション状態を、運用診断に近い表へ投影します。',
  modelLabel: 'MODEL / SIMULATED',
  noRows: '該当するモデル行はありません。',
  symptomGuides: '症状から調べる',
  realClusterCheck: '実クラスタで確認するSQL例',
  navigation: {
    city: '3D俯瞰',
    machine: '2D構成図',
    diagnose: '診断',
    source: 'GitHub',
    day: '昼',
    night: '夜',
    model: 'TiDB v8.5 LTS 教育モデル',
    ariaLabel: '主要ナビゲーション',
    relatedSurfaces: '関連画面',
    switchToDay: '昼テーマに切り替える',
    switchToNight: '夜テーマに切り替える',
  },
  city: {
    skip: 'メインコンテンツへ移動',
    qps: 'QPS',
    txn: '取引',
    regions: 'Region数',
    trace: '再生位置',
    protocol: { '1pc': '1PC', async_commit: 'Async Commit', '2pc': '2PC' },
    protocolSummary: '1PC / Async / 2PC',
    none: 'なし',
    succeeded: '成功',
    committed: 'コミット完了',
    rolledBack: 'ロールバック',
    failed: '失敗',
    playing: '再生中',
    paused: '一時停止中',
    orbit: '俯瞰',
    fly: '飛行',
    walk: '歩行',
    sound: '音',
    inspect: '内部',
    showInspect: '現在の詳細ラボを開く',
    hideInspect: '現在の詳細ラボを閉じる',
    panel: '操作',
    showPanel: '操作パネルを開く',
    hidePanel: '操作パネルを閉じる',
    canvas: 'TiCityの対話型3Dアーキテクチャ。画面上の表示切替またはキーボードで探索できます。',
    hint: {
      orbit: 'ドラッグ: 回転 · ホイール: ズーム · 建物をクリック: 詳細',
      fly: 'ドラッグ: 視点 · WASD: 移動 · スペース/E: 上昇 · Q: 下降 · ホイール: 速度',
      walk: 'ドラッグ: 視点 · WASD: 歩行 · Shift: 高速移動',
    },
    selected: '選択したコンポーネント',
    noWebgl: 'WebGL2を開始できませんでした。モデルと解説UIは引き続き利用できます。',
    startupError: 'TiCityを起動できませんでした。ブラウザコンソールを確認してください。',
    movement: {
      flyControls: '飛行移動',
      walkControls: '歩行移動',
      forward: '前へ移動',
      backward: '後ろへ移動',
      left: '左へ移動',
      right: '右へ移動',
      ascend: '上昇',
      descend: '下降',
      sprint: '高速移動',
    },
    legend: {
      sql: 'SQL / データ経路',
      tso: 'TSO / 制御',
      txn2pc: 'トランザクション 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      tiflash: 'TiFlash / MPP',
    },
    legendLabel: '意味を表す色',
  },
}

const en: Messages = {
  appName: 'TiCity',
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
  machineTitle: 'TiCity Machine',
  machineSubtitle: 'Replay one trace by layer and keep 2PC separate from Raft commit.',
  emptyTrace: 'There are no events to replay.',
  play: 'Play',
  pause: 'Pause',
  step: 'Step',
  reset: 'Reset',
  event: 'Event',
  simulatedTiming: 'The timeline uses scaled model timing for explanation.',
  diagnoseTitle: 'TiCity Diagnose',
  diagnoseSubtitle: 'Project the same simulation state into operations-oriented tables.',
  modelLabel: 'MODEL / SIMULATED',
  noRows: 'There are no matching model rows.',
  symptomGuides: 'Start from a symptom',
  realClusterCheck: 'Example SQL for a real cluster',
  navigation: {
    city: '3D City',
    machine: '2D Machine',
    diagnose: 'Diagnose',
    source: 'GitHub',
    day: 'Day',
    night: 'Night',
    model: 'TiDB v8.5 LTS teaching model',
    ariaLabel: 'Primary navigation',
    relatedSurfaces: 'Related surfaces',
    switchToDay: 'Switch to day theme',
    switchToNight: 'Switch to night theme',
  },
  city: {
    skip: 'Skip to main content',
    qps: 'QPS',
    txn: 'Txn',
    regions: 'Regions',
    trace: 'Trace',
    protocol: { '1pc': '1PC', async_commit: 'Async Commit', '2pc': '2PC' },
    protocolSummary: '1PC / Async / 2PC',
    none: 'none',
    succeeded: 'success',
    committed: 'commit',
    rolledBack: 'rollback',
    failed: 'failed',
    playing: 'Playing',
    paused: 'Paused',
    orbit: 'Orbit',
    fly: 'Fly',
    walk: 'Walk',
    sound: 'Sound',
    inspect: 'Inspect',
    showInspect: 'Open the active detail lab',
    hideInspect: 'Close the active detail lab',
    panel: 'Panel',
    showPanel: 'Open control panel',
    hidePanel: 'Close control panel',
    canvas: 'TiCity interactive 3D architecture. Use the view controls or keyboard to explore.',
    hint: {
      orbit: 'Drag: orbit · wheel: zoom · click a building: inspect',
      fly: 'Drag: look · WASD: move · Space/E: ascend · Q: descend · wheel: speed',
      walk: 'Drag: look · WASD: walk · Shift: move faster',
    },
    selected: 'Selected component',
    noWebgl: 'WebGL2 could not start. The model and explanatory interface remain available.',
    startupError: 'TiCity could not start. See the browser console for details.',
    movement: {
      flyControls: 'Fly movement',
      walkControls: 'Walk movement',
      forward: 'Move forward',
      backward: 'Move backward',
      left: 'Move left',
      right: 'Move right',
      ascend: 'Ascend',
      descend: 'Descend',
      sprint: 'Move faster',
    },
    legend: {
      sql: 'SQL / data route',
      tso: 'TSO / control',
      txn2pc: 'Transaction 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      tiflash: 'TiFlash / MPP',
    },
    legendLabel: 'Semantic colours',
  },
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
