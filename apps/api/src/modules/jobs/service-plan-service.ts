import {
  advance,
  blockedFromBooking,
  describeInterval,
  isDueToBook,
  startOfDay,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { DataStore, JobRecord, ServicePlanRecord } from '../../data/types';
import type { AuditService } from '../audit/service';
import type { JobService, TransitionContext } from './service';

/**
 * Turning standing arrangements into bookings.
 *
 * The sweep runs hourly and the whole design assumes it will sometimes fail halfway - a database
 * blip, a deploy, a category disabled between two statements. So every due date is claimed
 * exactly once, *before* the work of creating the booking, by a unique row in
 * `service_plan_occurrences`. A sweep that crashes after claiming leaves one missing booking,
 * which somebody can see and fix; one that claimed nothing would create the same visit again on
 * every tick until a customer had fourteen of them.
 */

export interface ServicePlanDeps {
  store: DataStore;
  adapters: Adapters;
  audit: AuditService;
  jobs: JobService;
  notify: (userId: string, type: string, title: string, body: string, jobId?: string) => Promise<unknown>;
  /**
   * The context a plan's bookings are made under.
   *
   * Deliberately the **customer**, not SYSTEM. The state machine only lets a customer move a
   * draft to SUBMITTED, and that is right: submitting a request is somebody's own act. A plan
   * does not change who is asking - the customer authorised these bookings when they set the
   * plan up, and this is their standing instruction being carried out. Widening the transition
   * to accept SYSTEM would have weakened that guard for every other path in the system to save
   * one line here.
   */
  customerCtx: (customerId: string) => TransitionContext;
}

/** How many plans one sweep will handle. Bounded so a backlog cannot monopolise a tick. */
const SWEEP_LIMIT = 200;

export function servicePlanService(d: ServicePlanDeps) {
  const { store, adapters, audit, jobs, notify } = d;

  /**
   * Whether this plan already has a booking in flight.
   *
   * A customer who has not got round to accepting last month's offers should not wake up to a
   * second identical booking, so the plan waits a cycle rather than stacking.
   */
  async function hasOpenJob(plan: ServicePlanRecord): Promise<boolean> {
    const open = await store.jobs.listForCustomer(plan.customer_id, {
      statuses: [
        'DRAFT', 'SUBMITTED', 'QUALIFYING', 'OPEN_FOR_BIDS', 'BID_RECEIVED', 'NEGOTIATING',
        'PAYMENT_PENDING', 'REDISPATCHING', 'CONFIRMED', 'PROVIDER_ASSIGNED', 'EN_ROUTE',
        'ARRIVED', 'STARTED', 'IN_PROGRESS',
      ],
      limit: 50,
    });
    return open.some((j) => j.service_plan_id === plan.id);
  }

  /** Books one plan's due visit, or records why it could not. Never throws for ordinary reasons. */
  async function bookOne(plan: ServicePlanRecord, now: Date): Promise<'BOOKED' | 'SKIPPED' | 'FAILED'> {
    const dueOn = startOfDay(plan.next_due_on);

    const [address, categories, open] = await Promise.all([
      store.addresses.get(plan.address_id),
      store.categories.listEnabled(),
      hasOpenJob(plan),
    ]);

    const blocked = blockedFromBooking({
      status: plan.status,
      addressUsable: !!address && !address.deleted_at && address.user_id === plan.customer_id,
      categoryEnabled: categories.some((c) => c.id === plan.category_id),
      hasOpenJob: open,
    });

    /**
     * The date is claimed first, and claimed **pessimistically**.
     *
     * First, because claiming after the work means a crash in between produces a duplicate
     * booking on the next tick, and the tick after that, until a customer has fourteen of them.
     *
     * Pessimistically, because the first version of this wrote BOOKED before trying and left a
     * row saying a booking existed when none did - which is exactly what happened the first time
     * this ran: the state machine refused the submit and the occurrence still claimed success.
     * FAILED is the true statement until a job id proves otherwise.
     */
    const claimed = await store.servicePlans.recordOccurrence({
      plan_id: plan.id,
      due_on: dueOn,
      job_id: null,
      outcome: blocked ? 'SKIPPED' : 'FAILED',
      detail: blocked ?? 'Booking not completed',
    });
    // Null means another node, or an earlier tick, already handled this date.
    if (!claimed) return 'SKIPPED';

    if (blocked) {
      // ALREADY_OPEN is the only one that should not move the schedule on: the visit still needs
      // to happen, it is simply waiting for the last booking to finish.
      if (blocked !== 'ALREADY_OPEN') {
        await store.servicePlans.update(plan.id, { next_due_on: advance(planSchedule(plan), now) });
      }
      // The customer is told when it is something they can act on. A plan that has quietly
      // produced nothing for six months is the failure this feature must not have.
      if (blocked === 'ADDRESS_GONE' || blocked === 'CATEGORY_DISABLED') {
        await notify(
          plan.customer_id,
          'plan.needs_attention',
          'Your repeat booking needs attention',
          blocked === 'ADDRESS_GONE'
            ? 'We could not book your regular visit because the address it uses has been removed.'
            : 'We could not book your regular visit because that service is not available here at the moment.',
        );
      }
      return 'SKIPPED';
    }

    try {
      const draft = await jobs.createDraft({
        customerId: plan.customer_id,
        categoryId: plan.category_id,
        skillIds: plan.skill_ids ?? [],
        description: plan.description ?? undefined,
        priority: 'NORMAL',
        requestType: 'LABOUR_ONLY',
        addressId: plan.address_id,
        // The date the work is wanted, not the date the booking opened.
        preferredStart: dueOn.toISOString(),
        ctx: d.customerCtx(plan.customer_id),
      });
      await store.jobs.update(draft.id, { service_plan_id: plan.id });
      const { job: submitted, duplicateOf } = await jobs.submit({ ...draft, service_plan_id: plan.id }, d.customerCtx(plan.customer_id));
      // Submitting already refuses to open a second identical request, and says which one it
      // matched. Worth recording rather than ignoring: it means the customer booked this
      // themselves in the meantime, which is a good outcome, not a failure.
      if (duplicateOf) {
        await audit.record(
          { actorUserId: null, actorRole: null, ip: null, requestId: null },
          { action: 'plan.booked_duplicate', entityType: 'service_plan', entityId: plan.id, after: { duplicateOf } },
        );
      }

      // Now it is true, so the claim is corrected.
      await store.servicePlans.updateOccurrence(claimed.id, {
        outcome: 'BOOKED',
        job_id: submitted.id,
        detail: null,
      });
      await store.servicePlans.update(plan.id, { next_due_on: advance(planSchedule(plan), now) });

      /**
       * The professional who did it last time is told first.
       *
       * A nudge, not a reservation. They still bid like anybody else and the customer still
       * chooses - but somebody who has been to this flat before, knows the building and the
       * geyser, is exactly who both sides usually want, and they would otherwise have no idea
       * the work was coming round again.
       */
      if (plan.preferred_provider_id) {
        await notify(
          plan.preferred_provider_id,
          'plan.regular_open',
          'A customer you have worked for needs you again',
          'Their regular booking has just opened. Offer now if you can take it.',
          submitted.id,
        );
      }

      await notify(
        plan.customer_id,
        'plan.booked',
        'Your regular booking is open',
        `We have opened your ${describeInterval(plan.interval_days)} booking. Offers will arrive shortly - nothing is charged until you accept one.`,
        submitted.id,
      );

      await audit.record(
        { actorUserId: null, actorRole: null, ip: null, requestId: null },
        { action: 'plan.booked', entityType: 'service_plan', entityId: plan.id, after: { jobId: submitted.id, dueOn: dueOn.toISOString() } },
      );
      adapters.analytics.track('service_plan_booked', { userId: plan.customer_id, planId: plan.id });
      return 'BOOKED';
    } catch (e) {
      // The claim stays. This date is done as far as the sweep is concerned, and the failure is
      // on the record where support can find it rather than being retried into a pile of jobs.
      const detail = e instanceof Error ? e.message : String(e);
      // The claim already says FAILED; this only adds the reason support will need.
      await store.servicePlans.updateOccurrence(claimed.id, { detail });
      await store.servicePlans.update(plan.id, { next_due_on: advance(planSchedule(plan), now) });
      await audit.record(
        { actorUserId: null, actorRole: null, ip: null, requestId: null },
        { action: 'plan.book_failed', entityType: 'service_plan', entityId: plan.id, reason: detail },
      );
      adapters.monitoring.captureError(e, { area: 'service-plans', planId: plan.id });
      await notify(
        plan.customer_id,
        'plan.needs_attention',
        'Your repeat booking needs attention',
        'We could not open your regular booking this time. You can book it yourself from your plans.',
      );
      return 'FAILED';
    }
  }

  const planSchedule = (p: ServicePlanRecord) => ({
    status: p.status,
    nextDueOn: startOfDay(p.next_due_on),
    intervalDays: p.interval_days,
    leadDays: p.lead_days,
  });

  return {
    /** The hourly sweep. Returns how many plans it turned into bookings. */
    async bookDue(now: Date): Promise<number> {
      const due = await store.servicePlans.listDue(now, SWEEP_LIMIT);
      let booked = 0;
      for (const plan of due) {
        // Re-checked against the pure rule rather than trusting the query alone, so the
        // definition of "due" lives in one tested place.
        if (!isDueToBook(planSchedule(plan), now)) continue;
        if ((await bookOne(plan, now)) === 'BOOKED') booked++;
      }
      return booked;
    },

    /**
     * Skipping the next visit without ending the arrangement.
     *
     * The case this exists for: away that week, or it was done privately last month. Without it
     * the only way to avoid one unwanted booking is to cancel the plan, and most people never
     * set it up again.
     */
    async skipNext(plan: ServicePlanRecord, reason: string | undefined, now: Date) {
      const dueOn = startOfDay(plan.next_due_on);
      await store.servicePlans.recordOccurrence({
        plan_id: plan.id,
        due_on: dueOn,
        job_id: null,
        outcome: 'SKIPPED',
        detail: reason ?? 'Skipped by the customer',
      });
      return store.servicePlans.update(plan.id, { next_due_on: advance(planSchedule(plan), now) });
    },

    bookOne,
    planSchedule,
  };
}

export type ServicePlanService = ReturnType<typeof servicePlanService>;

/** Re-exported so routes can describe a plan without importing core directly. */
export { describeInterval };
export type { JobRecord };
