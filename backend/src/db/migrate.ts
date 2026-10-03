import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface SqlExecutor {
  exec(sql: string): Promise<unknown>;
  queryRows<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
}

const CREATE_TRACKING = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}

export function listMigrationFiles(dir = migrationsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function runMigrations(ex: SqlExecutor, dir = migrationsDir()): Promise<string[]> {
  await ex.exec(CREATE_TRACKING);
  const applied = new Set(
    (await ex.queryRows<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  const executed: string[] = [];
  for (const file of listMigrationFiles(dir)) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await ex.exec('BEGIN');
    try {
      await ex.exec(sql);
      await ex.exec(`INSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}')`);
      await ex.exec('COMMIT');
    } catch (err) {
      await ex.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    executed.push(file);
  }
  return executed;
}

async function main() {
  const [{ createDb, setDb }, postgres] = await Promise.all([
    import('./client.js'),
    import('postgres'),
  ]);
  const { config } = await import('../config.js');
  const client = postgres.default(config.env.DATABASE_URL, { max: 1 });
  const ex: SqlExecutor = {
    exec: (sql) => client.unsafe(sql),
    queryRows: async (sql) => ({ rows: (await client.unsafe(sql)) as any[] }),
  };
  const executed = await runMigrations(ex);
  setDb(createDb(config.env.DATABASE_URL, 2));
  process.stdout.write(
    executed.length ? `Applied migrations: ${executed.join(', ')}\n` : 'No pending migrations.\n',
  );
  await client.end({ timeout: 5 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${String((err as Error).stack ?? err)}\n`);
    process.exit(1);
  });
}
