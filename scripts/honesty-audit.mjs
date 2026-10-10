/**
 * Screens that tell somebody a comfortable thing when they do not know.
 *
 * This checks one shape, because it kept turning up and it is always the same shape: a query
 * whose empty state is rendered without anybody first asking whether the request *failed*. React
 * Query gives `undefined` data for an error as readily as for an empty list, so
 * `(x.data ?? []).length === 0` is true in both cases and the screen says the reassuring one.
 *
 * It is not a cosmetic bug. The ones found by hand:
 *
 *   - the vendor's shop card told a shop that had been trading for a month "Shop not set up yet"
 *   - the admin's payout list told somebody chasing a stuck payout "Nothing in that state"
 *   - the money screen claimed "Every settled job has been paid out"
 *   - the console's people search told somebody looking for an account "Nobody matches that",
 *     on the screen where suspensions are issued
 *   - a person's audit history read "Nothing recorded"
 *
 * Every one of those is the app stating a fact about the world on the strength of a request that
 * did not come back. An error state is not a worse empty state; they are different claims.
 *
 *   node scripts/honesty-audit.mjs
 *
 * Exits non-zero when there are findings, so CI can hold the line.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MOBILE = join(ROOT, 'apps', 'mobile');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * `thing.data … .length === 0` and friends - the moment a screen decides there is nothing.
 *
 * Matching the *query object* by name rather than trying to parse the render tree: if a file
 * decides a query is empty and never mentions that query's `isError` anywhere, the error path
 * does not exist. That is coarse, and deliberately so - a narrower rule would miss the next
 * spelling of the same mistake, and this one has no false positives to pay for it, because a
 * query whose error is handled always names `isError` somewhere in its own file.
 */
const EMPTY_CHECK = /(\w+)\.data[^\n]{0,60}?\.length\s*(?:===|<)\s*[01]\b/g;

function audit() {
  const findings = [];
  for (const file of walk(join(MOBILE, 'app')).concat(walk(join(MOBILE, 'src')))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const lines = src.split('\n');
    const seen = new Set();
    for (const m of src.matchAll(EMPTY_CHECK)) {
      const query = m[1];
      if (src.includes(`${query}.isError`)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const key = `${query}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file: rel, line, query, text: lines[line - 1].trim().slice(0, 90) });
    }
  }
  return findings;
}

const findings = audit();
console.log('Empty states rendered without checking whether the request failed\n');
for (const f of findings) console.log(`  ${f.file}:${f.line}  "${f.query}" has no isError path\n      ${f.text}`);
console.log(`\n${findings.length} finding(s).`);
process.exit(findings.length ? 1 : 0);
