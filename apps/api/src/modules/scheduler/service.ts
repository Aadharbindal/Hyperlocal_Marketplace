import {
  APPROVAL_CHASE_HOURS,
  DRAFT_ABANDON_HOURS,
  RECONCILE_AFTER_MINUTES,
  TASK_SCHEDULE,
  dueTasks,
  reconcileDecision,
  type ScheduledTask,
  type TaskState,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type { DataStore, JobRecord } from '../../data/types';
import type { FinanceService } from '../finance/service';
import type { JobService, TransitionContext } from '../jobs/service';
import type { NegotiationService } from '../negotiation/service';
import type { WarrantyService } from '../warranty/service';

export interface SchedulerDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
  finance: FinanceService;
  negotiation: NegotiationService;
  warranty: WarrantyService;
}

export interface TaskResult {
  task: ScheduledTask;
  handled: number;
  durationMs: number;
  error?: string;
}

const BATCH = 50;

/**
 * The background worker. Everything it does is something a person could do by hand through the
 * API; it exists so that nobody has to. Each task is idempotent and batched, so a missed run
 * catches up on the next one and a double run changes nothing.
 */
export function schedulerService(d: SchedulerDeps) {
  const { store, adapters, jobs, finance, negotiation } = d;
  const states = new Map<ScheduledTask, TaskState>();

  const systemCtx = (): TransitionContext => ({ actorUserId: null, actorRole: null, actor: 'SYSTEM', requestId: null });

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

  // ------------------------------------------------------------------ tasks

  /**
   * A bidding window that has closed. With offers in hand the customer still has a choice, so
   * the job is left alone; with none, nobody is coming and the customer is told rather than
   * left waiting.
   */
  async function expireBidWindows(now: Date): Promise<number> {
    const open = await store.jobs.listByStatus(['OPEN_FOR_BIDS'], BATCH);
    let handled = 0;
    for (const job of open) {
      if (!job.bid_window_ends_at || job.bid_window_ends_at > now) continue;
      const bids = await store.bids.listForJob(job.id, ['ACTIVE']);
      if (bids.length > 0) continue;
      await jobs.transition(job, 'AUTO_CANCELLED', systemCtx(), {
        reason: 'No provider answered in time',
        patch: { cancelled_reason: 'No provider answered in time', cancelled_by_role: null },
      });
      await notify(job.customer_id, 'job.auto_cancelled', 'Nobody was available', 'No provider answered in time. Try again, or widen the time you are free.', job.id);
      handled += 1;
    }
    return handled;
  }

  /**
   * A counter-offer nobody answered. The offer expires and, if that was the only thing in
   * flight, the job goes back to its original offers so the customer can still pick one.
   */
  async function expireOffers(now: Date): Promise<number> {
    const expired = await store.negotiation.listExpiredOffers(now, BATCH);
    let handled = 0;
    for (const offer of expired) {
      await store.negotiation.updateOffer(offer.id, { status: 'EXPIRED' });
      const job = await store.jobs.get(offer.job_id);
      if (!job || job.status !== 'NEGOTIATING') {
        handled += 1;
        continue;
      }
      const stillPending = (await store.negotiation.listOffersForJob(job.id)).some((o) => o.status === 'PENDING');
      if (!stillPending) {
        await jobs.transition(job, 'BID_RECEIVED', systemCtx(), { reason: 'Offer expired' });
        await notify(job.customer_id, 'offer.expired', 'That price offer expired', 'The provider did not answer in time. Your other offers are still open.', job.id);
      }
      handled += 1;
    }
    return handled;
  }

  /** Material quotes have a shelf life, and so does an unanswered material request. */
  async function expireMaterial(now: Date): Promise<number> {
    let handled = 0;
    for (const quote of await store.materials.listExpiredQuotes(now, BATCH)) {
      await store.materials.updateQuote(quote.id, { status: 'EXPIRED' });
      handled += 1;
    }
    for (const request of await store.materials.listStaleRequests(now, BATCH)) {
      const quotes = await store.materials.listQuotes(request.id);
      const live = quotes.some((q) => q.status === 'ACTIVE' || q.status === 'SELECTED');
      // A request with live prices stays open until the customer picks or they expire.
      if (live) continue;
      await store.materials.updateRequest(request.id, { status: 'EXPIRED' });
      await notify(request.requested_by, 'material.expired', 'No supplier answered', 'Nobody priced that material list in time. You can ask again.', request.job_id);
      handled += 1;
    }
    return handled;
  }

  /** A draft nobody ever submitted stops cluttering the customer's list. */
  async function abandonDrafts(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - DRAFT_ABANDON_HOURS * 3600_000);
    const drafts = await store.jobs.listByStatus(['DRAFT'], BATCH);
    let handled = 0;
    for (const job of drafts) {
      if (job.created_at > cutoff) continue;
      await jobs.transition(job, 'ABANDONED', systemCtx(), { reason: 'Draft abandoned' });
      handled += 1;
    }
    return handled;
  }

  /** The payout run, on a timer instead of a person remembering. */
  async function runSettlements(): Promise<number> {
    const results = await finance.runSettlements(BATCH, null);
    return results.filter((r) => r.status === 'PAID').length;
  }

  /**
   * A payment the gateway never told us about. We ask the gateway - never the client - and a
   * payment still unanswered after half an hour becomes a support problem rather than an
   * endless retry (PAYMENT_FLOW section 8).
   */
  async function reconcilePayments(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MINUTES * 60_000);
    const stale = await store.payments.listStale('PENDING', cutoff, BATCH);
    let handled = 0;
    for (const payment of stale) {
      if (!payment.provider_order_id) continue;
      const gateway = await adapters.payment.fetchPayment(payment.provider_order_id);
      const decision = reconcileDecision(gateway.status, payment.created_at, now);

      if (decision === 'AUTHORIZED' || decision === 'FAILED') {
        // Reuse the webhook path so the outcome is applied exactly once, the same way.
        await negotiation.applyPaymentEvent({
          eventId: `recon_${payment.id}_${decision}`,
          type: decision === 'AUTHORIZED' ? 'payment.authorized' : 'payment.failed',
          orderId: payment.provider_order_id,
          paymentId: gateway.providerPaymentId ?? payment.id,
          amountPaise: gateway.amountPaise ?? Number(payment.amount_paise),
          failureReason: 'reconciled_with_gateway',
          signatureValid: true,
          requestId: null,
        });
        handled += 1;
      } else if (decision === 'GIVE_UP') {
        await store.finance.createTicket({
          opened_by: payment.payer_id,
          job_id: payment.job_id,
          dispute_id: null,
          category: 'PAYMENT_ISSUE',
          subject: 'Payment stuck without a gateway answer',
          body: `Payment ${payment.id} has been pending since ${payment.created_at.toISOString()} and the gateway still reports pending.`,
          status: 'OPEN',
          assigned_to: null,
          priority: 2,
          closed_at: null,
        });
        await store.payments.update(payment.id, { failure_reason: 'awaiting_gateway' });
        adapters.monitoring.captureMessage('payment stuck without gateway answer', { paymentId: payment.id });
        handled += 1;
      }
    }
    return handled;
  }

  /**
   * A finished job the customer has not looked at. They are reminded once and then it goes to
   * support - the platform never approves work on a customer's behalf, because that would be
   * taking their money on a silence.
   */
  async function chaseApprovals(now: Date): Promise<number> {
    const waiting = await store.jobs.listByStatus(['CUSTOMER_APPROVAL_PENDING'], BATCH);
    const cutoff = new Date(now.getTime() - APPROVAL_CHASE_HOURS * 3600_000);
    let handled = 0;
    for (const job of waiting) {
      const completion = await store.execution.latestCompletion(job.id);
      if (!completion || completion.submitted_at > cutoff) continue;

      const already = await store.finance.listTickets({ openedBy: job.customer_id, limit: 50 });
      if (already.some((t) => t.job_id === job.id && t.category === 'APPROVAL_TIMEOUT')) continue;

      await notify(job.customer_id, 'job.approval_reminder', 'Please check the finished work', 'Approve it, or tell us what is wrong. Nothing is charged until you do.', job.id);
      await store.finance.createTicket({
        opened_by: job.customer_id,
        job_id: job.id,
        dispute_id: null,
        category: 'APPROVAL_TIMEOUT',
        subject: 'Finished job waiting on the customer',
        body: `Job ${job.id} has been waiting for approval since ${completion.submitted_at.toISOString()}.`,
        status: 'OPEN',
        assigned_to: null,
        priority: 3,
        closed_at: null,
      });
      handled += 1;
    }
    return handled;
  }

  /** Retention events whose time has come (PRIVACY_DATA_MAP). */
  /**
   * Claims a professional has left unanswered past the response window. Silence must not be a
   * way to run down somebody's warranty clock, so support decides on the customer's behalf.
   */
  async function escalateWarranty(): Promise<number> {
    return (await d.warranty.sweepUnanswered(BATCH)).length;
  }

  async function retentionSweep(now: Date): Promise<number> {
    const due = await store.retention.listDue(now, BATCH);
    let handled = 0;
    for (const event of due) {
      if (event.entity_type === 'user' && event.action === 'ANONYMISE') {
        const user = await store.users.findById(event.entity_id);
        // Financial and audit rows are kept; the person behind them is not identifiable.
        if (user && !user.deleted_at) {
          await store.users.update(user.id, {
            display_name: 'Deleted user',
            avatar_url: null,
            deleted_at: new Date(),
            status: 'DELETED',
          });
          await store.auth.revokeAllSessions(user.id);
        }
      }
      await store.retention.markExecuted(event.id, new Date());
      handled += 1;
    }
    return handled;
  }

  const RUNNERS: Record<ScheduledTask, (now: Date) => Promise<number>> = {
    'expire-bid-windows': expireBidWindows,
    'expire-offers': expireOffers,
    'expire-material': expireMaterial,
    'abandon-drafts': abandonDrafts,
    'run-settlements': runSettlements,
    'reconcile-payments': reconcilePayments,
    'chase-approvals': chaseApprovals,
    'retention-sweep': retentionSweep,
    'escalate-warranty': escalateWarranty,
  };

  let running = false;

  return {
    states,

    /** Runs one task by name, whatever its schedule says. Used by tests and by support. */
    async runTask(task: ScheduledTask, now: Date = new Date()): Promise<TaskResult> {
      const started = Date.now();
      const prior = states.get(task);
      try {
        const handled = await RUNNERS[task](now);
        const result: TaskResult = { task, handled, durationMs: Date.now() - started };
        states.set(task, {
          task,
          lastRunAt: new Date(),
          lastDurationMs: result.durationMs,
          lastError: null,
          runs: (prior?.runs ?? 0) + 1,
        });
        if (handled > 0) adapters.analytics.track('scheduled_task_ran', { task, handled });
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        states.set(task, {
          task,
          lastRunAt: new Date(),
          lastDurationMs: Date.now() - started,
          lastError: message,
          runs: (prior?.runs ?? 0) + 1,
        });
        // One failing task must never stop the rest of the queue.
        adapters.monitoring.captureError(e, { task });
        return { task, handled: 0, durationMs: Date.now() - started, error: message };
      }
    },

    /** Runs everything that is due. Overlapping runs are skipped rather than queued. */
    async runDue(now: Date = new Date()): Promise<TaskResult[]> {
      if (running) return [];
      running = true;
      try {
        const results: TaskResult[] = [];
        for (const spec of dueTasks(states, now)) {
          results.push(await this.runTask(spec.task, now));
        }
        return results;
      } finally {
        running = false;
      }
    },

    /** What an operator sees: every task, when it last ran and whether it complained. */
    status() {
      return TASK_SCHEDULE.map((spec) => {
        const state = states.get(spec.task);
        return {
          task: spec.task,
          everySeconds: spec.everySeconds,
          description: spec.description,
          lastRunAt: state?.lastRunAt?.toISOString() ?? null,
          lastDurationMs: state?.lastDurationMs ?? null,
          lastError: state?.lastError ?? null,
          runs: state?.runs ?? 0,
        };
      });
    },
  };
}

export type SchedulerService = ReturnType<typeof schedulerService>;
export type { JobRecord };
