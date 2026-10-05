import { describe, expect, it, vi } from 'vitest'

import {
  analyzeSql,
  MAX_SQL_BYTES,
  SQL_SUBSET_EXPLANATIONS,
  TIDB_BARE_BUILTINS,
  TIDB_RESERVED_KEYWORDS,
} from './sql'
import { TIDB_SCENARIOS } from './scenarios'

describe('conservative TiDB SQL classifier', () => {
  it.each([
    ['SELECT * FROM accounts WHERE id = 42', 'point_read', 'point_get'],
    ['SELECT * FROM orders WHERE created_at >= "2026-01-01"', 'range_read', 'range_scan'],
    ['SELECT count(*) FROM events GROUP BY account_id', 'aggregate', 'tiflash_mpp'],
    ['INSERT INTO inventory (sku, stock) VALUES ("A-1", 3)', 'insert', 'kv_write'],
    ['UPDATE accounts SET balance = balance + 1 WHERE id = 7', 'update', 'kv_write'],
    ['DELETE FROM events WHERE id = 9', 'delete', 'kv_write'],
  ] as const)('classifies %s', (sql, kind, accessPath) => {
    const result = analyzeSql(sql)

    expect(result.status).toBe('supported')
    expect(result.kind).toBe(kind)
    expect(result.accessPath).toBe(accessPath)
    expect(result).not.toHaveProperty('rows')
  })

  it('models plain EXPLAIN but rejects EXPLAIN ANALYZE because it can execute SQL', () => {
    const result = analyzeSql('EXPLAIN SELECT * FROM accounts WHERE id = 1')

    expect(result.status).toBe('supported')
    expect(result.kind).toBe('explain')
    expect(result.statementKind).toBe('point_read')
    expect(result.warnings.join(' ')).toMatch(/model/i)

    const analyze = analyzeSql('EXPLAIN ANALYZE UPDATE accounts SET balance = 0 WHERE id = 1')
    expect(analyze.status).toBe('unsupported')
    expect(analyze.plan).toEqual([])
    expect(analyze.explanation).toMatch(/execute/i)
  })

  it('uses each demo table primary key instead of treating foreign keys as Point_Get', () => {
    const pointGet = analyzeSql('SELECT * FROM events WHERE id = 1')
    expect(pointGet.accessPath).toBe('point_get')
    expect(JSON.stringify(pointGet.plan)).toContain('"operator":"Point_Get","task":"root"')
    expect(analyzeSql('SELECT * FROM events WHERE account_id = 1').accessPath)
      .toBe('range_scan')
    expect(analyzeSql('SELECT * FROM orders WHERE order_id = 1').accessPath)
      .toBe('range_scan')
    expect(analyzeSql('SELECT * FROM inventory WHERE sku = "A-1"').accessPath)
      .toBe('point_get')
    expect(analyzeSql(
      'SELECT * FROM order_items WHERE order_id = 1 AND item_id = 2',
    ).accessPath).toBe('point_get')
    expect(analyzeSql('SELECT * FROM order_items WHERE order_id = 1').accessPath)
      .toBe('range_scan')
  })

  it('supports UPDATE and DELETE only with a complete literal primary-key equality', () => {
    for (const sql of [
      'UPDATE accounts SET balance = 0',
      'UPDATE accounts SET balance = 0 WHERE account_id = 1',
      'UPDATE accounts SET balance = 0 WHERE id > 1',
      'UPDATE accounts SET balance = 0 WHERE id = 1 + 2',
      'DELETE FROM events WHERE account_id = 1',
      'DELETE FROM order_items WHERE order_id = 1',
      'UPDATE unknown_table SET value = 1 WHERE id = 1',
    ]) {
      const result = analyzeSql(sql)
      expect(result.status, sql).toBe('unsupported')
      expect(result.plan, sql).toEqual([])
    }

    expect(analyzeSql('UPDATE inventory SET stock = 3 WHERE sku = "A-1"').status)
      .toBe('supported')
    expect(analyzeSql(
      'DELETE FROM order_items WHERE order_id = 1 AND item_id = 2',
    ).status).toBe('supported')
  })

  it('supports one INSERT VALUES row only when every primary-key column is explicit', () => {
    for (const sql of [
      'INSERT INTO events (account_id) VALUES (1)',
      'INSERT INTO events VALUES (1, 2)',
      'INSERT INTO events (id, account_id) VALUES (1, 2), (2, 3)',
      'INSERT INTO events (id, account_id) VALUES (NULL, 2)',
      'INSERT INTO inventory (sku, stock) VALUES (DEFAULT, 2)',
      'INSERT INTO events (id, account_id) VALUES (1 + 2, 3)',
      'INSERT INTO order_items (order_id, quantity) VALUES (1, 3)',
      'INSERT INTO unknown_table (id) VALUES (1)',
    ]) {
      const result = analyzeSql(sql)
      expect(result.status, sql).toBe('unsupported')
      expect(result.plan, sql).toEqual([])
    }

    expect(analyzeSql(
      'INSERT INTO order_items (order_id, item_id, quantity) VALUES (1, 2, 3)',
    ).status).toBe('supported')
  })

  it('uses TiFlash MPP only for the events table replica', () => {
    const tiflash = analyzeSql('SELECT count(*) FROM events')
    const tikv = analyzeSql('SELECT count(*) FROM accounts')
    const tiflashPlan = JSON.stringify(tiflash.plan)

    expect(tiflash.accessPath).toBe('tiflash_mpp')
    expect(tiflash.aggregateShape).toBe('scalar')
    expect(tiflash.plan[0].operator).toBe('HashAgg(Final)')
    expect(tiflash.plan[0].task).toBe('root')
    expect(tiflashPlan).toContain('MPPGather')
    expect(tiflashPlan).toContain('HashAgg(Partial)')
    expect(tiflashPlan).not.toContain('HashPartition')
    expect(tiflashPlan).toContain('HashAgg(Final)')
    expect(tiflashPlan).toContain('ExchangeSender(PassThrough)')
    expect(tikv.aggregateShape).toBe('scalar')
    expect(tikv.accessPath).toBe('table_scan')
    expect(JSON.stringify(tikv.plan)).not.toContain('mpp[tiflash]')
    expect(JSON.stringify(tikv.plan)).toContain('cop[tikv]')
  })

  it.each([
    'SELECT * FROM accounts WHERE NOT (id = 1)',
    'SELECT * FROM accounts WHERE NOT id = 1',
    'DELETE FROM accounts WHERE NOT id = 1',
    'UPDATE accounts SET balance = 0 WHERE id = 1 OR id = 2',
    'SELECT * FROM accounts WHERE (id = 1 AND NOT balance = 0)',
    'SELECT * FROM accounts WHERE id = 1 + 2',
    'SELECT * FROM accounts WHERE id = 1 AND balance = balance',
    'SELECT * FROM accounts a, orders o WHERE a.id = 1',
    'UPDATE accounts a, orders o SET a.balance = 0 WHERE a.id = 1',
    'DELETE accounts FROM accounts, orders WHERE accounts.id = 1',
    'SELECT * FROM accounts WHERE orders.id = 1',
    'SELECT * FROM accounts a WHERE accounts.id = 1',
    'SELECT o.balance FROM accounts a WHERE a.id = 1',
    'SELECT * FROM accounts WHERE id = 425 ORDER BY other.balance',
    'SELECT * FROM accounts a WHERE a.id = 425 ORDER BY accounts.balance',
    'DELETE FROM accounts WHERE id = 425 ORDER BY other.id',
    'UPDATE accounts a SET a.balance = 0 WHERE a.id = 425 ORDER BY accounts.id',
    'SELECT COUNT(*) FROM events ORDER BY other.id',
    'SELECT COUNT(*) OVER () FROM events',
    'SELECT SUM(amount) OVER (PARTITION BY account_id) FROM events',
    'SELECT * FROM accounts WHERE id = 1 FOR UPDATE',
  ])('rejects a route-changing or unbound shape without inventing a plan: %s', (sql) => {
    const result = analyzeSql(sql)
    expect(result.status).toBe('unsupported')
    expect(result.plan).toEqual([])
    expect(result.aggregateShape).toBeNull()
  })

  it.each([
    'SELECT a.id FROM accounts AS a WHERE (a.id = 1 AND a.balance >= 0)',
    'SELECT accounts.* FROM accounts WHERE 1 = accounts.id',
    'SELECT * FROM demo.accounts WHERE demo.accounts.id = 1',
    'SELECT * FROM order_items oi WHERE ((oi.order_id = 1) AND oi.item_id = 2)',
  ])('retains a positive conjunctive single-key read: %s', (sql) => {
    const result = analyzeSql(sql)
    expect(result.status).toBe('supported')
    expect(result.accessPath).toBe('point_get')
    expect(result.aggregateShape).toBeNull()
  })

  it('keeps alias-bound UPDATE/DELETE bounded and incomplete composite predicates as scans', () => {
    expect(analyzeSql('UPDATE accounts AS a SET a.balance = 0 WHERE a.id = 1').status)
      .toBe('supported')
    expect(analyzeSql('DELETE FROM order_items AS oi WHERE oi.order_id = 1 AND oi.item_id = 2').status)
      .toBe('supported')
    expect(analyzeSql('SELECT * FROM order_items oi WHERE oi.order_id = 1 AND oi.item_id > 2').accessPath)
      .toBe('range_scan')
    expect(analyzeSql('UPDATE accounts a SET o.balance = 0 WHERE a.id = 1').status)
      .toBe('unsupported')
    expect(analyzeSql('INSERT INTO accounts, orders (id) VALUES (1)').status)
      .toBe('unsupported')
  })

  it('separates ordinary scalar and grouped aggregate plans, including EXPLAIN', () => {
    const grouped = analyzeSql('SELECT e.account_id, COUNT(*) AS total FROM events e GROUP BY e.account_id')
    expect(grouped.status).toBe('supported')
    expect(grouped.aggregateShape).toBe('grouped')
    const serialized = JSON.stringify(grouped.plan)
    expect(serialized).toContain('ExchangeSender(HashPartition)')
    expect(serialized).toContain('ExchangeReceiver(HashPartition)')
    expect(serialized).toContain('"operator":"HashAgg(Final)","task":"mpp[tiflash]"')

    const scalar = analyzeSql('EXPLAIN SELECT COUNT(*) AS total, SUM(e.amount) FROM events AS e')
    expect(scalar.status).toBe('supported')
    expect(scalar.kind).toBe('explain')
    expect(scalar.statementKind).toBe('aggregate')
    expect(scalar.aggregateShape).toBe('scalar')
    expect(scalar.plan[0]).toMatchObject({ operator: 'HashAgg(Final)', task: 'root' })
    expect(JSON.stringify(scalar.plan)).not.toContain('HashPartition')
  })

  it.each([
    'SELECT COUNT(DISTINCT account_id) FROM events',
    'SELECT DISTINCT account_id FROM events',
    'SELECT SUM(amount + 1) FROM events',
    'SELECT COUNT(*), account_id FROM events',
    'SELECT account_id, COUNT(*) FROM events GROUP BY id',
    'SELECT SUM(*) FROM events',
    'SELECT COUNT(*) FROM events GROUP BY account_id HAVING COUNT(*) > 1',
  ])('keeps unmodeled aggregate shapes unsupported: %s', (sql) => {
    const result = analyzeSql(sql)
    expect(result.status).toBe('unsupported')
    expect(result.plan).toEqual([])
    expect(result.aggregateShape).toBeNull()
  })

  it('allows semicolons inside literals and comments but rejects multiple statements', () => {
    expect(analyzeSql("SELECT * FROM accounts WHERE note = ';' -- ;\n AND id = 1").status)
      .toBe('supported')
    expect(analyzeSql('SELECT * FROM accounts; DELETE FROM accounts').status).toBe('invalid')
    expect(analyzeSql('SELECT * FROM accounts;;').status).toBe('invalid')
  })

  it('rejects excessive predicate nesting without overflowing the input classifier', () => {
    const sql = `SELECT * FROM accounts WHERE ${'('.repeat(2_000)}id = 1${')'.repeat(2_000)}`
    expect(() => analyzeSql(sql)).not.toThrow()
    expect(analyzeSql(sql).status).toBe('unsupported')
  })

  it('rejects malformed, oversized, and unsupported SQL without a fake plan', () => {
    for (const sql of [
      "SELECT * FROM accounts WHERE note = 'unterminated",
      `SELECT * FROM accounts /* ${'x'.repeat(65_536)} */`,
      'CREATE TABLE secrets (id BIGINT)',
      'SELECT * FROM accounts JOIN orders USING (account_id)',
      'UPDATE accounts SET WHERE id = 1',
    ]) {
      const result = analyzeSql(sql)
      expect(result.status).not.toBe('supported')
      expect(result.plan).toEqual([])
    }
  })
})


describe('source-pinned SQL grammar refinements', () => {
  it.each([
    'SELECT * FROM accounts /*! WHERE NOT id = 1 */',
    'SELECT * FROM accounts /*!80000 WHERE NOT id = 1 */',
    'SELECT * FROM accounts /*T! WHERE NOT id = 1 */',
    'SELECT /*+ READ_FROM_STORAGE(tikv[events]) */ COUNT(*) FROM events',
    'INSERT /*+ SET_VAR(tidb_enable_1pc=0) */ INTO events (id) VALUES (1)',
  ])('does not erase executable comments or plan-changing hints: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('unsupported')
    expect(analysis.explanation).toBe(SQL_SUBSET_EXPLANATIONS.comments)
    expect(analysis.plan).toEqual([])
  })

  it('matches TiDB dash-comment and non-nesting C-comment boundaries', () => {
    expect(analyzeSql('SELECT * FROM accounts WHERE id = 1 -- actual comment').accessPath)
      .toBe('point_get')
    expect(analyzeSql('SELECT * FROM accounts WHERE id = 1--2').status).toBe('unsupported')
    expect(analyzeSql('SELECT * FROM accounts /* outer /* nested */ WHERE id = 1 */').status)
      .not.toBe('supported')
    expect(analyzeSql('SELECT * FROM accounts /* ordinary comment */ WHERE id = 1').accessPath)
      .toBe('point_get')
    expect(analyzeSql('SELECT * FROM accounts /* outer /* nested */ WHERE id = 1').accessPath)
      .toBe('point_get')
  })

  it('does not normalize UTF-8 whitespace into a different TiDB token boundary', () => {
    expect(analyzeSql('SELECT * FROM accounts WHERE id\u00a0= 1').status).not.toBe('supported')
    expect(analyzeSql('SELECT * FROM accounts WHERE id = 1--\u00a0hidden').status).not.toBe('supported')
    expect(analyzeSql('SELECT\t*\nFROM accounts\vWHERE id = 1').accessPath).toBe('point_get')
  })

  it.each([
    'SELECT `not`, `over` FROM `accounts` WHERE `id` = 1 AND `not` = 2',
    'SELECT `where`.* FROM `demo`.`accounts` AS `where` WHERE `where`.`id` = 1',
    'SELECT demo.accounts.* FROM demo.accounts WHERE demo.accounts.id = 1',
    'SELECT accounts.id primary_key FROM accounts WHERE id = -1',
    'SELECT * FROM inventory WHERE sku = "contains AND NOT OR OVER ; and id=7"',
    'SELECT `口座名`.* FROM accounts AS `口座名` WHERE `口座名`.id = 1',
    'SELECT `a.b`.id FROM accounts AS `a.b` WHERE `a.b`.id = 1',
    'SELECT `a``b`.id FROM accounts AS `a``b` WHERE `a``b`.id = 1',
  ])('keeps quoted identifiers separate from operators, clauses, and literals: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('supported')
    expect(analysis.accessPath).toBe('point_get')
  })

  it.each([
    'SELECT SUM(balance) FROM accounts WHERE id = 1',
    'SELECT `account_id`, COUNT(*) FROM `events` GROUP BY `account_id`',
    'EXPLAIN SELECT e.account_id, COUNT(e.id) total FROM events e GROUP BY e.account_id',
    'INSERT INTO demo.events (`id`, account_id) VALUES (-425, +7)',
    'UPDATE accounts AS a SET a.balance = a.balance + -1 WHERE a.id = +425',
    'UPDATE inventory SET stock = stock - -1 WHERE sku = "signed update"',
    'UPDATE orders SET status = DEFAULT WHERE id = 1',
    'DELETE FROM demo.order_items WHERE order_id = -1 AND item_id = +2',
  ])('retains the intentionally supported bounded SQL subset: %s', (sql) => {
    expect(analyzeSql(sql).status).toBe('supported')
  })

  it.each([
    'SELECT SLEEP(1) FROM accounts WHERE id = 1',
    'SELECT RAND() FROM accounts WHERE id = 1',
    'SELECT GROUP_CONCAT(balance) FROM accounts',
    'SELECT id + balance FROM accounts WHERE id = 1',
    'SELECT * INTO OUTFILE "private-path" FROM accounts WHERE id = 1',
    'SELECT id, FROM accounts WHERE id = 1',
    'SELECT ,id FROM accounts WHERE id = 1',
    'SELECT (id FROM accounts WHERE id = 1',
    'SELECT id) FROM accounts WHERE id = 1',
    'SELECT id AS FROM accounts WHERE id = 1',
    'SELECT * AS wildcard FROM accounts WHERE id = 1',
    'SELECT COUNT(*) FROM events WHERE id = 1 GROUP BY account_id GROUP BY id',
    'SELECT account_id, COUNT(*) FROM events GROUP BY account_id WHERE id = 1',
    'SELECT * FROM accounts WHERE id = 1 WHERE balance = 2',
    'SELECT * FROM accounts WHERE id = 1 AND id = 2',
    'SELECT * FROM accounts WHERE id = 1 AND id > 2',
    'SELECT * FROM accounts WHERE id = NULL',
    'SELECT * FROM accounts WHERE id = ?',
    'SELECT * FROM accounts WHERE id = 1 ORDER BY id',
    'SELECT * FROM accounts WHERE id = 1 LIMIT 0',
    'SELECT * FROM accounts WHERE id = 1 LIMIT 1 OFFSET 5',
    'SELECT * FROM accounts LIMIT nonsense',
    'SELECT * FROM accounts LOCK IN SHARE MODE',
    'DELETE FROM accounts WHERE id = 1 LIMIT 1',
    'UPDATE accounts SET balance = 0 WHERE id = 1 ORDER BY id',
  ])('does not remove a missing operator, malformed clause, or side effect: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).not.toBe('supported')
    expect(analysis.plan).toEqual([])
  })

  it.each([
    'UPDATE accounts SET id = 99 WHERE id = 1',
    'UPDATE order_items SET item_id = 3 WHERE order_id = 1 AND item_id = 2',
    'UPDATE accounts SET balance = (SELECT balance FROM orders WHERE id = 1) WHERE id = 1',
    'UPDATE accounts SET balance = SLEEP(1) WHERE id = 1',
    'UPDATE accounts SET balance = balance + 1 + 2 WHERE id = 1',
    'UPDATE accounts SET balance = DEFAULT + 1 WHERE id = 1',
    'UPDATE accounts SET balance = 1, balance = 2 WHERE id = 1',
    'UPDATE accounts SET balance = 1, WHERE id = 1',
    'UPDATE accounts SET balance = (1 WHERE id = 1',
    'UPDATE accounts SET balance = WHERE id = 1',
    'UPDATE IGNORE accounts SET balance = 0 WHERE id = 1',
    'INSERT IGNORE INTO events (id) VALUES (1)',
    'INSERT INTO events (id) VALUES (1) ON DUPLICATE KEY UPDATE id = 2',
    'INSERT INTO events (id) VALUES (?)',
  ])('rejects PK relocation, unmodeled assignments, and write modifiers: %s', (sql) => {
    expect(analyzeSql(sql).status).not.toBe('supported')
  })

  it.each([
    'SELECT COUNT(*) FROM production.events',
    'SELECT * FROM unknown_table WHERE id = 1',
    'INSERT INTO production.events (id) VALUES (1)',
    'UPDATE production.accounts SET balance = 0 WHERE id = 1',
    'DELETE FROM production.accounts WHERE id = 1',
    'SELECT * FROM `accounts; DELETE FROM events` WHERE id = 1',
  ])('does not transfer the demo schema or replica claims to an unknown table: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('unsupported')
    expect(analysis.table).toBeNull()
    expect(analysis.plan).toEqual([])
  })

  it.each([
    'EXPLAIN garbage SELECT * FROM accounts WHERE id = 1',
    'EXPLAIN FORMAT="json" SELECT * FROM accounts WHERE id = 1',
    'EXPLAIN FOR CONNECTION 42',
    'EXPLAIN (SELECT * FROM accounts WHERE id = 1)',
    'EXPLAIN SELECT * FROM accounts WHERE id = 1; DELETE FROM accounts WHERE id = 1',
  ])('requires an exact supported EXPLAIN wrapper: %s', (sql) => {
    expect(analyzeSql(sql).status).not.toBe('supported')
  })

  it.each(['0x', '0x123G', '0b', '0b102', '1e', '1e+', '1identifier'])('does not turn %s into a literal', (literal) => {
    expect(analyzeSql(`SELECT * FROM accounts WHERE id = ${literal}`).status).not.toBe('supported')
  })

  it.each(['-425', '+425'])('recognizes a literal shape without retaining %s', (literal) => {
    const analysis = analyzeSql(`SELECT * FROM accounts WHERE id = ${literal}`)
    expect(analysis.status).toBe('supported')
    expect(analysis.accessPath).toBe('point_get')
    expect(analysis).not.toHaveProperty('literal')
    expect(analysis).not.toHaveProperty('sql')
  })

  it.each(['.5', '1.', '1e-3', '0x1a', '0b101'])('keeps non-key numeric literal syntax available without asserting a key conversion: %s', (literal) => {
    const analysis = analyzeSql(`SELECT * FROM accounts WHERE balance = ${literal}`)
    expect(analysis.status).toBe('supported')
    expect(analysis.accessPath).toBe('range_scan')
    expect(analysis.predicateShape).toBe('scan_predicate')
  })

  it.each([
    'SELECT * FROM accounts WHERE id = "425"',
    'SELECT * FROM accounts WHERE id = 1.5',
    'SELECT * FROM accounts WHERE id = 1e0',
    'SELECT * FROM accounts WHERE id = true',
    'SELECT * FROM accounts WHERE id = 0x1a',
    'SELECT * FROM accounts WHERE id = 9223372036854775808',
    'SELECT * FROM accounts WHERE id = -9223372036854775809',
    'SELECT * FROM inventory WHERE sku = 7',
    'UPDATE accounts SET balance = 0 WHERE id = "not-an-integer"',
    'UPDATE inventory SET stock = 0 WHERE sku = 7',
    'INSERT INTO events (id) VALUES (9223372036854775808)',
    'INSERT INTO events (id) VALUES (false)',
    'INSERT INTO inventory (sku) VALUES (425)',
  ])('rejects lossy or unmodeled demo-key conversion: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('unsupported')
    expect(analysis.explanation).toBe(SQL_SUBSET_EXPLANATIONS.primaryKeyType)
    expect(analysis.plan).toEqual([])
  })

  it.each(['9223372036854775807', '-9223372036854775808', '000000425', '+000425'])('supports a signed int64 demo key without overflow: %s', (literal) => {
    expect(analyzeSql(`SELECT * FROM accounts WHERE id = ${literal}`).accessPath).toBe('point_get')
    expect(analyzeSql(`INSERT INTO events (id) VALUES (${literal})`).status).toBe('supported')
  })

  it('preserves primary equality, residual filtering, and scan predicates as literal-free shape', () => {
    const primary = analyzeSql('SELECT * FROM accounts WHERE id = 1')
    const residual = analyzeSql('SELECT * FROM accounts WHERE id = 1 AND balance > 0')
    const range = analyzeSql('SELECT * FROM accounts WHERE id > 1')
    expect(primary.predicateShape).toBe('primary_key_equality')
    expect(JSON.stringify(primary.plan)).not.toContain('Selection')
    expect(residual.predicateShape).toBe('primary_key_with_residual')
    expect(residual.accessPath).toBe('point_get')
    expect(residual.plan[0].children[0]).toMatchObject({ operator: 'Selection', task: 'root' })
    expect(residual.plan[0].children[0].children[0].operator).toBe('Point_Get')
    expect(range.predicateShape).toBe('primary_range')
    expect(analyzeSql('SELECT * FROM accounts').predicateShape).toBe('none')
    expect(analyzeSql('UPDATE accounts SET balance = 0 WHERE id = 1 AND balance > 0').predicateShape)
      .toBe('primary_key_with_residual')
  })

  it.each([
    ['SELECT * FROM accounts WHERE id > 1', 'primary_range', 'TableRangeScan', false],
    ['SELECT * FROM accounts WHERE id > 1 AND balance > 0', 'primary_range_with_residual', 'TableRangeScan', true],
    ['SELECT * FROM order_items WHERE order_id = 1', 'primary_range', 'TableRangeScan', false],
    ['SELECT * FROM order_items WHERE order_id = 1 AND item_id > 2', 'primary_range', 'TableRangeScan', false],
    ['SELECT * FROM order_items WHERE order_id > 1 AND item_id = 2', 'primary_range_with_residual', 'TableRangeScan', true],
    ['SELECT * FROM order_items WHERE item_id = 2', 'scan_predicate', 'TableFullScan', true],
  ] as const)('preserves clustered leading-key range and suffix-filter semantics: %s', (sql, shape, operator, selection) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('supported')
    expect(analysis.predicateShape).toBe(shape)
    const serialized = JSON.stringify(analysis.plan)
    expect(serialized).toContain(operator)
    expect(serialized.includes('Selection')).toBe(selection)
    expect(serialized).not.toContain('IndexRangeScan')
  })

  it('keeps transaction KV writes separate from coprocessor read tasks', () => {
    const write = analyzeSql('UPDATE accounts SET balance = 0 WHERE id = 1')
    expect(write.plan[0].children[0]).toMatchObject({ operator: 'KVWrite', task: 'kv[tikv]' })
    expect(JSON.stringify(write.plan)).not.toContain('cop[tikv]')
  })

  it('retains predicate Selection below TiKV and TiFlash aggregate operators', () => {
    for (const sql of [
      'SELECT COUNT(*) FROM accounts WHERE balance > 0',
      'SELECT COUNT(*) FROM events WHERE amount > 0',
      'SELECT account_id, COUNT(*) FROM events WHERE amount > 0 GROUP BY account_id',
    ]) {
      const analysis = analyzeSql(sql)
      expect(analysis.status).toBe('supported')
      expect(analysis.predicateShape).toBe('scan_predicate')
      const serialized = JSON.stringify(analysis.plan)
      expect(serialized).toContain('Selection')
      expect(serialized).toContain('TableFullScan')
    }
    expect(JSON.stringify(analyzeSql('SELECT COUNT(*) FROM events').plan)).not.toContain('Selection')
  })

  it.each(['SQL_CALC_FOUND_ROWS', 'SQL_BIG_RESULT', 'SQL_SMALL_RESULT', 'STRAIGHT_JOIN', 'SQL_NO_CACHE'])('does not reinterpret the SELECT option %s as a column alias', (option) => {
    expect(analyzeSql(`SELECT ${option} id FROM accounts WHERE id = 1`).status).toBe('unsupported')
  })

  it.each([
    'SELECT CASE FROM accounts WHERE id = 1',
    'SELECT id FROM accounts AS CASE WHERE id = 1',
    'SELECT CASE END FROM accounts WHERE id = 1',
    'SELECT CASE WHEN id = 1 THEN balance ELSE 0 END FROM accounts WHERE id = 1',
    'UPDATE accounts SET balance = CASE WHERE id = 1',
  ])('does not reinterpret reserved CASE syntax as a simple identifier: %s', (sql) => {
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('unsupported')
    expect(analysis.plan).toEqual([])
  })

  it('preserves the pinned reserved profile and its bare, quoted, and qualified identifier boundaries', () => {
    // parser.y's reserved-token block has 232 entries; misc.go contributes only
    // the three reserved aliases. SUBSTR is an alias of unreserved SUBSTRING.
    expect(TIDB_RESERVED_KEYWORDS).toHaveLength(235)
    expect(new Set(TIDB_RESERVED_KEYWORDS).size).toBe(235)
    expect(TIDB_RESERVED_KEYWORDS).toEqual([...TIDB_RESERVED_KEYWORDS].sort())
    expect(TIDB_RESERVED_KEYWORDS).toEqual(expect.arrayContaining(['case', 'schema', 'schemas', 'dec']))
    expect(TIDB_RESERVED_KEYWORDS).not.toContain('end')
    expect(TIDB_RESERVED_KEYWORDS).not.toContain('substr')
    for (const word of TIDB_RESERVED_KEYWORDS) {
      expect(analyzeSql(`SELECT id AS ${word} FROM accounts WHERE id = 1`).status, word)
        .not.toBe('supported')
      expect(analyzeSql(`SELECT id AS \`${word}\` FROM accounts WHERE id = 1`).accessPath, word)
        .toBe('point_get')
      expect(analyzeSql(`SELECT a.${word} FROM accounts a WHERE a.id = 1`).accessPath, word)
        .toBe('point_get')
      expect(analyzeSql(`SELECT ${word}.id FROM accounts AS \`${word}\` WHERE ${word}.id = 1`).accessPath, word)
        .toBe('point_get')
    }
  })

  it.each(['END', 'OFFSET', 'DUPLICATE', 'DUMPFILE', 'DATE', 'NOW', 'CURDATE', 'CURTIME', 'USER', 'TIFLASH', 'SUBSTR'])('keeps the legal nonreserved identifier %s available', (word) => {
    expect(analyzeSql(`SELECT ${word} FROM accounts WHERE id = 1`).accessPath).toBe('point_get')
    expect(analyzeSql(`SELECT id FROM accounts AS ${word} WHERE ${word}.id = 1`).accessPath).toBe('point_get')
    expect(analyzeSql(`UPDATE accounts SET balance = ${word} WHERE id = 1`).status).toBe('supported')
  })

  it.each(TIDB_BARE_BUILTINS)('requires evaluation for the unquoted bare builtin %s', (builtin) => {
    for (const sql of [
      `SELECT ${builtin} FROM accounts WHERE id = 1`,
      `UPDATE accounts SET balance = ${builtin} WHERE id = 1`,
      `UPDATE accounts SET balance = (${builtin}) WHERE id = 1`,
    ]) {
      const analysis = analyzeSql(sql)
      expect(analysis.status).toBe('unsupported')
      expect(analysis.plan).toEqual([])
    }
    expect(analyzeSql(`SELECT \`${builtin}\` FROM accounts WHERE id = 1`).accessPath).toBe('point_get')
    expect(analyzeSql(`UPDATE accounts a SET balance = a.${builtin} WHERE a.id = 1`).status).toBe('supported')
  })

  it('matches the source qualified-identifier keyword bypass without hiding SELECT options', () => {
    expect(analyzeSql('SELECT a. CASE FROM accounts a WHERE a.id = 1').accessPath).toBe('point_get')
    expect(analyzeSql('SELECT a.\tCASE FROM accounts a WHERE a.id = 1').status).not.toBe('supported')
    expect(analyzeSql('SELECT case .id FROM accounts AS `case` WHERE `case`.id = 1').status).not.toBe('supported')
    expect(analyzeSql('SELECT id AS SQL_NO_CACHE FROM accounts WHERE id = 1').accessPath).toBe('point_get')
    expect(analyzeSql('SELECT a.SQL_NO_CACHE FROM accounts a WHERE a.id = 1').accessPath).toBe('point_get')
    expect(analyzeSql('SELECT SQL_NO_CACHE id FROM accounts WHERE id = 1').status).toBe('unsupported')
  })

  it('keeps non-key filtering visible without inventing a secondary index', () => {
    const scan = analyzeSql('SELECT * FROM events WHERE account_id = 1')
    expect(scan.accessPath).toBe('range_scan')
    const serialized = JSON.stringify(scan.plan)
    expect(serialized).toContain('Selection')
    expect(serialized).toContain('TableFullScan')
    expect(serialized).not.toContain('IndexRangeScan')
    const full = analyzeSql('SELECT * FROM events')
    expect(JSON.stringify(full.plan)).not.toContain('Selection')
    expect(full.accessPath).toBe('table_scan')
  })

  it('preserves every guided fixture and bounds maximum-size UTF-8 and nested input', () => {
    for (const scenario of TIDB_SCENARIOS) {
      expect(analyzeSql(scenario.sql).status, scenario.id).toBe('supported')
    }
    const base = 'SELECT * FROM accounts WHERE id = 1'
    const boundary = base + ' '.repeat(MAX_SQL_BYTES - base.length)
    expect(new TextEncoder().encode(boundary).byteLength).toBe(MAX_SQL_BYTES)
    expect(analyzeSql(boundary).status).toBe('supported')
    expect(analyzeSql(boundary + ' ').status).toBe('invalid')
    expect(analyzeSql(`${base} /*${'雪'.repeat(21_845)}*/`).status).toBe('invalid')
    const nested = `UPDATE accounts SET balance = ${'('.repeat(10_000)}1${')'.repeat(10_000)} WHERE id = 1`
    expect(() => analyzeSql(nested)).not.toThrow()
    expect(analyzeSql(nested).status).not.toBe('supported')
  })

  it('rejects arbitrarily oversized API input before allocating a UTF-8 copy', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    try {
      expect(analyzeSql('x'.repeat(MAX_SQL_BYTES * 16)).status).toBe('invalid')
      expect(encode).not.toHaveBeenCalled()
    } finally {
      encode.mockRestore()
    }
  })

  it('keeps classifier metadata literal-free even for escaped strings, quoted identifiers, and rejection', () => {
    const secrets = ['sql-private-425', 'escaped-private-425', 'identifier-private-425']
    const examples = [
      `SELECT * FROM accounts WHERE note = '${secrets[0]}' AND id = 1`,
      `INSERT INTO events (id, note) VALUES (1, '${secrets[1]}')`,
      `SELECT '${secrets[0]}' FROM accounts WHERE id = 1`,
      `SELECT * FROM \`${secrets[2]}\` WHERE id = 1`,
      `SELECT \`${secrets[2]}\`.CASE FROM accounts AS \`${secrets[2]}\` WHERE \`${secrets[2]}\`.id = 1 AND note = '${secrets[0]}'`,
      `SELECT * FROM accounts /*! WHERE note = '${secrets[0]}' */`,
    ]
    for (const sql of examples) {
      const first = analyzeSql(sql)
      const second = analyzeSql(sql)
      expect(first).toEqual(second)
      const metadata = JSON.stringify(first)
      for (const secret of secrets) expect(metadata).not.toContain(secret)
      expect(first).not.toHaveProperty('sql')
      expect(first).not.toHaveProperty('rows')
    }
  })
})
