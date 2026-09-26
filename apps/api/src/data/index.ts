import type { Env } from '../config/env';
import { createMemoryStore } from './memory';
import { createPostgresStore } from './postgres';
import type { DataStore } from './types';

export function createDataStore(env: Env): DataStore {
  if (env.DATA_MODE === 'postgres') {
    return createPostgresStore(env.DATABASE_URL!, {
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    });
  }
  return createMemoryStore();
}

export type { DataStore } from './types';
