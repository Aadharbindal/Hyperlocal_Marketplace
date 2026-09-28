import { newId } from '../../lib/crypto';
import { conflict } from '../../lib/errors';
import type { ServicePlanOccurrenceRecord, ServicePlanRecord, ServicePlansRepo } from '../types';

/** Whole days, so comparisons here mean the same thing a `date` column means. */
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * The in-memory mirror of 0020.
 *
 * Two constraints matter enough to reproduce by hand. One live plan per customer, category and
 * address - a second one silently doubles every future booking. And one occurrence per due date,
 * which is the guard that stops an hourly sweep re-booking the same visit after a partial
 * failure, over and over, until somebody notices fourteen identical jobs.
 */
export function memoryServicePlansRepo(): ServicePlansRepo {
  const plans = new Map<string, ServicePlanRecord>();
  const occurrences: ServicePlanOccurrenceRecord[] = [];
  const now = () => new Date();

  return {
    async create(p) {
      // mirrors service_plans_one_per_target
      for (const other of plans.values()) {
        if (
          other.status !== 'CANCELLED' &&
          other.customer_id === p.customer_id &&
          other.category_id === p.category_id &&
          other.address_id === p.address_id
        ) {
          throw conflict({ reason: 'plan_already_exists' });
        }
      }
      const rec: ServicePlanRecord = { ...p, id: newId(), created_at: now(), updated_at: now() };
      plans.set(rec.id, rec);
      return rec;
    },

    async get(id) {
      return plans.get(id) ?? null;
    },

    async update(id, patch) {
      const p = plans.get(id);
      if (!p) throw new Error('service plan not found');
      const next = { ...p, ...patch, updated_at: now() };
      // The unique index is partial on status - reviving a cancelled plan must not collide with
      // one created in the meantime.
      if (next.status !== 'CANCELLED') {
        for (const other of plans.values()) {
          if (
            other.id !== id &&
            other.status !== 'CANCELLED' &&
            other.customer_id === next.customer_id &&
            other.category_id === next.category_id &&
            other.address_id === next.address_id
          ) {
            throw conflict({ reason: 'plan_already_exists' });
          }
        }
      }
      plans.set(id, next);
      return next;
    },

    async listForCustomer(customerId) {
      return [...plans.values()]
        .filter((p) => p.customer_id === customerId && p.status !== 'CANCELLED')
        .sort((a, b) => a.next_due_on.getTime() - b.next_due_on.getTime());
    },

    async listDue(onOrBefore, limit) {
      const cutoff = day(onOrBefore).getTime();
      return [...plans.values()]
        .filter((p) => p.status === 'ACTIVE' && day(p.next_due_on).getTime() - p.lead_days * 86_400_000 <= cutoff)
        .sort((a, b) => a.next_due_on.getTime() - b.next_due_on.getTime())
        .slice(0, limit);
    },

    async recordOccurrence(o) {
      // mirrors service_plan_occurrences_once. Null rather than an exception: the caller's
      // correct response is "somebody already handled this date", not "something went wrong".
      const due = day(o.due_on).getTime();
      if (occurrences.some((x) => x.plan_id === o.plan_id && day(x.due_on).getTime() === due)) return null;
      const rec: ServicePlanOccurrenceRecord = { ...o, id: newId(), created_at: now() };
      occurrences.push(rec);
      return rec;
    },

    async updateOccurrence(id, patch) {
      const rec = occurrences.find((o) => o.id === id);
      if (!rec) throw new Error('occurrence not found');
      Object.assign(rec, patch);
      return rec;
    },

    async listOccurrences(planId, limit) {
      return occurrences
        .filter((o) => o.plan_id === planId)
        .sort((a, b) => b.due_on.getTime() - a.due_on.getTime())
        .slice(0, limit);
    },
  };
}
