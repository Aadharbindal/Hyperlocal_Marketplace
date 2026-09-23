-- 0009_payout_accounts.sql
-- Where a provider or vendor actually gets paid.
--
-- This exists because of a hard fact about the payout rail: RazorpayX does not pay a person,
-- it pays a `fund_account_id` created from a contact plus their bank details. Until somebody
-- has one, a settlement has nowhere to go - so the settlement layer now refuses to pay a payee
-- with no verified account instead of failing at the gateway.
--
-- Forward-only. Nothing in 0001-0008 is rewritten.

create type payout_method as enum ('BANK_ACCOUNT', 'UPI');
create type payout_account_status as enum ('PENDING', 'VERIFIED', 'REJECTED', 'DISABLED');

create table payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  method payout_method not null,
  account_holder_name text not null,

  -- Only ever the last four digits of an account number, the way KYC does it. The full number
  -- lives with the payment provider, who needs it; we do not.
  account_last4 text,
  ifsc text,
  -- A UPI id is not as sensitive as an account number, but it is still a handle to a person,
  -- so it is masked for display and kept whole only where the gateway needs it.
  vpa text,

  -- What the payment provider calls this payee once registered.
  provider_contact_id text,
  provider_fund_account_id text,

  status payout_account_status not null default 'PENDING',
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,

  constraint payout_bank_needs_details check (
    method <> 'BANK_ACCOUNT' or (account_last4 is not null and ifsc is not null)
  ),
  constraint payout_upi_needs_vpa check (method <> 'UPI' or vpa is not null)
);

-- One account in use per person. Changing it replaces the old one rather than adding a second,
-- so there is never a question about where money went.
create unique index payout_accounts_one_active_idx on payout_accounts(user_id)
  where status in ('PENDING', 'VERIFIED');
create index payout_accounts_user_idx on payout_accounts(user_id, created_at desc);
create trigger payout_accounts_updated before update on payout_accounts for each row execute function set_updated_at();

-- Money cannot be sent somewhere we do not know about - but a debt is still a debt. What is
-- owed is always recorded; only moving it out of the door needs a verified account with a fund
-- account id on it. A settlement for a payee who has not added their details sits ON_HOLD until
-- they do, so the amount is never lost and never silently invented either.
create or replace function settlements_need_payout_account() returns trigger language plpgsql as $$
declare
  acct payout_accounts%rowtype;
begin
  if new.status not in ('INITIATED', 'PAID') then
    return new;
  end if;
  select * into acct from payout_accounts
    where user_id = new.payee_id and status = 'VERIFIED'
    order by created_at desc limit 1;
  if acct.id is null then
    raise exception 'payee % has no verified payout account', new.payee_id using errcode = 'check_violation';
  end if;
  if acct.provider_fund_account_id is null then
    raise exception 'payee % is not registered with the payout provider', new.payee_id using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger settlements_need_payout_account_trg before insert or update on settlements
  for each row execute function settlements_need_payout_account();

-- Changing where money goes is worth a record of its own, so payout accounts are also written
-- to the audit log by the service; the table itself keeps its history by never being deleted.
revoke delete on payout_accounts from public;

alter table payout_accounts enable row level security;
