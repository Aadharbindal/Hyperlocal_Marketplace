# Edge-Case Matrix

Columns: **Scenario · Risk · Prevention · Detection · User-facing message · System action · Admin action · Financial impact · Audit event · Test case**. Feature = section heading. Test ids map to `TEST_PLAN.md`; `[M#]` = milestone where the automated test lands.

Retention/recovery rule for every row: evidence (status events, media, ledger, audit) is never deleted while a dispute, settlement or legal hold is open; recovery is by adjustment events, never by editing history.

## Accounts and authentication

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Duplicate accounts | fragmented history, fraud | phone unique; KYC doc-hash unique | dup KYC hash, same device id | "This number is already registered." | reject signup, offer login | merge request review | none | `auth.duplicate_blocked` | AUTH-01 [M1] |
| Multiple roles on one account | privilege confusion | explicit `user_roles`, per-route role check, active-role header | role check failures logged | "Switch to your Provider profile to do this." | 403 with role hint | grant/revoke roles with reason | none | `role.granted/revoked` | AUTH-02 [M1] |
| Lost phone | takeover | short access TTL, revoke-all-sessions, re-verify on new device | new device login | "New device detected – verify OTP." | revoke old sessions on request | support-assisted recovery w/ KYC | none | `session.revoked_all` | AUTH-03 [M1] |
| Changed number | lockout | number change flow with old+new OTP; support fallback with KYC | support ticket | "We sent codes to both numbers." | update phone, keep user id | verify identity, change with reason | none | `user.phone_changed` | AUTH-04 [M8] |
| OTP not received | stuck user | resend with cooldown (60 s), voice-call fallback (later), demo code in mock | delivery status from SMS adapter | "Didn't get the code? Resend in 0:45." | resend, new challenge, old invalid | check SMS logs | none | `otp.resent` | AUTH-05 [M1] |
| Expired OTP | stuck user | 5 min TTL shown in UI | verify after expiry | "This code has expired. Request a new one." | reject, allow new request | – | none | `otp.expired` | AUTH-06 [M1] |
| Too many OTP attempts | brute force | 5 attempts/challenge; 5 requests/phone/hour; IP limits | counter exceeded | "Too many attempts. Try again in 15 minutes." | lock challenge, temp block phone | unblock with reason | none | `otp.locked` | AUTH-07 [M1] |
| SIM replacement / SIM swap | takeover | re-login requires OTP + optional KYC step for payout changes | unusual device + payout edit | "For safety, confirm your identity." | require re-verify for bank changes (24 h hold) | review | payouts held 24 h | `security.sim_swap_suspect` | AUTH-08 [M7] |
| Suspended-account login | bypass | status check at login and per request | status=SUSPENDED | "Your account is suspended. Contact support." | allow read-only earnings/history, block actions | reactivate with reason | balances retained | `auth.suspended_login` | AUTH-09 [M1] |
| Provider second account to bypass suspension | bypass | device fingerprint + KYC hash + bank hash match | match found | "We could not verify this account." | hold verification | manual review, link accounts | none | `fraud.duplicate_identity` | AUTH-10 [M8] |
| Accidental duplicate KYC | admin noise | idempotent submit; one open KYC per user | second submit while SUBMITTED | "Your documents are already under review." | 409, no new record | – | none | `kyc.duplicate_ignored` | AUTH-11 [M8] |

## Customer job creation

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Incomplete description | bad bids | min length or photo or voice note required | validation | "Add a photo or a few words so providers can quote." | keep DRAFT | – | none | – | JOB-01 [M2] |
| Wrong category | wrong providers | category picker with examples; provider can flag "wrong category" | ≥2 flags | "We've moved your request to Electrical." | QUALIFYING → recategorise, reopen bids | support recategorise | none | `job.recategorised` | JOB-02 [M3] |
| Duplicate job | double booking | dedupe same customer+category+address within 2 h | dup detected | "You already have a similar open request." | warn, link existing | merge/cancel dup | none | `job.duplicate_warned` | JOB-03 [M2] |
| Customer changes address | provider mismatch | address locked after CONFIRMED; before that allowed | edit after confirm | "Address can't change after confirmation – cancel and rebook or contact support." | 409 | support relocate with provider consent | possible visit fee | `job.address_changed` | JOB-04 [M2] |
| Incorrect map pin | provider can't find | reverse-geocode sanity, pincode vs pin distance check | > 500 m mismatch | "Your pin looks far from the address. Adjust it?" | warn, allow | – | none | – | JOB-05 [M2] |
| Society access issue | no-show | "gate instructions" field; recipient phone | provider marks "cannot enter" | "Provider is at the gate – please allow entry." | ARRIVED with flag, notify customer | call both | none if resolved | `job.access_issue` | JOB-06 [M5] |
| Inspection first | scope unknown | inspection_required flag → inspection fee only | flag | "Inspection fee ₹X. Work quote after visit." | quote type INSPECTION | – | inspection fee only | – | JOB-07 [M4] |
| Customer unavailable | wasted trip | preferred window; reminders 2 h/30 min | provider marks not present | "Provider has arrived. Are you home?" | 15-min wait timer, then NO_SHOW policy | – | visit fee | `job.customer_no_show` | JOB-08 [M5] |
| Booking for another person | OTP in wrong hands | recipient name/phone; tracking link; OTP to recipient | – | "Send OTP to the person at home." | recipient token | – | none | `job.recipient_set` | JOB-09 [M2] |
| Customer cannot use app | exclusion | support-assisted booking | ticket | "Support booked this for you." | admin creates job on behalf, audited | create with reason | none | `job.created_by_support` | JOB-10 [M8] |
| Unsafe location | harm | provider can decline with reason; safety report | report | "Reported. Support will contact you." | pause job, ticket | review | none | `safety.reported` | JOB-11 [M5] |
| Emergency request | danger | URGENT priority + safety banner (gas/fire → call emergency services first) | keywords | "If there is fire or gas leak, call emergency services now." | 10-min bid window | monitor | none | – | JOB-12 [M2] |
| Prohibited/unsafe service | liability | blocklist of keywords/categories; provider report | keyword hit | "We can't help with this request." | reject at QUALIFYING | review | none | `job.rejected_policy` | JOB-13 [M2] |

## Provider and bidding

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Accidental bid | bad commitment | confirm sheet with breakdown; withdraw within 2 min free | withdraw | "Bid withdrawn." | status WITHDRAWN | – | none | `bid.withdrawn` | BID-01 [M3] |
| Withdraw after accept | no-show | withdraw blocked after accept → cancellation path | attempt | "You're confirmed. Cancelling now counts as a cancellation." | 409 | – | strike | `bid.withdraw_blocked` | BID-02 [M4] |
| Overlapping jobs | late arrival | schedule conflict check on bid (ETA windows) | overlap | "You have another job at that time." | warn/block | – | none | – | BID-03 [M3] |
| Outside radius | wasted lead | eligibility filter server-side | – | (job hidden) | not in feed | – | no lead fee | – | BID-04 [M3] |
| GPS spoofing | fake proximity | server-side distance from registered base + jitter checks | impossible travel | – | flag provider | review | – | `fraud.gps_suspect` | BID-05 [M9] |
| Poor connectivity | duplicate bid | idempotency key per bid; offline queue | dup key | "Bid already submitted." | 200 same bid | – | none | – | BID-06 [M3] |
| Misleading price | bait-and-switch | price locked; revision needs approval; revision rate tracked | revision ratio > 40 % | – | lower ranking, warn | strike | none | `provider.revision_ratio_flag` | BID-07 [M5] |
| Suspended provider bids | bypass | trigger + code check | – | "Account suspended." | 403 | – | none | `bid.blocked_suspended` | BID-08 [M3] |
| Parties know each other | leakage | no prevention; in-app benefits | off-platform indicators | – | – | – | none | – | – |
| No bids | dead job | auto-extend window once; notify support; widen radius +1 km | window ends, 0 bids | "Still finding providers – we've extended the search." | extend, then AUTO_CANCELLED after 2nd window | manual outreach | none | `job.window_extended` | BID-09 [M3] |
| Too many bids | overload | cap 8 active bids; rank | cap | "Top offers shown." | close early at cap | – | none | – | BID-10 [M3] |
| Bid expires during acceptance | race | accept validates expiry in same tx | expired | "This offer just expired – ask the provider to renew." | 409 | – | none | `bid.accept_expired` | BID-11 [M4] |
| Simultaneous acceptance / two providers | double booking | DB transaction + partial unique index on active assignment | unique violation | "Another provider was just confirmed." | 409 to loser | – | none | `bid.accept_conflict` | BID-12 [M4] |

## Scheduling and arrival

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Provider late | frustration | ETA commitments; reminders; EN_ROUTE required 30 min before | ETA + 15 min no ARRIVED | "Provider is running late. New ETA: …" | prompt provider for new ETA; > 2 h → customer may cancel free | call | visit fee waived if > 2 h | `job.late` | SCH-01 [M5] |
| Cannot find address | no-show | pin + landmark + masked call | provider taps "can't find" | "Provider needs directions – call?" | masked call | – | none | `job.navigation_help` | SCH-02 [M5] |
| Customer asks provider to wait | wasted time | wait timer, 15 min free | timer | "Waiting time ₹X after 15 min (if policy enabled)." | log | – | optional waiting fee via revision | `job.waiting` | SCH-03 [M5] |
| Customer not present | no-show | reminders, recipient | 15-min wait expired | "Customer unavailable – visit fee applies." | CUSTOMER no-show path | review | visit fee captured | `job.customer_no_show` | SCH-04 [M5] |
| Cannot enter society | no-show | gate instructions | flag | see JOB-06 | – | – | – | – | – |
| Traffic/weather delay | late | new ETA flow | – | "Delayed due to traffic – new ETA …" | update ETA event | – | none | `job.eta_updated` | SCH-05 [M5] |
| Vehicle breakdown / provider ill | cancel | provider cancel with reason; auto-reopen bids to other providers | cancel | "Your provider had to cancel. Finding a replacement…" | CANCELLED_BY_PROVIDER → clone job OPEN_FOR_BIDS | outreach | full release; strike waived with evidence | `job.provider_cancelled` | SCH-06 [M5] |
| Technician replacement | identity mismatch | contractor replace before arrival; customer notified/approves for HIGH-risk skills | replacement | "Technician changed to Ravi (Verified). Approve?" | assignment REPLACED, new ACTIVE | – | none | `assignment.replaced` | SCH-07 [M5] |
| Customer changes appointment | wasted trip | reschedule allowed until EN_ROUTE; provider must accept | reschedule request | "Provider must confirm the new time." | pending accept; else reopen | – | none before EN_ROUTE | `job.rescheduled` | SCH-08 [M5] |
| Provider arrives too early | customer absent | ARRIVED allowed ≤ 30 min early; wait timer not started before window | early | "You're early – waiting time starts at 10:00." | – | – | none | – | SCH-09 [M5] |

## OTP and execution

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Start OTP not received/visible | blocked start | OTP in app + SMS + recipient link | provider reports | "Your start code is in the app under this booking." | resend SMS | read code to verified customer after identity check | none | `otp.start_resent` | OTP-01 [M5] |
| Wrong OTP | blocked | 5 attempts | attempts | "Incorrect code. 3 attempts left." | lock after 5; notify customer | override with reason | none | `otp.start_failed` | OTP-02 [M5] |
| OTP shared prematurely | fake start | OTP shown only after PROVIDER_ASSIGNED; warning copy; start requires ARRIVED + geo plausibility | start far from address | "Share the code only when the provider is at your door." | flag | review | none | `otp.start_geo_flag` | OTP-03 [M5] |
| Customer refuses OTP | dispute | provider can report; support call | report | "Customer hasn't shared the code – support will call." | hold | mediate; override if valid | visit fee if customer at fault | `otp.refused` | OTP-04 [M5] |
| Customer is remote | no OTP | recipient/tracking link receives OTP | – | "Send the start code to the person at home." | recipient OTP | – | none | – | OTP-05 [M5] |
| Technician differs from assigned | identity fraud | customer sees name/photo; can report; OTP tied to assignment | report | "Report a different person?" | pause job, block start | investigate, suspend | none | `safety.identity_mismatch` | OTP-06 [M5] |
| No internet at site | can't start | client queues OTP submission; server validates when online; SMS fallback later | queued | "No connection – we'll send when you're back online." | idempotent replay | – | none | – | OTP-07 [M9] |
| Phone battery dies | status gaps | customer can confirm start/complete from their side (support verifies) | no updates | "Provider unreachable?" | support flag | verify with customer | none | `job.status_gap` | OTP-08 [M9] |
| Provider forgets to update status | stale | reminders; customer "mark as started/done?" prompts | inactivity | "Has work started? Confirm" | customer-side confirmation events | – | none | `job.status_reminder` | OTP-09 [M5] |
| Work starts without approval | payment risk | STARTED only after OTP; provider warned | STARTED missing | – | block completion without STARTED | override w/ reason | – | `job.invalid_transition` | OTP-10 [M5] |

## Scope and quality

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Hidden issue discovered | extra cost | price-revision flow with photos | request | "Provider found an extra issue – review and approve." | PRICE_REVISION_PENDING | – | only if approved | `revision.requested` | SCO-01 [M5] |
| Customer disputes diagnosis | conflict | request clarification / second opinion | clarify | "Ask for clarification or contact support." | CLARIFICATION | mediate | none | `revision.clarify` | SCO-02 [M5] |
| Additional work requested by customer | scope creep | customer-initiated revision request | – | "Add work to this booking?" | provider quotes revision | – | approved revision | `revision.customer_requested` | SCO-03 [M5] |
| Poor workmanship | dispute | completion evidence; 7-day warranty min | dispute | "Report an issue with this job." | DISPUTED, hold | review, rework/refund | hold | `dispute.opened` | SCO-04 [M7] |
| Incomplete work | dispute | completion checklist | reject completion | "Tell us what's incomplete." | back to IN_PROGRESS (adjustment) | – | partial capture | `completion.rejected` | SCO-05 [M5] |
| Warranty claim | rework | warranty_days on quote; claim flow | claim within warranty | "Warranty claim opened." | rework job linked | assign | none to customer | `warranty.claimed` | SCO-06 [M7] |
| Customer damages work after completion | false claim | timestamped completion media/hash | claim after long gap | – | evidence compare | decide | none | – | SCO-07 [M7] |
| Provider uploads false evidence | fraud | hash, EXIF time, geo, duplicate-image check | duplicate hash across jobs | – | flag media | suspend | hold | `media.flagged` | SCO-08 [M9] |
| Customer uploads false damage evidence | fraud | same checks | – | – | flag | reject dispute, strike | none | `media.flagged` | SCO-09 [M9] |
| Rework by original provider | – | rework job type, no new charge | – | "Rework scheduled at no cost." | new linked job | – | none | `job.rework_created` | SCO-10 [M7] |
| Replacement provider | – | support creates replacement job; original payout adjusted | – | "A new provider will complete the work." | linked job | adjust | MANUAL_ADJUSTMENT | `job.replacement_created` | SCO-11 [M8] |

## Materials and vendors

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Out of stock | delay | stock status on quote; quote expiry | vendor marks | "Item unavailable – choose another quote." | quote CANCELLED, others remain | – | release material auth | `material.quote_cancelled` | MAT-01 [M6] |
| Wrong brand / wrong quantity | mismatch | itemised quote w/ brand; delivery confirmation checklist | confirmation rejected | "Report a mismatch." | order on hold | mediate | vendor payout held | `material.mismatch` | MAT-02 [M6] |
| Damaged material | loss | photo at delivery | report ≤ 24 h | "Report damage with a photo." | hold | vendor replace/refund | refund/adjust | `material.damaged` | MAT-03 [M6] |
| Late delivery | job delay | ETA on quote; reminders | ETA passed | "Delivery delayed – new ETA …" | notify | – | none | `material.late` | MAT-04 [M6] |
| Customer rejects substitute | – | substitution needs approval | – | "Approve substitute?" | wait/cancel | – | none | `material.substitute_rejected` | MAT-05 [M6] |
| Price changes after selection | – | quote locked at selection | – | "Price is locked at ₹X." | 409 on vendor change | – | none | – | MAT-06 [M6] |
| Wrong invoice | accounting | invoice amount must equal order | mismatch | "Invoice doesn't match order." | reject upload | – | payout blocked | `invoice.rejected` | MAT-07 [M6] |
| Customer-owned material | liability | material_responsibility=CUSTOMER; no warranty on material | – | "You're supplying materials – warranty covers labour only." | flag on quote | – | none | – | MAT-08 [M4] |
| Unused material after cancellation | loss | return policy per vendor; restock | cancel after order | "Material return being arranged." | order CANCELLED with return | mediate | restock fee adjust | `material.return` | MAT-09 [M6] |
| Vendor closes temporarily | no quotes | operating hours/availability toggle | – | – | exclude from feed | – | none | – | MAT-10 [M6] |
| Vendor changes bank details | fraud | OTP + 24 h payout hold + admin notify | change | "Payouts paused 24 h for safety." | hold | verify | payouts held | `vendor.bank_changed` | MAT-11 [M7] |
| Delivery refusal | – | reason capture | refusal | "Delivery refused – why?" | hold | mediate | per policy | `material.refused` | MAT-12 [M6] |
| Material bought outside platform | leakage | allowed as CUSTOMER/PROVIDER responsibility, no platform warranty | – | – | none | – | none | – | – |

## Payments and refunds

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Payment failure | stuck | retry; alternative method | FAILED webhook | "Payment didn't go through. Try again." | payment FAILED, job PAYMENT_PENDING | – | none | `payment.failed` | PAY-01 [M7] |
| Bank debited, app shows failure | trust | reconciliation poll | gateway state ≠ local | "We're confirming your payment." | reconcile | manual check | none | `payment.reconciled` | PAY-02 [M7] |
| Webhook delay | stuck | poll 2 min/30 min | – | same | reconcile | – | none | – | PAY-03 [M7] |
| Duplicate webhook | double credit | unique provider_event_id | dup | – | ack + ignore | – | none | `webhook.duplicate` | PAY-04 [M7] |
| Duplicate payment | double charge | idempotency key per job/purpose | second order | "Payment already in progress." | 409 | – | auto-refund if gateway double-charged | `payment.duplicate_blocked` | PAY-05 [M7] |
| Partial payment | mismatch | full-amount orders only | amount < expected | "Amount mismatch – support notified." | hold | resolve | hold | `payment.amount_mismatch` | PAY-06 [M7] |
| Payment reversal | loss | DISPUTE_HOLD, freeze settlement | reversal event | "Payment was reversed." | hold | investigate | hold | `payment.reversed` | PAY-07 [M7] |
| Refund failure | trust | retry queue; manual | FAILED | "Refund is being processed." | retry ×3 | manual refund | – | `refund.failed` | PAY-08 [M7] |
| Provider/vendor payout failure | trust | retry; bank verify | FAILED | "Payout delayed – we're fixing it." | retry | manual | – | `settlement.failed` | PAY-09 [M7] |
| Chargeback | loss | evidence pack | gateway event | – | DISPUTE_HOLD, dispute | respond | hold | `payment.chargeback` | PAY-10 [M7] |
| Cash outside platform | leakage/no warranty | copy + detection | chat keywords | "Paying in-app keeps your warranty." | warn, flag | strike | none | `leak.cash_suggested` | PAY-11 [M5] |
| Amount mismatch | – | server computes totals | client total ≠ server | "Price updated – please review." | recompute | – | none | – | PAY-12 [M4] |
| Gateway outage | stuck | circuit breaker; retry; status page | health fail | "Payments are temporarily unavailable." | queue | – | none | `gateway.outage` | PAY-13 [M9] |
| Cancellation after material purchase | loss | policy: material cost non-refundable if delivered | cancel | "Material cost ₹X will apply." | partial refund | mediate | partial | `refund.partial` | PAY-14 [M7] |
| Partial job completion | – | support-mediated | – | "Partial completion – support will adjust." | adjustment | approve | MANUAL_ADJUSTMENT | `ledger.manual_adjustment` | PAY-15 [M7] |

## Disputes and support

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Customer/provider/vendor complaint | – | in-app dispute | – | "Dispute opened. Expect a reply within 24 h." | DISPUTED | review | hold | `dispute.opened` | DIS-01 [M7] |
| No response from one party | stall | 48 h AWAITING_PARTY then decide on evidence | timer | "No response – we'll decide on available evidence." | auto-advance | decide | – | `dispute.no_response` | DIS-02 [M7] |
| Fake complaint | abuse | evidence rules; strike | proven | – | reject | strike | none | `dispute.rejected` | DIS-03 [M7] |
| Repeated refund abuse | loss | ≥3/90 d manual review | counter | – | flag | review | hold | `fraud.refund_pattern` | DIS-04 [M7] |
| Evidence missing / conflict | wrong decision | evidence checklist; verification visit | – | "Please add photos." | request | visit | – | `dispute.evidence_requested` | DIS-05 [M7] |
| Support agent mistake | – | adjustment entries; second reviewer on appeal | appeal | "Your appeal is under review." | reopen | correct via adjustment | MANUAL_ADJUSTMENT | `dispute.reopened` | DIS-06 [M8] |
| Escalation / reopened / appeal | – | states ESCALATED, REOPENED | – | – | – | senior review | – | `dispute.escalated` | DIS-07 [M8] |

## Fraud and abuse

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Fake reviews | trust | review only after COMPLETED by real payer | trigger | – | 403 | remove | none | `review.blocked` | FRA-01 [M7] |
| Self-booking | lead-fee abuse | same device/phone/bank between customer & provider | match | – | flag, no payout | suspend | payout held | `fraud.self_booking` | FRA-02 [M9] |
| Referral/coupon abuse | loss | one per verified user; device limits | pattern | "Offer not applicable." | reject | – | none | `promo.rejected` | FRA-03 [M9] |
| Identity fraud | harm | KYC review; selfie match (manual pilot) | mismatch | – | REJECTED | – | none | `kyc.rejected` | FRA-04 [M8] |
| Fake vendor address / fake invoices | loss | manual verification visit; invoice hash | – | – | UNVERIFIED | verify | payout held | `vendor.rejected` | FRA-05 [M8] |
| Collusion / laundering indicators | legal | velocity + round-number checks; payout caps in pilot | rule hits | – | hold | review, report | hold | `fraud.velocity` | FRA-06 [M9] |
| Repeated chargebacks | loss | block after 2 | count | "Account limited." | limit | review | hold | `fraud.chargebacks` | FRA-07 [M7] |
| Impersonation | harm | verified badge; name/photo shown | report | "Report this person." | pause | suspend | – | `safety.impersonation` | FRA-08 [M8] |
| Manipulated ratings | trust | verified-job reviews only; anomaly detection | spikes | – | flag | remove | none | `review.flagged` | FRA-09 [M9] |
| QR/UPI sharing in chat | leakage | regex + image OCR later; warning | detection | "Sharing payment details outside the app isn't allowed." | mask + flag | strike | none | `leak.upi_detected` | FRA-10 [M5] |

## Safety

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Threats / violence / harassment | harm | SOS button, masked calls, report | report | "Call emergency services if in danger. Support has been alerted." | pause job, alert support, block contact | suspend, cooperate with authorities | hold | `safety.incident` | SAF-01 [M8] |
| Theft allegation | dispute | evidence, technician identity | report | – | dispute PROPERTY/FRAUD | investigate | hold | `safety.theft_alleged` | SAF-02 [M8] |
| Fire / gas leak / live wires / water / structural | danger | emergency banner: call 112/gas helpline first; provider can refuse unsafe work | keywords / report | "Leave the area and call emergency services." | URGENT, safety flag | monitor | none | `safety.hazard` | SAF-03 [M2] |
| Dangerous tools/substances | harm | provider guidelines; customer notice | report | – | flag | review | – | `safety.hazard` | – |
| Child / elderly safety | harm | "someone else at home" notice; recipient field | report | – | flag | review | – | `safety.vulnerable` | – |

## Privacy and security

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Consent withdrawal / marketing opt-out | compliance | consents table; opt-out in profile | – | "Preferences updated." | stop marketing | – | none | `consent.withdrawn` | PRI-01 [M1] |
| Account deletion | compliance vs finance | anonymise PII, retain financial/audit rows | request | "Your account will be deleted in 30 days; financial records are retained as required." | retention_event scheduled | approve | none | `user.deletion_requested` | PRI-02 [M8] |
| Data correction request | compliance | profile edit; support for locked fields | – | – | edit + audit | – | none | `user.data_corrected` | PRI-03 [M8] |
| Location permission denied | UX | manual address entry | – | "Enter your address manually." | fallback | – | none | – | PRI-04 [M2] |
| Voice-note deletion | compliance | delete allowed before SUBMITTED; after that retained per policy | – | "Voice notes are kept for 90 days for support and safety." | retention | – | none | `media.deleted` | PRI-05 [M2] |
| Data breach | legal | encryption, least privilege, monitoring | alert | (per incident plan) | rotate secrets | notify | – | `security.incident` | INCIDENT_RESPONSE |
| Lost admin device | takeover | admin MFA, short sessions, revoke | report | – | revoke sessions | – | – | `admin.sessions_revoked` | PRI-06 [M8] |
| Unauthorized KYC access | legal | admin-only, audited reads, signed URL 5 min | audit anomaly | – | alert | investigate | – | `kyc.accessed` | PRI-07 [M8] |
| Excessive retention | compliance | retention jobs | overdue | – | purge/anonymise | – | – | `retention.executed` | PRI-08 [M9] |
| External processor failure | – | adapters + mock | health | – | degrade gracefully | – | – | – | – |

## Connectivity and devices

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| No network | lost input | offline banner; queued idempotent mutations | NetInfo | "You're offline. We'll retry automatically." | replay on reconnect | – | none | – | NET-01 [M1] |
| App killed during payment | stuck | server state via webhook; resume screen | PENDING on launch | "Resuming your payment…" | poll status | – | none | – | NET-02 [M7] |
| Old device / low storage | crash | Expo min versions; small media compression | – | "Please free up space to upload photos." | compress | – | none | – | NET-03 [M2] |
| Background location disabled | tracking gaps | foreground-only in MVP | – | "Location helps the provider find you." | fallback | – | none | – | NET-04 [M5] |
| App update unavailable | incompat | API version header; min version gate | old version | "Please update the app." | 426 | – | none | – | NET-05 [M1] |
| Duplicate form submission | dup | idempotency keys; disabled buttons | dup key | – | same result | – | none | – | NET-06 [M1] |
| Incorrect device clock | expiry confusion | server time in responses; client offsets | drift > 5 min | – | use server timestamps | – | none | – | NET-07 [M4] |
| Offline message queue | order | client queue w/ ids; server dedupes | – | "Sending…" | dedupe | – | none | – | NET-08 [M5] |
| Stale state display | wrong action | ETag/version on job; 409 on stale write | version mismatch | "This booking was updated – refreshing." | refresh | – | none | – | NET-09 [M2] |

## Infrastructure

| Scenario | Risk | Prevention | Detection | User message | System action | Admin action | Financial | Audit | Test |
|---|---|---|---|---|---|---|---|---|---|
| Database outage | downtime | managed Postgres, PITR backups | health | "Service temporarily unavailable." | 503, maintenance banner | incident | none | `infra.db_outage` | INF-01 [M9] |
| Storage outage | uploads fail | retry, queue | health | "Upload failed – we'll retry." | queue | – | none | – | INF-02 [M9] |
| Payment provider outage | see PAY-13 | | | | | | | | |
| Map provider outage | geocode fail | cached geocodes; manual pin | health | "Maps unavailable – enter address manually." | fallback | – | none | – | INF-03 [M9] |
| Notification outage | missed updates | in-app inbox as source of truth | health | – | in-app only | – | none | – | INF-04 [M9] |
| Failed migration | downtime | forward-only, tested in staging, `migrate:check` | CI | – | halt deploy | rollback plan | none | – | INF-05 [M1] |
| Backup failure | data loss | daily backup + restore test | alert | – | alert | run manual | – | `infra.backup_failed` | INF-06 [M9] |
| Corrupt media | evidence loss | sha256 on upload; verify on read | mismatch | "This file couldn't be loaded." | flag | – | – | `media.corrupt` | INF-07 [M9] |
| Security incident | – | `INCIDENT_RESPONSE.md` | | | | | | | |
| Maintenance mode | – | flag returns 503 with message; reads allowed | flag | "We're doing maintenance. Back by 02:00." | read-only | toggle w/ reason | none | `admin.maintenance` | INF-08 [M8] |
