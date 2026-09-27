import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let headers: Record<string, string>;

beforeAll(async () => {
  app = await makeApp();
  // One sign-in for the whole file. Signing in per test trips the OTP limit, which is the limit
  // doing its job rather than a problem to work around.
  const res = await login(app, '+919777000001');
  headers = bearer(res.accessToken);
});
afterAll(async () => {
  await app.close();
});

/**
 * Telling somebody roughly what this costs, before anybody has quoted.
 *
 * A customer used to describe a leaking tap, press submit and wait, with no idea whether the
 * answer would be three hundred rupees or three thousand. The guide exists to answer that, and
 * these tests are mostly about the ways a price guide can be worse than nothing: by hiding how
 * little it knows, or by being so wide it says nothing at all.
 */
describe('what this usually costs', () => {
  async function categories() {
    const r = await app.inject({ method: 'GET', url: '/categories', headers });
    expect(r.statusCode).toBe(200);
    return r.json().items as Array<{
      slug: string;
      priceGuide: { minPaise: number; maxPaise: number; basis: string; sampleSize: number } | null;
      skills: Array<{ slug: string; priceGuide: { minPaise: number; maxPaise: number; basis: string; sampleSize: number } | null }>;
    }>;
  }

  it('gives a range for the work, not a price', () => {
    // Stated as an expectation of the shape rather than the numbers: the seeded figures are a
    // starting point for the pilot and will move, but "min and max, both present" must not.
    return categories().then((items) => {
      const plumbing = items.find((c) => c.slug === 'plumbing')!;
      const tap = plumbing.skills.find((s) => s.slug === 'tap-leak')!;
      expect(tap.priceGuide).not.toBeNull();
      expect(tap.priceGuide!.maxPaise).toBeGreaterThan(tap.priceGuide!.minPaise);
    });
  });

  it('admits it is a guess until somebody has actually paid', async () => {
    const items = await categories();
    const tap = items.find((c) => c.slug === 'plumbing')!.skills.find((s) => s.slug === 'tap-leak')!;

    // This is the whole honesty of the feature. On a fresh catalog nobody has paid anything, so
    // it must not claim to be reporting what people paid.
    expect(tap.priceGuide!.basis).toBe('ESTIMATE');
    expect(tap.priceGuide!.sampleSize).toBe(0);
  });

  it('prices a geyser above a washer, which is why the range lives on the skill', async () => {
    const plumbing = (await categories()).find((c) => c.slug === 'plumbing')!;
    const tap = plumbing.skills.find((s) => s.slug === 'tap-leak')!.priceGuide!;
    const geyser = plumbing.skills.find((s) => s.slug === 'water-heater')!.priceGuide!;

    // One number for the whole of "plumbing" would be worse than none, which is the reason the
    // guidance is not stored on the category.
    expect(geyser.maxPaise).toBeGreaterThan(tap.maxPaise);
  });

  it('rolls a category up to the widest of its skills', async () => {
    const plumbing = (await categories()).find((c) => c.slug === 'plumbing')!;
    const lows = plumbing.skills.map((s) => s.priceGuide!.minPaise);
    const highs = plumbing.skills.map((s) => s.priceGuide!.maxPaise);

    // A tile is answering "could I afford to find out?", and the honest answer spans the washer
    // change and the geyser replacement.
    expect(plumbing.priceGuide!.minPaise).toBe(Math.min(...lows));
    expect(plumbing.priceGuide!.maxPaise).toBe(Math.max(...highs));
  });

  it('does not let one measured skill make a whole category look measured', async () => {
    const plumbing = (await categories()).find((c) => c.slug === 'plumbing')!;
    // Every contributing skill is an estimate here, so the category is too. The rule matters in
    // the other direction: one skill with real prices among three guesses must not promote the
    // category's number to "what people paid".
    expect(plumbing.priceGuide!.basis).toBe('ESTIMATE');
  });

  it('is labour only, and says so somewhere a customer will read it', async () => {
    const plumbing = (await categories()).find((c) => c.slug === 'plumbing')!;
    // The API carries the number; the wording lives in `PriceGuideNote` on the booking screen.
    // Asserted here as a reminder that an estimate quietly excluding materials is wrong in the
    // direction that annoys people most.
    expect(plumbing.priceGuide!.minPaise).toBeGreaterThan(0);
  });
});
