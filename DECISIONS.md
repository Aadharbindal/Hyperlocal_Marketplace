# Architecture Decision Records

Format: ID · Date · Status · Context · Decision · Consequences

---

## D-001 · 2026-09-22 · Accepted · Brand name placeholder
**Context.** Final brand name is not yet decided.
**Decision.** Use `BRAND_NAME` env var and `[FINAL BRAND NAME]` placeholder in docs/UI strings.
**Consequences.** Single point of change; no rename churn later.

## D-002 · 2026-09-22 · Accepted · npm workspaces monorepo
**Context.** Three units (mobile, api, core) must share types and domain rules.
**Decision.** npm workspaces (npm 10 is present; no extra tooling). `packages/core` is consumed
as a workspace dependency by both apps.
**Consequences.** Metro needs `watchFolders` for the monorepo root (configured in
`apps/mobile/metro.config.js`).

## D-003 · 2026-09-22 · Accepted · Node/Fastify API as server of record instead of edge-functions-only
**Context.** Spec allows "edge functions or backend service". Bid acceptance, settlement and
admin overrides need multi-table transactions, integration tests must run on Windows without
Docker, and mock-mode must be first-class.
**Decision.** `apps/api` (Fastify + TypeScript) is the only writer of business state. Supabase
provides Postgres, Storage, Realtime; Supabase Auth may replace the first-party OTP later.
**Consequences.** One more service to deploy (documented in `DEPLOYMENT.md`). RLS still applied
as defence in depth.

## D-004 · 2026-09-22 · Accepted · Repository abstraction with memory + postgres implementations
**Context.** Local demo and CI must work with no database; production needs Postgres.
**Decision.** `data/types.ts` repository interfaces; `DATA_MODE=memory|postgres`.
**Consequences.** Integration tests run against memory by default and can run against Postgres.
Business constraints are duplicated in SQL for safety.

## D-005 · 2026-09-22 · Accepted · First-party OTP challenge table behind `SmsAdapter`
**Context.** Supabase Auth phone OTP requires a live SMS provider; local demo must work offline.
**Decision.** API owns `otp_challenges` and issues its own JWT. SMS delivery is an adapter.
**Consequences.** Swapping to Supabase Auth later touches only `modules/auth/provider.ts`.

## D-006 · 2026-09-22 · Accepted · Money stored as integer paise
**Context.** Floating-point money is unsafe.
**Decision.** All amounts are `bigint`/integer paise (INR × 100) in DB and API; formatting on client.
**Consequences.** `core/pricing` does integer math with explicit rounding rules.

## D-007 · 2026-09-22 · Accepted · No "escrow" terminology
**Context.** Regulated term in India.
**Decision.** Use authorization / hold / milestone / settlement / refund / dispute hold.
**Consequences.** Copy and code use these words; legal review flagged in `PRODUCT_SPEC.md` §32.

## D-008 · 2026-09-22 · Accepted · Design tokens derived from user reference design
**Context.** User supplied a reference screenshot (mint background, deep teal primary, white
rounded cards, soft coloured icon chips, pill tab bar). Final designs come later.
**Decision.** Encode palette/spacing/radius/typography as tokens in `apps/mobile/src/theme`.
Screens consume components only.
**Consequences.** Final handoff is a token + component swap; no business logic change.

## D-009 · 2026-09-22 · Accepted · Polling first, realtime later
**Context.** Realtime adds infra coupling early.
**Decision.** Bid feed/chat poll (5-10 s) through M3; `RealtimeAdapter` in M4 with polling fallback.

## D-010 · 2026-09-22 · Accepted · Job status ≠ payment status
**Context.** Spec §9. **Decision.** `jobs.status` and `jobs.payment_status` are separate columns,
each with its own event log. Settlement requires both `COMPLETED` and `CAPTURED`.

## D-011 · 2026-09-22 · Accepted · Welcome hero uses the supplied reference render as an image asset
**Context.** The user supplied a finished 3D welcome-screen design and asked for that exact look.
Photoreal 3D cannot be produced from vector/RN primitives at that quality.
**Decision.** Extract the artwork from the supplied render into
`apps/mobile/assets/hero-technician.png` (UI text removed, background reconstructed, left edge
alpha-faded) and composite live, translatable text over it. The screen's background gradient is
sampled from the same render so the seam is invisible.
**Consequences.** Pixel-faithful hero with no runtime cost beyond one image. The asset is derived
from the user's own design - it must be replaced by the final licensed export before release
(tracked in `KNOWN_LIMITATIONS.md`). Swapping it is a one-file change; no layout code depends on
its internals. The earlier hand-drawn SVG mascot was removed.

## D-012 · 2026-09-22 · Accepted · Poppins as the brand typeface
**Context.** The reference uses a geometric sans with a very heavy headline weight; system fonts
did not match.
**Decision.** Ship Poppins (400/500/600/700/800, SIL Open Font License) via
`@expo-google-fonts/poppins`, importing only those five files. `typography.family` maps each
weight name to a font file and `ui/Text` sets `fontFamily` instead of `fontWeight`, so no
platform synthesises a fake bold.
**Consequences.** First paint waits for the font (a spinner holds it) so text never reflows.
Poppins is wider than the system face, so the type scale was re-tuned.

## D-013: No platform margin on materials in the pilot

**Context.** A job's material leg is bought from a local vendor at a price that vendor sets. We
could add a percentage on top, the way the labour leg carries a platform fee.

**Decision.** In the pilot the platform takes nothing on materials: the customer's material
authorization equals the vendor's payable (`vendor_payable_paise = total_paise` in
`material_orders`). Material money stays a separate authorization from the labour hold and is
never folded into the job's quote.

**Consequences.** The customer sees exactly the shop's price, which is the honest claim to make
and the easiest to defend when a customer compares it with the shop across the road. Revenue in
the pilot comes only from the labour platform fee. If a margin is introduced later it must appear
as its own line in the breakdown, never as a silent mark-up on the vendor's price, and the
migration will have to split `vendor_payable_paise` away from `total_paise` rather than assume
they are equal.

## D-014: Accessibility is arithmetic, so it is a check rather than a review

**Context.** "Is this readable?" had been answered by looking at it. Looking at it is how the
sign-in screen ended up with a 3.4:1 tagline and the hero ended up with 13px white caption text
at 2.5:1 on the light end of the gradient: each one looked fine to someone with good eyesight on
a bright screen, which is the only test they were ever given.

**Decision.** `scripts/a11y-audit.mjs` computes the WCAG contrast of every pairing the app
actually renders, reads the palette out of `tokens.ts` so it cannot drift from the real values,
and fails the build on a miss. It runs in `npm run check` and in CI. Two structural checks sit
beside it: a control whose only child is an icon must carry a label, and a text colour written as
a literal hex must clear AA on its own, since the palette cannot vouch for it.

Foregrounds moved to clear the line; backgrounds did not. The mint grounds, the white cards and
the pastel chip fills are what the design looks like, and they are untouched. `textMuted`,
`success`, `warning`, `danger`, `info` and the amber chip icon are each a shade darker.

Teal is split by role. `primary` is a fill - buttons, icons, borders - and needs the 3:1 WCAG
asks of non-text plus enough to carry a white label, which it now has at 4.77:1. Teal as *ink*
cannot reach 4.5:1 on a mint ground without ceasing to be the brand teal, so it does not try:
`Text` renders `tone="primary"` in `primaryDeep`.

**Consequences.** Every text pairing in the app clears AA, and a regression fails CI instead of
shipping. One thing was genuinely lost: the hero gradient's light end had to darken from `#15A883`
to `#108065`, which narrows the sweep visibly. That was the choice between a prettier gradient and
a legible one, and the caption on top of it is real information about a live booking.

What this does **not** establish is that the app is usable with a screen reader. The audit reads
source; it cannot tell whether the reading order makes sense, whether focus goes somewhere useful
after a sheet closes, or whether a label reads naturally out loud. That needs TalkBack and
VoiceOver on a real device, and is still open.

## D-015: Postgres is the coordination layer, not a second piece of infrastructure

**Context.** Three things were correct in one process and silently wrong in two: the scheduler
ran its own `setInterval` with no exclusion, SSE subscribers were only reachable from the node
holding them, and the rate limiter counted in a Map. None of the three fails loudly. The
scheduler quietly does everything twice, a customer's live screen quietly stops updating, a limit
is quietly N times looser than the number written beside it. `DEPLOYMENT.md` carried a workaround
for the first one - run the scheduler on a single node - which traded a duplicate-work bug for a
single point of failure that nothing would report.

**Decision.** Use Postgres for all three rather than adding Redis or a queue.

- Exclusion: `pg_try_advisory_lock`. Session-scoped, so a lock held by a node that dies is
  released when its connection drops - no lease to expire, no stuck row to clear by hand.
- Fan-out: LISTEN/NOTIFY, one channel with the topic inside a JSON envelope. The publishing node
  does **not** also deliver locally, because NOTIFY delivers back to the sender.
- Shared counters: a two-column table with fixed windows.
- Cluster-wide schedule state: `scheduler_runs`, read and written inside the lock.

**Consequences.** No new infrastructure to run, monitor, secure and fail over, against a database
the pilot already has. The costs are real and bounded: one permanently held connection per node
for LISTEN, which pool sizing has to account for; NOTIFY's 8 KB payload limit, which is checked
rather than assumed; and no delivery guarantee, which is acceptable only because an event carries
no data - a lost or duplicated one costs a client a redundant read, never a wrong screen.

**What was *not* done, and why.** The global 300/minute limit stays per-node. It exists so one
rude client cannot crowd out others on the node serving it; being N times more generous about
fairness is a capacity question, and a database round trip on every request is a real cost to pay
for tidiness. The limits that actually stop an attack were never the problem: `requestOtp` has
always counted rows in `otp_challenges` per phone and per IP, and attempts live on the challenge
row. That is worth recording because the obvious reading of "the rate limiter is in memory" is
that the security control was weak, and it was not.

**If the pilot outgrows this.** The advisory lock is the first thing to give - a task that must
run at a precise time on a busy cluster wants a queue with visibility timeouts, not a lock. The
shared counter is the second, at the point where its write rate is worth moving to Redis. The
fan-out is the last, because it is already doing very little.

## D-016: Storage that holds the bytes, even in development

**Context.** The storage adapter was a mock that returned a `mock://` URL nobody could PUT to.
To keep the flow working, the API marked every media row uploaded the moment it was created and
told the client not to bother transferring anything. The consequence went well beyond
development convenience: **completion photos did not exist**, and completion photos are the
evidence the dispute and warranty processes are decided on. Every test about evidence was
passing against rows that referred to nothing, and the whole suite stayed green through the fix
for exactly that reason - nothing had ever looked.

**Decision.** A real local-disk adapter is the default. Bytes are written, served, size-limited,
content-type checked and deleted. Access is a signed grant in the URL - scoped to one key, one
content type, one size ceiling and one operation, and expiring - because these URLs go to an
`<Image>` tag and a background upload, neither of which carries a bearer token. That is the same
shape as an S3 presigned URL, deliberately.

Identity documents are AES-256-GCM encrypted before they touch the disk; job photos are not,
because they are read constantly and an Aadhaar card is a different kind of thing. `uploaded_at`
is now set when the bytes arrive rather than when the row is created, which also fixed a latent
bug on the *live* path: with a remote provider nothing ever marked a row uploaded, because no
confirm step existed.

**Consequences.** The entire chain - attach, upload, view, dispute, warranty - can be exercised
before anybody has a storage credential, which is what makes the evidence tests mean something.
Production refuses to boot on it: a local disk is not shared between nodes, does not survive the
container and is in nobody's backup, and losing a completion photo means losing the evidence for
a dispute. The encryption is not envelope encryption - somebody with the environment has the
key - and `KNOWN_LIMITATIONS.md` says so rather than letting it read as more than it is.

## D-017: Tell people roughly what it costs before they commit

**Context.** A customer described a leaking tap, pressed submit, and waited - with no idea
whether the answer would be three hundred rupees or three thousand. The catalog carried no price
information at all. That is a lot to ask of somebody who has never used the service, and it is
the point at which most of them stop.

**Decision.** Every skill carries a labour range, shown on the home tiles and on the booking
screen before the description box. Two rules make it honest rather than decorative:

- **It lives on the skill, not the category.** "Plumbing" spans a washer change and a geyser
  replacement, and one number for both is worse than no number.
- **It says whether it is a measurement or a guess.** Once a skill has five finished jobs the
  range comes from the inter-quartile spread of what customers actually paid, and the copy says
  "what 27 people paid". Until then it is the seeded figure and says "usually". A guess dressed
  up as a measurement is how a price guide stops being trusted.

Labour only, stated in the copy, because materials are bought at a vendor's price and quoted
separately - an estimate that quietly excluded them would be wrong in the direction that annoys
people most.

**Consequences.** The seeded figures are scaffolding with an expiry built into how they are
read: they stop being used, per skill, as soon as there is real data. The inter-quartile range
rather than min-max means one emergency call-out at midnight cannot make a whole category's
number useless. It is never a quote, and the booking screen says so: the price comes from the
professional after they have seen the work.


## D-018: An account has a person attached to it, and it is asked for once

**Context.** `users.display_name`, `users.avatar_url` and an email column had all existed since
migration 0001, and nothing in the app had ever written to any of them. The consequence was
visible on every screen: the profile header rendered a masked phone number, the home greeting
said "Good evening," with an empty name after it, and the provider walking up to somebody's door
had a job card with no name on it. The fields were not missing. They were never asked for.

The same gap ran through the account section. `DELETE /me` had scheduled a 30-day anonymisation
since the trust work and had no button anywhere - which is a Play Store review rejection, not a
missing nicety. `POST /me/consents` existed and signup never called it, so nobody had a recorded
acceptance of any terms version.

**Decision.** One screen between the OTP and the rest of the app, for an account that has just
been created, and it is gated on `displayName` being null rather than on the `isNewUser` flag
from the OTP response. That flag lives only in one response; somebody who closed the app on that
screen would skip it forever and be a masked phone number in their own profile for good.

Only the name is required. Email is genuinely optional, because a large share of the people this
app is for do not use one, and a mandatory email is a wall in front of the door for exactly the
customers we most want through it. Terms acceptance rides along in the same submission, so the
version agreed to is recorded against the account from its first minute, and a declined
marketing opt-in is recorded as declined rather than merely absent - "never opted in" and "never
asked" are different facts and only one of them is a defence.

Email moves from `customer_profiles` to `users` (0016). It is part of who the account is, not of
one of its roles: a provider needs one for payout statements and a vendor for order
confirmations, and neither has a customer profile. Changing it always clears the verified flag,
or the flag would mean nothing.

Avatars are stored as a **key**, never a URL, and the link is minted per response with a
seven-day expiry. Storing a URL would mean storing an expiry in a column with no way to refresh
itself, and every profile photo would quietly rot. The client sends back a key, and a key outside
`avatars/<its own user id>/` is refused - without that check any signed-in account could point
its avatar at `kyc/<somebody-else>/aadhaar/...` and have the API mint it a week-long readable
link to an identity document.

**Consequences.** Signup is one screen longer, which is the cost of the app knowing who anybody
is. The gate is now two conditions rather than one, and a future third (an onboarding tour, say)
goes in the same place. The old `customer_profiles.email` column is left in place and unused
rather than dropped, because migrations are forward-only and a half-rolled-back deploy still has
to find the schema it expects; the customer profile's copy of the *name* is kept in step on every
update, because that is what the provider is shown.

## D-019: Somebody to call, for a service that happens inside a home

**Context.** Ride-hailing treats an emergency contact as a nice-to-have, and for a taxi that is
defensible: the journey is in public and over in twenty minutes. The exposure here is different
in kind. The customer has given us an address, confirmed a window in which they will be at it,
and a stranger with tools arrives - and the people most often home alone during a working day
are the ones who carry most of that risk.

**Decision.** Up to three contacts, each a name and a number the customer typed, with an optional
free-text relationship. No contacts-book import, no inference, nothing derived. The screen says
out loud that nobody on the list is contacted unless the customer asks.

The cap is a database trigger and the duplicate check a unique index (0016), not a count-then-
insert in the route, which two taps in the same second would race straight past. Numbers come
back masked like every other number this API returns, and the audit entry for adding one records
that it happened and not what it was.

**Consequences.** These are personal details belonging to people who are not users here and have
consented to nothing, so the design goal is to hold as little of them as possible and to make the
list boring to steal. Offered to customers only: the provider is the stranger in this
relationship, and showing them the same row would read as a suggestion that the customer is the
danger.

## D-020: A provider leaving is not the same event as the booking ending

**Context.** `POST /jobs/:id/cancel-as-provider` moved the booking straight to
CANCELLED_BY_PROVIDER. That is the end of it. The customer had taken time off work and arranged
their day around a window somebody else then walked away from, and the app returned them to an
empty screen and asked them to start again - describe the problem, wait out a bidding window,
compare offers, pay - for the one failure in this product that is entirely not their fault.

Meanwhile the losing offers were sitting in the table doing nothing. `negotiation.accept` marks
them INACTIVE rather than deleting them, so the people who wanted that job were always one status
change away from being asked again.

**Decision.** Before anybody has arrived, a provider's cancellation opens a re-dispatch instead
of ending the booking. Four rules make it fair rather than merely clever:

- **It is an invitation, not a reassignment.** A bid placed on Tuesday is not consent to be
  handed the job on Thursday afternoon. Everyone eligible is asked at once with a twenty-minute
  clock, and first to accept wins - sequential invitations would mean a customer whose first
  three candidates are asleep waits an hour to hear "no".
- **Nobody dearer than the authorised amount is invited.** A provider walking away must never
  turn into a request for more money from the person it was done to. Anybody cheaper is invited
  at *their own* price, so the bill can only go down.
- **The ranking is the original one, not price.** The customer chose on a blend of distance,
  rating, experience and reliability; being let down does not mean they now want whoever is
  cheapest.
- **It stops at the door.** ARRIVED and later go to support. Sending a stranger to a half-
  dismantled geyser is a second problem, not a rescue.

The money stays authorised throughout. Releasing and re-taking it would put a second charge on
the card of somebody who has already been inconvenienced.

**Consequences.** One new job status and a table of invitations, which is also the answer when
support is asked "why wasn't X offered this?" - the skip reason is recorded per candidate. The
strike on the departing provider is unchanged and still lands whether or not the rescue works,
because otherwise the penalty for letting somebody down would depend on that customer's luck.
No new penalty machinery: `strikes` and `shouldSuspend` have done this since 0007, and a second
strike table would give the ranking two answers to the same question.

Two bugs came out of building it, both found by tests rather than by reading. The departing
provider's assignment has to be closed before the replacement can be given the job, or
`createAssignment` refuses and the rescue fails at the last step - after the customer has been
told help is coming. And the give-up sweep cleared the re-dispatch deadline before the status
left REDISPATCHING, which the check constraint in 0018 rejects; that one passed in memory mode
and failed against Postgres, so the memory store now mirrors that constraint too.

## D-021: A distance, not a dot

> **Partly superseded by D-023.** The customer now sees a map while the professional is on their way.
> Every narrowing below still holds and is still enforced where it cannot be forgotten; what changed
> is the conclusion drawn from them, and D-023 says why.

**Context.** EN_ROUTE has existed since 0002 with nothing behind it. The app could say "on the
way" and could not say whether that meant five minutes or fifty, to somebody who has taken the
afternoon off to wait at home. It is the most-asked question in this product and the one it
could not answer.

The obvious implementation is the one every delivery app ships: a live dot on a map. This one
deliberately does not, because the dot is a **worker's** position held by the platform they earn
from, and a home-services visit is not a parcel in transit.

**Decision.** The customer is sent a distance and a time. Never coordinates, never a map. A
distance answers the question actually being asked; a point on a map is something you can follow,
and it means a screenshot of this screen discloses nothing about where anybody is.

Five narrowings, each enforced somewhere it cannot be forgotten:

- **Only while EN_ROUTE.** One gate (`shouldTrack`), so adding a status later cannot widen it by
  accident, and a database trigger refuses a row for a job in any other state.
- **No trail.** One row per job, upserted. At any moment the database knows where somebody is and
  has no idea where they have been. There is no list method and no index by area, because an easy
  "who was near this place" query is the thing this design exists to prevent.
- **Deleted, not retained.** A trigger on the job's status change removes the row. Leaving that to
  application code means it holds until the first path that forgets - a support override, a
  re-dispatch, an admin cancellation - and a stale row looks exactly like a current one.
- **Coarse.** Blunted to three decimals (~110 m) before storage. Enough for "2.4 km away", not
  enough for which building.
- **Never on the shareable tracking link.** That URL exists to be forwarded to a neighbour or a
  building guard; a forwarded link carrying a live position is a way to follow a worker around a
  city.

Foreground only. `requestBackgroundPermissionsAsync` is not called anywhere in this app and
nothing reports while the app is not in front: somebody who has put the app away is not
trackable. The provider's screen says what is shared, who sees it and when it stops.

**Consequences.** The estimate is a straight-line distance at an assumed 18 km/h, which is
pessimistic on purpose - an ETA that runs early makes somebody stand at an open door, one that
runs late costs nothing. It will be wrong across a river or a railway line, and improving it means
a routing provider, which is listed as a limitation rather than pretended away. A position older
than three minutes is reported as lost rather than shown as live, because phones lose signal in
lifts constantly and a stale dot presented as current is worse than none.

## D-022: Repeat work books itself, but never pays for itself

**Context.** Almost everything a home needs is repeat work - the AC before summer, the water
filter, the seasonal clean. The pattern is always the same: the customer knows it is due, forgets
until something breaks, and the professional who did it last time never hears about it.
`POST /jobs/from/:id` already existed for booking the same thing again, and somebody still had to
remember to press it.

**Decision.** A plan is a reminder that books itself. When an occurrence falls due the system
opens an ordinary job, and that job is quoted, negotiated and paid for exactly like any other.
Nothing about the existing flow is bypassed.

In particular there is **no stored payment mandate and no automatic charge**. Recurring debits
against a saved card in India sit under the RBI e-mandate rules - registration, a pre-debit
notification, per-transaction caps and a separate approval journey - none of which is built or
reviewed here. Quietly charging a card on a schedule would be the single most damaging thing this
product could do, so the customer pays per visit exactly as they do today, and the app says so on
the screen.

Four things that make it behave:

- **The booking is made as the customer, not as SYSTEM.** The state machine only lets a customer
  move a draft to SUBMITTED, and that is correct - submitting a request is somebody's own act. A
  plan does not change who is asking; it is their standing instruction being carried out.
  Widening that transition to accept SYSTEM would have weakened a real guard on every other path
  to save one line here.
- **Every due date is claimed exactly once, before the work, and pessimistically.** The sweep is
  hourly and will sometimes fail halfway. A unique row per `(plan, due date)` means a crash costs
  one missing booking, which somebody can see; without it the same visit is re-booked on every
  tick until a customer has fourteen of them. The claim is written as FAILED and corrected to
  BOOKED once a job id exists, because the first version claimed success optimistically and left
  rows saying a booking existed when none did.
- **It waits rather than stacking.** A customer who has not got round to accepting last month's
  offers does not wake up to a second identical booking.
- **Silence is recorded.** Every skip and failure is written down with a reason, because a plan
  that has quietly produced nothing for six months looks exactly like a healthy one.

The professional who did it last time is notified first when the booking opens. A nudge, not a
reservation: they bid like anybody else and the customer still chooses.

**Consequences.** Intervals are days rather than calendar rules, so "the 3rd of every month" is
approximated by moving the due date. Dates advance from the date that *was* due rather than from
today, so a booking made two days late does not permanently shift a quarterly service into a
different season - with a catch-up guard so a plan resumed after a year books once instead of
producing four backdated visits.

This work also found a timezone bug that only a real database could show: `pg` reads `date`
columns at local midnight, so a plan due on the 29th was read as due on the 28th and its booking
was rejected for being scheduled in the past. Date columns are now parsed as UTC midnight.

## D-023: The dot, reconsidered - and a map the customer points at

**Context.** D-021 decided the customer gets a distance and never a map, and that decision was
revisited rather than quietly broken. Two things pushed against it.

The first is what people asked for. Every app that sends somebody to a door shows a map, so the
absence does not read as restraint - it reads as a product that does not know where its own
professional is, and the number that *is* shown has nothing to corroborate it.

The second is that the argument turned out to be answerable. D-021's objection is that a point is
something you can follow. But the position had already been blunted to ~110 m **before storage**
since the day that feature shipped, so there is no doorway-level fix anywhere in the system to hand
out. The sharpest thing that exists is a street.

**Decision.** Three maps, built on one component, and every narrowing in D-021 kept:

1. **An address picker** - `app/address-picker.tsx`. Drag the map, drop the pin, then type the flat
   number. This is the one that mattered most and has nothing to do with tracking: every address in
   the app was typed, so the coordinates a professional navigated to were the geocoder's guess at
   what somebody had written. For "12, Lodhi Colony" that guess is fine. For a plot number in an
   unnumbered lane, or one of four identical society gates, it is a coin toss - and the cost of
   losing it is a worker ringing the wrong bell while somebody waits inside.
2. **A live map while EN_ROUTE** - the `ON_THE_WAY` and `ARRIVING_NOW` payloads now carry the stored
   (already-coarse) point. `STALE` deliberately does not, because a three-minute-old dot drawn on a
   map is indistinguishable from a live one.
3. **A destination map for the person going there** - `DestinationCard`, in the execution panel.
   This closed a hole rather than adding a nicety: the provider's "Working now" screen showed the
   controls for running a job and not one word about where it was.

What did **not** change: only while EN_ROUTE, no trail, deleted by trigger on status change,
coarse before storage, never on the forwardable tracking link, never to the provider about
themselves, foreground only. The provider's disclosure was rewritten in the same commit, because
"the customer can see how far away you are" stopped being the whole truth the moment a dot appeared;
it now says a map, and says a hundred metres.

**What the picker refuses to do** is fill in an address from a point. No reverse geocoder knows a
flat number, so the pin gives the area, the city and the PIN, and the person gives the part only
they know. When the match is not street-level the prefilled PIN is presented as a field to check
rather than a fact, and `coarse` from the server decides that rather than the client guessing.

**Consequences.** `react-native-maps` is now a dependency, and `app.json` had to become
`app.config.ts` so the Android Google Maps key arrives from the environment - a key committed to the
repository is a credential in the repository. **Without `EXPO_PUBLIC_MAPS_ANDROID_KEY` the map area
renders without tiles**, and `GET /geo/service-area` returns `mapsLive: false` so the screen says so
instead of showing a blank grey rectangle that looks like our bug. Without `MAPS_API_KEY` on the
server, reverse geocoding is the mock: it returns a deterministic PIN that agrees with the mock
forward geocoder's zone logic, and it reports `coarse: true` on every single answer. Neither is
presented as a working integration. On web and in any build without the native module the picker
skips the map stage entirely and saves a typed address, because a Confirm button over an empty box
would store the pilot centre as somebody's home.

`/geo/resolve-point` is a POST, not a GET with query parameters: coordinates in a URL end up in
access logs and proxy logs. It is authenticated and rate-limited to 60/minute, because a dragged pin
fires it on every settle and each call costs money upstream once the real key is in place.

## D-024: A validator that turns away a real customer is the expensive kind

**Context.** Every input in the app enforced a length and a shape and nothing else, so
`aaaaaaaaaa` was a job description, `9999999999` was a phone number, `HDFCO001234` was an IFSC, and
`asdasdasdasd` was a reason a customer would read. The instinct is to tighten everything.

**Decision.** One shared module, `packages/core/src/validation`, used by the zod contracts **and**
by the app's fields, so the sentence under the field is the sentence the server would have sent
back - when those two disagree the app looks broken even though both are working.

The line is not "be strict". For almost everything here a false *rejection* costs a customer who
never says why they left, and a false acceptance costs a support ticket, so these rules refuse only
what is clearly not a real answer, and the reasoning is written beside each one:

- `9876543210` is accepted. It is a validly allocated number and somebody holds it. Only
  all-identical digits are refused - a convention is not an invalid number.
- An address line needs no house number. "Green Park Extension" is an address.
- Names are not script-restricted and no surname is required.
- Reduplication is left alone. "dhire dhire" and "chhota chhota" are how people write, so the
  repeated-chunk detector needs **three** repeats, not two.
- A domain typo is suggested, never corrected. Nobody's email gets silently rewritten.

**The payout fields are the exception and lean the other way**, because a false acceptance there
sends somebody's earnings to a valid account belonging to a stranger and nothing unwinds it. These
can afford to be strict: the formats are specified by the RBI and NPCI rather than by how people
live. A UPI field that receives `name@gmail.com` says "that looks like your email" instead of
"invalid", because it is a real address the person really has.

**Consequences.** Getting this wrong in the strict direction is easy and the test suite caught it
happening: tightening these fields, the account-holder name was briefly checked as a *person's*
name, which refuses digits - silently stopping every proprietorship in the country from being paid.
"A1 Electricals" is not an edge case here, it is most of the provider base. It is a business-name
check now, with a regression test naming the mistake. Every rule in the module has a companion test
asserting that a real answer is **not** rejected, and that half of the suite is the half that
matters.
