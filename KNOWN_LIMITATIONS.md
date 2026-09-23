# Known Limitations

Updated every milestone. **Nothing external is live.** Each row names the production replacement.

| Area | Status | Current behaviour | Production replacement | Owner milestone |
| --- | --- | --- | --- | --- |
| SMS / OTP delivery | **MOCKED** | OTP logged to API console; demo code `123456` | MSG91 or Twilio via `adapters/sms/msg91.ts` | M1 (adapter), live on credentials |
| Payment gateway | **MOCKED** | authorization, capture, refunds and payouts all run through the mock adapter, which always succeeds. The flows, the ledger and every guard are real; **no money moves** | Razorpay Orders, Webhooks and RazorpayX payouts | before launch |
| Maps / geocoding | **MOCKED** | address hashed to pseudo-coordinates near pilot centre; haversine distance | Google Maps Platform or Mapbox | M2 |
| Push notifications | **MOCKED** | logged; in-app inbox works | Expo Push / FCM | M2 |
| Masked calling | **MOCKED** | the customer sees a masked number for the technician, but no call can be placed - the adapter returns a fake virtual number | Exotel / Knowlarity | M9 |
| Object storage | **MOCKED** | files kept in memory / `apps/api/.data`; fake signed URLs | Supabase Storage / S3 | M2 |
| Error monitoring | **MOCKED** | logged | Sentry | M1 (adapter) |
| Analytics | **MOCKED** | logged | PostHog (after privacy review) | M1 (adapter) |
| Realtime | not started | the app polls the job, offers, booking and material endpoints | Supabase Realtime | M9 |
| Database | memory mode by default | in-process store, resets on restart | Supabase Postgres via migrations (schema written, not yet exercised by tests) | M1 (schema), M2 (postgres repo tests) |
| Provider verification approval | implemented | staff review the queue and approving flips the profile to VERIFIED; the document file itself is still mock storage, so there is nothing to look at in demo mode | real object storage | M9 |
| KYC document bytes | **MOCKED** | the upload target and a 5-minute signed read URL are issued and the access is logged, but mock storage holds no bytes, so the link opens nothing | encrypted object storage + envelope encryption | M9 |
| Settlement scheduler | **manual** | payouts are due 24 h after capture, but nothing runs on a timer: support calls `POST /admin/settlements/run`. Every guard re-runs per settlement, so this is safe, just not automatic | scheduled job | M9 |
| Payout failure alerting | partial | three failures park a settlement at ON_HOLD and support can retry it from the console, but nothing alerts anyone that it happened | alerting | M9 |
| Reconciliation with the gateway | not built | PAYMENT_FLOW section 8 calls for polling the gateway when a webhook never arrives; nothing polls yet, so a stuck payment stays PENDING | reconciliation job | M9 |
| Chargebacks | not built | the DISPUTE_HOLD path exists, but no gateway chargeback event is handled | chargeback webhook + evidence pack | M9 |
| Console reporting | **naive** | the ops report walks users and jobs in the store rather than querying aggregates, which is fine at pilot size and will not be at scale | SQL aggregates + a reporting view | M9 |
| Appeal routing | partial | an appeal reopens the dispute and clears the assignee so a different person picks it up, but nothing enforces that the second reviewer differs from the first | queue assignment rules | M9 |
| Tax treatment | **needs professional review** | 18% GST is applied to platform fees only, as a placeholder; TDS, TCS and vendor GST are not modelled | tax advisor + accounting review | before launch |
| Counter-offer expiry | not scheduled | a 20-minute TTL is stored and checked on every read and response, but nothing sweeps expired offers in the background | scheduled job | M9 |
| Bid-window expiry | not scheduled | offers stop being accepted once the window passes, but nothing auto-cancels or expires the job in the background | scheduled job | M9 |
| Admin MFA recovery | partial | TOTP enrolment, single-use codes and a 5-failure lock are implemented; there are no recovery codes, so a lost phone needs a database fix | recovery codes + admin-assisted reset | M9 |
| KYC encryption | not started | the TOTP seed is AES-256-GCM encrypted with the server key, but documents are not; neither uses a KMS | envelope encryption with a KMS | M9 |
| Voice-note recording (mobile) | not started | the API accepts voice notes (60 s cap enforced); the app only attaches photos so far | expo-audio recorder in the booking flow | M9 |
| Completion, revision and delivery photos (mobile) | **stand-in** | the app calls the evidence endpoint with fixed image metadata instead of opening the camera, because mock storage has nowhere to put the bytes | camera capture + signed upload | M9 |
| Vendor invoice upload (mobile) | not built | the API accepts and validates an invoice against the order total; the vendor app shows what is owed but has no upload screen yet | invoice capture in the vendor app | M9 |
| Held material orders | **manual** | a reported mismatch parks the order at ON_HOLD and notifies both sides; releasing one is an API call, not a console screen | material row in the console | M9 |
| Material substitution | not built | a vendor quotes against the list as given; there is no flow for proposing a different brand mid-order (MAT-05) | substitution approval | after pilot |
| Vendor payouts | implemented, **mocked rail** | a confirmed order with a matching invoice produces a PENDING settlement that the payout adapter pays; the adapter is a mock | RazorpayX payouts | before launch |
| Chat moderation | **flag only** | messages with a phone number, email or UPI handle are stored flagged; the console has no screen for them yet | flagged-message queue | M9 |
| Start-code resend | not built | one code per job for 72 hours; there is no resend or rotation | resend with cooldown (policy already in `START_JOB_OTP_POLICY`) | M9 |
| Customer approval timeout | not scheduled | `CUSTOMER_APPROVAL_HOURS` is defined but nothing chases or auto-approves a job the customer ignores | scheduled job + reminder | M9 |
| Media bytes in mock mode | **MOCKED** | `/jobs/:id/media` returns `upload.required: false` and marks the row uploaded; no bytes are stored, so photo thumbnails fall back to an icon | Supabase Storage / S3 signed PUT | M9 |
| Voice-note transcription | deferred | none | Phase 2 | – |
| Regional voice UI, AI categorisation, AI damage assessment | deferred by spec §31 | – | – | – |
| Mobile dependency pin | workaround | `query-string@7` added to `apps/mobile` because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it | remove when expo-router updates | M2 |
| Welcome hero artwork | **derived asset** | `apps/mobile/assets/hero-technician.png` is extracted from the reference render the user supplied (text removed, background rebuilt) | final licensed export of the same illustration | before release (D-011) |
| Home hero artwork | placeholder | vector illustration in the home hero | final design assets | design handoff |
| Legal/payment structure | **needs professional review** | authorization/hold/settlement vocabulary throughout, no pooled account modelling, no nodal account | payments counsel + RBI guidance review | before launch |
