import {
  DEFAULT_FEE_POLICY,
  MAX_BID_REVISIONS,
  MAX_ACTIVE_BIDS_PER_JOB,
  compareForSort,
  computeQuote,
  explainEmptyFeed,
  haversineKm,
  matchesFilters,
  providerEligibility,
  rankScore,
  validateBid,
  type BidView,
  type FeedFacetsView,
  type FeedFilters,
  type FilterableJob,
  type Language,
  type NearbyJobItem,
  type OfferView,
  type ProviderProfileView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { BidRecord, DataStore, JobRecord, ProviderProfileRecord } from '../../data/types';
import { AppError, forbidden, notFound } from '../../lib/errors';

export interface ProviderDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
}

/** How long a provider's offer stays live once placed. */
const OFFER_TTL_MINUTES = 45;

/** Statuses in which a job still accepts offers - mirrors bids_require_open_job in SQL. */
const ACCEPTING_OFFERS: JobRecord['status'][] = ['OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING'];

export function providerService(d: ProviderDeps) {
  const { store, adapters } = d;

  async function profileOrThrow(userId: string): Promise<ProviderProfileRecord> {
    const p = await store.users.getProviderProfile(userId);
    if (!p) throw notFound('provider profile');
    return p;
  }

  /** Where the provider is working from: their saved base, else the pilot centre. */
  async function providerBase(p: ProviderProfileRecord) {
    if (p.base_lat != null && p.base_lng != null) return { lat: p.base_lat, lng: p.base_lng };
    return { lat: d.env.PILOT_CENTER_LAT, lng: d.env.PILOT_CENTER_LNG };
  }

  /** Plain-language reasons the provider is not receiving work right now. */
  function profileBlockers(p: ProviderProfileRecord, skillCount: number): string[] {
    const blockers: string[] = [];
    if (p.verification_status !== 'VERIFIED') blockers.push('VERIFICATION_PENDING');
    if (!p.is_available) blockers.push('AVAILABILITY_OFF');
    if (skillCount === 0) blockers.push('NO_SKILLS_SELECTED');
    if (p.base_lat == null) blockers.push('NO_BASE_LOCATION');
    if (p.suspended_until && p.suspended_until > new Date()) blockers.push('SUSPENDED');
    return blockers;
  }

  async function skillsOf(providerId: string) {
    const cats = await store.categories.listEnabled();
    const all = await store.categories.listSkills(cats.map((c) => c.id));
    const mine = await store.users.listProviderSkills(providerId);
    return all.filter((s) => mine.includes(s.id));
  }

  async function toProfileView(userId: string, lang: Language): Promise<ProviderProfileView> {
    const p = await profileOrThrow(userId);
    const [skills, kyc] = await Promise.all([skillsOf(userId), store.kyc.listForUser(userId)]);
    return {
      userId,
      businessName: p.business_name,
      bio: p.bio,
      experienceYears: p.experience_years,
      serviceRadiusKm: Number(p.service_radius_km),
      isAvailable: p.is_available,
      verificationStatus: p.verification_status,
      blockers: profileBlockers(p, skills.length),
      reliabilityScore: Number(p.reliability_score),
      ratingAvg: p.rating_avg == null ? null : Number(p.rating_avg),
      ratingCount: p.rating_count,
      completedJobs: p.completed_jobs,
      strikeCount: p.strike_count,
      suspendedUntil: p.suspended_until?.toISOString() ?? null,
      baseAddressId: null,
      skills: skills.map((s) => ({ id: s.id, slug: s.slug, name: lang === 'hi' ? s.name_hi : s.name_en, categoryId: s.category_id })),
      kyc: kyc.map((k) => ({
        id: k.id,
        documentType: k.document_type,
        status: k.status,
        last4: k.doc_number_last4,
        rejectionReason: k.rejection_reason,
        submittedAt: k.created_at.toISOString(),
      })),
    };
  }

  function bidTotals(b: { labour_paise: number; visit_fee_paise: number }) {
    return computeQuote({ labourPaise: Number(b.labour_paise), visitFeePaise: Number(b.visit_fee_paise) }, DEFAULT_FEE_POLICY);
  }

  function toBidView(b: BidRecord): BidView {
    const q = bidTotals(b);
    return {
      id: b.id,
      jobId: b.job_id,
      labourPaise: Number(b.labour_paise),
      visitFeePaise: Number(b.visit_fee_paise),
      totalPaise: q.totalPaise,
      platformFeePaise: q.platformFeePaise,
      taxPaise: q.taxPaise,
      etaMinutes: b.eta_minutes,
      warrantyDays: b.warranty_days,
      materialResponsibility: b.material_responsibility,
      notes: b.notes,
      revisionNo: b.revision_no,
      revisionsLeft: Math.max(0, MAX_BID_REVISIONS - b.revision_no),
      status: b.status,
      expiresAt: b.expires_at.toISOString(),
      createdAt: b.created_at.toISOString(),
    };
  }

  /**
   * Checks the provider may quote on this job at all. Runs on the feed and again on every
   * bid, so a provider can never quote on something they were not eligible to see.
   */
  async function eligibilityFor(job: JobRecord, p: ProviderProfileRecord, skillIds: string[]) {
    const base = await providerBase(p);
    const distanceKm = job.lat != null && job.lng != null ? haversineKm(base, { lat: job.lat, lng: job.lng }) : Number.POSITIVE_INFINITY;
    const roles = await store.users.listRoles(p.user_id);
    const providerRole = roles.find((r) => r.role === 'PROVIDER');
    const result = providerEligibility({
      verificationStatus: p.verification_status,
      roleStatus: providerRole?.status ?? 'REVOKED',
      isAvailable: p.is_available,
      distanceKm,
      serviceRadiusKm: Number(p.service_radius_km),
      providerSkillIds: skillIds,
      requiredSkillIds: job.skill_ids,
      categoryIds: await categoryIdsForSkills(skillIds),
      jobCategoryId: job.category_id,
      reliabilityScore: Number(p.reliability_score),
      suspendedUntil: p.suspended_until,
    });
    return { ...result, distanceKm };
  }

  async function categoryIdsForSkills(skillIds: string[]): Promise<string[]> {
    const cats = await store.categories.listEnabled();
    const all = await store.categories.listSkills(cats.map((c) => c.id));
    return [...new Set(all.filter((s) => skillIds.includes(s.id)).map((s) => s.category_id))];
  }

  return {
    toProfileView,
    toBidView,
    profileOrThrow,
    eligibilityFor,

    async updateProfile(userId: string, input: Record<string, unknown>) {
      const p = await profileOrThrow(userId);
      const patch: ProviderProfileRecord = { ...p };
      if (input.businessName !== undefined) patch.business_name = input.businessName as string;
      if (input.bio !== undefined) patch.bio = input.bio as string;
      if (input.experienceYears !== undefined) patch.experience_years = input.experienceYears as number;
      if (input.serviceRadiusKm !== undefined) patch.service_radius_km = input.serviceRadiusKm as number;
      if (input.baseAddressId !== undefined) {
        const address = await store.addresses.get(input.baseAddressId as string);
        if (!address || address.deleted_at) throw notFound('address');
        if (address.user_id !== userId) throw forbidden('not your address');
        patch.base_lat = address.lat;
        patch.base_lng = address.lng;
      }
      await store.users.upsertProviderProfile(patch);
      if (input.skillIds !== undefined) {
        const cats = await store.categories.listEnabled();
        const all = await store.categories.listSkills(cats.map((c) => c.id));
        const valid = (input.skillIds as string[]).filter((id) => all.some((s) => s.id === id));
        await store.users.setProviderSkills(userId, valid);
      }
      return patch;
    },

    async setAvailability(userId: string, isAvailable: boolean) {
      const p = await profileOrThrow(userId);
      // Turning availability on is only meaningful once the provider is verified.
      if (isAvailable && p.verification_status !== 'VERIFIED') {
        throw new AppError('FORBIDDEN', { details: { reason: 'verification_pending' } });
      }
      await store.users.upsertProviderProfile({ ...p, is_available: isAvailable });
      return isAvailable;
    },

    async submitKyc(userId: string, input: { documentType: string; documentNumber: string; mime: string; sizeBytes: number }) {
      const open = await store.kyc.findOpen(userId, input.documentType);
      if (open) throw new AppError('CONFLICT', { details: { reason: 'already_submitted' } });
      if (input.sizeBytes > 8 * 1024 * 1024) throw new AppError('VALIDATION_ERROR', { details: { field: 'sizeBytes' } });

      const key = `kyc/${userId}/${input.documentType}/${Date.now()}`;
      const target = await adapters.storage.createUploadUrl({ key, mime: input.mime, maxBytes: input.sizeBytes });
      // Only the last four characters are persisted; the number itself is never stored.
      const last4 = input.documentNumber.replace(/\s/g, '').slice(-4).toUpperCase();
      const rec = await store.kyc.submit({
        user_id: userId,
        document_type: input.documentType,
        storage_key_encrypted: key,
        doc_number_last4: last4,
        status: 'SUBMITTED',
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
      });
      const p = await profileOrThrow(userId);
      if (p.verification_status === 'UNVERIFIED' || p.verification_status === 'REJECTED') {
        await store.users.upsertProviderProfile({ ...p, verification_status: 'SUBMITTED' });
      }
      adapters.analytics.track('kyc_submitted', { userId, documentType: input.documentType });
      return { record: rec, upload: target, uploadRequired: !adapters.storage.isMock };
    },

    /** Jobs this provider may quote on right now, nearest first. */
    /**
     * The feed, optionally narrowed.
     *
     * Filtering happens here rather than in the app for a reason that matters: the feed is
     * already trimmed to what this provider is *eligible* for, and eligibility is not something
     * a client gets to widen. A filter can only narrow what the server already decided to show.
     */
    async nearbyFeed(userId: string, lang: Language, limit: number, filters: FeedFilters = {}) {
      const p = await profileOrThrow(userId);
      const skills = await skillsOf(userId);
      const skillIds = skills.map((s) => s.id);
      const blockers = profileBlockers(p, skillIds.length);
      if (blockers.length) return { items: [], blockers };

      const categoryIds = await categoryIdsForSkills(skillIds);
      const [jobs, cats] = await Promise.all([store.jobs.listOpenForFeed({ categoryIds, limit: limit * 3 }), store.categories.listEnabled()]);

      const items: NearbyJobItem[] = [];
      // Kept alongside `items` so a filter reads from the same order as the view it narrows.
      const candidates: FilterableJob[] = [];
      for (const job of jobs) {
        const { eligible, distanceKm } = await eligibilityFor(job, p, skillIds);
        if (!eligible) continue;
        if (job.bid_window_ends_at && job.bid_window_ends_at < new Date()) continue;

        const [media, bids, mine] = await Promise.all([
          store.jobs.listMedia(job.id, 'REQUEST'),
          store.jobs.listMedia(job.id, 'REQUEST').then(() => store.bids.listForJob(job.id, ['ACTIVE'])),
          store.bids.findActive(job.id, userId),
        ]);
        const cat = cats.find((c) => c.id === job.category_id);
        const snap = job.address_snapshot as { societyName?: string | null; city?: string } | null;
        candidates.push({
          categoryId: job.category_id,
          distanceKm: Math.round(distanceKm * 10) / 10,
          priority: job.priority,
          requestType: job.request_type,
          bidCount: bids.length,
          hasMyBid: !!mine,
          hasMedia: media.length > 0,
          postedAt: job.submitted_at ?? job.created_at,
          preferredStart: job.preferred_start,
          // Before anyone bids there is no price, so the customer's own signal is the best
          // guess there is: an urgent job is usually a bigger one.
          estimatedValuePaise: bids.length
            ? Math.round(bids.reduce((t, b) => t + Number(b.labour_paise), 0) / bids.length)
            : job.priority === 'URGENT'
              ? 150_000
              : 80_000,
        });
        items.push({
          jobId: job.id,
          categoryName: cat ? (lang === 'hi' ? cat.name_hi : cat.name_en) : 'Service',
          categoryIconKey: cat?.icon_key ?? 'default',
          description: job.description,
          priority: job.priority,
          requestType: job.request_type,
          inspectionRequired: job.inspection_required,
          distanceKm: Math.round(distanceKm * 10) / 10,
          // Only the area is shown until a provider is confirmed (PRIVACY_DATA_MAP).
          areaLabel: snap?.societyName ?? snap?.city ?? 'Nearby',
          photoCount: media.filter((m) => m.kind === 'PHOTO').length,
          hasVoiceNote: media.some((m) => m.kind === 'VOICE_NOTE'),
          preferredStart: job.preferred_start?.toISOString() ?? null,
          bidWindowEndsAt: job.bid_window_ends_at?.toISOString() ?? null,
          bidCount: bids.length,
          myBid: mine
            ? { id: mine.id, labourPaise: Number(mine.labour_paise), visitFeePaise: Number(mine.visit_fee_paise), revisionNo: mine.revision_no, status: mine.status }
            : null,
          postedAt: (job.submitted_at ?? job.created_at).toISOString(),
        });
        // Deliberately not `>= limit` here: filters are applied afterwards, so stopping at the
        // limit before filtering would return a short page whenever a filter is on.
        if (items.length >= limit * 3) break;
      }

      const eligibleCount = items.length;
      const kept = items.filter((_item, i) => matchesFilters(candidates[i]!, filters));
      const keptCandidates = candidates.filter((c) => matchesFilters(c, filters));

      // Sorted together so the two arrays stay aligned.
      const order = keptCandidates
        .map((c, i) => ({ c, i }))
        .sort((a, b) => compareForSort(filters.sort ?? 'NEAREST')(a.c, b.c))
        .map((x) => x.i);

      return {
        items: order.slice(0, limit).map((i) => kept[i]!),
        blockers: [],
        facets: facetsFor(candidates, items, eligibleCount),
        // An empty feed with no explanation reads as "there is no work", which is a different
        // and much worse message than "your filters are narrow".
        emptyReason: order.length === 0 ? explainEmptyFeed(filters, eligibleCount > 0) : null,
      };
    },

    /** Places a new offer. The first offer on a job also moves it to BID_RECEIVED. */
    async placeBid(
      job: JobRecord,
      providerId: string,
      terms: { labourPaise: number; visitFeePaise: number; etaMinutes: number; warrantyDays: number; materialResponsibility: BidRecord['material_responsibility']; notes?: string },
    ) {
      if (!ACCEPTING_OFFERS.includes(job.status)) {
        throw new AppError('CONFLICT', { details: { reason: 'job_not_accepting_offers', status: job.status } });
      }
      const p = await profileOrThrow(providerId);
      const skills = await skillsOf(providerId);
      const { eligible, reasons } = await eligibilityFor(job, p, skills.map((s) => s.id));
      if (!eligible) throw new AppError('FORBIDDEN', { details: { eligibility: reasons } });

      const [existing, active] = await Promise.all([store.bids.findActive(job.id, providerId), store.bids.listForJob(job.id, ['ACTIVE'])]);
      const errors = validateBid(
        { labourPaise: terms.labourPaise, visitFeePaise: terms.visitFeePaise, etaMinutes: terms.etaMinutes, warrantyDays: terms.warrantyDays },
        {
          windowEndsAt: job.bid_window_ends_at ?? new Date(Date.now() + 60_000),
          existingActiveBidByProvider: !!existing,
          revisionNo: 0,
          activeBidCount: active.length,
        },
      );
      if (errors.length) throw new AppError('VALIDATION_ERROR', { details: { bid: errors } });

      const bid = await store.bids.create({
        job_id: job.id,
        provider_id: providerId,
        contractor_id: p.contractor_id,
        labour_paise: terms.labourPaise,
        visit_fee_paise: terms.visitFeePaise,
        eta_minutes: terms.etaMinutes,
        warranty_days: terms.warrantyDays,
        material_responsibility: terms.materialResponsibility,
        notes: terms.notes ?? null,
        revision_no: 0,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + OFFER_TTL_MINUTES * 60_000),
        withdrawn_reason: null,
      });
      await store.bids.addRevision({
        bid_id: bid.id,
        revision_no: 0,
        labour_paise: terms.labourPaise,
        visit_fee_paise: terms.visitFeePaise,
        eta_minutes: terms.etaMinutes,
        warranty_days: terms.warrantyDays,
        notes: terms.notes ?? null,
      });
      adapters.analytics.track('bid_submitted', { userId: providerId, jobId: job.id });
      return bid;
    },

    async reviseBid(
      bid: BidRecord,
      job: JobRecord,
      terms: { labourPaise: number; visitFeePaise: number; etaMinutes: number; warrantyDays: number; materialResponsibility: BidRecord['material_responsibility']; notes?: string },
    ) {
      if (bid.status !== 'ACTIVE') throw new AppError('CONFLICT', { details: { reason: 'bid_not_active', status: bid.status } });
      const nextRevision = bid.revision_no + 1;
      const errors = validateBid(
        { labourPaise: terms.labourPaise, visitFeePaise: terms.visitFeePaise, etaMinutes: terms.etaMinutes, warrantyDays: terms.warrantyDays },
        {
          windowEndsAt: job.bid_window_ends_at ?? new Date(Date.now() + 60_000),
          existingActiveBidByProvider: true,
          revisionNo: nextRevision,
          activeBidCount: 0,
        },
      );
      if (errors.length) throw new AppError('VALIDATION_ERROR', { details: { bid: errors } });

      const updated = await store.bids.update(bid.id, {
        labour_paise: terms.labourPaise,
        visit_fee_paise: terms.visitFeePaise,
        eta_minutes: terms.etaMinutes,
        warranty_days: terms.warrantyDays,
        material_responsibility: terms.materialResponsibility,
        notes: terms.notes ?? null,
        revision_no: nextRevision,
        expires_at: new Date(Date.now() + OFFER_TTL_MINUTES * 60_000),
      });
      await store.bids.addRevision({
        bid_id: bid.id,
        revision_no: nextRevision,
        labour_paise: terms.labourPaise,
        visit_fee_paise: terms.visitFeePaise,
        eta_minutes: terms.etaMinutes,
        warranty_days: terms.warrantyDays,
        notes: terms.notes ?? null,
      });
      return updated;
    },

    async withdrawBid(bid: BidRecord, reason: string) {
      if (bid.status !== 'ACTIVE') throw new AppError('CONFLICT', { details: { reason: 'bid_not_active' } });
      return store.bids.update(bid.id, { status: 'WITHDRAWN', withdrawn_reason: reason });
    },

    /** Offers as the customer sees them: ranked, with limited provider identity. */
    async offersForCustomer(job: JobRecord): Promise<OfferView[]> {
      const bids = await store.bids.listForJob(job.id, ['ACTIVE']);
      const live = bids.filter((b) => b.expires_at > new Date());
      if (live.length === 0) return [];

      const totals = live.map((b) => Number(b.labour_paise) + Number(b.visit_fee_paise)).sort((a, b) => a - b);
      const medianTotalPaise = totals[Math.floor(totals.length / 2)] ?? 0;

      const out: OfferView[] = [];
      for (const b of live) {
        const p = await store.users.getProviderProfile(b.provider_id);
        const skillIds = await store.users.listProviderSkills(b.provider_id);
        const base = p ? await providerBase(p) : { lat: d.env.PILOT_CENTER_LAT, lng: d.env.PILOT_CENTER_LNG };
        const distanceKm = job.lat != null && job.lng != null ? haversineKm(base, { lat: job.lat, lng: job.lng }) : 0;
        const required = job.skill_ids;
        const skillMatchRatio = required.length === 0 ? 1 : required.filter((s) => skillIds.includes(s)).length / required.length;

        out.push({
          ...toBidView(b),
          provider: {
            id: b.provider_id,
            businessName: p?.business_name ?? 'Verified professional',
            verified: p?.verification_status === 'VERIFIED',
            ratingAvg: p?.rating_avg == null ? null : Number(p.rating_avg),
            ratingCount: p?.rating_count ?? 0,
            completedJobs: p?.completed_jobs ?? 0,
            experienceYears: p?.experience_years ?? null,
            distanceKm: Math.round(distanceKm * 10) / 10,
          },
          rankScore: rankScore(
            {
              labourPaise: Number(b.labour_paise),
              visitFeePaise: Number(b.visit_fee_paise),
              etaMinutes: b.eta_minutes,
              distanceKm,
              completedJobs: p?.completed_jobs ?? 0,
              reliabilityScore: Number(p?.reliability_score ?? 5),
              ratingAvg: p?.rating_avg == null ? null : Number(p.rating_avg),
              skillMatchRatio,
            },
            { medianTotalPaise },
          ),
          sponsored: false,
        });
      }
      out.sort((a, b) => b.rankScore - a.rankScore);
      return out;
    },

    MAX_ACTIVE_BIDS_PER_JOB,
  };
}

/**
 * The filter values worth offering, built from what is actually in this provider's feed today
 * rather than from the whole catalog. A filter for a category with nothing in it is a dead end
 * somebody has to discover by tapping it.
 */
function facetsFor(candidates: FilterableJob[], items: Array<{ categoryName: string }>, total: number): FeedFacetsView {
  const categories = new Map<string, { name: string; count: number }>();
  const priorities = new Map<FilterableJob['priority'], number>();
  const requestTypes = new Map<FilterableJob['requestType'], number>();

  candidates.forEach((c, i) => {
    const existing = categories.get(c.categoryId);
    categories.set(c.categoryId, { name: existing?.name ?? items[i]?.categoryName ?? 'Service', count: (existing?.count ?? 0) + 1 });
    priorities.set(c.priority, (priorities.get(c.priority) ?? 0) + 1);
    requestTypes.set(c.requestType, (requestTypes.get(c.requestType) ?? 0) + 1);
  });

  return {
    categories: [...categories.entries()].map(([id, v]) => ({ id, name: v.name, count: v.count })).sort((a, b) => b.count - a.count),
    priorities: [...priorities.entries()].map(([value, count]) => ({ value, count })),
    requestTypes: [...requestTypes.entries()].map(([value, count]) => ({ value, count })),
    furthestKm: candidates.reduce((max, c) => Math.max(max, c.distanceKm), 0),
    total,
  };
}

export type ProviderService = ReturnType<typeof providerService>;
