import { z } from 'zod';
import { DISPUTE_CATEGORIES, STRIKE_SEVERITIES } from './enums';
import { DISPUTE_RESOLUTIONS, DISPUTE_STATUSES, SETTLEMENT_STATUSES } from '../finance/settlement';
import { LEDGER_ENTRY_TYPES } from '../finance/ledger';

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export const CancelJobBody = z
  .object({
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type CancelJobBody = z.infer<typeof CancelJobBody>;

export const CancellationQuoteView = z.object({
  stage: z.string(),
  chargePaise: z.number().int(),
  refundPaise: z.number().int(),
  needsSupport: z.boolean(),
  explanation: z.string(),
});
export type CancellationQuoteView = z.infer<typeof CancellationQuoteView>;

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export const RaiseDisputeBody = z
  .object({
    category: z.enum(DISPUTE_CATEGORIES),
    description: z.string().trim().min(20).max(2000),
    mediaIds: z.array(z.string().uuid()).max(8).optional(),
  })
  .strict();
export type RaiseDisputeBody = z.infer<typeof RaiseDisputeBody>;

export const DisputeEvidenceBody = z
  .object({
    mediaIds: z.array(z.string().uuid()).min(1).max(8),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type DisputeEvidenceBody = z.infer<typeof DisputeEvidenceBody>;

export const ResolveDisputeBody = z
  .object({
    resolution: z.enum(DISPUTE_RESOLUTIONS),
    reason: z.string().trim().min(20).max(1000),
    refundPaise: z.number().int().min(0).optional(),
    strike: z
      .object({ userId: z.string().uuid(), severity: z.enum(STRIKE_SEVERITIES), reason: z.string().trim().min(5).max(300) })
      .optional(),
    /** A second approver's user id, required above the refund threshold. */
    secondApproverId: z.string().uuid().optional(),
  })
  .strict()
  .refine((b) => b.resolution !== 'PARTIAL_REFUND' || (b.refundPaise ?? 0) > 0, { message: 'A partial refund needs an amount' });
export type ResolveDisputeBody = z.infer<typeof ResolveDisputeBody>;

export const DisputeView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  category: z.enum(DISPUTE_CATEGORIES),
  status: z.enum(DISPUTE_STATUSES),
  description: z.string(),
  raisedByMe: z.boolean(),
  againstMe: z.boolean(),
  slaDueAt: z.string(),
  needsHuman: z.boolean(),
  resolution: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  refundPaise: z.number().int().nullable(),
  evidenceUrls: z.array(z.string()),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DisputeView = z.infer<typeof DisputeView>;

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export const ReviewBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(600).optional(),
  })
  .strict();
export type ReviewBody = z.infer<typeof ReviewBody>;

export const ReviewView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  reviewerName: z.string(),
  createdAt: z.string(),
});
export type ReviewView = z.infer<typeof ReviewView>;

// ---------------------------------------------------------------------------
// Where the money goes
// ---------------------------------------------------------------------------

export const PayoutAccountBody = z
  .discriminatedUnion('method', [
    z
      .object({
        method: z.literal('BANK_ACCOUNT'),
        accountHolderName: z.string().trim().min(3).max(100),
        accountNumber: z.string().trim().regex(/^\d{9,18}$/),
        ifsc: z.string().trim().length(11),
      })
      .strict(),
    z
      .object({
        method: z.literal('UPI'),
        accountHolderName: z.string().trim().min(3).max(100),
        vpa: z.string().trim().min(5).max(80),
      })
      .strict(),
  ]);
export type PayoutAccountBody = z.infer<typeof PayoutAccountBody>;

/** What comes back: enough to recognise the account, never enough to use it. */
export const PayoutAccountView = z.object({
  id: z.string().uuid(),
  method: z.enum(['BANK_ACCOUNT', 'UPI']),
  accountHolderName: z.string(),
  /** Masked - the full number lives with the payment provider, not with us. */
  masked: z.string(),
  ifsc: z.string().nullable(),
  status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'DISABLED']),
  rejectionReason: z.string().nullable(),
  /** True once the payout provider has registered the payee and money can actually be sent. */
  readyForPayouts: z.boolean(),
  createdAt: z.string(),
});
export type PayoutAccountView = z.infer<typeof PayoutAccountView>;

// ---------------------------------------------------------------------------
// Money views
// ---------------------------------------------------------------------------

export const LedgerEntryView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  entryType: z.enum(LEDGER_ENTRY_TYPES),
  amountPaise: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type LedgerEntryView = z.infer<typeof LedgerEntryView>;

export const SettlementView = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  amountPaise: z.number().int(),
  status: z.enum(SETTLEMENT_STATUSES),
  payeeRole: z.string(),
  attempts: z.number().int(),
  failureReason: z.string().nullable(),
  initiatedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SettlementView = z.infer<typeof SettlementView>;

/** What a provider or vendor is owed, has been paid, and is waiting on. */
export const EarningsView = z.object({
  currency: z.literal('INR'),
  pendingPaise: z.number().int(),
  settledPaise: z.number().int(),
  onHoldPaise: z.number().int(),
  lifetimePaise: z.number().int(),
  jobsCompleted: z.number().int(),
  /** Null until the payee says where to send their money; payouts wait until it is set. */
  payoutAccount: PayoutAccountView.nullable(),
  /** Earned, but unpayable until there is somewhere to send it. */
  awaitingPayoutAccountPaise: z.number().int(),
  settlements: z.array(SettlementView),
  recentEntries: z.array(LedgerEntryView),
});
export type EarningsView = z.infer<typeof EarningsView>;

/** The money a customer can see on one job: what is held, captured or refunded. */
export const JobMoneyView = z.object({
  jobId: z.string().uuid(),
  authorizedPaise: z.number().int(),
  capturedPaise: z.number().int(),
  refundedPaise: z.number().int(),
  materialPaise: z.number().int(),
  status: z.string(),
  refunds: z.array(
    z.object({
      id: z.string().uuid(),
      amountPaise: z.number().int(),
      reason: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type JobMoneyView = z.infer<typeof JobMoneyView>;
