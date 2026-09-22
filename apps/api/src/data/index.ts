import type { Env } from '../config/env';
import { createMemoryStore } from './memory';
import { createPostgresStore } from './postgres';
import type { DataStore } from './types';

export function createDataStore(env: Env): DataStore {
  if (env.DATA_MODE === 'postgres') return createPostgresStore(env.DATABASE_URL!);
  return createMemoryStore();
}

export type { DataStore } from './types';
