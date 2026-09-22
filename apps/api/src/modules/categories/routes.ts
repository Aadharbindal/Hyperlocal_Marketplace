import type { FastifyInstance } from 'fastify';
import type { CategoryView, Language } from '@hyperlocal/core';
import type { AppContext } from '../../app';

export async function categoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/categories', async (req) => {
    const lang: Language = req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en';
    const cats = await ctx.store.categories.listEnabled();
    const skills = await ctx.store.categories.listSkills(cats.map((c) => c.id));
    const items: CategoryView[] = cats.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: lang === 'hi' ? c.name_hi : c.name_en,
      iconKey: c.icon_key,
      requiresInspectionDefault: c.requires_inspection_default,
      skills: skills
        .filter((s) => s.category_id === c.id)
        .map((s) => ({ id: s.id, slug: s.slug, name: lang === 'hi' ? s.name_hi : s.name_en, riskLevel: s.risk_level })),
    }));
    return { items };
  });
}
