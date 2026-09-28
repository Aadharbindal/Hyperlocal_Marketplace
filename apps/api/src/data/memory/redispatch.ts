import { conflict } from '../../lib/errors';
import { newId } from '../../lib/crypto';
import type { RedispatchInvitationRecord, RedispatchRepo } from '../types';

/**
 * The in-memory mirror of 0018.
 *
 * Every constraint in that migration is reproduced here by hand, including the two that only
 * matter under a race: one invitation per provider per job, and at most one accepted invitation
 * per job. The second is the one that stops two professionals being sent to the same address,
 * and a memory store that let it through would make the tests that prove it meaningless.
 */
export function memoryRedispatchRepo(): RedispatchRepo {
  const invitations: RedispatchInvitationRecord[] = [];
  const now = () => new Date();

  return {
    async invite(i) {
      // mirrors redispatch_invitations_unique
      if (invitations.some((x) => x.job_id === i.job_id && x.provider_id === i.provider_id)) {
        throw conflict({ reason: 'already_invited' });
      }
      const rec: RedispatchInvitationRecord = { ...i, id: newId(), created_at: now() };
      invitations.push(rec);
      return rec;
    },

    async listForJob(jobId) {
      return invitations.filter((i) => i.job_id === jobId).sort((a, b) => a.invited_at.getTime() - b.invited_at.getTime());
    },

    async listOpenForProvider(providerId, at) {
      return invitations.filter((i) => i.provider_id === providerId && !i.responded_at && i.expires_at > at);
    },

    async get(id) {
      return invitations.find((i) => i.id === id) ?? null;
    },

    async respond(id, outcome, at) {
      const rec = invitations.find((i) => i.id === id);
      if (!rec || rec.responded_at) return null;
      // mirrors redispatch_invitations_one_winner: the second acceptance loses rather than
      // producing a job with two professionals on their way to it.
      if (outcome === 'ACCEPTED' && invitations.some((i) => i.job_id === rec.job_id && i.outcome === 'ACCEPTED')) {
        return null;
      }
      rec.responded_at = at;
      rec.outcome = outcome;
      return rec;
    },

    async closeOpen(jobId, outcome, at) {
      let n = 0;
      for (const i of invitations) {
        if (i.job_id === jobId && !i.responded_at) {
          i.responded_at = at;
          i.outcome = outcome;
          n++;
        }
      }
      return n;
    },

  };
}
