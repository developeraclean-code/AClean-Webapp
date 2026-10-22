import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthCheck, selectHealthComponent } from '../../../api/_health.js';

const env = { SUPABASE_URL: 'https://database.simulated.test', SUPABASE_SERVICE_KEY: 'FAKE', FONNTE_TOKEN: 'FAKE', VERCEL_GIT_COMMIT_SHA: '123456789' };
afterEach(() => vi.useRealTimers());
describe('bounded public health monitoring', () => {
  it('coalesces 200 simultaneous monitor requests and caches the same checked timestamp for 15 seconds', async () => {
    let time = 0;
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const check = createHealthCheck({ fetchImpl, now: () => time });
    const results = await Promise.all(Array.from({ length: 200 }, () => check(env)));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(results.every(result => result.status === 'healthy' && result.version === '1234567')).toBe(true);
    time = 14999; expect(await check(env)).toEqual(results[0]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    time = 15000; await check(env); expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
  it('finishes in three seconds when both dependencies stall; aborts upstreams and reports unhealthy', async () => {
    vi.useFakeTimers();
    const signals = [];
    const fetchImpl = vi.fn((_url, options) => { signals.push(options.signal); return new Promise(() => {}); });
    const check = createHealthCheck({ fetchImpl });
    const pending = check(env);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ status: 'unhealthy', diagnosis: 'shared_gateway_or_network', duration_ms: 3000,
      checks: { supabase: 'fail:timeout', auth: 'fail:timeout', fonnte: 'fail:timeout' } });
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('separates Auth from the database API without claiming a precise host root cause', async () => {
    const dbDown = createHealthCheck({ fetchImpl: async url => new Response('{}', { status: String(url).includes('/rest/v1/') ? 504 : 200 }) });
    const dbResult = await dbDown(env);
    expect(dbResult).toMatchObject({ status: 'unhealthy', diagnosis: 'database_api_or_postgrest',
      checks: { database: 'fail:504', auth: 'ok' } });
    expect(selectHealthComponent(dbResult, 'database')).toBe('fail:504');
    expect(selectHealthComponent(dbResult, 'auth')).toBe('ok');
    expect(selectHealthComponent(dbResult, 'overall')).toBe('fail');
    const authDown = createHealthCheck({ fetchImpl: async url => new Response('{}', { status: String(url).includes('/auth/v1/') ? 503 : 200 }) });
    const authResult = await authDown(env);
    expect(authResult).toMatchObject({ status: 'unhealthy', diagnosis: 'auth_service',
      checks: { database: 'ok', auth: 'fail:503' } });
    expect(selectHealthComponent(authResult, 'database')).toBe('ok');
    expect(selectHealthComponent(authResult, 'auth')).toBe('fail:503');
  });
  it('does not mistake upstream 503, failed requests or missing configuration for health', async () => {
    const check = createHealthCheck({ fetchImpl: async () => new Response('{}', { status: 503 }) });
    expect(await check(env)).toMatchObject({ status: 'unhealthy', checks: { supabase: 'fail:503' } });
    const missing = createHealthCheck({ fetchImpl: vi.fn() });
    expect(await missing({})).toMatchObject({ status: 'unhealthy', checks: { supabase: 'not_configured' } });
    const network = createHealthCheck({ fetchImpl: async () => { throw new Error('private hostname/token'); } });
    expect(JSON.stringify(await network(env))).not.toContain('private');
    expect(await network(env)).toMatchObject({ checks: { supabase: 'fail:network' } });
  });
  it('recovers after a cached failure expires and clears its timers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 503 }));
    const check = createHealthCheck({ fetchImpl });
    expect((await check(env)).status).toBe('unhealthy');
    expect(vi.getTimerCount()).toBe(0);
    fetchImpl.mockImplementation(async () => new Response('{}'));
    await vi.advanceTimersByTimeAsync(15000);
    expect((await check(env)).status).toBe('healthy');
    expect(vi.getTimerCount()).toBe(0);
  });
});
