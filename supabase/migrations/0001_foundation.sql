-- 0001_foundation
-- Milestone 1: identity, roles, sessions, OTP, profiles, addresses, categories, consents,
-- audit logs, notifications, retention events. Forward-only; never edit after applying.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums (mirrored in packages/core/src/contracts/enums.ts)
-- ---------------------------------------------------------------------------
create type user_role as enum ('CUSTOMER','PROVIDER','CONTRACTOR','TECHNICIAN','VENDOR','ADMIN','SUPPORT');
create type user_status as enum ('ACTIVE','SUSPENDED','DELETION_SCHEDULED','DELETED');
create type role_status as enum ('ACTIVE','SUSPENDED','REVOKED');
create type verification_status as enum ('UNVERIFIED','SUBMITTED','UNDER_REVIEW','VERIFIED','REJECTED','SUSPENDED');
create type otp_purpose as enum ('LOGIN','START_JOB');
create type consent_type as enum ('TERMS','PRIVACY','MARKETING','LOCATION','VOICE_RECORDING');
create type risk_level as enum ('LOW','MEDIUM','HIGH');
create type notification_channel as enum ('IN_APP','PUSH','SMS');
create type retention_action as enum ('ANONYMISE','PURGE','EXPORT');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  phone_verified_at timestamptz,
  display_name text,
  avatar_url text,
  preferred_language text not null default 'en' check (preferred_language in ('en','hi')),
  status user_status not null default 'ACTIVE',
  suspended_reason text,
  last_login_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function set_updated_at();

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  role user_role not null,
  status role_status not null default 'ACTIVE',
  granted_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);
create index user_roles_role_idx on user_roles(role, status);
create trigger user_roles_updated before update on user_roles for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- authentication
-- ---------------------------------------------------------------------------
create table otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  purpose otp_purpose not null default 'LOGIN',
  code_hash text not null,
  attempts int not null default 0,
  max_attempts int not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  request_ip text,
  created_at timestamptz not null default now()
);
create index otp_challenges_phone_idx on otp_challenges(phone_e164, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  refresh_token_hash text not null unique,
  device_label text,
  user_agent text,
  ip text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid references sessions(id),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id, revoked_at);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table customer_profiles (
  user_id uuid primary key references users(id),
  full_name text,
  email text,
  default_address_id uuid,
  marketing_opt_in boolean not null default false,
  notes_for_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customer_profiles_updated before update on customer_profiles for each row execute function set_updated_at();

create table provider_profiles (
  user_id uuid primary key references users(id),
  business_name text,
  bio text,
  experience_years int check (experience_years between 0 and 60),
  service_radius_km numeric(4,1) not null default 3 check (service_radius_km between 0.5 and 25),
  base_lat double precision,
  base_lng double precision,
  is_available boolean not null default false,
  verification_status verification_status not null default 'UNVERIFIED',
  reliability_score numeric(4,2) not null default 5.00,
  rating_avg numeric(3,2),
  rating_count int not null default 0,
  completed_jobs int not null default 0,
  strike_count int not null default 0,
  contractor_id uuid references users(id),
  suspended_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index provider_profiles_avail_idx on provider_profiles(is_available, verification_status);
create trigger provider_profiles_updated before update on provider_profiles for each row execute function set_updated_at();

create table contractor_profiles (
  user_id uuid primary key references users(id),
  business_name text,
  gst_number_encrypted text,
  verification_status verification_status not null default 'UNVERIFIED',
  base_lat double precision,
  base_lng double precision,
  service_radius_km numeric(4,1) not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger contractor_profiles_updated before update on contractor_profiles for each row execute function set_updated_at();

create table technician_profiles (
  user_id uuid primary key references users(id),
  contractor_id uuid not null references users(id),
  full_name text,
  verification_status verification_status not null default 'UNVERIFIED',
  skills text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index technician_profiles_contractor_idx on technician_profiles(contractor_id);
create trigger technician_profiles_updated before update on technician_profiles for each row execute function set_updated_at();

create table vendor_profiles (
  user_id uuid primary key references users(id),
  shop_name text,
  shop_address_id uuid,
  delivery_radius_km numeric(4,1) not null default 3,
  material_categories text[] not null default '{}',
  operating_hours jsonb not null default '{}'::jsonb,
  delivery_available boolean not null default false,
  verification_status verification_status not null default 'UNVERIFIED',
  bank_details_encrypted text,
  bank_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger vendor_profiles_updated before update on vendor_profiles for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------
create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  label text not null default 'Home',
  line1 text not null,
  line2 text,
  landmark text,
  society_name text,
  gate_instructions text,
  city text not null,
  pincode text not null check (pincode ~ '^[0-9]{6}$'),
  lat double precision not null,
  lng double precision not null,
  geohash text not null,
  is_default boolean not null default false,
  in_pilot_zone boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on addresses(user_id) where deleted_at is null;
create index addresses_geohash_idx on addresses(geohash);
create unique index addresses_one_default_idx on addresses(user_id) where is_default and deleted_at is null;
create trigger addresses_updated before update on addresses for each row execute function set_updated_at();

alter table customer_profiles add constraint customer_profiles_default_address_fk
  foreign key (default_address_id) references addresses(id);
alter table vendor_profiles add constraint vendor_profiles_shop_address_fk
  foreign key (shop_address_id) references addresses(id);

-- ---------------------------------------------------------------------------
-- categories and skills
-- ---------------------------------------------------------------------------
create table service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_hi text not null,
  icon_key text not null,
  is_enabled boolean not null default false,
  requires_inspection_default boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger service_categories_updated before update on service_categories for each row execute function set_updated_at();

create table service_skills (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references service_categories(id),
  slug text not null unique,
  name_en text not null,
  name_hi text not null,
  risk_level risk_level not null default 'LOW',
  created_at timestamptz not null default now()
);
create index service_skills_category_idx on service_skills(category_id);

create table provider_skills (
  provider_id uuid not null references users(id),
  skill_id uuid not null references service_skills(id),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (provider_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- consents, audit, notifications, retention
-- ---------------------------------------------------------------------------
create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  consent_type consent_type not null,
  version text not null,
  granted boolean not null,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index consents_user_idx on consents(user_id, consent_type, created_at desc);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  actor_role user_role,
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  before jsonb,
  after jsonb,
  ip text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on audit_logs(actor_user_id, created_at desc);

-- Immutable: application roles may only insert/select.
revoke update, delete on audit_logs from public;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  channel notification_channel not null default 'IN_APP',
  read_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, read_at, created_at desc);

create table retention_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action retention_action not null,
  scheduled_for timestamptz not null,
  executed_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index retention_events_due_idx on retention_events(scheduled_for) where executed_at is null;

-- ---------------------------------------------------------------------------
-- Row level security: the API connects with the service role; direct client access is denied
-- by default. Policies for authenticated Supabase clients are added when realtime is enabled.
-- ---------------------------------------------------------------------------
alter table users enable row level security;
alter table user_roles enable row level security;
alter table otp_challenges enable row level security;
alter table sessions enable row level security;
alter table customer_profiles enable row level security;
alter table provider_profiles enable row level security;
alter table contractor_profiles enable row level security;
alter table technician_profiles enable row level security;
alter table vendor_profiles enable row level security;
alter table addresses enable row level security;
alter table service_categories enable row level security;
alter table service_skills enable row level security;
alter table provider_skills enable row level security;
alter table consents enable row level security;
alter table audit_logs enable row level security;
alter table notifications enable row level security;
alter table retention_events enable row level security;

-- Public read of enabled categories/skills (safe, non-personal).
create policy categories_public_read on service_categories for select using (is_enabled);
create policy skills_public_read on service_skills for select
  using (exists (select 1 from service_categories c where c.id = category_id and c.is_enabled));

-- ---------------------------------------------------------------------------
-- Seed: MVP categories (PRODUCT_SPEC section 3). Appliance repair disabled by default.
-- ---------------------------------------------------------------------------
insert into service_categories (id, slug, name_en, name_hi, icon_key, is_enabled, requires_inspection_default, sort_order) values
  ('11111111-1111-4111-8111-111111111101', 'plumbing', 'Plumbing', 'प्लंबिंग', 'plumbing', true, false, 10),
  ('11111111-1111-4111-8111-111111111102', 'electrical', 'Electrical', 'इलेक्ट्रिकल', 'electrical', true, false, 20),
  ('11111111-1111-4111-8111-111111111103', 'carpentry', 'Carpentry', 'बढ़ईगीरी', 'carpentry', true, false, 30),
  ('11111111-1111-4111-8111-111111111104', 'appliance-repair', 'Appliance Repair', 'उपकरण मरम्मत', 'appliance', false, true, 40);

insert into service_skills (id, category_id, slug, name_en, name_hi, risk_level) values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'tap-leak', 'Tap and leak repair', 'नल और लीक की मरम्मत', 'LOW'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'drain-block', 'Blocked drain', 'नाली जाम', 'LOW'),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111101', 'water-heater', 'Water heater / geyser', 'गीज़र', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111101', 'bathroom-fitting', 'Bathroom fittings', 'बाथरूम फ़िटिंग', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222211', '11111111-1111-4111-8111-111111111102', 'switch-socket', 'Switch and socket', 'स्विच और सॉकेट', 'LOW'),
  ('22222222-2222-4222-8222-222222222212', '11111111-1111-4111-8111-111111111102', 'fan-light', 'Fan and light installation', 'पंखा और लाइट', 'LOW'),
  ('22222222-2222-4222-8222-222222222213', '11111111-1111-4111-8111-111111111102', 'wiring', 'Wiring and MCB', 'वायरिंग और MCB', 'HIGH'),
  ('22222222-2222-4222-8222-222222222214', '11111111-1111-4111-8111-111111111102', 'inverter', 'Inverter and UPS', 'इन्वर्टर', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111103', 'furniture-repair', 'Furniture repair', 'फ़र्नीचर मरम्मत', 'LOW'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111103', 'door-window', 'Door and window', 'दरवाज़ा और खिड़की', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222223', '11111111-1111-4111-8111-111111111103', 'modular-fitting', 'Modular fitting', 'मॉड्यूलर फ़िटिंग', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222231', '11111111-1111-4111-8111-111111111104', 'washing-machine', 'Washing machine', 'वॉशिंग मशीन', 'MEDIUM'),
  ('22222222-2222-4222-8222-222222222232', '11111111-1111-4111-8111-111111111104', 'refrigerator', 'Refrigerator', 'फ़्रिज', 'MEDIUM');

-- ---------------------------------------------------------------------------
-- Idempotency keys for mutating routes (API_REFERENCE.md conventions). Purged after 24 h.
-- ---------------------------------------------------------------------------
create table idempotency_keys (
  key text not null,
  user_id uuid not null references users(id),
  route text not null,
  status int not null,
  body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index idempotency_keys_created_idx on idempotency_keys(created_at);
alter table idempotency_keys enable row level security;
