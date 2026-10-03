import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { listMigrationFiles, migrationsDir, runMigrations, type SqlExecutor } from '../../src/db/migrate.js';

function executor(pglite: PGlite): SqlExecutor {
  return {
    exec: (sql) => pglite.exec(sql),
    queryRows: async (sql) => ({ rows: (await pglite.query(sql)).rows as any[] }),
  };
}

describe('migration validation', () => {
  it('ships at least one ordered migration', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toBe('0001_init.sql');
    expect(migrationsDir().endsWith('migrations')).toBe(true);
  });

  it('applies cleanly on an empty database and creates every PRD table', async () => {
    const pglite = new PGlite();
    const applied = await runMigrations(executor(pglite));
    expect(applied).toEqual(['0001_init.sql']);

    const { rows } = await pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = rows.map((r) => r.table_name).sort();
    for (const expected of [
      'admin_users',
      'users',
      'api_keys',
      'mimo_accounts',
      'mimo_models',
      'allocations',
      'allocation_history',
      'usage_logs',
      'request_logs',
      'quota_reservations',
      'quota_snapshots',
      'reconciliation_logs',
      'rate_limits',
      'audit_logs',
      'system_settings',
    ]) {
      expect(tables).toContain(expected);
    }
    await pglite.close();
  });

  it('is idempotent: second run is a no-op', async () => {
    const pglite = new PGlite();
    const ex = executor(pglite);
    await runMigrations(ex);
    const second = await runMigrations(ex);
    expect(second).toEqual([]);
    await pglite.close();
  });

  it('enforces api key uniqueness at the database level', async () => {
    const pglite = new PGlite();
    await runMigrations(executor(pglite));
    await pglite.query(
      `INSERT INTO users (username, email, password_hash) VALUES ('u1', 'u1@t.local', 'x')`,
    );
    const { rows } = await pglite.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
    const userId = rows[0]!.id;
    await pglite.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, key_last4) VALUES ($1, 'hash', 'gw_live_', '0000')`,
      [userId],
    );
    await expect(
      pglite.query(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, key_last4) VALUES ($1, 'hash', 'gw_live_', '0000')`,
        [userId],
      ),
    ).rejects.toThrow();
    await pglite.close();
  });
});
