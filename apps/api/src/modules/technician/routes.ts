import type { FastifyInstance } from 'fastify';
import { forbidden, notFound } from '../../lib/errors';
import { requireAuth } from '../../plugins/auth';
import type { AppContext } from '../../app';

/**
 * What a technician can see.
 *
 * A technician does not win work, quote for it or get paid by us - their contractor does all
 * three. What they need is narrow and specific: which jobs they were sent on today, and where.
 * Until now they had neither, because every "my jobs" route in the system filters on
 * `provider_id`, and a technician is never the provider.
 *
 * The address is included, and deliberately: the whole point of assigning somebody is that they
 * turn up. Everything else about the job - the price, the payout, the customer's other bookings -
 * is not theirs to see, and none of it is here.
 */
export async function technicianRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;

  function requireTechnician(req: Parameters<typeof requireAuth>[0]) {
    const auth = requireAuth(req);
    if (auth.activeRole !== 'TECHNICIAN') throw forbidden('technicians only');
    return auth;
  }

  app.get('/technician/profile', async (req) => {
    const auth = requireTechnician(req);
    const profile = await store.users.getTechnicianProfile(auth.userId);
    if (!profile) throw notFound('technician profile');
    const contractor = profile.contractor_id ? await store.users.getContractorProfile(profile.contractor_id) : null;
    return {
      fullName: profile.full_name,
      verificationStatus: profile.verification_status,
      active: profile.active,
      /** Who is answerable for them, which is what a customer is really being told. */
      teamName: contractor?.business_name ?? null,
    };
  });

  /**
   * The jobs this technician was sent on. Live ones first, because the screen exists to answer
   * "where am I going next" rather than "what have I done".
   */
  app.get('/technician/jobs', async (req) => {
    const auth = requireTechnician(req);
    const assignments = await store.negotiation.listAssignmentsForTechnician(auth.userId, 50);
    const categories = await store.categories.listEnabled();

    const items = await Promise.all(
      assignments.map(async (a) => {
        const job = await store.jobs.get(a.job_id);
        if (!job) return null;
        const snapshot = job.address_snapshot as
          | { line1?: string; landmark?: string; societyName?: string; city?: string; pincode?: string }
          | null;
        const customer = await store.users.findById(job.customer_id);

        return {
          jobId: job.id,
          status: job.status,
          categoryName: categories.find((c) => c.id === job.category_id)?.name_en ?? 'Service',
          description: job.description,
          preferredStart: job.preferred_start?.toISOString() ?? null,
          // A first name only, as everywhere else a counterparty is shown.
          customerName: customer?.display_name?.split(' ')[0] ?? 'Customer',
          // The full address: somebody who has been assigned has to be able to arrive.
          address: snapshot
            ? [snapshot.line1, snapshot.landmark, snapshot.societyName, snapshot.city, snapshot.pincode].filter(Boolean).join(', ')
            : null,
          lat: job.lat,
          lng: job.lng,
        };
      }),
    );

    // Live work first; the rest in the order it happened.
    const live = ['PROVIDER_ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'STARTED', 'IN_PROGRESS', 'PRICE_REVISION_PENDING', 'COMPLETION_PENDING'];
    const rows = items.filter((i): i is NonNullable<typeof i> => !!i);
    rows.sort((a, b) => Number(live.includes(b.status)) - Number(live.includes(a.status)));
    return { items: rows };
  });
}
