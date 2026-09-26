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
