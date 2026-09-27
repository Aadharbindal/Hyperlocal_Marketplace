import type { FastifyInstance } from 'fastify';
import { readGrant, readObject, writeObject } from '../../adapters/local-storage';
import { AppError } from '../../lib/errors';
import type { AppContext } from '../../app';

/**
 * The two endpoints that make locally stored files real.
 *
 * Deliberately **not** behind `requireAuth`. The grant in the URL is the authorisation: it is
 * signed, scoped to one key, one content type, one size ceiling and one operation, and it
 * expires. That is the same shape as an S3 presigned URL, and it has to be, because these URLs
 * are handed to an `<Image>` tag and to a background upload - neither of which carries a bearer
 * token.
 *
 * The consequence worth being awake to: anyone holding the URL can use it until it expires.
 * That is why the TTL is short, why a read grant cannot write, and why the key is never taken
 * from the caller - only from inside a signature we produced.
 */
export async function storageRoutes(app: FastifyInstance, ctx: AppContext) {
  const { env, store, adapters } = ctx;
  if (adapters.storage.provider !== 'local') return;

  const root = (adapters.storage as unknown as { root: string }).root;

  // Bytes arrive raw. Registering the parser only on this route keeps every other route's
  // strict JSON handling exactly as it was.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.put('/storage/upload', async (req, reply) => {
    const token = (req.query as { token?: string } | null)?.token;
    const grant = token ? readGrant(token, env.API_JWT_SECRET) : null;
    if (!grant || grant.o !== 'put') throw new AppError('FORBIDDEN', { details: { reason: 'invalid_or_expired_upload_grant' } });

    const bytes = req.body as Buffer;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new AppError('VALIDATION_ERROR', { details: { body: 'empty_upload' } });
    }
    // The ceiling was agreed when the row was created, from the size the client declared. A
    // client that declares 80 KB and sends 8 MB is refused here rather than filling the disk.
    if (bytes.length > grant.x) {
      throw new AppError('VALIDATION_ERROR', { details: { body: 'upload_larger_than_declared', declared: grant.x, received: bytes.length } });
    }
    const contentType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (grant.m && contentType && contentType !== grant.m) {
      throw new AppError('VALIDATION_ERROR', { details: { body: 'content_type_mismatch', expected: grant.m, received: contentType } });
    }

    await writeObject(root, grant.k, bytes, env.API_JWT_SECRET);

    // Marked here rather than waiting for the client to say so. With a real provider the client
    // PUTs somewhere we cannot see and has to confirm afterwards; here the bytes came through
    // this process, so the server knows first-hand and a client that crashes mid-flow does not
    // leave a row that claims to have a file and does not.
    await store.jobs.markMediaUploadedByKey(grant.k, new Date());

    return reply.code(204).send();
  });

  app.get('/storage/object', async (req, reply) => {
    const token = (req.query as { token?: string } | null)?.token;
    const grant = token ? readGrant(token, env.API_JWT_SECRET) : null;
    // A grant issued for uploading must not double as a way to read the file back.
    if (!grant || grant.o !== 'get') throw new AppError('FORBIDDEN', { details: { reason: 'invalid_or_expired_read_grant' } });

    // Read through the adapter rather than streaming the file: an encrypted object has to be
    // decrypted whole, and a single path for both kinds means one of them cannot be forgotten.
    const bytes = await readObject(root, grant.k, env.API_JWT_SECRET);
    if (!bytes) throw new AppError('NOT_FOUND', { details: { reason: 'object_missing' } });

    const media = await store.jobs.findMediaByKey(grant.k);
    reply.header('content-type', media?.mime ?? 'application/octet-stream');
    reply.header('content-length', String(bytes.length));
    // Private: these are somebody's home, their broken geyser, their identity document. A CDN
    // or a shared proxy holding one of these is a leak that outlives the signed URL.
    reply.header('cache-control', 'private, no-store');
    return reply.send(bytes);
  });
}
