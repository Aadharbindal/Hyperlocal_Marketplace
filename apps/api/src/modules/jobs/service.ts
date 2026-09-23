import {
  BID_WINDOW_MINUTES,
  JOB_STATUS_LABEL_KEY,
  canTransition,
  checkMedia,
  checkSubmittable,
  detectHazards,
  isLikelyDuplicate,
  maskPhone,
  mediaPhaseFor,
  type Actor,
  type JobListItem,
  type JobMediaView,
  type JobStatus,
  type JobView,
  type Language,
  type UserRole,
} from '@hyperlocal/core';
import type { Adapters } from '../../adapters';
import type { Env } from '../../config/env';
import type {
  AddressRecord,
  CategoryRecord,
  DataStore,
  JobMediaRecord,
  JobRecord,
} from '../../data/types';
import { newId, newOpaqueToken } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';

export interface JobDeps {
  env: Env;
  store: DataStore;
  adapters: Adapters;
  /** Tells the live stream that this job moved, so the apps do not have to poll for it. */
  onTransition?: (job: JobRecord) => void;
}

export interface TransitionContext {
  actorUserId: string | null;
  actorRole: UserRole | null;
  actor: Actor;
  requestId: string | null;
}

const MEDIA_KIND_FOR_CHECK = { PHOTO: 'PHOTO', VOICE_NOTE: 'VOICE_NOTE', VIDEO: 'VIDEO', DOCUMENT: 'DOCUMENT' } as const;

export function jobService(d: JobDeps) {
  const { store, adapters, env } = d;

  /**
   * The only way a job changes status. Validates the state machine, writes the append-only
   * event and applies the status in one transaction (PRODUCT_SPEC section 9).
   */
  async function transition(
    job: JobRecord,
    to: JobStatus,
    ctx: TransitionContext,
    opts: { reason?: string; patch?: Partial<JobRecord>; metadata?: Record<string, unknown> } = {},
  ): Promise<JobRecord> {
    const check = canTransition(job.status, to, ctx.actor);
    if (!check.ok) {
      throw new AppError('JOB_INVALID_TRANSITION', {
        details: { from: job.status, to, actor: ctx.actor, code: check.code },
      });
    }
    return store.transaction(async (tx) => {
      const fresh = await tx.jobs.get(job.id);
      if (!fresh) throw notFound('job');
      // re-check against the row we are actually writing (guards concurrent updates)
      if (fresh.status !== job.status) {
        const recheck = canTransition(fresh.status, to, ctx.actor);
        if (!recheck.ok) throw new AppError('JOB_INVALID_TRANSITION', { details: { from: fresh.status, to } });
      }
      const updated = await tx.jobs.update(job.id, { ...opts.patch, status: to });
      await tx.jobs.appendEvent({
        job_id: job.id,
        actor_user_id: ctx.actorUserId,
        actor_role: ctx.actorRole,
        from_status: fresh.status,
        to_status: to,
        reason: opts.reason ?? check.rule?.label ?? null,
        metadata: opts.metadata ?? {},
        request_id: ctx.requestId,
      });
      d.onTransition?.(updated);
      return updated;
    });
  }

  async function ownedJob(jobId: string, userId: string): Promise<JobRecord> {
    const job = await store.jobs.get(jobId);
    if (!job) throw notFound('job');
    if (job.customer_id !== userId) throw forbidden('not your booking');
    return job;
  }

  async function requireAddress(addressId: string, userId: string): Promise<AddressRecord> {
    const address = await store.addresses.get(addressId);
    if (!address || address.deleted_at) throw notFound('address');
    if (address.user_id !== userId) throw forbidden('not your address');
    return address;
  }

  function snapshotOf(a: AddressRecord) {
    return {
      label: a.label,
      line1: a.line1,
      line2: a.line2,
      landmark: a.landmark,
      societyName: a.society_name,
      gateInstructions: a.gate_instructions,
      city: a.city,
      pincode: a.pincode,
    };
  }

  async function categoryOrThrow(categoryId: string): Promise<CategoryRecord> {
    const enabled = await store.categories.listEnabled();
    const found = enabled.find((c) => c.id === categoryId);
    if (!found) throw new AppError('VALIDATION_ERROR', { details: { field: 'categoryId', reason: 'not_available' } });
    return found;
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------
  async function mediaView(m: JobMediaRecord): Promise<JobMediaView> {
    return {
      id: m.id,
      kind: m.kind as JobMediaView['kind'],
      phase: m.phase,
      mime: m.mime,
      sizeBytes: Number(m.size_bytes),
      durationSeconds: m.duration_seconds,
      url: await adapters.storage.createSignedReadUrl(m.storage_key, env.STORAGE_SIGNED_URL_TTL_SECONDS),
      uploadedByRole: m.uploader_role,
      createdAt: m.created_at.toISOString(),
    };
  }

  async function toJobView(job: JobRecord, lang: Language, opts: { includeToken: boolean }): Promise<JobView> {
    const [cats, media, events] = await Promise.all([
      store.categories.listEnabled(),
      store.jobs.listMedia(job.id),
      store.jobs.listEvents(job.id),
    ]);
    const cat = cats.find((c) => c.id === job.category_id);
    return {
      id: job.id,
      status: job.status,
      statusLabelKey: JOB_STATUS_LABEL_KEY[job.status],
      paymentStatus: job.payment_status,
      category: {
        id: job.category_id,
        slug: cat?.slug ?? 'unknown',
        name: cat ? (lang === 'hi' ? cat.name_hi : cat.name_en) : 'Service',
        iconKey: cat?.icon_key ?? 'default',
      },
      skillIds: job.skill_ids,
      description: job.description,
      priority: job.priority,
      requestType: job.request_type,
      inspectionRequired: job.inspection_required,
      preferredStart: job.preferred_start?.toISOString() ?? null,
      preferredEnd: job.preferred_end?.toISOString() ?? null,
      address: (job.address_snapshot as JobView['address']) ?? null,
      addressId: job.address_id,
      bookedForName: job.booked_for_name,
      bookedForPhoneMasked: job.booked_for_phone_e164 ? maskPhone(job.booked_for_phone_e164) : null,
      trackingUrlToken: opts.includeToken ? job.recipient_tracking_token : null,
      bidWindowEndsAt: job.bid_window_ends_at?.toISOString() ?? null,
      media: await Promise.all(media.map(mediaView)),
      events: events.map((e) => ({
        id: e.id,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        actorRole: e.actor_role,
        reason: e.reason,
        createdAt: e.created_at.toISOString(),
      })),
      hazards: job.hazards,
      cancelledReason: job.cancelled_reason,
      createdAt: job.created_at.toISOString(),
      submittedAt: job.submitted_at?.toISOString() ?? null,
    };
  }

  async function toListItem(job: JobRecord, lang: Language): Promise<JobListItem> {
    const [cats, media] = await Promise.all([store.categories.listEnabled(), store.jobs.listMedia(job.id, 'REQUEST')]);
    const cat = cats.find((c) => c.id === job.category_id);
    const photo = media.find((m) => m.kind === 'PHOTO');
    const snap = job.address_snapshot as { label?: string } | null;
    return {
      id: job.id,
      status: job.status,
      statusLabelKey: JOB_STATUS_LABEL_KEY[job.status],
      categoryName: cat ? (lang === 'hi' ? cat.name_hi : cat.name_en) : 'Service',
      categoryIconKey: cat?.icon_key ?? 'default',
      description: job.description,
      priority: job.priority,
      addressLabel: snap?.label ?? null,
      thumbnailUrl: photo ? await adapters.storage.createSignedReadUrl(photo.storage_key, env.STORAGE_SIGNED_URL_TTL_SECONDS) : null,
      preferredStart: job.preferred_start?.toISOString() ?? null,
      createdAt: job.created_at.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  return {
    transition,
    ownedJob,
    toJobView,
    toListItem,

    async createDraft(input: {
      customerId: string;
      categoryId: string;
      skillIds?: string[];
      description?: string;
      priority: 'NORMAL' | 'URGENT';
      requestType: 'LABOUR_ONLY' | 'LABOUR_AND_MATERIAL';
      inspectionRequired?: boolean;
      addressId?: string;
      preferredStart?: string;
      preferredEnd?: string;
      bookedForName?: string;
      bookedForPhone?: string;
      ctx: TransitionContext;
    }): Promise<JobRecord> {
      const category = await categoryOrThrow(input.categoryId);
      const address = input.addressId ? await requireAddress(input.addressId, input.customerId) : null;

      // Resuming beats creating: one live draft per category+address (jobs_one_draft_per_target_idx).
      const existing = await store.jobs.findDraft(input.customerId, input.categoryId, address?.id ?? null);
      const patch: Partial<JobRecord> = {
        skill_ids: input.skillIds ?? [],
        description: input.description ?? null,
        priority: input.priority,
        request_type: input.requestType,
        inspection_required: input.inspectionRequired ?? category.requires_inspection_default,
        hazards: detectHazards(input.description ?? ''),
        preferred_start: input.preferredStart ? new Date(input.preferredStart) : null,
        preferred_end: input.preferredEnd ? new Date(input.preferredEnd) : null,
        address_id: address?.id ?? null,
        address_snapshot: address ? snapshotOf(address) : null,
        lat: address?.lat ?? null,
        lng: address?.lng ?? null,
        geohash: address?.geohash ?? null,
        booked_for_name: input.bookedForName ?? null,
        booked_for_phone_e164: input.bookedForPhone ?? null,
      };
      if (existing) return store.jobs.update(existing.id, patch);

      const job = await store.jobs.create({
        customer_id: input.customerId,
        recipient_tracking_token: null,
        category_id: input.categoryId,
        status: 'DRAFT',
        payment_status: 'NONE',
        bid_window_ends_at: null,
        confirmed_provider_id: null,
        active_quote_id: null,
        cancelled_reason: null,
        cancelled_by_role: null,
        submitted_at: null,
        completed_at: null,
        settled_at: null,
        deleted_at: null,
        ...patch,
      } as Parameters<DataStore['jobs']['create']>[0]);

      await store.jobs.appendEvent({
        job_id: job.id,
        actor_user_id: input.ctx.actorUserId,
        actor_role: input.ctx.actorRole,
        from_status: null,
        to_status: 'DRAFT',
        reason: 'Draft created',
        metadata: {},
        request_id: input.ctx.requestId,
      });
      adapters.analytics.track('job_created', { userId: input.customerId, categoryId: input.categoryId });
      return job;
    },

    async updateDraft(job: JobRecord, input: Record<string, unknown>, customerId: string): Promise<JobRecord> {
      if (job.status !== 'DRAFT') throw new AppError('CONFLICT', { details: { reason: 'job_already_submitted' } });
      const patch: Partial<JobRecord> = {};
      if (input.categoryId !== undefined) {
        await categoryOrThrow(input.categoryId as string);
        patch.category_id = input.categoryId as string;
      }
      if (input.skillIds !== undefined) patch.skill_ids = input.skillIds as string[];
      if (input.description !== undefined) {
        patch.description = (input.description as string) || null;
        patch.hazards = detectHazards((input.description as string) ?? '');
      }
      if (input.priority !== undefined) patch.priority = input.priority as JobRecord['priority'];
      if (input.requestType !== undefined) patch.request_type = input.requestType as JobRecord['request_type'];
      if (input.inspectionRequired !== undefined) patch.inspection_required = input.inspectionRequired as boolean;
      if (input.preferredStart !== undefined) patch.preferred_start = input.preferredStart ? new Date(input.preferredStart as string) : null;
      if (input.preferredEnd !== undefined) patch.preferred_end = input.preferredEnd ? new Date(input.preferredEnd as string) : null;
      if (input.bookedForName !== undefined) patch.booked_for_name = (input.bookedForName as string) || null;
      if (input.bookedForPhone !== undefined) patch.booked_for_phone_e164 = (input.bookedForPhone as string) || null;
      if (input.addressId !== undefined) {
        const address = await requireAddress(input.addressId as string, customerId);
        patch.address_id = address.id;
        patch.address_snapshot = snapshotOf(address);
        patch.lat = address.lat;
        patch.lng = address.lng;
        patch.geohash = address.geohash;
      }
      return store.jobs.update(job.id, patch);
    },

    /** Creates the media row and a short-lived upload target; the file lands in object storage. */
    async createMediaUpload(job: JobRecord, input: {
      kind: 'PHOTO' | 'VOICE_NOTE' | 'VIDEO' | 'DOCUMENT';
      mime: string;
      sizeBytes: number;
      durationSeconds?: number;
      sha256?: string;
      lat?: number;
      lng?: number;
      uploaderId: string;
      uploaderRole: UserRole;
      /** Defaults to the request phase; execution evidence passes PROGRESS/COMPLETION/PRICE_REVISION. */
      phase?: JobMediaRecord['phase'];
    }) {
      // The phase a job can receive depends on where it is, and mirrors
      // job_media_phase_allowed() in 0002.
      const phase = input.phase ?? 'REQUEST';
      if (mediaPhaseFor(job.status) !== phase) {
        throw new AppError('CONFLICT', { details: { reason: 'media_phase_closed', status: job.status, phase } });
      }
      const existing = await store.jobs.listMedia(job.id, phase);
      if (phase !== 'REQUEST' && existing.length >= 8) {
        throw new AppError('VALIDATION_ERROR', { details: { media: ['TOO_MANY_FILES'] } });
      }
      const errors = checkMedia({
        kind: MEDIA_KIND_FOR_CHECK[input.kind],
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        durationSeconds: input.durationSeconds,
        existingOfKind: existing.filter((m) => m.kind === input.kind).length,
      });
      if (errors.length) throw new AppError('VALIDATION_ERROR', { details: { media: errors } });

      const storageKey = `jobs/${job.id}/${phase.toLowerCase()}/${newId()}`;
      const target = await adapters.storage.createUploadUrl({ key: storageKey, mime: input.mime, maxBytes: input.sizeBytes });
      const media = await store.jobs.addMedia({
        job_id: job.id,
        uploader_id: input.uploaderId,
        uploader_role: input.uploaderRole,
        kind: input.kind,
        phase,
        storage_key: storageKey,
        mime: input.mime,
        size_bytes: input.sizeBytes,
        duration_seconds: input.durationSeconds ?? null,
        sha256: input.sha256 ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        transcript: null,
        review_status: 'PENDING',
        // The mock storage adapter has nowhere to PUT the bytes, so the row is marked uploaded
        // immediately and the client is told it can skip the transfer (KNOWN_LIMITATIONS).
        uploaded_at: adapters.storage.isMock ? new Date() : null,
        deleted_at: null,
      });
      return { media, target, uploadRequired: !adapters.storage.isMock };
    },

    async deleteMedia(job: JobRecord, mediaId: string, userId: string) {
      const m = await store.jobs.getMedia(mediaId);
      if (!m || m.job_id !== job.id) throw notFound('media');
      if (m.uploader_id !== userId) throw forbidden('not your upload');
      if (job.status !== 'DRAFT') throw new AppError('CONFLICT', { details: { reason: 'job_already_submitted' } });
      await store.jobs.updateMedia(mediaId, { deleted_at: new Date() });
      await adapters.storage.delete(m.storage_key).catch(() => undefined);
    },

    /** DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS, with the bid window started. */
    async submit(job: JobRecord, ctx: TransitionContext) {
      const cats = await store.categories.listEnabled();
      const category = cats.find((c) => c.id === job.category_id);
      const media = await store.jobs.listMedia(job.id, 'REQUEST');
      const address = job.address_id ? await store.addresses.get(job.address_id) : null;

      const blockers = checkSubmittable({
        categoryEnabled: !!category,
        description: job.description,
        mediaCount: media.length,
        hasAddress: !!address && !address.deleted_at,
        addressInPilotZone: !!address?.in_pilot_zone,
        preferredStart: job.preferred_start,
        preferredEnd: job.preferred_end,
        bookedForPhoneValid: true, // the zod schema already normalised it
      });
      if (blockers.length) throw new AppError('VALIDATION_ERROR', { details: { blockers } });

      const open = await store.jobs.findOpenForTarget(job.customer_id, job.category_id, job.address_id);
      const duplicate = open.find(
        (o) => o.id !== job.id && o.status !== 'DRAFT' && isLikelyDuplicate(
          { categoryId: job.category_id, addressId: job.address_id, createdAt: job.created_at },
          { categoryId: o.category_id, addressId: o.address_id, createdAt: o.created_at },
        ),
      );

      const submitted = await transition(job, 'SUBMITTED', ctx, {
        patch: {
          submitted_at: new Date(),
          recipient_tracking_token: job.recipient_tracking_token ?? newOpaqueToken(),
          address_snapshot: address ? snapshotOf(address) : job.address_snapshot,
        },
        reason: 'Request submitted',
      });
      adapters.analytics.track('job_submitted', { userId: job.customer_id, jobId: job.id });

      // Qualification is automatic in the pilot: categories and zones are already validated.
      const systemCtx: TransitionContext = { actorUserId: null, actorRole: null, actor: 'SYSTEM', requestId: ctx.requestId };
      const qualifying = await transition(submitted, 'QUALIFYING', systemCtx, { reason: 'Qualifying request' });
      const windowMinutes = BID_WINDOW_MINUTES[job.priority];
      const open4bids = await transition(qualifying, 'OPEN_FOR_BIDS', systemCtx, {
        patch: { bid_window_ends_at: new Date(Date.now() + windowMinutes * 60_000) },
        reason: 'Open for offers',
        metadata: { windowMinutes },
      });

      await store.notifications.create({
        user_id: job.customer_id,
        type: 'job.submitted',
        title: 'Finding providers',
        body: `We are sending your ${category?.name_en ?? 'service'} request to verified professionals nearby.`,
        data: { jobId: job.id },
        channel: 'IN_APP',
        read_at: null,
        sent_at: new Date(),
      });

      return { job: open4bids, duplicateOf: duplicate?.id ?? null };
    },

    async cancelByCustomer(job: JobRecord, reason: string, ctx: TransitionContext) {
      return transition(job, 'CANCELLED_BY_CUSTOMER', ctx, {
        reason,
        patch: { cancelled_reason: reason, cancelled_by_role: 'CUSTOMER' },
      });
    },
  };
}

export type JobService = ReturnType<typeof jobService>;
