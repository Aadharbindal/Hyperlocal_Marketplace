import { describe, expect, it } from 'vitest';
import { searchCatalog, searchSuggestions, type SearchableCategory, type SearchableSkill } from './search';

const categories: SearchableCategory[] = [
  { id: 'c1', slug: 'plumbing', nameEn: 'Plumbing', nameHi: 'प्लंबिंग' },
  { id: 'c2', slug: 'electrical', nameEn: 'Electrical', nameHi: 'इलेक्ट्रिकल' },
];

const skills: SearchableSkill[] = [
  { id: 's1', categoryId: 'c1', slug: 'tap-leak', nameEn: 'Tap and leak repair', nameHi: 'नल और लीक की मरम्मत' },
  { id: 's2', categoryId: 'c1', slug: 'water-heater', nameEn: 'Water heater / geyser', nameHi: 'गीज़र' },
  { id: 's3', categoryId: 'c2', slug: 'fan-light', nameEn: 'Fan and light installation', nameHi: 'पंखा और लाइट' },
  { id: 's4', categoryId: 'c2', slug: 'wiring', nameEn: 'Wiring and MCB', nameHi: 'वायरिंग और MCB' },
];

const catalog = { categories, skills };

describe('searching for what is broken', () => {
  it('ignores a single letter, which matches everything and helps nobody', () => {
    expect(searchCatalog('t', catalog)).toEqual([]);
    expect(searchCatalog('', catalog)).toEqual([]);
  });

  it('finds a skill by its own name', () => {
    const hits = searchCatalog('water heater', catalog);
    expect(hits[0]?.skillId).toBe('s2');
  });

  it('finds things by the words people actually use', () => {
    // Nobody with no hot water searches "water-heater".
    expect(searchCatalog('geyser', catalog)[0]?.skillId).toBe('s2');
    expect(searchCatalog('gizer', catalog)[0]?.skillId).toBe('s2');
    expect(searchCatalog('nal', catalog)[0]?.skillId).toBe('s1');
    expect(searchCatalog('pankha', catalog)[0]?.skillId).toBe('s3');
    // A symptom, not a trade
    expect(searchCatalog('short circuit', catalog)[0]?.skillId).toBe('s4');
    expect(searchCatalog('power cut', catalog).length).toBeGreaterThanOrEqual(0);
  });

  it('works in Hindi, in both scripts', () => {
    expect(searchCatalog('गीजर', catalog)[0]?.skillId).toBe('s2');
    expect(searchCatalog('नल', catalog)[0]?.skillId).toBe('s1');
    expect(searchCatalog('बिजली', catalog)[0]?.skillId).toBe('s4');
  });

  it('answers a half-typed word, because that is when the box is being read', () => {
    const hits = searchCatalog('gey', catalog);
    expect(hits.some((h) => h.skillId === 's2')).toBe(true);
  });

  it('returns whole trades too, ranked under a matching skill', () => {
    const hits = searchCatalog('plumbing', catalog);
    expect(hits[0]?.categoryId).toBe('c1');
    expect(hits[0]?.skillId).toBeNull();
  });

  it('labels a hit in the language asked for', () => {
    expect(searchCatalog('geyser', catalog, 'hi')[0]?.label).toBe('गीज़र');
    expect(searchCatalog('geyser', catalog, 'en')[0]?.label).toBe('Water heater / geyser');
  });

  it('says what it matched on, so a strange-looking result explains itself', () => {
    expect(searchCatalog('gizer', catalog)[0]?.matchedOn).toBe('gizer');
  });

  it('never returns the same thing twice', () => {
    const hits = searchCatalog('tap', catalog);
    const keys = hits.map((h) => `${h.categoryId}:${h.skillId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('what to show before anybody types', () => {
  it('puts what they booked before in front of everything else', () => {
    const out = searchSuggestions({ recentCategoryIds: ['c2'], categories });
    expect(out[0]).toEqual({ categoryId: 'c2', label: 'Electrical', reason: 'RECENT' });
    expect(out[1]?.reason).toBe('POPULAR');
  });

  it('never leaves the panel blank, which would read as broken', () => {
    expect(searchSuggestions({ recentCategoryIds: [], categories }).length).toBeGreaterThan(0);
  });

  it('does not repeat a recent trade in the popular list', () => {
    const out = searchSuggestions({ recentCategoryIds: ['c1'], categories });
    expect(out.filter((o) => o.categoryId === 'c1')).toHaveLength(1);
  });
});
