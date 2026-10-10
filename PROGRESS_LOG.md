# Progress Log

Newest first. Every milestone ends with this report (PRODUCT_SPEC section 30).

---

## Three fields the console was sure it had

**Milestone:** post-M9 - admin console
**Date:** 2026-10-10
**Status:** Complete

**Why this exists:** the console's overview was eight identical rows in two unlabelled cards -
"Live jobs 0" set exactly like "Payouts sent ₹0", with no way to tell which card was work and
which was money without reading five lines of it. The comment at the top of the file calls this
"a place people come to answer a specific question during an incident", and an incident is
precisely when a wall of same-sized grey rows is useless.

Rebuilding it turned up what the flat layout had been hiding: the client's view of three admin
responses was hand-written, never checked against the server, and wrong in three different ways.

**What was found by opening it:**

- **`[object object]` under every person's phone number.** `AdminUser.roles` is
  `{ role, status }[]` and was typed `string[]`, so the row the console joins rendered the
  placeholder. Somebody deciding whether to suspend an account could not see what that account is.
  The per-role status is on screen too now - a revoked provider role and an active one are very
  different accounts to be looking at.
- **" live connections", with nothing in front of it.** `/admin/scheduler` returns
  `{ streams, users }`; the client declared `{ connections }`, a field the server has never sent.
- **Three fields invisible since the report was written.** `OpsOverview` was a hand-written copy
  of `OpsReportView` carrying eleven of its fourteen fields, so `providersVerified`,
  `providersSuspended` and `jobsByStatus` were computed by both data stores and sent on every
  request to a screen that could not see them. It is the contract type now.
- **"Nothing in that state." for a failed request.** The payouts list never checked `isError`, so
  somebody chasing a stuck payout would be told there is no stuck payout - the same false negative
  the vendor's shop card had.

**What was built:** the three numbers somebody scans for are tiles rather than rows; both groups
have headings; "Payouts waiting" is emphasised because money waiting is a person waiting to be
paid; "Professionals" is a new group for the two counts nothing could show before; and "As of" is
attached to a refresh rather than floating, because during an incident the question behind it is
always "is this stale".

**Changed files:** `apps/mobile/app/(admin)/console.tsx`,
`apps/mobile/src/api/admin-console.ts`.
**Database changes:** none.
**API changes:** none - every field was already being sent.
**Tests added / passed:** none new; these are wrong-shape defects that only reading the running
page finds, and two of the three were in types no test asserts. Mobile 59/59, core 279/279, API
392/392, lint clean, a11y 0, wiring 0 and 0.
**Manual verification completed:** signed in as the seeded admin and read every one of the six
sections in the running app. People now reads "+919000000001 · Customer", Background reads
"1 Open streams / 1 person", Payouts reads "On hold / Failed / Waiting / Paid", and the overview
shows "Verified 2" - a real number that no screen could display an hour ago. Measured the tile row
in the page rather than trusting the screenshot: 20 to 355 inside 375, no horizontal scroll.
**Known limitations:** `jobsByStatus` is now in the type and still on no screen; it wants a
breakdown view rather than a row.
**Security considerations:** none - the phone number was already shown in full to an admin by
design, and the audit note about it is unchanged.
**Next milestone:** the remaining admin screens - disputes, verify, money, moderation.

---

## Twelve controls that never said which one was on

**Milestone:** post-M9 - control state on the web
**Date:** 2026-10-10
**Status:** Complete

**Why this exists:** fixing `SegmentedControl` earlier, the cause turned out to be general and I
only fixed the one instance. React Native Web does not translate `accessibilityState` into ARIA
on a `Pressable`, so a control carrying only the state object renders into the DOM with no state
at all. Reading the page confirmed the worst case: **the app's own tab bar - every screen, every
role - was a `tablist` with three `tab`s and `aria-selected` null on all of them.**

Twelve controls in all, and three of them were also using the wrong word. `selected` is not a
state a radio or a checkbox has, and `aria-selected` is invalid on `role="button"`, so the
category tiles on the booking screen, the time slots beside them, the repeat-interval chips and
the star rating were all emitting something that renders as nothing even where it is emitted. A
single-choice picker is a radio group; saying so is what tells somebody that picking one unpicks
another.

**What was built:**

- `aria-*` beside `accessibilityState` on the main tab bar, the customer's bookings tabs, the
  console's six sections, the moderation outcome radios, the consent checkboxes and the help
  accordion.
- The booking screen's categories and slots, the repeat-interval chips and the payout method
  picker now carry the role they actually are, inside a labelled group. The star rating is a
  radio group with `checked` on exactly the chosen star - the *fill* is cumulative, four stars
  means four are solid, but announcing four checked radios would read a rating of four as four
  separate choices.
- Every submitting button in the app was silent about being busy. `aria-busy` now says so.
- `scripts/a11y-audit.mjs` grew a fourth check for this whole class: state in
  `accessibilityState` with no ARIA twin, and state whose name does not belong to the role it is
  on. Confirmed non-vacuous by reverting the tab bar alone and watching it fail.

**Changed files:** `scripts/a11y-audit.mjs`, `apps/mobile/src/ui/TabBar.tsx`,
`apps/mobile/src/ui/Button.tsx`, `apps/mobile/app/(admin)/console.tsx`,
`apps/mobile/app/(admin)/moderation.tsx`, `apps/mobile/app/(auth)/profile-setup.tsx`,
`apps/mobile/app/(customer)/book.tsx`, `apps/mobile/app/(customer)/bookings.tsx`,
`apps/mobile/app/help.tsx`, `apps/mobile/app/payout-account.tsx`,
`apps/mobile/src/features/customer/RepeatThisCard.tsx`,
`apps/mobile/src/features/provider/RateCustomerCard.tsx`.
**Database changes:** none.
**API changes:** none.
**Tests added / passed:** none new - this is a defect component tests are structurally blind to,
which is the point. The RNTL query reads `accessibilityState` directly and never sees the DOM, so
the segmented control's test passed throughout while the rendered page carried nothing. The audit
is the regression guard instead. Mobile 59/59, core 279/279, API 392/392, lint clean, a11y 0,
wiring 0 and 0.
**Manual verification completed:** read the rendered page before and after. Before: a `tablist`
with three `tab`s, `aria-selected` null on each. After: `false, false, true` with the current tab
true, and the booking screen reporting two labelled radio groups each with exactly one checked.
**Known limitations:** none for this class - the audit now fails the build on a reoccurrence.
**Security considerations:** none.
**Next milestone:** the admin console's own visual pass.

---

## The database's words, on four people's screens

**Milestone:** post-M9 - status vocabulary
**Date:** 2026-10-10
**Status:** Complete

**Why this exists:** going through the role screens one at a time, the same defect kept turning
up in a different costume. A shopkeeper waiting to be allowed to quote read **"Verification is
under_review."** A customer who had reported a problem with their job read a badge saying
**"awaiting party"** - a phrase from our admin queue describing a move a staff member had made. A
technician standing on a doorstep read **"price revision pending"**. In each case a Postgres enum
had been lowercased and printed.

Three screens had their own `Record<string, ...>` map with their own vocabulary - "In review" on
one, "in review" on another, "needs documents" against "Not started" for the same state - and two
screens had no map at all. The `string` key is what let it happen: the `/me` contract declared
`verificationStatus` as a bare string in all three profiles, the only place in the contracts that
does not use the enum, so every consumer got `string` back and wrote its own fallback for a value
the database cannot produce.

**What was built:**

- `apps/mobile/src/i18n/status.ts` - one `VERIFICATION` map and one `DISPUTE_STATUS` map, typed
  `Record<VerificationStatus, ...>` and `Record<DisputeStatus, ...>`, so a seventh status stops
  compiling instead of falling through to `undefined` on a screen.
- The `/me` contract now declares `verificationStatus` as the enum, which is what made the three
  loose maps into compile errors rather than a thing to notice.
- `AWAITING_PARTY` is "Waiting for a reply". The column does not record *which* party was asked,
  so the label does not claim it is them; if we had asked them, they would have a notification.
- The technician's and contractor's job badges use `JOB_STATUS_LABEL_KEY`, which already existed
  and which the provider's own screen was already using - so all four roles now read the same
  words for the same job.
- The vendor's shop card said **"You are receiving material requests"** while the requests screen
  said they were blocked. `deliveryAvailable` can be true while verification is pending, and the
  feed blocks an unverified vendor regardless; verification is now part of that sentence.
- A failed read of the vendor profile rendered as "Shop not set up yet" - the same mistake the
  payout card three lines below it carries a comment warning against. Only a 404 says that now;
  anything else says we could not load it.

**Changed files:** `apps/mobile/src/i18n/status.ts` and `status.test.ts` (new),
`packages/core/src/contracts/auth.ts`, `apps/mobile/app/(vendor)/shop.tsx`,
`apps/mobile/app/(technician)/jobs.tsx`, `apps/mobile/app/(contractor)/jobs.tsx`,
`apps/mobile/app/(contractor)/team.tsx`, `apps/mobile/app/(admin)/queue.tsx`,
`apps/mobile/app/(provider)/profile.tsx`, `apps/mobile/src/features/ProfileScreen.tsx`,
`apps/mobile/src/features/customer/AfterJobCard.tsx`.
**Database changes:** none.
**API changes:** `/me` tightens three fields from `string` to the existing enum. No value changes.
**Tests added / passed:** 4 new, asserting every enum member has words and that no label contains
an underscore or a shouting key - the type catches a missing entry, it cannot catch somebody
satisfying it with `'under_review'`. Mobile 59/59, core 279/279, API 392/392, lint clean, a11y 0,
wiring 0 and 0.
**Manual verification completed:** signed in as the seeded vendor against the running API and read
the card with the shop verified; moved the seed to `UNDER_REVIEW`, restarted, signed in again and
read "In review" and "We are checking your documents. This usually takes a day. You can quote once
it is approved." where "Verification is under_review." used to be, and the delivery line correctly
reading "Nothing will arrive until your shop is verified." Seed restored.
**Known limitations:** admin-only screens still lowercase a few internal enums - settlement and
moderation reasons - which staff read and which have no customer-facing equivalent yet.
**Security considerations:** none - copy and types only.
**Next milestone:** the admin console's own visual pass.

---

## Four tasks shown as four tasks

**Milestone:** post-M9 - provider first-run
**Date:** 2026-10-10
**Status:** Complete

**Why this exists:** a brand-new professional has four things to finish before any work can reach
them, and the screen showed two of them, in two different shapes, with nothing saying how much was
left. A verification card said "Get verified to start. Submit one ID document." and, directly
below, an empty state said "Pick your services." Both are real, neither mentions the other two,
and together they read as the whole of it.

The information was never missing. `blockers` is literally the list of what the server is waiting
for, and the feed has always received it in full - the screen was choosing one item out of it and
throwing the rest away.

**What was built:**

- `SetupChecklist` - the whole list, with a count, a progress bar, and ticks that stay on screen
  once a step is done. Three ticks and one empty circle is both a different feeling from one
  instruction and the honest picture: they really have done three things. Only the next step
  explains itself, because four explanations is a wall of text on the screen somebody is trying to
  get past, and only the next step has a button, because there is a correct order here.
- The order is load-bearing rather than cosmetic. The server refuses `isAvailable: true` until
  verification is through (`verification_pending`), so verification sorting first is what stops
  "Go online" from ever being offered as a step while it is impossible. Skills and base location
  have no such guard; those really can be done first, they are just a worse order.
- "Go online" has no button at all. The switch is already in this screen's header, and a second
  control for it would be a second source of truth.
- The availability switch was correctly disabled while unverified and said nothing about why - a
  dead control. It now carries the reason.
- Being suspended arrives in the same `blockers` array and is not a setup step. Ticking three
  boxes and offering a progress bar to somebody whose account is on hold would have been cheerful
  and about the wrong subject; it gets its own message and a route to support, and the checklist
  stands down while it shows.
- The empty feed below no longer repeats a task. It answers the only question the blank space
  asks: what this list is, and why it is empty.

**Changed files:** `apps/mobile/src/features/provider/SetupChecklist.tsx` (new),
`apps/mobile/src/features/provider/SetupChecklist.test.tsx` (new),
`apps/mobile/app/(provider)/jobs.tsx`.
**Database changes:** none.
**API changes:** none - this is the existing `blockers` array, shown.
**Tests added / passed:** 6 new (the whole list is visible; finished steps stay; one explanation;
one action; no action for the step the header owns; what a screen reader is told). Mobile 55/55,
core 279/279, API 392/392, lint clean, a11y 0, wiring 0 and 0.
**Manual verification completed:** signed in as a new provider against the running API, read "0 of
4 done" with every step listed; set a skill through the real endpoint and watched the card move to
"1 of 4 done" with "Services chosen" ticked and struck through, and the next step and its button
change with it. Confirmed the availability switch is server-refused while unverified
(`403 verification_pending`) and that the control is disabled to match.
**Known limitations:** the rejected-verification card still needs its own words rather than a tick,
and keeps them.
**Security considerations:** none - no new endpoint, no new data on screen.
**External integrations mocked or live:** unchanged.
**Next milestone:** the remaining role screens - vendor, technician, admin.

---

## A map to point at, and inputs that have to be real

**Milestone:** post-M9 - maps and input validation
**Date:** 2026-10-01
**Status:** Complete, except the one part that needs a credential

**Why this exists:** two asks in one. Use a real map wherever a map belongs, the way the apps
people already use do it; and make every field that matters actually check what is typed into it,
not just count characters.

The second half turned out to be the larger problem. Every input in the app enforced a length and
a shape and nothing else, which meant `aaaaaaaaaa` was a job description a professional would drive
across a city for, `9999999999` was a phone number an account could be created on, `HDFCO001234`
was an IFSC that a payout would be sent to and rejected days later, and `asdasdasdasd` was the
reason a customer read for why their booking had been cancelled.

The first half meant revisiting a decision rather than quietly breaking it. D-021 had settled that
the customer sees a distance and never a map, on the argument that a dot is something you can
follow. The argument turned out to be answerable: the position had been blunted to ~110 m **before
storage** since that feature shipped, so no doorway-level fix exists in the system to hand out. The
sharpest thing a map can draw is a street. D-023 records the reconsideration and keeps every one of
D-021's narrowings.

**What was built:**

*An address picker.* `app/address-picker.tsx`, in two stages the way the big delivery apps settled
on: drag the map until the pin is on your gate and find out *before typing anything* whether we work
in that locality, then type the flat number. This is the piece that mattered most and has nothing to
do with tracking. Every address in this app was typed, so the coordinates a professional navigated to
were the geocoder's guess at what somebody had written - fine for "12, Lodhi Colony", a coin toss for
a plot in an unnumbered lane or one of four identical society gates, and the cost of losing that toss
is a worker ringing the wrong bell while somebody waits inside with a leaking tap. A saved pin now
carries the customer's own coordinates and the server does not geocode over them.

It deliberately does not fill in the address from the point. No reverse geocoder knows a flat number,
so the pin gives the area, the city and the PIN, and the person gives the part only they know. When
the match is not street-level the prefilled PIN is shown as a field to check rather than a fact, and
the server's `coarse` flag decides that rather than the client guessing.

*A live map while EN_ROUTE.* `ON_THE_WAY` and `ARRIVING_NOW` now carry the stored point and the
arrival card draws it, with the dot gliding between the fifteen-second updates instead of
teleporting. `STALE` carries no point at all, which is the whole reason that state exists - a
three-minute-old dot on a map is indistinguishable from a live one. The provider's disclosure was
rewritten in the same commit, because "the customer can see how far away you are" stopped being the
whole truth the moment a dot appeared; it now says a map, and says a hundred metres.

*A destination map for the person going there.* `DestinationCard` in the execution panel, with the
gate instructions in their own box and a Directions button that hands navigation to whichever maps
app they already use. This closed a hole rather than adding a nicety: the provider's "Working now"
screen had every control for running a job and not one word about where the job was, so somebody who
had won the work had to go back out to the feed to find the street.

*One validation module, shared.* `packages/core/src/validation`, used by the zod contracts **and** by
the app's fields, so the sentence under a field is the sentence the server would have sent back -
when those disagree the app looks broken even though both are working. Fourteen checks now: phone,
email, PIN, person name, business name, address line, city, free text, IFSC, bank account number,
UPI id, referral code, rupee amounts, and a typed date and time.

The line is not "be strict", and D-024 explains where it sits. A false rejection costs a customer who
never says why they left; a false acceptance costs a support ticket. So `9876543210` is accepted
because somebody holds it, an address line needs no house number, names are not script-restricted,
and the repeated-chunk detector needs three repeats rather than two because "dhire dhire" and
"chhota chhota" are how people write.

*Except the payout fields*, which lean the other way, because a false acceptance there sends
somebody's earnings to a valid account belonging to a stranger and nothing unwinds it. The IFSC check
insists on the zero the RBI reserves in position five - the transposition a bare `length(11)` waved
through. A UPI field given `name@gmail.com` says "that looks like your email address" rather than
"invalid", because it is a real address the person really has.

*Where it is wired.* The sign-in phone screen, profile setup, edit profile, emergency contacts, the
address picker, the booking description, the payout account, the contractor's crew, the provider's
business name, bid amounts and notes, material item names, vendor quote prices and delivery times,
warranty claim answers, the referral code, the reschedule date and reason, the provider's
cancellation reason, customer reviews, provider notes about customers, disputes, and the admin
moderation, KYC rejection, dispute decision and promo screens.

**Changed files:** `packages/core/src/contracts/geo.ts` (new), `packages/core/src/validation/*`,
`packages/core/src/execution/arrival.ts`, `packages/core/src/contracts/{execution,jobs,finance,provider,addresses,auth,safety}.ts`,
`apps/api/src/modules/geo/routes.ts` (new), `apps/api/src/adapters/{types,mocks}.ts`,
`apps/api/src/adapters/live/google-maps.ts`, `apps/api/src/modules/{execution,jobs}/service.ts`,
`apps/api/src/app.ts`, `apps/mobile/app.config.ts` (new, replaces `app.json`),
`apps/mobile/src/features/geo/{MapCanvas,DestinationCard}.tsx` (new),
`apps/mobile/src/api/geo.ts` (new), `apps/mobile/app/address-picker.tsx` (new),
`apps/mobile/app/addresses.tsx` (the form moved to the picker), and the form screens listed above.

**Database changes:** none. The coordinates the picker saves go into columns `addresses` has had
since 0001; `jobs.address_snapshot` is JSON and gained two keys, read with `nullish()` so bookings
snapshotted before this still open.

**API changes:** `GET /geo/service-area` (public - it is what lets the app say "not your city yet"
before asking anybody to sign in) and `POST /geo/resolve-point` (authenticated, 60/min). POST rather
than GET with query parameters because coordinates in a URL end up in access logs, proxy logs and
referrers. `ArrivalView` gained a point on two of its four variants; `ExecutionView` gained
`destination`, null for the customer who is standing in it.

**Tests added:**
- Core (24 new, 276 total): the payout formats including the IFSC reserved zero and the email-in-the-UPI-box message; `checkMobileField` across the ways people write their own number; the repeated-chunk detector **and** the companion test that reduplication still passes; the typed date and time, one failure at a time, including 31 February which `new Date` silently rolls forward to 3 March, and the ordinal in that message; the referral code naming the misread character; rupee ceilings. Plus four in `arrival.test.ts`: the point comes back live, comes back at the door, and is withheld once stale.
- API (7 new, 377 total): the two geo endpoints, including that `mapsLive` reads false in the suite and that the mock's PIN is one the address contract would actually accept; that an address saved from a confirmed pin stays at exactly that pin; that the live point is withheld from the forwardable tracking link and from the professional being located; that the execution panel's destination reaches the provider with the gate instructions and is null for the customer; that an account held in a firm name is still payable; that the IFSC typo a length check waves through is refused.

**Tests passed:** core 276/276, API 377/377, mobile jest 29/29. Typecheck 3/3 workspaces clean,
lint clean, wiring audit reports the two new endpoints wired.

**A real regression, caught by the suite:** tightening the payout fields, the account-holder name was
briefly checked as a *person's* name - which refuses digits, and therefore silently stopped every
proprietorship in the country from being paid. "A1 Electricals" and "Services 1001" are not edge
cases on an Indian bank account, they are most of the provider base. Two settlement tests went red,
it is a business-name check now, and there is a regression test that names the mistake. This is
exactly the failure mode D-024 is written around, and it happened within an hour of writing it.

**Manual verification completed:** core and API suites in memory mode; typecheck and lint across all
three workspaces; the wiring audit. **Not verified against real map tiles** - see below.

**Known limitations:** the map area **renders without tiles** until
`EXPO_PUBLIC_MAPS_ANDROID_KEY` is set, and `GET /geo/service-area` returns `mapsLive: false` so the
screen says so rather than showing a blank grey rectangle that looks like our bug. Without
`MAPS_API_KEY` on the server, reverse geocoding is the mock: a deterministic PIN that agrees with the
mock forward geocoder's zone logic, reporting `coarse: true` on every answer. **Neither is a working
map integration and neither is presented as one.** The pin-to-PIN flow has therefore not been walked
against real imagery. On web and in any build without the native module the picker skips the map
stage and saves a typed address, because a Confirm button over an empty box would store the pilot
centre as somebody's home. The reschedule date is still typed rather than picked - it now explains
each mistake specifically, which is an improvement and not a picker.

**Security considerations:** `app.json` became `app.config.ts` so the Android Maps key arrives from
the environment - a key checked into the repository is a credential in the repository, and this one
is compiled into an APK, so it needs a different Google Cloud restriction (package name + signing
SHA-1) from the server key's IP restriction. `/geo/resolve-point` is authenticated and rate-limited
because its body is somebody's precise location and each call costs money upstream. The customer's
live map is a widening of disclosure and is recorded as such in D-023 and PRIVACY_DATA_MAP: it is the
already-coarse stored point, only while EN_ROUTE, only to the customer on that booking, never on the
forwardable tracking link, never to the provider about themselves, and nothing at all once stale.
The provider's own disclosure text was changed in the same commit rather than left describing the
older behaviour.

**External integrations mocked or live:** unchanged - all mocked. Maps are now *used* in three
places and still mocked in both halves (server geocoding and app tiles), which the app states on
screen.

**Next milestone:** owner-only credentials (SMS, payments, maps - both keys - push, Sentry,
production storage) and the legal/payments review. Still open in code: five endpoints with nothing
calling them and nine unused hooks, both listed by `npm run wiring`.

---

## The account had no person attached to it

**Milestone:** post-M9 - identity and account
**Date:** 2026-09-28
**Status:** Complete

**Why this exists:** the prompt was to look at how a mature app handles signing up and showing
you who you are, and to stop shipping something half-finished. Doing that turned up a gap that
had been in plain sight for the whole project: `users.display_name`, `users.avatar_url` and an
email column had existed since migration 0001, and **nothing had ever written to any of them.**

The effect was everywhere and easy to miss because nothing failed. The profile header rendered a
masked phone number. The home greeting said "Good evening," followed by an empty string. The
provider walking up to somebody's door had a job card with no name on it. None of that is a bug
in any unit; it is a question the app never asked.

The same shape ran through the rest of the account. `DELETE /me` had scheduled a 30-day
anonymisation since the trust work and there was no button anywhere that called it - which is a
Play Store review rejection, not a missing nicety. `POST /me/consents` existed and signup never
called it, so not one account had a recorded acceptance of any terms version.

**What was built:**

*Identity, asked once.* A screen between the OTP and the role picker, for an account that has
just been created. Gated on `displayName` being null rather than on the `isNewUser` flag from the
OTP response - that flag lives in one response, and somebody who closed the app on that screen
would have skipped it forever. Only the name is required; email is genuinely optional, because a
mandatory email is a wall in front of the door for exactly the customers this is for. Terms
acceptance is part of the same submission, and a declined marketing opt-in is recorded as
declined rather than merely absent (D-018).

*Email as part of the account, not of a role.* Moved from `customer_profiles` to `users` in
0016, with a case-insensitive partial unique index and a shape constraint the zod schema
deliberately matches character for character. Changing the address always clears the verified
flag - without that line a new address inherits the old one's tick and the flag means nothing.
Nothing sets that flag yet: there is no email adapter, so the app says "Not confirmed yet"
instead of showing a tick nobody can earn.

*A photo, stored as a key.* `POST /me/avatar` issues a signed PUT; the client uploads the bytes
directly and commits the key with `PATCH /me`. The column holds the key and the link is minted
per response with a seven-day expiry, because a stored URL carries an expiry it has no way to
refresh and every photo would quietly rot. A key outside `avatars/<the caller's own id>/` is
refused - without that check any signed-in account could point its avatar at
`kyc/<somebody-else>/aadhaar/...` and be handed a week-long readable link to an identity
document. There is a test for exactly that.

*Somebody to call.* Up to three emergency contacts, typed by the customer, capped by a trigger
and de-duplicated by a unique index rather than by a count-then-insert two taps could race past.
Numbers come back masked, and the audit row records that a contact was added, not what it was
(D-019). Sharing a live job already worked on its own - a minimal public tracking page and the
OS share sheet, both built earlier - so what is left is only the shortcut of sending that link
straight to a saved contact; `ShareJobBody` is written and unrouted.

*The rest of the account section.* Edit profile, help with five answers this codebase can
actually stand behind, and account deletion with a typed confirmation and a plain statement of
what is kept and why.

**Two things found on the way:**

The Reanimated warning this log previously called cosmetic was not. The welcome hero had an
entering fade and an `opacity: measured ? 1 : 0` guard on the same view, and a layout animation
owns opacity outright - so the guard meant to keep the artwork hidden until its box was measured
was being overwritten, and the art could appear at the wrong size for a frame. Split into an
outer view that arrives and an inner one that hides and floats.

The mobile suite was failing roughly one run in two, always on whichever test happened to come
first. Not a slow test: the first test in a worker pays for compiling the Expo and Reanimated
module graph before it can render anything, and Jest was timing that against a five-second budget
meant for the assertion. `testTimeout` raised rather than the test weakened.

Also fixed: the empty-state action button sat against the left edge under centred text on about
28 screens, because `Button` sets `alignSelf: 'flex-start'` and that beats the container's
`alignItems: 'center'`.

**Changed files:** `supabase/migrations/0016_identity_and_safety.sql`;
`packages/core/src/contracts/{auth,common,safety}.ts`, `packages/core/src/i18n/strings.ts`,
`packages/core/src/index.ts`; `apps/api/src/data/{types.ts,memory/index.ts,postgres/index.ts}`,
`apps/api/src/modules/{users/routes.ts,auth/service.ts,admin/routes.ts,storage/routes.ts}`,
`apps/api/src/lib/errors.ts`, `apps/api/src/test/identity.test.ts`;
`apps/mobile/app/{(auth)/profile-setup.tsx,(auth)/phone.tsx,edit-profile.tsx,emergency-contacts.tsx,help.tsx,delete-account.tsx,_layout.tsx}`,
`apps/mobile/src/{api/hooks.ts,features/ProfileScreen.tsx,ui/states.tsx,i18n/index.ts}`,
`apps/mobile/jest.config.js`.

**Database changes:** 0016 - `users.email`, `users.email_verified_at`, a case-insensitive partial
unique index and a shape check; a backfill from the unused `customer_profiles.email`;
`emergency_contacts` with a per-user cap trigger and a unique index.

**API changes:** `POST /me/complete-profile`, `POST /me/avatar`,
`GET|POST|DELETE /me/emergency-contacts`; `PATCH /me` now takes `email` and `avatarKey`;
`UserView` gains `email` and `emailVerified`, and `avatarUrl` is now a signed link rather than a
stored key. Two new error codes, `EMAIL_IN_USE` and `CONTACT_LIMIT_REACHED`, both translated.

**Tests added / passed:** 13 new in `identity.test.ts`; API 321/321, mobile 29/29, a11y 0
findings, typecheck and lint clean, build clean.

**Manual verification completed:** signup driven on the physical Android device through Expo Go -
phone, OTP, the new name screen, terms, then the role picker. Against the running API: the
avatar round trip end to end (70-byte PNG PUT, 204, committed by key, signed link, fetched back
byte-identical), email lower-casing, and the emergency-contact mask.

**Known limitations:** email verification is not built and nothing sets the verified flag;
sending the existing tracking link straight to a saved contact is contracted but not routed
(the link and the share sheet themselves already work); there is still no
onboarding tour. Device testing was stopped early rather than continued, because the phone's
browser kept returning to the foreground and capturing it would have meant capturing the owner's
personal accounts.

**Security considerations:** the avatar key prefix check is the load-bearing one - it is what
stops an account pointing its photo at somebody else's identity document. Email uniqueness is
checked before the write for the message and enforced by the index for the guarantee. Emergency
contacts belong to people who are not users here and have consented to nothing, so the design
holds as little as possible and the audit trail records the act, not the number.

**External integrations mocked or live:** unchanged. Everything is still mocked except local
storage, which really holds bytes. Email has no adapter at all yet.

**Next milestone:** owner-supplied credentials (SMS, payments, maps, push, monitoring, production
storage), the legal and payments review, and an email adapter.

---

## Four bugs that only a phone could find

**Milestone:** post-M9 - the device run
**Date:** 2026-09-27
**Status:** Complete

**Why this exists:** the device run had been deferred to the end on purpose. The app type-checked,
linted, bundled and passed 536 tests. What it had never done was run.

Every bug below was invisible to that suite, and for the same reason: each is about the app *as
assembled* rather than about any unit of it. Nothing was red.

**What the device was:** a physical OnePlus CPH2585 on **Android 16**, through Expo Go over a USB
reverse tunnel. Android 16 matters - it is the release that removes the ability to opt out of
edge-to-edge, which was one of the two things flagged as most likely to break on SDK 57. It did
not. Reanimated 4 works; it emits one cosmetic warning about `opacity` being overwritten by a
layout animation.

**The four:**

*1. Notifications took the whole app down.* `src/api/push.ts` called
`Notifications.setNotificationHandler(...)` at module scope, and `expo-notifications` throws on
load in Expo Go. Importing the file threw, so the module never finished evaluating, so its
exports came back `undefined`, so expo-router failed with `Cannot read property 'ErrorBoundary'
of undefined`. **The screen was blank.** The first fix - a `try` around the call - did not work,
because a static import is hoisted and there is nowhere to put a `try` around it. The module is
now loaded lazily inside a `try`, and Expo Go is detected and not asked at all, because this
module reports its failure to the global handler as well as throwing: catching it kept the app
alive but still produced a red screen in development and would have produced a fabricated crash
report in production. The lesson is not about Expo Go. "The notification service is missing" is
ordinary on real devices - a de-Googled phone, a work profile, a region without Play Services.
Notifications are a convenience; the app is not.

*2. A dozen screens were unreachable.* `app/_layout.tsx` ended its auth gate with
`if (group !== target) router.replace(home)`. For anything not inside a role group - `/receipts`,
`/favourites`, `/referrals`, `/notifications`, `/warranty-claims`, `/search`, `/invoice/[id]`,
`/payout-account` - `segments[0]` is the route name, never the group, so **every one of them
bounced straight back to the role's home**. Tapping "Receipts" did nothing. No error, no failed
request, nothing to notice unless you tap it. Only a group can be the wrong place to be, and the
gate now says so.

*3. A new customer could not book anything.* The booking form's "Where?" section correctly told
somebody with no address to *"Add an address in your profile to continue"*. The profile had no
such thing. `useCreateAddress` had existed in the API layer since M2 and **no screen had ever
called it**, so the primary journey dead-ended for every first-time user. There is now an
addresses screen, linked first in the profile and reachable straight from the booking form's
empty state - a button now, rather than a sentence telling somebody to go and find a screen that
did not exist.

*4. The storage work was silently switched off.* The repo's `.env` carried
`STORAGE_PROVIDER=mock` from before local storage existed, and an env file beats a schema
default. So the adapter that actually stores bytes was not being used, `/ready` listed storage
among the mocks, and media rows went back to claiming files that did not exist - the exact bug
that had just been fixed, reintroduced by a line of configuration. `.env.example` and `.env` now
select `local`, and `jobs.test.ts` no longer asserts a `mock://` URL that no client could ever
have uploaded to.

**Storage, proven with the phone in the loop.** Not inferred from a passing test: a 70-byte PNG
was PUT **from the device** to the signed upload URL (204), landed on disk at the expected key at
70 bytes, and read back through the signed read URL as `image/png` with the bytes matching
exactly what the phone sent.

**Accessibility, read off the device.** The tree a screen reader reads was dumped from the running
app. No control was unnamed, which confirms the static audit. But **nine were announced twice** -
the control carried a name and its own text was exposed as well, so TalkBack would say "Plumbing,
Plumbing" - and the primary button's name ended in a comma, which a screen reader renders as a
pause. `Button`, `Card`, `TabBar` and the booking tiles now name themselves explicitly and hide
their inner text from the tree. The proof is in the tests: they used to find a button by its text
and now cannot, because the button is a single node named for what it does. They query by that
name instead, which is a better test anyway.

**Changed files:** `apps/mobile/src/api/push.ts`, `apps/mobile/app/_layout.tsx`,
`apps/mobile/app/addresses.tsx` (new), `apps/mobile/app/(customer)/book.tsx`,
`apps/mobile/app/notification-settings.tsx`, `apps/mobile/src/features/ProfileScreen.tsx`,
`apps/mobile/src/ui/{Button,Card,TabBar}.tsx`, `apps/mobile/src/i18n/index.ts`,
`apps/mobile/src/ui/ui.test.tsx`, `apps/mobile/src/features/customer/WarrantyCard.test.tsx`,
`apps/api/src/test/jobs.test.ts`, `.env.example`.

**Database changes:** none.

**API changes:** none.

**Tests passed:** 536 - core 199, API 308, mobile 29. Typecheck, lint, build and `npm run a11y`
clean.

**Manual verification completed:** on the device - welcome, phone entry with live formatting and
validation, OTP (masked as `+91********01` in both the UI and the API log, so redaction works on
a real device), role selection, home, price guidance rendering as designed (`₹250-2,500` with
"usually", because no job has been paid for yet), `/me/rebook` called and correctly returning
nothing for a new customer, adding an address, and a real job created and submitted end to end.

**Known limitations:** two cosmetic layout bugs on a tall screen - "Welcome!" breaks mid-word into
"Welc / ome!" because the greeting shares a row with the city picker and the bell, and
"Carpentry" wraps inside its tile. The number pad covers the sign-in card, so somebody cannot see
the field they are typing into. TalkBack itself was not driven - reading order and where focus
lands after a sheet closes cannot be read out of a tree dump, and enabling a screen reader on
somebody's personal phone takes over its gestures.

**Security considerations:** the OTP and the phone number are masked in the API log on a real
device, which is the first time that has been observed rather than asserted. No secret reached
the device: the storage grants are short-lived, scoped and carried in the URL by design.

**External integrations mocked or live:** storage is now genuinely local rather than mocked, on
the device as well as in tests. Everything else - SMS, payment, maps, push, telephony, monitoring,
analytics - is still mocked.

**Next milestone:** credentials, the legal review, and a `docker build` - all three of which are
the owner's to start.

---

## The photo that was never there

**Milestone:** post-M9 - the launch-readiness list, worked top to bottom
**Date:** 2026-09-27
**Status:** Complete except what needs a phone, a credential, or a lawyer

**Why this exists:** an assessment of what stood between this and being genuinely good produced
three tiers. Tier 0 was things only the owner can do - credentials, legal review, a device. Tier
1 was work that was built but hollow. Tier 2 was the gap between a complete app and one somebody
comes back to. This entry is Tiers 1 and 2.

**The one that mattered most.** The storage adapter was a mock that returned a `mock://` URL
nobody could PUT to. To keep the flow working, the API marked every media row uploaded the
moment it was created and told the client to skip the transfer. Written down plainly: **completion
photos did not exist**, and completion photos are the evidence the dispute and warranty
processes are decided on. Every test about evidence had been passing against rows that referred
to nothing - and the entire suite stayed green through the fix, because no test had ever looked.
There is now a real local-disk adapter: bytes written, served, size-limited, content-type
checked and deleted, behind signed grants scoped to one key, one type, one size and one
operation. Eight new tests do what none of the old ones did and read the bytes back.

Fixing it surfaced a second bug on a path that has never run: `uploaded_at` was only ever set
when the adapter was a mock, so with a *real* provider no row would ever have been marked
uploaded at all - there was no confirm step to do it. There is one now.

**Implemented:**

*Identity documents are encrypted before they touch the disk.* AES-256-GCM, keyed on the server
secret, applied to `kyc/` objects only - an Aadhaar card is the most sensitive thing this system
will hold, is legally somebody else's, and unlike a photo of a leaking tap is never shown to the
person it belongs to. Not envelope encryption: somebody with the environment has the key. What
it defends against is a stolen disk, a stray backup or a misconfigured bucket, which is most of
how document leaks actually happen.

*A chargeback stops the money.* `payment.chargeback` puts the payment on hold, freezes every
settlement on the job, opens a high-priority ticket and tells the provider their payout has
stopped rather than letting them discover it by noticing it never came. It deliberately never
auto-refunds: the bank has already returned the money, and a refund would pay the customer twice
out of the platform's pocket. Paying a provider out of money the bank is taking back is how a
marketplace ends up funding somebody else's fraud.

*A start code that can be changed.* Not a resend - the code is derived rather than stored, so the
customer could always see it. What was missing was making the old one stop working: for the code
that went to the wrong person, was read over a shoulder, or the job stuck because the provider
mistyped it five times.

*Roughly what it costs, before anybody commits.* Every skill carries a labour range, on the home
tiles and on the booking screen. It lives on the skill because "plumbing" spans a washer change
and a geyser replacement. It says whether it is a measurement or a guess: five finished jobs in
a skill and it reports the inter-quartile range of what customers actually paid, worded as "what
27 people paid"; until then it is the seeded figure and says "usually".

*Book again.* Finished work offered back, one card per kind of work, starting a fresh draft with
the category, address and last time's description - and carrying over no price and no
professional, because a repeat is a new job that has to be quoted on its own.

*The provider can rate the customer.* The server always accepted a review from either side;
only the customer ever had a screen for it. A marketplace that asks people to walk into
strangers' homes gave them no way to warn the next person.

**Two things on the list were already done.** The mobile camera and voice-note capture were
marked "stand-in" and "not started" in `KNOWN_LIMITATIONS.md` and are neither - the code has been
real for some time and the rows were stale. And in the assessment that produced this list I said
there was no cancellation fee; there is, and there always was. I had searched for "cancellation
fee" and the function is called `customerCancellationCharge`. Both corrected in the docs.

**Changed files:** `apps/api/src/adapters/{local-storage,index}.ts`,
`apps/api/src/modules/storage/routes.ts`, `apps/api/src/modules/{jobs,categories,execution,negotiation}/*`,
`apps/api/src/lib/crypto.ts`, `apps/api/src/data/**` (price guide, media-by-key, start-code delete),
`apps/api/src/config/env.ts`, `packages/core/src/{pricing/pricing,contracts/common,contracts/negotiation}.ts`,
`apps/mobile/src/features/customer/{PriceGuideLine,BookAgain}.tsx`,
`apps/mobile/src/features/provider/RateCustomerCard.tsx`, `apps/mobile/src/api/{jobs,execution}.ts`,
`apps/mobile/app/(customer)/{home,book}.tsx`, `apps/mobile/app/(provider)/active.tsx`,
`supabase/migrations/0015_price_guidance.sql`, and the docs.

**Database changes:** `0015_price_guidance.sql` - labour ranges on `service_skills`, with a check
constraint that a range is a range. Forward-only; 15/15 apply cleanly to a real PostgreSQL 17.

**API changes:** `PUT /storage/upload`, `GET /storage/object`, `POST /jobs/:id/media/:mediaId/uploaded`,
`GET /me/rebook`, `POST /jobs/from/:id`, `POST /jobs/:id/start-code/rotate`. `/categories` now
carries `priceGuide`. `/payments/webhook` accepts `payment.chargeback`.

**Tests added:** 27 - nine on storage (round trip, size and type refusal, tampered and
cross-purpose grants, deletion, and that a KYC document on disk is not the bytes that were
uploaded), six on price guidance, seven on rebooking, four on start-code rotation, two on
chargebacks, three on the range formatter.

**Tests passed:** 507 - core 199, API 308. The API suite passes **308/308 against a real
PostgreSQL 17**, first run. Typecheck, lint, build, `npm run a11y` and migrations all clean.

**Known limitations:** the container image has still never been built - Docker Desktop would not
start here. No soak test. No screen-reader pass. No onboarding: a first-time user is dropped onto
the home screen with no explanation of how bidding, the start code or the hold on their money
work. Every live adapter is still credential-less and fails loudly at boot.

**Security considerations:** storage grants carry no bearer token by design, so they are short,
scoped to a single operation, and an upload grant is refused for reading. Keys are never taken
from the caller, only from inside a signature we produced, and path resolution is checked against
the storage root rather than assumed. Identity documents are encrypted at rest. The start code
never reaches the audit trail, only the fact that it changed. Production refuses to boot on local
or mock storage.

**External integrations mocked or live:** unchanged - SMS, payment, maps, push, telephony,
monitoring and analytics are all mocked. Storage is no longer among them: it is real, locally.

**Next milestone:** the device run, and the credentials.

---

## Assuming there is only one of us

**Milestone:** post-M9 - multi-node correctness, the ops report, and something to deploy
**Date:** 2026-09-27
**Status:** Complete except a `docker build`, which the environment could not run

**Why this exists:** a list of six remaining items, of which three were already done. The other
three turned out to be one theme and two of them were the same mistake in different places:
code that is obviously correct in one process and silently wrong in two.

Silently is the important word. None of these fail loudly. The scheduler quietly does everything
twice. A customer's live screen quietly stops updating. A limit is quietly N times looser than
the number written next to it. Nothing throws, no request fails, and no test running in a single
process can see any of it.

**Implemented:**

*One scheduler, whichever node you ask.* Every node ran its own `setInterval` with no exclusion.
A Postgres advisory lock now admits one and turns the rest away as `null` rather than an error,
because losing that race is the normal case and happens on every tick of every node but one. The
lock on its own was not enough, and this is the part worth remembering: each node kept "when did
this last run" in a Map, so a second node believed nothing had ever run and would fire every task
on its first tick, and again on the next, and the next. The work is idempotent so nothing broke -
but `everySeconds` stopped describing reality, which is its whole job. That state moved into
`scheduler_runs`, read and written inside the lock.

The old advice in `DEPLOYMENT.md` was to run the scheduler on exactly one node. That worked, and
it traded a duplicate-work bug for a single point of failure nothing would report: the one node
with it enabled dies, payouts quietly stop, every other node looks healthy.

*Streams that reach the person watching.* A stream is held open by one node; the write that
causes an event is handled by whichever node took the request. On two nodes those are usually
different, so a customer watching their job saw nothing at all. Events now go over LISTEN/NOTIFY.
The publishing node deliberately does *not* also deliver to its own subscribers - the obvious
implementation, and it double-sends, because NOTIFY delivers back to the sender.

*A shared counter, and a correction to the premise.* "The rate limiter is in memory" reads as a
security hole, and it was not one. `requestOtp` has always counted rows in `otp_challenges` per
phone and per IP, and attempts live on the challenge row - the limits that actually stop somebody
brute-forcing an account were in the database from the start. What was per-node is the framework
limiter in front of them. The OTP routes now count in the database too, so the cheap gate is not
looser than the real one. The global 300/minute stays per-node on purpose: it is fairness, not
security, and a round trip on every request is a real cost to pay for a tidier number.

*An ops report that is not quietly wrong.* It walked up to 500 customers, up to 200 jobs each,
and a ledger read per job. The cost was the smaller problem. It **truncated in silence**: past
500 customers it simply stopped counting and nothing on the screen said so, which makes a quiet
week and a missing thousand jobs look identical to somebody deciding on the number. Six
aggregates over whole tables now. `providersVerified` and `providersSuspended` were not computed
from anything at all - they were literally `0` - on a screen an operator reads to decide whether
there is enough supply to take bookings.

*Something to deploy.* Multi-stage `Dockerfile`, non-root, `tini` as PID 1 so SIGTERM drains
instead of killing mid-flight. The runtime dependencies are resolved on their own rather than
with a root prod install, because `apps/mobile` has Expo and React Native as *production*
dependencies and a root install drags a mobile app into an image that serves HTTP. Pool sizing,
idle, connection and statement timeouts are env-driven.

**Changed files:** `apps/api/src/data/{types,index}.ts`, `apps/api/src/data/postgres/{cluster,reports,index}.ts`,
`apps/api/src/data/memory/{cluster,reports,index,jobs,finance,bids}.ts`,
`apps/api/src/modules/{scheduler/service,events/service,events/routes,admin/service,auth/routes}.ts`,
`apps/api/src/lib/{shared-limit,logger}.ts`, `apps/api/src/{app,config/env}.ts`,
`supabase/migrations/0014_multi_node.sql`, `Dockerfile`, `.dockerignore`, and the docs.

**Database changes:** `0014_multi_node.sql` - `rate_limit_hits` and `scheduler_runs`.
Forward-only; 14/14 apply cleanly to a real PostgreSQL 17. Two of the primitives need no table at
all: advisory locks live in the session, and LISTEN/NOTIFY needs nothing.

**API changes:** `/ready` gains `degradedAdapters` and a `?deep=1` parameter, and no longer
returns 503 for a failing adapter. `/admin/scheduler` now reports the cluster's state rather than
the answering node's.

**Tests added:** 12 - eight running two real nodes, four on the ops report. Against Postgres the
two nodes are two stores with two pools on one database, so the advisory lock and LISTEN/NOTIFY
are exercised rather than simulated.

**Tests passed:** 476 - core 196, API 280. The API suite passes **280/280 against a real
PostgreSQL 17**, which is where the multi-node code had to be proven and where it initially was
not. Typecheck, lint, build, `npm run a11y` and migrations all clean.

**Manual verification completed:** 100 concurrent booking walks against real Postgres - 100/100
in 10.8s, 1302 requests at 121 req/s, nothing over three seconds. `/ready` dropped from 310ms to
117ms, which is the adapter cache doing its job.

**Three things found by testing rather than by reading.**

*The lock test was measuring the wrong thing.* The first version started both nodes at once and
asserted only one body ran. It passed in memory mode and failed against Postgres - not because
the lock was broken, but because opening a pooled connection takes longer than the 50ms of work
being guarded, so the first node had finished and released before the second even asked. A test
that depends on who wins a race proves nothing on the run where it happens to pass. It is a
barrier now: node A goes in and stays in until node B has had its turn to try. Worth being blunt
about - had the Postgres run been skipped, a test that proved nothing would have been committed
as proof.

*The container would not have started.* `pino-pretty` is a devDependency, but the logger asks
pino to resolve it by name whenever `APP_ENV` is `local` - and `APP_ENV` defaults to `local`.
With dev dependencies omitted that is not a plainer log format, it is a process that exits at
boot with a stack trace about a log formatter, on the first run anybody would attempt. Found by
running the built artefact the way the image would, not by reading the Dockerfile.

*`/ready` could have taken the whole service down.* It pinged every adapter on every call - eight
outbound API calls per probe per node with live credentials - and returned 503 if any failed. A
payment provider having a bad ten minutes would make every node report itself unready at the same
moment, and a load balancer would pull all of them, including for the great majority of requests
that never touch payments. A third party's outage would have become ours, automatically.
Readiness is now about what a node can answer for: itself and its database. Adapter health is
still reported, swept on a cache, and decides nothing. The code looked careful - it checked
everything - and checking everything was the bug.

**Known limitations:** the image has **not been built**; Docker Desktop would not start here, so
the dependency install, the server boot and the health endpoints were verified without it and the
`docker build` itself is unproven. No soak test: 100 concurrent bookings pass, but nothing has
run for hours, so a slow leak or an index degrading as tables fill would not have appeared. No
screen-reader pass. Every live adapter is still credential-less and fails loudly at boot.

**Security considerations:** the OTP limits were already database-backed and remain so; the new
shared counter sits in front of them rather than replacing them. `/ready` no longer lets a third
party's health decide whether this service accepts traffic. The container runs as `node`, not
root, and `.dockerignore` excludes `.env` from the build context so a secret cannot reach a layer.

**External integrations mocked or live:** unchanged - all mocked.

**Next milestone:** the device run on a physical phone, which is also when TalkBack and VoiceOver
get walked through a booking.

---

## The seven gaps, closed except the one that needs a phone

**Milestone:** post-M9 - the remaining launch-readiness list
**Date:** 2026-09-26
**Status:** Complete except the device run, which was deliberately left for last

**Why this exists:** a gap table had seven rows on it. Six were work; the seventh was running the
app on a physical phone, which was held back until the rest was finished.

**Implemented:**

*A technician can see where they are going.* Until now they were handed the provider app: a
bidding feed they cannot use and an earnings tab showing money that belongs to their contractor.
Every "my jobs" route in the system filters on `provider_id`, and a technician is never the
provider, so the honest answer to "what am I doing today" was that the app could not tell them.
They now have two tabs of their own. The full address is on the card on purpose - somebody who
has been assigned has to be able to arrive, and a screen that shows them "Green Park, Delhi" is a
screen they work around by ringing the customer, which is the one number they must not have.

*A provider who cannot make it proposes instead of cancelling.* Modelled as a proposal rather
than a reschedule, because the customer's time is theirs: nothing moves until they answer. One
open proposal per job, enforced by a partial unique index rather than by the service remembering
to check. Accepting writes a real `job_reschedules` row, so the history reads the same whoever
asked for the change.

*The referral reward credits itself.* It was support crediting something by hand. It is now a
promo code reserved to one person, refused to anybody else, expiring in 90 days and excluded from
the general promo list. A reserved code rather than a wallet balance on purpose: a second money
primitive would need its own ledger path and its own rounding, and this needs neither.

*Work survives a dead connection.* Status updates, chat, photos, completion and availability
queue and replay with the idempotency key they were given, so a reply nobody saw cannot produce a
second anything. Money never queues - a person needs to watch a payment succeed or fail while
they are looking at the screen, and "we will send this later" is not an acceptable thing to say
about somebody else's money. It is an allow-list, so a route added next month is not silently
queueable.

*Crashes report themselves, with the personal parts removed.* A hand-written Sentry envelope POST
rather than the native SDK, which keeps the build simple. Phone numbers, emails and bearer tokens
are scrubbed from messages and stack frames before anything leaves the device. With no DSN set it
logs to the console and sends nothing.

*Load was measured by booking, not by pinging.* Each virtual user walks a whole booking, because
nothing here is a single request and requests-per-second on a GET loop would answer a question
nobody asked.

*Accessibility became a check instead of an opinion.* See below - it is the part of this entry
that found the most.

**Changed files:** `apps/mobile/app/(technician)/*`, `apps/mobile/src/api/{technician,crash,outbox,ids}.ts`,
`apps/api/src/modules/technician/routes.ts`, `apps/api/src/modules/jobs/service.ts`,
`apps/api/src/modules/growth/service.ts`, `packages/core/src/{growth/growth,ops/reach}.ts`,
`supabase/migrations/0013_rewards_and_scheduling.sql`, `scripts/{load-test,a11y-audit}.mjs`,
`apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/ui/Text.tsx`, `apps/mobile/app/(auth)/{phone,otp}.tsx`,
`apps/mobile/src/features/capture/VoiceNoteRecorder.tsx`, `apps/mobile/jest.setup.jsx`,
`.github/workflows/ci.yml`, `package.json`. Deleted: `apps/mobile/src/features/auth/` (dead).

**Database changes:** `0013_rewards_and_scheduling.sql` - `promo_codes.reserved_for_user_id` and
`referral_id`; `schedule_proposals` with a partial unique index allowing one PENDING row per job.
Forward-only; 13/13 apply cleanly to a real PostgreSQL 17.

**API changes:** `GET /technician/profile`, `GET /technician/jobs`; propose / respond / withdraw
on a job's schedule proposal.

**Tests added:** 12 API tests covering proposals and referral auto-credit (including a reward code
refused to somebody it was not reserved for, and reserved codes staying out of `/admin/promos`);
11 mobile tests over the outbox, asserting among other things that no money endpoint is queueable.

**Tests passed:** 493 - core 196, API 268, mobile 29. The API suite also passes 268/268 against a
real PostgreSQL 17, not only in memory mode. Typecheck clean across three workspaces, lint clean,
build clean, migrations 13/13 valid, `npm run a11y` reports zero findings.

**Manual verification completed:** load test against real Postgres at 25 and 100 concurrent
booking walks. At 100: 100/100 completed in 10.9s, 1302 requests at 120 req/s, nothing over three
seconds, slowest p95 `provider/profile` at 1.6s. The two reported failure classes are the system
working as specified - an unverified provider can neither go available nor bid, and verification
is a staff action - so a cold start stops there by design. The load script now says so at both
call sites, having previously explained only one of them.

**What the accessibility audit actually found.** Eight real contrast failures, and they are fixed:
muted text at 2.3:1, success and danger text and the warning and info badges all under the line,
a 3.4:1 tagline on the sign-in screen written as a literal hex where the palette could not see it,
and 13px white caption text at 2.5:1 on the light end of the hero gradient. Foregrounds moved;
the mint grounds, white cards and pastel chip fills did not. Teal is now split by role - `primary`
is a fill and clears the 3:1 WCAG asks of non-text plus enough to carry a white label at 4.77:1,
while teal as ink renders as `primaryDeep`, because teal text on a mint ground cannot reach 4.5:1
and still be the brand teal. One thing was genuinely lost: the hero gradient's light end darkened
from `#15A883` to `#108065`, which narrows the sweep visibly. That was a prettier gradient against
a legible caption about a live booking.

The audit also reported six unlabelled controls that were labelled all along: the first version
mistook the `>` in an inline arrow handler for the end of the opening tag and never read the
`accessibilityLabel` sitting past it. The fix was to parse the tag properly, not to relax the
rule - a checker that reports things which are not true teaches people to ignore it. It now reads
the palette straight out of `tokens.ts` for the same reason: a checker with its own private copy
of the colours passes while the app fails.

Two incidental findings. `apps/mobile/src/features/auth/` was dead code - nothing imported it -
and it still contained the "Better Homes Happier Lives" text that was removed from the welcome
screen earlier; the component went, the orphan file stayed. Deleted. And the mobile test suite was
broken by my own earlier change: `client.ts` imports the outbox, which reads AsyncStorage at
import time, which is null under Jest. The outbox's own test mocked it and passed, so the break
only showed in two unrelated suites. Mocked globally in `jest.setup.jsx`.

**Known limitations:** no screen-reader pass - the audit reads source and cannot tell whether the
reading order makes sense, where focus lands after a sheet closes, or whether a label reads
naturally out loud. No soak test: 100 concurrent bookings pass, but nothing has run for hours, so
a slow leak or an index degrading as tables fill would not have appeared. Every live adapter is
still credential-less and fails loudly at boot rather than falling back. Full list in
`KNOWN_LIMITATIONS.md`.

**Security considerations:** the technician view deliberately includes the full address and
deliberately excludes price, payout and the customer's surname. Reserved promo codes are refused
to anybody they were not issued to, checked server-side. The crash reporter scrubs phone numbers,
emails and bearer tokens before transmission. The outbox will not replay anything that moves
money.

**External integrations mocked or live:** unchanged - all mocked. Sentry is wired but inert
without a DSN.

**Next milestone:** the device run - the app on a physical phone on SDK 57, which is also when
TalkBack and VoiceOver get walked through a booking.

---

## Making the built things reachable

**Milestone:** post-M9 - screens for features that already worked and nobody could get to
**Date:** 2026-09-26
**Status:** Complete

**Why this exists:** a review of what was still missing turned up something uncomfortable - the
two biggest gaps were mine. I had built the warranty claim flow and the flagged-message queue on
the server in the previous session and shipped neither to a screen. A feature that exists and
cannot be reached is not a feature; it is a test that passes.

**Implemented:**

*The professional can answer a warranty claim.* The claim API, the 48-hour clock and the
escalation to support all existed, and the only thing a professional could do about a claim was
fail to answer it - which is a strange way to treat somebody whose reputation is on the line.
The screen puts the clock in front of them, counts down, and turns amber in the last twelve
hours. Declining is offered exactly as plainly as accepting: not everything that breaks a week
later is the same fault, and a screen that only offered "accept" would push honest people into
either eating the cost or ignoring the claim. The decline sheet says what a useful reason looks
like, because "not my fault" helps nobody and "a different pipe, upstream of the joint I
replaced" settles it.

The entry point carries a count, so a claim with a deadline is not something you have to go
looking for.

*The flagged-message queue has a screen.* This is the one that stung: the previous session's
whole argument was that a flag nobody reads is the appearance of moderation without the fact of
it, and then the queue shipped with no way to read it. Clearing a message is deliberately the
easiest action on the screen - most flags are somebody sharing a number so a delivery can be let
through the gate, and a queue where the innocent case is fiddly is a queue that stops being
worked. The message is shown verbatim: a reviewer deciding on a summary is deciding on somebody
else's reading of it.

*The rest of the console.* Eleven admin route groups existed and three were reachable; everything
else meant running curl against production, which is slow and is exactly how a wrong id ends up
in a destructive call. One screen with six sections - overview, people, payouts, promos,
background tasks, security - rather than six tabs, because this is a place people come during an
incident to answer one question, and a tab bar of six things is six guesses about where the
answer lives. Suspension is deliberately **not** a button there: it needs a second approver, and
doing it properly means the dispute or verification screen where that person is already involved.

*Postgres in CI.* The in-memory store mirrors every SQL constraint by hand, and hand-written
mirrors drift - the first real run found four bugs the memory suite structurally could not. CI
now applies every migration to PostgreSQL 17 and runs the whole API suite against it, alongside
the memory run. `scripts/apply-migrations.mjs` is deliberately dumb: it runs the files in name
order and stops at the first failure with the filename and the error. It also recognises the one
failure that looks cryptic and has an obvious cause - a Windows-1252 cluster cannot hold the
Devanagari in the service catalog - and says how to fix it.

**Changed files:** `.github/workflows/ci.yml`, `scripts/apply-migrations.mjs`, `package.json`,
`apps/mobile/{app/warranty-claims.tsx,app/(admin)/{moderation,console,_layout}.tsx,src/api/{admin-trust,admin-console}.ts,src/features/ProfileScreen.tsx,src/i18n/index.ts}`,
and the documents below.

**Database changes:** none.

**API changes:** none - this milestone is entirely about reaching what already existed.

**Tests added / passed:** none added; this is UI over tested routes. Totals unchanged:
**256/256 API**, **187/187 core**, **18/18 mobile**. Type check clean in 3/3 workspaces, lint 0
errors.

**One thing to watch:** the mobile suite failed once in a combined workspace run and has passed
five times since, including four more combined runs. It looks like a cold-transform timing issue
under load rather than a real fault, but it is written down here rather than shrugged at - if it
returns, the jest transform cache is the first place to look.

**Known limitations:** the app still has not been run on a physical device since the SDK 57
upgrade, which remains the largest single risk. There is no crash reporting in the mobile app -
the error boundary logs to the console and the Sentry adapter exists only on the server. Nothing
queues actions taken while offline. The technician role still uses the provider screens, and a
provider still cannot propose a new time - they can only cancel.

---

## The warranty nobody could claim, and four other holes

**Milestone:** post-M9 - the gaps a feature review found after the spec was already "done"
**Date:** 2026-09-24
**Status:** Complete

**Why this exists:** with every specified feature built, I went looking for what was *missing
from the spec*. Six things came out of it. The first is not a feature - it is the reason the
business model works at all.

**Implemented:**

*A warranty somebody can claim on.* Every accepted quote has carried `warranty_days` since M4,
and every completion a `warranty_note`. Neither did anything. A customer whose tap leaked again
a week later had no button, so they rang the professional directly - which is precisely the
leakage PRODUCT_SPEC section 17 exists to prevent, and both of them would learn they never
needed us.

The central decision is that **a warranty claim is not a dispute**. A dispute is an argument
about what happened; a claim is "the work was fine and it has come back", which usually ends with
the same professional returning at no charge. Filing it as a dispute would hang a strike-shaped
cloud over somebody who has done nothing wrong, and professionals would quietly stop offering
warranties at all.

A claim goes to the professional with a 48-hour clock. They may decline - not everything that
breaks later is the same fault - but never without an explanation, because the customer is owed
a reason and support will need one. Silence is not an option: an unanswered claim escalates to
support, so nobody can run down a warranty clock by ignoring it. Accepting books a return visit
that is **a job in its own right and carries no money in either direction** - the professional
already agreed to it when they offered the warranty, and a test asserts that no payment and no
quote exist on it.

*A professional a customer can look at.* Before this, comparing four offers meant comparing four
prices and a rating, which made the marketplace an auction - and section 10 is explicit that it
should not be one. The profile shows verification, jobs done, skills, a bio, reviews, and a
rating *breakdown*, because a 4.6 from three people is not a 4.6 from three hundred. It carries
no phone number, no address, no document and no exact location: only "about 3 km away".

*A search box that searches.* It had been `onFocus={comingSoon}` since M2. People do not type
category names - they type "geyser", "नल", "short circuit" - so it matches the words they use in
both languages and says what each hit matched on, so "gizer" finding "Water heater" explains
itself. With nothing typed it offers what they booked before, because a blank panel reads as
broken.

*The right of access.* Deletion has existed since M1; access had not, and the DPDP Act 2023 does
not treat it as optional. The export names every section it included **and every one it left
out, with the reason** - identity documents, the other side of a conversation, internal fraud
signals - so nobody has to guess whether something is missing by accident or by design.

*A moderation queue somebody reads.* Messages carrying a phone number or a UPI handle have been
flagged since M5 and nobody ever looked at one. A flag nobody reads is worse than no flag: it is
the appearance of moderation without the fact of it, and that appearance is what we would be
relying on if somebody asked how we police off-platform payment. `ALLOWED` needs no reason - most
flags are somebody sharing a number so a delivery is let through the gate - but a strike does.

*Recovery codes.* Admin MFA has had TOTP and a five-failure lock since M8 and no way back in: a
lost phone meant hand-editing production, at speed, under pressure, which is the situation in
which people make the mistake that becomes the incident. Ten codes, shown once, stored hashed.

*And the first mobile tests this app has ever had.* 18 of them, over the shared UI primitives and
the warranty card - the screen that has to be right about money and promises.

**Changed files:** `packages/core/src/{warranty/*,trust/trust.ts,search/*,contracts/warranty.ts,ops/schedule.ts,index.ts}`,
`supabase/migrations/0012_warranty_and_trust.sql`,
`apps/api/src/{modules/{warranty,trust}/*,modules/{scheduler,provider,execution}/*,data/{types.ts,memory/*,postgres/*},app.ts,vitest.config.ts,test/{warranty,scheduler}.test.ts}`,
`apps/mobile/{app/search.tsx,app/provider/[id].tsx,app/(customer)/{home,job/[id]}.tsx,src/api/warranty.ts,src/features/customer/{WarrantyCard.tsx,WarrantyCard.test.tsx,OffersList.tsx},src/ui/ui.test.tsx,jest.config.js,jest.setup.jsx,tsconfig.json}`.

**Database changes:** `0012_warranty_and_trust` - `warranty_claims` (with a trigger refusing a
claim after its cover ends, and one open claim per job), `admin_recovery_codes` (hashed, used
rows kept), `data_export_requests`, review columns on `chat_messages`, and
`jobs.warranty_claim_id`. Forward-only. `migrate:check` reports 12 valid migrations, and all 12
apply to a real cluster.

**API changes:** `GET /jobs/:id/warranty`, `POST /jobs/:id/warranty-claim`,
`GET /me/warranty-claims`, `POST /warranty-claims/:id/{respond,revisit,resolve}`,
`GET /providers/:id`, `GET /search`, `GET /me/export`, `GET /admin/flagged-messages`,
`POST /admin/flagged-messages/:id/review`, `GET/POST /admin/mfa/recovery-codes`,
`POST /admin/mfa/recover`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 23 new API tests, 23 new core tests and **18 mobile tests - the first
in this project**. Totals: **256/256 API in memory mode**, **256/256 against real Postgres**,
**187/187 core**, **18/18 mobile**. Type check clean in 3/3 workspaces, lint 0 errors,
`migrate:check` OK.

**Three things the work turned up:**

1. **Submitting KYC needed a provider profile**, which a technician does not have - so a
   contractor submitting for their crew got a 404. The record belongs to the person, not to a
   profile.
2. **Two Reacts.** Installing the test renderer pulled a second React to the workspace root, and
   two Reacts in one tree means a null hook dispatcher and an error that blames the component. A
   root `overrides` entry holds the whole tree at the app's own pin.
3. **The Postgres run was failing on time, not on correctness.** Vitest's default five seconds is
   comfortable against the in-memory store and too tight against a real one, where a single test
   drives hundreds of round trips. The timeout is now twenty seconds - still short enough that a
   genuine hang fails rather than hangs.

**Known limitations:** the referral reward is marked QUALIFIED and both sides are notified, but
the credit is applied by support rather than automatically. The data export is JSON rather than a
file somebody can keep. Search runs over the in-memory catalog, which is right at pilot size and
becomes a Postgres text search when it is not. Mobile coverage is 18 tests, which is a beginning
and not coverage - and the app still has not been run on a physical device since the SDK 57
upgrade.

---

## Expo SDK 53 to 57, and the four breaking changes it surfaced

**Milestone:** post-M9 - the upgrade that was blocking store submission
**Date:** 2026-09-24
**Status:** Complete

**Why this exists:** SDK 53 could not be submitted to either store any more, and Expo Go had
moved on far enough that the project would not open in it. This was the last thing on the
feature-gap list, and deliberately the last thing done: it touches every file indirectly and
nothing else should be in flight while it happens.

**What moved:** Expo 53 → 57, React Native 0.79 → 0.86, React 19.0 → 19.2, Reanimated 3 → 4,
expo-router 5 → 57, TypeScript 5.7 → 6. Four majors of Expo in one step rather than one at a
time, which worked because the app uses Expo's own modules throughout and almost no third-party
native code.

**The four things that actually broke, and why each fix is the right one rather than the quick
one:**

1. **Reanimated 4 moved its worklet transform** into `react-native-worklets`. The old
   `react-native-reanimated/plugin` path still resolves - it re-exports - so the build would have
   kept working while warning on every run. The babel config now names the plugin where it
   actually lives.
2. **`StyleSheet.absoluteFillObject` is gone**, from both the types and the runtime.
   `absoluteFill` is now a frozen plain object, which is what `absoluteFillObject` existed to
   provide, so the seven call sites are a straight rename rather than a shim.
3. **`expo-status-bar` dropped `backgroundColor`.** Android is edge-to-edge from SDK 57: the bar
   is transparent and whatever is behind it shows through. `Screen` already paints the ground
   colour on the view underneath, so removing the prop is not a workaround - it is the
   arrangement the new default assumes.
4. **`@react-navigation/bottom-tabs` is no longer a package we can import.** expo-router 57
   vendors react-navigation instead of depending on it. Rather than reach into
   `expo-router/build/...`, the tab bar's props type is now derived from the `tabBar` prop of the
   `Tabs` component the app already uses - public API, and it will still point at the right shape
   after the next upgrade.

**Three things cleaned up on the way:**

- **`query-string@7` is gone.** It was pinned in M2 only because `@react-navigation/native` 7.4
  dropped it while expo-router 5.1 still imported it. expo-router 57 does not, so a workaround
  that had been carried for four milestones could finally be deleted.
- **One TypeScript for the whole repo.** `expo install --fix` moved the mobile app to 6.0 while
  the root stayed on 5.7; two majors in one workspace is how "works here, fails there" starts.
  The root moved to 6.0 and the mobile pin was removed - `packages/core` and `apps/api` type-check
  clean on it, so there was no reason to hold back.
- **`baseUrl` removed from the mobile tsconfig.** TypeScript 6 deprecates it, and `paths` has
  resolved relative to the tsconfig itself since 4.4 - it was doing the same job twice.
- **`newArchEnabled` and `splash` left `app.json`.** The new architecture is the only
  architecture now, so the flag no longer exists; the splash screen moved into the
  `expo-splash-screen` plugin. `metro.config.js` also dropped `disableHierarchicalLookup`, a
  monorepo workaround that Expo's own config now handles and actively flags.

**Changed files:** `apps/mobile/{package.json,app.json,babel.config.js,metro.config.js,tsconfig.json}`,
`apps/mobile/src/ui/{Screen.tsx,TabBar.tsx,Chip3D.tsx}`,
`apps/mobile/src/features/{auth/FloatingTile.tsx,customer/AfterJobCard.tsx,customer/ConfirmSheet.tsx,provider/BidSheet.tsx,shared/ChatSheet.tsx}`,
`apps/mobile/app/(vendor)/requests.tsx`, `package.json`, `KNOWN_LIMITATIONS.md`.

**Database changes:** none.

**API changes:** none.

**Tests added / passed:** no new tests - this was a runtime move, not a behaviour change. Totals
unchanged: **233/233 API**, **164/164 core**. Type check clean in 3/3 workspaces on TypeScript 6,
lint 0 errors, `migrate:check` OK.

**Manual verification completed:** `expo-doctor` reports **21/21 checks passing** (it found the
two stale config keys and the Metro override, all now fixed), an Android bundle exports cleanly
at 5.4 MB, and typed routes regenerate with every new screen present and no stray entries.

**Known limitations:** the app has **not been run on a physical device since the upgrade**. It
type-checks, lints and bundles, which is not the same thing as working - Reanimated 4's worklet
runtime and Android edge-to-edge insets are the two places a problem would show up first, and
both want a real device rather than a bundle that compiled. That is stated in
`KNOWN_LIMITATIONS.md` rather than implied by a green build.

---

## Closing the feature gap: receipts, growth, a camera and a crew

**Milestone:** post-M9 - everything the product spec asked for that had never been built
**Date:** 2026-09-24
**Status:** Complete

**Why this exists:** a line-by-line review of `PRODUCT_SPEC` against the code found seven things
that were specified and missing. This is all of them except the SDK upgrade, which is its own
entry above.

**Implemented:**

*A receipt.* Section 4 promises "receipts/invoices" and there was none: a customer could see what
they paid inside the app and had nothing to keep, forward or claim against. One is issued the
moment the money is captured, with every figure snapshotted rather than joined at read time - a
receipt states what was charged on a day, and a later correction is a credit note, not a quiet
edit to a document somebody has filed with their accounts. The layout separates the work from
our fee from the tax, because a platform that hides its own fee inside one number is one people
stop trusting the first time they do the arithmetic.

*Saved professionals and rebooking.* "Book again" opens a new job rather than assigning anyone:
the saved professional hears about it first, and the customer still sees every offer. Quietly
assigning them would remove the comparison, which is the thing a marketplace is for. The list
says honestly whether somebody can be asked right now, so the button never promises what will
fail.

*Promo codes*, with one rule running through them: **a discount is the platform's cost, never
the provider's.** A professional is paid exactly what the accepted quote said whatever marketing
we ran, and the `funded_by` column only accepts `PLATFORM` so that stays true. A percentage code
without a ceiling is refused outright - an uncapped percentage is an unbounded liability.

*Referrals* that pay out on completed work rather than on a signup, because rewarding signups is
how a referral programme becomes a fraud programme. Codes are derived from the user id and leave
out 0/O and 1/I, so somebody can read one aloud without spelling it out.

*Feed filters*, on the server. The feed is already trimmed to what a provider is eligible for and
a filter can only narrow that, never widen it. The options are built from what is in that
provider's feed today, each with its count, so nobody taps into a dead end. An empty result says
why: "there is work nearby, but none within 3 km" is a very different message from "there is no
work".

*The camera and the microphone.* The app had been calling the evidence endpoint with fixed
metadata - a photo that did not exist, 180 KB every time. It now opens the camera or the gallery
and sends the real file. Extra work that costs the customer more, and a job marked done, are
exactly the two moments where "there is a photo" has to mean a photo somebody took. A voice note
came with it, because typing a paragraph in a second language on a phone is work and describing
a broken geyser out loud is not; it stops itself at sixty seconds rather than refusing the
recording afterwards.

*The contractor role*, which had a full API behind it and not one screen. Building it corrected a
design I had backwards: I assumed a technician signs in and takes the role themselves, but
`TECHNICIAN` is deliberately not self-service - and that is right. Nobody becomes a technician by
declaring it; a contractor vouches for them. So **adding somebody to a crew is what grants the
role**, and the grant records who did it. The person must already have an account on that number,
which proves they hold the phone a customer will be shown, and they are told the moment it
happens. Added is not verified: a contractor submits documents, staff decide, and the assign
sheet only offers verified people so nobody wastes time picking somebody the server will refuse.

*A language switch* that saves to the account rather than only the device, so an SMS arrives in
the language somebody chose.

**Changed files:** `packages/core/src/{growth/*,bidding/feed-filters*,contracts/{growth,provider}.ts,index.ts}`,
`supabase/migrations/0011_receipts_and_growth.sql`,
`apps/api/src/{modules/{growth,contractor}/*,modules/{negotiation,execution,provider}/*,data/{types.ts,memory/*,postgres/*},app.ts,test/{growth,contractor,security}.test.ts}`,
`apps/mobile/{app/{receipts,favourites,referrals}.tsx,app/invoice/[id].tsx,app/(contractor)/*,app/(customer)/{book,job/[id]}.tsx,app/(provider)/jobs.tsx,app/_layout.tsx,src/api/{growth,contractor,execution,provider}.ts,src/features/{capture/*,provider/FeedFilterSheet.tsx,ProfileScreen.tsx},src/i18n/index.ts}`.

**Database changes:** `0011_receipts_and_growth` - `invoices` (numbered per financial year, delete
revoked), `favourite_providers`, `promo_codes` + `promo_redemptions` (one code per booking),
`referrals` (one referrer per person, nobody refers themselves), plus `discount_paise` and
`promo_code` on `booking_quotes` and a derived `referral_code` on `users`. Forward-only.
`migrate:check` reports 11 valid migrations, and all 11 apply to a real cluster.

**API changes:** `GET /jobs/:id/invoice`, `GET /me/invoices`, `GET /me/favourites`,
`POST|DELETE /providers/:id/favourite`, `POST /jobs/:id/rebook`, `GET /promo/preview`,
`GET /me/referrals`, `POST /me/referrals/claim`, `GET|POST /admin/promos`,
`POST /admin/promos/:id/deactivate`, `GET|PUT /contractor/profile`,
`GET|POST /contractor/technicians`, `DELETE /contractor/technicians/:id`,
`POST /contractor/technicians/:id/kyc`, `GET /contractor/jobs`. `GET /provider/jobs/nearby` gained
filters, facets and an `emptyReason`. `POST /bids/:id/accept` now takes a strict body carrying an
optional `promoCode`.

**Tests added / passed:** 32 new API tests and 32 new core tests. Totals: **233/233 API in memory
mode**, **222/222 against real Postgres** at the point that run was made, **164/164 core**. Type
check clean in 3/3 workspaces, lint 0 errors.

**A bug worth recording:** submitting KYC required a *provider* profile, which a technician does
not have, so a contractor submitting their crew's documents got a 404. The record belongs to the
person, not to a profile; the provider-status bump is now conditional on there being one.
`POST /bids/:id/accept` also became a strict body, so a client sending its own idea of the price
is refused rather than silently ignored - the security test now covers both halves.

**Known limitations:** referral rewards are marked QUALIFIED and both sides are notified, but the
credit itself is applied by support rather than automatically. Promo codes have no admin console
screen, only the API. There is still no provider-initiated reschedule, and the technician role
uses the provider screens rather than having its own.

---

## Reaching people: push, masked calling, and moving a booking

**Milestone:** post-M9 - three things a real app has to do that this one could not
**Date:** 2026-09-23
**Status:** Complete

**Why this exists:** a feature review against `PRODUCT_SPEC` found things that were specified,
half-built, and quietly inert. The push adapter had nowhere to send to, because a device token
was never stored anywhere - so every "notification" lived only inside the app's own list. The
telephony adapter had no route to reach it, so the anti-leakage promise in section 17 was one
the product could not keep. And section 4 says "cancel/**reschedule**"; only cancel existed, so
a customer who could not be home on Tuesday had to throw away the price they had agreed.

**Implemented:**

*Notifications that arrive.* Device tokens are registered on every launch, not only the first,
because the operating system rotates them and a stale token is somebody who quietly stops
hearing from us. Every in-app notification is now also a push - wired at the single point where
notifications are already created, so the whole app was covered by one change. Three categories
can be switched off; money and account alerts deliberately cannot, because finding out a payout
failed by noticing the money never arrived is worse for somebody than an alert they did not ask
for. The settings screen says that out loud rather than leaving anyone to wonder.

A push preview is checked before it leaves. A lock screen is read by whoever is holding the
phone, so a body containing an amount, an address or a phone number is replaced with "Open the
app to see the details".

A token registered on a second account **moves** to it: a resold handset must not keep notifying
the person who sold it.

*Talking without swapping numbers.* `POST /jobs/:id/call` puts the telephony provider's number
in the middle. Neither real number appears in the response, in either direction. Ten calls per
job per day, because somebody ringing twenty times is harassment rather than a connection
problem. The masked line stops working when the job ends - one that kept working would be a leak
with extra steps.

Calling hours (07:00-22:00) turned out to need a rule change while testing: they exist so a
booking three days out cannot be used to ring somebody at 2am, and they have no business applying
to a job already under way. A burst pipe at eleven at night is exactly when two people need to
talk. They also never apply to a job in dispute.

The call is logged - who rang whom, when, how long - because in an argument about what was agreed
on the phone, "there was a call at 4pm" is evidence. What was *said* is not recorded: a recording
is a privacy liability with no consent behind it and no process to handle it.

*Moving a booking instead of losing it.* Two moves per booking, then it has to be cancelled and
made again - which is honest about the fact that the original agreement no longer holds. Nothing
within two hours of a booked slot, because the provider may already be travelling. The provider
who blocked the time is told. Every refusal carries a plain-English sentence alongside its code,
so the app never has to invent wording for a rule it does not own.

**A mistake worth recording:** the first version of these guards used status names I had assumed
rather than checked - `AWAITING_APPROVAL`, `CLOSED`, `CANCELLED`. None exist. Typed as `string`
they compiled perfectly and would have silently never matched: calls refused on live jobs,
rescheduling allowed on finished ones. Typing them as `JobStatus` turned four invisible bugs into
four compiler errors. Every status list in this codebase should be typed, not stringly-typed.

**Changed files:** `packages/core/src/{ops/reach.ts,ops/reach.test.ts,contracts/reach.ts,permissions/permissions.ts,index.ts}`,
`supabase/migrations/0010_delivery_and_reach.sql`,
`apps/api/src/{app.ts,data/types.ts,data/memory/index.ts,data/postgres/index.ts,modules/users/routes.ts,modules/execution/{service,routes}.ts,modules/jobs/{service,routes}.ts,test/reach.test.ts}`,
`apps/mobile/{app/notifications.tsx,app/notification-settings.tsx,app/_layout.tsx,app/(customer)/home.tsx,app/(customer)/job/[id].tsx,src/api/{push,reach}.ts,src/features/customer/ContactAndTimeCard.tsx}`.

**Database changes:** `0010_delivery_and_reach` - `device_tokens` (one row per token, whoever it
belongs to now), `masked_calls` (metadata only, delete revoked), `job_reschedules` (append-only),
the three notification switches on `users`, and `jobs.reschedule_count`. Forward-only.
`migrate:check` reports 10 valid migrations, and all 10 apply to a real cluster.

**API changes:** `POST/GET /me/devices`, `DELETE /me/devices/:id`, `POST /me/notifications/read`,
`GET/PATCH /me/notification-settings`, `POST /jobs/:id/call`, `POST /jobs/:id/reschedule`.
`GET /me/notifications` gained `unread` and a per-item `category`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 17 new API tests and 18 new core tests. Totals: **201/201 API in memory
mode**, **201/201 API against real Postgres**, **147/147 core**. Type check clean in 3/3
workspaces, lint 0 errors, `migrate:check` OK.

**A second real bug, found by the Postgres run:** two customers accepting the same offer at once
gave the loser a 500 - "something went wrong on our side" - instead of 409. The database wins
that race by design, and its constraint violations were not being translated. They are now, in
and out of transactions, so a double-tapped "accept" says "somebody already booked this".

**Known limitations:** the Expo push service and Exotel have still never been called for real, so
in demo mode a push goes nowhere and the masked number is a fixed mock. There is no
provider-initiated reschedule: a provider who cannot make it cancels, which is honest about what
happened. Calling hours use the server clock, which is correct for a one-city pilot and will need
the job's own timezone when that stops being true. The contractor and technician role still has
no mobile app at all - the API supports it fully, which is now stated in `KNOWN_LIMITATIONS.md`
rather than left implied.

---

## Launch readiness: real Postgres, real adapters, and where the money goes

**Milestone:** post-M9 - the first run against a real database, live integrations, and payout accounts
**Date:** 2026-09-23
**Status:** Complete

**Why this exists:** M9 closed with an honest headline - nothing external was live and the SQL
had never been executed. This is the work that turns both of those from a claim into a fact.

**Implemented:**

*The database, for real.* All nine migrations applied to a PostgreSQL 17 cluster and the whole
API suite - 184 tests, unchanged - now passes against it. `makeApp` reads `DATA_MODE` from the
environment and truncates between files, so the same expectations run against either store.

The run found four bugs that memory mode structurally could not:
1. **Every OTP failed.** The insert let the database generate its own `id`, but the OTP hash is
   salted with the id the service made. Nobody could have logged in.
2. **Suspension was impossible.** `users_suspension_needs_two` (M8) demands both the requester
   and the approver, and the service wrote neither, because the memory repo did not mirror that
   trigger. It does now - and the M1 single-admin `POST /admin/users/:id/suspend` is retired: it
   bypassed a rule the database enforces, so it only ever "worked" in memory. It now answers
   with `USE_TWO_PERSON_SUSPENSION` and points at `suspend-approved`.
3. **Ratings and strikes were thrown away.** `upsertProviderProfile`'s `on conflict` clause did
   not update `rating_avg`, `rating_count`, `completed_jobs`, `reliability_score` or
   `strike_count`, so every review silently vanished.
4. **Money came back as text.** `pg` returns `bigint` and `numeric` as strings; amounts and
   ratings are now parsed once, in the store, rather than at every call site.

*Live adapters.* Razorpay (orders, capture, refund, RazorpayX payouts, webhook signatures),
MSG91, Google Maps, Expo Push, Supabase Storage, Sentry and PostHog over their raw endpoints,
and Exotel. Each is selected per provider and **fails loudly at boot without its credentials**
rather than falling back to a mock. Written against the published API shapes, and none has run
against the real thing - that is stated in `KNOWN_LIMITATIONS.md`, not implied.

*Where the money goes.* Reading the RazorpayX documentation exposed a real gap: the rail does not
pay a person, it pays a `fund_account_id`. There was nowhere for a provider or vendor to say
where their money should go, so **every payout would have failed**. Now: `POST /me/payout-account`
(UPI or bank), validated with the same rules the gateway uses, registered with the provider
first - if the rail refuses the details, no row is left behind claiming money can be sent.

**Only the last four digits are stored.** The full account number goes to the payment provider
and nowhere else: not the database, not the logs (`accountNumber`, `ifsc` and `vpa` were added
to the redaction list), and never a response body.

The rule it enforces is deliberately narrow. What is **owed** is always recorded; only **sending**
it needs a verified account. A settlement for someone who has not added their details is written
and parked `ON_HOLD` with `NO_PAYOUT_ACCOUNT`, the payee is told, and adding an account releases
it on the next sweep. My first attempt skipped creating the settlement entirely - a test I had
written to say "hold the money instead of losing it" failed, which was the right answer: money a
payee cannot see is worse than money they can see waiting.

**Changed files:** `packages/core/src/{finance/settlement.ts,finance/finance.test.ts,contracts/finance.ts}`,
`supabase/migrations/0009_payout_accounts.sql`,
`apps/api/src/{adapters/live/*,adapters/{index,types,mocks}.ts,config/env.ts,lib/logger.ts,data/types.ts,data/memory/{index,finance}.ts,data/postgres/{index,finance}.ts,modules/finance/{service,routes}.ts,modules/admin/{service,routes}.ts,test/*}`,
`apps/mobile/{app/payout-account.tsx,app/(provider)/earnings.tsx,app/(vendor)/shop.tsx,src/api/finance.ts}`,
and the documents below.

**Database changes:** `0009_payout_accounts` - `payout_accounts` (method, holder name,
`account_last4` only, IFSC or UPI id, the provider's contact and fund account ids, status), one
active account per person, and `settlements_need_payout_account`, which refuses to let a
settlement reach INITIATED or PAID without one. Forward-only; nothing in 0001-0008 was rewritten.
`migrate:check` reports 9 valid migrations, and all 9 now apply to a real cluster.

**API changes:** `GET /me/payout-account`, `POST /me/payout-account`. `GET /me/earnings` gained
`payoutAccount` and `awaitingPayoutAccountPaise`. `POST /admin/users/:id/suspend` is retired in
favour of `suspend-approved`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 5 new API tests and 3 new core tests. Totals: **184/184 API in memory
mode**, **184/184 API against real Postgres**, **132/132 core**. Type check clean in 3/3
workspaces, lint 0 errors, `migrate:check` OK.

**Manual verification completed:** a local PostgreSQL 17 cluster was created with UTF-8 (the
catalog carries Devanagari, and a Windows-1252 cluster rejects `0001` outright - now documented
in `TEST_PLAN.md`), all nine migrations applied in order, and the full suite run against it.

**Known limitations:** the live adapters have never been executed against the real APIs, so
"implemented" here means written and type-safe, not proven. A payout account is marked VERIFIED
once RazorpayX accepts it - that proves the account exists and is payable, **not** that the name
on it belongs to the payee; a penny-drop check is a separate paid API and is not wired. The
Postgres run is manual and not yet in CI. Still open from M9: no mobile component tests, no load
test, no accessibility audit, Expo SDK 53 needs upgrading before store submission, and the
payments structure still needs professional review.

---

## Milestone 9: Hardening and launch readiness

**Milestone:** M9 - Background work, live updates, the adversarial pass, and an honest final sweep
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core`: the schedule itself (`TASK_SCHEDULE`, `isDue`, `dueTasks`, `isOverrunning`,
  `reconcileDecision`) and a version gate (`compareVersions`, `isUnsupportedVersion`), both pure
  and both tested.
- `apps/api` scheduler: an in-process worker running eight tasks - bid-window expiry, offer
  expiry, material expiry, draft abandonment, the payout run, gateway reconciliation, approval
  chasing and the retention sweep. Each is idempotent and batched, so a missed tick catches up
  and a double run changes nothing; one failing task never stops the queue.
- Reconciliation asks the **gateway**, never the client, and hands a payment still unanswered
  after thirty minutes to support rather than retrying forever. Approval chasing reminds the
  customer and opens a ticket but deliberately never auto-approves: approving on a silence would
  be taking someone's money for them.
- `apps/api` live updates: Server-Sent Events on `/events`. An event carries only *what changed*,
  so the client re-reads the endpoint it already trusts - a delayed, duplicated or missed message
  cannot put a wrong number on screen, and a dropped stream degrades to polling rather than to a
  wrong screen. `POST /events` is a deliberate 403.
- Operational gates: `MIN_APP_VERSION` (426 with the minimum in the body, and no header means no
  block) and `MAINTENANCE_MODE` (503 on writes, reads untouched). `/ready` now reports both,
  plus the scheduler's state and the live-stream count.
- `apps/mobile`: one live connection at the root that marks queries stale; polling intervals
  relaxed from 8-30 seconds to a 60-second fallback for when the stream is not connected.

**Changed files:** `packages/core/src/{ops/schedule.ts,ops/schedule.test.ts,ops/version.ts,index.ts}`,
`apps/api/src/{modules/scheduler/service.ts,modules/events/{service,routes}.ts,modules/execution/service.ts,modules/jobs/service.ts,plugins/auth.ts,lib/logger.ts,config/env.ts,adapters/{types,mocks}.ts,data/types.ts,data/memory/*,data/postgres/*,app.ts,test/{scheduler,security,helpers}.ts}`,
`apps/mobile/src/api/{live.ts,polling.ts,execution,jobs,materials,negotiation,provider,admin}.ts`,
`apps/mobile/app/_layout.tsx`, `.env.example`, and every document.

**Database changes:** none. M9 added no tables: the work was behaviour, not schema.
`migrate:check` still reports 8 valid migrations.

**API changes:** `GET /events`, `GET /admin/scheduler`, `POST /admin/scheduler/run`, plus the
version and maintenance gates on every route and the extra fields on `/ready`. Documented in
`API_REFERENCE.md`.

**Tests added / passed:** 10 new scheduler tests and 21 new adversarial security tests, plus 7
new core unit tests. Totals: **179/179 API**, **129/129 core**. Type check clean in 3/3
workspaces, lint 0 errors, build OK, `migrate:check` OK.

**Manual verification completed:** the scheduler suite drives time rather than waiting for it: a
bid window is backdated and the job auto-cancels with the customer told why, while a job that has
offers is deliberately left alone; a counter-offer is expired and the job falls back to its
standing offers; a three-day-old draft is abandoned while a fresh one is not; a payment is aged
past the give-up window and a support ticket appears; a retention event anonymises a user while
their job history survives. The security suite is written from the attacker's side and was the
most valuable hour of the milestone - see below.

**What the security pass found:** on its first run, `GET /jobs/:id/execution` checked the
*permission* but not *membership*, so any signed-in provider could read another job's execution
panel - the technician's name, the price revisions, the completion notes. The route had a guard
that looked right and was not. It is fixed, covered by a test, and recorded here rather than
quietly patched, because the lesson is the point: a permission check is not an ownership check.

**Known limitations:** nothing external is live, and that is now the headline of
`KNOWN_LIMITATIONS.md` rather than a footnote. The scheduler is in-process, so exactly one node
may run it. The live stream has no cross-node fan-out. The ops report walks the store instead of
querying aggregates. There are no mobile component tests, no load test, no accessibility audit,
and - most significantly - **the Postgres repositories have never been executed**: every suite
runs against the in-memory store that mirrors each SQL constraint by hand. Running the same suite
against a real Postgres is the first thing to do before a pilot.

**Security considerations:** the checklist was audited line by line rather than ticked off. Items
now marked done have a test or a migration behind them; four are marked partial with what is
missing spelled out (RLS policies beyond `0001`, KYC file encryption, an executed restore drill,
and `npm audit` being non-blocking in CI), and two are honestly unbuilt. The one new secret path -
the access token in the stream's query string - is the short-lived token only, never the refresh
token, and the URL is scrubbed in logs by a serializer rather than by dropping the URL entirely.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live. No money has moved, no message has been sent,
no file has been stored.

**Next milestone:** none - M0 to M9 are complete. What comes next is not a milestone but a pilot:
real credentials, the suite re-run against Postgres, an executed restore drill, legal and tax
review of the payment structure, and the final licensed artwork. `KNOWN_LIMITATIONS.md` marks
each remaining item *before launch* or *after pilot*.

---

## Milestone 8: Admin and support console

**Milestone:** M8 - The console: a second factor, KYC review, people, queues, payouts, reports
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` admin rules: a dependency-free TOTP implementation (base32, RFC 6238 dynamic
  truncation, one step of drift, single-use codes via `lastUsedStep`, `otpauthUri`,
  `mfaStillValid`) and the review policy (`checkKycReview`, `kycStatusAfter`, `checkSuspension`,
  `checkAppeal`, `appealReviewerIsDifferent`, `countSlaBreaches`). The TOTP code is verified
  against the RFC's own test vectors.
- `supabase/migrations/0008_admin.sql`: `admin_mfa` (encrypted seed, last used step, failure
  counter, lock), `kyc_access_log` (append-only, UPDATE/DELETE revoked),
  `sessions.mfa_verified_at`, dispute queue columns, and a trigger that refuses a suspension
  without two different people and a 20-character reason.
- `apps/api` admin module: enrolment, enable, verify and status for the second factor; the KYC
  queue, a logged document-open and the review decision; a person's full record; two-person
  suspension; dispute queue moves and appeals; payout retry; and the ops report. Every console
  route goes through one guard that checks staff **and** a second factor no older than 8 hours.
- The TOTP seed is AES-256-GCM encrypted with the server key and returned in plaintext exactly
  once, at enrolment. A code cannot be replayed even inside its drift window, and five wrong
  codes lock the factor for fifteen minutes.
- `ADMIN_MFA_REQUIRED` controls the requirement. The API refuses to boot in production with it
  off, and `/ready` reports it so an operator can see at a glance when it is disabled.
- `apps/mobile`: a console area for staff with three tabs - Disputes (decide, escalate, with the
  second-approver field appearing exactly when the refund crosses the threshold), Verify (queue,
  request the document, approve or send back with a reason) and Money (the ops report, the payout
  run, held payouts with retry). An `MfaGate` wraps every screen and walks an unenrolled admin
  through setup.

**Changed files:** `packages/core/src/{admin/mfa.ts,admin/review.ts,admin/admin.test.ts,contracts/admin.ts,index.ts}`,
`supabase/migrations/0008_admin.sql`,
`apps/api/src/{modules/admin/{service,console}.ts,modules/auth/service.ts,modules/finance/service.ts,config/env.ts,lib/crypto.ts,data/types.ts,data/memory/{index,admin,bids}.ts,data/postgres/{index,admin,bids,finance}.ts,app.ts,test/admin.test.ts}`,
`apps/mobile/src/{api/admin.ts,features/admin/MfaGate.tsx}`,
`apps/mobile/app/(admin)/{_layout,queue,verify,money}.tsx`, `apps/mobile/app/_layout.tsx`,
`.env.example`, docs.

**Database changes:** migration `0008_admin`. `migrate:check` passes with 8 migrations.
Forward-only: `sessions`, `disputes` and `users` gained columns rather than being redefined.

**API changes:** `POST /admin/mfa/setup|enable|verify`, `GET /admin/mfa`, `GET /admin/kyc`,
`POST /admin/kyc/:id/open`, `POST /admin/kyc/:id/review`, `GET /admin/users/:id`,
`POST /admin/users/:id/suspend-approved`, `POST /admin/disputes/:id/move`,
`POST /disputes/:id/appeal`, `POST /admin/settlements/:id/retry`,
`GET /admin/reports/overview`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 13 new API integration tests (`admin.test.ts`) and 15 new core unit
tests. Totals: **148/148 API**, **122/122 core**. Type check clean in 3/3 workspaces, lint 0
errors, API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the suite drives the console the way a shift would. An admin
enrols, is refused with a wrong code, enables the factor, is refused when replaying the enrolment
code, and succeeds with the next one; five wrong codes lock the factor and the lock is reported
rather than silently swallowed. A customer gets 403 on every console route including enrolment.
The KYC queue is checked for what it does *not* contain: the document number `123456789012`
appears nowhere in the queue payload or in the audit log after a decision, the queue carries no
document URL, and the phone number is masked. Requesting the document returns a link and writes
exactly one `kyc_access_log` row naming the reviewer. Approving flips the provider profile from
unverified to VERIFIED. A suspension is refused with one approver, with the actor as approver,
against the actor themselves, and with a non-staff approver; with two staff it suspends the
account and the provider can no longer act. Support sees a masked number on a user record where
an admin sees the full one.

**Known limitations:** there are no MFA recovery codes, so a lost phone currently needs a
database fix. The ops report walks the store rather than querying aggregates - fine at pilot
size, not at scale. An appeal reopens a dispute and clears the assignee, but nothing yet enforces
that the second reviewer differs from the first. Payout failures park for a human but nobody is
alerted. Flagged chat messages and held material orders have no console screen yet. Documents are
not envelope-encrypted and mock storage holds no bytes, so a document link opens nothing in demo
mode. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** the console is the one place where a person can read identity
documents, move money and stop someone earning, so it is gated twice: staff role *and* a second
factor that expires after 8 hours. The factor is real TOTP, verified against the RFC's test
vectors, with single-use codes and a failure lock. The seed is encrypted at rest and shown once.
Reading an identity document is not a side effect of loading a list - it is a separate call that
writes an append-only access log naming the reviewer, and the document number itself is never
stored, never returned and never written to the audit trail. Suspension needs two different staff
and a written reason, in code and in a SQL trigger, and the suspended account keeps its balance.
Nobody may verify their own submission or suspend themselves. Support sees masked numbers where
an admin sees full ones.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M9 - Hardening and launch readiness: scheduled jobs (bid and offer expiry,
settlement runs, gateway reconciliation), realtime instead of polling, the security pass against
`SECURITY_CHECKLIST.md`, load and failure testing, and the final documentation sweep.

---

## Milestone 7: Payments, settlement and disputes

**Milestone:** M7 - Capture, the ledger, settlements, refunds, disputes and reviews
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` finance rules: the ledger builders (`buildCaptureLines`,
  `buildMaterialCaptureLines`, `buildRefundLines`, `buildDisputeHoldLines`,
  `buildSettlementLines`, `isBalanced`, `splitRefund`) and the policy checks
  (`checkCanCapture`, `checkCanSettle`, `checkCanSettleVendor`, `cancellationStage`,
  `checkCanRaiseDispute`, `refundNeedsTwoPeople`, `shouldSuspend`, `checkCanReview`,
  `nextRating`). `splitRefund` puts the rounding on the provider line so a split always adds back
  up to the refund exactly.
- `supabase/migrations/0007_finance.sql`: `ledger_entries` (batched, append-only, UPDATE/DELETE
  revoked), `settlements` (with triggers refusing a payout before completion, during an open
  dispute, or to a vendor without a confirmed order and invoice), `refunds` (trigger capping the
  running total at what was captured), `disputes` (one open per job, a resolution needs a real
  reason, a refund over Rs 5,000 needs a different second approver), `dispute_evidence` and
  `strikes` (both immutable), `reviews` (trigger: finished job, reviewer was on it) and
  `support_tickets`. `payment_status` gained `RELEASED`.
- `apps/api` finance module: capture at approval and at delivery confirmation, settlement
  preparation and the payout run, cancellation with the policy charge, refunds, the dispute
  lifecycle with holds and strikes, reviews, earnings, the per-job money view and the support
  ticket endpoints. Capture is **not** an endpoint: execution and materials hand the money moment
  over through a hook, so no client can ever ask for one.
- Signs in the ledger are from the platform's point of view - positive is received, negative is
  owed - and every event writes one `batch_id` that must sum to zero. The service refuses an
  unbalanced batch rather than writing half of it.
- Refunds are built from what the *ledger* says was captured, not from the payment row. This came
  out of a test: a refund larger than the captured quote produced an unbalanced batch, which the
  balance check caught. Reading the allocation back from the ledger makes the two impossible to
  disagree.
- `apps/mobile`: a real earnings screen (paid / clearing / on hold, every payout with its reason),
  an after-the-job card showing what was actually charged and refunded, a rating sheet and a
  report-a-problem sheet with the dispute categories in plain words, and a cancellation charge
  shown *before* the cancel button is pressed.

**Changed files:** `packages/core/src/{finance/ledger.ts,finance/settlement.ts,finance/finance.test.ts,contracts/finance.ts,contracts/enums.ts,index.ts}`,
`supabase/migrations/0007_finance.sql`,
`apps/api/src/{modules/finance/{service,routes}.ts,modules/execution/service.ts,modules/materials/service.ts,modules/jobs/routes.ts,adapters/{types,mocks}.ts,data/types.ts,data/memory/{index,finance}.ts,data/postgres/{index,finance}.ts,app.ts,test/finance.test.ts,test/execution.test.ts}`,
`apps/mobile/src/{api/finance.ts,features/customer/AfterJobCard.tsx}`,
`apps/mobile/app/(provider)/earnings.tsx`, `apps/mobile/app/(customer)/job/[id].tsx`, docs.

**Database changes:** migration `0007_finance`. `migrate:check` passes with 7 migrations.
Forward-only: nothing in 0001-0006 was touched; `payment_status` gained a value rather than being
redefined.

**API changes:** `GET /jobs/:id/money`, `GET /jobs/:id/cancellation-quote`,
`POST /jobs/:id/cancel-as-provider`, `GET /me/earnings`, `POST /jobs/:id/dispute`,
`GET /jobs/:id/disputes`, `POST /disputes/:id/evidence`, `POST /jobs/:id/review`,
`GET /providers/:id/reviews`, `GET /admin/disputes`, `POST /admin/disputes/:id/resolve`,
`POST /admin/settlements/run`, `GET /admin/settlements`, `POST /admin/jobs/:id/refund`,
`GET /admin/jobs/:id/ledger`, `POST|GET /support/tickets`. `POST /jobs/:id/cancel` now settles
money as well as status. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 18 new API integration tests (`finance.test.ts`) and 18 new core unit
tests. Totals: **135/135 API**, **107/107 core**. Type check clean in 3/3 workspaces, lint 0
errors, API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the suite carries a job from submission to a paid-out
settlement and asserts the numbers at each step rather than trusting the flow. Capture writes
exactly the four lines of the locked quote and the job's ledger nets to zero. A payout is refused
before the 24-hour hold and succeeds after it, for exactly `providerPayablePaise`. Cancelling
before the provider sets off leaves the payment `RELEASED` with nothing captured and nothing
refunded; cancelling after EN_ROUTE captures the visit fee only; cancelling mid-work is refused
and sent to support. A provider cancellation costs the customer nothing and drops the provider's
reliability score with a MAJOR strike. Raising a dispute flips the payment to `DISPUTE_HOLD` and a
settlement run pays nothing even once the hold window has passed. A partial-refund resolution
refunds Rs 200, leaves the ledger netting to zero, and the REFUND line reads -20000. A Rs 6,000
refund is refused without a second approver and accepted with one. Refunds are capped at the
captured amount, across several partial refunds. A review moves the provider's average and cannot
be left twice or on an unfinished job.

**Known limitations:** the gateway is still the mock adapter, so no money moves anywhere -
authorization, capture, refund and payout all succeed by construction. There is no scheduler:
support calls the settlement run. There is no reconciliation poll for a webhook that never
arrives, and no chargeback handling. Disputes are resolved through the API; the console is M8, as
are appeals and payout-failure alerting. The GST treatment is a placeholder that needs a tax
advisor. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** capture cannot be requested by a client at all - it is a server-side
consequence of the customer approving, and the amount always comes from the locked quote, never
from a request body. The ledger has UPDATE and DELETE revoked, so history is corrected with new
entries and never edited; every batch is checked for balance before it is written and refused
outright otherwise. A refund is bounded by the ledger *and* by a SQL trigger, so even a bug in the
service cannot refund more than was taken. Payouts are blocked by an open dispute in SQL as well
as in code, and a suspended account keeps its balance rather than losing it. A refund over
Rs 5,000 needs a second approver who is not the resolver, enforced in both places. The ledger,
the settlement queue and the dispute queue are support-only and a customer asking for them gets a
403. Public reviews carry a first name only.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M8 - Admin and support console: the dispute queue, KYC review, user and
provider management, payout retries, reports and overrides, with two-person approval and MFA on
the admin side.

---

## Milestone 6: Materials and vendors

**Milestone:** M6 - The material leg: requests, vendor quotes, selection, delivery, invoice
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` material rules: `checkMaterialRequest` (only from a job someone is on, never
  from the customer, never when the customer said they would supply the material, one open
  request and max 3 per job), `checkMaterialQuote` (verified and available vendor, whole list
  answered, window open, one quote each), `materialSubtotal` / `materialTotals` (out-of-stock
  lines are never charged for; `vendorPayable = total`), `checkCanSelect`, the material order
  state machine with actor restrictions, `checkInvoice` and `materialQuoteScore`.
- `supabase/migrations/0006_materials.sql`: `material_requests` (one open per job, 1-15 items,
  a trigger that refuses a request raised by the customer or on a job with no active assignment),
  `material_quotes` (one live quote per vendor per list, totals must add up, a trigger that
  refuses an unverified vendor), `material_orders` (bought once, an on-hold order must name the
  issue, and a trigger that refuses an invoice unless the order is CONFIRMED and the amount
  matches to the paisa).
- `apps/api` materials module: the provider's request, the vendor feed (area and distance only,
  never the address), quoting, the customer's ranked quote list, selection in one transaction,
  fulfilment, delivery confirmation with a mismatch path, and the invoice. Plus
  `GET /vendor/profile` and `POST /vendor/availability` so a closed shop stops receiving requests
  (MAT-10).
- Selection creates a **separate `MATERIAL` authorization**; the labour hold is untouched and the
  vendor is only asked to prepare once that authorization lands. The booking webhook now hands a
  non-booking leg back to its owner through `onSideLegSettled` instead of moving the job.
- `apps/mobile`: a new vendor area (`Requests`, `Orders`, `Shop` tabs) with a per-line price sheet
  that has an in-stock switch and shows the customer total live; the customer's material panel
  with the ranked quotes, the transparent line-by-line split, authorization and the
  received / something's-wrong buttons; and a "Need materials" form on the provider's job runner.

**Changed files:** `packages/core/src/{materials/materials.ts,materials/materials.test.ts,contracts/materials.ts,index.ts}`,
`supabase/migrations/0006_materials.sql`,
`apps/api/src/{modules/materials/{service,routes}.ts,modules/negotiation/service.ts,data/types.ts,data/memory/{index,materials}.ts,data/postgres/{index,materials}.ts,app.ts,test/materials.test.ts}`,
`apps/mobile/src/{api/materials.ts,features/customer/MaterialPanel.tsx,features/provider/MaterialRequestForm.tsx,features/provider/JobRunner.tsx}`,
`apps/mobile/app/(vendor)/{_layout,requests,orders,shop}.tsx`, `apps/mobile/app/_layout.tsx`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/src/i18n/index.ts`, docs.

**Database changes:** migration `0006_materials`. `migrate:check` passes with 6 migrations.
Forward-only: nothing in 0001-0005 was touched.

**API changes:** `POST /jobs/:id/material-request`, `GET /jobs/:id/materials`,
`GET /vendor/profile`, `POST /vendor/availability`, `GET /vendor/material-requests`,
`POST /material-requests/:id/quote`, `GET /vendor/material-orders`,
`POST /material-quotes/:id/select`, `POST /material-orders/:id/status`,
`POST /material-orders/:id/confirm`, `POST /material-orders/:id/invoice`. Documented in
`API_REFERENCE.md`.

**Tests added / passed:** 16 new API integration tests (`materials.test.ts`) and 14 new core unit
tests. Totals: **117/117 API**, **89/89 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the suite runs the whole leg against a job that is genuinely
under way - submitted, quoted, accepted, authorized, started with the code - then a request for
two items, a vendor quote of Rs 390 plus Rs 40 delivery, a second dearer quote, selection,
authorization, out for delivery, delivered, confirmed and invoiced. The claims that matter are
asserted rather than assumed: the vendor feed contains the area but not the street address, the
labour quote total is re-read after selection and is unchanged, the order sits at PENDING_PAYMENT
until the material authorization lands and only then becomes PREPARING, the job itself stays
IN_PROGRESS throughout, a second selection is refused, an expired quote is refused, a partial or
duplicate quote is refused, an unverified vendor is refused and told why, a reported mismatch
parks the order at ON_HOLD where it cannot be invoiced, and an invoice that is Rs 1 off is refused
with the order total in the error.

**Known limitations:** the vendor app has no invoice upload screen yet, so the endpoint is
exercised by tests rather than by a person. A held order can only be released by an admin and
there is no admin screen until M8. Substitution (MAT-05) is not built: a vendor quotes the list as
given. Photos everywhere are still fixed metadata rather than camera captures because mock storage
has nowhere to put bytes. Vendor payouts are M7 - a confirmed order with a matching invoice is the
evidence a payout will need, but nothing is settled yet. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** the vendor feed exposes the item list, the area and a distance, and
nothing else - no address, no phone, no customer name, and a test greps the payload to prove it.
Only a verified vendor may quote, in SQL as well as in code. Selection re-reads the quote inside
the transaction and the partial unique index makes a double order impossible; the same transaction
rejects every other quote so a stale price cannot be revived. Material money never touches the
labour hold, and the vendor is asked to spend money on stock only after the authorization exists.
Delivery confirmation is a record, so a mismatch parks the order rather than accepting it, and an
invoice must match the order exactly - the payout evidence cannot be inflated after the fact. The
new decision D-013 records that the platform takes no margin on materials, so the price the
customer sees is the shop's price.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M7 - Payments, settlement and disputes: capture on approval, the append-only
ledger, provider and vendor settlements, refunds and cancellation charges, the dispute flow and
reviews.

---

## Milestone 5: Execution and completion

**Milestone:** M5 - Doorstep to done: arrival, the start code, price revisions, completion
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core` execution rules: `checkCanStart` (ARRIVED only, spent/expired/locked codes),
  `checkCanOverrideStart` (admin or support, reason of 10+ characters), `checkRevisionRequest`
  (one open at a time, max 3 per job, explanation and evidence required), `revisionNeedsSupport`
  (a jump past 1.5x the locked total is routed to support, not a one-tap approval),
  `checkCompletion`, `mediaPhaseFor` and `flagChatMessage`.
- `supabase/migrations/0005_execution.sql`: `start_otps` (one per job, attempt-capped, an override
  must carry a reason), `price_revision_requests` (one open per job, must add something and must
  cost more than the locked quote, plus a trigger that refuses a revision raised by the customer or
  answered by anyone but the customer), `job_completions` (evidence required), `chat_threads` and
  `chat_messages` (participants-only trigger, DELETE revoked, an immutability trigger so only the
  read receipt can ever change).
- `apps/api` execution module: technician handoff (verified, and only the provider's own people),
  EN_ROUTE/ARRIVED, start-code verification in constant time with the attempt counter, the admin
  override, price-revision request and response, completion and customer approval, the shared
  execution panel, phase-derived evidence upload, and in-job chat.
- The start code is never stored in plaintext: only its HMAC is kept, and the four digits are
  re-derived from the server secret plus the row's id, so the customer's app can show it again
  while a database dump alone yields nothing.
- Approving a revision supersedes the locked quote inside one transaction and opens a **separate**
  `PRICE_REVISION` authorization for the difference. The original hold is never silently increased,
  and a rejection leaves the original quote byte-for-byte unchanged.
- `apps/mobile`: the customer's live panel (start code, technician with a masked number, the
  approve/decline card for extra work with the full before/after split, the completion sign-off),
  the provider's job runner (on my way, arrived, start-code entry with attempts left, extra-work
  request, mark done), and a shared chat sheet that shows the off-platform flag inline.

**Changed files:** `packages/core/src/{execution/execution.ts,execution/execution.test.ts,contracts/execution.ts,index.ts}`,
`supabase/migrations/0005_execution.sql`,
`apps/api/src/{modules/execution/{service,routes}.ts,modules/jobs/service.ts,data/types.ts,data/memory/{index,execution}.ts,data/postgres/{index,execution}.ts,data/seed.ts,lib/crypto.ts,app.ts,test/execution.test.ts}`,
`apps/mobile/src/{api/execution.ts,features/customer/LiveJobPanel.tsx,features/provider/JobRunner.tsx,features/shared/ChatSheet.tsx}`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/app/(provider)/active.tsx`, docs.

**Database changes:** migration `0005_execution`. `migrate:check` passes with 5 migrations.
Forward-only: nothing in 0001-0004 was touched. `technician_profiles` (created back in 0001) got
its first repository methods.

**API changes:** `POST /jobs/:id/technician`, `POST /jobs/:id/progress`, `POST /jobs/:id/start`,
`GET /jobs/:id/execution`, `POST /jobs/:id/evidence`, `POST /jobs/:id/price-revision`,
`POST /price-revisions/:id/respond`, `POST /jobs/:id/complete`, `POST /jobs/:id/approve`,
`GET|POST /jobs/:id/chat`. Documented in `API_REFERENCE.md`.

**Tests added / passed:** 20 new API integration tests (`execution.test.ts`) and 12 new core unit
tests. Totals: **101/101 API**, **75/75 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the integration suite drives the whole milestone end to end:
a job is taken from submission through offer, acceptance and authorization, then
`PROVIDER_ASSIGNED -> EN_ROUTE -> ARRIVED -> STARTED -> IN_PROGRESS`, a price revision is raised
with evidence, approved, and the quote and the extra authorization are re-read to prove the numbers
moved together, then completion is submitted and approved to `COMPLETED`. The privacy and safety
claims are asserted rather than assumed: the provider's own view of the panel returns
`startCode: null`, a second provider holding the correct code gets a 403, five wrong codes lock the
job in ARRIVED, a provider override is refused while an admin override with a reason succeeds and
is flagged on the job, and a stranger cannot read the chat.

**Known limitations:** the mobile evidence flow sends fixed image metadata instead of opening the
camera, because mock storage has nowhere to put the bytes. Chat flags are recorded but nothing
reviews them. There is no start-code resend, no chase or auto-approval when a customer ignores a
finished job, and masked calling still cannot place a call. Capture, settlement and refunds remain
M7 - approving completion moves the job to COMPLETED and releases nothing. Full list in
`KNOWN_LIMITATIONS.md`.

**Security considerations:** the start code exists only as an HMAC plus a derivation from the
server secret, is shown exclusively to the customer, is compared in constant time, and is spent on
first use; every wrong attempt is counted and analytics-tracked. The code never enters the audit
log - only the fact of the start does. An admin override cannot be silent: it needs a reason, is
stored on the row, and surfaces as `startWasOverridden` in both parties' views so a later
settlement can weigh it. Media phase is derived from the job's status, never chosen by the caller,
so a provider cannot backdate "completion" evidence onto a job that has not started. Chat is
participants-only in SQL as well as in code, messages are immutable, and contact details are
flagged rather than silently dropped. The customer's view of a technician carries a masked number.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M6 - Materials and vendors: material requests, vendor quotes, selection,
delivery confirmation and invoices, with the material leg priced and approved separately from
labour.

---

## Milestone 4: Negotiation and confirmation

**Milestone:** M4 - Negotiation, quote lock, acceptance and payment authorization
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core`: a negotiation module (20-minute counter-offer TTL, a hard limit of 6 rounds per
  job, `checkCanRespond` / `checkCanAccept`, counterparty resolution) and the contracts for
  counter-offers, offer chains, the locked booking quote, the assignment and the payment view.
  `OFFER_STATUSES` gained `SUPERSEDED` so a sender replacing their own pending offer is a distinct,
  readable state rather than a cancellation.
- `supabase/migrations/0004_negotiation.sql`: `offers` (unique partial: one PENDING offer per bid),
  `booking_quotes` (unique partial: one ACTIVE quote per job), `job_assignments` (one ACTIVE
  assignment per job + a trigger refusing an unverified technician), `payments` (unique
  `idempotency_key`, unique partial so a job can never carry two live booking payments) and
  `payment_events` (unique `provider_event_id`, UPDATE/DELETE revoked).
- `apps/api` negotiation module: `counter`, `respond` (ACCEPT / REJECT / COUNTER), `accept` and
  `applyPaymentEvent`. Acceptance is a single transaction that re-reads the bid and the job inside
  the lock, freezes a `booking_quote`, marks every other offer INACTIVE, cancels pending
  counter-offers, creates the assignment and the payment order, and walks the job
  `PAYMENT_PENDING -> CONFIRMED -> PROVIDER_ASSIGNED` as authorization lands. Two concurrent
  acceptances give exactly one 200 and one 409.
- Payments: a deterministic mock gateway plus a signed webhook whose HMAC is verified **before**
  the body is parsed. Replays are a no-op via `provider_event_id`, an amount mismatch is refused and
  recorded, and a failed authorization releases the booking back to `BID_RECEIVED` so the other
  offers become live again.
- `apps/mobile`: the customer offers list now accepts and counters; `ConfirmSheet` runs
  review -> authorize -> "Booking confirmed" with the exact frozen price; `BookingCard` shows the
  locked quote, who is coming and what is still owed; the provider gets a counter-offer card on the
  My offers tab with decline / meet-halfway / accept.
- Fixed an opaque 400: a request with `content-type: application/json` and an empty body is now
  parsed as `{}` instead of failing in the JSON parser.

**Changed files:** `packages/core/src/{bidding/negotiation.ts,bidding/negotiation.test.ts,contracts/negotiation.ts,contracts/enums.ts,index.ts}`,
`supabase/migrations/0004_negotiation.sql`,
`apps/api/src/{app.ts,modules/negotiation/{service,routes}.ts,data/types.ts,data/memory/{index,negotiation}.ts,data/postgres/{index,negotiation}.ts,test/negotiation.test.ts}`,
`apps/mobile/src/{api/negotiation.ts,features/customer/{OffersList,ConfirmSheet,BookingCard}.tsx,features/provider/CounterOfferCard.tsx}`,
`apps/mobile/app/(customer)/job/[id].tsx`, `apps/mobile/app/(provider)/active.tsx`, docs.

**Database changes:** migration `0004_negotiation` (offers, booking_quotes, job_assignments,
payments, payment_events). `migrate:check` passes with 4 migrations. Forward-only: nothing in
0001-0003 was touched.

**API changes:** `POST /jobs/:id/counter-offer`, `POST /offers/:id/respond`,
`GET /jobs/:id/offer-chain`, `POST /bids/:id/accept`, `GET /jobs/:id/booking`,
`POST /payments/:id/mock-complete` (mock mode only, owner only), `POST /payments/webhook`.
Documented in `API_REFERENCE.md`.

**Tests added / passed:** 17 new API integration tests (`negotiation.test.ts`) and 10 new core unit
tests. Totals: **81/81 API**, **63/63 core**. Type check clean in 3/3 workspaces, lint 0 errors,
API bundle + Expo web export build OK, `migrate:check` OK.

**Manual verification completed:** the whole loop was run twice. Through the API: submit -> bid ->
customer counters Rs 600 -> provider counters Rs 700 -> customer accepts -> quote locked at
Rs 847.20 (labour Rs 700) -> payment authorized -> job PROVIDER_ASSIGNED, with the trail
`DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS -> BID_RECEIVED -> NEGOTIATING ->
PAYMENT_PENDING -> CONFIRMED -> PROVIDER_ASSIGNED`. Through the app (in-app browser, 390x844,
demo customer +919000000001): a job with two competing offers showed the ranked list with the
transparent split (Rs 794.25 all-in vs Rs 550.68), accept opened `ConfirmSheet` with the identical
breakdown, authorize flipped the card to "Confirmed / Authorized / Price locked", the offers list
disappeared, the timeline gained "Offer accepted / Payment authorized / Provider assigned", and
every request returned 200 with no console errors.

**Known limitations:** the payment gateway is **mocked** - the booking flow is real end to end but
no money moves; capture, settlement and refunds arrive in M7. Counter-offer and bid-window expiry
are checked on read but nothing sweeps them in the background (M9). The app polls rather than using
realtime. Postgres repositories are written but the suite still runs in memory mode. Full list in
`KNOWN_LIMITATIONS.md`.

**Security considerations:** the webhook signature is verified before the payload is parsed, so an
unsigned body is never deserialized; `provider_event_id` makes replays idempotent and an amount
mismatch is refused rather than trusted. `mock-complete` exists only when `PAYMENT_PROVIDER=mock`
and only for the payment's own payer. Acceptance is guarded three times - in shared code, again
inside the transaction after re-reading the row, and by partial unique indexes in SQL - so a race
cannot double-book a job. The offer chain and booking views expose business name, verified badge,
distance and price only: never the provider's phone number, address or documents. The word
"escrow" is used nowhere; the flow is authorization -> hold -> settlement.

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage,
telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M5 - Execution and completion: technician assignment, EN_ROUTE/ARRIVED,
the 4-digit start OTP, price-revision requests with customer approval, completion proof, customer
approval, and in-job chat.

---

## Milestone 3: Provider workflow

**Milestone:** M3 - Provider workflow
**Date:** 2026-09-23
**Status:** Complete

**Implemented:**
- `packages/core`: contracts for the provider profile, KYC submission, the nearby feed item, and
  bids/offers. The bidding rules (windows, eligibility, validation, non-price-only ranking) were
  already written in M1 and are now wired up for real.
- `supabase/migrations/0003_bidding.sql`: `kyc_records` (one open submission per document type),
  `bids` (one live offer per provider per job, revisions capped at two, labour or visit fee must be
  positive) and `bid_revisions` (every price ever offered). Triggers refuse an offer from a provider
  who is not active and verified, and refuse an offer on a job that is not accepting them.
- `apps/api` provider module: profile update with base location and skills, availability toggle
  that refuses to switch on before verification, KYC submission that stores only the last four
  characters of a document number, an eligibility-filtered nearby feed that exposes distance and
  area but never the address, bid place/revise/withdraw, the provider's own offer list, and the
  customer-facing ranked offer list.
- `apps/mobile`: provider Jobs tab (availability switch, verification banner, live offer-window
  countdown per job, blocker-aware empty states), a quick-bid sheet with a live fee breakdown
  showing exactly what the customer pays and what the provider receives, the My offers tab with
  withdraw, a provider profile screen (verification, document submission, radius, skills), and an
  offers card on the customer's job screen with the transparent split and a best-match badge.
- Demo seed now gives demo providers their skills so the nearby feed works out of the box.

**Changed files:** `packages/core/src/{contracts/provider.ts,index.ts}`,
`supabase/migrations/0003_bidding.sql`,
`apps/api/src/{data/types.ts,data/memory/{index,jobs,bids}.ts,data/postgres/{index,jobs,bids}.ts,modules/provider/{service,routes}.ts,app.ts,data/seed.ts,test/provider.test.ts}`,
`apps/mobile/src/{api/{provider.ts,client.ts},features/provider/BidSheet.tsx,features/customer/OffersList.tsx}`,
`apps/mobile/app/(provider)/{jobs,active,profile}.tsx`, `apps/mobile/app/(customer)/job/[id].tsx`, docs.

**Database changes:** migration `0003_bidding`. `migrate:check` passes with 3 migrations.

**API changes:** `GET/PUT /provider/profile`, `POST /provider/availability`, `POST /provider/kyc`,
`GET /provider/jobs/nearby`, `POST /jobs/:id/bids`, `POST /bids/:id/revise`,
`POST /bids/:id/withdraw`, `GET /provider/bids`, `GET /jobs/:id/offers`. See `API_REFERENCE.md`.

**Tests added:** 21 integration tests - unverified provider cannot go available and is told why;
profile, skills and base location persist; KYC stores only the last four characters and the number
never reaches the response or the audit log; duplicate KYC refused; feed shows an in-radius matching
job and hides the street address; feed hides other categories and out-of-radius jobs; empty feed
returns blockers; a customer cannot read the provider feed; placing an offer moves the job to
BID_RECEIVED and notifies the customer; duplicate live offer refused; unverified and
category-mismatched offers refused; terms validated; offers refused on a cancelled job; two
revisions allowed and the third refused; withdraw frees the provider to bid again and cannot be
repeated; provider offer list carries job context; ranking does not simply pick the cheapest;
cross-customer and cross-provider access refused; a customer cannot place an offer.

**Tests passed:** 117/117 (53 unit + 64 integration). Type check clean across 3 workspaces.
Lint clean. Migration check OK.

**Manual verification completed:** seeded an open plumbing job through the API, then in the browser
at 390x844 signed in as the demo provider - the Jobs tab showed the job at 1.4 km with a live 28:43
window, the bid sheet computed labour 650, platform fee 32.50, tax 5.85, customer pays 688.35 and
"you receive 650", and sending it flipped the card to "1 offer so far - 650 - Edit". Signing back in
as the customer, the job showed "Offers received", the milestone timeline advanced, and the offer
card rendered with the verified badge, 4.7 stars, 120 jobs, 1.4 km, the split and a BEST MATCH
badge. The API confirmed the offer payload contains no phone number.

**A bug the tests caught:** a provider could place an offer on a cancelled job. The SQL trigger
blocked it in Postgres but the service did not, so the memory store accepted it. The service now
checks the job status before anything else, mirroring `bids_require_open_job`.

**Known limitations:** nothing flips a provider to VERIFIED yet - the admin review queue is M8, so
tests and the demo seed set it directly; KYC document bytes are not stored (mock storage); accepting
an offer is M4, so the accept button is deliberately disabled; nothing expires the bid window in the
background yet. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** eligibility is re-checked on every bid, not just when building the
feed, so a provider cannot quote on something they were never shown; the feed and the offer list
expose distance and area but never the address, phone number or media; offer ownership is enforced
on revise and withdraw; a customer cannot place an offer and a provider cannot create a job; the
KYC document number is never stored, returned or logged (asserted by a test that greps the audit
log); bids from suspended or unverified providers are refused in both the service and SQL.

**External integrations mocked or live:** ALL MOCKED - storage (KYC and job media), SMS, payment,
maps, push, telephony, monitoring, analytics.

**Next milestone:** M4 - Negotiation and confirmation (counter-offers, offer expiry, quote locking,
the single-winner acceptance transaction, and payment authorization through the mock gateway).

---

## Milestone 2: Customer job flow

**Milestone:** M2 - Customer job flow
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- `packages/core`: job rules module - media limits (8 photos, 1 voice note capped at 60 s, size and
  mime allow-lists), submission readiness checks, prohibited-request blocklist kept separate from
  safety-hazard detection (hazards warn, they never block), duplicate-request detection, and the
  zod contracts for every job payload and view.
- `supabase/migrations/0002_jobs.sql`: `jobs`, `job_media`, `job_status_events` with job/payment
  status enums, a partial unique index giving one live draft per category+address, a hash index
  that turns a retried upload into a no-op, an append-only status trail, and triggers that refuse
  to let a job leave DRAFT without an address plus a description or media, and that refuse request
  media once the job has moved on.
- `apps/api` jobs module: a single `transition()` that validates the state machine, re-reads the
  row inside the transaction and writes the status event atomically; draft create/resume, draft
  edit, media upload targets, submit (DRAFT -> SUBMITTED -> QUALIFYING -> OPEN_FOR_BIDS with the
  bid window and tracking token), cancel, customer list with active/past scopes, and a deliberately
  minimal public `/track/:token` view.
- `apps/mobile`: booking flow (category strip, description, photos via expo-image-picker, urgent and
  materials toggles, time slot, address picker with out-of-zone guard, sticky CTA above the tab bar,
  staggered entrance animations, inline hazard warnings); job status screen with a live bid-window
  countdown, milestone timeline, request summary, activity trail, share-tracking and cancel; bookings
  list wired to the API with active/past tabs and live status pills; home categories open the flow.

**Changed files:** `packages/core/src/{jobs/job-rules.ts,jobs/job-rules.test.ts,contracts/jobs.ts,index.ts}`,
`supabase/migrations/0002_jobs.sql`, `apps/api/src/{data/types.ts,data/memory/{index,jobs}.ts,data/postgres/{index,jobs}.ts,modules/jobs/{service,routes}.ts,app.ts,test/{jobs.test.ts,helpers.ts}}`,
`apps/mobile/{src/api/jobs.ts,app/(customer)/{book.tsx,bookings.tsx,home.tsx,job/[id].tsx}}`, docs.

**Database changes:** migration `0002_jobs` (see above). `migrate:check` passes with 2 migrations.

**API changes:** `POST /jobs`, `PATCH /jobs/:id`, `GET /jobs/:id`, `GET /me/jobs`,
`POST /jobs/:id/media`, `DELETE /jobs/:id/media/:mediaId`, `POST /jobs/:id/submit`,
`POST /jobs/:id/cancel`, `GET /track/:token`. Documented in `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 15 new): media mime/size/duration/count limits, submission blockers, clock-skew
  tolerance on the preferred start, prohibited vs hazard wording, duplicate window.
- Integration (api, 24 new): draft create with status trail, draft resume, disabled category,
  address ownership, hazard flagging, upload targets and every media limit, retried upload dedupe,
  media delete, full submit walk with a 30-minute window, 10-minute urgent window, wordless job
  with a photo, out-of-zone refusal, prohibited request, duplicate warning, double-submit rejection,
  post-submit lock, active/past listing, cancel with mandatory reason, public tracking link leaking
  nothing sensitive, and five cross-user/role/suspension security checks.

**Tests passed:** 96/96 (53 unit + 43 integration). Type check clean across 3 workspaces. Lint clean.
Migration check OK.

**Manual verification completed:** ran the API and the app in the in-app browser at 390x844 - logged
in as the seeded customer, opened the booking flow from the Plumbing tile, described the problem and
submitted. Server log shows `POST /jobs 201` -> `POST /jobs/:id/submit 200` -> `GET /jobs/:id 200`;
the app landed on the status screen with the live countdown at 29:41, the milestone timeline at
"Finding providers", and the booking appeared under the Bookings > Active tab.

**Known limitations:** voice-note recording is not in the app yet (the API accepts and validates
voice notes); media bytes are not stored because the storage adapter is mocked, so photo thumbnails
fall back to an icon; auto-cancel when a bid window expires is not scheduled yet (the helper exists);
provider-side job feed arrives in M3. Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** every job route re-checks ownership against the signed-in user (five
tests cover cross-user access); a provider cannot create a customer job; a suspended customer keeps
read access to history but cannot create anything; the public tracking link exposes no address,
phone number or media; status changes only happen through the guarded transition, which is also
enforced by SQL triggers; media is validated server-side before any storage target is issued.
The test helper now gives each test user its own IP so the per-IP OTP limit stays active in tests
rather than being loosened.

**External integrations mocked or live:** ALL MOCKED - storage returns fake signed URLs and skips
the byte transfer; SMS, payment, maps, push, telephony, monitoring and analytics unchanged.

**Next milestone:** M3 - Provider workflow (provider profile and verification status, service
radius, nearby job feed with eligibility filtering, bid creation and revisions, provider active jobs).

---

## Milestone 1: Foundation

**Milestone:** M1 - Foundation
**Date:** 2026-09-22
**Status:** Complete

**Implemented:**
- npm-workspaces monorepo: `packages/core` (domain rules + zod contracts), `apps/api` (Fastify), `apps/mobile` (Expo SDK 53 + expo-router 5).
- `packages/core`: job state machine (all 24 statuses, actor-restricted edges, terminal guards), integer-paise pricing with fee/tax/cancellation/refund math, bid window + eligibility + validation + non-price-only ranking, permission matrix (41 actions x 7 roles, high-risk set), haversine/geohash/pilot-zone helpers, OTP policy helpers, Indian phone normalisation, en/hi shared strings.
- `apps/api`: zod-validated env with production guard against mock adapters; adapter interfaces + deterministic mocks for SMS, maps, push, storage, payment, telephony, monitoring, analytics; repository abstraction with `memory` and `postgres` implementations; OTP auth (HMAC-hashed codes, 5 attempts, 5/hour, 60 s resend cooldown, IP limit), JWT access + rotating refresh sessions, revoke single/all; `/me` (profile, roles, consents), self-service role grant with profile bootstrap, consents, deletion scheduling with retention event, notifications feed; addresses with geocoding + pilot-zone flag + ownership checks; localised categories; admin user search (masked for support), suspend/reactivate with mandatory reason, audit-log viewer; global rate limit, per-route OTP limits, `Idempotency-Key` replay, request ids, PII-redacting logger, plain-language localised error envelope, `/health` + `/ready` (lists mocked adapters); demo seed (8 accounts).
- `apps/mobile`: design tokens derived from the user's reference screenshot (mint ground, deep-teal primary/gradient, white rounded cards, pastel icon chips, floating pill tab bar); UI kit (Text, Button, Card, TextField, IconChip, IconButton, Badge, Avatar, SectionHeader, Dots, Skeleton, EmptyState, ErrorState, OfflineBanner, Screen, FloatingTabBar); typed API client with refresh-on-401 and error mapping; zustand session (SecureStore) + NetInfo store; en/hi i18n; AuthGate routing (auth -> role picker -> role tabs); screens: phone, OTP (6-box, auto-submit, resend timer, demo-code badge), role picker, customer Home (matches reference), Bookings/Messages empty states, Profile (roles, role switch, language toggle, sign out), provider Jobs/Active/Earnings/Profile with verification badge and empty states; global error boundary.
- Tooling: ESLint flat config, Prettier, CI workflow, migration checker, esbuild API bundle, Dockerfile.

**Changed files:** all files under `packages/core/src`, `apps/api/src`, `apps/mobile/{app,src}`, `supabase/migrations/0001_foundation.sql`, root configs, all 18 documentation files.

**Database changes:** `0001_foundation.sql` - enums, users, user_roles, otp_challenges, sessions, customer/provider/contractor/technician/vendor profiles, addresses, service_categories, service_skills, provider_skills, consents, audit_logs (append-only grants), notifications, retention_events, idempotency_keys; RLS enabled on all tables; category/skill seed rows.

**API changes:** `/health`, `/ready`, `/auth/request-otp|verify-otp|refresh|logout`, `/me` (GET/PATCH/DELETE), `/me/roles`, `/me/consents`, `/me/notifications`, `/me/addresses` (CRUD), `/categories`, `/admin/users`, `/admin/users/:id/suspend|reactivate`, `/admin/audit-logs`. See `API_REFERENCE.md`.

**Tests added:**
- Unit (core, 38): state machine happy path/invalid/actor/terminal, pricing breakdown/min fee/revisions/rounding/cancellation/refund/format, bid windows/eligibility/validation/expiry/ranking, permissions matrix, geo, OTP/phone helpers.
- Integration (api, 19): ready reports mocks; signup; invalid phone; wrong-code attempts + lock; OTP reuse blocked; resend cooldown; refresh rotation + replay rejection; tampered token; logout-all; Hindi error localisation; self-service vs privileged roles; provider profile bootstrap; address create/geocode/pilot-zone/default/cross-user 403/validation; role-gated address access; idempotency replay + key reuse across routes; support masked search; support cannot suspend; reason mandatory; suspension revokes sessions, blocks actions, keeps read access; audit entries with actor/reason; support cannot read audit; admin cannot self-suspend; consents + deletion scheduling; categories localisation.

**Tests passed:** 57/57 (`npm test`). Type check: 3/3 workspaces clean. Lint: 0 errors. Build: API bundle + Expo web export OK. Migration check: OK.

**Manual verification completed:** API booted in demo mode (`/ready` lists 8 mocked adapters); mobile web run in the in-app browser at 420x880: phone -> OTP auto-submit -> seeded customer Home renders categories from the API; Profile tab; Hindi toggle persists via `PATCH /me` and re-renders every string; viewport reset afterwards.

**Known limitations:** every external adapter is mocked; Postgres repository written but not yet exercised by the suite (memory mode only); realtime not started; no mobile component tests yet (M2); `query-string` pinned in mobile because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it; hero illustration is an icon placeholder until the final design supplies artwork; category tiles show only the 3 enabled categories (appliance repair disabled per spec). Full list in `KNOWN_LIMITATIONS.md`.

**Security considerations:** OTP codes stored as HMAC (server secret) and compared in constant time; refresh tokens stored hashed and single-use; suspended users authenticate read-only, all mutations 403; roles re-read per request so revocation is immediate; admin actions need `reason` and write immutable audit rows; logger redacts phone/OTP/tokens; production boot refuses mock SMS/payment and non-Postgres data mode; no secrets in mobile bundle. Open items: admin MFA, KYC encryption, two-person approval (M8).

**External integrations mocked or live:** ALL MOCKED - SMS, payment, maps, push, storage, telephony, monitoring, analytics. Nothing is live.

**Next milestone:** M2 - Customer job flow (job creation with media/voice upload, submission, status timeline, `0002_jobs` migration, Postgres-mode integration run).

---

## Milestone 0: Repository and architecture

**Milestone:** M0
**Date:** 2026-09-22
**Status:** Complete

**Implemented:** cloned empty `Aadharbindal/Hyperlocal_Marketplace`; created all 18 required documents (README, PRODUCT_SPEC, ARCHITECTURE, DECISIONS D-001..D-010, KNOWN_LIMITATIONS, SECURITY_CHECKLIST, PRIVACY_DATA_MAP, PAYMENT_FLOW, DISPUTE_POLICY, EDGE_CASE_MATRIX with 150+ scenarios across 13 areas, TEST_PLAN, INCIDENT_RESPONSE, IMPLEMENTATION_PLAN, PROGRESS_LOG, API_REFERENCE, DATABASE_SCHEMA, DEPLOYMENT, ENVIRONMENT_VARIABLES); `.env.example` with placeholder names only; `.gitignore`, editor/prettier/eslint configs; CI workflow; migration checker; stack confirmed (Expo + Fastify + Postgres/Supabase, modular monolith, adapters with mocks).

**Changed files:** root `*.md`, `.env.example`, `.gitignore`, `.editorconfig`, `.prettierrc`, `eslint.config.mjs`, `package.json`, `tsconfig.base.json`, `.github/workflows/ci.yml`, `scripts/check-migrations.mjs`.
**Database changes:** none (schema designed in `DATABASE_SCHEMA.md`).
**API changes:** none (contracts designed in `API_REFERENCE.md`).
**Tests added / passed:** n/a.
**Manual verification completed:** documentation cross-links reviewed.
**Known limitations:** brand name placeholder (D-001).
**Security considerations:** secrets policy established; checklist created.
**External integrations mocked or live:** none yet.
**Next milestone:** M1 - Foundation.
