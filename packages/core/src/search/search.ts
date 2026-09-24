/**
 * Search, on the thing a customer is actually looking for.
 *
 * The box at the top of the home screen has been a stub since M2. What somebody types into it is
 * not a category name - it is "tap leaking", "गीजर", "fan not working". So this matches against
 * the words in a category and its skills, in both languages, rather than expecting people to
 * know our taxonomy.
 *
 * It runs on the catalog, which is small and already in memory. When the catalog outgrows that,
 * this becomes a Postgres text search and the rules below become the ranking function - which is
 * why they are written down here rather than buried in a query.
 */

export interface SearchableSkill {
  id: string;
  categoryId: string;
  slug: string;
  nameEn: string;
  nameHi: string;
}

export interface SearchableCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string;
}

export interface SearchHit {
  categoryId: string;
  /** Set when the match was on a specific skill, so the booking can start pre-filled. */
  skillId: string | null;
  label: string;
  /** Why this matched, in the user's words - "matched: geyser" reads better than a score. */
  matchedOn: string;
  score: number;
}

/**
 * Everyday words people use for work, mapped to the skill slugs they mean. Hindi and English,
 * and the transliterated spellings people actually type on a phone keyboard.
 *
 * This list is the honest admission that a taxonomy is not a vocabulary: somebody with no hot
 * water searches "geyser", never "water-heater", and "नल" will never match "tap-leak" by any
 * amount of string similarity.
 */
const SYNONYMS: Record<string, string[]> = {
  'tap-leak': ['tap', 'nal', 'नल', 'leak', 'leakage', 'tapak', 'टपक', 'dripping', 'faucet'],
  'drain-block': ['drain', 'nali', 'नाली', 'block', 'blocked', 'jam', 'जाम', 'choked', 'clog', 'sink'],
  'water-heater': ['geyser', 'गीजर', 'gizer', 'heater', 'hot water', 'garam pani', 'गरम पानी'],
  'bathroom-fitting': ['bathroom', 'बाथरूम', 'shower', 'commode', 'flush', 'basin', 'toilet'],
  'switch-socket': ['switch', 'स्विच', 'socket', 'plug', 'board', 'point'],
  'fan-light': ['fan', 'पंखा', 'pankha', 'light', 'लाइट', 'bulb', 'tube', 'ceiling fan'],
  wiring: ['wiring', 'वायरिंग', 'wire', 'mcb', 'fuse', 'short circuit', 'current', 'बिजली', 'bijli', 'spark'],
  inverter: ['inverter', 'इन्वर्टर', 'ups', 'battery', 'बैटरी', 'backup', 'power cut'],
  'furniture-repair': ['furniture', 'फर्नीचर', 'chair', 'table', 'bed', 'sofa', 'drawer', 'almirah'],
  'door-window': ['door', 'दरवाज़ा', 'darwaza', 'window', 'खिड़की', 'lock', 'hinge', 'handle'],
  'modular-fitting': ['modular', 'kitchen', 'रसोई', 'cabinet', 'wardrobe', 'shelf'],
};

const normalise = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Scores are coarse on purpose. The difference that matters to somebody typing "gey" is whether
 * the geyser option appears at all, not whether it scores 0.82 or 0.79.
 */
const SCORE = { EXACT: 100, PREFIX: 70, SYNONYM: 60, CONTAINS: 40 } as const;

function scoreText(query: string, text: string): number | null {
  const t = normalise(text);
  if (!t) return null;
  if (t === query) return SCORE.EXACT;
  if (t.startsWith(query)) return SCORE.PREFIX;
  if (t.includes(query)) return SCORE.CONTAINS;
  return null;
}

export function searchCatalog(
  rawQuery: string,
  catalog: { categories: SearchableCategory[]; skills: SearchableSkill[] },
  lang: 'en' | 'hi' = 'en',
  limit = 8,
): SearchHit[] {
  const query = normalise(rawQuery);
  // One letter matches everything, which is the same as matching nothing useful.
  if (query.length < 2) return [];

  const hits = new Map<string, SearchHit>();
  const keep = (hit: SearchHit) => {
    const key = `${hit.categoryId}:${hit.skillId ?? ''}`;
    const existing = hits.get(key);
    if (!existing || existing.score < hit.score) hits.set(key, hit);
  };

  for (const skill of catalog.skills) {
    const label = lang === 'hi' ? skill.nameHi : skill.nameEn;
    const direct = Math.max(
      scoreText(query, skill.nameEn) ?? 0,
      scoreText(query, skill.nameHi) ?? 0,
      scoreText(query, skill.slug.replace(/-/g, ' ')) ?? 0,
    );
    if (direct > 0) keep({ categoryId: skill.categoryId, skillId: skill.id, label, matchedOn: label, score: direct });

    // Somebody with no hot water searches "geyser", never "water-heater".
    for (const word of SYNONYMS[skill.slug] ?? []) {
      const w = normalise(word);
      if (w === query || w.startsWith(query) || query.startsWith(w)) {
        keep({ categoryId: skill.categoryId, skillId: skill.id, label, matchedOn: word, score: SCORE.SYNONYM });
        break;
      }
    }
  }

  for (const category of catalog.categories) {
    const label = lang === 'hi' ? category.nameHi : category.nameEn;
    const direct = Math.max(
      scoreText(query, category.nameEn) ?? 0,
      scoreText(query, category.nameHi) ?? 0,
      scoreText(query, category.slug.replace(/-/g, ' ')) ?? 0,
    );
    // A category match is a whole trade, so it sits just under a matching skill of the same score.
    if (direct > 0) keep({ categoryId: category.id, skillId: null, label, matchedOn: label, score: direct - 5 });
  }

  return [...hits.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * What to show when somebody opens the box and has typed nothing yet. Their own recent trades
 * first, then the busiest ones - because the most likely next booking is the same kind as the
 * last, and a blank panel teaches people the search does not work.
 */
export function searchSuggestions(input: {
  recentCategoryIds: string[];
  categories: SearchableCategory[];
  lang?: 'en' | 'hi';
  limit?: number;
}): Array<{ categoryId: string; label: string; reason: 'RECENT' | 'POPULAR' }> {
  const lang = input.lang ?? 'en';
  const label = (c: SearchableCategory) => (lang === 'hi' ? c.nameHi : c.nameEn);
  const out: Array<{ categoryId: string; label: string; reason: 'RECENT' | 'POPULAR' }> = [];

  for (const id of input.recentCategoryIds) {
    const category = input.categories.find((c) => c.id === id);
    if (category) out.push({ categoryId: id, label: label(category), reason: 'RECENT' });
  }
  for (const category of input.categories) {
    if (out.some((o) => o.categoryId === category.id)) continue;
    out.push({ categoryId: category.id, label: label(category), reason: 'POPULAR' });
  }
  return out.slice(0, input.limit ?? 6);
}
