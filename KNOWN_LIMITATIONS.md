# Known Limitations

Updated every milestone. **Nothing external is live.** Each row names the production replacement.

| Area | Status | Current behaviour | Production replacement | Owner milestone |
| --- | --- | --- | --- | --- |
| SMS / OTP delivery | **MOCKED** | OTP logged to API console; demo code `123456` | MSG91 or Twilio via `adapters/sms/msg91.ts` | M1 (adapter), live on credentials |
| Payment gateway | **MOCKED** | deterministic orders; simulated webhooks | Razorpay Orders + Webhooks | M7 |
| Maps / geocoding | **MOCKED** | address hashed to pseudo-coordinates near pilot centre; haversine distance | Google Maps Platform or Mapbox | M2 |
| Push notifications | **MOCKED** | logged; in-app inbox works | Expo Push / FCM | M2 |
| Masked calling | **MOCKED** | returns fake virtual number | Exotel / Knowlarity | M5 |
| Object storage | **MOCKED** | files kept in memory / `apps/api/.data`; fake signed URLs | Supabase Storage / S3 | M2 |
| Error monitoring | **MOCKED** | logged | Sentry | M1 (adapter) |
| Analytics | **MOCKED** | logged | PostHog (after privacy review) | M1 (adapter) |
| Realtime | not started | polling | Supabase Realtime | M4 |
| Database | memory mode by default | in-process store, resets on restart | Supabase Postgres via migrations (schema written, not yet exercised by tests) | M1 (schema), M2 (postgres repo tests) |
| Admin MFA | not started | – | TOTP | M8 |
| KYC encryption | not started | – | envelope encryption | M8 |
| Voice-note transcription | deferred | none | Phase 2 | – |
| Regional voice UI, AI categorisation, AI damage assessment | deferred by spec §31 | – | – | – |
| Mobile dependency pin | workaround | `query-string@7` added to `apps/mobile` because `@react-navigation/native` 7.4 dropped it while `expo-router` 5.1 still imports it | remove when expo-router updates | M2 |
| Welcome hero artwork | **derived asset** | `apps/mobile/assets/hero-technician.png` is extracted from the reference render the user supplied (text removed, background rebuilt) | final licensed export of the same illustration | before release (D-011) |
| Home hero artwork | placeholder | vector illustration in the home hero | final design assets | design handoff |
| Legal/payment structure | **needs professional review** | hold/settlement vocabulary only | – | before launch |
