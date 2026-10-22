import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/_health.js', async importOriginal => ({
  ...(await importOriginal()),
  checkHealth: vi.fn(),
}));

import { checkHealth } from '../../../api/_health.js';
import { health } from '../../../api/_handlers/auth-token.js';

const response = () => ({
  status: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
  setHeader: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  checkHealth.mockResolvedValue({ status: 'unhealthy', diagnosis: 'database_api_or_postgrest',
    checks: { database: 'fail:504', auth: 'ok' } });
});

describe('component health route', () => {
  it('checks Vercel reachability without calling Supabase', async () => {
    const res = response();
    await health({ method: 'GET', query: { component: 'app' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('keeps healthy Auth distinct from failing database API', async () => {
    const authRes = response(), dbRes = response(), overallRes = response();
    await health({ method: 'GET', query: { component: 'auth' } }, authRes);
    await health({ method: 'GET', query: { component: 'database' } }, dbRes);
    await health({ method: 'GET', query: {} }, overallRes);
    expect(authRes.status).toHaveBeenCalledWith(200);
    expect(dbRes.status).toHaveBeenCalledWith(503);
    expect(overallRes.status).toHaveBeenCalledWith(503);
    expect(dbRes.json.mock.calls[0][0]).toMatchObject({ component: 'database', component_status: 'fail:504' });
  });

  it('rejects unknown or repeated component selectors', async () => {
    const res = response();
    await health({ method: 'GET', query: { component: ['database', 'auth'] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(checkHealth).not.toHaveBeenCalled();
  });
});
