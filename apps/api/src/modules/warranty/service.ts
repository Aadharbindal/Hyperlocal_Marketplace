import {
  checkCanClaimWarranty,
  checkCanRespondToClaim,
  claimNeedsSupport,
  explainWarrantyBlocker,
  warrantyDaysLeft,
  warrantyExpiresAt,
  type WarrantyClaimView,
  type WarrantyStatusView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { DataStore, JobRecord, WarrantyClaimRecord } from '../../data/types';
import { AppError, forbidden, notFound } from '../../lib/errors';
import type { JobService } from '../jobs/service';

export interface WarrantyDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
}

export function warrantyService(d: WarrantyDeps) {
  const { store, adapters, jobs } = d;

  async function notify(userId: string, type: string, title: string, body: string, jobId: string) {
    await store.notifications.create({
      user_id: userId,
      type,
      title,
      body,
      data: { jobId },
      channel: 'IN_APP',
      read_at: null,
      sent_at: new Date(),
    });
  }

  /** The warranty actually agreed on this job, and when the work was signed off. */
  async function termsFor(job: JobRecord) {
    const quote = await store.negotiation.getActiveQuote(job.id);
    const completion = await store.execution.latestCompletion(job.id);
    return {
      warrantyDays: quote ? quote.warranty_days : 0,
      providerId: quote?.provider_id ?? job.confirmed_provider_id,
      // The clock starts when the customer approved the work, not when it was submitted.
      completedAt: completion?.approved_at ?? job.completed_at,
    };
  }

  async function toView(claim: WarrantyClaimRecord): Promise<WarrantyClaimView> {
    const [job, provider, categories, media] = await Promise.all([
      store.jobs.get(claim.job_id),
      store.users.getProviderProfile(claim.provider_id),
      store.categories.listEnabled(),
      store.jobs.listMedia(claim.job_id),
    ]);
    return {
      id: claim.id,
      jobId: claim.job_id,
      categoryName: categories.find((c) => c.id === job?.category_id)?.name_en ?? 'Service',
      status: claim.status,
      description: claim.description,
      mediaUrls: media.filter((m) => claim.media_ids.includes(m.id)).map((m) => m.storage_key),
      warrantyDays: claim.warranty_days,
      coveredUntil: claim.covered_until.toISOString(),
      providerName: provider?.business_name ?? 'Your professional',
      providerResponse: claim.provider_response,
      declineReason: claim.decline_reason,
      revisitJobId: claim.revisit_job_id,
      awaitingSupport: claimNeedsSupport({ status: claim.status, createdAt: claim.created_at, now: new Date() }),
      resolutionNote: claim.resolution_note,
      createdAt: claim.created_at.toISOString(),
    };
  }

  return {
    /**
     * What a finished job says about its own warranty. The app should never have to work this
     * out: whether cover is live, how long is left, and whether a claim can be made right now.
     */
    async statusFor(job: JobRecord, viewerId: string): Promise<WarrantyStatusView> {
      if (job.customer_id !== viewerId) throw forbidden('not your booking');
      const { warrantyDays, completedAt } = await termsFor(job);
      const existing = await store.trust.findOpenClaim(job.id);
      const now = new Date();

      const problem = checkCanClaimWarranty({
        jobStatus: job.status,
        isCustomer: true,
        warrantyDays,
        completedAt,
        hasOpenClaim: !!existing,
        hasOpenDispute: !!(await store.finance.findOpenDispute(job.id)),
        now,
      });

      return {
        warrantyDays,
        coveredUntil: completedAt && warrantyDays > 0 ? warrantyExpiresAt(completedAt, warrantyDays).toISOString() : null,
        daysLeft: completedAt && warrantyDays > 0 ? warrantyDaysLeft(completedAt, warrantyDays, now) : 0,
        active: !!completedAt && warrantyDays > 0 && warrantyExpiresAt(completedAt, warrantyDays) >= now,
        canClaim: problem === null,
        reason: problem ? explainWarrantyBlocker(problem, warrantyDays) : null,
        claim: existing ? await toView(existing) : null,
      };
    },

    /**
     * Raising a claim.
     *
     * Deliberately not a dispute: this is "the work was fine and it has come back", which
     * usually ends with the same professional returning at no charge. Filing it as a dispute
     * would hang a strike-shaped cloud over somebody who has done nothing wrong, and
     * professionals would quietly stop offering warranties at all.
     */
    async raise(job: JobRecord, customerId: string, input: { description: string; mediaIds?: string[] }) {
      const { warrantyDays, completedAt, providerId } = await termsFor(job);
      const problem = checkCanClaimWarranty({
        jobStatus: job.status,
        isCustomer: job.customer_id === customerId,
        warrantyDays,
        completedAt,
        hasOpenClaim: !!(await store.trust.findOpenClaim(job.id)),
        hasOpenDispute: !!(await store.finance.findOpenDispute(job.id)),
        now: new Date(),
      });
      // Not being the customer is an authorization failure, not a bad request, and is answered
      // the same way every other "this is not yours" is.
      if (problem === 'NOT_YOUR_JOB') throw forbidden('not your booking');
      if (problem) {
        throw new AppError('VALIDATION_ERROR', {
          details: { warranty: [problem], message: explainWarrantyBlocker(problem, warrantyDays) },
        });
      }
      if (!providerId || !completedAt) throw notFound('booking');

      const claim = await store.trust.createClaim({
        job_id: job.id,
        customer_id: customerId,
        provider_id: providerId,
        description: input.description,
        media_ids: input.mediaIds ?? [],
        status: 'OPEN',
        warranty_days: warrantyDays,
        covered_until: warrantyExpiresAt(completedAt, warrantyDays),
        provider_response: null,
        responded_at: null,
        decline_reason: null,
        revisit_job_id: null,
        resolved_at: null,
        resolution_note: null,
      });

      await notify(
        providerId,
        'warranty.claimed',
        'A warranty claim on your work',
        'A customer says something you fixed has come back. Answer within 48 hours.',
        job.id,
      );
      adapters.analytics.track('warranty_claimed', { userId: customerId, jobId: job.id });
      return toView(claim);
    },

    /** The professional's answer. Declining is allowed, but never without an explanation. */
    async respond(claimId: string, providerId: string, input: { response: 'ACCEPT' | 'DECLINE'; reason?: string; proposedStart?: string }) {
      const claim = await store.trust.getClaim(claimId);
      if (!claim) throw notFound('claim');

      const problem = checkCanRespondToClaim({
        isProvider: claim.provider_id === providerId,
        status: claim.status,
        response: input.response,
        reason: input.reason,
      });
      if (problem === 'NOT_YOUR_CLAIM') throw forbidden('not your claim');
      if (problem) throw new AppError('VALIDATION_ERROR', { details: { warranty: [problem] } });

      if (input.response === 'DECLINE') {
        const declined = await store.trust.updateClaim(claim.id, {
          status: 'DECLINED',
          decline_reason: input.reason ?? null,
          responded_at: new Date(),
        });
        await notify(
          claim.customer_id,
          'warranty.declined',
          'Your warranty claim was answered',
          'Your professional does not think this is covered. If you disagree, our team can look at it.',
          claim.job_id,
        );
        return toView(declined);
      }

      const accepted = await store.trust.updateClaim(claim.id, {
        status: 'ACCEPTED',
        provider_response: input.reason ?? null,
        responded_at: new Date(),
      });
      await notify(
        claim.customer_id,
        'warranty.accepted',
        'Your professional is coming back',
        'They have accepted your warranty claim. The return visit is free of charge.',
        claim.job_id,
      );
      adapters.analytics.track('warranty_accepted', { userId: providerId, jobId: claim.job_id });
      return toView(accepted);
    },

    /**
     * Books the return visit.
     *
     * The revisit is a job of its own - it needs its own status, its own evidence and its own
     * completion - but it carries **no money in either direction**. The professional already
     * agreed to this when they offered a warranty; charging for it would make the warranty
     * meaningless, and paying them again for it would make the ledger wrong.
     */
    async bookRevisit(claimId: string, actorId: string, preferredStart?: string) {
      const claim = await store.trust.getClaim(claimId);
      if (!claim) throw notFound('claim');
      if (claim.customer_id !== actorId && claim.provider_id !== actorId) throw forbidden('not your claim');
      if (claim.status !== 'ACCEPTED') {
        throw new AppError('VALIDATION_ERROR', { details: { warranty: ['CLAIM_NOT_ACCEPTED'], status: claim.status } });
      }
      if (claim.revisit_job_id) return toView(claim);

      const original = await store.jobs.get(claim.job_id);
      if (!original) throw notFound('job');

      const revisit = await jobs.createDraft({
        customerId: claim.customer_id,
        categoryId: original.category_id,
        skillIds: original.skill_ids,
        description: `Warranty return visit: ${claim.description.slice(0, 200)}`,
        priority: original.priority,
        requestType: 'LABOUR_ONLY',
        inspectionRequired: false,
        addressId: original.address_id ?? undefined,
        preferredStart,
        ctx: { actorUserId: actorId, actorRole: null, actor: 'SYSTEM', requestId: null },
      });

      // Marked as a warranty visit and pointed straight at the same professional, so it never
      // goes out for bids and nothing tries to price it.
      await store.jobs.update(revisit.id, { warranty_claim_id: claim.id, confirmed_provider_id: claim.provider_id });
      const updated = await store.trust.updateClaim(claim.id, { status: 'REVISIT_BOOKED', revisit_job_id: revisit.id });

      for (const userId of [claim.customer_id, claim.provider_id]) {
        await notify(userId, 'warranty.revisit_booked', 'Return visit booked', 'The warranty visit is arranged. No charge for this one.', revisit.id);
      }
      return toView(updated);
    },

    async resolve(claimId: string, actorId: string, note: string) {
      const claim = await store.trust.getClaim(claimId);
      if (!claim) throw notFound('claim');
      // The customer closes their own claim; support may close it on their behalf.
      if (claim.customer_id !== actorId) throw forbidden('not your claim');
      const resolved = await store.trust.updateClaim(claim.id, {
        status: 'RESOLVED',
        resolved_at: new Date(),
        resolution_note: note,
      });
      await notify(claim.provider_id, 'warranty.resolved', 'Warranty claim closed', 'The customer confirmed it is sorted.', claim.job_id);
      adapters.analytics.track('warranty_resolved', { userId: actorId, jobId: claim.job_id });
      return toView(resolved);
    },

    async listForCustomer(customerId: string) {
      const rows = await store.trust.listClaimsForCustomer(customerId, 50);
      return Promise.all(rows.map(toView));
    },

    async listForProvider(providerId: string) {
      const rows = await store.trust.listClaimsForProvider(providerId, 50);
      return Promise.all(rows.map(toView));
    },

    /**
     * Claims a professional has let run past the response window. Silence must not be a way to
     * run down the warranty clock, so these go to support to decide on the customer's behalf.
     */
    async sweepUnanswered(limit = 50) {
      const open = await store.trust.listClaimsByStatus(['OPEN'], limit);
      const now = new Date();
      const escalated: string[] = [];
      for (const claim of open) {
        if (!claimNeedsSupport({ status: claim.status, createdAt: claim.created_at, now })) continue;
        await store.trust.updateClaim(claim.id, { status: 'ESCALATED' });
        await store.finance.createTicket({
          opened_by: claim.customer_id,
          job_id: claim.job_id,
          dispute_id: null,
          category: 'WARRANTY',
          subject: 'Warranty claim unanswered',
          body: 'The professional did not answer a warranty claim within the response window.',
          status: 'OPEN',
          // Ahead of a routine query: the customer is sitting with broken work and a clock
          // running down on their cover.
          priority: 2,
          assigned_to: null,
          closed_at: null,
        });
        await notify(
          claim.customer_id,
          'warranty.escalated',
          'We have taken over your claim',
          'Your professional did not answer in time, so our team is handling it.',
          claim.job_id,
        );
        escalated.push(claim.id);
      }
      return escalated;
    },

    toView,
  };
}

export type WarrantyService = ReturnType<typeof warrantyService>;
