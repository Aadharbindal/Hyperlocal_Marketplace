// Verifies migration files are sequential, uniquely numbered, and that applied
// migrations (recorded in supabase/migrations/.applied.json when present) have not changed.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.error('No migrations found');
  process.exit(1);
}
const seen = new Set();
let expected = 1;
for (const f of files) {
  const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f);
  if (!m) {
    console.error(`Bad migration name: ${f} (expected NNNN_snake_case.sql)`);
    process.exit(1);
  }
  const n = Number(m[1]);
  if (seen.has(n)) {
    console.error(`Duplicate migration number ${m[1]}`);
    process.exit(1);
  }
  if (n !== expected) {
    console.error(`Migration gap: expected ${String(expected).padStart(4, '0')}, got ${m[1]}`);
    process.exit(1);
  }
  seen.add(n);
  expected++;
}
const appliedPath = join(dir, '.applied.json');
if (existsSync(appliedPath)) {
  const applied = JSON.parse(readFileSync(appliedPath, 'utf8'));
  for (const [name, hash] of Object.entries(applied)) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      console.error(`Applied migration ${name} is missing`);
      process.exit(1);
    }
    const actual = createHash('sha256').update(readFileSync(p)).digest('hex');
    if (actual !== hash) {
      console.error(`Applied migration ${name} was modified. Create a new migration instead.`);
      process.exit(1);
    }
  }
}
console.log(`OK: ${files.length} migration(s) valid`);
