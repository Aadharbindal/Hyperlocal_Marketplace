import {
  REFERRAL_REWARD_PAISE,
  checkPromo,
  checkReferral,
  explainPromoBlocker,
  financialYearOf,
  invoiceNumber,
  promoDiscountPaise,
  receiptTotals,
  referralCodeFor,
  referralQualifies,
  type FavouriteProviderView,
  type InvoiceView,
  type PromoPreview,
  type PromoTerms,
  type ReferralView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { DataStore, InvoiceRecord, JobRecord, PromoCodeRecord, UserRecord } from '../../data/types';
import { AppError, forbidden, notFound } from '../../lib/errors';

export interface GrowthDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
}

function blocked(code: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_ERROR', { details: { growth: [code], ...extra } });
}

export function growthService(d: GrowthDeps) {
  const { store, adapters } = d;

  const termsOf = (p: PromoCodeRecord): PromoTerms => ({
    kind: p.kind,
    value: p.value,
    maxDiscountPaise: p.max_discount_paise === null ? null : Number(p.max_discount_paise),
    minOrderPaise: Number(p.min_order_paise),
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    maxRedemptions: p.max_redemptions,
    maxPerCustomer: p.max_per_customer,
    firstJobOnly: p.first_job_only,
    redemptionCount: p.redemption_count,
    active: p.active,
  });

  /** How many jobs this person has actually seen through. Used by promo and referral rules. */
  async function completedJobCount(customerId: string): Promise<number> {
    const jobs = await store.jobs.listForCustomer(customerId, { statuses: ['COMPLETED', 'SETTLED'], limit: 100 });
    return jobs.length;
  }

  return {
    // ------------------------------------------------------------------ receipts
    /**
     * Issues the receipt for a finished job.
     *
     * Every figure is copied in rather than joined at read time. A receipt is a statement of
     * what was charged on a given day: if a later correction changes the ledger, that is a
     * credit note, not a quiet edit to a document somebody has already filed with their
     * accounts.
     */
    async issueInvoice(job: JobRecord): Promise<InvoiceRecord | null> {
      const existing = await store.growth.getInvoiceForJob(job.id);
      if (existing) return existing;

      const quote = await store.negotiation.getActiveQuote(job.id);
      if (!quote) return null;

      const [provider, category, refunds, orders] = await Promise.all([
        store.users.getProviderProfile(quote.provider_id),
        store.categories.listEnabled(),
        store.finance.listRefundsForJob(job.id),
        store.materials.listOrdersForJob(job.id),
      ]);

      const refundedPaise = refunds.filter((r) => r.status !== 'FAILED').reduce((t, r) => t + Number(r.amount_paise), 0);
      const materialPaise = orders.reduce((t, o) => t + Number(o.total_paise ?? 0), 0);
      const snapshot = job.address_snapshot as { line1?: string; societyName?: string; city?: string; pincode?: string } | null;

      const issuedAt = new Date();
      const sequence = await store.growth.nextInvoiceSequence(financialYearOf(issuedAt));

      return store.growth.createInvoice({
        job_id: job.id,
        customer_id: job.customer_id,
        number: invoiceNumber(sequence, issuedAt),
        labour_paise: Number(quote.labour_paise),
        visit_fee_paise: Number(quote.visit_fee_paise),
        material_paise: materialPaise,
        delivery_paise: Number(quote.delivery_paise),
        platform_fee_paise: Number(quote.platform_fee_paise),
        protection_fee_paise: Number(quote.protection_fee_paise),
        tax_paise: Number(quote.tax_paise),
        total_paise: Number(quote.total_paise) - Number(quote.discount_paise),
        refunded_paise: refundedPaise,
        provider_name: provider?.business_name ?? 'Service professional',
        category_name: category.find((c) => c.id === job.category_id)?.name_en ?? 'Service',
        // Snapshotted: an address the customer later deletes must not change a receipt they hold.
        service_address: snapshot
          ? [snapshot.line1, snapshot.societyName, snapshot.city, snapshot.pincode].filter(Boolean).join(', ')
          : null,
        issued_at: issuedAt,
      });
    },

    async invoiceFor(job: JobRecord, viewerId: string): Promise<InvoiceView> {
      if (job.customer_id !== viewerId) throw forbidden('not your booking');
      const record = (await store.growth.getInvoiceForJob(job.id)) ?? (await this.issueInvoice(job));
      if (!record) throw new AppError('VALIDATION_ERROR', { details: { growth: ['NOTHING_TO_INVOICE'] } });
      return toInvoiceView(record, await store.negotiation.getActiveQuote(job.id));
    },

    async listInvoices(customerId: string): Promise<InvoiceView[]> {
      const rows = await store.growth.listInvoices(customerId, 50);
      return Promise.all(rows.map(async (r) => toInvoiceView(r, await store.negotiation.getActiveQuote(r.job_id))));
    },

    // ------------------------------------------------------------------ favourites
    async addFavourite(customerId: string, providerId: string, note?: string) {
      const profile = await store.users.getProviderProfile(providerId);
      if (!profile) throw notFound('provider');
      await store.growth.addFavourite({ customer_id: customerId, provider_id: providerId, note: note ?? null });
      adapters.analytics.track('provider_favourited', { userId: customerId, providerId });
      return this.listFavourites(customerId);
    },

    async removeFavourite(customerId: string, providerId: string) {
      await store.growth.removeFavourite(customerId, providerId);
      return this.listFavourites(customerId);
    },

    async listFavourites(customerId: string): Promise<FavouriteProviderView[]> {
      const rows = await store.growth.listFavourites(customerId);
      const categories = await store.categories.listEnabled();
      const jobs = await store.jobs.listForCustomer(customerId, { limit: 100 });

      return Promise.all(
        rows.map(async (f) => {
          const [profile, user, skills] = await Promise.all([
            store.users.getProviderProfile(f.provider_id),
            store.users.findById(f.provider_id),
            store.users.listProviderSkills(f.provider_id),
          ]);
          const together = jobs.filter((j) => j.confirmed_provider_id === f.provider_id);
          // listProviderSkills returns skill ids; the categories are looked up from the catalog.
          const providerCategoryIds = new Set((await store.categories.listSkills(categories.map((c) => c.id)))
            .filter((sk) => skills.includes(sk.id))
            .map((sk) => sk.category_id));
          return {
            providerId: f.provider_id,
            businessName: profile?.business_name ?? 'Service professional',
            // A first name only, the same as everywhere else a counterparty is shown.
            contactName: user?.display_name?.split(' ')[0] ?? null,
            ratingAvg: profile?.rating_avg ?? 0,
            ratingCount: profile?.rating_count ?? 0,
            categories: categories.filter((c) => providerCategoryIds.has(c.id)).map((c) => c.name_en),
            // Said honestly, so the button does not promise something that will fail.
            available: !!profile?.is_available && profile.verification_status === 'VERIFIED',
            verified: profile?.verification_status === 'VERIFIED',
            jobsTogether: together.length,
            lastJobAt: together[0]?.created_at.toISOString() ?? null,
            lastJobId: together[0]?.id ?? null,
            note: f.note,
          };
        }),
      );
    },

    // ------------------------------------------------------------------ promo codes
    /**
     * What a code would take off, before anybody commits to it. Checked again at acceptance,
     * because the answer can change between looking and booking.
     */
    async previewPromo(customerId: string, code: string, orderPaise: number): Promise<PromoPreview> {
      const promo = await store.growth.findPromo(code);
      const [redemptions, completed] = await Promise.all([
        promo ? store.growth.countRedemptions(promo.id, customerId) : Promise.resolve(0),
        completedJobCount(customerId),
      ]);

      const problem = checkPromo(promo ? termsOf(promo) : null, {
        orderPaise,
        customerRedemptions: redemptions,
        customerCompletedJobs: completed,
        now: new Date(),
      });
      if (problem || !promo) {
        throw new AppError('VALIDATION_ERROR', {
          details: { promo: [problem ?? 'NOT_FOUND'], message: explainPromoBlocker(problem ?? 'NOT_FOUND', Number(promo?.min_order_paise ?? 0)) },
        });
      }

      const discountPaise = promoDiscountPaise(termsOf(promo), orderPaise);
      return {
        code: promo.code.toUpperCase(),
        kind: promo.kind,
        discountPaise,
        newTotalPaise: orderPaise - discountPaise,
        description:
          promo.kind === 'FLAT'
            ? `Rs ${Math.round(promo.value / 100)} off this booking`
            : `${promo.value / 100}% off, up to Rs ${Math.round(Number(promo.max_discount_paise ?? 0) / 100)}`,
      };
    },

    /** Re-checked at the moment of acceptance and handed to the negotiation service to apply. */
    async resolvePromoForAcceptance(customerId: string, code: string, orderPaise: number) {
      const preview = await this.previewPromo(customerId, code, orderPaise);
      const promo = await store.growth.findPromo(code);
      if (!promo) blocked('NOT_FOUND');
      return { promoId: promo.id, code: preview.code, discountPaise: preview.discountPaise };
    },

    // ------------------------------------------------------------------ referrals
    /** Everyone's code, derived from their id, so there is nothing to allocate. */
    async codeFor(user: UserRecord): Promise<string> {
      if (user.referral_code) return user.referral_code;
      const code = referralCodeFor(user.id);
      await store.users.update(user.id, { referral_code: code });
      return code;
    },

    async referralSummary(user: UserRecord): Promise<ReferralView> {
      const code = await this.codeFor(user);
      const rows = await store.growth.listReferralsBy(user.id);
      const people = await Promise.all(
        rows.map(async (r) => {
          const person = await store.users.findById(r.referred_id);
          return {
            // A first name only. Somebody who joined through a link has not agreed to have their
            // full identity shown to whoever shared it.
            name: person?.display_name?.split(' ')[0] ?? 'A friend',
            status: r.status,
            joinedAt: r.created_at.toISOString(),
            rewardPaise: Number(r.reward_paise),
          };
        }),
      );

      return {
        code,
        rewardPaise: REFERRAL_REWARD_PAISE,
        terms: `You and your friend each get Rs ${REFERRAL_REWARD_PAISE / 100} once they complete their first booking.`,
        invited: rows.length,
        qualified: rows.filter((r) => r.status === 'QUALIFIED' || r.status === 'REWARDED').length,
        earnedPaise: rows.filter((r) => r.status === 'REWARDED').reduce((t, r) => t + Number(r.reward_paise), 0),
        people,
      };
    },

    /** Claiming somebody's code. Only ever before the claimant's first completed booking. */
    async claimReferral(user: UserRecord, code: string) {
      const referrer = await store.users.findByReferralCode(code.trim().toUpperCase());
      const [existing, completed] = await Promise.all([
        store.growth.findReferralForUser(user.id),
        completedJobCount(user.id),
      ]);

      const problem = checkReferral({
        referrerId: referrer?.id ?? null,
        referredId: user.id,
        alreadyReferred: !!existing,
        referredCompletedJobs: completed,
      });
      if (problem || !referrer) blocked(problem ?? 'CODE_NOT_FOUND');

      await store.growth.createReferral({
        referrer_id: referrer.id,
        referred_id: user.id,
        code: code.trim().toUpperCase(),
        status: 'PENDING',
        qualifying_job_id: null,
        reward_paise: 0,
        rewarded_at: null,
        rejection_reason: null,
      });
      adapters.analytics.track('referral_claimed', { userId: user.id, referrerId: referrer.id });
      return { ok: true, referrerName: referrer.display_name?.split(' ')[0] ?? 'your friend' };
    },

    /**
     * Called when a job completes. A referral pays out on **completed work**, never on a
     * signup - rewarding signups is how a referral programme becomes a fraud programme.
     */
    async onJobCompleted(job: JobRecord) {
      const referral = await store.growth.findReferralForUser(job.customer_id);
      if (!referral || referral.status !== 'PENDING') return;

      const openDispute = await store.finance.findOpenDispute(job.id);
      const completed = await completedJobCount(job.customer_id);
      if (!referralQualifies({ referredCompletedJobs: completed, jobWasDisputed: !!openDispute })) return;

      await store.growth.updateReferral(referral.id, {
        status: 'QUALIFIED',
        qualifying_job_id: job.id,
        reward_paise: REFERRAL_REWARD_PAISE,
      });

      // Both sides are told. The reward itself is credited by support for now, which is stated
      // in KNOWN_LIMITATIONS rather than implied by a number on a screen.
      for (const userId of [referral.referrer_id, referral.referred_id]) {
        await store.notifications.create({
          user_id: userId,
          type: 'promo.referral_qualified',
          title: 'Your referral reward is on its way',
          body: 'A friend you invited completed their first booking. Your reward will be credited shortly.',
          data: { jobId: job.id },
          channel: 'IN_APP',
          read_at: null,
          sent_at: new Date(),
        });
      }
      adapters.analytics.track('referral_qualified', { userId: referral.referrer_id, jobId: job.id });
    },
  };
}

function toInvoiceView(r: InvoiceRecord, quote: { discount_paise?: number } | null): InvoiceView {
  const lines = {
    labourPaise: Number(r.labour_paise),
    visitFeePaise: Number(r.visit_fee_paise),
    materialPaise: Number(r.material_paise),
    deliveryPaise: Number(r.delivery_paise),
    platformFeePaise: Number(r.platform_fee_paise),
    protectionFeePaise: Number(r.protection_fee_paise),
    discountPaise: Number(quote?.discount_paise ?? 0),
    taxPaise: Number(r.tax_paise),
    refundedPaise: Number(r.refunded_paise),
  };
  const { netPaise } = receiptTotals(lines);
  return {
    id: r.id,
    number: r.number,
    jobId: r.job_id,
    issuedAt: r.issued_at.toISOString(),
    providerName: r.provider_name,
    categoryName: r.category_name,
    serviceAddress: r.service_address,
    lines: {
      labourPaise: lines.labourPaise,
      visitFeePaise: lines.visitFeePaise,
      materialPaise: lines.materialPaise,
      deliveryPaise: lines.deliveryPaise,
      platformFeePaise: lines.platformFeePaise,
      protectionFeePaise: lines.protectionFeePaise,
      discountPaise: lines.discountPaise,
      taxPaise: lines.taxPaise,
    },
    totalPaise: Number(r.total_paise),
    refundedPaise: lines.refundedPaise,
    netPaise,
  };
}

export type GrowthService = ReturnType<typeof growthService>;
