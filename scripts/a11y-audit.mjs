#!/usr/bin/env node
/**
 * An accessibility audit for the mobile app.
 *
 * Two different questions, because they need two different kinds of answer.
 *
 * The first is colour contrast, which is arithmetic. WCAG gives a formula, the palette is a
 * finite set of tokens, and every pairing the app uses either passes or does not. There is no
 * judgement involved, so the script computes all of them and reports the failures exactly.
 *
 * The second is whether a screen reader can describe the screen, which is not arithmetic and
 * cannot be fully decided by reading source. What the script can find is the failure that
 * matters most and is unambiguous: a control whose only child is an icon and which carries no
 * label. TalkBack and VoiceOver announce that as "button", and a person who cannot see the icon
 * is told nothing at all. That check is precise enough to act on; anything vaguer would produce
 * noise that teaches people to ignore the report.
 *
 *   node scripts/a11y-audit.mjs
 *
 * Exits non-zero when there are findings, so CI can hold the line once the list is clean.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MOBILE = join(ROOT, 'apps', 'mobile');

// --------------------------------------------------------------------------- colour contrast

/** WCAG relative luminance. sRGB channels are linearised before weighting. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Read the real tokens rather than keeping a copy here. A checker with its own private idea of
 * the palette passes while the app fails, which is the one thing it must never do.
 */
function tokens() {
  const src = readFileSync(join(MOBILE, 'src', 'theme', 'tokens.ts'), 'utf8');
  const out = {};
  for (const m of src.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) if (!(m[1] in out)) out[m[1]] = m[2];
  const chip = {};
  for (const m of src.matchAll(/(\w+):\s*\{\s*bg:\s*'(#[0-9A-Fa-f]{6})',\s*fg:\s*'(#[0-9A-Fa-f]{6})'\s*\}/g)) {
    chip[m[1]] = { bg: m[2], fg: m[3] };
  }
  return { palette: out, chip };
}

/** White at an alpha over an opaque background, so a translucent token can be judged honestly. */
function over(fg, bg, a) {
  const f = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round((((f >> sh) & 255) * a) + (((b >> sh) & 255) * (1 - a))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Only the pairings the app actually renders. Auditing the cartesian product would report
 * failures for combinations nobody ever sees, which is how a report stops being read.
 *
 * Two thresholds, because WCAG has two. Text needs 4.5:1, or 3:1 once it is 24px, or 18.66px
 * bold - in this type scale that is display, title and heading and nothing else, so the 17px
 * semibold button label is held to the full ratio. Icons, borders and other non-text marks need
 * 3:1. Which one applies is a fact about how the colour is used, so it is recorded per pairing
 * rather than guessed from the colour.
 */
function pairings() {
  const { palette: c, chip } = tokens();
  const surfaces = ['surface', 'ground', 'groundDeep', 'surfaceMuted'];
  const rows = [];
  const NEED = { text: 4.5, large: 3, nonText: 3 };
  const add = (fg, bg, use, kind = 'text') => rows.push({ fg, bg, use, need: NEED[kind], kind });

  for (const bg of surfaces) {
    add(c.text, c[bg], `body copy on ${bg}`);
    add(c.textSecondary, c[bg], `secondary copy on ${bg}`);
    add(c.textMuted, c[bg], `muted copy on ${bg}`);
    add(c.danger, c[bg], `error text on ${bg}`);
    add(c.success, c[bg], `success text on ${bg}`);
    // Teal as ink is primaryDeep; teal as a mark is primary. Both are checked, each to its own bar.
    add(c.primaryDeep, c[bg], `link and price text on ${bg}`);
    add(c.primary, c[bg], `icon accents and borders on ${bg}`, 'nonText');
  }

  add(c.textOnPrimary, c.primary, 'primary button label');
  add(c.textOnPrimary, c.primaryPressed, 'primary button label, pressed');
  add(c.textOnPrimary, c.gradientStart, 'hero heading, dark end of the gradient', 'large');
  add(c.textOnPrimary, c.gradientEnd, 'hero heading, light end of the gradient', 'large');
  add(over('#FFFFFF', c.gradientEnd, 0.94), c.gradientEnd, 'hero subtext at its weakest point');
  add(c.primaryDeep, c.primarySoft, 'secondary button label');
  add(c.danger, c.dangerSoft, 'danger button label');
  add(c.success, c.successSoft, 'success badge');
  add(c.warning, c.warningSoft, 'warning badge');
  add(c.info, c.infoSoft, 'info badge');
  for (const [name, v] of Object.entries(chip)) add(v.fg, v.bg, `${name} category chip icon`, 'nonText');

  return rows.map((r) => {
    const ratio = contrast(r.fg, r.bg);
    return { ...r, ratio, pass: ratio >= r.need };
  });
}

// ------------------------------------------------------------------- screen reader labelling

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.expo' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/**
 * Return a control's opening tag and its children.
 *
 * Written as a scanner rather than a regex because JSX attributes are full of characters that
 * look like structure: `onPress={() => close()}` contains a `>` that does not end the tag, and
 * an earlier version of this file believed it did. Every control in the app then looked
 * unlabelled, because the `accessibilityLabel` sat past the arrow and was never read. A checker
 * that reports things that are not true is worse than no checker, so this one tracks brace depth
 * and quotes and only accepts a `>` at the top level.
 */
function elementAt(src, from) {
  const tag = /^<(\w+)/.exec(src.slice(from))?.[1];
  if (!tag) return null;

  let i = from + 1;
  let braces = 0;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === '>' && braces === 0) break;
  }
  if (i >= src.length) return null;

  const open = src.slice(from, i + 1);
  if (/\/\s*>$/.test(open)) return { open, body: '' };

  // Walk to the matching close tag, counting same-named opens on the way.
  let depth = 1;
  let j = i + 1;
  const bodyStart = j;
  const opener = new RegExp(`<${tag}[\s/>]`, 'g');
  const closer = new RegExp(`</${tag}\s*>`, 'g');
  while (depth > 0 && j < src.length) {
    opener.lastIndex = j;
    closer.lastIndex = j;
    const o = opener.exec(src);
    const c = closer.exec(src);
    if (!c) return { open, body: src.slice(bodyStart) };
    if (o && o.index < c.index) {
      depth++;
      j = o.index + 1;
    } else {
      depth--;
      if (depth === 0) return { open, body: src.slice(bodyStart, c.index) };
      j = c.index + 1;
    }
  }
  return { open, body: src.slice(bodyStart) };
}

const CONTROLS = /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g;

function auditLabels() {
  const findings = [];
  for (const file of walk(join(MOBILE, 'app')).concat(walk(join(MOBILE, 'src')))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const match of src.matchAll(CONTROLS)) {
      const el = elementAt(src, match.index);
      if (!el) continue;
      const whole = el.open + el.body;

      // A label anywhere on the control settles it, however it is spelled.
      if (/accessibilityLabel|aria-label|accessible=\{false\}|importantForAccessibility=["']no/.test(el.open)) continue;

      // Any text at all inside means the reader has something to say. That includes a <Text>
      // child, a bare string, or an interpolated value - all of which become the label.
      const hasText = /<Text\b|<RNText\b|<Badge\b|title=|label=|\{t\(/.test(whole) || />\s*[A-Za-z0-9]/.test(el.body);
      const hasIcon = /<Ionicons\b|<MaterialIcons\b|<Feather\b|<RealisticIcon\b/.test(whole);

      if (hasIcon && !hasText) {
        const line = src.slice(0, match.index).split('\n').length;
        const icon = /name=["']([\w-]+)["']/.exec(whole)?.[1] ?? 'icon';
        findings.push({ file: rel, line, icon });
      }
    }
  }
  return findings;
}

// --------------------------------------------------------------- text colour off the palette

/**
 * Text painted with a literal hex instead of a token.
 *
 * The contrast table above is only worth anything if the palette is what screens actually use.
 * A `color: '#7C8F88'` sitting in a StyleSheet is invisible to it, and that is exactly how a
 * 3.4:1 tagline survived on the sign-in screen while every token passed. So: every literal text
 * colour is measured against the surfaces it could be sitting on, and reported if the darkest
 * of them misses.
 *
 * Only `color:` is matched, because that is text. `fill` and `stroke` belong to the
 * illustrations, which are decoration and carry no information of their own.
 */
function auditHardcodedText() {
  const { palette: c } = tokens();
  const known = new Set(Object.values(c).map((v) => v.toUpperCase()));
  const surfaces = [c.surface, c.ground, c.groundDeep, c.surfaceMuted];
  const findings = [];

  for (const file of walk(join(MOBILE, 'app')).concat(walk(join(MOBILE, 'src')))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    for (const m of src.matchAll(/color:\s*'(#[0-9A-Fa-f]{6})'/g)) {
      const hex = m[1].toUpperCase();
      if (known.has(hex)) continue;
      // The worst surface it could land on. Anything that clears that clears all of them.
      const worst = Math.min(...surfaces.map((bg) => contrast(hex, bg)));
      if (worst >= 4.5) continue;
      findings.push({ file: rel, line: src.slice(0, m.index).split('\n').length, hex, ratio: worst });
    }
  }
  return findings;
}

// ------------------------------------------------------------------------------------ report

const contrastRows = pairings();
const failing = contrastRows.filter((r) => !r.pass);

console.log('Colour contrast (WCAG 2.1 AA)\n');
for (const r of [...contrastRows].sort((a, b) => a.ratio - b.ratio)) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.ratio.toFixed(2).padStart(5)}:1  (needs ${r.need})  ${r.use}`);
}

const labels = auditLabels();
console.log(`\nUnlabelled icon-only controls: ${labels.length}`);
for (const f of labels) console.log(`  ${f.file}:${f.line}  <${f.icon}>`);

const hard = auditHardcodedText();
console.log(`\nText colours off the palette that miss AA: ${hard.length}`);
for (const f of hard) console.log(`  ${f.file}:${f.line}  ${f.hex} at ${f.ratio.toFixed(2)}:1`);

const total = failing.length + labels.length + hard.length;
console.log(`\n${total} finding(s).`);
process.exit(total > 0 ? 1 : 0);
