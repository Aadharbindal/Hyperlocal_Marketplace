import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bearer, login, makeApp, type TestApp } from './helpers';

let app: TestApp;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hyperlocal-storage-'));
  app = await makeApp({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: dir });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Does a photo attached to a job actually exist afterwards?
 *
 * Nothing asked that before. The storage adapter was a mock that issued a `mock://` URL nobody
 * could PUT to, so the API marked every media row uploaded on creation and told the client to
 * skip the transfer. Every test about evidence passed against rows that referred to no bytes at
 * all - and completion photos are what a dispute is decided on. The whole suite stayed green
 * through this change for exactly that reason: no test had ever looked.
 */
describe('a file attached to a job', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  async function draftWithCustomer(phone: string) {
    const res = await login(app, phone);
    const h = bearer(res.accessToken);
    await app.inject({ method: 'POST', url: '/me/roles', headers: h, payload: { role: 'CUSTOMER' } });
    const address = await app.inject({
      method: 'POST', url: '/me/addresses', headers: h,
      payload: { line1: '14, Lodhi Colony', city: 'Delhi', pincode: '110003' },
    });
    const categories = await app.inject({ method: 'GET', url: '/categories', headers: h });
    const plumbing = categories.json().items.find((c: { slug: string }) => c.slug === 'plumbing');
    const draft = await app.inject({
      method: 'POST', url: '/jobs', headers: h,
      payload: { categoryId: plumbing.id, addressId: address.json().id, description: 'Tap dripping into the cupboard' },
    });
    return { headers: h, jobId: draft.json().id as string };
  }

  async function attach(jobId: string, headers: Record<string, string>, sizeBytes = PNG.length) {
    const res = await app.inject({
      method: 'POST', url: `/jobs/${jobId}/media`, headers,
      payload: { kind: 'PHOTO', mime: 'image/png', sizeBytes },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { media: { id: string }; upload: { url: string; method: string; required: boolean } };
  }

  /** The signed URLs are absolute; inject wants a path. */
  const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

  it('is stored, and comes back byte for byte', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000001');
    const { media, upload } = await attach(jobId, headers);

    // The client is told to transfer, which the mock never was.
    expect(upload.required).toBe(true);

    const put = await app.inject({
      method: 'PUT', url: pathOf(upload.url),
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });
    expect(put.statusCode).toBe(204);

    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers });
    const row = job.json().media.find((m: { id: string }) => m.id === media.id);
    expect(row.url).toBeTruthy();

    const read = await app.inject({ method: 'GET', url: pathOf(row.url) });
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/png');
    // The actual bytes, not a row that claims them.
    expect(Buffer.compare(read.rawPayload, PNG)).toBe(0);
  });

  it('is not marked uploaded until the bytes arrive', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000002');
    const { media } = await attach(jobId, headers);

    const row = await app.ctx.store.jobs.getMedia(media.id);
    // This is the bug the whole change is about: it used to be stamped on creation.
    expect(row!.uploaded_at).toBeNull();
  });

  it('refuses more bytes than the client declared', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000003');
    // Declare something small, then try to send the real file.
    const { upload } = await attach(jobId, headers, 10);

    const put = await app.inject({
      method: 'PUT', url: pathOf(upload.url),
      headers: { 'content-type': 'image/png' },
      payload: PNG,
    });
    // Otherwise a size limit is a suggestion and the disk is somebody else's problem.
    expect(put.statusCode).toBe(400);
  });

  it('refuses a body that is not what was agreed', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000004');
    const { upload } = await attach(jobId, headers);

    const put = await app.inject({
      method: 'PUT', url: pathOf(upload.url),
      headers: { 'content-type': 'application/x-msdownload' },
      payload: PNG,
    });
    expect(put.statusCode).toBe(400);
  });

  it('refuses a tampered or unsigned grant', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000005');
    const { upload } = await attach(jobId, headers);
    const url = pathOf(upload.url);

    for (const bad of [url.slice(0, -3) + 'aaa', '/storage/upload?token=nonsense', '/storage/upload']) {
      const put = await app.inject({ method: 'PUT', url: bad, headers: { 'content-type': 'image/png' }, payload: PNG });
      expect(put.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('will not let an upload grant be used to read the file back', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000006');
    const { upload } = await attach(jobId, headers);
    const token = new URL(upload.url).searchParams.get('token')!;

    // Same signature, different operation. A grant says what it permits, not just who signed it.
    const read = await app.inject({ method: 'GET', url: `/storage/object?token=${token}` });
    expect(read.statusCode).toBe(403);
  });

  it('does not serve a file that was never uploaded', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000007');
    await attach(jobId, headers);

    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers });
    const row = job.json().media[0];
    const read = await app.inject({ method: 'GET', url: pathOf(row.url) });
    // A row exists, bytes do not, and the answer says so rather than serving an empty file.
    expect(read.statusCode).toBe(404);
  });

  it('writes an identity document to disk encrypted, and a job photo in the clear', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, sep } = await import('node:path');

    // A provider submits a document through the ordinary route.
    const res = await login(app, '+919666000009');
    const h = bearer(res.accessToken, { 'x-active-role': 'PROVIDER' });
    await app.inject({ method: 'POST', url: '/me/roles', headers: bearer(res.accessToken), payload: { role: 'PROVIDER' } });
    await app.inject({ method: 'PUT', url: '/provider/profile', headers: h, payload: { businessName: 'Shop 0009' } });
    const kyc = await app.inject({
      method: 'POST', url: '/provider/kyc', headers: h,
      payload: { documentType: 'AADHAAR', documentNumber: '123456789012', mime: 'image/png', sizeBytes: PNG.length },
    });
    expect(kyc.statusCode).toBe(201);

    const target = kyc.json().upload.url as string;
    const put = await app.inject({ method: 'PUT', url: pathOf(target), headers: { 'content-type': 'image/png' }, payload: PNG });
    expect(put.statusCode).toBe(204);

    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const full = join(d, e);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(dir);

    const doc = files.find((f) => f.split(sep).join('/').includes('/kyc/'))!;
    expect(doc).toBeTruthy();
    const onDisk = readFileSync(doc);
    // The bytes on disk are not the bytes that were uploaded. A stolen disk, a stray backup or
    // a misconfigured bucket is most of how document leaks actually happen.
    expect(Buffer.compare(onDisk, PNG)).not.toBe(0);
    expect(onDisk.length).toBeGreaterThan(PNG.length);
  });

  it('is gone from disk once the customer removes it', async () => {
    const { headers, jobId } = await draftWithCustomer('+919666000008');
    const { media, upload } = await attach(jobId, headers);
    await app.inject({ method: 'PUT', url: pathOf(upload.url), headers: { 'content-type': 'image/png' }, payload: PNG });

    const job = await app.inject({ method: 'GET', url: `/jobs/${jobId}`, headers });
    const url = pathOf(job.json().media.find((m: { id: string }) => m.id === media.id).url);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);

    await app.inject({ method: 'DELETE', url: `/jobs/${jobId}/media/${media.id}`, headers });

    // Deleting the row has to delete the bytes too, or "delete my photo" is a lie told to
    // somebody who asked for their picture of their home to be removed.
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
  });
});
