#!/usr/bin/env node
/**
 * Applies every migration in order to the database in DATABASE_URL.
 *
 * Deliberately dumb: it runs the files, in name order, and stops at the first one that fails
 * with the filename and the error. A migration runner that is cleverer than this is a migration
 * runner that can be wrong in ways nobody notices until production.
 *
 * `migrate:check` validates the files without a database; this is the other half.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const client = new pg.Client({ connectionString: url });
await client.connect();

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  try {
    await client.query(readFileSync(path.join(dir, file), 'utf8'));
    console.log(`OK   ${file}`);
  } catch (error) {
    console.error(`FAIL ${file}\n     ${error.message}`);
    // The one failure that looks cryptic and has an obvious cause: the service catalog carries
    // Devanagari, so a cluster created in a Windows-1252 locale cannot hold it.
    if (String(error.message).includes('WIN1252')) {
      console.error('     Create the database with UTF-8: createdb <name> --encoding=UTF8 --template=template0');
    }
    process.exit(1);
  }
}

console.log(`Applied ${files.length} migration(s).`);
await client.end();
