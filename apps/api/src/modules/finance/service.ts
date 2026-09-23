import {
  DISPUTE_SLA_HOURS,
  HUMAN_ONLY_CATEGORIES,
  STRIKE_RELIABILITY_COST,
  buildCaptureLines,
  buildDisputeHoldLines,
  buildDisputeReleaseLines,
  buildMaterialCaptureLines,
  buildRefundLines,
  buildSettlementLines,
  cancellationNeedsSupport,
  cancellationStage,
  checkCanCapture,
  checkCanRaiseDispute,
  checkCanReview,
  checkCanSettle,
  checkCanSettleVendor,
  customerCancellationCharge,
  disputeIsOpen,
  isBalanced,
  nextRating,
  refundNeedsTwoPeople,
  shouldSuspend,
  splitRefund,
  type DisputeCategory,
  type DisputeResolution,
  type JobStatus,
  type LedgerLine,
  type StrikeSeverity,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type {
  DataStore,
  DisputeRecord,
  JobRecord,
  MaterialOrderRecord,
  PaymentRecord,
  SettlementRecord,
} from '../../data/types';
import { newId } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';
import type { JobService, TransitionContext } from '../jobs/service';

export interface FinanceDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
}

function blocked(code: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_ERROR', { details: { finance: [code], ...extra } });
}

export function financeService(d: FinanceDeps) {
  const { store, adapters, jobs } = d;

  const systemCtx = (requestId: string | null): TransitionContext => ({
    actorUserId: null,
    actorRole: null,
    actor: 'SYSTEM',
    requestId,
  });

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

  /**
   * Writes one balanced batch. The batch is refused outright if it does not sum to zero - a
   * half-right ledger is worse than none - and a replayed key writes nothing.
   */
  async function postBatch(
    lines: LedgerLine[],
    meta: { idempotencyKey: string; jobId: string | null; paymentId: string | null; referenceType?: string; referenceId?: string | null; createdBy?: string | null },
  ) {
    if (lines.length === 0) return [];
    if (!isBalanced(lines)) {
      const sum = lines.reduce((t, l) => t + l.amountPaise, 0);
      throw new AppError('CONFLICT', { details: { reason: 'ledger_batch_unbalanced', sum } });
    }
    const batchId = newId();
    return store.finance.appendLedger(
      lines.map((l) => ({
        job_id: meta.jobId,
        payment_id: meta.paymentId,
        entry_type: l.entryType,
        account_user_id: l.accountUserId ?? null,
        amount_paise: l.amountPaise,
        batch_id: batchId,
        idempotency_key: meta.idempotencyKey,
        reference_type: meta.referenceType ?? null,
        reference_id: meta.referenceId ?? null,
        note: l.note ?? null,
        created_by: meta.createdBy ?? null,
      })),
    );
  }

  async function bookingPayment(jobId: string): Promise<PaymentRecord | null> {
    const payments = await store.payments.listForJob(jobId);
    return payments.find((p) => p.purpose === 'BOOKING' && p.status !== 'FAILED' && p.status !== 'RELEASED') ?? null;
  }

  async function openDisputeCount(jobId: string) {
    return (await store.finance.findOpenDispute(jobId)) ? 1 : 0;
  }

  /**
   * What was actually captured on this job, read back from the ledger rather than from the
   * payment row. The ledger is the record of where the money went, so a refund built from it
   * always balances - even when the capture was a partial one, such as a cancellation charge.
   */
  async function capturedAllocation(jobId: string) {
    const entries = await store.finance.listLedgerForJob(jobId);
    const captured = entries.filter((e) => e.reference_type === 'booking_quote' || e.reference_type === 'cancellation');
    const by = (type: string) => captured.filter((e) => e.entry_type === type).reduce((t, e) => t + Number(e.amount_paise), 0);
    return {
      totalPaise: by('CUSTOMER_CHARGE'),
      // these are held as negatives in the ledger; a refund gives them back
      providerPayablePaise: -by('PROVIDER_PAYABLE'),
      platformFeePaise: -by('PLATFORM_REVENUE'),
      taxPaise: -by('TAX'),
    };
  }

  return {
    // ------------------------------------------------------------------ capture
    /**
     * Called when the customer approves the work. This is the only moment labour money is
     * actually taken, and it is taken at the locked quote, never at a number the client sent.
     */
    async captureForJob(job: JobRecord, ctx: TransitionContext) {
      const payment = await bookingPayment(job.id);
      const problem = checkCanCapture(job, payment, { openDisputes: await openDisputeCount(job.id) });
      if (problem === 'ALREADY_CAPTURED') return payment;
      if (problem) blocked(problem);

      const quote = await store.negotiation.getActiveQuote(job.id);
      if (!quote) blocked('NO_QUOTE');
      const p = payment!;

      await adapters.payment.capture({ providerPaymentId: p.provider_payment_id ?? p.id, amountPaise: Number(p.amount_paise) });
      const captured = await store.payments.update(p.id, { status: 'CAPTURED' });
      await store.jobs.update(job.id, { payment_status: 'CAPTURED' });

      await postBatch(
        buildCaptureLines({
          totalPaise: Number(quote.total_paise),
          providerPayablePaise: Number(quote.provider_payable_paise),
          platformFeePaise: Number(quote.platform_fee_paise),
          taxPaise: Number(quote.tax_paise),
          protectionFeePaise: Number(quote.protection_fee_paise),
          customerId: job.customer_id,
          providerId: quote.provider_id,
        }),
        { idempotencyKey: `cap_${p.id}`, jobId: job.id, paymentId: p.id, referenceType: 'booking_quote', referenceId: quote.id },
      );

      await notify(quote.provider_id, 'payment.captured', 'Payment received', 'The customer approved the work. Your payout is being prepared.', job.id);
      adapters.analytics.track('payment_captured', { userId: job.customer_id, jobId: job.id, amountPaise: Number(p.amount_paise) });

      // The payout itself waits out the hold window; this only records what is owed.
      await this.prepareSettlements(job, ctx);
      return captured;
    },

    /** A material order is captured when the customer confirms they received the goods. */
    async captureMaterialOrder(order: MaterialOrderRecord) {
      const payments = await store.payments.listForJob(order.job_id);
      const payment = payments.find((p) => p.idempotency_key === `mat_${order.id}`);
      if (!payment || payment.status !== 'AUTHORIZED') return null;

      await adapters.payment.capture({ providerPaymentId: payment.provider_payment_id ?? payment.id, amountPaise: Number(payment.amount_paise) });
      const captured = await store.payments.update(payment.id, { status: 'CAPTURED' });
      await postBatch(
        buildMaterialCaptureLines({
          totalPaise: Number(order.total_paise),
          customerId: payment.payer_id,
          vendorId: order.vendor_id,
        }),
        { idempotencyKey: `mat_cap_${order.id}`, jobId: order.job_id, paymentId: payment.id, referenceType: 'material_order', referenceId: order.id },
      );
      adapters.analytics.track('material_captured', { userId: payment.payer_id, jobId: order.job_id });
      return captured;
    },

    // ------------------------------------------------------------------ settlement
    /** Records what is owed to the provider and to any vendor, in PENDING. Nothing leaves yet. */
    async prepareSettlements(job: JobRecord, _ctx: TransitionContext) {
      const created: SettlementRecord[] = [];
      const quote = await store.negotiation.getActiveQuote(job.id);
      const payment = await bookingPayment(job.id);

      if (quote && payment && (payment.status === 'CAPTURED' || payment.status === 'SETTLED')) {
        const key = `set_provider_${job.id}`;
        if (!(await store.finance.findSettlement(key))) {
          const refunded = (await store.finance.listRefundsForJob(job.id))
            .filter((r) => r.status !== 'FAILED')
            .reduce((sum, r) => sum + Number(r.amount_paise), 0);
          const owed = Number(quote.provider_payable_paise) - refunded;
          if (owed > 0) {
            created.push(
              await store.finance.createSettlement({
                job_id: job.id,
                payee_id: quote.provider_id,
                payee_role: 'PROVIDER',
                material_order_id: null,
                amount_paise: owed,
                status: 'PENDING',
                attempts: 0,
                failure_reason: null,
                provider_transfer_id: null,
                idempotency_key: key,
                initiated_at: null,
                paid_at: null,
              }),
            );
          }
        }
      }

      for (const order of await store.materials.listOrdersForJob(job.id)) {
        const payments = await store.payments.listForJob(job.id);
        const matPayment = payments.find((p) => p.idempotency_key === `mat_${order.id}`);
        const problem = checkCanSettleVendor({
          orderStatus: order.status,
          hasInvoice: !!order.invoice_media_id,
          paymentStatus: matPayment?.status ?? 'NONE',
          existingSettlement: !!(await store.finance.findSettlement(`set_vendor_${order.id}`)),
          openDisputes: await openDisputeCount(job.id),
        });
        if (problem) continue;
        created.push(
          await store.finance.createSettlement({
            job_id: job.id,
            payee_id: order.vendor_id,
            payee_role: 'VENDOR',
            material_order_id: order.id,
            amount_paise: Number(order.vendor_payable_paise),
            status: 'PENDING',
            attempts: 0,
            failure_reason: null,
            provider_transfer_id: null,
            idempotency_key: `set_vendor_${order.id}`,
            initiated_at: null,
            paid_at: null,
          }),
        );
      }
      return created;
    },

    /**
     * Sends the money that is due. Each payout is idempotent on the settlement id, and three
     * failures park it for a human instead of retrying forever (PAYMENT_FLOW section 8).
     */
    async runSettlements(limit: number, actorId: string | null) {
      const due = await store.finance.listSettlementsByStatus('PENDING', limit);
      const results: Array<{ id: string; status: string; reason?: string }> = [];

      for (const s of due) {
        const job = await store.jobs.get(s.job_id);
        const payment = s.payee_role === 'VENDOR' ? null : await bookingPayment(s.job_id);
        const payeeProfile = s.payee_role === 'VENDOR' ? await store.users.getVendorProfile(s.payee_id) : await store.users.getProviderProfile(s.payee_id);
        const problem = job
          ? checkCanSettle({
              jobStatus: job.status,
              paymentStatus: s.payee_role === 'VENDOR' ? 'CAPTURED' : (payment?.status ?? 'NONE'),
              capturedAt: s.created_at,
              amountPaise: Number(s.amount_paise),
              openDisputes: await openDisputeCount(s.job_id),
              existingSettlement: false,
              payeeSuspended: payeeProfile?.verification_status === 'SUSPENDED',
            })
          : 'JOB_NOT_COMPLETE';

        if (problem === 'HOLD_PERIOD') {
          results.push({ id: s.id, status: 'PENDING', reason: 'hold_period' });
          continue;
        }
        if (problem) {
          await store.finance.updateSettlement(s.id, { status: 'ON_HOLD', failure_reason: problem });
          results.push({ id: s.id, status: 'ON_HOLD', reason: problem });
          continue;
        }

        const initiated = await store.finance.updateSettlement(s.id, { status: 'INITIATED', initiated_at: new Date(), attempts: s.attempts + 1 });
        const payout = await adapters.payment.payout({
          amountPaise: Number(s.amount_paise),
          payeeRef: s.payee_id,
          idempotencyKey: s.idempotency_key,
        });

        if (!payout.ok) {
          const attempts = initiated.attempts;
          const status = attempts >= 3 ? 'ON_HOLD' : 'FAILED';
          await store.finance.updateSettlement(s.id, { status, failure_reason: payout.failureReason ?? 'payout_failed' });
          results.push({ id: s.id, status, reason: payout.failureReason });
          continue;
        }

        await store.finance.updateSettlement(s.id, { status: 'PAID', paid_at: new Date(), provider_transfer_id: payout.transferId });
        await postBatch(
          buildSettlementLines({
            amountPaise: Number(s.amount_paise),
            payeeId: s.payee_id,
            type: s.payee_role === 'VENDOR' ? 'VENDOR_PAYABLE' : 'PROVIDER_PAYABLE',
          }),
          { idempotencyKey: `set_${s.id}`, jobId: s.job_id, paymentId: null, referenceType: 'settlement', referenceId: s.id, createdBy: actorId },
        );

        // The job is only SETTLED once nothing is outstanding on it.
        if (job) {
          const remaining = (await store.finance.listSettlementsForPayee(s.payee_id, 50)).filter(
            (x) => x.job_id === job.id && x.status !== 'PAID',
          );
          if (remaining.length === 0 && job.status === 'COMPLETED') {
            await store.jobs.update(job.id, { payment_status: 'SETTLED' });
            await jobs.transition(job, 'SETTLED', systemCtx(null), { reason: 'Payment settled' });
          }
        }
        await notify(s.payee_id, 'payout.sent', 'Payout sent', 'Your earnings for this job are on the way to your account.', s.job_id);
        results.push({ id: s.id, status: 'PAID' });
      }
      return results;
    },

    // ------------------------------------------------------------------ cancellation
    /** What cancelling now would cost, before anyone commits to it. */
    async cancellationQuote(job: JobRecord) {
      const quote = await store.negotiation.getActiveQuote(job.id);
      const stage = cancellationStage(job.status);
      const charge = quote
        ? customerCancellationCharge(stage, { visitFeePaise: Number(quote.visit_fee_paise), totalPaise: Number(quote.total_paise) })
        : 0;
      const authorized = quote ? Number(quote.total_paise) : 0;
      return {
        stage,
        chargePaise: charge,
        refundPaise: Math.max(0, authorized - charge),
        needsSupport: cancellationNeedsSupport(job.status),
        explanation:
          charge === 0
            ? 'Nothing will be charged. The hold on your card is released.'
            : stage === 'AFTER_STARTED'
              ? 'Work has already started, so support will agree the amount with you.'
              : 'Only the visit fee is charged because the provider was already on the way.',
      };
    },

    /**
     * Cancelling with money attached: charge what policy allows, let the rest go, and record
     * both. An authorization that was never captured is *released*, not refunded - the customer
     * is never shown a refund for money that never left their account.
     */
    async cancelWithMoney(job: JobRecord, userId: string, reason: string, byRole: 'CUSTOMER' | 'PROVIDER', ctx: TransitionContext) {
      const quote = await store.negotiation.getActiveQuote(job.id);
      const payment = await bookingPayment(job.id);
      const stage = cancellationStage(job.status);
      const charge =
        byRole === 'PROVIDER' || !quote
          ? 0 // the customer never pays for a provider's cancellation
          : customerCancellationCharge(stage, { visitFeePaise: Number(quote.visit_fee_paise), totalPaise: Number(quote.total_paise) });

      if (cancellationNeedsSupport(job.status) && byRole === 'CUSTOMER') {
        blocked('CANCELLATION_NEEDS_SUPPORT', { stage });
      }

      const cancelled = await jobs.transition(job, byRole === 'CUSTOMER' ? 'CANCELLED_BY_CUSTOMER' : 'CANCELLED_BY_PROVIDER', ctx, {
        reason,
        patch: { cancelled_reason: reason, cancelled_by_role: byRole },
      });

      if (payment && payment.status === 'AUTHORIZED') {
        if (charge > 0 && quote) {
          await adapters.payment.capture({ providerPaymentId: payment.provider_payment_id ?? payment.id, amountPaise: charge });
          await store.payments.update(payment.id, { status: 'CAPTURED', amount_paise: charge });
          await store.jobs.update(job.id, { payment_status: 'CAPTURED' });
          // The visit fee is the provider's, minus the platform's share of it.
          await postBatch(
            [
              { entryType: 'CUSTOMER_CHARGE', amountPaise: charge, accountUserId: job.customer_id, note: 'Cancellation charge' },
              { entryType: 'PROVIDER_PAYABLE', amountPaise: -charge, accountUserId: quote.provider_id },
            ],
            { idempotencyKey: `cancel_${job.id}`, jobId: job.id, paymentId: payment.id, referenceType: 'cancellation' },
          );
        } else {
          await store.payments.update(payment.id, { status: 'RELEASED' });
          await store.jobs.update(job.id, { payment_status: 'NONE' });
        }
      }

      // Cancelling on a customer after confirming is a strike, not a shrug.
      if (byRole === 'PROVIDER' && quote) {
        await this.addStrike(quote.provider_id, 'MAJOR', `Cancelled a confirmed job: ${reason}`, { jobId: job.id, issuedBy: null });
      }

      const other = byRole === 'CUSTOMER' ? quote?.provider_id : job.customer_id;
      if (other) {
        await notify(other, 'job.cancelled', 'Booking cancelled', reason, job.id);
      }
      adapters.analytics.track('job_cancelled', { userId, jobId: job.id, byRole, chargePaise: charge });
      return { job: cancelled, chargePaise: charge };
    },

    // ------------------------------------------------------------------ refunds
    /** A refund of money that really was captured, written to the ledger where it came from. */
    async refund(job: JobRecord, amountPaise: number, reason: string, opts: { requestedBy: string | null; disputeId?: string | null; key?: string } = { requestedBy: null }) {
      const payment = await bookingPayment(job.id);
      if (!payment || (payment.status !== 'CAPTURED' && payment.status !== 'SETTLED' && payment.status !== 'DISPUTE_HOLD' && payment.status !== 'PARTIALLY_REFUNDED')) {
        blocked('NOTHING_CAPTURED');
      }
      const p = payment!;
      const quote = await store.negotiation.getActiveQuote(job.id);
      if (!quote) blocked('NO_QUOTE');

      const captured = await capturedAllocation(job.id);
      const already = (await store.finance.listRefundsForJob(job.id))
        .filter((r) => r.status !== 'FAILED')
        .reduce((sum, r) => sum + Number(r.amount_paise), 0);
      if (already + amountPaise > captured.totalPaise) {
        blocked('REFUND_EXCEEDS_CAPTURE', { capturedPaise: captured.totalPaise, alreadyRefundedPaise: already });
      }

      const key = opts.key ?? `ref_${job.id}_${already + amountPaise}`;
      const existing = await store.finance.findRefund(key);
      if (existing) return existing;

      const record = await store.finance.createRefund({
        payment_id: p.id,
        job_id: job.id,
        amount_paise: amountPaise,
        reason,
        status: 'PENDING',
        provider_refund_id: null,
        idempotency_key: key,
        requested_by: opts.requestedBy,
        dispute_id: opts.disputeId ?? null,
      });

      const gateway = await adapters.payment.refund({
        providerPaymentId: p.provider_payment_id ?? p.id,
        amountPaise,
        idempotencyKey: key,
      });
      const done = await store.finance.updateRefund(record.id, { status: 'COMPLETED', provider_refund_id: gateway.providerRefundId });

      // Split it back across exactly the lines the capture created, so the batch balances.
      const split = splitRefund(amountPaise, captured);
      await postBatch(
        buildRefundLines({
          amountPaise,
          ...split,
          customerId: job.customer_id,
          providerId: quote.provider_id,
          reason,
        }),
        { idempotencyKey: `ref_${record.id}`, jobId: job.id, paymentId: p.id, referenceType: 'refund', referenceId: record.id, createdBy: opts.requestedBy },
      );

      const full = already + amountPaise >= captured.totalPaise;
      await store.payments.update(p.id, { status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' });
      await store.jobs.update(job.id, { payment_status: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' });
      await notify(job.customer_id, 'payment.refunded', 'Refund on its way', reason, job.id);
      adapters.analytics.track('refund_issued', { userId: job.customer_id, jobId: job.id, amountPaise });
      return done;
    },

    // ------------------------------------------------------------------ disputes
    async raiseDispute(
      job: JobRecord,
      userId: string,
      input: { category: DisputeCategory; description: string; mediaIds?: string[] },
      ctx: TransitionContext,
    ) {
      const assignment = await store.negotiation.getActiveAssignment(job.id);
      const providerIds = assignment ? [assignment.provider_id, assignment.technician_id].filter((x): x is string => !!x) : [];
      const onJob = job.customer_id === userId || providerIds.includes(userId);
      const problem = checkCanRaiseDispute(
        { status: job.status, completedAt: job.completed_at ?? null },
        { description: input.description, onJob, openDisputes: await openDisputeCount(job.id) },
      );
      if (problem) blocked(problem);

      const againstId = job.customer_id === userId ? (assignment?.provider_id ?? null) : job.customer_id;
      const slaHours = DISPUTE_SLA_HOURS[input.category] ?? 48;
      const dispute = await store.finance.createDispute({
        job_id: job.id,
        raised_by: userId,
        against_user_id: againstId,
        category: input.category,
        description: input.description,
        status: 'OPEN',
        resolution: null,
        resolution_reason: null,
        refund_paise: null,
        resolved_by: null,
        second_approver_id: null,
        resolved_at: null,
        reopened_count: 0,
        sla_due_at: new Date(Date.now() + slaHours * 3600_000),
        assigned_to: null,
        queue_note: null,
      });

      for (const mediaId of input.mediaIds ?? []) {
        await store.finance.addEvidence({ dispute_id: dispute.id, uploaded_by: userId, media_id: mediaId, note: null });
      }

      // Money stops moving the moment a dispute opens: settlements freeze and the hold is marked.
      const payment = await bookingPayment(job.id);
      if (payment && (payment.status === 'CAPTURED' || payment.status === 'AUTHORIZED')) {
        await store.payments.update(payment.id, { status: 'DISPUTE_HOLD' });
        await store.jobs.update(job.id, { payment_status: 'DISPUTE_HOLD' });
        const quote = await store.negotiation.getActiveQuote(job.id);
        if (quote && payment.status === 'CAPTURED') {
          await postBatch(
            buildDisputeHoldLines({ amountPaise: Number(quote.provider_payable_paise), providerId: quote.provider_id, jobRef: job.id }),
            { idempotencyKey: `hold_${dispute.id}`, jobId: job.id, paymentId: payment.id, referenceType: 'dispute', referenceId: dispute.id },
          );
        }
      }
      for (const s of (await store.finance.listSettlementsForPayee(againstId ?? userId, 50)).filter((x) => x.job_id === job.id && x.status === 'PENDING')) {
        await store.finance.updateSettlement(s.id, { status: 'ON_HOLD', failure_reason: 'dispute_open' });
      }

      // A live job stops where it is; a finished one keeps its outcome while support looks.
      if (job.status !== 'COMPLETED' && job.status !== 'SETTLED') {
        await jobs.transition(job, 'DISPUTED', ctx, { reason: 'Dispute raised', metadata: { disputeId: dispute.id, category: input.category } });
      }

      if (againstId) await notify(againstId, 'dispute.raised', 'A dispute was raised', 'Support will contact you. Please add anything that helps.', job.id);
      adapters.analytics.track('dispute_raised', { userId, jobId: job.id, category: input.category });
      return dispute;
    },

    async addDisputeEvidence(dispute: DisputeRecord, userId: string, mediaIds: string[], note?: string) {
      const job = await store.jobs.get(dispute.job_id);
      if (!job) throw notFound('job');
      const assignment = await store.negotiation.getActiveAssignment(job.id);
      const onJob =
        job.customer_id === userId ||
        [assignment?.provider_id, assignment?.technician_id].filter(Boolean).includes(userId);
      if (!onJob) throw forbidden('not on this job');
      if (!disputeIsOpen(dispute.status)) blocked('DISPUTE_CLOSED');
      const added = [];
      for (const mediaId of mediaIds) {
        added.push(await store.finance.addEvidence({ dispute_id: dispute.id, uploaded_by: userId, media_id: mediaId, note: note ?? null }));
      }
      if (dispute.status === 'OPEN') await store.finance.updateDispute(dispute.id, { status: 'UNDER_REVIEW' });
      return added;
    },

    /**
     * Support's decision. Every outcome is recorded with a reason, the money effect is written
     * to the ledger, and a large refund needs a second person.
     */
    async resolveDispute(
      dispute: DisputeRecord,
      adminId: string,
      input: { resolution: DisputeResolution; reason: string; refundPaise?: number; strike?: { userId: string; severity: StrikeSeverity; reason: string }; secondApproverId?: string },
      ctx: TransitionContext,
    ) {
      if (!disputeIsOpen(dispute.status)) blocked('DISPUTE_CLOSED');
      const job = await store.jobs.get(dispute.job_id);
      if (!job) throw notFound('job');

      const captured = await capturedAllocation(job.id);
      const refund =
        input.resolution === 'FULL_REFUND'
          ? captured.totalPaise
          : input.resolution === 'PARTIAL_REFUND'
            ? (input.refundPaise ?? 0)
            : 0;

      if (refundNeedsTwoPeople(refund)) {
        if (!input.secondApproverId) blocked('SECOND_APPROVER_REQUIRED', { thresholdPaise: 5_00_000 });
        if (input.secondApproverId === adminId) blocked('SECOND_APPROVER_MUST_DIFFER');
      }

      const resolved = await store.finance.updateDispute(dispute.id, {
        status: 'RESOLVED',
        resolution: input.resolution,
        resolution_reason: input.reason,
        refund_paise: refund || null,
        resolved_by: adminId,
        second_approver_id: input.secondApproverId ?? null,
        resolved_at: new Date(),
      });

      const payment = await bookingPayment(job.id);
      const quote = await store.negotiation.getActiveQuote(job.id);

      if (refund > 0 && payment) {
        // A dispute hold has to be released before the money can go anywhere.
        if (payment.status === 'DISPUTE_HOLD' && quote) {
          await store.payments.update(payment.id, { status: 'CAPTURED' });
          await postBatch(
            buildDisputeReleaseLines({ amountPaise: Number(quote.provider_payable_paise), providerId: quote.provider_id, jobRef: job.id }),
            { idempotencyKey: `rel_${dispute.id}`, jobId: job.id, paymentId: payment.id, referenceType: 'dispute', referenceId: dispute.id, createdBy: adminId },
          );
        }
        await this.refund(job, refund, `Dispute ${dispute.id}: ${input.reason}`, {
          requestedBy: adminId,
          disputeId: dispute.id,
          key: `ref_dispute_${dispute.id}`,
        });
      } else if (payment?.status === 'DISPUTE_HOLD' && quote) {
        await store.payments.update(payment.id, { status: 'CAPTURED' });
        await store.jobs.update(job.id, { payment_status: 'CAPTURED' });
        await postBatch(
          buildDisputeReleaseLines({ amountPaise: Number(quote.provider_payable_paise), providerId: quote.provider_id, jobRef: job.id }),
          { idempotencyKey: `rel_${dispute.id}`, jobId: job.id, paymentId: payment.id, referenceType: 'dispute', referenceId: dispute.id, createdBy: adminId },
        );
      }

      if (input.strike) {
        await this.addStrike(input.strike.userId, input.strike.severity, input.strike.reason, { jobId: job.id, disputeId: dispute.id, issuedBy: adminId });
      }

      // Put the job where the decision leaves it.
      if (job.status === 'DISPUTED') {
        const to: JobStatus = input.resolution === 'REWORK' || input.resolution === 'REPLACEMENT_PROVIDER' ? 'IN_PROGRESS' : input.resolution === 'FULL_REFUND' ? 'REFUNDED' : 'COMPLETED';
        await jobs.transition(job, to, ctx, { reason: `Dispute resolved - ${input.resolution}`, metadata: { disputeId: dispute.id } });
      }

      // Anything frozen by the dispute is now either releasable or gone.
      for (const s of (await store.finance.listSettlementsForPayee(dispute.against_user_id ?? adminId, 50)).filter((x) => x.job_id === job.id && x.status === 'ON_HOLD')) {
        await store.finance.updateSettlement(s.id, { status: refund > 0 ? 'ON_HOLD' : 'PENDING', failure_reason: refund > 0 ? 'refunded' : null });
      }

      await notify(dispute.raised_by, 'dispute.resolved', 'Your dispute was resolved', input.reason, job.id);
      if (dispute.against_user_id) await notify(dispute.against_user_id, 'dispute.resolved', 'Dispute resolved', input.reason, job.id);
      adapters.analytics.track('dispute_resolved', { userId: adminId, jobId: job.id, resolution: input.resolution, refundPaise: refund });
      return resolved;
    },

    // ------------------------------------------------------------------ strikes
    async addStrike(userId: string, severity: StrikeSeverity, reason: string, opts: { jobId?: string | null; disputeId?: string | null; issuedBy: string | null }) {
      const strike = await store.finance.addStrike({
        user_id: userId,
        severity,
        reason,
        issued_by: opts.issuedBy,
        dispute_id: opts.disputeId ?? null,
        job_id: opts.jobId ?? null,
        expires_at: null,
      });

      const profile = await store.users.getProviderProfile(userId);
      if (profile) {
        const cost = STRIKE_RELIABILITY_COST[severity] ?? 0;
        const strikes = await store.finance.listStrikes(userId);
        const suspend = shouldSuspend(strikes.map((s) => ({ severity: s.severity, createdAt: s.created_at })));
        await store.users.upsertProviderProfile({
          ...profile,
          reliability_score: Math.max(0, Number((profile.reliability_score - cost).toFixed(2))),
          strike_count: strikes.length,
          // A suspended account keeps what it earned; the payout waits for review.
          verification_status: suspend ? 'SUSPENDED' : profile.verification_status,
          is_available: suspend ? false : profile.is_available,
        });
        if (suspend) {
          await notify(userId, 'account.suspended', 'Account under review', 'Your account is paused while support reviews recent issues.', opts.jobId ?? '');
        }
      }
      adapters.analytics.track('strike_issued', { userId, severity });
      return strike;
    },

    // ------------------------------------------------------------------ reviews
    async review(job: JobRecord, userId: string, input: { rating: number; comment?: string }) {
      const assignment = await store.negotiation.getActiveAssignment(job.id);
      const providerIds = assignment ? [assignment.provider_id, assignment.technician_id].filter((x): x is string => !!x) : [];
      const onJob = job.customer_id === userId || providerIds.includes(userId);
      const problem = checkCanReview(
        { status: job.status, completedAt: job.completed_at ?? null },
        { onJob, alreadyReviewed: !!(await store.finance.findReview(job.id, userId)) },
      );
      if (problem) blocked(problem);

      const revieweeId = job.customer_id === userId ? (assignment?.provider_id ?? null) : job.customer_id;
      if (!revieweeId) blocked('NOBODY_TO_REVIEW');

      const record = await store.finance.createReview({
        job_id: job.id,
        reviewer_id: userId,
        reviewee_id: revieweeId,
        rating: input.rating,
        comment: input.comment ?? null,
      });

      // Ratings are an average of real completed jobs, recomputed rather than incremented loosely.
      const profile = await store.users.getProviderProfile(revieweeId);
      if (profile) {
        const next = nextRating({ ratingAvg: profile.rating_avg, ratingCount: profile.rating_count }, input.rating);
        await store.users.upsertProviderProfile({ ...profile, rating_avg: next.ratingAvg, rating_count: next.ratingCount });
      }
      adapters.analytics.track('review_left', { userId, jobId: job.id, rating: input.rating });
      return record;
    },

    // ------------------------------------------------------------------ views
    async earnings(userId: string) {
      const settlements = await store.finance.listSettlementsForPayee(userId, 50);
      const entries = await store.finance.listLedgerForAccount(userId, 50);
      const pending = settlements.filter((s) => s.status === 'PENDING' || s.status === 'INITIATED').reduce((t, s) => t + Number(s.amount_paise), 0);
      const settled = settlements.filter((s) => s.status === 'PAID').reduce((t, s) => t + Number(s.amount_paise), 0);
      const onHold = settlements.filter((s) => s.status === 'ON_HOLD' || s.status === 'FAILED').reduce((t, s) => t + Number(s.amount_paise), 0);
      return {
        currency: 'INR' as const,
        pendingPaise: pending,
        settledPaise: settled,
        onHoldPaise: onHold,
        lifetimePaise: pending + settled + onHold,
        jobsCompleted: new Set(settlements.map((s) => s.job_id)).size,
        settlements: settlements.map((s) => ({
          id: s.id,
          jobId: s.job_id,
          amountPaise: Number(s.amount_paise),
          status: s.status,
          payeeRole: s.payee_role,
          attempts: s.attempts,
          failureReason: s.failure_reason,
          initiatedAt: s.initiated_at?.toISOString() ?? null,
          paidAt: s.paid_at?.toISOString() ?? null,
          createdAt: s.created_at.toISOString(),
        })),
        recentEntries: entries.map((e) => ({
          id: e.id,
          jobId: e.job_id,
          entryType: e.entry_type,
          amountPaise: Number(e.amount_paise),
          note: e.note,
          createdAt: e.created_at.toISOString(),
        })),
      };
    },

    async jobMoney(job: JobRecord, viewerId: string) {
      if (job.customer_id !== viewerId) {
        const assignment = await store.negotiation.getActiveAssignment(job.id);
        const onJob = [assignment?.provider_id, assignment?.technician_id].filter(Boolean).includes(viewerId);
        if (!onJob) throw forbidden('not on this job');
      }
      const payments = await store.payments.listForJob(job.id);
      const booking = payments.find((p) => p.purpose === 'BOOKING' && p.status !== 'FAILED');
      const refunds = await store.finance.listRefundsForJob(job.id);
      return {
        jobId: job.id,
        authorizedPaise: booking && booking.status === 'AUTHORIZED' ? Number(booking.amount_paise) : 0,
        capturedPaise: booking && ['CAPTURED', 'SETTLED', 'PARTIALLY_REFUNDED', 'DISPUTE_HOLD'].includes(booking.status) ? Number(booking.amount_paise) : 0,
        refundedPaise: refunds.filter((r) => r.status === 'COMPLETED').reduce((t, r) => t + Number(r.amount_paise), 0),
        materialPaise: payments.filter((p) => p.purpose === 'MATERIAL' && p.status !== 'FAILED').reduce((t, p) => t + Number(p.amount_paise), 0),
        status: booking?.status ?? 'NONE',
        refunds: refunds.map((r) => ({
          id: r.id,
          amountPaise: Number(r.amount_paise),
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },

    async toDisputeView(dispute: DisputeRecord, viewerId: string) {
      const evidence = await store.finance.listEvidence(dispute.id);
      const media = await store.jobs.listMedia(dispute.job_id);
      return {
        id: dispute.id,
        jobId: dispute.job_id,
        category: dispute.category,
        status: dispute.status,
        description: dispute.description,
        raisedByMe: dispute.raised_by === viewerId,
        againstMe: dispute.against_user_id === viewerId,
        slaDueAt: dispute.sla_due_at.toISOString(),
        needsHuman: HUMAN_ONLY_CATEGORIES.includes(dispute.category),
        resolution: dispute.resolution,
        resolutionReason: dispute.resolution_reason,
        refundPaise: dispute.refund_paise === null ? null : Number(dispute.refund_paise),
        evidenceUrls: evidence
          .map((e) => media.find((m) => m.id === e.media_id)?.storage_key)
          .filter((x): x is string => !!x),
        resolvedAt: dispute.resolved_at?.toISOString() ?? null,
        createdAt: dispute.created_at.toISOString(),
      };
    },
  };
}

export type FinanceService = ReturnType<typeof financeService>;
