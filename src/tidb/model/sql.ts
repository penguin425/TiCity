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
  SqlAggregateShape,
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
const COMPLEX_SELECT = new Set(['join', 'union', 'intersect', 'except', 'window', 'over'])
const CLAUSES = new Set(['where', 'group', 'having', 'order', 'limit', 'for'])
const IDENTIFIER = /^[a-z_$][a-z0-9_$]*$/i

export const SQL_SUBSET_EXPLANATIONS = Object.freeze({
  singleTable: 'Only one FROM table with an optional alias is modeled.',
  positivePredicate: 'Only positive column/literal comparisons combined with AND are modeled.',
  qualifiers: 'Column qualifiers must refer to the selected table or its alias.',
  aggregate: 'DISTINCT, HAVING, and unsupported aggregate expressions are outside the current route model.',
  scalar: 'Modeled as a scalar aggregate with TiFlash partial aggregation and final aggregation in the TiDB root task.',
  grouped: 'Modeled as a grouped aggregate with TiFlash partial aggregation, HashPartition exchange, and TiFlash final aggregation.',
  lockingRead: 'Locking reads are outside the current route model.',
})

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
    aggregateShape: null,
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

interface TableReference {
  table: string
  database: string | null
  alias: string | null
  end: number
}

function tableReference(
  tokens: readonly string[],
  keyword: string,
  terminators: ReadonlySet<string> = CLAUSES,
): TableReference | null {
  const at = tokens.indexOf(keyword)
  if (at < 0) return null
  let index = at + 1
  const first = tokens[index++]
  if (!first || !IDENTIFIER.test(first)) return null
  let table = first
  let database: string | null = null
  if (tokens[index] === '.') {
    database = first
    table = tokens[index + 1]
    if (!table || !IDENTIFIER.test(table)) return null
    index += 2
  }
  let alias: string | null = null
  if (tokens[index] === 'as') {
    alias = tokens[index + 1]
    if (!alias || !IDENTIFIER.test(alias) || terminators.has(alias)) return null
    index += 2
  } else if (tokens[index] && !terminators.has(tokens[index])) {
    alias = tokens[index++]
    if (!IDENTIFIER.test(alias)) return null
  }
  if (index < tokens.length && !terminators.has(tokens[index])) return null
  return { table, database, alias, end: index }
}

function boundColumn(tokens: readonly string[], reference: TableReference): string | null {
  if (tokens.length === 1 && IDENTIFIER.test(tokens[0])) return tokens[0]
  if (tokens.length === 3 && tokens[1] === '.' &&
      tokens[0] === (reference.alias ?? reference.table) && IDENTIFIER.test(tokens[2])) {
    return tokens[2]
  }
  if (tokens.length === 5 && tokens[1] === '.' && tokens[3] === '.' &&
      !reference.alias && reference.database !== null && tokens[0] === reference.database &&
      tokens[2] === reference.table && IDENTIFIER.test(tokens[4])) return tokens[4]
  return null
}

function hasBoundQualifiers(tokens: readonly string[], reference: TableReference): boolean {
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index + 1] !== '.') continue
    const start = index
    while (tokens[index + 1] === '.') index += 2
    const name = tokens.slice(start, index + 1)
    if (name.at(-1) === '*') {
      // A single-table qualified wildcard does not identify a key predicate.
      if (name.length !== 3 || name[0] !== (reference.alias ?? reference.table)) return false
    } else if (boundColumn(name, reference) === null) return false
  }
  return true
}

interface PredicateComparison {
  column: string
  operator: string
}

function predicateComparisons(
  tokens: readonly string[],
  reference: TableReference,
): readonly PredicateComparison[] | null {
  let cursor = 0
  let nesting = 0
  const comparisons: PredicateComparison[] = []
  const comparison = (): boolean => {
    if (tokens[cursor] === '(') {
      // A classifier need not accept arbitrarily deep boolean syntax. Bound
      // recursive descent independently of the public 64 KiB byte ceiling.
      if (++nesting > 64) return false
      cursor++
      if (!conjunction() || tokens[cursor++] !== ')') return false
      nesting--
      return true
    }
    const start = cursor
    while (cursor < tokens.length && !['and', ')'].includes(tokens[cursor])) cursor++
    const atom = tokens.slice(start, cursor)
    const operatorAt = atom.findIndex((token) => ['=', '<', '>', '<=', '>=', '<>', '!='].includes(token))
    if (operatorAt < 0) return false
    const left = atom.slice(0, operatorAt)
    const right = atom.slice(operatorAt + 1)
    const literal = (part: readonly string[]): boolean => part.length === 1 && part[0] === '?'
    const column = literal(right) ? boundColumn(left, reference)
      : literal(left) ? boundColumn(right, reference) : null
    if (column === null) return false
    comparisons.push({ column, operator: atom[operatorAt] })
    return true
  }
  const conjunction = (): boolean => {
    if (!comparison()) return false
    while (tokens[cursor] === 'and') {
      cursor++
      if (!comparison()) return false
    }
    return true
  }
  if (!conjunction() || cursor !== tokens.length) return null
  return comparisons
}

function whereTokens(tokens: readonly string[]): readonly string[] | null {
  const where = tokens.indexOf('where')
  if (where < 0) return null
  const end = tokens.findIndex((token, index) => index > where && CLAUSES.has(token))
  return tokens.slice(where + 1, end < 0 ? tokens.length : end)
}

function hasCompletePrimaryKeyEquality(
  comparisons: readonly PredicateComparison[] | null,
  table: string,
): boolean {
  const definition = DEMO_TABLES[table]
  return Boolean(definition && comparisons && definition.primaryKey.every((column) =>
    comparisons.some((comparison) => comparison.column === column && comparison.operator === '='),
  ))
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
  const tableEnd = tokens[into + 2] === '.' ? into + 4 : into + 2
  if (columnsOpen !== tableEnd || columnsOpen >= values) return false
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
  aggregateShape: SqlAggregateShape | null,
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
    if (aggregateShape === 'scalar') {
      // TiDB v8.5 MppTiDB: a partial aggregate runs on TiFlash, while the
      // scalar final aggregate runs on the TiDB root, without HashPartition.
      return [{
        id: 'root-scalar-final-aggregate',
        operator: 'HashAgg(Final)',
        task: 'root',
        accessObject: null,
        children: [{
          id: 'root-mpp-gather',
          operator: 'MPPGather',
          task: 'root',
          accessObject: null,
          children: [{
            id: 'mpp-root-passthrough',
            operator: 'ExchangeSender(PassThrough)',
            task: 'mpp[tiflash]',
            accessObject: null,
            children: [{
              id: 'mpp-partial-aggregate',
              operator: 'HashAgg(Partial)',
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
          }],
        }],
      }]
    }
    /*
     * This is a mechanism-shaped teaching plan, not a captured EXPLAIN. Keep
     * the two MPP fragments explicit: scan + partial aggregation feeds a
     * HashPartition exchange, then receiver + final aggregation feeds TiDB
     * through PassThrough root streams.
     */
    return [{
      id: 'root-mpp-gather',
      operator: 'MPPGather',
      task: 'root',
      accessObject: null,
      children: [{
        id: 'mpp-root-passthrough',
        operator: 'ExchangeSender(PassThrough)',
        task: 'mpp[tiflash]',
        accessObject: null,
        children: [{
          id: 'mpp-final-aggregate',
          operator: 'HashAgg(Final)',
          task: 'mpp[tiflash]',
          accessObject: null,
          children: [{
            id: 'mpp-hash-receiver',
            operator: 'ExchangeReceiver(HashPartition)',
            task: 'mpp[tiflash]',
            accessObject: null,
            children: [{
              id: 'mpp-hash-sender',
              operator: 'ExchangeSender(HashPartition)',
              task: 'mpp[tiflash]',
              accessObject: null,
              children: [{
                id: 'mpp-partial-aggregate',
                operator: 'HashAgg(Partial)',
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
            }],
          }],
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
  aggregateShape: SqlAggregateShape | null = null,
): SqlAnalysis {
  return {
    status: 'supported',
    kind,
    statementKind: kind,
    table,
    accessPath,
    aggregateShape,
    readOnly: kind === 'point_read' || kind === 'range_read' || kind === 'aggregate',
    plan: plan(kind, table, accessPath, aggregateShape),
    warnings: [
      'MODEL: the plan and route are educational projections, not output from a TiDB server.',
    ],
    explanation: kind === 'aggregate'
      ? accessPath === 'tiflash_mpp'
        ? aggregateShape === 'scalar'
          ? SQL_SUBSET_EXPLANATIONS.scalar
          : SQL_SUBSET_EXPLANATIONS.grouped
        : 'Modeled as a TiKV table scan with aggregation in the TiDB root task.'
      : kind === 'point_read'
        ? 'Modeled as a key lookup routed to one Region.'
        : kind === 'range_read'
          ? 'Modeled as a distributed range or table scan.'
          : 'Modeled as a transactional KV mutation.',
  }
}

function commaExpressions(tokens: readonly string[]): readonly string[][] | null {
  const expressions: string[][] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === '(') depth++
    else if (tokens[index] === ')') depth--
    else if (tokens[index] === ',' && depth === 0) {
      expressions.push(tokens.slice(start, index))
      start = index + 1
    }
    if (depth < 0) return null
  }
  expressions.push(tokens.slice(start))
  return depth === 0 && expressions.every((expression) => expression.length > 0)
    ? expressions : null
}

function withoutProjectionAlias(tokens: readonly string[]): readonly string[] {
  if (tokens.length >= 3 && tokens.at(-2) === 'as' && IDENTIFIER.test(tokens.at(-1)!)) {
    return tokens.slice(0, -2)
  }
  if (tokens.length >= 2 && IDENTIFIER.test(tokens.at(-1)!) &&
      tokens.at(-2) !== '.') {
    // Only strip an implicit alias when what precedes it is itself a complete
    // column name or aggregate call; arbitrary expressions remain unsupported.
    const candidate = tokens.slice(0, -1)
    if (candidate.at(-1) === ')' || [1, 3, 5].includes(candidate.length)) return candidate
  }
  return tokens
}

function aggregateShape(
  tokens: readonly string[],
  reference: TableReference,
): SqlAggregateShape | null {
  if (tokens.includes('distinct') || tokens.includes('having')) return null
  const from = tokens.indexOf('from')
  const projections = commaExpressions(tokens.slice(1, from))
  if (!projections) return null
  const group = tokens.indexOf('group')
  const groupedColumns = new Set<string>()
  if (group >= 0) {
    if (tokens[group + 1] !== 'by') return null
    const end = tokens.findIndex((token, index) => index > group && CLAUSES.has(token))
    const expressions = commaExpressions(tokens.slice(group + 2, end < 0 ? tokens.length : end))
    if (!expressions) return null
    for (const expression of expressions) {
      const column = boundColumn(expression, reference)
      if (column === null) return null
      groupedColumns.add(column)
    }
  }
  for (const projection of projections) {
    const expression = withoutProjectionAlias(projection)
    if (AGGREGATES.has(expression[0]) && expression[1] === '(' &&
        matchingClose(expression, 1) === expression.length - 1) {
      const argument = expression.slice(2, -1)
      if (argument.length === 1 && argument[0] === '*' && expression[0] === 'count') continue
      if (boundColumn(argument, reference) !== null) continue
      return null
    }
    const column = boundColumn(expression, reference)
    if (column === null || !groupedColumns.has(column)) return null
  }
  return group >= 0 ? 'grouped' : 'scalar'
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
    if (tokens.includes('not') || tokens.includes('or')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (tokens.includes('for')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.lockingRead)
    }

    if (!tokens.includes('from')) return emptyAnalysis('invalid', 'SELECT must name one table in FROM.')
    const reference = tableReference(tokens, 'from')
    if (!reference || tokens.filter((token) => token === 'from').length !== 1) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    }
    const { table } = reference
    const projection = tokens.slice(1, tokens.indexOf('from'))
    if (projection.length === 0) return emptyAnalysis('invalid', 'Malformed SELECT.')
    const predicate = whereTokens(tokens)
    if (!hasBoundQualifiers(projection, reference) ||
        !hasBoundQualifiers(tokens.slice(reference.end), reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.qualifiers)
    }
    const comparisons = predicate ? predicateComparisons(predicate, reference) : null
    if (predicate && comparisons === null) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    const aggregate = tokens.some((token, index) =>
      AGGREGATES.has(token) && tokens[index + 1] === '(',
    ) || tokens.includes('group')
    if (aggregate) {
      const shape = aggregateShape(tokens, reference)
      if (shape === null) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.aggregate)
      return supported(
        'aggregate',
        table,
        DEMO_TABLES[table]?.tiflashReplica ? 'tiflash_mpp' : 'table_scan',
        shape,
      )
    }
    if (tokens.includes('distinct') || tokens.includes('having')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.aggregate)
    }
    const point = hasCompletePrimaryKeyEquality(comparisons, table)
    if (point) return supported('point_read', table, 'point_get')

    return supported('range_read', table, predicate ? 'range_scan' : 'table_scan')
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
    const reference = tableReference(tokens, 'update', new Set(['set']))
    const set = tokens.indexOf('set')
    const where = tokens.indexOf('where')
    if (set < 0 || (where >= 0 &&
        (set >= where - 2 || !tokens.slice(set + 1, where).includes('=')))) {
      return emptyAnalysis('invalid', 'Malformed UPDATE.')
    }
    if (!reference) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    const predicate = whereTokens(tokens)
    const assignments = tokens.slice(set + 1, where < 0 ? tokens.length : where)
    if (!hasBoundQualifiers(assignments, reference) ||
        !hasBoundQualifiers(tokens.slice(reference.end), reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.qualifiers)
    }
    const comparisons = predicate ? predicateComparisons(predicate, reference) : null
    if (predicate && comparisons === null) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (!hasCompletePrimaryKeyEquality(comparisons, reference.table)) {
      return emptyAnalysis(
        'unsupported',
        'UPDATE requires literal equality on every known primary-key column.',
      )
    }
    return supported('update', reference.table, 'kv_write')
  }

  if (first === 'delete') {
    if (tokens[1] !== 'from') return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    const reference = tableReference(tokens, 'from')
    if (!reference) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    const predicate = whereTokens(tokens)
    if (!hasBoundQualifiers(tokens.slice(reference.end), reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.qualifiers)
    }
    const comparisons = predicate ? predicateComparisons(predicate, reference) : null
    if (predicate && comparisons === null) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (!hasCompletePrimaryKeyEquality(comparisons, reference.table)) {
      return emptyAnalysis(
        'unsupported',
        'DELETE requires literal equality on every known primary-key column.',
      )
    }
    return supported('delete', reference.table, 'kv_write')
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
