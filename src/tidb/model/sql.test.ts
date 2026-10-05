import { describe, expect, it } from 'vitest'

import { analyzeSql } from './sql'

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
