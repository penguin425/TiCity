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
    expect(tiflash.plan.flatMap((node) => node.children).some(
      (node) => node.task === 'mpp[tiflash]',
    )).toBe(true)
    expect(tiflashPlan).toContain('MPPGather')
    expect(tiflashPlan).toContain('HashAgg(Partial)')
    expect(tiflashPlan).toContain('ExchangeSender(HashPartition)')
    expect(tiflashPlan).toContain('ExchangeReceiver(HashPartition)')
    expect(tiflashPlan).toContain('HashAgg(Final)')
    expect(tiflashPlan).toContain('ExchangeSender(PassThrough)')
    expect(tikv.accessPath).toBe('table_scan')
    expect(JSON.stringify(tikv.plan)).not.toContain('mpp[tiflash]')
    expect(JSON.stringify(tikv.plan)).toContain('cop[tikv]')
  })

  it('allows semicolons inside literals and comments but rejects multiple statements', () => {
    expect(analyzeSql("SELECT * FROM accounts WHERE note = ';' -- ;\n AND id = 1").status)
      .toBe('supported')
    expect(analyzeSql('SELECT * FROM accounts; DELETE FROM accounts').status).toBe('invalid')
    expect(analyzeSql('SELECT * FROM accounts;;').status).toBe('invalid')
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
