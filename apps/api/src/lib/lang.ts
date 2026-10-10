import type { FastifyRequest } from 'fastify';
import type { Language } from '@hyperlocal/core';

/**
 * Which language to answer a request in.
 *
 * The account's own setting wins, because somebody who chose Hindi in the app means it on every
 * device; `Accept-Language` is the fallback for a request made before anybody has signed in.
 *
 * This existed twice, in `jobs/routes.ts` and `provider/routes.ts`, and a third copy was about to
 * be written for the conversations list. Two identical copies are a coincidence; three are a rule
 * nobody wrote down, and the one that matters here is the order of precedence - a copy that
 * checked the header first would quietly answer a Hindi-speaking customer in English whenever
 * their phone was set to English, which is most of them.
 */
export function langOf(req: FastifyRequest): Language {
  return req.auth?.user.preferred_language ?? (req.headers['accept-language']?.toString().startsWith('hi') ? 'hi' : 'en');
}
