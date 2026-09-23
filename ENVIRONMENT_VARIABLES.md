# Environment Variables

All variables live in `.env` (never committed). `.env.example` lists names with placeholders.
Validated at boot by `apps/api/src/config/env.ts` (zod); the API refuses to start with invalid
values and, in `production`, refuses `mock` adapters for SMS and payments unless
`ALLOW_MOCK_IN_PRODUCTION=true` is explicitly set (for staging demos only).

## Global
| Name | Default | Purpose |
| --- | --- | --- |
| `APP_ENV` | `local` | `local` / `staging` / `production` |
| `BRAND_NAME` | Hyperlocal Marketplace | placeholder brand (D-001) |

## API
| Name | Default | Purpose |
| --- | --- | --- |
| `API_PORT` | 4000 | listen port |
| `API_HOST` | 0.0.0.0 | bind host |
| `API_JWT_SECRET` | – (required, ≥ 32 chars) | signs access tokens |
| `API_JWT_ISSUER` | hyperlocal-api | JWT issuer claim |
| `API_ACCESS_TOKEN_TTL_SECONDS` | 3600 | access token lifetime |
| `API_REFRESH_TOKEN_TTL_SECONDS` | 2592000 | refresh token lifetime (30 d) |
| `ADMIN_MFA_REQUIRED` | false | second factor for the support console. **Boot fails in production if this is false**; the TOTP seed is encrypted with `API_JWT_SECRET` |
| `API_CORS_ORIGINS` | localhost dev origins | comma-separated |
| `API_LOG_LEVEL` | info | pino level |
| `DATA_MODE` | memory | `memory` (demo/tests) or `postgres` |
| `DATABASE_URL` | local supabase | Postgres connection (postgres mode) |

## Supabase
| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | project URL |
| `SUPABASE_ANON_KEY` | public key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only; never in mobile |

## Adapters (`*_PROVIDER=mock` runs the deterministic mock)
| Name | Options | Mock behaviour |
| --- | --- | --- |
| `SMS_PROVIDER` | mock, msg91, twilio | logs `[MOCK sms]`; OTP = `OTP_DEMO_CODE` |
| `PAYMENT_PROVIDER` | mock, razorpay | deterministic orders, simulated webhooks |
| `MAPS_PROVIDER` | mock, google, mapbox | pseudo-geocode by hashing address; distance = haversine |
| `PUSH_PROVIDER` | mock, expo, fcm | logs notifications |
| `TELEPHONY_PROVIDER` | mock, exotel, knowlarity | returns a fake masked number |
| `STORAGE_PROVIDER` | mock, supabase, s3 | in-memory/`.data` dir, fake signed URLs |
| `ERROR_MONITORING_PROVIDER` | mock, sentry | logs captured errors |
| `ANALYTICS_PROVIDER` | mock, posthog | logs events |
| `*_API_KEY` / `*_SECRET` | – | credentials for live providers |
| `STORAGE_BUCKET` | job-media | bucket name |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | 900 | signed URL lifetime |

## OTP policy
| Name | Default |
| --- | --- |
| `OTP_LENGTH` | 6 (login); start-job OTP is fixed at 4 digits per spec |
| `OTP_TTL_SECONDS` | 300 |
| `OTP_MAX_ATTEMPTS` | 5 |
| `OTP_REQUESTS_PER_HOUR` | 5 |
| `OTP_DEMO_CODE` | 123456 (mock SMS only; ignored when `SMS_PROVIDER≠mock`) |

## Pilot zone
`PILOT_CITY`, `PILOT_CENTER_LAT`, `PILOT_CENTER_LNG`, `PILOT_RADIUS_KM` (default 3).

## Mobile (bundled, public — never secrets)
| Name | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | API base URL |
| `EXPO_PUBLIC_APP_ENV` | environment label |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | realtime/storage (later) |
