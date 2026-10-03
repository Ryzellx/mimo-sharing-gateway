import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export type DB = ReturnType<typeof createDb>['db'];
export type SqlClient = ReturnType<typeof createDb>['client'];

let singleton: { db: DB; client: SqlClient } | null = null;

export function createDb(url = config.env.DATABASE_URL, max = config.env.DATABASE_POOL_MAX) {
  const client = postgres(url, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function getDb(): DB {
  if (!singleton) {
    singleton = createDb();
  }
  return singleton.db;
}

export function setDb(instance: { db: DB; client: SqlClient }) {
  singleton = instance;
}

export async function closeDb() {
  if (singleton) {
    await singleton.client.end({ timeout: 5 });
    singleton = null;
  }
}
