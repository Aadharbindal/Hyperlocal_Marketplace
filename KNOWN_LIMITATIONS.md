# Known Limitations

Updated every milestone, and swept line by line at the end of M9. **Nothing external is live.**
Each row names the production replacement and who owns it next: *before launch* means a real
customer would be affected, *after pilot* means it can wait.

The honest summary: every flow in this product works end to end against mock adapters, with the
rules, the ledger and the guards all real. No money has ever moved, no SMS has ever been sent,
and no file has ever been stored. The list below is what stands between that and a real pilot.

| Area | Status | Current behaviour | Production replacement | Owner milestone |
| --- | --- | --- | --- | --- |
| SMS / OTP delivery | **MOCKED** | OTP logged to API console; demo code `123456` | MSG91 or Twilio via `adapters/sms/msg91.ts` | M1 (adapter), live on credentials |
| Payment gateway | **MOCKED** | authorization, capture, refunds and payouts all run through the mock adapter, which always succeeds. The flows, the ledger and every guard are real; **no money moves** | Razorpay Orders, Webhooks and RazorpayX payouts | before launch |
| Maps / geocoding | **MOCKED** | address hashed to pseudo-coordinates near pilot centre; haversine distance | Google Maps Platform or Mapbox | M2 |
| Push notifications | **MOCKED** | logged; in-app inbox works | Expo Push / FCM | M2 |
| Masked calling | **MOCKED** | the customer sees a masked number for the technician, but no call can be placed - the adapter returns a fake virtual number | Exotel / Knowlarity | before launch |
| Object storage | **MOCKED** | files kept in memory / `apps/api/.data`; fake signed URLs | Supabase Storage / S3 | M2 |
| Error monitoring | **MOCKED** | logged | Sentry | M1 (adapter) |
| Analytics | **MOCKED** | logged | PostHog (after privacy review) | M1 (adapter) |
| Realtime | implemented | Server-Sent Events on `/events`; an event says only what changed and the client re-reads. Polling remains as a 60-second fallback. There is no fan-out across nodes, so a second API node would need a shared bus | Redis or Postgres LISTEN/NOTIFY fan-out | before scale-out |
| Database | memory mode by default | in-process store, resets on restart. **The Postgres path is now proven**: all 9 migrations apply to a real PostgreSQL 17 and all 184 API tests pass against it, which found four bugs memory mode could not (TEST_PLAN) | put that run in CI | before launch |
| Provider verification approval | implemented | staff review the queue and approving flips the profile to VERIFIED; the document file itself is still mock storage, so there is nothing to look at in demo mode | real object storage | before launch |
| KYC document bytes | **MOCKED** | the upload target and a 5-minute signed read URL are issued and the access is logged, but mock storage holds no bytes, so the link opens nothing | encrypted object storage + envelope encryption | before launch |
| Settlement scheduler | implemented | an in-process worker runs the payout sweep every 15 minutes; support can still force it. On more than one node, run the scheduler on exactly one until the work moves to a queue | job queue | before scale-out |
| Payout failure alerting | partial | three failures park a settlement at ON_HOLD and support can retry it from the console, but nothing alerts anyone that it happened | alerting | before launch |
| Reconciliation with the gateway | implemented, **mock answers** | a stuck payment is chased every 2 minutes and handed to support after 30. The mock gateway always answers "pending", so the resolve path is exercised by the give-up branch rather than by a real answer | live gateway | before launch |
| Chargebacks | not built | the DISPUTE_HOLD path exists, but no gateway chargeback event is handled | chargeback webhook + evidence pack | before launch |
| Console reporting | **naive** | the ops report walks users and jobs in the store rather than querying aggregates, which is fine at pilot size and will not be at scale | SQL aggregates + a reporting view | after pilot |
| Appeal routing | partial | an appeal reopens the dispute and clears the assignee so a different person picks it up, but nothing enforces that the second reviewer differs from the first | queue assignment rules | after pilot |
| Tax treatment | **needs professional review** | 18% GST is applied to platform fees only, as a placeholder; TDS, TCS and vendor GST are not modelled | tax advisor + accounting review | before launch |
| Counter-offer expiry | implemented | swept every minute; the job falls back to its standing offers |  |  |
| Bid-window expiry | implemented | swept every minute; a job nobody answered is auto-cancelled and the customer is told |  |  |
| Admin MFA recovery | partial | TOTP enrolment, single-use codes and a 5-failure lock are implemented; there are no recovery codes, so a lost phone needs a database fix | recovery codes + admin-assisted reset | before launch |
| KYC encryption | not started | the TOTP seed is AES-256-GCM encrypted with the server key, but documents are not; neither uses a KMS | envelope encryption with a KMS | before launch |
| Push notifications | **implemented** | device tokens are registered on every launch, every in-app notification is also a push, previews are stripped of anything private, and three categories can be switched off. The Expo push adapter itself is still selected by `PUSH_PROVIDER` and has not run against the real service | credentials + a real-device rehearsal | before launch |
| Masked calling | **implemented, mocked rail** | `POST /jobs/:id/call` connects the two people on a job through the telephony adapter, with limits and a call log. The Exotel adapter exists but has never run, so in demo mode the number returned is a fixed mock | Exotel credentials | before launch |
| Rescheduling | **implemented** | a customer may move a booking twice, and the provider is told. There is no provider-initiated reschedule: a provider who cannot make it cancels, which is honest about what happened | provider-proposed time change | after pilot |
| Contractor and technician app | **not built** | the API supports the whole role - adding technicians, assigning them, their job list - but there is no mobile area for it, so a contractor has to use the provider screens | a `(contractor)` app area | before contractors onboard |
| Voice-note recording (mobile) | not started | the API accepts voice notes (60 s cap enforced); the app only attaches photos so far | expo-audio recorder in the booking flow | after pilot |
| Completion, revision and delivery photos (mobile) | **stand-in** | the app calls the evidence endpoint with fixed image metadata instead of opening the camera, because mock storage has nowhere to put the bytes | camera capture + signed upload | before launch |
| Vendor invoice upload (mobile) | not built | the API accepts and validates an invoice against the order total; the vendor app shows what is owed but has no upload screen yet | invoice capture in the vendor app | before launch |
| Held material orders | **manual** | a reported mismatch parks the order at ON_HOLD and notifies both sides; releasing one is an API call, not a console screen | material row in the console | after pilot |
| Material substitution | not built | a vendor quotes against the list as given; there is no flow for proposing a different brand mid-order (MAT-05) | substitution approval | after pilot |
| Vendor payouts | implemented, **mocked rail by default** | a confirmed order with a matching invoice produces a PENDING settlement that the payout adapter pays. A live RazorpayX implementation now exists; it is selected only when `PAYMENT_PROVIDER=razorpay` and has never run against the real API | credentials + a rehearsal in test mode | before launch |
| Payout account name check | **not done** | a payout account is marked VERIFIED once RazorpayX accepts it, which proves the account exists and is payable - **not** that the name on it belongs to the payee. A penny-drop or name-match check is a separate paid API | fund account validation API | before launch |
| Live adapters | written, **never executed** | Razorpay, MSG91, Google Maps, Expo Push, Supabase Storage, Sentry/PostHog and Exotel all have real implementations verified against published API shapes, but no credential exists to run them. Every one fails loudly at boot rather than silently falling back to a mock | credentials per provider | before launch |
| Chat moderation | **flag only** | messages with a phone number, email or UPI handle are stored flagged; the console has no screen for them yet | flagged-message queue | after pilot |
| Start-code resend | not built | one code per job for 72 hours; there is no resend or rotation | resend with cooldown (policy already in `START_JOB_OTP_POLICY`) | after pilot |
| Customer approval timeout | implemented, **no auto-approval** | after 48 h the customer is reminded and a support ticket is opened. The platform deliberately never approves work on a customer's behalf - that would be taking their money on a silence |  |  |
| Media bytes in mock mode | **MOCKED** | `/jobs/:id/media` returns `upload.required: false` and marks the row uploaded; no bytes are stored, so photo thumbnails fall back to an icon | Supabase Storage / S3 signed PUT | before launch |
| Voice-note transcription | deferred | none | Phase 2 | – |
| Regional voice UI, AI categorisation, AI damage assessment | deferred by spec §31 | – | – | – |
| Mobile dependency pin | workaround | `query-string@7` added to `apps/mobile` because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it | remove when expo-router updates | M2 |
| Welcome hero artwork | **derived asset** | `apps/mobile/assets/hero-technician.png` is extracted from the reference render the user supplied (text removed, background rebuilt) | final licensed export of the same illustration | before release (D-011) |
| Home hero artwork | placeholder | vector illustration in the home hero | final design assets | design handoff |
| Legal/payment structure | **needs professional review** | authorization/hold/settlement vocabulary throughout, no pooled account modelling, no nodal account | payments counsel + RBI guidance review | before launch |
