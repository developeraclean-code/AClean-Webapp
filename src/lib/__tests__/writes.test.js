import { describe, expect, it, vi } from "vitest";
import { updateOrderStatus } from "../../data/writes.js";

describe("order writes", () => {
  it("requests the updated row so an RLS no-op is detectable", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "JOB-1", status: "ON_SITE" }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const result = await updateOrderStatus({ from }, "JOB-1", "ON_SITE", "Dedi");

    expect(from).toHaveBeenCalledWith("orders");
    expect(update).toHaveBeenCalledWith({ status: "ON_SITE", last_changed_by: "Dedi" });
    expect(eq).toHaveBeenCalledWith("id", "JOB-1");
    expect(select).toHaveBeenCalledWith("id,status");
    expect(result.data.id).toBe("JOB-1");
  });

  it("keeps check-in working when optional location columns are not migrated yet", async () => {
    const maybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204", message: "column missing" } })
      .mockResolvedValueOnce({ data: { id: "JOB-1", status: "ON_SITE" }, error: null });
    const select = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const result = await updateOrderStatus({ from }, "JOB-1", "ON_SITE", "Dedi", {
      on_site_at: "2026-09-27T08:00:00.000Z",
      on_site_latitude: -6.2,
      on_site_longitude: 106.7,
      on_site_accuracy_m: 12,
      on_site_location_captured_at: "2026-09-27T08:00:00.000Z",
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0]).toEqual({
      status: "ON_SITE", on_site_at: "2026-09-27T08:00:00.000Z", last_changed_by: "Dedi",
    });
    expect(result).toMatchObject({ data: { id: "JOB-1" }, error: null, locationSkipped: true });
  });
});
