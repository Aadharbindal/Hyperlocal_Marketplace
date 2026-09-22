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

export const UserView = z.object({
  id: z.string().uuid(),
  phoneMasked: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
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
  })
  .strict();
export type UpdateMeBody = z.infer<typeof UpdateMeBody>;

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
