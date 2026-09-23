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
  DisputeCategory,
  DisputeResolution,
  DisputeStatus,
  LedgerEntryType,
  MaterialOrderStatus,
  MaterialQuoteStatus,
  MaterialRequestStatus,
  MaterialResponsibility,
  QuotedItem as QuotedMaterialItem,
  SettlementStatus,
  StrikeSeverity,
  OfferStatus,
  PaymentStatus as PaymentStatusEnum,
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
  /** A suspension names both people; the SQL trigger in 0008 refuses one that does not. */
  suspended_by: string | null;
  suspension_approved_by: string | null;
  /** What this person agreed to have sent to their phone. Money and account alerts have no switch. */
  push_job_updates: boolean;
  push_offers: boolean;
  push_marketing: boolean;
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
  /** When this session last satisfied a second factor (admin routes check its age). */
  mfa_verified_at: Date | null;
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
  /** How many times the customer has moved this booking; two is the limit. */
  reschedule_count: number;
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

export interface TechnicianProfileRecord {
  user_id: string;
  contractor_id: string;
  full_name: string | null;
  verification_status: VerificationStatus;
  skills: string[];
  active: boolean;
}

export interface OfferRecord {
  id: string;
  job_id: string;
  bid_id: string;
  parent_offer_id: string | null;
  sender_id: string;
  sender_party: 'CUSTOMER' | 'PROVIDER';
  receiver_id: string;
  labour_paise: number;
  visit_fee_paise: number;
  eta_minutes: number;
  warranty_days: number;
  material_responsibility: MaterialResponsibility;
  scope_notes: string | null;
  status: OfferStatus;
  expires_at: Date;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface BookingQuoteRecord {
  id: string;
  job_id: string;
  bid_id: string;
  offer_id: string | null;
  provider_id: string;
  labour_paise: number;
  visit_fee_paise: number;
  material_estimate_paise: number;
  delivery_paise: number;
  platform_fee_paise: number;
  protection_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  provider_payable_paise: number;
  warranty_days: number;
  eta_minutes: number;
  material_responsibility: MaterialResponsibility;
  status: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  locked_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** `locked_at` defaults in SQL and is set by the memory repo, so callers never pass it. */
export type NewBookingQuote = Omit<New<BookingQuoteRecord>, 'locked_at'>;

export interface AssignmentRecord {
  id: string;
  job_id: string;
  provider_id: string;
  technician_id: string | null;
  contractor_id: string | null;
  assigned_by: string | null;
  status: 'ACTIVE' | 'REPLACED' | 'CANCELLED';
  replaced_by: string | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentRecord {
  id: string;
  job_id: string;
  payer_id: string;
  quote_id: string | null;
  purpose: 'BOOKING' | 'MATERIAL' | 'MILESTONE' | 'PRICE_REVISION';
  amount_paise: number;
  currency: 'INR';
  provider: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  status: PaymentStatusEnum;
  idempotency_key: string;
  failure_reason: string | null;
  authorized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentEventRecord {
  id: string;
  payment_id: string | null;
  provider_event_id: string;
  type: string;
  payload: Record<string, unknown>;
  signature_valid: boolean;
  processed_at: Date | null;
  created_at: Date;
}

export interface StartOtpRecord {
  id: string;
  job_id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  verified_by: string | null;
  overridden_by: string | null;
  override_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export type PriceRevisionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLARIFICATION' | 'CANCELLED' | 'SUPPORT';

export interface PriceRevisionRecord {
  id: string;
  job_id: string;
  quote_id: string;
  requested_by: string;
  reason: string;
  extra_labour_paise: number;
  extra_material_paise: number;
  extra_time_minutes: number;
  original_total_paise: number;
  revised_total_paise: number;
  explanation: string;
  media_ids: string[];
  status: PriceRevisionStatus;
  responded_by: string | null;
  responded_at: Date | null;
  response_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CompletionRecord {
  id: string;
  job_id: string;
  submitted_by: string;
  summary: string;
  warranty_note: string | null;
  media_ids: string[];
  submitted_at: Date;
  approved_by: string | null;
  approved_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChatThreadRecord {
  id: string;
  job_id: string;
  participant_ids: string[];
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ChatMessageRecord {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_party: 'CUSTOMER' | 'PROVIDER' | 'TECHNICIAN' | 'SUPPORT';
  body: string;
  media_id: string | null;
  flagged: boolean;
  flag_reason: string | null;
  read_at: Date | null;
  created_at: Date;
}

export interface MaterialRequestRecord {
  id: string;
  job_id: string;
  requested_by: string;
  items: Array<{ name: string; quantity: number; unit: string; brandPreference?: string | null }>;
  note: string | null;
  needed_by: Date | null;
  quote_window_ends_at: Date;
  status: MaterialRequestStatus;
  created_at: Date;
  updated_at: Date;
}

export interface MaterialQuoteRecord {
  id: string;
  request_id: string;
  vendor_id: string;
  items: QuotedMaterialItem[];
  subtotal_paise: number;
  delivery_paise: number;
  total_paise: number;
  eta_minutes: number;
  note: string | null;
  status: MaterialQuoteStatus;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MaterialOrderRecord {
  id: string;
  request_id: string;
  quote_id: string;
  job_id: string;
  vendor_id: string;
  selected_by: string;
  items: QuotedMaterialItem[];
  subtotal_paise: number;
  delivery_paise: number;
  total_paise: number;
  vendor_payable_paise: number;
  eta_minutes: number;
  status: MaterialOrderStatus;
  delivered_at: Date | null;
  confirmed_by: string | null;
  confirmed_at: Date | null;
  issue: string | null;
  issue_note: string | null;
  issue_media_ids: string[];
  cancel_reason: string | null;
  invoice_media_id: string | null;
  invoice_number: string | null;
  invoice_amount_paise: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface LedgerEntryRecord {
  id: string;
  job_id: string | null;
  payment_id: string | null;
  entry_type: LedgerEntryType;
  account_user_id: string | null;
  amount_paise: number;
  currency: string;
  batch_id: string;
  idempotency_key: string;
  reference_type: string | null;
  reference_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: Date;
}

export interface SettlementRecord {
  id: string;
  job_id: string;
  payee_id: string;
  payee_role: UserRole;
  material_order_id: string | null;
  amount_paise: number;
  status: SettlementStatus;
  attempts: number;
  failure_reason: string | null;
  provider_transfer_id: string | null;
  idempotency_key: string;
  initiated_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RefundRecord {
  id: string;
  payment_id: string;
  job_id: string;
  amount_paise: number;
  reason: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  provider_refund_id: string | null;
  idempotency_key: string;
  requested_by: string | null;
  dispute_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DisputeRecord {
  id: string;
  job_id: string;
  raised_by: string;
  against_user_id: string | null;
  category: DisputeCategory;
  description: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  resolution_reason: string | null;
  refund_paise: number | null;
  resolved_by: string | null;
  second_approver_id: string | null;
  resolved_at: Date | null;
  reopened_count: number;
  sla_due_at: Date;
  assigned_to: string | null;
  queue_note: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DisputeEvidenceRecord {
  id: string;
  dispute_id: string;
  uploaded_by: string;
  media_id: string | null;
  note: string | null;
  created_at: Date;
}

export interface StrikeRecord {
  id: string;
  user_id: string;
  severity: StrikeSeverity;
  reason: string;
  issued_by: string | null;
  dispute_id: string | null;
  job_id: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface ReviewRecord {
  id: string;
  job_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

export interface SupportTicketRecord {
  id: string;
  opened_by: string;
  job_id: string | null;
  dispute_id: string | null;
  category: string;
  subject: string;
  body: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED';
  assigned_to: string | null;
  priority: number;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PayoutAccountRecord {
  id: string;
  user_id: string;
  method: 'BANK_ACCOUNT' | 'UPI';
  account_holder_name: string;
  /** Only the last four digits are ever stored, the way KYC does it. */
  account_last4: string | null;
  ifsc: string | null;
  vpa: string | null;
  provider_contact_id: string | null;
  provider_fund_account_id: string | null;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'DISABLED';
  verified_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AdminMfaRecord {
  user_id: string;
  secret_encrypted: string;
  enabled_at: Date | null;
  last_used_step: number | null;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface KycAccessLogRecord {
  id: string;
  kyc_record_id: string;
  viewed_by: string;
  purpose: string;
  ip: string | null;
  created_at: Date;
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
  getTechnicianProfile(userId: string): Promise<TechnicianProfileRecord | null>;
  upsertTechnicianProfile(p: TechnicianProfileRecord): Promise<TechnicianProfileRecord>;
  listTechniciansFor(contractorId: string): Promise<TechnicianProfileRecord[]>;
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
  getSession(id: string): Promise<SessionRecord | null>;
  /** Stamps the moment this session satisfied a second factor. */
  markSessionMfa(id: string, at: Date): Promise<SessionRecord | null>;
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
  countUnread(userId: string): Promise<number>;
  /** Marks the given notifications read, or every unread one when ids is omitted. */
  markRead(userId: string, ids?: string[]): Promise<number>;
}

export interface DeviceTokenRecord {
  id: string;
  user_id: string;
  token: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  device_label: string | null;
  app_version: string | null;
  disabled_at: Date | null;
  disabled_reason: string | null;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MaskedCallRecord {
  id: string;
  job_id: string;
  caller_id: string;
  callee_id: string;
  virtual_number: string | null;
  provider_session_id: string | null;
  status: 'REQUESTED' | 'CONNECTED' | 'FAILED' | 'ENDED';
  failure_reason: string | null;
  duration_seconds: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobRescheduleRecord {
  id: string;
  job_id: string;
  requested_by: string;
  previous_start: Date | null;
  previous_end: Date | null;
  new_start: Date;
  new_end: Date | null;
  reason: string | null;
  created_at: Date;
}

/** Devices, calls and reschedules: the three ways a job reaches beyond the app. */
export interface ReachRepo {
  /**
   * Registering the same token twice is the normal case, not an error: the app sends it on
   * every launch. A token that moved to another account moves with it rather than notifying
   * both people.
   */
  upsertDevice(d: Omit<New<DeviceTokenRecord>, 'disabled_at' | 'disabled_reason' | 'last_seen_at'>): Promise<DeviceTokenRecord>;
  listDevices(userId: string): Promise<DeviceTokenRecord[]>;
  /** Active push tokens for a person; an empty list simply means nowhere to send. */
  activeTokens(userId: string): Promise<string[]>;
  disableToken(token: string, reason: string): Promise<void>;
  removeDevice(userId: string, id: string): Promise<void>;

  createCall(c: New<MaskedCallRecord>): Promise<MaskedCallRecord>;
  updateCall(id: string, patch: Partial<MaskedCallRecord>): Promise<MaskedCallRecord>;
  countCallsSince(jobId: string, callerId: string, since: Date): Promise<number>;

  addReschedule(r: New<JobRescheduleRecord>): Promise<JobRescheduleRecord>;
  listReschedules(jobId: string): Promise<JobRescheduleRecord[]>;
}

export interface RetentionRepo {
  schedule(e: New<RetentionEventRecord>): Promise<RetentionEventRecord>;
  /** Events whose time has come and that nothing has executed yet. */
  listDue(now: Date, limit: number): Promise<RetentionEventRecord[]>;
  markExecuted(id: string, at: Date): Promise<RetentionEventRecord>;
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
  /** Jobs sitting in these statuses, oldest first - what the background sweeps work through. */
  listByStatus(statuses: JobStatus[], limit: number): Promise<JobRecord[]>;

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
  get(id: string): Promise<KycRecord | null>;
  /** The review queue: submissions nobody has decided yet, oldest first. */
  listByStatus(statuses: VerificationStatus[], limit: number): Promise<KycRecord[]>;
  listForUser(userId: string): Promise<KycRecord[]>;
  findOpen(userId: string, documentType: string): Promise<KycRecord | null>;
  update(id: string, patch: Partial<KycRecord>): Promise<KycRecord>;
}

export interface NegotiationRepo {
  createOffer(o: New<OfferRecord>): Promise<OfferRecord>;
  getOffer(id: string): Promise<OfferRecord | null>;
  updateOffer(id: string, patch: Partial<OfferRecord>): Promise<OfferRecord>;
  listOffersForJob(jobId: string): Promise<OfferRecord[]>;
  listOffersForBid(bidId: string): Promise<OfferRecord[]>;
  findPendingForBid(bidId: string): Promise<OfferRecord | null>;
  /** Pending offers whose time has run out. */
  listExpiredOffers(now: Date, limit: number): Promise<OfferRecord[]>;

  createQuote(q: NewBookingQuote): Promise<BookingQuoteRecord>;
  getActiveQuote(jobId: string): Promise<BookingQuoteRecord | null>;
  getQuote(id: string): Promise<BookingQuoteRecord | null>;
  updateQuote(id: string, patch: Partial<BookingQuoteRecord>): Promise<BookingQuoteRecord>;

  createAssignment(a: New<AssignmentRecord>): Promise<AssignmentRecord>;
  getActiveAssignment(jobId: string): Promise<AssignmentRecord | null>;
  updateAssignment(id: string, patch: Partial<AssignmentRecord>): Promise<AssignmentRecord>;
}

export interface PaymentsRepo {
  create(p: New<PaymentRecord>): Promise<PaymentRecord>;
  get(id: string): Promise<PaymentRecord | null>;
  findByIdempotencyKey(key: string): Promise<PaymentRecord | null>;
  findByOrderId(orderId: string): Promise<PaymentRecord | null>;
  findLiveBooking(jobId: string): Promise<PaymentRecord | null>;
  /** Payments still waiting on a gateway answer since before `before`. */
  listStale(status: PaymentStatusEnum, before: Date, limit: number): Promise<PaymentRecord[]>;
  update(id: string, patch: Partial<PaymentRecord>): Promise<PaymentRecord>;
  listForJob(jobId: string): Promise<PaymentRecord[]>;

  /** Returns null when this gateway event was already recorded (replay). */
  recordEvent(e: New<PaymentEventRecord>): Promise<PaymentEventRecord | null>;
}

export interface ExecutionRepo {
  createStartOtp(o: Omit<New<StartOtpRecord>, 'updated_at'>): Promise<StartOtpRecord>;
  getStartOtp(jobId: string): Promise<StartOtpRecord | null>;
  updateStartOtp(id: string, patch: Partial<StartOtpRecord>): Promise<StartOtpRecord>;

  createRevision(r: New<PriceRevisionRecord>): Promise<PriceRevisionRecord>;
  getRevision(id: string): Promise<PriceRevisionRecord | null>;
  updateRevision(id: string, patch: Partial<PriceRevisionRecord>): Promise<PriceRevisionRecord>;
  listRevisions(jobId: string): Promise<PriceRevisionRecord[]>;
  findOpenRevision(jobId: string): Promise<PriceRevisionRecord | null>;

  createCompletion(c: Omit<New<CompletionRecord>, 'submitted_at'>): Promise<CompletionRecord>;
  updateCompletion(id: string, patch: Partial<CompletionRecord>): Promise<CompletionRecord>;
  latestCompletion(jobId: string): Promise<CompletionRecord | null>;

  ensureThread(jobId: string, participantIds: string[]): Promise<ChatThreadRecord>;
  getThread(jobId: string): Promise<ChatThreadRecord | null>;
  updateThread(id: string, patch: Partial<ChatThreadRecord>): Promise<ChatThreadRecord>;
  addMessage(m: New<ChatMessageRecord>): Promise<ChatMessageRecord>;
  listMessages(threadId: string, limit: number): Promise<ChatMessageRecord[]>;
  markRead(threadId: string, readerId: string): Promise<number>;
  unreadCount(threadId: string, readerId: string): Promise<number>;
}

export interface MaterialsRepo {
  createRequest(r: New<MaterialRequestRecord>): Promise<MaterialRequestRecord>;
  getRequest(id: string): Promise<MaterialRequestRecord | null>;
  updateRequest(id: string, patch: Partial<MaterialRequestRecord>): Promise<MaterialRequestRecord>;
  listRequestsForJob(jobId: string): Promise<MaterialRequestRecord[]>;
  findOpenRequest(jobId: string): Promise<MaterialRequestRecord | null>;
  /** Requests still inside their quote window, newest first; distance is filtered by the caller. */
  listOpenRequests(limit: number): Promise<MaterialRequestRecord[]>;

  createQuote(q: New<MaterialQuoteRecord>): Promise<MaterialQuoteRecord>;
  getQuote(id: string): Promise<MaterialQuoteRecord | null>;
  updateQuote(id: string, patch: Partial<MaterialQuoteRecord>): Promise<MaterialQuoteRecord>;
  listQuotes(requestId: string): Promise<MaterialQuoteRecord[]>;
  findVendorQuote(requestId: string, vendorId: string): Promise<MaterialQuoteRecord | null>;
  /** Live quotes past their expiry, and requests whose quote window has closed. */
  listExpiredQuotes(now: Date, limit: number): Promise<MaterialQuoteRecord[]>;
  listStaleRequests(now: Date, limit: number): Promise<MaterialRequestRecord[]>;

  createOrder(o: New<MaterialOrderRecord>): Promise<MaterialOrderRecord>;
  getOrder(id: string): Promise<MaterialOrderRecord | null>;
  updateOrder(id: string, patch: Partial<MaterialOrderRecord>): Promise<MaterialOrderRecord>;
  findLiveOrder(requestId: string): Promise<MaterialOrderRecord | null>;
  listOrdersForJob(jobId: string): Promise<MaterialOrderRecord[]>;
  listOrdersForVendor(vendorId: string, limit: number): Promise<MaterialOrderRecord[]>;
}

export interface FinanceRepo {
  /** Writes a whole balanced batch or nothing; returns [] when the key was already used. */
  appendLedger(batch: Array<Omit<New<LedgerEntryRecord>, 'currency'>>): Promise<LedgerEntryRecord[]>;
  listLedgerForAccount(userId: string, limit: number): Promise<LedgerEntryRecord[]>;
  listLedgerForJob(jobId: string): Promise<LedgerEntryRecord[]>;
  ledgerKeyExists(idempotencyKey: string): Promise<boolean>;

  createSettlement(s: New<SettlementRecord>): Promise<SettlementRecord>;
  getSettlement(id: string): Promise<SettlementRecord | null>;
  updateSettlement(id: string, patch: Partial<SettlementRecord>): Promise<SettlementRecord>;
  findSettlement(idempotencyKey: string): Promise<SettlementRecord | null>;
  listSettlementsForPayee(payeeId: string, limit: number): Promise<SettlementRecord[]>;
  listSettlementsByStatus(status: SettlementStatus, limit: number): Promise<SettlementRecord[]>;

  createRefund(r: New<RefundRecord>): Promise<RefundRecord>;
  updateRefund(id: string, patch: Partial<RefundRecord>): Promise<RefundRecord>;
  findRefund(idempotencyKey: string): Promise<RefundRecord | null>;
  listRefundsForJob(jobId: string): Promise<RefundRecord[]>;

  createDispute(d: New<DisputeRecord>): Promise<DisputeRecord>;
  getDispute(id: string): Promise<DisputeRecord | null>;
  updateDispute(id: string, patch: Partial<DisputeRecord>): Promise<DisputeRecord>;
  listDisputesForJob(jobId: string): Promise<DisputeRecord[]>;
  findOpenDispute(jobId: string): Promise<DisputeRecord | null>;
  listDisputesByStatus(statuses: DisputeStatus[], limit: number): Promise<DisputeRecord[]>;
  addEvidence(e: New<DisputeEvidenceRecord>): Promise<DisputeEvidenceRecord>;
  listEvidence(disputeId: string): Promise<DisputeEvidenceRecord[]>;

  addStrike(s: New<StrikeRecord>): Promise<StrikeRecord>;
  listStrikes(userId: string): Promise<StrikeRecord[]>;

  createReview(r: New<ReviewRecord>): Promise<ReviewRecord>;
  listReviewsFor(revieweeId: string, limit: number): Promise<ReviewRecord[]>;
  findReview(jobId: string, reviewerId: string): Promise<ReviewRecord | null>;

  createPayoutAccount(a: New<PayoutAccountRecord>): Promise<PayoutAccountRecord>;
  getPayoutAccount(userId: string): Promise<PayoutAccountRecord | null>;
  updatePayoutAccount(id: string, patch: Partial<PayoutAccountRecord>): Promise<PayoutAccountRecord>;

  createTicket(t: New<SupportTicketRecord>): Promise<SupportTicketRecord>;
  listTickets(filter: { status?: string; openedBy?: string; limit: number }): Promise<SupportTicketRecord[]>;
  updateTicket(id: string, patch: Partial<SupportTicketRecord>): Promise<SupportTicketRecord>;
}

export interface AdminRepo {
  getMfa(userId: string): Promise<AdminMfaRecord | null>;
  upsertMfa(m: AdminMfaRecord): Promise<AdminMfaRecord>;
  updateMfa(userId: string, patch: Partial<AdminMfaRecord>): Promise<AdminMfaRecord>;

  logKycAccess(entry: New<KycAccessLogRecord>): Promise<KycAccessLogRecord>;
  listKycAccess(kycRecordId: string, limit: number): Promise<KycAccessLogRecord[]>;
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
  negotiation: NegotiationRepo;
  execution: ExecutionRepo;
  materials: MaterialsRepo;
  finance: FinanceRepo;
  admin: AdminRepo;
  payments: PaymentsRepo;
  audit: AuditRepo;
  notifications: NotificationsRepo;
  reach: ReachRepo;
  retention: RetentionRepo;
  idempotency: IdempotencyRepo;
  /** Run fn atomically. Memory store runs it serially; Postgres uses a transaction. */
  transaction<T>(fn: (store: DataStore) => Promise<T>): Promise<T>;
  health(): Promise<{ ok: boolean; detail?: string }>;
  close(): Promise<void>;
}
