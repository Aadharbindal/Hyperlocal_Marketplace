# Known Limitations

Updated every milestone. **Nothing external is live.** Each row names the production replacement.

| Area | Status | Current behaviour | Production replacement | Owner milestone |
| --- | --- | --- | --- | --- |
| SMS / OTP delivery | **MOCKED** | OTP logged to API console; demo code `123456` | MSG91 or Twilio via `adapters/sms/msg91.ts` | M1 (adapter), live on credentials |
| Payment gateway | **MOCKED** | deterministic order ids; `POST /payments/:id/mock-complete` and self-signed webhooks stand in for the gateway checkout. The booking flow is real end to end, the *authorization is not* - no money moves | Razorpay Orders + Webhooks (capture, refunds, settlement) | M7 |
| Maps / geocoding | **MOCKED** | address hashed to pseudo-coordinates near pilot centre; haversine distance | Google Maps Platform or Mapbox | M2 |
| Push notifications | **MOCKED** | logged; in-app inbox works | Expo Push / FCM | M2 |
| Masked calling | **MOCKED** | returns fake virtual number | Exotel / Knowlarity | M5 |
| Object storage | **MOCKED** | files kept in memory / `apps/api/.data`; fake signed URLs | Supabase Storage / S3 | M2 |
| Error monitoring | **MOCKED** | logged | Sentry | M1 (adapter) |
| Analytics | **MOCKED** | logged | PostHog (after privacy review) | M1 (adapter) |
| Realtime | not started | the app polls the job, offers and booking endpoints | Supabase Realtime | M9 |
| Database | memory mode by default | in-process store, resets on restart | Supabase Postgres via migrations (schema written, not yet exercised by tests) | M1 (schema), M2 (postgres repo tests) |
| Provider verification approval | **manual/mocked** | KYC submission works and sets SUBMITTED; nothing flips a provider to VERIFIED yet (tests and the demo seed set it directly) | admin KYC review queue | M8 |
| KYC document bytes | **MOCKED** | the upload target is returned but the file is not stored (mock storage); only the last-4 and metadata are persisted | encrypted object storage | M8 |
| Payment capture and payouts | not started | authorization only; nothing is captured, settled or refunded yet | capture on approval, ledger, settlements, refunds | M7 |
| Counter-offer expiry | not scheduled | a 20-minute TTL is stored and checked on every read and response, but nothing sweeps expired offers in the background | scheduled job | M9 |
| Bid-window expiry | not scheduled | offers stop being accepted once the window passes, but nothing auto-cancels or expires the job in the background | scheduled job | M9 |
| Admin MFA | not started | – | TOTP | M8 |
| KYC encryption | not started | – | envelope encryption | M8 |
| Voice-note recording (mobile) | not started | the API accepts voice notes (60 s cap enforced); the app only attaches photos so far | expo-audio recorder in the booking flow | M3 |
| Media bytes in mock mode | **MOCKED** | `/jobs/:id/media` returns `upload.required: false` and marks the row uploaded; no bytes are stored, so photo thumbnails fall back to an icon | Supabase Storage / S3 signed PUT | M6 |
| Voice-note transcription | deferred | none | Phase 2 | – |
| Regional voice UI, AI categorisation, AI damage assessment | deferred by spec §31 | – | – | – |
| Mobile dependency pin | workaround | `query-string@7` added to `apps/mobile` because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it | remove when expo-router updates | M2 |
| Welcome hero artwork | **derived asset** | `apps/mobile/assets/hero-technician.png` is extracted from the reference render the user supplied (text removed, background rebuilt) | final licensed export of the same illustration | before release (D-011) |
| Home hero artwork | placeholder | vector illustration in the home hero | final design assets | design handoff |
| Legal/payment structure | **needs professional review** | hold/settlement vocabulary only | – | before launch |
