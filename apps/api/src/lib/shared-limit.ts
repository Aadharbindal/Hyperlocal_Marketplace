import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DataStore } from '../data/types';
import { AppError } from './errors';

/**
 * A rate limit that counts across every node, for the places where the number has to be true.
 *
 * Worth being precise about what this does and does not fix, because the obvious reading of
 * "the rate limiter is in memory" is wrong here in an important way.
 *
 * The limits that stop somebody brute-forcing their way into an account were **already** shared:
 * `requestOtp` counts rows in `otp_challenges` per phone and per IP, and attempts are counted on
 * the challenge row itself. Those are in the database and always were, so a second node never
 * weakened them. That is the control that matters, and it was not broken.
 *
 * What was per-node is the `@fastify/rate-limit` layer in front: a global 300/minute and a
 * 30/hour on the OTP routes, both counted in a Map. Two nodes make those exactly twice as
 * generous as they read, which is the kind of thing nobody notices until they are reading limits
 * off a config file during an incident.
 *
 * The global limit is left per-node on purpose. It exists so that one rude client cannot crowd
 * out others on the node serving it, a DB round trip on every single request is a real cost to
 * pay for tidiness, and being N times more generous about fairness is a capacity question rather
 * than a security one. The OTP routes are different: low volume, and the number should agree
 * with the database-backed one underneath rather than sitting loosely above it.
 */
export function sharedLimit(store: DataStore, opts: { name: string; max: number; windowSeconds: number; key(req: FastifyRequest): string | null }) {
  return async function preHandler(req: FastifyRequest, reply: FastifyReply) {
    const subject = opts.key(req);
    if (!subject) return; // Nothing to key on - the route's own validation will deal with it.

    const hits = await store.cluster.countHit(`${opts.name}:${subject}`, opts.windowSeconds, new Date());
    if (hits > opts.max) {
      // Answered here rather than by throwing into the generic handler so the response carries
      // the same shape as the framework limiter's, which clients already understand.
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment.',
          requestId: req.id,
        },
      });
    }
    return;
  };
}

/** Kept for callers that would rather throw than reply. */
export function rateLimited(): AppError {
  return new AppError('RATE_LIMITED');
}
