import type {
  BidStatus,
  ConsentType,
  JobPriority,
  JobRequestType,
  JobStatus,
  Language,
  PaymentStatus,
  RoleStatus,
  UserRole,
  MaterialResponsibility,
  UserStatus,
  VerificationStatus,
} from '@hyperlocal/core';

// ---------------------------------------------------------------------------
// Domain records (snake_case mirrors the SQL schema; views are mapped in modules)
// ---------------------------------------------------------------------------

export interface UserRecord {
  id: string;
  phone_e164: string;
  phone_verified_at: Date | null;
  display_name: string | null;
  avatar_url: string | null;
  preferred_language: Language;
  status: UserStatus;
  suspended_reason: string | null;
  last_login_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: UserRole;
  status: RoleStatus;
  granted_by: string | null;
  created_at: Date;
}

export interface OtpChallengeRecord {
  id: string;
  phone_e164: string;
  purpose: 'LOGIN' | 'START_JOB';
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  request_ip: string | null;
  created_at: Date;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_label: string | null;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  rotated_from: string | null;
  last_used_at: Date | null;
  created_at: Date;
}

export interface CustomerProfileRecord {
  user_id: string;
  full_name: string | null;
  email: string | null;
  default_address_id: string | null;
  marketing_opt_in: boolean;
}

export interface ProviderProfileRecord {
  user_id: string;
  business_name: string | null;
  bio: string | null;
  experience_years: number | null;
  service_radius_km: number;
  base_lat: number | null;
  base_lng: number | null;
  is_available: boolean;
  verification_status: VerificationStatus;
  reliability_score: number;
  rating_avg: number | null;
  rating_count: number;
  completed_jobs: number;
  strike_count: number;
  contractor_id: string | null;
  suspended_until: Date | null;
}

export interface ContractorProfileRecord {
  user_id: string;
  business_name: string | null;
  verification_status: VerificationStatus;
  base_lat: number | null;
  base_lng: number | null;
  service_radius_km: number;
}

export interface VendorProfileRecord {
  user_id: string;
  shop_name: string | null;
  shop_address_id: string | null;
  delivery_radius_km: number;
  material_categories: string[];
  delivery_available: boolean;
  verification_status: VerificationStatus;
}

export interface AddressRecord {
  id: string;
  user_id: string;
  label: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  society_name: string | null;
  gate_instructions: string | null;
  city: string;
  pincode: string;
  lat: number;
  lng: number;
  geohash: string;
  is_default: boolean;
  in_pilot_zone: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CategoryRecord {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  icon_key: string;
  is_enabled: boolean;
  requires_inspection_default: boolean;
  sort_order: number;
}

export interface SkillRecord {
  id: string;
  category_id: string;
  slug: string;
  name_en: string;
  name_hi: string;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  consent_type: ConsentType;
  version: string;
  granted: boolean;
  granted_at: Date | null;
  withdrawn_at: Date | null;
  ip: string | null;
  created_at: Date;
}

export interface AuditLogRecord {
  id: string;
  actor_user_id: string | null;
  actor_role: UserRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  before: unknown | null;
  after: unknown | null;
  ip: string | null;
  request_id: string | null;
  created_at: Date;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channel: 'IN_APP' | 'PUSH' | 'SMS';
  read_at: Date | null;
  sent_at: Date | null;
  created_at: Date;
}

export interface RetentionEventRecord {
  id: string;
  entity_type: string;
  entity_id: string;
  action: 'ANONYMISE' | 'PURGE' | 'EXPORT';
  scheduled_for: Date;
  executed_at: Date | null;
  reason: string | null;
  created_at: Date;
}

export interface JobRecord {
  id: string;
  customer_id: string;
  booked_for_name: string | null;
  booked_for_phone_e164: string | null;
  recipient_tracking_token: string | null;
  category_id: string;
  skill_ids: string[];
  description: string | null;
  priority: JobPriority;
  request_type: JobRequestType;
  inspection_required: boolean;
  hazards: string[];
  preferred_start: Date | null;
  preferred_end: Date | null;
  address_id: string | null;
  address_snapshot: Record<string, unknown> | null;
  lat: number | null;
  lng: number | null;
  geohash: string | null;
  status: JobStatus;
  payment_status: PaymentStatus;
  bid_window_ends_at: Date | null;
  confirmed_provider_id: string | null;
  active_quote_id: string | null;
  cancelled_reason: string | null;
  cancelled_by_role: UserRole | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  settled_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobMediaRecord {
  id: string;
  job_id: string;
  uploader_id: string;
  uploader_role: UserRole;
  kind: 'PHOTO' | 'VIDEO' | 'VOICE_NOTE' | 'DOCUMENT' | 'INVOICE';
  phase: 'REQUEST' | 'PROGRESS' | 'COMPLETION' | 'DISPUTE' | 'PRICE_REVISION';
  storage_key: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number | null;
  sha256: string | null;
  lat: number | null;
  lng: number | null;
  transcript: string | null;
  review_status: 'PENDING' | 'APPROVED' | 'FLAGGED' | 'REJECTED';
  uploaded_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

export interface JobStatusEventRecord {
  id: string;
  job_id: string;
  actor_user_id: string | null;
  actor_role: UserRole | null;
  from_status: JobStatus | null;
  to_status: JobStatus;
  reason: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  created_at: Date;
}

export interface BidRecord {
  id: string;
  job_id: string;
  provider_id: string;
  contractor_id: string | null;
  labour_paise: number;
  visit_fee_paise: number;
  eta_minutes: number;
  warranty_days: number;
  material_responsibility: MaterialResponsibility;
  notes: string | null;
  revision_no: number;
  status: BidStatus;
  expires_at: Date;
  withdrawn_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BidRevisionRecord {
  id: string;
  bid_id: string;
  revision_no: number;
  labour_paise: number;
  visit_fee_paise: number;
  eta_minutes: number;
  warranty_days: number;
  notes: string | null;
  created_at: Date;
}

export interface KycRecord {
  id: string;
  user_id: string;
  document_type: string;
  storage_key_encrypted: string;
  doc_number_last4: string | null;
  status: VerificationStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IdempotencyRecord {
  key: string;
  user_id: string;
  route: string;
  status: number;
  body: unknown;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Repository interfaces
// ---------------------------------------------------------------------------

export type New<T> = Omit<T, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<T, Extract<'id', keyof T>>>;

export interface UsersRepo {
  findById(id: string): Promise<UserRecord | null>;
  findByPhone(phoneE164: string): Promise<UserRecord | null>;
  create(input: { phone_e164: string; display_name?: string | null; preferred_language?: Language }): Promise<UserRecord>;
  update(id: string, patch: Partial<Omit<UserRecord, 'id' | 'created_at'>>): Promise<UserRecord>;
  search(q: string, limit: number): Promise<UserRecord[]>;

  listRoles(userId: string): Promise<UserRoleRecord[]>;
  grantRole(input: { user_id: string; role: UserRole; granted_by: string | null }): Promise<UserRoleRecord>;
  setRoleStatus(userId: string, role: UserRole, status: RoleStatus): Promise<void>;

  getCustomerProfile(userId: string): Promise<CustomerProfileRecord | null>;
  upsertCustomerProfile(p: CustomerProfileRecord): Promise<CustomerProfileRecord>;
  getProviderProfile(userId: string): Promise<ProviderProfileRecord | null>;
  upsertProviderProfile(p: ProviderProfileRecord): Promise<ProviderProfileRecord>;
  getContractorProfile(userId: string): Promise<ContractorProfileRecord | null>;
  upsertContractorProfile(p: ContractorProfileRecord): Promise<ContractorProfileRecord>;
  getVendorProfile(userId: string): Promise<VendorProfileRecord | null>;
  upsertVendorProfile(p: VendorProfileRecord): Promise<VendorProfileRecord>;

  listProviderSkills(providerId: string): Promise<string[]>;
  setProviderSkills(providerId: string, skillIds: string[]): Promise<void>;

  listConsents(userId: string): Promise<ConsentRecord[]>;
  addConsent(c: New<ConsentRecord>): Promise<ConsentRecord>;
}

export interface AuthRepo {
  createChallenge(c: New<OtpChallengeRecord>): Promise<OtpChallengeRecord>;
  getChallenge(id: string): Promise<OtpChallengeRecord | null>;
  updateChallenge(id: string, patch: Partial<OtpChallengeRecord>): Promise<OtpChallengeRecord>;
  countChallengesSince(phoneE164: string, since: Date): Promise<number>;
  countChallengesByIpSince(ip: string, since: Date): Promise<number>;
  latestChallenge(phoneE164: string): Promise<OtpChallengeRecord | null>;

  createSession(s: New<SessionRecord>): Promise<SessionRecord>;
  findSessionByHash(hash: string): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<number>;
  touchSession(id: string): Promise<void>;
}

export interface AddressesRepo {
  list(userId: string): Promise<AddressRecord[]>;
  get(id: string): Promise<AddressRecord | null>;
  create(a: New<AddressRecord>): Promise<AddressRecord>;
  update(id: string, patch: Partial<AddressRecord>): Promise<AddressRecord>;
  clearDefault(userId: string): Promise<void>;
}

export interface CategoriesRepo {
  listEnabled(): Promise<CategoryRecord[]>;
  listSkills(categoryIds: string[]): Promise<SkillRecord[]>;
}

export interface AuditRepo {
  append(entry: New<AuditLogRecord>): Promise<AuditLogRecord>;
  list(filter: { entityType?: string; entityId?: string; actorUserId?: string; limit: number }): Promise<AuditLogRecord[]>;
}

export interface NotificationsRepo {
  create(n: New<NotificationRecord>): Promise<NotificationRecord>;
  listForUser(userId: string, limit: number): Promise<NotificationRecord[]>;
}

export interface RetentionRepo {
  schedule(e: New<RetentionEventRecord>): Promise<RetentionEventRecord>;
}

export interface JobsRepo {
  create(j: New<JobRecord>): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  getByTrackingToken(token: string): Promise<JobRecord | null>;
  update(id: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  listForCustomer(customerId: string, opts: { statuses?: JobStatus[]; limit: number }): Promise<JobRecord[]>;
  findOpenForTarget(customerId: string, categoryId: string, addressId: string | null): Promise<JobRecord[]>;
  findDraft(customerId: string, categoryId: string, addressId: string | null): Promise<JobRecord | null>;
  /** Open jobs a provider could quote on; distance is filtered by the caller. */
  listOpenForFeed(opts: { categoryIds: string[]; limit: number }): Promise<JobRecord[]>;

  addMedia(m: New<JobMediaRecord>): Promise<JobMediaRecord>;
  listMedia(jobId: string, phase?: JobMediaRecord['phase']): Promise<JobMediaRecord[]>;
  getMedia(id: string): Promise<JobMediaRecord | null>;
  updateMedia(id: string, patch: Partial<JobMediaRecord>): Promise<JobMediaRecord>;

  appendEvent(e: New<JobStatusEventRecord>): Promise<JobStatusEventRecord>;
  listEvents(jobId: string): Promise<JobStatusEventRecord[]>;
}

export interface BidsRepo {
  create(b: New<BidRecord>): Promise<BidRecord>;
  get(id: string): Promise<BidRecord | null>;
  update(id: string, patch: Partial<BidRecord>): Promise<BidRecord>;
  listForJob(jobId: string, statuses?: BidStatus[]): Promise<BidRecord[]>;
  listForProvider(providerId: string, statuses?: BidStatus[]): Promise<BidRecord[]>;
  findActive(jobId: string, providerId: string): Promise<BidRecord | null>;
  addRevision(r: New<BidRevisionRecord>): Promise<BidRevisionRecord>;
  listRevisions(bidId: string): Promise<BidRevisionRecord[]>;
}

export interface KycRepo {
  submit(k: New<KycRecord>): Promise<KycRecord>;
  listForUser(userId: string): Promise<KycRecord[]>;
  findOpen(userId: string, documentType: string): Promise<KycRecord | null>;
  update(id: string, patch: Partial<KycRecord>): Promise<KycRecord>;
}

export interface IdempotencyRepo {
  get(key: string, userId: string): Promise<IdempotencyRecord | null>;
  put(rec: IdempotencyRecord): Promise<void>;
}

export interface DataStore {
  readonly mode: 'memory' | 'postgres';
  users: UsersRepo;
  auth: AuthRepo;
  addresses: AddressesRepo;
  categories: CategoriesRepo;
  jobs: JobsRepo;
  bids: BidsRepo;
  kyc: KycRepo;
  audit: AuditRepo;
  notifications: NotificationsRepo;
  retention: RetentionRepo;
  idempotency: IdempotencyRepo;
  /** Run fn atomically. Memory store runs it serially; Postgres uses a transaction. */
  transaction<T>(fn: (store: DataStore) => Promise<T>): Promise<T>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}
