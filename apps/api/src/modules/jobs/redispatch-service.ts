import {
  REDISPATCH_WINDOW_MINUTES,
  canRedispatch,
  planRedispatch,
  rankScore,
  type RedispatchCandidate,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { DataStore, JobRecord } from '../../data/types';
import { AppError } from '../../lib/errors';
import type { AuditService } from '../audit/service';

/**
 * Finding a dropped booking another professional.
 *
 * The one thing to hold on to while reading this: from the customer's side nothing about the
 * booking has changed except who is coming. Same price, same address, same day. Everything below
 * exists to keep that true - which is why nobody dearer than the authorised amount is invited,
 * why the money is left authorised rather than released and re-taken, and why the clock is short.
 *
 * It is an *offer*, not a reassignment. A bid placed on Tuesday is not consent to be handed the
 * job on Thursday afternoon.
 */

export interface RedispatchDeps {
  store: DataStore;
  adapters: Adapters;
  audit: AuditService;
  notify: (userId: string, type: string, title: string, body: string, jobId?: string) => Promise<unknown>;
  /**
   * Moves the job, through the same state machine everything else goes through.
   *
   * The patch travels *with* the transition rather than after it. `jobs_redispatch_needs_deadline`
   * in 0018 refuses a REDISPATCHING row with no deadline, so writing the status first and the
   * deadline second fails on the first write - which is the constraint doing exactly its job.
   */
  transition: (job: JobRecord, to: string, reason: string, patch?: Partial<JobRecord>) => Promise<JobRecord>;
}

export function redispatchService(d: RedispatchDeps) {
  const { store, adapters, audit, notify } = d;

  /**
   * Turns a provider's cancellation into a re-dispatch, or reports that it cannot.
   *
   * Returns `null` when there is nobody to ask, which is not an error: the caller then cancels
   * the booking the way it always did. Distinguishing "we tried and found nobody" from "we never
   * tried" matters, because only one of them should be apologised for.
   */
  async function open(job: JobRecord, droppedByProviderId: string, reason: string) {
    if (!canRedispatch(job.status)) return null;

    const quote = await store.negotiation.getActiveQuote(job.id);
    if (!quote) return null;

    const bids = await store.bids.listForJob(job.id);
    const alreadyInvited = (await store.redispatch.listForJob(job.id)).map((i) => i.provider_id);

    const candidates: RedispatchCandidate[] = [];
    for (const b of bids) {
      const total = Number(b.labour_paise) + Number(b.visit_fee_paise);
      const profile = await store.users.getProviderProfile(b.provider_id);
      candidates.push({
        bidId: b.id,
        providerId: b.provider_id,
        totalPaise: total,
        bidStatus: b.status,
        ranking: {
          labourPaise: Number(b.labour_paise),
          visitFeePaise: Number(b.visit_fee_paise),
          etaMinutes: b.eta_minutes,
          // Distance was scored against the original feed and is not re-derived here; a
          // provider's base has not moved since they bid, and geocoding every candidate to
          // rescue one booking is a lot of work to change an ordering that barely moves.
          distanceKm: 0,
          completedJobs: profile?.completed_jobs ?? 0,
          reliabilityScore: Number(profile?.reliability_score ?? 5),
          ratingAvg: profile?.rating_avg == null ? null : Number(profile.rating_avg),
          skillMatchRatio: 1,
        },
      });
    }

    const totals = candidates.map((c) => c.totalPaise).sort((a, b) => a - b);
    const medianTotalPaise = totals.length ? (totals[Math.floor(totals.length / 2)] ?? 0) : 0;

    const plan = planRedispatch(candidates, {
      droppedByProviderId,
      authorisedTotalPaise: Number(quote.total_paise),
      alreadyInvitedProviderIds: alreadyInvited,
      medianTotalPaise,
    });

    if (plan.invite.length === 0) return null;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + REDISPATCH_WINDOW_MINUTES * 60_000);

    /**
     * The departing provider's assignment is closed before anything else happens.
     *
     * A job may have only one active assignment, so leaving the old one in place means the
     * replacement cannot be given the job at all - `createAssignment` refuses with
     * `assignment_already_active` and the rescue fails at the last step, after the customer has
     * already been told help is coming. Found exactly that way, by a test that had two
     * professionals race for one booking and watched *both* lose.
     */
    const outgoing = await store.negotiation.getActiveAssignment(job.id);
    if (outgoing) {
      await store.negotiation.updateAssignment(outgoing.id, {
        status: 'REPLACED',
        reason: `Provider cancelled: ${reason}`,
      });
    }

    // One write. 0018 refuses a REDISPATCHING row with no deadline, and a booking stuck in this
    // state with no clock is a customer watching a spinner while their money stays held.
    const moved = await d.transition(job, 'REDISPATCHING', reason, {
      redispatch_deadline: expiresAt,
      redispatch_count: (job.redispatch_count ?? 0) + 1,
    });

    for (const c of plan.invite) {
      await store.redispatch.invite({
        job_id: job.id,
        provider_id: c.providerId,
        bid_id: c.bidId,
        total_paise: c.totalPaise,
        invited_at: now,
        expires_at: expiresAt,
        responded_at: null,
        outcome: null,
      });
      await notify(
        c.providerId,
        'redispatch.invited',
        'A job needs covering',
        'The professional booked for this job pulled out. You offered on it earlier - it is yours if you want it.',
        job.id,
      );
    }

    await notify(
      job.customer_id,
      'job.redispatching',
      'Finding you another professional',
      `The professional had to cancel. We have asked ${plan.invite.length} others who offered on your booking - no extra cost to you.`,
      job.id,
    );

    await audit.record(
      { actorUserId: droppedByProviderId, actorRole: 'PROVIDER', ip: null, requestId: null },
      {
        action: 'job.redispatch_opened',
        entityType: 'job',
        entityId: job.id,
        reason,
        // The skip list is here so support can answer "why wasn't X asked?" with a reason
        // instead of a shrug.
        after: { invited: plan.invite.map((c) => c.providerId), skipped: plan.skipped, attempt: (job.redispatch_count ?? 0) + 1 },
      },
    );

    adapters.analytics.track('redispatch_opened', { jobId: job.id, invited: plan.invite.length });
    return { job: moved, invited: plan.invite.length, expiresAt };
  }

  /**
   * An invited professional takes the job.
   *
   * The losing side of the race gets a plain "somebody else got there first" rather than an
   * error, because from their point of view nothing went wrong - they were simply second.
   */
  async function accept(invitationId: string, providerId: string) {
    const invitation = await store.redispatch.get(invitationId);
    if (!invitation || invitation.provider_id !== providerId) throw new AppError('NOT_FOUND');
    if (invitation.expires_at <= new Date()) throw new AppError('CONFLICT', { details: { reason: 'invitation_expired' } });

    const job = await store.jobs.get(invitation.job_id);
    if (!job || job.status !== 'REDISPATCHING') throw new AppError('CONFLICT', { details: { reason: 'no_longer_available' } });

    const won = await store.redispatch.respond(invitationId, 'ACCEPTED', new Date());
    if (!won) throw new AppError('CONFLICT', { details: { reason: 'taken_by_someone_else' } });

    // Everyone else asked is told at once, rather than left to discover it by tapping.
    await store.redispatch.closeOpen(job.id, 'SUPERSEDED', new Date());

    const quote = await store.negotiation.getActiveQuote(job.id);
    if (quote) {
      // The quote moves to the new provider at **their** total, which the invitation froze and
      // which planRedispatch already guaranteed is no more than the customer authorised. Any
      // difference is less, and comes off what is captured at settlement.
      await store.negotiation.updateQuote(quote.id, {
        provider_id: providerId,
        bid_id: invitation.bid_id,
        total_paise: invitation.total_paise,
      });
    }

    await store.negotiation.createAssignment({
      job_id: job.id,
      provider_id: providerId,
      technician_id: null,
      contractor_id: null,
      assigned_by: providerId,
      status: 'ACTIVE',
      replaced_by: null,
      reason: 'Took over after the original professional cancelled',
    });

    // Deadline cleared in the same write that leaves REDISPATCHING, so the check constraint
    // never sees a half-state and no sweep can pick this job up a second later.
    const confirmed = await d.transition(job, 'CONFIRMED', 'Another professional took it', {
      redispatch_deadline: null,
      confirmed_provider_id: providerId,
    });

    const profile = await store.users.getProviderProfile(providerId);
    await notify(
      job.customer_id,
      'job.redispatched',
      'You have a new professional',
      `${profile?.business_name ?? 'A professional'} has taken your booking. Same price, same slot.`,
      job.id,
    );

    await audit.record(
      { actorUserId: providerId, actorRole: 'PROVIDER', ip: null, requestId: null },
      { action: 'job.redispatch_accepted', entityType: 'job', entityId: job.id, after: { providerId, totalPaise: invitation.total_paise } },
    );
    adapters.analytics.track('redispatch_accepted', { jobId: job.id, userId: providerId });
    return confirmed;
  }

  async function decline(invitationId: string, providerId: string, reason?: string) {
    const invitation = await store.redispatch.get(invitationId);
    if (!invitation || invitation.provider_id !== providerId) throw new AppError('NOT_FOUND');
    // No penalty for declining, and none intended. This is a favour being asked at short notice;
    // punishing a no makes people stop opening the notification, which costs the next customer.
    await store.redispatch.respond(invitationId, 'DECLINED', new Date());
    if (reason) {
      await audit.record(
        { actorUserId: providerId, actorRole: 'PROVIDER', ip: null, requestId: null },
        { action: 'job.redispatch_declined', entityType: 'job', entityId: invitation.job_id, reason },
      );
    }
    return { ok: true };
  }

  /**
   * The clock running out on a booking nobody took.
   *
   * Swept rather than scheduled per job, in the same shape as every other expiry in this system,
   * so one missed timer cannot strand a customer's money indefinitely.
   */
  async function sweepExpired(now: Date, onGiveUp: (job: JobRecord) => Promise<void>) {
    const stale = await store.jobs.listRedispatchExpired(now);
    let n = 0;
    for (const job of stale) {
      await store.redispatch.closeOpen(job.id, 'EXPIRED', now);
      // Handing back to the caller rather than cancelling here: releasing the authorisation and
      // writing the ledger is finance's job, and re-dispatch should not own a second copy of it.
      await onGiveUp(job);
      // The deadline is cleared *after* the status has left REDISPATCHING, never before.
      //
      // The first version cleared it first, which violates `jobs_redispatch_needs_deadline` in
      // 0018 - a REDISPATCHING row must have a deadline - and Postgres rejected the write. The
      // memory store had no such check, so this passed in memory and failed against a real
      // database, which is the entire reason the suite runs both ways. The memory store now
      // mirrors the constraint too.
      await store.jobs.update(job.id, { redispatch_deadline: null });
      await audit.record(
        { actorUserId: null, actorRole: null, ip: null, requestId: null },
        { action: 'job.redispatch_gave_up', entityType: 'job', entityId: job.id },
      );
      n++;
    }
    return n;
  }

  return { open, accept, decline, sweepExpired, rankScore };
}

export type RedispatchService = ReturnType<typeof redispatchService>;
