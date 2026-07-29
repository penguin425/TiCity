// SPDX-License-Identifier: Apache-2.0

import type {
  ModelPlanNode,
  SqlAnalysis,
  SqlSubmission,
  TiDBSimulationApi,
  TraceReceipt,
} from '../model/types'
import { message, type Locale } from './catalog'
import { element } from './dom'
import { createModelBadge } from './legal'

export const MAX_SQL_BYTES = 64 * 1024

export interface SqlPresentation {
  status: 'supported' | 'unsupported' | 'invalid'
  statement: string
  route: readonly string[]
  plan: readonly string[]
  warning?: string
  explanation?: string
  receipt?: TraceReceipt | unknown
}

export type SqlAnalyzer = (sql: string) => SqlPresentation | SqlSubmission

export interface SqlWorkbenchOptions {
  locale: Locale
  analyzeSql: SqlAnalyzer
  onReceipt?: (receipt: unknown) => void
  initialSql?: string
}

export interface SqlWorkbenchHandle {
  root: HTMLElement
  value(): string
  clear(): void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const fatalDecoder = new TextDecoder('utf-8', { fatal: true })

export function sqlByteLength(sql: string): number {
  return encoder.encode(sql).byteLength
}

export function truncateSql(sql: string, maxBytes = MAX_SQL_BYTES): string {
  const bytes = encoder.encode(sql)
  if (bytes.byteLength <= maxBytes) return sql
  let end = maxBytes
  while (end > 0) {
    try {
      return fatalDecoder.decode(bytes.slice(0, end))
    } catch {
      end -= 1
    }
  }
  return decoder.decode()
}

function flattenPlan(nodes: readonly ModelPlanNode[], depth = 0): string[] {
  const output: string[] = []
  for (const node of nodes) {
    const access = node.accessObject ? ` · ${node.accessObject}` : ''
    output.push(`${'  '.repeat(depth)}${node.operator} · ${node.task}${access}`)
    output.push(...flattenPlan(node.children, depth + 1))
  }
  return output
}

function defaultRoute(analysis: SqlAnalysis, receipt: TraceReceipt | null): string[] {
  if (receipt) {
    const path: string[] = []
    for (const event of receipt.events) {
      for (const stop of [event.source, event.target]) {
        if (stop && path[path.length - 1] !== stop) path.push(stop)
      }
    }
    if (path.length > 0) return path
  }

  const route = ['Client', 'TiProxy', 'TiDB']
  if (analysis.status !== 'supported') return []
  if (analysis.accessPath === 'tiflash_mpp') route.push('TiFlash MPP')
  else if (analysis.accessPath !== 'none') route.push('TiKV Region leader')
  route.push('Client')
  return route
}

function isSqlSubmission(value: SqlPresentation | SqlSubmission): value is SqlSubmission {
  return 'analysis' in value
}

export function presentSql(value: SqlPresentation | SqlSubmission): SqlPresentation {
  if (!isSqlSubmission(value)) return value
  const { analysis, receipt } = value
  return {
    status: analysis.status,
    statement: analysis.kind,
    route: defaultRoute(analysis, receipt),
    plan: flattenPlan(analysis.plan),
    warning: [...analysis.warnings, ...(receipt?.warnings ?? [])].join(' ') || undefined,
    explanation: analysis.explanation,
    receipt: receipt ?? undefined,
  }
}

function statusLabel(locale: Locale, status: SqlPresentation['status']): string {
  return message(locale, status)
}

function outputView(locale: Locale, result: SqlPresentation): HTMLElement {
  const route = element('ol', { className: 'tidb-route' })
  for (const stop of result.route) route.append(element('li', { text: stop }))

  const plan = element('ol', { className: 'tidb-plan' })
  for (const node of result.plan) plan.append(element('li', { text: node }))

  return element(
    'div',
    { className: 'tidb-sql-output', attrs: { 'aria-live': 'polite' } },
    element('p', {
      className: `tidb-status tidb-status--${result.status}`,
      text: `${statusLabel(locale, result.status)} · ${result.statement}`,
    }),
    result.explanation ? element('p', { text: result.explanation }) : null,
    result.route.length > 0
      ? element('section', {}, element('h3', { text: message(locale, 'route') }), route)
      : null,
    result.plan.length > 0
      ? element('section', {}, element('h3', { text: message(locale, 'modelPlan') }), plan)
      : null,
    result.warning
      ? element('p', {
          className: 'tidb-warning',
          text: `${message(locale, 'warning')}: ${result.warning}`,
        })
      : null,
    element('p', { className: 'tidb-no-results', text: message(locale, 'noResultRows') }),
  )
}

export function mountSqlWorkbench(
  root: HTMLElement,
  options: SqlWorkbenchOptions,
): SqlWorkbenchHandle {
  const { locale } = options
  const textarea = element('textarea', {
    className: 'tidb-sql-textarea',
    attrs: {
      rows: '5',
      maxlength: String(MAX_SQL_BYTES),
      spellcheck: 'false',
      'aria-label': message(locale, 'sqlTitle'),
      placeholder: message(locale, 'sqlPlaceholder'),
    },
  })
  textarea.value = truncateSql(options.initialSql ?? '')

  const byteCount = element('span')
  const truncation = element('span', { className: 'tidb-warning' })
  const output = element('div', { className: 'tidb-sql-result' },
    element('p', { className: 'tidb-no-results', text: message(locale, 'noAnalysis') }),
  )

  const updateCount = () => {
    byteCount.textContent = `${sqlByteLength(textarea.value).toLocaleString()} / ${MAX_SQL_BYTES.toLocaleString()} B`
  }
  textarea.addEventListener('input', () => {
    const truncated = truncateSql(textarea.value)
    if (truncated !== textarea.value) {
      textarea.value = truncated
      truncation.textContent = message(locale, 'sqlTooLong')
    } else {
      truncation.textContent = ''
    }
    updateCount()
  })

  const analyze = element('button', {
    className: 'tidb-button tidb-button--primary',
    text: message(locale, 'analyze'),
    attrs: { type: 'button', 'data-action': 'analyze' },
  })
  analyze.addEventListener('click', () => {
    const sql = truncateSql(textarea.value)
    textarea.value = sql
    const result = presentSql(options.analyzeSql(sql))
    output.replaceChildren(outputView(locale, result))
    if (result.receipt !== undefined) options.onReceipt?.(result.receipt)
    updateCount()
  })

  const clear = element('button', {
    className: 'tidb-button',
    text: message(locale, 'clear'),
    attrs: { type: 'button', 'data-action': 'clear' },
  })
  clear.addEventListener('click', () => {
    textarea.value = ''
    truncation.textContent = ''
    output.replaceChildren(element('p', { className: 'tidb-no-results', text: message(locale, 'noAnalysis') }))
    updateCount()
    textarea.focus()
  })

  root.replaceChildren(
    element(
      'section',
      { className: 'tidb-card tidb-sql', attrs: { 'aria-labelledby': 'tidb-sql-title' } },
      element('div', { className: 'tidb-section-heading' },
        element('h2', { text: message(locale, 'sqlTitle'), attrs: { id: 'tidb-sql-title' } }),
        createModelBadge(locale),
      ),
      element('p', { className: 'tidb-sql-help', text: message(locale, 'sqlHelp') }),
      textarea,
      element('div', { className: 'tidb-sql-meta' }, byteCount, truncation),
      element('p', { className: 'tidb-sql-help', text: message(locale, 'sqlMemoryOnly') }),
      element('div', { className: 'tidb-actions' }, analyze, clear),
      output,
    ),
  )
  updateCount()

  return {
    root,
    value: () => textarea.value,
    clear: () => clear.click(),
  }
}

export function simulationSqlAnalyzer(
  simulation: Pick<TiDBSimulationApi, 'submitSql'>,
): SqlAnalyzer {
  return (sql) => simulation.submitSql(sql)
}
