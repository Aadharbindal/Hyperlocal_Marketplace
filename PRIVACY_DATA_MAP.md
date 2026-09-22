# Privacy Data Map

> Draft for legal review before launch (§32). Principle: collect the minimum needed to complete
> and support a job safely; retain only for support, fraud prevention, accounting and legal needs.

## 1. Personal data inventory

| Data | Subject | Purpose | Storage | Access | Retention |
| --- | --- | --- | --- | --- | --- |
| Phone number | all users | auth, notifications, masked calling | `users.phone_e164` | user, support, admin | account life + 7 y (finance) then anonymised |
| Name, avatar | all | identification to counterparty | `users`, profiles | counterparty (name/avatar only), support | account life; anonymised on deletion |
| Email | customer (optional) | receipts | `customer_profiles.email` | user, support | account life |
| Addresses + GPS | customer | service delivery | `addresses`, `jobs.address_snapshot` | customer, confirmed provider (after confirmation only), support | address: until deleted by user; job snapshot: 7 y (finance) with GPS truncated to 3 decimals after 90 d |
| Provider base location & radius | provider | matching | `provider_profiles` | provider, system, admin | account life |
| KYC documents | provider, technician, vendor | verification | encrypted object storage; metadata in `kyc_records` | KYC reviewers only, every access audited | 5 y after account closure or as required by law; never shown to customers |
| Bank details | provider, vendor, contractor | payouts | encrypted column | payouts service, finance admin | account life + 7 y |
| Job photos / videos | customer, provider | scope, evidence | object storage + `job_media` | job parties, support | 90 d after settlement unless dispute/legal hold; then purge; hashes retained |
| Voice notes + transcript | customer | scope description | object storage | job parties, support | 90 d after settlement; transcript retained anonymised |
| Chat messages | job parties | coordination, leak detection | `chat_messages` | job parties, support | 180 d after settlement then anonymised |
| Call logs (masked) | job parties | support, fraud | telephony adapter + `call_logs` | support | 180 d |
| Payment ids | customer | payments | `payments` | finance, support | 7 y |
| Ledger | providers, vendors | accounting | `ledger_entries` | finance | 7 y, immutable |
| Reviews | both | trust | `reviews` | public within app (first name + initial) | account life; anonymised on deletion |
| Device / IP | all | security, rate limiting | logs, `sessions` | security | 90 d |
| Analytics events | all | product metrics | analytics adapter | product | 13 months, pseudonymous ids |
| Consents | all | compliance | `consents` | user, compliance | account life + 3 y |

## 2. Data flows to processors (all mocked until live)

| Processor | Data | Purpose |
| --- | --- | --- |
| SMS provider | phone, OTP | authentication |
| Payment gateway | amount, order id, phone/email (as required) | payment |
| Maps provider | address text, coordinates | geocoding |
| Push provider | device token | notifications |
| Telephony provider | phone numbers | masked calling |
| Object storage | media | storage |
| Error monitoring | request ids, stack traces (PII redacted) | reliability |
| Analytics | pseudonymous ids, events | metrics |

## 3. Subject rights

- Access/export: support ticket → `retention_events(action=EXPORT)` → JSON export within 30 d.
- Correction: self-service for profile; support for locked fields (audited).
- Deletion: request → 30-day grace → anonymise PII; financial/audit/dispute rows retained with
  pseudonymised subject id. User-facing copy explains what is retained and why.
- Consent withdrawal: marketing and non-essential processing stop immediately.

## 4. Retention jobs

`retention_events` drive scheduled purges/anonymisation. Legal hold (`disputes` open, chargeback,
authority request) blocks purge. Each execution is logged (`retention.executed`).

## 5. Minimisation rules

- Never log phone numbers, OTPs, tokens, document numbers.
- GPS shared with the provider only after confirmation, and with the customer only as "on the
  way / arrived" statuses (no continuous tracking in MVP).
- Customers never see KYC documents; they see verification badge and business identity only.
