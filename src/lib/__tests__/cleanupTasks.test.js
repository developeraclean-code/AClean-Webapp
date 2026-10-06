import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn(), remove: vi.fn(), log: vi.fn() }));
vi.mock('../../../api/_tasks/_shared.js', () => ({
  sb: { from: mocks.from }, deleteR2Object: mocks.remove, log: mocks.log,
  isCronJobEnabled: () => true,
}));
import { taskR2Cleanup90d, taskWaCleanup } from '../../../api/_tasks/cleanup.js';

function query(result) {
  const q = { then: resolve => Promise.resolve(result).then(resolve) };
  for (const method of ['select', 'in', 'eq', 'lt', 'gte', 'is', 'not', 'order', 'limit', 'update', 'delete']) q[method] = vi.fn(() => q);
  return q;
}

describe('cleanup actual task contracts', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.log.mockResolvedValue(); });
  it('marks only successfully deleted R2 objects and continues a full batch', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, r2_image_url: `/api/foto?key=wa-group/test-${i}.jpg` }));
    const mark = query({ error: null });
    mocks.from.mockReturnValueOnce(query({ data: [{ key: 'r2_cleanup_enabled', value: 'true' }] }))
      .mockReturnValueOnce(query({ data: rows })).mockReturnValueOnce(mark);
    mocks.remove.mockResolvedValue(true);
    const result = await taskR2Cleanup90d();
    expect(result).toMatchObject({ purged: 50, errors: 0, has_more: true });
    expect(mark.in).toHaveBeenCalledWith('id', rows.map(r => r.id));
  });
  it('does not mark failed R2 deletions as purged', async () => {
    mocks.from.mockReturnValueOnce(query({ data: [{ key: 'r2_cleanup_enabled', value: 'true' }] }))
      .mockReturnValueOnce(query({ data: [{ id: 1, r2_image_url: '/api/foto?key=wa-group/test.jpg' }] }));
    mocks.remove.mockResolvedValue(false);
    expect(await taskR2Cleanup90d()).toMatchObject({ purged: 0, errors: 1, has_more: false });
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
  it('never deletes chat when protected payment evidence cannot be read', async () => {
    mocks.from.mockReturnValueOnce(query({ data: [{ key: 'wa_cleanup_enabled', value: 'true' }] }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ error: { message: 'database unavailable' } }));
    await expect(taskWaCleanup()).rejects.toThrow('Proteksi bukti bayar gagal dibaca');
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain('wa_messages');
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain('wa_conversations');
  });
});
