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
  SqlPredicateShape,
  SqlQueryKind,
  SqlStatus,
} from './types'

export const MAX_SQL_BYTES = 64 * 1024

interface LexResult {
  tokens: string[]
  error: string | null
  unsupported?: boolean
}

interface DemoTable {
  primaryKey: readonly string[]
  primaryKeyType: 'integer' | 'string'
  tiflashReplica: boolean
}

/* The classifier may only claim Point_Get or a bounded write when it knows the
   demo schema. All demo primary keys are modeled clustered row handles;
   foreign keys and secondary indexes are intentionally absent from this map. */
const DEMO_TABLES: Readonly<Record<string, DemoTable>> = Object.freeze({
  accounts: { primaryKey: ['id'], primaryKeyType: 'integer', tiflashReplica: false },
  orders: { primaryKey: ['id'], primaryKeyType: 'integer', tiflashReplica: false },
  order_items: { primaryKey: ['order_id', 'item_id'], primaryKeyType: 'integer', tiflashReplica: false },
  events: { primaryKey: ['id'], primaryKeyType: 'integer', tiflashReplica: true },
  inventory: { primaryKey: ['sku'], primaryKeyType: 'string', tiflashReplica: false },
})
const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max'])
const COMPLEX_SELECT = new Set(['join', 'union', 'intersect', 'except', 'window', 'over'])
const CLAUSES = new Set(['where', 'group', 'having', 'order', 'limit', 'for'])
const IDENTIFIER = /^[a-z_$][a-z0-9_$]*$/i
// Internal marker for quoted names and names protected from keyword scanning
// by qualified-identifier context. It never leaves the local lexer/classifier.
const IDENTIFIER_MARKER = '\u0001'
const SQL_SPACE = /[\t\n\v\f\r ]/
/* TiDB v8.5.0 parser.y:79–311 ReservedKeyword token block (232), plus
 * misc.go:982–986 reserved aliases SCHEMA, SCHEMAS and DEC. Identifier accepts
 * UnReservedKeyword/NotKeywordToken/TiDBKeyword (parser.y:6729–6733), so those
 * must not be denied indiscriminately. This is lexical data, not an SQL parser.
 * Source: d13e52ed6e22cc5789bed7c64c861578cd2ed55b. */
export const TIDB_RESERVED_KEYWORDS: readonly string[] = Object.freeze(`
add all alter analyze and array as asc between bigint
binary blob both by call cascade case change char character
check collate column constraint continue convert create cross cume_dist current_date
current_role current_time current_timestamp current_user cursor database databases day_hour day_microsecond day_minute
day_second dec decimal default delayed delete dense_rank desc describe distinct
distinctrow div double drop dual else elseif enclosed escaped except
exists exit explain false fetch first_value float float4 float8 for
force foreign from fulltext generated grant group groups having high_priority
hour_microsecond hour_minute hour_second if ignore ilike in index infile inner
inout insert int int1 int2 int3 int4 int8 integer intersect
interval into is iterate join key keys kill lag last_value
lead leading leave left like limit linear lines load localtime
localtimestamp lock long longblob longtext low_priority match maxvalue mediumblob mediumint
mediumtext middleint minute_microsecond minute_second mod natural no_write_to_binlog not nth_value ntile
null numeric of on optimize option optionally or order out
outer outfile over partition percent_rank precision primary procedure range rank
read real recursive references regexp release rename repeat replace require
restrict revoke right rlike row row_number rows schema schemas second_microsecond
select set show smallint spatial sql sql_big_result sql_calc_found_rows sql_small_result sqlexception
sqlstate sqlwarning ssl starting stored straight_join table tablesample terminated then
tidb_current_tso tinyblob tinyint tinytext to trailing trigger true union unique
unlock unsigned until update usage use using utc_date utc_time utc_timestamp
values varbinary varchar varcharacter varying virtual when where while window
with write xor year_month zerofill
`.trim().split(/\s+/))
const RESERVED_KEYWORDS = new Set(TIDB_RESERVED_KEYWORDS)
const SELECT_OPTIONS = new Set([
  'all', 'distinct', 'distinctrow', 'high_priority', 'low_priority', 'delayed',
  'sql_big_result', 'sql_small_result', 'sql_buffer_result', 'sql_calc_found_rows',
  'sql_cache', 'sql_no_cache', 'straight_join',
])
/* parser.y:8093–8106 lists the bare optional-parentheses/precision builtins.
 * Quoted or qualified spellings are identifiers; unquoted bare expressions
 * require function evaluation that the offline subset does not implement. */
export const TIDB_BARE_BUILTINS: readonly string[] = Object.freeze([
  'current_user', 'current_date', 'current_role', 'utc_date', 'tidb_current_tso',
  'current_time', 'current_timestamp', 'localtime', 'localtimestamp', 'utc_time', 'utc_timestamp',
])
const BARE_BUILTINS = new Set(TIDB_BARE_BUILTINS)

export const SQL_SUBSET_EXPLANATIONS = Object.freeze({
  singleTable: 'Only one FROM table with an optional alias is modeled.',
  positivePredicate: 'Only positive column/literal comparisons combined with AND are modeled.',
  qualifiers: 'Column qualifiers must refer to the selected table or its alias.',
  aggregate: 'DISTINCT, HAVING, and unsupported aggregate expressions are outside the current route model.',
  scalar: 'Modeled as a scalar aggregate with TiFlash partial aggregation and final aggregation in the TiDB root task.',
  grouped: 'Modeled as a grouped aggregate with TiFlash partial aggregation, HashPartition exchange, and TiFlash final aggregation.',
  lockingRead: 'Locking reads are outside the current route model.',
  comments: 'Executable comments and optimizer hints are outside the current route model.',
  schema: 'Only the built-in demo tables in the demo schema are modeled.',
  projection: 'Only column, wildcard, and simple aggregate projections are modeled.',
  clauses: 'ORDER BY, LIMIT, and extra statement clauses are outside the current route model.',
  assignment: 'Only simple non-primary-key UPDATE assignments are modeled.',
  explain: 'Only plain EXPLAIN around one supported DML statement is modeled.',
  primaryKeyType: 'Primary-key literals must match the demo integer or string key type without coercion.',
})

function identifierValue(token: string | undefined): string | null {
  if (!token) return null
  const protectedIdentifier = token.startsWith(IDENTIFIER_MARKER)
  const value = protectedIdentifier ? token.slice(IDENTIFIER_MARKER.length) : token
  if (protectedIdentifier) return value.length > 0 && !value.includes('\u0000') ? value : null
  return IDENTIFIER.test(value) && !RESERVED_KEYWORDS.has(value) && !BARE_BUILTINS.has(value) ? value : null
}

function isLiteral(tokens: readonly string[]): boolean {
  return tokens.length === 1 && ['?s', '?i', '?imin', '?n', '?h', '?b', 'true', 'false'].includes(tokens[0]) ||
    tokens.length === 2 && ['+', '-'].includes(tokens[0]) && ['?i', '?imin', '?n'].includes(tokens[1])
}

function lex(sql: string): LexResult {
  const tokens: string[] = []
  let index = 0
  const invalid = (error: string): LexResult => ({ tokens: [], error })

  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]
    if (SQL_SPACE.test(char)) { index++; continue }
    // TiDB scanner startWithDash requires whitespace (or EOF) after --.
    if ((char === '-' && next === '-' &&
        (sql[index + 2] === undefined || SQL_SPACE.test(sql[index + 2]))) || char === '#') {
      index += char === '#' ? 1 : 2
      while (index < sql.length && sql[index] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      if (sql[index + 2] === '!' || sql[index + 2] === '+' ||
          sql.slice(index + 2, index + 4) === 'T!') {
        return { tokens: [], error: SQL_SUBSET_EXPLANATIONS.comments, unsupported: true }
      }
      // C comments do not nest in TiDB. Stop at the first closing delimiter.
      const close = sql.indexOf('*/', index + 2)
      if (close < 0) return invalid('Unterminated block comment.')
      index = close + 2
      continue
    }
    if (char === "'" || char === '"') {
      const quote = char
      let closed = false
      index++
      while (index < sql.length) {
        if (sql[index] === '\\') { index += 2; continue }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) { index += 2; continue }
          index++
          closed = true
          break
        }
        index++
      }
      if (!closed) return invalid('Unterminated string literal.')
      tokens.push('?s')
      continue
    }
    if (char === '`') {
      let identifier = ''
      let closed = false
      index++
      while (index < sql.length) {
        if (sql[index] === '`') {
          if (sql[index + 1] === '`') { identifier += '`'; index += 2; continue }
          index++
          closed = true
          break
        }
        identifier += sql[index++]
      }
      if (!closed) return invalid('Unterminated quoted identifier.')
      if (!identifier) return invalid('Empty quoted identifier.')
      tokens.push(IDENTIFIER_MARKER + identifier.toLowerCase())
      continue
    }
    if (/[0-9]/.test(char) || char === '.' && /[0-9]/.test(next ?? '')) {
      const remaining = sql.slice(index)
      let numeric: string | undefined
      let kind = '?n'
      if (/^0[xX]/.test(remaining)) {
        numeric = remaining.match(/^0[xX][0-9a-fA-F]+/)?.[0]
        kind = '?h'
      } else if (/^0b/.test(remaining)) {
        numeric = remaining.match(/^0b[01]+/)?.[0]
        kind = '?b'
      } else {
        numeric = remaining.match(/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/)?.[0]
      }
      if (!numeric || /[A-Za-z0-9_$]/.test(sql[index + numeric.length] ?? '')) {
        return invalid('Malformed numeric literal or unsupported digit-prefixed identifier.')
      }
      if (kind === '?n' && /^[0-9]+$/.test(numeric)) {
        const magnitude = numeric.replace(/^0+/, '') || '0'
        if (magnitude.length < 19 || magnitude.length === 19 && magnitude <= '9223372036854775807') kind = '?i'
        else if (magnitude === '9223372036854775808') kind = '?imin'
      }
      index += numeric.length
      tokens.push(kind)
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index++
      const word = sql.slice(start, index).toLowerCase()
      // misc.go:isTokenIdentifier does not keyword-tokenize a name directly
      // before '.', or after '.' with only ASCII spaces between it and the name.
      let qualified = sql[index] === '.'
      for (let previous = start - 1; !qualified && previous >= 0; previous--) {
        if (sql[previous] === ' ') continue
        qualified = sql[previous] === '.'
        break
      }
      tokens.push(qualified ? IDENTIFIER_MARKER + word : word)
      continue
    }
    const pair = `${char}${next ?? ''}`
    if (['<=', '>=', '<>', '!=', ':='].includes(pair)) {
      tokens.push(pair); index += 2; continue
    }
    if ('(),;.*=<>+-/%?'.includes(char)) { tokens.push(char); index++; continue }
    return invalid('Unsupported lexical token.')
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
    predicateShape: 'none',
    readOnly: true,
    plan: [],
    warnings: [],
    explanation,
  }
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
  const first = identifierValue(tokens[index++])
  if (first === null) return null
  let table = first
  let database: string | null = null
  if (tokens[index] === '.') {
    database = first
    const qualified = identifierValue(tokens[index + 1])
    if (qualified === null) return null
    table = qualified
    index += 2
  }
  let alias: string | null = null
  if (tokens[index] === 'as') {
    alias = identifierValue(tokens[index + 1])
    if (alias === null) return null
    index += 2
  } else if (tokens[index] && !terminators.has(tokens[index])) {
    alias = identifierValue(tokens[index++])
    if (alias === null) return null
  }
  if (index < tokens.length && !terminators.has(tokens[index])) return null
  return { table, database, alias, end: index }
}

function knownTable(reference: TableReference): boolean {
  return (reference.database === null || reference.database === 'demo') &&
    Object.hasOwn(DEMO_TABLES, reference.table)
}

function boundColumn(tokens: readonly string[], reference: TableReference): string | null {
  if (tokens.length === 1) return identifierValue(tokens[0])
  if (tokens.length === 3 && tokens[1] === '.' &&
      identifierValue(tokens[0]) === (reference.alias ?? reference.table)) {
    return identifierValue(tokens[2])
  }
  if (tokens.length === 5 && tokens[1] === '.' && tokens[3] === '.' &&
      !reference.alias && reference.database !== null && identifierValue(tokens[0]) === reference.database &&
      identifierValue(tokens[2]) === reference.table) return identifierValue(tokens[4])
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
      if (boundColumn([...name.slice(0, -1), '_model_column'], reference) === null) return false
    } else if (boundColumn(name, reference) === null) return false
  }
  return true
}

interface PredicateComparison {
  column: string
  operator: string
  literal: readonly string[]
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
    const column = isLiteral(right) ? boundColumn(left, reference)
      : isLiteral(left) ? boundColumn(right, reference) : null
    if (column === null) return false
    comparisons.push({ column, operator: atom[operatorAt], literal: isLiteral(right) ? right : left })
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

function compatiblePrimaryKeyLiteral(literal: readonly string[], definition: DemoTable): boolean {
  if (definition.primaryKeyType === 'string') return literal.length === 1 && literal[0] === '?s'
  return literal.length === 1 && literal[0] === '?i' ||
    literal.length === 2 && literal[0] === '+' && literal[1] === '?i' ||
    literal.length === 2 && literal[0] === '-' && ['?i', '?imin'].includes(literal[1])
}

function compatibleKeyComparisons(comparisons: readonly PredicateComparison[] | null, table: string): boolean {
  const definition = DEMO_TABLES[table]
  return !comparisons || comparisons.every((comparison) =>
    !definition.primaryKey.includes(comparison.column) || compatiblePrimaryKeyLiteral(comparison.literal, definition),
  )
}

function predicateShape(comparisons: readonly PredicateComparison[] | null, table: string): SqlPredicateShape {
  if (!comparisons) return 'none'
  const key = DEMO_TABLES[table].primaryKey
  if (hasCompletePrimaryKeyEquality(comparisons, table)) {
    return comparisons.some((comparison) => !key.includes(comparison.column))
      ? 'primary_key_with_residual' : 'primary_key_equality'
  }
  // The demo profile has clustered row-handle keys. A composite access range
  // uses leading equalities, then at most one ranged key column. Constraints
  // on suffix columns after that range remain residual filters.
  const accessColumns = new Set<string>()
  for (const column of key) {
    const comparison = comparisons.find((comparison) => comparison.column === column)
    if (!comparison) break
    accessColumns.add(column)
    if (comparison.operator !== '=') break
  }
  if (accessColumns.size === 0) return 'scan_predicate'
  return comparisons.some((comparison) => !accessColumns.has(comparison.column))
    ? 'primary_range_with_residual' : 'primary_range'
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
    const column = identifierValue(tokens[index])
    if (column === null || columns.includes(column)) return null
    columns.push(column)
  }
  return columns
}

function parseSingleValuesRow(tokens: readonly string[]): readonly (readonly string[])[] | null {
  const expressions = commaExpressions(tokens)
  if (!expressions || !expressions.every((expression) => isLiteral(expression) ||
      expression.length === 1 && ['null', 'default'].includes(expression[0]))) return null
  return expressions
}

function singleRowInsertStatus(tokens: readonly string[], table: string): 'supported' | 'shape' | 'key_type' {
  const definition = DEMO_TABLES[table]
  const into = tokens.indexOf('into')
  const values = tokens.indexOf('values')
  if (!definition || into < 0 || values < 0 || values <= into) return 'shape'

  const columnsOpen = tokens.indexOf('(', into + 1)
  const tableEnd = tokens[into + 2] === '.' ? into + 4 : into + 2
  if (columnsOpen !== tableEnd || columnsOpen >= values) return 'shape'
  const columnsClose = matchingClose(tokens, columnsOpen)
  if (columnsClose < 0 || columnsClose + 1 !== values) return 'shape'
  const columns = parseIdentifierList(tokens.slice(columnsOpen + 1, columnsClose))
  if (!columns || !definition.primaryKey.every((column) => columns.includes(column))) {
    return 'shape'
  }

  const valuesOpen = tokens[values + 1] === '(' ? values + 1 : -1
  const valuesClose = valuesOpen < 0 ? -1 : matchingClose(tokens, valuesOpen)
  if (valuesClose < 0 || valuesClose !== tokens.length - 1) return 'shape'
  const row = parseSingleValuesRow(tokens.slice(valuesOpen + 1, valuesClose))
  if (!row || row.length !== columns.length) return 'shape'
  return definition.primaryKey.every((column) => compatiblePrimaryKeyLiteral(row[columns.indexOf(column)], definition))
    ? 'supported' : 'key_type'
}

function plan(
  kind: Exclude<SqlQueryKind, 'explain' | 'unknown'>,
  table: string,
  path: SqlAccessPath,
  aggregateShape: SqlAggregateShape | null,
  predicate: SqlPredicateShape,
): ModelPlanNode[] {
  const accessObject = `table:${table}`
  const primaryRange = ['primary_range', 'primary_range_with_residual',
    'primary_key_equality', 'primary_key_with_residual'].includes(predicate)
  const scan = (id: string, task: ModelPlanNode['task']): ModelPlanNode => {
    const keyRange = task === 'cop[tikv]' && primaryRange
    const leaf: ModelPlanNode = {
      id, operator: keyRange ? 'TableRangeScan' : 'TableFullScan', task, accessObject, children: [],
    }
    const selection = task === 'mpp[tiflash]' ? predicate !== 'none'
      : ['scan_predicate', 'primary_range_with_residual', 'primary_key_with_residual'].includes(predicate)
    return selection ? {
      id: `${id}-selection`, operator: 'Selection', task, accessObject: null, children: [leaf],
    } : leaf
  }

  if (kind === 'aggregate') {
    if (path !== 'tiflash_mpp') {
      return [{
        id: 'root-aggregate',
        operator: 'HashAgg',
        task: 'root',
        accessObject: null,
        children: [scan('tikv-aggregate-scan', 'cop[tikv]')],
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
              children: [scan('tiflash-scan', 'mpp[tiflash]')],
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
                children: [scan('tiflash-scan', 'mpp[tiflash]')],
              }],
            }],
          }],
        }],
      }],
    }]
  }

  if (kind === 'point_read' || kind === 'range_read') {
    const access: ModelPlanNode = {
      id: 'tikv-access',
      operator: path === 'point_get' ? 'Point_Get' : primaryRange ? 'TableRangeScan' : 'TableFullScan',
      task: path === 'point_get' ? 'root' : 'cop[tikv]',
      accessObject,
      children: [],
    }
    // The fixture declares primary keys, not secondary indexes. A predicate
    // must not invent IndexRangeScan on account_id/created_at. The conservative
    // scan projection keeps its Selection explicitly; it is not a cost choice.
    const input: ModelPlanNode = ['scan_predicate', 'primary_range_with_residual',
      'primary_key_with_residual'].includes(predicate) ? {
      id: 'tikv-selection',
      operator: 'Selection',
      task: path === 'point_get' ? 'root' : 'cop[tikv]',
      accessObject: null,
      children: [access],
    } : access
    return [{
      id: 'root-projection',
      operator: 'Projection',
      task: 'root',
      accessObject: null,
      children: [input],
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
      task: 'kv[tikv]',
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
  predicate: SqlPredicateShape = 'none',
): SqlAnalysis {
  return {
    status: 'supported',
    kind,
    statementKind: kind,
    table,
    accessPath,
    aggregateShape,
    predicateShape: predicate,
    readOnly: kind === 'point_read' || kind === 'range_read' || kind === 'aggregate',
    plan: plan(kind, table, accessPath, aggregateShape, predicate),
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
  if (tokens.length >= 3 && tokens.at(-2) === 'as' && identifierValue(tokens.at(-1)) !== null) {
    return tokens.slice(0, -2)
  }
  if (tokens.length >= 2 && identifierValue(tokens.at(-1)) !== null &&
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

function wildcard(tokens: readonly string[], reference: TableReference): boolean {
  return tokens.length === 1 && tokens[0] === '*' ||
    tokens.at(-1) === '*' && boundColumn([...tokens.slice(0, -1), '_model_column'], reference) !== null
}

function supportedProjection(tokens: readonly string[], reference: TableReference): boolean {
  const expressions = commaExpressions(tokens)
  return expressions !== null && expressions.every((expression) =>
    wildcard(expression, reference) || boundColumn(withoutProjectionAlias(expression), reference) !== null,
  )
}

function simpleValue(tokens: readonly string[], reference: TableReference): boolean {
  let expression = tokens
  let nesting = 0
  while (expression[0] === '(' && matchingClose(expression, 0) === expression.length - 1) {
    if (++nesting > 64) return false
    expression = expression.slice(1, -1)
  }
  return isLiteral(expression) || boundColumn(expression, reference) !== null ||
    expression.length === 1 && ['null', 'default'].includes(expression[0])
}

function supportedAssignments(tokens: readonly string[], reference: TableReference): boolean {
  const assignments = commaExpressions(tokens)
  if (!assignments) return false
  const assigned = new Set<string>()
  for (const assignment of assignments) {
    const equals = assignment.findIndex((token) => token === '=' || token === ':=')
    const column = boundColumn(assignment.slice(0, equals), reference)
    if (equals < 0 || column === null || assigned.has(column) ||
        DEMO_TABLES[reference.table].primaryKey.includes(column)) return false
    assigned.add(column)
    const value = assignment.slice(equals + 1)
    if (simpleValue(value, reference)) continue
    let depth = 0
    let binary = -1
    for (let index = 0; index < value.length; index++) {
      if (value[index] === '(') depth++
      else if (value[index] === ')') depth--
      else if (depth === 0 && index > 0 && ['+', '-', '*', '/', '%'].includes(value[index]) &&
          !['+', '-', '*', '/', '%', '('].includes(value[index - 1])) {
        if (binary >= 0) { binary = -1; break }
        binary = index
      }
    }
    if (binary < 0 || value.includes('default') || !simpleValue(value.slice(0, binary), reference) ||
        !simpleValue(value.slice(binary + 1), reference)) return false
  }
  return true
}

function repeatedPrimaryKey(comparisons: readonly PredicateComparison[] | null, table: string): boolean {
  return Boolean(comparisons && DEMO_TABLES[table].primaryKey.some((column) =>
    comparisons.filter((comparison) => comparison.column === column).length > 1,
  ))
}

function hasExtraClauses(tokens: readonly string[], allowed: ReadonlySet<string>): boolean {
  return tokens.some((token) => CLAUSES.has(token) && !allowed.has(token)) ||
    [...allowed].some((clause) => tokens.filter((token) => token === clause).length > 1)
}

function classifyBase(tokens: readonly string[]): SqlAnalysis {
  const first = tokens[0]
  const dml = ['select', 'insert', 'update', 'delete'].includes(first)
  if (dml && tokens.slice(1).some((token) => ['select', 'insert', 'update', 'delete'].includes(token))) {
    return emptyAnalysis('unsupported', 'Subqueries and nested DML are outside the current route model.')
  }

  if (first === 'select') {
    for (const token of tokens) {
      if (COMPLEX_SELECT.has(token)) {
        return emptyAnalysis('unsupported', `${token.toUpperCase()} is outside the current route model.`)
      }
    }
    if (tokens.includes('not') || tokens.includes('or')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (tokens.includes('for') || tokens.includes('lock')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.lockingRead)
    }
    if (hasExtraClauses(tokens, new Set(['where', 'group'])) || tokens.includes('into')) {
      // Sort/TopN/Limit and SELECT INTO have no mechanism in this route model.
      // Reject them rather than silently removing an operator or side effect.
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.clauses)
    }
    if (!tokens.includes('from')) return emptyAnalysis('invalid', 'SELECT must name one table in FROM.')
    const reference = tableReference(tokens, 'from')
    if (!reference || tokens.filter((token) => token === 'from').length !== 1) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    }
    if (!knownTable(reference)) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.schema)
    const { table } = reference
    const projection = tokens.slice(1, tokens.indexOf('from'))
    if (SELECT_OPTIONS.has(projection[0])) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.projection)
    }
    if (projection.length === 0) return emptyAnalysis('invalid', 'Malformed SELECT.')
    if (!hasBoundQualifiers(projection, reference) ||
        !hasBoundQualifiers(tokens.slice(reference.end), reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.qualifiers)
    }
    const where = tokens.indexOf('where')
    const group = tokens.indexOf('group')
    if (where >= 0 && group >= 0 && where > group) {
      return emptyAnalysis('invalid', 'Malformed statement clause order.')
    }
    const predicate = whereTokens(tokens)
    const comparisons = predicate ? predicateComparisons(predicate, reference) : null
    if (predicate && (comparisons === null || repeatedPrimaryKey(comparisons, table))) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (!compatibleKeyComparisons(comparisons, table)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.primaryKeyType)
    }
    const predicateClass = predicateShape(comparisons, table)
    const aggregate = projection.some((token, index) => AGGREGATES.has(token) && projection[index + 1] === '(') || group >= 0
    if (aggregate) {
      const shape = aggregateShape(tokens, reference)
      if (shape === null) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.aggregate)
      return supported('aggregate', table, DEMO_TABLES[table].tiflashReplica ? 'tiflash_mpp' : 'table_scan', shape, predicateClass)
    }
    if (tokens.includes('distinct') || tokens.includes('having')) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.aggregate)
    }
    if (!supportedProjection(projection, reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.projection)
    }
    const point = hasCompletePrimaryKeyEquality(comparisons, table)
    return point ? supported('point_read', table, 'point_get', null, predicateClass)
      : supported('range_read', table, predicate ? 'range_scan' : 'table_scan', null, predicateClass)
  }

  if (first === 'insert') {
    if (tokens[1] !== 'into') return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.clauses)
    const reference = tableReference(tokens, 'into', new Set(['(']))
    if (!reference) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    if (!knownTable(reference)) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.schema)
    const insertStatus = singleRowInsertStatus(tokens, reference.table)
    if (insertStatus !== 'supported') {
      return emptyAnalysis('unsupported', insertStatus === 'key_type'
        ? SQL_SUBSET_EXPLANATIONS.primaryKeyType
        : 'Only one INSERT ... VALUES row with every explicit demo-table primary-key column is modeled.')
    }
    return supported('insert', reference.table, 'kv_write')
  }

  if (first === 'update' || first === 'delete') {
    if (hasExtraClauses(tokens, new Set(['where']))) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.clauses)
    }
    if (first === 'delete' && tokens[1] !== 'from') {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    }
    const reference = tableReference(tokens, first === 'update' ? 'update' : 'from',
      first === 'update' ? new Set(['set']) : CLAUSES)
    if (!reference) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.singleTable)
    if (!knownTable(reference)) return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.schema)
    if (!hasBoundQualifiers(tokens.slice(reference.end), reference)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.qualifiers)
    }
    const where = tokens.indexOf('where')
    if (first === 'update') {
      const set = tokens.indexOf('set')
      if (set < 0 || where >= 0 && set > where || tokens.filter((token) => token === 'set').length !== 1) {
        return emptyAnalysis('invalid', 'Malformed UPDATE.')
      }
      if (!supportedAssignments(tokens.slice(set + 1, where < 0 ? tokens.length : where), reference)) {
        return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.assignment)
      }
    }
    const predicate = whereTokens(tokens)
    const comparisons = predicate ? predicateComparisons(predicate, reference) : null
    if (predicate && (comparisons === null || repeatedPrimaryKey(comparisons, reference.table))) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.positivePredicate)
    }
    if (!compatibleKeyComparisons(comparisons, reference.table)) {
      return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.primaryKeyType)
    }
    if (!hasCompletePrimaryKeyEquality(comparisons, reference.table)) {
      return emptyAnalysis('unsupported', `${first.toUpperCase()} requires literal equality on every known primary-key column.`)
    }
    return supported(first, reference.table, 'kv_write', null, predicateShape(comparisons, reference.table))
  }
  return emptyAnalysis('unsupported', 'This statement kind is outside the current route model.')
}

export function analyzeSql(sql: string): SqlAnalysis {
  // UTF-8 needs at least one byte per UTF-16 code unit. Reject oversized
  // strings before allocating an encoded copy of arbitrary API input.
  if (sql.length > MAX_SQL_BYTES || new TextEncoder().encode(sql).byteLength > MAX_SQL_BYTES) {
    return emptyAnalysis('invalid', `SQL exceeds the ${MAX_SQL_BYTES} byte limit.`)
  }

  const lexed = lex(sql)
  if (lexed.error) return emptyAnalysis(lexed.unsupported ? 'unsupported' : 'invalid', lexed.error)
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

  if (tokens[1] === 'analyze' || tokens.slice(1, 5).includes('analyze')) {
    return emptyAnalysis('unsupported',
      'EXPLAIN ANALYZE may execute its statement, so the offline model does not accept it.')
  }
  if (!['select', 'insert', 'update', 'delete'].includes(tokens[1])) {
    return emptyAnalysis('unsupported', SQL_SUBSET_EXPLANATIONS.explain)
  }
  const statementAt = 1
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
