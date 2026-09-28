import { z } from 'zod';
import { CONSENT_TYPES, LANGUAGES, SELF_SERVICE_ROLES, USER_ROLES, USER_STATUSES, ROLE_STATUSES } from './enums';
import { normaliseIndianPhone } from '../otp/otp';

export const PhoneSchema = z
  .string()
  .min(10)
  .max(20)
  .transform((v, ctx) => {
    const n = normaliseIndianPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Indian mobile number' });
      return z.NEVER;
    }
    return n;
  });

export const RequestOtpBody = z.object({ phone: PhoneSchema });
export type RequestOtpBody = z.input<typeof RequestOtpBody>;

export const RequestOtpResponse = z.object({
  challengeId: z.string().uuid(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
  /** Only present when SMS adapter is the mock. Never in production. */
  demoCode: z.string().optional(),
});
export type RequestOtpResponse = z.infer<typeof RequestOtpResponse>;

export const VerifyOtpBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{4,8}$/),
  deviceLabel: z.string().max(80).optional(),
});
export type VerifyOtpBody = z.infer<typeof VerifyOtpBody>;

export const UserRoleSchema = z.enum(USER_ROLES);

export const UserRoleView = z.object({
  role: UserRoleSchema,
  status: z.enum(ROLE_STATUSES),
});

/**
 * An email address, normalised the way the database's unique index compares them.
 *
 * Lower-cased and trimmed here rather than at each call site, because `Aadhar@` and `aadhar@`
 * reaching different code paths is how you end up with two accounts for one person and a
 * unique-violation at the point of sale.
 */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  // Deliberately the same shape the `users_email_shape` check constraint enforces in 0016. A
  // stricter regex here than in the database would reject rows the database is happy to hold;
  // a looser one would turn a typo into a 500.
  .regex(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/, 'Enter a valid email address');

export const UserView = z.object({
  id: z.string().uuid(),
  phoneMasked: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  email: z.string().nullable(),
  /** Whether that address has been confirmed, not merely typed. Receipts only go to a confirmed one. */
  emailVerified: z.boolean(),
  preferredLanguage: z.enum(LANGUAGES),
  status: z.enum(USER_STATUSES),
  roles: z.array(UserRoleView),
  createdAt: z.string(),
});
export type UserView = z.infer<typeof UserView>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});

export const VerifyOtpResponse = AuthTokens.extend({
  user: UserView,
  isNewUser: z.boolean(),
});
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

export const RefreshBody = z.object({ refreshToken: z.string().min(20) });
export const LogoutBody = z.object({ refreshToken: z.string().min(20).optional(), all: z.boolean().optional() });

export const UpdateMeBody = z
  .object({
    displayName: z.string().trim().min(2).max(60).optional(),
    preferredLanguage: z.enum(LANGUAGES).optional(),
    /** `null` clears the address. Changing it always drops the verified flag - see the route. */
    email: EmailSchema.nullable().optional(),
    /**
     * The storage key of a photo the client has already uploaded, not a URL.
     *
     * A URL from a client is a request to make our app render whatever it points at; a key is
     * checked against the prefix this user is allowed to write to before it is stored.
     */
    avatarKey: z.string().max(200).nullable().optional(),
  })
  .strict();
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

/**
 * The first screen after the OTP, for an account that has just come into existence.
 *
 * Separate from `UpdateMeBody` because the rules are different: here a name is required (this is
 * the one moment we can insist), and accepting the terms is part of the same submission rather
 * than a box that can be left for later.
 */
/**
 * The version of the terms this build asks people to accept.
 *
 * Shared rather than declared per screen, because two copies drift and what is recorded against
 * an account has to be what was actually on screen. When the terms are revised this moves in the
 * same commit as the text, and everybody who accepted 1.0 stays on record as having accepted 1.0.
 */
export const CURRENT_TERMS_VERSION = '1.0';

export const CompleteProfileBody = z
  .object({
    displayName: z.string().trim().min(2).max(60),
    email: EmailSchema.optional(),
    preferredLanguage: z.enum(LANGUAGES).optional(),
    acceptedTermsVersion: z.string().min(1).max(20),
    marketingOptIn: z.boolean().default(false),
  })
  .strict();
export type CompleteProfileBody = z.infer<typeof CompleteProfileBody>;

export const AvatarUploadBody = z
  .object({
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytes: z.number().int().positive().max(5 * 1024 * 1024),
  })
  .strict();
export type AvatarUploadBody = z.infer<typeof AvatarUploadBody>;

export const AvatarUploadResponse = z.object({
  key: z.string(),
  url: z.string(),
  method: z.enum(['PUT', 'POST']),
  expiresAt: z.string(),
});
export type AvatarUploadResponse = z.infer<typeof AvatarUploadResponse>;

export const GrantRoleBody = z.object({
  role: z.enum(USER_ROLES).refine((r) => (SELF_SERVICE_ROLES as readonly string[]).includes(r), {
    message: 'This role cannot be self-assigned',
  }),
});
export type GrantRoleBody = z.infer<typeof GrantRoleBody>;

export const ConsentBody = z.object({
  type: z.enum(CONSENT_TYPES),
  version: z.string().min(1).max(20),
  granted: z.boolean(),
});
export type ConsentBody = z.infer<typeof ConsentBody>;

export const ConsentView = ConsentBody.extend({
  grantedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
});

export const MeResponse = z.object({
  user: UserView,
  consents: z.array(ConsentView),
  profiles: z.object({
    customer: z.object({ fullName: z.string().nullable(), email: z.string().nullable() }).nullable(),
    provider: z
      .object({
        businessName: z.string().nullable(),
        verificationStatus: z.string(),
        isAvailable: z.boolean(),
        serviceRadiusKm: z.number(),
      })
      .nullable(),
    vendor: z.object({ shopName: z.string().nullable(), verificationStatus: z.string() }).nullable(),
    contractor: z.object({ businessName: z.string().nullable(), verificationStatus: z.string() }).nullable(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;
