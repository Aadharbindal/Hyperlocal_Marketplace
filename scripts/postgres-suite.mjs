/**
 * Run the API suite against a real PostgreSQL, on this machine, with one command.
 *
 * CI has done this since the Postgres job landed, but locally it was four steps of tribal
 * knowledge and two of them cost a whole run when you got them wrong. It is worth running before
 * any push that touches a migration or a memory repository: the memory store mirrors every SQL
 * constraint by hand, and hand-written mirrors drift. That drift has been caught twice - most
 * recently a memory repository throwing a bare `Error` where Postgres throws a translated
 * conflict, which made the emergency-contact cap answer 422 in one mode and 409 in the other.
 *
 * The two things that cost a run:
 *
 *   - The cluster inherits the Windows locale (English_India.1252), so its **default encoding is
 *     WIN1252** and migration 0001's Hindi seed data fails to load. The database has to be created
 *     explicitly with `encoding 'UTF8' template template0`.
 *   - `embedded-postgres`'s own `getPgClient()` builds its config at construction, so assigning
 *     `.database` afterwards silently does nothing and you spend the run talking to `postgres`.
 *     A fresh `pg.Client` with an explicit connection string is the way.
 *
 *   npm run test:pg
 *
 * `embedded-postgres` is not a dependency - it downloads a PostgreSQL build, which does not belong
 * in everybody's install. The script says how to get it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A port nothing is on, asked for rather than assumed.
 *
 * A fixed port is one orphaned cluster away from a run that fails with `undefined` - which is
 * exactly what happened: a previous run left a listener on 55433 that outlived its own process,
 * and `start()` rejected with nothing useful. Binding to 0 and reading back what the OS gave is
 * both shorter and immune to it.
 */
async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
const DB = 'hyperlocal_test';
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/${DB}`;

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
  ({ default: pg } = await import('pg'));
} catch {
  console.error(
    'This needs a local PostgreSQL build:\n\n' +
      '  npm i -D embedded-postgres --no-save --workspace apps/api\n\n' +
      'It is deliberately not a dependency - it downloads a server binary.',
  );
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'hyperlocal-pg-'));
const pgsql = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });

let code = 1;
try {
  console.log('starting postgres…');
  await pgsql.initialise();
  await pgsql.start();

  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres` });
  await admin.connect();
  await admin.query(`create database ${DB} encoding 'UTF8' template template0`);
  const { rows } = await admin.query('select pg_encoding_to_char(encoding) as enc from pg_database where datname = $1', [DB]);
  await admin.end();

  // Loud, because a WIN1252 database fails later and in a way that looks like a seed-data bug.
  if (rows[0]?.enc !== 'UTF8') throw new Error(`database came up as ${rows[0]?.enc}, not UTF8`);
  console.log(`postgres up on ${PORT}, encoding ${rows[0].enc}\n`);

  // The suite does not create the schema; `apply-migrations` is the other half of `migrate:check`
  // and applying all of them to an empty database is half of what this run is for.
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const migrate = spawnSync('node', ['scripts/apply-migrations.mjs'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (migrate.status !== 0) throw new Error('migrations failed; the suite would only repeat the error');

  const run = spawnSync('npx', ['vitest', 'run'], {
    cwd: join(root, 'apps', 'api'),
    env: { ...process.env, DATA_MODE: 'postgres', DATABASE_URL: DB_URL },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  code = run.status ?? 1;
} catch (e) {
  // Printed whole: embedded-postgres rejects with things that are not Errors, and "undefined"
  // on its own is a worse message than anything it could actually be carrying.
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  if (e && typeof e === 'object') console.error(JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0, 2000));
} finally {
  try {
    await pgsql.stop();
  } catch {
    /* already down */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows sometimes still holds a handle; the directory is in tmp either way. */
  }
}

process.exit(code);
