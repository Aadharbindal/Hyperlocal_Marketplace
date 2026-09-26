import { clear, enqueue, flush, isQueueable, pending } from './outbox';

/**
 * The outbox sits next to money, so what it will and will not repeat is worth testing directly.
 */

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: string | null = null;
  return {
    getItem: jest.fn(async () => store),
    setItem: jest.fn(async (_key: string, value: string) => {
      store = value;
    }),
  };
});

beforeEach(async () => {
  await clear();
});

describe('what may be queued', () => {
  it('queues the writes a person takes while walking around a building', () => {
    expect(isQueueable('/jobs/abc/progress', 'POST')).toEqual({ label: 'Status update' });
    expect(isQueueable('/jobs/abc/chat', 'POST')).toEqual({ label: 'Message' });
    expect(isQueueable('/jobs/abc/complete', 'POST')).toEqual({ label: 'Job marked done' });
    expect(isQueueable('/provider/availability', 'POST')).toEqual({ label: 'Availability' });
  });

  it('never queues anything that moves money', () => {
    // A person needs to watch a payment succeed or fail while they are looking at the screen.
    // "We will send this later" is not an acceptable answer about somebody's money.
    expect(isQueueable('/bids/abc/accept', 'POST')).toBeNull();
    expect(isQueueable('/payments/abc/mock-complete', 'POST')).toBeNull();
    expect(isQueueable('/jobs/abc/approve', 'POST')).toBeNull();
    expect(isQueueable('/jobs/abc/cancel', 'POST')).toBeNull();
    expect(isQueueable('/me/payout-account', 'POST')).toBeNull();
  });

  it('is an allow-list, so a new endpoint is not silently queueable', () => {
    expect(isQueueable('/some/brand/new/route', 'POST')).toBeNull();
    expect(isQueueable('/jobs/abc', 'GET')).toBeNull();
  });
});

describe('replaying what was saved', () => {
  it('sends the same request rather than a similar one', async () => {
    await enqueue({ path: '/jobs/a/progress', method: 'POST', body: { to: 'EN_ROUTE' }, idempotencyKey: 'key-1', label: 'Status update' });

    const sent: Array<{ path: string; idempotencyKey: string }> = [];
    const result = await flush(async (entry) => {
      sent.push({ path: entry.path, idempotencyKey: entry.idempotencyKey });
    });

    expect(result).toEqual({ sent: 1, dropped: 0, remaining: 0 });
    // The key the caller already had, so a retry after a reply we never saw cannot produce a
    // second anything.
    expect(sent[0]).toEqual({ path: '/jobs/a/progress', idempotencyKey: 'key-1' });
  });

  it('gives an entry a key of its own when the caller had none', async () => {
    await enqueue({ path: '/jobs/a/chat', method: 'POST', body: { body: 'on my way' }, label: 'Message' });
    const [entry] = await pending();
    expect(entry!.idempotencyKey).toBeTruthy();
  });

  it('stops at the first network failure instead of hammering a dead connection', async () => {
    await enqueue({ path: '/jobs/a/progress', method: 'POST', label: 'Status update' });
    await enqueue({ path: '/jobs/b/progress', method: 'POST', label: 'Status update' });

    let attempts = 0;
    const result = await flush(async () => {
      attempts++;
      throw Object.assign(new Error('offline'), { code: 'NETWORK' });
    });

    // One attempt, both kept: if one request cannot reach the server, neither can the next.
    expect(attempts).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.sent).toBe(0);
  });

  it('drops what the server refused on its merits', async () => {
    await enqueue({ path: '/jobs/a/complete', method: 'POST', label: 'Job marked done' });

    const result = await flush(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 });
    });

    // Retrying a 400 produces a 400.
    expect(result.dropped).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it('keeps trying through a server fault, which may pass', async () => {
    await enqueue({ path: '/jobs/a/progress', method: 'POST', label: 'Status update' });

    const result = await flush(async () => {
      throw Object.assign(new Error('bad gateway'), { status: 502 });
    });

    expect(result.remaining).toBe(1);
    expect((await pending())[0]!.attempts).toBe(1);
  });

  it('gives up on a server fault that never passes', async () => {
    await enqueue({ path: '/jobs/a/progress', method: 'POST', label: 'Status update' });

    for (let i = 0; i < 5; i++) {
      await flush(async () => {
        throw Object.assign(new Error('bad gateway'), { status: 502 });
      });
    }
    expect(await pending()).toHaveLength(0);
  });

  it('throws away news that stopped being true yesterday', async () => {
    await enqueue({ path: '/jobs/a/progress', method: 'POST', label: 'Status update' });
    const stale = await pending();
    // Backdate it past the day the outbox keeps things for.
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'outbox.v1',
      JSON.stringify([{ ...stale[0], queuedAt: Date.now() - 25 * 3600_000 }]),
    );

    const result = await flush(async () => {
      throw new Error('should not have been sent');
    });
    // Telling a customer "I am on my way" a day late is worse than not telling them.
    expect(result.dropped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('does nothing at all when there is nothing waiting', async () => {
    const send = jest.fn();
    expect(await flush(send)).toEqual({ sent: 0, dropped: 0, remaining: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
