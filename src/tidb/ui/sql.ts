// SPDX-License-Identifier: Apache-2.0

import type {
  ModelPlanNode,
  SqlAnalysis,
  SqlSubmission,
  TiDBSimulationApi,
  TraceEvent,
  TraceReceipt,
} from '../model/types'
import { CATALOG, message, sqlExplanation, type Locale } from './catalog'
import { element } from './dom'
import { traceEndpointLabel, traceEventCopy } from './event-copy'
import { createModelBadge } from './legal'

export const MAX_SQL_BYTES = 64 * 1024

export type SqlRoutePlane = 'data' | 'control' | 'transaction' | 'replication'

export interface SqlRouteGroup {
  readonly plane: SqlRoutePlane
  /** Directed receipt hops, kept separate rather than joined into a pipeline. */
  readonly events: readonly TraceEvent[]
}

export interface SqlPresentation {
  status: 'supported' | 'unsupported' | 'invalid'
  statement: string
  route: readonly string[]
  routeGroups?: readonly SqlRouteGroup[]
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

function defaultRoute(analysis: SqlAnalysis): string[] {
  const route = ['Client', 'TiProxy', 'TiDB']
  if (analysis.status !== 'supported') return []
  if (analysis.accessPath === 'tiflash_mpp') route.push('TiFlash MPP')
  else if (analysis.accessPath !== 'none') route.push('TiKV Region leader')
  route.push('Client')
  return route
}

function routePlane(event: TraceEvent): SqlRoutePlane {
  if (
    event.domain === 'tso' ||
    event.kind === 'locate_regions' ||
    event.kind === 'locate_region' ||
    event.kind === 'learner_snapshot_gate' ||
    event.kind === 'tiflash_read_index_requested' ||
    event.kind === 'tiflash_read_index_returned'
  ) return 'control'
  if (event.domain === 'txn2pc') return 'transaction'
  if (
    event.domain === 'raft' ||
    event.kind === 'tiflash_raft_leader_commit' ||
    event.kind === 'tiflash_learner_receive' ||
    event.kind === 'tiflash_learner_apply_command' ||
    event.kind === 'tiflash_dm_committed_flush' ||
    event.kind === 'tiflash_learner_applied_advance'
  ) return 'replication'
  return 'data'
}

export function projectSqlRouteGroups(receipt: TraceReceipt): readonly SqlRouteGroup[] {
  const groups: Record<SqlRoutePlane, TraceEvent[]> = {
    data: [],
    control: [],
    transaction: [],
    replication: [],
  }
  for (const event of receipt.events) {
    // Local computation is not a network hop. Retain only directed edges that
    // the receipt actually declares, without creating return or branch links.
    if (!event.source || !event.target || event.source === event.target) continue
    groups[routePlane(event)].push(event)
  }
  return (Object.keys(groups) as SqlRoutePlane[])
    .filter((plane) => groups[plane].length > 0)
    .map((plane) => ({ plane, events: groups[plane] }))
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
    route: defaultRoute(analysis),
    routeGroups: receipt ? projectSqlRouteGroups(receipt) : undefined,
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
  const routeGroups = result.routeGroups?.map((group) => {
    const hops = element('ul', { className: 'tidb-route-hops' })
    for (const event of group.events) {
      const from = traceEndpointLabel(locale, event.source, event)
      const to = traceEndpointLabel(locale, event.target, event)
      hops.append(element('li', {
        text: `${from} → ${to} · ${traceEventCopy(event, locale).label}`,
        attrs: { 'data-route-event': event.id },
      }))
    }
    return element('section', {
      attrs: { 'data-route-plane': group.plane },
    }, element('h4', { text: CATALOG[locale].routePlanes[group.plane] }), hops)
  })

  const plan = element('ol', { className: 'tidb-plan' })
  for (const node of result.plan) plan.append(element('li', { text: node }))

  return element(
    'div',
    { className: 'tidb-sql-output', attrs: { 'aria-live': 'polite' } },
    element('p', {
      className: `tidb-status tidb-status--${result.status}`,
      text: `${statusLabel(locale, result.status)} · ${result.statement}`,
    }),
    result.explanation ? element('p', {
      text: sqlExplanation(locale, result.explanation),
    }) : null,
    routeGroups && routeGroups.length > 0
      ? element('section', {},
          element('h3', { text: message(locale, 'route') }),
          element('p', { text: message(locale, 'routeHelp') }),
          ...routeGroups,
        )
      : result.route.length > 0
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
