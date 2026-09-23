import {
  CHAT_OPEN_FROM,
  DEFAULT_FEE_POLICY,
  START_JOB_OTP_POLICY,
  checkCanCall,
  checkCanOverrideStart,
  checkCanStart,
  checkCompletion,
  checkRevisionRequest,
  computeQuote,
  flagChatMessage,
  MAX_CALLS_PER_JOB_PER_DAY,
  maskPhone,
  revisionNeedsSupport,
  type CallView,
  type ChatMessageView,
  type CompletionView,
  type ExecutionView,
  type JobStatus,
  type PriceRevisionView,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type {
  ChatMessageRecord,
  CompletionRecord,
  DataStore,
  JobRecord,
  PriceRevisionRecord,
  StartOtpRecord,
} from '../../data/types';
import { deriveOtpDigits, hmacOtp, newId, safeEqualHex } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';
import type { JobService, TransitionContext } from '../jobs/service';

export interface ExecutionDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  jobs: JobService;
  /** Called once the customer approves: capture and settlement belong to the finance module. */
  onJobCompleted?: (job: JobRecord, ctx: TransitionContext) => Promise<void>;
}

/** Statuses in which the provider side is allowed to act on a job at all. */
const LIVE: readonly JobStatus[] = [
  'PROVIDER_ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'STARTED',
  'IN_PROGRESS',
  'PRICE_REVISION_PENDING',
  'COMPLETION_PENDING',
  'CUSTOMER_APPROVAL_PENDING',
];

function blocked(code: string, extra: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_ERROR', { details: { execution: [code], ...extra } });
}

export function executionService(d: ExecutionDeps) {
  const { env, store, adapters, jobs } = d;

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
   * The code is generated once, the moment the booking is confirmed, and only its HMAC is
   * stored. The plaintext goes back to the caller exactly once so it can be handed to the
   * customer; after that only the customer's own view can show it again.
   */
  async function ensureStartCode(job: JobRecord): Promise<{ record: StartOtpRecord; code: string | null }> {
    const existing = await store.execution.getStartOtp(job.id);
    if (existing) return { record: existing, code: codeFor(existing) };
    const id = newId();
    const code = deriveOtpDigits(env.API_JWT_SECRET, `start:${job.id}:${id}`, START_JOB_OTP_POLICY.length);
    const record = await store.execution.createStartOtp({
      id,
      job_id: job.id,
      code_hash: hmacOtp(env.API_JWT_SECRET, job.id, code),
      attempts: 0,
      max_attempts: START_JOB_OTP_POLICY.maxAttempts,
      expires_at: new Date(Date.now() + START_JOB_OTP_POLICY.ttlSeconds * 1000),
      verified_at: null,
      verified_by: null,
      overridden_by: null,
      override_reason: null,
    });
    return { record, code };
  }

  /**
   * Recomputed from the secret and the record's id, so the plaintext is never stored and
   * the customer can be shown it again at any time. Only the customer's own view calls this.
   */
  function codeFor(record: StartOtpRecord): string {
    return deriveOtpDigits(env.API_JWT_SECRET, `start:${record.job_id}:${record.id}`, START_JOB_OTP_POLICY.length);
  }

  /** The people allowed on this job: the customer, the booked provider, their technician. */
  async function partiesFor(job: JobRecord) {
    const assignment = await store.negotiation.getActiveAssignment(job.id);
    const providerIds = assignment
      ? [assignment.provider_id, assignment.technician_id, assignment.contractor_id].filter((x): x is string => !!x)
      : job.confirmed_provider_id
        ? [job.confirmed_provider_id]
        : [];
    return { assignment, customerId: job.customer_id, providerIds };
  }

  async function requireProviderSide(job: JobRecord, userId: string) {
    const { assignment, providerIds } = await partiesFor(job);
    if (!providerIds.includes(userId)) throw forbidden('not the assigned provider');
    return assignment;
  }

  function toRevisionView(r: PriceRevisionRecord, mediaUrls: string[] = []): PriceRevisionView {
    return {
      id: r.id,
      jobId: r.job_id,
      reason: r.reason,
      extraLabourPaise: Number(r.extra_labour_paise),
      extraMaterialPaise: Number(r.extra_material_paise),
      extraTimeMinutes: r.extra_time_minutes,
      originalTotalPaise: Number(r.original_total_paise),
      revisedTotalPaise: Number(r.revised_total_paise),
      differencePaise: Number(r.revised_total_paise) - Number(r.original_total_paise),
      explanation: r.explanation,
      status: r.status,
      needsSupport: revisionNeedsSupport(Number(r.original_total_paise), Number(r.revised_total_paise)),
      mediaUrls,
      respondedAt: r.responded_at?.toISOString() ?? null,
      responseMessage: r.response_message,
      createdAt: r.created_at.toISOString(),
    };
  }

  function toCompletionView(c: CompletionRecord, mediaUrls: string[] = []): CompletionView {
    return {
      id: c.id,
      summary: c.summary,
      warrantyNote: c.warranty_note,
      mediaUrls,
      submittedAt: c.submitted_at.toISOString(),
      approvedAt: c.approved_at?.toISOString() ?? null,
      rejectionReason: c.rejection_reason,
    };
  }

  return {
    ensureStartCode,

    /** Throws unless the caller is the provider side of this job. */
    async requireOnJob(job: JobRecord, userId: string) {
      return requireProviderSide(job, userId);
    },

    // ------------------------------------------------------------------ technician
    async assignTechnician(job: JobRecord, providerUserId: string, technicianId: string) {
      if (!LIVE.includes(job.status)) blocked('JOB_NOT_LIVE', { status: job.status });
      const assignment = await requireProviderSide(job, providerUserId);
      if (!assignment) throw notFound('assignment');
      // Mirrors assignment_requires_verified_technician in 0004: an unverified person
      // never gets a customer's address.
      const tech = await store.users.findById(technicianId);
      if (!tech) throw notFound('technician');
      const roles = await store.users.listRoles(technicianId);
      if (!roles.some((r) => r.role === 'TECHNICIAN' && r.status === 'ACTIVE')) blocked('NOT_A_TECHNICIAN');
      const techProfile = await store.users.getTechnicianProfile(technicianId);
      if (techProfile?.verification_status !== 'VERIFIED') blocked('TECHNICIAN_NOT_VERIFIED');
      // A provider may only send their own people.
      if (techProfile.contractor_id !== assignment.provider_id && techProfile.contractor_id !== assignment.contractor_id) {
        blocked('TECHNICIAN_NOT_YOURS');
      }

      const updated = await store.negotiation.updateAssignment(assignment.id, { technician_id: technicianId });
      const thread = await store.execution.getThread(job.id);
      if (thread) await store.execution.ensureThread(job.id, [...thread.participant_ids, technicianId]);
      await notify(job.customer_id, 'job.technician', 'Technician assigned', `${tech.display_name ?? 'A technician'} will do the work.`, job.id);
      adapters.analytics.track('technician_assigned', { userId: providerUserId, jobId: job.id });
      return updated;
    },

    // ------------------------------------------------------------------ on the way / arrived
    async progress(job: JobRecord, userId: string, to: 'EN_ROUTE' | 'ARRIVED', etaMinutes: number | undefined, ctx: TransitionContext) {
      await requireProviderSide(job, userId);
      const moved = await jobs.transition(job, to, ctx, {
        metadata: etaMinutes === undefined ? {} : { etaMinutes },
      });
      if (to === 'EN_ROUTE') {
        // The code only matters now, so this is when the customer is told about it.
        await ensureStartCode(job);
        await notify(job.customer_id, 'job.en_route', 'Provider is on the way', 'Keep your 4-digit start code handy.', job.id);
      } else {
        await notify(job.customer_id, 'job.arrived', 'Provider has arrived', 'Share your 4-digit start code to begin the work.', job.id);
      }
      adapters.analytics.track(to === 'EN_ROUTE' ? 'job_en_route' : 'job_arrived', { userId, jobId: job.id });
      return moved;
    },

    // ------------------------------------------------------------------ start code
    async start(
      job: JobRecord,
      userId: string,
      role: string,
      input: { code?: string; override?: boolean; reason?: string },
      ctx: TransitionContext,
    ) {
      const isAdmin = role === 'ADMIN' || role === 'SUPPORT';
      if (!isAdmin) await requireProviderSide(job, userId);

      const otp = await store.execution.getStartOtp(job.id);
      if (!otp) blocked('NO_START_CODE');

      if (input.override) {
        const problem = checkCanOverrideStart(role, input.reason);
        if (problem) blocked(problem);
        if (job.status !== 'ARRIVED') blocked('JOB_NOT_ARRIVED', { status: job.status });
        await store.execution.updateStartOtp(otp.id, {
          overridden_by: userId,
          override_reason: input.reason ?? null,
          verified_at: new Date(),
        });
      } else {
        const problem = checkCanStart(job, {
          attempts: otp.attempts,
          maxAttempts: otp.max_attempts,
          expiresAt: otp.expires_at,
          verifiedAt: otp.verified_at,
        });
        if (problem) blocked(problem, { attemptsLeft: Math.max(0, otp.max_attempts - otp.attempts) });

        const ok = safeEqualHex(otp.code_hash, hmacOtp(env.API_JWT_SECRET, job.id, input.code ?? ''));
        if (!ok) {
          // Every wrong attempt is counted and kept - repeated failures are a signal.
          const after = await store.execution.updateStartOtp(otp.id, { attempts: otp.attempts + 1 });
          adapters.analytics.track('start_code_failed', { userId, jobId: job.id, attempts: after.attempts });
          blocked('WRONG_CODE', { attemptsLeft: Math.max(0, after.max_attempts - after.attempts) });
        }
        await store.execution.updateStartOtp(otp.id, { verified_at: new Date(), verified_by: userId });
      }

      const started = await jobs.transition(job, 'STARTED', ctx, {
        reason: input.override ? 'Work started (admin override)' : 'Work started (OTP verified)',
        metadata: input.override ? { override: true, by: userId } : { verifiedBy: userId },
      });
      // STARTED is a moment, not a state to sit in: the job is immediately in progress.
      const inProgress = await jobs.transition(started, 'IN_PROGRESS', systemCtx(ctx.requestId), { reason: 'Work in progress' });
      await notify(job.customer_id, 'job.started', 'Work has started', 'We will let you know when it is done.', job.id);
      adapters.analytics.track('job_started', { userId, jobId: job.id, override: !!input.override });
      return inProgress;
    },

    // ------------------------------------------------------------------ price revision
    async requestRevision(
      job: JobRecord,
      userId: string,
      input: {
        reason: string;
        extraLabourPaise: number;
        extraMaterialPaise: number;
        extraTimeMinutes: number;
        explanation: string;
        mediaIds: string[];
      },
      ctx: TransitionContext,
    ) {
      await requireProviderSide(job, userId);
      const quote = await store.negotiation.getActiveQuote(job.id);
      if (!quote) blocked('NO_ACTIVE_QUOTE');

      const history = await store.execution.listRevisions(job.id);
      const problem = checkRevisionRequest(
        job,
        { ...input, mediaCount: input.mediaIds.length },
        { openRequests: history.filter((r) => r.status === 'PENDING' || r.status === 'CLARIFICATION').length, totalRequests: history.length },
      );
      if (problem) blocked(problem);

      // The extra work is priced the same way the original was: the platform fee and tax
      // are computed on the new labour, never bolted on afterwards.
      const original = Number(quote.total_paise);
      const revisedQuote = computeQuote(
        {
          labourPaise: Number(quote.labour_paise) + input.extraLabourPaise,
          visitFeePaise: Number(quote.visit_fee_paise),
          materialEstimatePaise: Number(quote.material_estimate_paise) + input.extraMaterialPaise,
        },
        DEFAULT_FEE_POLICY,
      );

      const record = await store.execution.createRevision({
        job_id: job.id,
        quote_id: quote.id,
        requested_by: userId,
        reason: input.reason,
        extra_labour_paise: input.extraLabourPaise,
        extra_material_paise: input.extraMaterialPaise,
        extra_time_minutes: input.extraTimeMinutes,
        original_total_paise: original,
        revised_total_paise: revisedQuote.totalPaise,
        explanation: input.explanation,
        media_ids: input.mediaIds,
        status: 'PENDING',
        responded_by: null,
        responded_at: null,
        response_message: null,
      });

      await jobs.transition(job, 'PRICE_REVISION_PENDING', ctx, {
        reason: 'Additional approval required',
        metadata: { revisionId: record.id, revisedTotalPaise: revisedQuote.totalPaise },
      });
      await notify(
        job.customer_id,
        'job.price_revision',
        'Your approval is needed',
        'The provider found extra work. Nothing is charged until you approve it.',
        job.id,
      );
      adapters.analytics.track('price_revision_requested', { userId, jobId: job.id });
      return record;
    },

    /**
     * The customer's answer. Approving supersedes the locked quote with a new one and opens
     * a separate authorization for the difference - the original hold is never silently
     * increased.
     */
    async respondToRevision(
      job: JobRecord,
      revision: PriceRevisionRecord,
      customerId: string,
      action: 'APPROVE' | 'REJECT' | 'CLARIFY',
      message: string | undefined,
      ctx: TransitionContext,
    ) {
      if (job.customer_id !== customerId) throw forbidden('not your job');
      if (revision.status !== 'PENDING' && revision.status !== 'CLARIFICATION') blocked('REVISION_NOT_OPEN');

      if (action === 'CLARIFY') {
        const updated = await store.execution.updateRevision(revision.id, {
          status: 'CLARIFICATION',
          response_message: message ?? null,
        });
        await notify(revision.requested_by, 'job.price_revision', 'Customer asked a question', message ?? '', job.id);
        return { revision: updated, payment: null };
      }

      if (action === 'REJECT') {
        const updated = await store.execution.updateRevision(revision.id, {
          status: 'REJECTED',
          responded_by: customerId,
          responded_at: new Date(),
          response_message: message ?? null,
        });
        // The original quote stands, untouched, and the work continues under it.
        await jobs.transition(job, 'IN_PROGRESS', ctx, { reason: 'Revision resolved', metadata: { revisionId: revision.id, outcome: 'REJECTED' } });
        await notify(revision.requested_by, 'job.price_revision', 'Extra work not approved', 'Continue with the originally agreed scope.', job.id);
        adapters.analytics.track('price_revision_rejected', { userId: customerId, jobId: job.id });
        return { revision: updated, payment: null };
      }

      const oldQuote = await store.negotiation.getQuote(revision.quote_id);
      if (!oldQuote || oldQuote.status !== 'ACTIVE') blocked('QUOTE_SUPERSEDED');

      const result = await store.transaction(async (tx) => {
        const fresh = await tx.execution.getRevision(revision.id);
        if (!fresh || (fresh.status !== 'PENDING' && fresh.status !== 'CLARIFICATION')) blocked('REVISION_NOT_OPEN');

        const priced = computeQuote(
          {
            labourPaise: Number(oldQuote.labour_paise) + Number(fresh.extra_labour_paise),
            visitFeePaise: Number(oldQuote.visit_fee_paise),
            materialEstimatePaise: Number(oldQuote.material_estimate_paise) + Number(fresh.extra_material_paise),
          },
          DEFAULT_FEE_POLICY,
        );

        // One ACTIVE quote per job: the old one is superseded in the same transaction that
        // writes the new one (booking_quotes_one_active_idx).
        await tx.negotiation.updateQuote(oldQuote.id, { status: 'SUPERSEDED' });
        const quote = await tx.negotiation.createQuote({
          job_id: job.id,
          bid_id: oldQuote.bid_id,
          offer_id: oldQuote.offer_id,
          provider_id: oldQuote.provider_id,
          labour_paise: Number(oldQuote.labour_paise) + Number(fresh.extra_labour_paise),
          visit_fee_paise: Number(oldQuote.visit_fee_paise),
          material_estimate_paise: Number(oldQuote.material_estimate_paise) + Number(fresh.extra_material_paise),
          delivery_paise: Number(oldQuote.delivery_paise),
          platform_fee_paise: priced.platformFeePaise,
          protection_fee_paise: priced.protectionFeePaise,
          tax_paise: priced.taxPaise,
          total_paise: priced.totalPaise,
          provider_payable_paise: priced.providerPayablePaise,
          warranty_days: oldQuote.warranty_days,
          eta_minutes: oldQuote.eta_minutes + Number(fresh.extra_time_minutes),
          material_responsibility: oldQuote.material_responsibility,
          status: 'ACTIVE',
        });

        const difference = priced.totalPaise - Number(oldQuote.total_paise);
        const order = await adapters.payment.createOrder({
          amountPaise: difference,
          currency: 'INR',
          receipt: `rev_${fresh.id}`,
          notes: { jobId: job.id, revisionId: fresh.id },
        });
        const payment = await tx.payments.create({
          job_id: job.id,
          payer_id: customerId,
          quote_id: quote.id,
          purpose: 'PRICE_REVISION',
          amount_paise: difference,
          currency: 'INR',
          provider: adapters.payment.provider,
          provider_order_id: order.providerOrderId,
          provider_payment_id: null,
          status: 'PENDING',
          idempotency_key: `rev_${fresh.id}`,
          failure_reason: null,
          authorized_at: null,
        });

        const updated = await tx.execution.updateRevision(fresh.id, {
          status: 'APPROVED',
          responded_by: customerId,
          responded_at: new Date(),
          response_message: message ?? null,
        });
        await tx.jobs.update(job.id, { active_quote_id: quote.id });
        return { revision: updated, payment, quote };
      });

      await jobs.transition(job, 'IN_PROGRESS', ctx, {
        reason: 'Revision resolved',
        metadata: { revisionId: revision.id, outcome: 'APPROVED', quoteId: result.quote.id },
      });
      await notify(revision.requested_by, 'job.price_revision', 'Extra work approved', 'The customer approved the revised price.', job.id);
      adapters.analytics.track('price_revision_approved', { userId: customerId, jobId: job.id });
      return { revision: result.revision, payment: result.payment };
    },

    // ------------------------------------------------------------------ completion
    async complete(
      job: JobRecord,
      userId: string,
      input: { summary: string; mediaIds: string[]; warrantyNote?: string },
      ctx: TransitionContext,
    ) {
      await requireProviderSide(job, userId);
      const open = await store.execution.findOpenRevision(job.id);
      const media = await store.jobs.listMedia(job.id);
      const photos = media.filter((m) => input.mediaIds.includes(m.id) && m.kind === 'PHOTO');
      const problem = checkCompletion(job, {
        photoCount: photos.length,
        summary: input.summary,
        openRevisions: open ? 1 : 0,
      });
      if (problem) blocked(problem);

      const completion = await store.execution.createCompletion({
        job_id: job.id,
        submitted_by: userId,
        summary: input.summary,
        warranty_note: input.warrantyNote ?? null,
        media_ids: input.mediaIds,
        approved_by: null,
        approved_at: null,
        rejection_reason: null,
      });

      const pending = await jobs.transition(job, 'COMPLETION_PENDING', ctx, {
        reason: 'Work completed, evidence pending',
        metadata: { completionId: completion.id },
      });
      const awaiting = await jobs.transition(pending, 'CUSTOMER_APPROVAL_PENDING', ctx, {
        reason: 'Awaiting customer approval',
      });
      await notify(
        job.customer_id,
        'job.completion',
        'Work finished - please check',
        'Have a look at the photos and approve if you are happy.',
        job.id,
      );
      adapters.analytics.track('job_completion_submitted', { userId, jobId: job.id });
      return { job: awaiting, completion };
    },

    async approveCompletion(
      job: JobRecord,
      customerId: string,
      input: { approved: boolean; reason?: string; rating?: number },
      ctx: TransitionContext,
    ) {
      if (job.customer_id !== customerId) throw forbidden('not your job');
      if (job.status !== 'CUSTOMER_APPROVAL_PENDING') blocked('NOT_AWAITING_APPROVAL', { status: job.status });
      const completion = await store.execution.latestCompletion(job.id);
      if (!completion) blocked('NO_COMPLETION');

      if (!input.approved) {
        const updated = await store.execution.updateCompletion(completion.id, { rejection_reason: input.reason ?? null });
        const back = await jobs.transition(job, 'IN_PROGRESS', ctx, {
          reason: 'Customer reported incomplete work',
          metadata: { completionId: completion.id },
        });
        await notify(completion.submitted_by, 'job.completion', 'Customer reported an issue', input.reason ?? '', job.id);
        adapters.analytics.track('job_completion_rejected', { userId: customerId, jobId: job.id });
        return { job: back, completion: updated };
      }

      const updated = await store.execution.updateCompletion(completion.id, {
        approved_by: customerId,
        approved_at: new Date(),
      });
      const done = await jobs.transition(job, 'COMPLETED', ctx, {
        reason: 'Customer approved completion',
        patch: { completed_at: new Date() },
        metadata: { completionId: completion.id, rating: input.rating ?? null },
      });
      // Capture happens here, at the locked quote, and only now that the customer has said yes.
      await d.onJobCompleted?.(done, ctx);
      const thread = await store.execution.getThread(job.id);
      if (thread) await store.execution.updateThread(thread.id, { closed_at: new Date() });
      await notify(completion.submitted_by, 'job.completed', 'Work approved', 'The customer approved the work. Settlement follows.', job.id);
      adapters.analytics.track('job_completed', { userId: customerId, jobId: job.id });
      return { job: done, completion: updated };
    },

    // ------------------------------------------------------------------ the shared panel
    async view(job: JobRecord, viewerId: string): Promise<ExecutionView> {
      const { assignment, providerIds } = await partiesFor(job);
      const isCustomer = job.customer_id === viewerId;
      // The panel carries the technician, the revisions and the completion, so it is for the
      // people on this job and nobody else - a provider with an account is not a party to it.
      if (!isCustomer && !providerIds.includes(viewerId)) throw forbidden('not on this job');
      const otp = await store.execution.getStartOtp(job.id);
      const revisions = await store.execution.listRevisions(job.id);
      const open = revisions.find((r) => r.status === 'PENDING' || r.status === 'CLARIFICATION') ?? null;
      const completion = await store.execution.latestCompletion(job.id);
      const thread = await store.execution.getThread(job.id);

      let technician: ExecutionView['technician'] = null;
      if (assignment?.technician_id) {
        const t = await store.users.findById(assignment.technician_id);
        const tp = await store.users.getTechnicianProfile(assignment.technician_id);
        if (t) {
          technician = {
            id: t.id,
            name: tp?.full_name ?? t.display_name ?? 'Technician',
            verified: tp?.verification_status === 'VERIFIED',
            // The real number is never sent; masked calling arrives with the telephony adapter.
            maskedPhone: isCustomer ? maskPhone(t.phone_e164) : null,
          };
        }
      }

      const media = await store.jobs.listMedia(job.id);
      const urlsFor = (ids: string[]) => media.filter((m) => ids.includes(m.id)).map((m) => m.storage_key);
      const quote = await store.negotiation.getActiveQuote(job.id);

      return {
        jobId: job.id,
        status: job.status,
        // Only the customer ever sees the code. The provider has to be told it in person.
        startCode: isCustomer && otp && !otp.verified_at ? codeFor(otp) : null,
        startCodeAttemptsLeft: otp ? Math.max(0, otp.max_attempts - otp.attempts) : null,
        startedAt: otp?.verified_at?.toISOString() ?? null,
        startWasOverridden: !!otp?.overridden_by,
        technician,
        etaMinutes: quote?.eta_minutes ?? null,
        openRevision: open ? toRevisionView(open, urlsFor(open.media_ids)) : null,
        revisions: revisions.map((r) => toRevisionView(r, urlsFor(r.media_ids))),
        completion: completion ? toCompletionView(completion, urlsFor(completion.media_ids)) : null,
        chatUnread: thread ? await store.execution.unreadCount(thread.id, viewerId) : 0,
      };
    },

    // ------------------------------------------------------------------ chat
    async openThread(job: JobRecord, viewerId: string) {
      const { customerId, providerIds } = await partiesFor(job);
      const participants = [customerId, ...providerIds];
      if (!participants.includes(viewerId)) throw forbidden('not on this job');
      return store.execution.ensureThread(job.id, participants);
    },

    async sendMessage(job: JobRecord, senderId: string, body: string) {
      // Chat belongs to a live job: it opens with the booking and closes with the outcome,
      // whether or not anyone ever sent a message.
      if (!CHAT_OPEN_FROM.includes(job.status)) blocked('CHAT_CLOSED', { status: job.status });
      const thread = await this.openThread(job, senderId);
      if (thread.closed_at) blocked('CHAT_CLOSED');
      const party: ChatMessageRecord['sender_party'] =
        job.customer_id === senderId ? 'CUSTOMER' : (await store.negotiation.getActiveAssignment(job.id))?.technician_id === senderId ? 'TECHNICIAN' : 'PROVIDER';
      const flag = flagChatMessage(body);
      const message = await store.execution.addMessage({
        thread_id: thread.id,
        sender_id: senderId,
        sender_party: party,
        body,
        media_id: null,
        flagged: !!flag,
        flag_reason: flag,
        read_at: null,
      });
      const { customerId, providerIds } = await partiesFor(job);
      const others = [customerId, ...providerIds].filter((id) => id !== senderId);
      await Promise.all(others.map((id) => notify(id, 'chat.message', 'New message', body.slice(0, 80), job.id)));
      return message;
    },

    async messages(job: JobRecord, viewerId: string, limit = 100) {
      const thread = await this.openThread(job, viewerId);
      const rows = await store.execution.listMessages(thread.id, limit);
      await store.execution.markRead(thread.id, viewerId);
      const names = new Map<string, string>();
      for (const id of new Set(rows.map((r) => r.sender_id))) {
        const u = await store.users.findById(id);
        names.set(id, u?.display_name ?? 'Someone');
      }
      const items: ChatMessageView[] = rows.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: names.get(m.sender_id) ?? 'Someone',
        senderParty: m.sender_party,
        body: m.body,
        flagged: m.flagged,
        flagReason: m.flag_reason,
        mine: m.sender_id === viewerId,
        createdAt: m.created_at.toISOString(),
      }));
      return { threadId: thread.id, jobId: job.id, open: !thread.closed_at, items };
    },

    // ------------------------------------------------------------------ talking
    /**
     * Connects two people on a job through the telephony provider, so they can talk without
     * either of them learning the other's number.
     *
     * The call is logged - who rang whom, when, for how long - because in a dispute about what
     * was agreed on the phone, "there was a call at 4pm" is evidence. What is *said* is not
     * recorded: a recording is a privacy liability we have no consent for and no process to
     * handle, so the duration is all that is kept.
     */
    async startCall(job: JobRecord, callerId: string, input: { urgent?: boolean } = {}): Promise<CallView> {
      const { customerId, providerIds } = await partiesFor(job);
      const isCustomer = callerId === customerId;
      const calleeId = isCustomer ? providerIds[0] : customerId;

      const since = new Date(Date.now() - 24 * 3600_000);
      const callsToday = await store.reach.countCallsSince(job.id, callerId, since);
      const problem = checkCanCall({
        jobStatus: job.status,
        callerIsOnJob: isCustomer || providerIds.includes(callerId),
        callsToday,
        // The pilot is one city, so the server clock is the local clock. When that stops being
        // true this has to come from the job's address, not from here.
        localHour: new Date().getHours(),
        urgent: input.urgent,
      });
      // Not being on the job is an authorization failure, not a bad request, and is answered
      // the same way every other "this is not yours" is.
      if (problem === 'NOT_ON_THIS_JOB') throw forbidden('not on this job');
      if (problem) throw new AppError('VALIDATION_ERROR', { details: { call: [problem] } });
      if (!calleeId) throw new AppError('VALIDATION_ERROR', { details: { call: ['NOBODY_TO_CALL'] } });

      const [caller, callee] = await Promise.all([store.users.findById(callerId), store.users.findById(calleeId)]);
      if (!caller || !callee) throw notFound('user');

      const record = await store.reach.createCall({
        job_id: job.id,
        caller_id: callerId,
        callee_id: calleeId,
        virtual_number: null,
        provider_session_id: null,
        status: 'REQUESTED',
        failure_reason: null,
        duration_seconds: null,
      });

      try {
        const call = await adapters.telephony.createMaskedCall({
          fromE164: caller.phone_e164,
          toE164: callee.phone_e164,
          jobId: job.id,
        });
        const connected = await store.reach.updateCall(record.id, {
          virtual_number: call.virtualNumber,
          provider_session_id: call.sessionId,
          status: 'CONNECTED',
        });
        adapters.analytics.track('masked_call_started', { userId: callerId, jobId: job.id });
        return {
          id: connected.id,
          virtualNumber: call.virtualNumber,
          status: 'CONNECTED',
          // A first name only, the same as everywhere else a counterparty is shown.
          calleeName: (callee.display_name ?? 'your contact').split(' ')[0] ?? 'your contact',
          callsLeftToday: Math.max(0, MAX_CALLS_PER_JOB_PER_DAY - callsToday - 1),
          createdAt: connected.created_at.toISOString(),
        };
      } catch (e) {
        await store.reach.updateCall(record.id, { status: 'FAILED', failure_reason: 'provider_error' });
        adapters.monitoring.captureError(e, { scope: 'masked_call', jobId: job.id });
        throw new AppError('VALIDATION_ERROR', { details: { call: ['COULD_NOT_CONNECT'] } });
      }
    },

    toRevisionView,
    toCompletionView,
  };
}

export type ExecutionService = ReturnType<typeof executionService>;
