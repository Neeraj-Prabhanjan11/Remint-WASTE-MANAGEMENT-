import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresDatabase } from '../server/postgres.js';

test('Postgres adapter binds SQLite-style placeholders and returns inserted ids', async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: 17 }], rowCount: 1 };
    },
  };
  const db = new PostgresDatabase(pool);

  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND email = ?').get(17, 'person@example.com');
  const inserted = await db.prepare('INSERT INTO waste_logs (user_id, category) VALUES (?, ?)').run(17, 'Paper');

  assert.deepEqual(calls, [
    { sql: 'SELECT * FROM users WHERE id = $1 AND email = $2', values: [17, 'person@example.com'] },
    { sql: 'INSERT INTO waste_logs (user_id, category) VALUES ($1, $2) RETURNING id', values: [17, 'Paper'] },
  ]);
  assert.deepEqual(user, { id: 17 });
  assert.deepEqual(inserted, { changes: 1, lastInsertRowid: 17 });
});

test('Postgres adapter commits successful transactions and rolls back failures', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() {
      statements.push('RELEASE');
    },
  };
  const db = new PostgresDatabase({ async connect() { return client; } });

  await db.transaction(async (transaction) => {
    await transaction.prepare('UPDATE users SET name = ? WHERE id = ?').run('New name', 17);
  });
  assert.deepEqual(statements, ['BEGIN', 'UPDATE users SET name = $1 WHERE id = $2', 'COMMIT', 'RELEASE']);

  statements.length = 0;
  await assert.rejects(db.transaction(async () => { throw new Error('forced failure'); }), /forced failure/);
  assert.deepEqual(statements, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});
