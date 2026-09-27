import type { FastifyInstance } from 'fastify';
import type { CategoryView, Language, PriceGuide } from '@hyperlocal/core';
import type { AppContext } from '../../app';

export async function categoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/categories', async (req) => {
    const lang: Language = req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en';
    const cats = await ctx.store.categories.listEnabled();
    const skills = await ctx.store.categories.listSkills(cats.map((c) => c.id));
    const guides = await ctx.store.categories.priceGuides();
    const guideFor = new Map(guides.map((g) => [g.skillId, g]));

    /**
     * One range for a whole category, from its skills.
     *
     * The widest span rather than an average, because a category tile is answering "could I
     * afford to find out?" and the honest answer spans a washer change and a geyser
     * replacement. `basis` is only `ACTUAL` when **every** contributing skill is - one measured
     * skill among four guesses does not make the category's number a measurement.
     */
    function rollUp(ids: string[]): PriceGuide | null {
      const rows = ids.map((id) => guideFor.get(id)).filter((g): g is NonNullable<typeof g> => !!g);
      if (rows.length === 0) return null;
      return {
        minPaise: Math.min(...rows.map((r) => r.minPaise)),
        maxPaise: Math.max(...rows.map((r) => r.maxPaise)),
        basis: rows.every((r) => r.basis === 'ACTUAL') ? 'ACTUAL' : 'ESTIMATE',
        sampleSize: rows.reduce((t, r) => t + r.sampleSize, 0),
      };
    }

    const items: CategoryView[] = cats.map((c) => {
      const mine = skills.filter((s) => s.category_id === c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: lang === 'hi' ? c.name_hi : c.name_en,
        iconKey: c.icon_key,
        requiresInspectionDefault: c.requires_inspection_default,
        skills: mine.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: lang === 'hi' ? s.name_hi : s.name_en,
          riskLevel: s.risk_level,
          priceGuide: guideFor.get(s.id) ?? null,
        })),
        priceGuide: rollUp(mine.map((s) => s.id)),
      };
    });
    return { items };
  });
}
