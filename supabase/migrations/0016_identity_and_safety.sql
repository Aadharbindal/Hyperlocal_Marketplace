-- 0016_identity_and_safety.sql
-- Giving an account a person attached to it, and giving that person somebody to call.
--
-- Forward-only. Nothing in 0001-0015 is rewritten.

-- ---------------------------------------------------------------------------
-- An email that belongs to the account, not to one of its roles
-- ---------------------------------------------------------------------------

-- `customer_profiles.email` has existed since 0001 and has never held a value, because nothing
-- ever wrote to it. It was also in the wrong place: a provider needs an email for their payout
-- statements and a vendor for their order confirmations, and neither has a customer profile.
--
-- Email is part of who the account **is** - the address we can reach you at if the phone number
-- changes hands, which in this market it does - so it moves next to the phone number. The old
-- column is left in place rather than dropped: forward-only means a deploy that is half-rolled
-- back must still find the schema it expects, and an unused nullable column costs nothing.
alter table users add column if not exists email text;
alter table users add column if not exists email_verified_at timestamptz;

alter table users
  add constraint users_email_shape
  check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$');

-- Case-insensitive, because nobody believes Aadhar@ and aadhar@ are two people, and partial, so
-- that an anonymised account (0001 nulls the address on deletion) does not hold the address
-- hostage against the person signing up again later.
create unique index if not exists users_email_unique
  on users (lower(email))
  where email is not null and deleted_at is null;

-- Whatever did end up in the old column, carried across. Expected to move zero rows today; it is
-- here so this migration is correct on a database that is not this one.
update users u
   set email = c.email
  from customer_profiles c
 where c.user_id = u.id
   and c.email is not null
   and u.email is null
   -- A duplicate would abort the whole migration on the unique index above. If two profiles ever
   -- shared an address, neither is carried and both people are asked in the app instead.
   and not exists (
     select 1 from customer_profiles d
      where lower(d.email) = lower(c.email) and d.user_id <> c.user_id
   );

-- ---------------------------------------------------------------------------
-- Somebody to tell
-- ---------------------------------------------------------------------------

-- This app sends a stranger to your home address at a time you have told us you will be there.
-- That is a materially different exposure from a taxi, where the journey is in public and ends
-- in twenty minutes, and it is mostly borne by people who are home alone during the working day.
--
-- So: a contact the customer can share a job with, and reach in one tap while that job is live.
-- Deliberately minimal - a name and a number the customer typed, not a contacts-book import,
-- because the contact has not consented to being in our database and the less of them we hold
-- the less we can leak. Nothing is sent to them unless the customer presses something.
create table emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null check (length(btrim(name)) between 2 and 60),
  phone_e164 text not null check (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  relationship text check (relationship is null or length(btrim(relationship)) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger emergency_contacts_updated before update on emergency_contacts for each row execute function set_updated_at();

-- The same number twice is a mistake, not a preference.
create unique index emergency_contacts_unique on emergency_contacts (user_id, phone_e164);
create index emergency_contacts_user on emergency_contacts (user_id);

-- A cap, enforced where it cannot be argued with. Three is enough for the people who would
-- actually come, and an unbounded list is an invitation to paste in an address book.
create or replace function emergency_contacts_cap() returns trigger language plpgsql as $$
begin
  if (select count(*) from emergency_contacts where user_id = new.user_id) >= 3 then
    raise exception 'emergency contact limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger emergency_contacts_cap_check before insert on emergency_contacts
  for each row execute function emergency_contacts_cap();
