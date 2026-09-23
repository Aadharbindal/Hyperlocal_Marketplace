-- 0006_materials.sql - Milestone 6
-- The material leg of a job: what is needed, what vendors will supply it for, the order
-- that follows, and the invoice a vendor payout is later justified by.
-- Materials are always separate from labour money (PRODUCT_SPEC section 13).
-- Forward-only. Nothing in 0001-0005 is rewritten.

create type material_request_status as enum ('OPEN','QUOTED','ORDERED','CANCELLED','EXPIRED');
create type material_quote_status as enum ('ACTIVE','SELECTED','REJECTED','EXPIRED','CANCELLED');
create type material_order_status as enum ('PENDING_PAYMENT','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CONFIRMED','ON_HOLD','CANCELLED');
create type material_issue as enum ('WRONG_ITEM','SHORT_QUANTITY','DAMAGED','REFUSED','OTHER');

-- ---------------------------------------------------------------------------
-- material_requests: raised by the provider side while they are on the job
-- ---------------------------------------------------------------------------
create table material_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  requested_by uuid not null references users(id),
  items jsonb not null,
  note text,
  needed_by timestamptz,
  quote_window_ends_at timestamptz not null,
  status material_request_status not null default 'OPEN',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint material_request_has_items check (jsonb_array_length(items) between 1 and 15)
);
-- one open ask per job: the customer is never comparing two material lists at once
create unique index material_requests_one_open_idx on material_requests(job_id)
  where status in ('OPEN','QUOTED');
create index material_requests_job_idx on material_requests(job_id, created_at desc);
create index material_requests_open_idx on material_requests(status, quote_window_ends_at);
create trigger material_requests_updated before update on material_requests for each row execute function set_updated_at();

-- The customer never raises one (they would be quoting themselves), and there has to be
-- somebody actually assigned to the job.
create or replace function material_request_actor_valid() returns trigger language plpgsql as $$
declare
  cust uuid;
begin
  select customer_id into cust from jobs where id = new.job_id;
  if new.requested_by = cust then
    raise exception 'a material request cannot be raised by the customer' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from job_assignments where job_id = new.job_id and status = 'ACTIVE') then
    raise exception 'job % has no active assignment', new.job_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger material_request_actor_valid_trg before insert on material_requests
  for each row execute function material_request_actor_valid();

-- ---------------------------------------------------------------------------
-- material_quotes: one live price per vendor per request, locked at selection
-- ---------------------------------------------------------------------------
create table material_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references material_requests(id) on delete cascade,
  vendor_id uuid not null references users(id),
  items jsonb not null,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  delivery_paise bigint not null default 0 check (delivery_paise >= 0),
  total_paise bigint not null check (total_paise > 0),
  eta_minutes int not null check (eta_minutes between 10 and 1440),
  note text,
  status material_quote_status not null default 'ACTIVE',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint material_quote_total_adds_up check (total_paise = subtotal_paise + delivery_paise)
);
create unique index material_quotes_one_live_per_vendor_idx on material_quotes(request_id, vendor_id)
  where status in ('ACTIVE','SELECTED');
create index material_quotes_request_idx on material_quotes(request_id, total_paise);
create trigger material_quotes_updated before update on material_quotes for each row execute function set_updated_at();

-- A quote may only come from a verified vendor.
create or replace function material_quote_vendor_verified() returns trigger language plpgsql as $$
declare
  v verification_status;
begin
  select verification_status into v from vendor_profiles where user_id = new.vendor_id;
  if v is distinct from 'VERIFIED' then
    raise exception 'vendor % is not verified', new.vendor_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger material_quote_vendor_verified_trg before insert on material_quotes
  for each row execute function material_quote_vendor_verified();

-- ---------------------------------------------------------------------------
-- material_orders: the selected quote, frozen
-- ---------------------------------------------------------------------------
create table material_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references material_requests(id) on delete cascade,
  quote_id uuid not null references material_quotes(id),
  job_id uuid not null references jobs(id) on delete cascade,
  vendor_id uuid not null references users(id),
  selected_by uuid not null references users(id),
  items jsonb not null,
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  delivery_paise bigint not null default 0 check (delivery_paise >= 0),
  total_paise bigint not null check (total_paise > 0),
  -- no platform margin on materials in the pilot (DECISIONS D-013)
  vendor_payable_paise bigint not null check (vendor_payable_paise > 0),
  eta_minutes int not null,
  status material_order_status not null default 'PENDING_PAYMENT',
  delivered_at timestamptz,
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  issue material_issue,
  issue_note text,
  issue_media_ids uuid[] not null default '{}',
  cancel_reason text,
  invoice_media_id uuid references job_media(id),
  invoice_number text,
  invoice_amount_paise bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint material_order_total_adds_up check (total_paise = subtotal_paise + delivery_paise),
  -- an order on hold has to say what went wrong
  constraint material_order_hold_has_issue check (status <> 'ON_HOLD' or issue is not null)
);
-- one live order per request: a material list is bought once
create unique index material_orders_one_live_idx on material_orders(request_id)
  where status not in ('CANCELLED');
create index material_orders_job_idx on material_orders(job_id, created_at desc);
create index material_orders_vendor_idx on material_orders(vendor_id, status);
create trigger material_orders_updated before update on material_orders for each row execute function set_updated_at();

-- The invoice is what a vendor payout is justified by, so it must match the order exactly.
create or replace function material_invoice_matches_order() returns trigger language plpgsql as $$
begin
  if new.invoice_media_id is not null then
    if new.status <> 'CONFIRMED' then
      raise exception 'an invoice can only be filed against a confirmed order' using errcode = 'check_violation';
    end if;
    if new.invoice_amount_paise is distinct from new.total_paise then
      raise exception 'invoice amount % does not match order total %', new.invoice_amount_paise, new.total_paise
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger material_invoice_matches_order_trg before insert or update on material_orders
  for each row execute function material_invoice_matches_order();

alter table material_requests enable row level security;
alter table material_quotes enable row level security;
alter table material_orders enable row level security;
