import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient } from 'pg';

type Value = string | number | null;
export type Row = Record<string, unknown>;
export interface Sql {
  all<T = Row>(sql: string, args?: Value[]): Promise<T[]>;
  one<T = Row>(sql: string, args?: Value[]): Promise<T | undefined>;
  run(sql: string, args?: Value[]): Promise<number>;
  exec(sql: string): Promise<void>;
}
export interface Store {
  query<T>(operation: (sql: Sql) => Promise<T>): Promise<T>;
  transaction<T>(operation: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function pgSql(client: PoolClient): Sql {
  function parameters(sql: string) {
    let i = 0;
    return sql.replace(/\?/g, () => '$' + ++i);
  }
  return {
    all: async <T>(sql: string, args: Value[] = []) => (await client.query(parameters(sql), args)).rows as T[],
    one: async <T>(sql: string, args: Value[] = []) => (await client.query(parameters(sql), args)).rows[0] as T | undefined,
    run: async (sql, args = []) => (await client.query(parameters(sql), args)).rowCount ?? 0,
    exec: async (sql) => { await client.query(sql); },
  };
}

export async function openStore(config: { databaseUrl?: string; sqlitePath: string; databaseCa?: string }): Promise<Store> {
  if (config.databaseUrl) {
    const connection = new URL(config.databaseUrl);
    connection.searchParams.delete('options');
    // pg URL flags can override explicit CA configuration.
    if (config.databaseCa) {
      for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) connection.searchParams.delete(key);
    }
    const pool = new pg.Pool({
      connectionString: connection.href,
      options: '-c search_path=lifelog,pg_catalog',
      ...(config.databaseCa ? {ssl: {ca: config.databaseCa, rejectUnauthorized: true}} : {}),
      connectionTimeoutMillis: 5000, statement_timeout: 4500, max: 8,
    });
    pool.on('error', () => console.error('数据库连接已断开'));
    return {
      async query(operation) {
        const client = await pool.connect();
        try { return await operation(pgSql(client)); } finally { client.release(); }
      },
      async transaction(operation) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Personal-workspace writes are short and serialized across replicas. Never call a remote service here.
          await client.query('SELECT pg_advisory_xact_lock(72462051)');
          const result = await operation(pgSql(client));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  if (config.sqlitePath !== ':memory:') await mkdir(dirname(config.sqlitePath), { recursive: true });
  const db = new DatabaseSync(config.sqlitePath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  let queue = Promise.resolve();
  function serial<T>(fn: () => Promise<T>) {
    const task = queue.then(fn);
    queue = task.then(() => undefined, () => undefined);
    return task;
  }
  const sql: Sql = {
    all: async <T>(text: string, args: Value[] = []) => db.prepare(text).all(...args as SQLInputValue[]) as T[],
    one: async <T>(text: string, args: Value[] = []) => db.prepare(text).get(...args as SQLInputValue[]) as T | undefined,
    run: async (text, args = []) => Number(db.prepare(text).run(...args).changes),
    exec: async (text) => db.exec(text),
  };
  return {
    query: (operation) => serial(() => operation(sql)),
    transaction: (operation) => serial(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await operation(sql);
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
    close: () => serial(async () => db.close()),
  };
}

export async function migrate(store: Store) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const migrations = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  await store.transaction(async (db) => {
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const name of migrations) {
      if (await db.one('SELECT name FROM schema_migrations WHERE name=?', [name])) continue;
      await db.exec(await readFile(join(directory, name), 'utf8'));
      await db.run('INSERT INTO schema_migrations (name,applied_at) VALUES (?,?)', [name,new Date().toISOString()]);
    }
  });
}
