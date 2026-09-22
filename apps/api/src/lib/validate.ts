import type { ZodTypeAny, z } from 'zod';
import { AppError } from './errors';

/** Parse with zod and convert failures into a 400 with field-level details (no stack traces). */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_ERROR', {
      details: {
        fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  return r.data;
}
