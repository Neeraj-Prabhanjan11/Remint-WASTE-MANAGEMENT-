import { Pool, types } from 'pg';

types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);

function postgresSql(sql) {
  let parameter = 0;
  return sql.replace(/\?/g, () => `$${++parameter}`);
}

export class PostgresDatabase {
  constructor(pool, client = null) {
    this.pool = pool;
    this.client = client;
  }

  query(sql, values = []) {
    return (this.client || this.pool).query(postgresSql(sql), values);
  }

  prepare(sql) {
    return {
      get: async (...values) => (await this.query(sql, values)).rows[0],
      all: async (...values) => (await this.query(sql, values)).rows,
      run: async (...values) => {
        const table = sql.match(/^\s*INSERT\s+INTO\s+([a-z_]+)/i)?.[1];
        const returnsId = ['users', 'pickups', 'waste_logs'].includes(table?.toLowerCase());
        const statement = returnsId && !/\bRETURNING\b/i.test(sql) ? `${sql.trim()} RETURNING id` : sql;
        const result = await this.query(statement, values);
        return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
      },
    };
  }

  async transaction(action) {
    const client = await this.pool.connect();
    const transactionDb = new PostgresDatabase(this.pool, client);
    let begun = false;
    let releaseError;
    try {
      await client.query('BEGIN');
      begun = true;
      const result = await action(transactionDb);
      await client.query('COMMIT');
      begun = false;
      return result;
    } catch (error) {
      if (begun) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError = rollbackError;
          throw new AggregateError([error, rollbackError], 'The transaction failed and could not be rolled back cleanly.');
        }
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createPostgresDatabase(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return new PostgresDatabase(pool);
}
