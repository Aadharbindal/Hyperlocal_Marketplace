-- 0015_price_guidance.sql
-- Telling somebody roughly what this costs before they commit to anything.
--
-- Forward-only. Nothing in 0001-0014 is rewritten.

-- ---------------------------------------------------------------------------
-- What a job of this kind usually costs
-- ---------------------------------------------------------------------------

-- A customer describes a leaking tap, submits, and waits - with no idea whether the answer will
-- be three hundred rupees or three thousand. That is a lot to ask of somebody who has not used
-- the service before, and it is the point at which most of them stop.
--
-- The range lives on the **skill** rather than the category, because "plumbing" spans a washer
-- change and a geyser replacement and one number for both is worse than no number. Labour only:
-- materials are bought from a vendor at that vendor's price and are quoted separately, so
-- folding them in here would make the estimate wrong in the direction that annoys people most.
--
-- These seeded figures are a starting point for the Delhi pilot, not a source of truth. Once
-- there are enough finished jobs in a skill the API answers from what customers **actually
-- paid** and stops using these. That is the whole design: the guess is scaffolding, and it has
-- an explicit expiry built into how it is read.
alter table service_skills add column if not exists typical_min_paise integer;
alter table service_skills add column if not exists typical_max_paise integer;

alter table service_skills
  add constraint service_skills_price_range_sane
  check (
    (typical_min_paise is null and typical_max_paise is null)
    or (typical_min_paise > 0 and typical_max_paise >= typical_min_paise)
  );

update service_skills set typical_min_paise = v.lo, typical_max_paise = v.hi from (values
  -- Plumbing
  ('tap-leak',          25000,   60000),
  ('drain-block',       35000,   90000),
  ('water-heater',      60000,  250000),
  ('bathroom-fitting',  50000,  200000),
  -- Electrical
  ('switch-socket',     20000,   50000),
  ('fan-light',         30000,   80000),
  ('wiring',            80000,  350000),
  ('inverter',          60000,  200000),
  -- Carpentry
  ('furniture-repair',  40000,  150000),
  ('door-window',       50000,  200000),
  ('modular-fitting',   90000,  400000),
  -- Appliance repair (category disabled in the pilot, seeded so enabling it needs no migration)
  ('washing-machine',   45000,  180000),
  ('refrigerator',      50000,  220000)
) as v(slug, lo, hi)
where service_skills.slug = v.slug;
