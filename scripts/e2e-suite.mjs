/**
 * The whole journey, against a real PostgreSQL, with one command.
 *
 * `e2e-journey.mjs` makes the same HTTP calls a phone makes, in the order a real customer and a
 * real professional make them; `e2e-flows.mjs` walks the five journeys that hang off it -
 * contractor, warranty, service plans, redispatch and materials. Both need a database with every
 * migration applied and an API pointed at it, and setting those up by hand is four steps nobody
 * remembers. This does the setup, runs both, and takes the cluster down again.
 *
 *   npm run test:e2e
 *
 * See `postgres-suite.mjs` for why the database has to be created with an explicit UTF8 encoding.
 * `embedded-postgres` is not a dependency - the script says how to get it.
 */

import { spawn, spawnSync } from 'node:child_process';
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
const API_PORT = await freePort();
const DB = 'hyperlocal_e2e';
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/${DB}`;
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const WIN = process.platform === 'win32';

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
  ({ default: pg } = await import('pg'));
} catch {
  console.error('This needs a local PostgreSQL build:\n\n  npm i -D embedded-postgres --no-save --workspace apps/api\n');
  process.exit(1);
}

async function reachable(url, forSeconds) {
  const until = Date.now() + forSeconds * 1000;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const dir = mkdtempSync(join(tmpdir(), 'hyperlocal-e2e-'));
const pgsql = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port: PORT, persistent: false });
let api = null;
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
  if (rows[0]?.enc !== 'UTF8') throw new Error(`database came up as ${rows[0]?.enc}, not UTF8`);

  const migrate = spawnSync('node', ['scripts/apply-migrations.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'inherit',
    shell: WIN,
  });
  if (migrate.status !== 0) throw new Error('migrations failed');

  console.log(`starting the api on ${API_PORT}…`);
  api = spawn('npm', ['run', 'dev', '--workspace', 'apps/api'], {
    cwd: ROOT,
    env: { ...process.env, DATA_MODE: 'postgres', DATABASE_URL: DB_URL, API_PORT: String(API_PORT) },
    // Quiet: the journey's own output is the point, and the request log would bury it.
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: WIN,
  });

  if (!(await reachable(`http://127.0.0.1:${API_PORT}/health`, 90))) throw new Error('the api never came up');

  /*
   * The flows script needs the seeded platform admin to approve identity documents, and seeding
   * only happens automatically in memory mode - so it is run explicitly here.
   */
  const seeded = spawnSync('npm', ['run', 'seed:demo'], {
    cwd: ROOT,
    env: { ...process.env, DATA_MODE: 'postgres', DATABASE_URL: DB_URL },
    stdio: 'inherit',
    shell: WIN,
  });
  if (seeded.status !== 0) throw new Error('seeding failed');

  const env = { ...process.env, DATABASE_URL: DB_URL, E2E_BASE_URL: `http://127.0.0.1:${API_PORT}` };
  // Both run even when the first fails: knowing which of the two broke is the point, and a
  // suite that stops at the first failure hides the second every time.
  const journey = spawnSync('node', ['scripts/e2e-journey.mjs'], { cwd: ROOT, env, stdio: 'inherit', shell: WIN });
  const flows = spawnSync('node', ['scripts/e2e-flows.mjs'], { cwd: ROOT, env, stdio: 'inherit', shell: WIN });
  code = (journey.status ?? 1) || (flows.status ?? 1);
} catch (e) {
  // Printed whole: embedded-postgres rejects with things that are not Errors, and "undefined"
  // on its own is a worse message than anything it could actually be carrying.
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  if (e && typeof e === 'object') console.error(JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0, 2000));
} finally {
  // The dev server is spawned through a shell on Windows, so killing the shell leaves the node
  // process holding the port. Take the tree.
  if (api?.pid) {
    try {
      if (WIN) spawnSync('taskkill', ['/pid', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-api.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  try {
    await pgsql.stop();
  } catch {
    /* already down */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows sometimes still holds a handle; it is in tmp either way. */
  }
}

process.exit(code);
