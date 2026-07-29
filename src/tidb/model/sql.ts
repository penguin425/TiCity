/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * This is deliberately a classifier, not a SQL parser or executor. It accepts
 * only shapes whose distributed route the model can explain without guessing.
 */

import type {
  ModelPlanNode,
  SqlAccessPath,
  SqlAnalysis,
  SqlQueryKind,
  SqlStatus,
} from './types'

export const MAX_SQL_BYTES = 64 * 1024

interface LexResult {
  tokens: string[]
  error: string | null
}

interface DemoTable {
  primaryKey: readonly string[]
  tiflashReplica: boolean
}

/* The classifier may only claim Point_Get or a bounded write when it knows the
   demo schema. Foreign keys are intentionally absent from this map. */
const DEMO_TABLES: Readonly<Record<string, DemoTable>> = Object.freeze({
  accounts: { primaryKey: ['id'], tiflashReplica: false },
  orders: { primaryKey: ['id'], tiflashReplica: false },
  order_items: { primaryKey: ['order_id', 'item_id'], tiflashReplica: false },
  events: { primaryKey: ['id'], tiflashReplica: true },
  inventory: { primaryKey: ['sku'], tiflashReplica: false },
})
const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max'])
const COMPLEX_SELECT = new Set(['join', 'union', 'intersect', 'except', 'window'])

function lex(sql: string): LexResult {
  const tokens: string[] = []
  let index = 0

  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]

    if (/\s/.test(char)) {
      index++
      continue
    }

    if ((char === '-' && next === '-') || char === '#') {
      index += char === '#' ? 1 : 2
      while (index < sql.length && sql[index] !== '\n') index++
      continue
    }

    if (char === '/' && next === '*') {
      let depth = 1
      index += 2
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          depth++
          index += 2
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          depth--
          index += 2
        } else {
          index++
        }
      }
      if (depth !== 0) return { tokens: [], error: 'Unterminated block comment.' }
      continue
    }

    /* MySQL-compatible TiDB treats both quote styles as string delimiters
       unless ANSI_QUOTES is enabled. Literal contents never enter analysis. */
    if (char === "'" || char === '"') {
      const quote = char
      let closed = false
      index++
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index += 2
          continue
        }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2
            continue
          }
          index++
          closed = true
          break
        }
        index++
      }
      if (!closed) return { tokens: [], error: 'Unterminated string literal.' }
      tokens.push('?')
      continue
    }

    if (char === '`') {
      let identifier = ''
      let closed = false
      index++
      while (index < sql.length) {
        if (sql[index] === '`') {
          if (sql[index + 1] === '`') {
            identifier += '`'
            index += 2
            continue
          }
          index++
          closed = true
          break
        }
        identifier += sql[index]
        index++
      }
      if (!closed) return { tokens: [], error: 'Unterminated quoted identifier.' }
      if (identifier.length === 0) return { tokens: [], error: 'Empty quoted identifier.' }
      tokens.push(identifier.toLowerCase())
      continue
    }

    if (/[0-9]/.test(char)) {
      if (char === '0' && (next === 'x' || next === 'X')) {
        index += 2
        while (index < sql.length && /[0-9a-fA-F]/.test(sql[index])) index++
      } else {
        while (index < sql.length && /[0-9]/.test(sql[index])) index++
        if (sql[index] === '.' && /[0-9]/.test(sql[index + 1] ?? '')) {
          index++
          while (index < sql.length && /[0-9]/.test(sql[index])) index++
        }
        if ((sql[index] === 'e' || sql[index] === 'E')) {
          let exponent = index + 1
          if (sql[exponent] === '+' || sql[exponent] === '-') exponent++
          if (/[0-9]/.test(sql[exponent] ?? '')) {
            index = exponent + 1
            while (index < sql.length && /[0-9]/.test(sql[index])) index++
          }
        }
      }
      tokens.push('?')
      continue
    }

    if (/[A-Za-z_$]/.test(char)) {
      const start = index
      index++
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index++
      tokens.push(sql.slice(start, index).toLowerCase())
      continue
    }

    const pair = `${char}${next ?? ''}`
    if (['<=', '>=', '<>', '!=', ':='].includes(pair)) {
      tokens.push(pair)
      index += 2
      continue
    }

    if ('(),;.*=<>+-/%?'.includes(char)) {
      tokens.push(char)
      index++
      continue
    }

    return { tokens: [], error: `Unsupported token ${JSON.stringify(char)}.` }
  }

  return { tokens, error: null }
}

function emptyAnalysis(status: SqlStatus, explanation: string): SqlAnalysis {
  return {
    status,
    kind: 'unknown',
    statementKind: 'unknown',
    table: null,
    accessPath: 'none',
    readOnly: true,
    plan: [],
    warnings: [],
    explanation,
  }
}

function tableAfter(tokens: readonly string[], keyword: string): string | null {
  const at = tokens.indexOf(keyword)
  if (at < 0) return null
  const first = tokens[at + 1]
  if (!first || first === '?' || '(),;'.includes(first)) return null
  if (tokens[at + 2] === '.' && tokens[at + 3]) return tokens[at + 3]
  return first
}

function hasLiteralEquality(tokens: readonly string[], column: string): boolean {
  const boundary = (token: string | undefined): boolean =>
    token === undefined ||
    token === 'and' ||
    token === ')' ||
    token === 'limit' ||
    token === 'order' ||
    token === 'for'

  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === column &&
        tokens[index + 1] === '=' &&
        tokens[index + 2] === '?' &&
        boundary(tokens[index + 3])) {
      return true
    }
    if (tokens[index] === '?' &&
        tokens[index + 1] === '=' &&
        tokens[index + 2] === column &&
        boundary(tokens[index + 3])) {
      return true
    }
  }
  return false
}

function hasCompletePrimaryKeyEquality(
  tokens: readonly string[],
  table: string,
): boolean {
  const definition = DEMO_TABLES[table]
  const where = tokens.indexOf('where')
  if (!definition || where < 0) return false
  const predicate = tokens.slice(where + 1)
  if (predicate.includes('or')) return false
  return definition.primaryKey.every((column) => hasLiteralEquality(predicate, column))
}

function matchingClose(tokens: readonly string[], open: number): number {
  let depth = 0
  for (let index = open; index < tokens.length; index++) {
    if (tokens[index] === '(') depth++
    if (tokens[index] === ')') {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

function parseIdentifierList(tokens: readonly string[]): string[] | null {
  if (tokens.length === 0 || tokens.length % 2 === 0) return null
  const columns: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (index % 2 === 1) {
      if (tokens[index] !== ',') return null
      continue
    }
    const column = tokens[index]
    if (!/^[a-z_$][a-z0-9_$]*$/i.test(column) || columns.includes(column)) return null
    columns.push(column)
  }
  return columns
}

function parseSingleValuesRow(tokens: readonly string[]): string[] | null {
  if (tokens.length === 0 || tokens.length % 2 === 0) return null
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (index % 2 === 1) {
      if (tokens[index] !== ',') return null
      continue
    }
    if (!['?', 'null', 'default'].includes(tokens[index])) return null
    values.push(tokens[index])
  }
  return values
}

function supportsSingleRowInsert(tokens: readonly string[], table: string): boolean {
  const definition = DEMO_TABLES[table]
  const into = tokens.indexOf('into')
  const values = tokens.indexOf('values')
  if (!definition || into < 0 || values < 0 || values <= into) return false

  const columnsOpen = tokens.indexOf('(', into + 1)
  if (columnsOpen < 0 || columnsOpen >= values) return false
  const columnsClose = matchingClose(tokens, columnsOpen)
  if (columnsClose < 0 || columnsClose + 1 !== values) return false
  const columns = parseIdentifierList(tokens.slice(columnsOpen + 1, columnsClose))
  if (!columns || !definition.primaryKey.every((column) => columns.includes(column))) {
    return false
  }

  const valuesOpen = tokens[values + 1] === '(' ? values + 1 : -1
  const valuesClose = valuesOpen < 0 ? -1 : matchingClose(tokens, valuesOpen)
  if (valuesClose < 0 || valuesClose !== tokens.length - 1) return false
  const row = parseSingleValuesRow(tokens.slice(valuesOpen + 1, valuesClose))
  if (!row || row.length !== columns.length) return false
  return definition.primaryKey.every((column) => row[columns.indexOf(column)] === '?')
}

function plan(
  kind: Exclude<SqlQueryKind, 'explain' | 'unknown'>,
  table: string,
  path: SqlAccessPath,
): ModelPlanNode[] {
  const accessObject = `table:${table}`

  if (kind === 'aggregate') {
    if (path !== 'tiflash_mpp') {
      return [{
        id: 'root-aggregate',
        operator: 'HashAgg',
        task: 'root',
        accessObject: null,
        children: [{
          id: 'tikv-aggregate-scan',
          operator: 'TableFullScan',
          task: 'cop[tikv]',
          accessObject,
          children: [],
        }],
      }]
    }
    return [{
      id: 'root-aggregate',
      operator: 'HashAgg',
      task: 'root',
      accessObject: null,
      children: [{
        id: 'mpp-exchange',
        operator: 'ExchangeSender',
        task: 'mpp[tiflash]',
        accessObject: null,
        children: [{
          id: 'tiflash-scan',
          operator: 'TableFullScan',
          task: 'mpp[tiflash]',
          accessObject,
          children: [],
        }],
      }],
    }]
  }

  if (kind === 'point_read' || kind === 'range_read') {
    return [{
      id: 'root-projection',
      operator: 'Projection',
      task: 'root',
      accessObject: null,
      children: [{
        id: 'tikv-access',
        operator: path === 'point_get'
          ? 'Point_Get'
          : path === 'range_scan'
            ? 'IndexRangeScan'
            : 'TableFullScan',
        task: path === 'point_get' ? 'root' : 'cop[tikv]',
        accessObject,
        children: [],
      }],
    }]
  }

  return [{
    id: 'root-write',
    operator: kind === 'insert' ? 'Insert' : kind === 'update' ? 'Update' : 'Delete',
    task: 'root',
    accessObject,
    children: [{
      id: 'tikv-write',
      operator: 'KVWrite',
      task: 'cop[tikv]',
      accessObject,
      children: [],
    }],
  }]
}

function supported(
  kind: Exclude<SqlQueryKind, 'explain' | 'unknown'>,
  table: string,
  accessPath: SqlAccessPath,
): SqlAnalysis {
  return {
    status: 'supported',
    kind,
    statementKind: kind,
    table,
    accessPath,
    readOnly: kind === 'point_read' || kind === 'range_read' || kind === 'aggregate',
    plan: plan(kind, table, accessPath),
    warnings: [
      'MODEL: the plan and route are educational projections, not output from a TiDB server.',
    ],
    explanation: kind === 'aggregate'
      ? accessPath === 'tiflash_mpp'
        ? 'Modeled as an HTAP aggregate dispatched to TiFlash MPP.'
        : 'Modeled as a TiKV table scan with aggregation in the TiDB root task.'
      : kind === 'point_read'
        ? 'Modeled as a key lookup routed to one Region.'
        : kind === 'range_read'
          ? 'Modeled as a distributed range or table scan.'
          : 'Modeled as a transactional KV mutation.',
  }
}

function classifyBase(tokens: readonly string[]): SqlAnalysis {
  const first = tokens[0]

  if (first === 'select') {
    if (tokens.slice(1).filter((token) => token === 'select').length > 0) {
      return emptyAnalysis('unsupported', 'Subqueries are outside the current route model.')
    }
    for (const token of tokens) {
      if (COMPLEX_SELECT.has(token)) {
        return emptyAnalysis('unsupported', `${token.toUpperCase()} is outside the current route model.`)
      }
    }
    if (tokens.includes('or')) {
      return emptyAnalysis('unsupported', 'OR predicates are ambiguous in the current route model.')
    }

    const table = tableAfter(tokens, 'from')
    if (!table) return emptyAnalysis('invalid', 'SELECT must name one table in FROM.')
    const aggregate = tokens.some((token, index) =>
      AGGREGATES.has(token) && tokens[index + 1] === '(',
    ) || tokens.includes('group')
    if (aggregate) {
      return supported(
        'aggregate',
        table,
        DEMO_TABLES[table]?.tiflashReplica ? 'tiflash_mpp' : 'table_scan',
      )
    }

    const where = tokens.indexOf('where')
    const point = hasCompletePrimaryKeyEquality(tokens, table)
    if (point) return supported('point_read', table, 'point_get')

    return supported('range_read', table, where >= 0 ? 'range_scan' : 'table_scan')
  }

  if (first === 'insert') {
    const table = tableAfter(tokens, 'into')
    if (!table) return emptyAnalysis('invalid', 'Malformed INSERT.')
    if (!supportsSingleRowInsert(tokens, table)) {
      return emptyAnalysis(
        'unsupported',
        'Only one INSERT ... VALUES row with every explicit demo-table primary-key column is modeled.',
      )
    }
    return supported('insert', table, 'kv_write')
  }

  if (first === 'update') {
    const table = tableAfter(tokens, 'update')
    const set = tokens.indexOf('set')
    const where = tokens.indexOf('where')
    if (!table ||
        set < 0 ||
        (where >= 0 &&
          (set >= where - 2 || !tokens.slice(set + 1, where).includes('=')))) {
      return emptyAnalysis('invalid', 'Malformed UPDATE.')
    }
    if (!hasCompletePrimaryKeyEquality(tokens, table)) {
      return emptyAnalysis(
        'unsupported',
        'UPDATE requires literal equality on every known primary-key column.',
      )
    }
    return supported('update', table, 'kv_write')
  }

  if (first === 'delete') {
    const table = tableAfter(tokens, 'from')
    if (!table) return emptyAnalysis('invalid', 'Malformed DELETE.')
    if (!hasCompletePrimaryKeyEquality(tokens, table)) {
      return emptyAnalysis(
        'unsupported',
        'DELETE requires literal equality on every known primary-key column.',
      )
    }
    return supported('delete', table, 'kv_write')
  }

  return emptyAnalysis('unsupported', `${(first ?? 'Empty input').toUpperCase()} is not modeled.`)
}

export function analyzeSql(sql: string): SqlAnalysis {
  if (new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES) {
    return emptyAnalysis('invalid', `SQL exceeds the ${MAX_SQL_BYTES} byte limit.`)
  }

  const lexed = lex(sql)
  if (lexed.error) return emptyAnalysis('invalid', lexed.error)
  if (lexed.tokens.length === 0) return emptyAnalysis('invalid', 'SQL is empty.')

  const semicolons = lexed.tokens
    .map((token, index) => token === ';' ? index : -1)
    .filter((index) => index >= 0)
  if (semicolons.length > 1 ||
      (semicolons.length === 1 && semicolons[0] !== lexed.tokens.length - 1)) {
    return emptyAnalysis('invalid', 'Exactly one SQL statement is allowed.')
  }

  const tokens = lexed.tokens.at(-1) === ';'
    ? lexed.tokens.slice(0, -1)
    : lexed.tokens
  if (tokens.length === 0) return emptyAnalysis('invalid', 'SQL is empty.')

  if (tokens[0] !== 'explain') return classifyBase(tokens)

  const statementAt = tokens.findIndex((token, index) =>
    index > 0 && ['select', 'insert', 'update', 'delete'].includes(token),
  )
  if (statementAt < 0) {
    return emptyAnalysis('unsupported', 'EXPLAIN must wrap a modeled DML statement.')
  }
  if (tokens.slice(1, statementAt).includes('analyze')) {
    return emptyAnalysis(
      'unsupported',
      'EXPLAIN ANALYZE may execute its statement, so the offline model does not accept it.',
    )
  }
  const inner = classifyBase(tokens.slice(statementAt))
  if (inner.status !== 'supported' || inner.kind === 'unknown' || inner.kind === 'explain') {
    return inner
  }

  return {
    ...inner,
    kind: 'explain',
    statementKind: inner.kind,
    readOnly: true,
    warnings: [
      ...inner.warnings,
      'MODEL: this plan is not output from a live TiDB EXPLAIN.',
    ],
    explanation: `Modeled EXPLAIN wrapper: ${inner.explanation}`,
  }
}
