import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@hyperlocal/core';
import type { Env } from '../../config/env';
import { AppError } from '../../lib/errors';

export interface AccessClaims {
  sub: string;
  roles: UserRole[];
  sid: string; // session id, lets us reject tokens from revoked sessions
}

export function tokenService(env: Env) {
  const key = new TextEncoder().encode(env.API_JWT_SECRET);
  return {
    async signAccess(claims: AccessClaims): Promise<string> {
      return new SignJWT({ roles: claims.roles, sid: claims.sid })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.sub)
        .setIssuer(env.API_JWT_ISSUER)
        .setIssuedAt()
        .setExpirationTime(`${env.API_ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },
    async verifyAccess(token: string): Promise<AccessClaims> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: env.API_JWT_ISSUER });
        if (!payload.sub || typeof payload.sid !== 'string' || !Array.isArray(payload.roles)) {
          throw new AppError('AUTH_INVALID_TOKEN');
        }
        return { sub: payload.sub, roles: payload.roles as UserRole[], sid: payload.sid };
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError('AUTH_INVALID_TOKEN', { cause: e });
      }
    },
  };
}
export type TokenService = ReturnType<typeof tokenService>;
