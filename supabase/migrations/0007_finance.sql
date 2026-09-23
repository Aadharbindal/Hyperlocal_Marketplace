-- 0007_finance.sql - Milestone 7
-- Capture, the append-only ledger, settlements, refunds, disputes, strikes, reviews and
-- support tickets. Every rupee that moves leaves a balanced, immutable trail
-- (PRODUCT_SPEC section 14, PAYMENT_FLOW.md, DISPUTE_POLICY.md).
-- Forward-only. Nothing in 0001-0006 is rewritten.

-- An authorization that was let go without ever taking the money is its own outcome,
-- distinct from a refund of money that was actually captured.
-- (PostgreSQL 12+ allows this inside a transaction as long as the new value is not used in the
-- same transaction, which it is not: it is only written at runtime.)
alter type payment_status add value if not exists 'RELEASED';

create type ledger_entry_type as enum (
  'CUSTOMER_CHARGE','PROVIDER_PAYABLE','VENDOR_PAYABLE','PLATFORM_REVENUE','PROTECTION_RESERVE',
  'REFUND','DISPUTE_HOLD','GATEWAY_FEE','TAX','MANUAL_ADJUSTMENT'
);
create type settlement_status as enum ('PENDING','INITIATED','PAID','FAILED','ON_HOLD');
create type refund_status as enum ('PENDING','PROCESSING','COMPLETED','FAILED');
create type dispute_status as enum ('OPEN','UNDER_REVIEW','AWAITING_PARTY','RESOLVED','REJECTED','ESCALATED','REOPENED');
create type dispute_category as enum (
  'LATE_ARRIVAL','NO_SHOW','INCORRECT_PRICING','POOR_WORKMANSHIP','PROPERTY_DAMAGE',
  'INCOMPLETE_WORK','MATERIAL_MISMATCH','PAYMENT_ISSUE','ABUSIVE_BEHAVIOUR','SUSPECTED_FRAUD'
);
create type dispute_resolution as enum (
  'NO_ACTION','REWORK','PARTIAL_REFUND','FULL_REFUND','ADJUSTMENT_CREDIT','REPLACEMENT_PROVIDER'
);
create type strike_severity as enum ('MINOR','MAJOR','CRITICAL');
create type ticket_status as enum ('OPEN','IN_PROGRESS','WAITING','RESOLVED','CLOSED');

-- ---------------------------------------------------------------------------
-- ledger_entries: append-only, balanced, never edited
-- ---------------------------------------------------------------------------
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  payment_id uuid references payments(id),
  entry_type ledger_entry_type not null,
  account_user_id uuid references users(id),
  -- signed: positive = the platform received it, negative = the platform owes it
  amount_paise bigint not null,
  currency text not null default 'INR',
  -- every entry of one event shares a batch id, and a batch must sum to zero
  batch_id uuid not null,
  idempotency_key text not null,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  constraint ledger_amount_not_zero check (amount_paise <> 0)
);
create unique index ledger_entries_idempotency_idx on ledger_entries(idempotency_key);
create index ledger_entries_account_idx on ledger_entries(account_user_id, created_at desc);
create index ledger_entries_job_idx on ledger_entries(job_id, created_at);
create index ledger_entries_batch_idx on ledger_entries(batch_id);
-- History is corrected with new entries, never by editing old ones.
revoke update, delete on ledger_entries from public;

-- ---------------------------------------------------------------------------
-- settlements: what the platform owes out, and whether it left
-- ---------------------------------------------------------------------------
create table settlements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id),
  payee_id uuid not null references users(id),
  payee_role user_role not null,
  material_order_id uuid references material_orders(id),
  amount_paise bigint not null check (amount_paise > 0),
  status settlement_status not null default 'PENDING',
  attempts int not null default 0,
  failure_reason text,
  provider_transfer_id text,
  idempotency_key text not null,
  initiated_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index settlements_idempotency_idx on settlements(idempotency_key);
create index settlements_payee_idx on settlements(payee_id, status);
create index settlements_job_idx on settlements(job_id);
create trigger settlements_updated before update on settlements for each row execute function set_updated_at();

-- Nothing is paid out for work that was never completed, and nothing is paid twice.
create or replace function settlements_require_completion() returns trigger language plpgsql as $$
declare
  s job_status;
begin
  select status into s from jobs where id = new.job_id;
  if s not in ('COMPLETED','SETTLED') then
    raise exception 'job % is not complete (status %)', new.job_id, s using errcode = 'check_violation';
  end if;
  if exists (select 1 from disputes d where d.job_id = new.job_id
             and d.status in ('OPEN','UNDER_REVIEW','AWAITING_PARTY','ESCALATED','REOPENED')) then
    raise exception 'job % has an open dispute', new.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- A vendor is only paid for goods the customer confirmed, with an invoice on file.
create or replace function settlements_vendor_needs_invoice() returns trigger language plpgsql as $$
declare
  o material_orders%rowtype;
begin
  if new.payee_role = 'VENDOR' then
    if new.material_order_id is null then
      raise exception 'a vendor settlement must name the order it pays for' using errcode = 'check_violation';
    end if;
    select * into o from material_orders where id = new.material_order_id;
    if o.status <> 'CONFIRMED' then
      raise exception 'material order % is not confirmed', new.material_order_id using errcode = 'check_violation';
    end if;
    if o.invoice_media_id is null then
      raise exception 'material order % has no invoice', new.material_order_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
create table refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id),
  job_id uuid not null references jobs(id),
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null,
  status refund_status not null default 'PENDING',
  provider_refund_id text,
  idempotency_key text not null,
  requested_by uuid references users(id),
  dispute_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index refunds_idempotency_idx on refunds(idempotency_key);
create index refunds_job_idx on refunds(job_id, created_at desc);
create trigger refunds_updated before update on refunds for each row execute function set_updated_at();

-- A refund can never exceed what was actually captured on that payment.
create or replace function refunds_within_capture() returns trigger language plpgsql as $$
declare
  captured bigint;
  already bigint;
begin
  select amount_paise into captured from payments where id = new.payment_id and status in ('CAPTURED','SETTLED','PARTIALLY_REFUNDED','DISPUTE_HOLD');
  if captured is null then
    raise exception 'payment % was never captured', new.payment_id using errcode = 'check_violation';
  end if;
  select coalesce(sum(amount_paise),0) into already from refunds
    where payment_id = new.payment_id and id <> new.id and status <> 'FAILED';
  if already + new.amount_paise > captured then
    raise exception 'refund would exceed the captured amount (% of %)', already + new.amount_paise, captured
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger refunds_within_capture_trg before insert or update on refunds
  for each row execute function refunds_within_capture();

-- ---------------------------------------------------------------------------
-- disputes
-- ---------------------------------------------------------------------------
create table disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  raised_by uuid not null references users(id),
  against_user_id uuid references users(id),
  category dispute_category not null,
  description text not null,
  status dispute_status not null default 'OPEN',
  resolution dispute_resolution,
  resolution_reason text,
  refund_paise bigint,
  resolved_by uuid references users(id),
  second_approver_id uuid references users(id),
  resolved_at timestamptz,
  reopened_count int not null default 0,
  sla_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- a resolution has to say why, and a refund resolution has to say how much
  constraint dispute_resolution_has_reason check (resolution is null or length(coalesce(resolution_reason,'')) >= 20),
  constraint dispute_refund_has_amount check (resolution is distinct from 'PARTIAL_REFUND' or coalesce(refund_paise,0) > 0)
);
create unique index disputes_one_open_per_job_idx on disputes(job_id)
  where status in ('OPEN','UNDER_REVIEW','AWAITING_PARTY','ESCALATED','REOPENED');
create index disputes_status_idx on disputes(status, sla_due_at);
create index disputes_job_idx on disputes(job_id, created_at desc);
create trigger disputes_updated before update on disputes for each row execute function set_updated_at();

-- A refund above the threshold needs a second, different approver (DISPUTE_POLICY section 2).
create or replace function disputes_two_person_refund() returns trigger language plpgsql as $$
begin
  if coalesce(new.refund_paise, 0) > 500000 then
    if new.second_approver_id is null then
      raise exception 'refunds above Rs 5,000 need a second approver' using errcode = 'check_violation';
    end if;
    if new.second_approver_id = new.resolved_by then
      raise exception 'the second approver must be a different person' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger disputes_two_person_refund_trg before insert or update on disputes
  for each row execute function disputes_two_person_refund();

create table dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  uploaded_by uuid not null references users(id),
  media_id uuid references job_media(id),
  note text,
  created_at timestamptz not null default now()
);
create index dispute_evidence_dispute_idx on dispute_evidence(dispute_id, created_at);
-- Evidence is a record of what was shown at the time.
revoke update, delete on dispute_evidence from public;

-- ---------------------------------------------------------------------------
-- strikes
-- ---------------------------------------------------------------------------
create table strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  severity strike_severity not null,
  reason text not null,
  issued_by uuid references users(id),
  dispute_id uuid references disputes(id),
  job_id uuid references jobs(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index strikes_user_idx on strikes(user_id, created_at desc);
revoke update, delete on strikes from public;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
create table reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  reviewer_id uuid not null references users(id),
  reviewee_id uuid not null references users(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (job_id, reviewer_id)
);
create index reviews_reviewee_idx on reviews(reviewee_id, created_at desc);

-- Only a finished job can be reviewed, and only by someone who was on it.
create or replace function reviews_require_completion() returns trigger language plpgsql as $$
declare
  s job_status;
  cust uuid;
begin
  select status, customer_id into s, cust from jobs where id = new.job_id;
  if s not in ('COMPLETED','SETTLED') then
    raise exception 'job % is not complete', new.job_id using errcode = 'check_violation';
  end if;
  if new.reviewer_id <> cust
     and not exists (select 1 from job_assignments a where a.job_id = new.job_id and a.status = 'ACTIVE'
                     and new.reviewer_id in (a.provider_id, a.technician_id, a.contractor_id)) then
    raise exception 'user % was not on job %', new.reviewer_id, new.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_require_completion_trg before insert on reviews
  for each row execute function reviews_require_completion();

-- ---------------------------------------------------------------------------
-- support_tickets
-- ---------------------------------------------------------------------------
create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references users(id),
  job_id uuid references jobs(id),
  dispute_id uuid references disputes(id),
  category text not null,
  subject text not null,
  body text not null,
  status ticket_status not null default 'OPEN',
  assigned_to uuid references users(id),
  priority int not null default 3 check (priority between 1 and 5),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index support_tickets_status_idx on support_tickets(status, priority, created_at);
create index support_tickets_opener_idx on support_tickets(opened_by, created_at desc);
create trigger support_tickets_updated before update on support_tickets for each row execute function set_updated_at();

-- The settlement triggers are created last: they reference disputes and material_orders.
create trigger settlements_require_completion_trg before insert on settlements
  for each row execute function settlements_require_completion();
create trigger settlements_vendor_needs_invoice_trg before insert on settlements
  for each row execute function settlements_vendor_needs_invoice();

alter table ledger_entries enable row level security;
alter table settlements enable row level security;
alter table refunds enable row level security;
alter table disputes enable row level security;
alter table dispute_evidence enable row level security;
alter table strikes enable row level security;
alter table reviews enable row level security;
alter table support_tickets enable row level security;
