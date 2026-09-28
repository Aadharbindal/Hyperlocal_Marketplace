/**
 * Which API endpoints has nothing in the app ever called?
 *
 * The first version of this used a regex over `api<T>(...)` calls, and `T` containing a `>` -
 * `Array<{ id: string }>` - broke it, which produced three endpoints reported as orphaned that
 * were wired all along. So this one does not try to parse the call: it takes each route's path,
 * turns the parameters into wildcards, and asks whether that shape appears anywhere in the
 * mobile source at all. Cruder, and wrong in the safe direction.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const apiFiles = walk(join(ROOT, 'apps/api/src/modules'));
const routes = new Set();
for (const f of apiFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/app\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
    routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
}

const appSrc = walk(join(ROOT, 'apps/mobile'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** `/jobs/:id/bids` -> a regex matching `/jobs/${anything}/bids` in the app source. */
function shapeOf(path) {
  const parts = path.split('/').filter(Boolean);
  const body = parts
    .map((p) => (p.startsWith(':') ? '[^/`\'"]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`/${body}(?![a-zA-Z0-9_-])`);
}

/**
 * Endpoints the app is *right* not to call, so what remains is a list worth acting on.
 *
 * The storage pair are signed URLs handed to a direct fetch rather than to the API client; the
 * webhook belongs to the payment gateway; and the bare suspend route deliberately throws,
 * pointing at the two-person `suspend-approved` (which is wired). Without this list the report
 * cries wolf four times and stops being read.
 */
const BY_DESIGN = new Set([
  'GET /storage/object',
  'PUT /storage/upload',
  'POST /payments/webhook',
  'POST /admin/users/:id/suspend',
]);

const orphans = [];
for (const route of [...routes].sort()) {
  const path = route.split(' ')[1];
  if (BY_DESIGN.has(route)) continue;
  if (!shapeOf(path).test(appSrc)) orphans.push(route);
}

console.log(`${routes.size} endpoints, ${BY_DESIGN.size} of them not app-facing by design.`);
console.log(`${orphans.length} built with nothing in the app calling them:\n`);
for (const o of orphans) console.log('  ' + o);
if (orphans.length === 0) console.log('  (none)');
