import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findDelayedFieldReports, loadFieldReportDraft, saveFieldReportDraft, uploadWithRetry,
} from "../fieldReportWorkflow.js";

const makeStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
};

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeStorage(), sessionStorage: makeStorage() });
});

describe("field report workflow", () => {
  it("autosave only keeps cloud photos", () => {
    saveFieldReportDraft("JOB1", { units: [{ unit_no: 1 }], photos: [
      { id: 1, data_url: "data:image/jpeg;base64,large", url: null },
      { id: 2, data_url: "data:image/jpeg;base64,large", url: "https://r2/foto.jpg" },
    ] });
    const draft = loadFieldReportDraft("JOB1");
    expect(draft.units).toHaveLength(1);
    expect(draft.photos).toEqual([expect.objectContaining({ id: 2, url: "https://r2/foto.jpg" })]);
    expect(JSON.stringify(draft)).not.toContain("base64");
  });

  it("retries a failed background upload", async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ success: false, error: "network" })
      .mockResolvedValueOnce({ success: true, url: "https://r2/foto.jpg" });
    const result = await uploadWithRetry(upload, { delays: [0] });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("finds assigned overdue jobs without a report", () => {
    const delayed = findDelayedFieldReports([
      { id: "A", date: "2026-09-13", status: "COMPLETED", teknisi: "Dedi" },
      { id: "B", date: "2026-09-13", status: "COMPLETED", teknisi: "Dedi" },
      { id: "C", date: "2026-09-15", status: "PENDING", teknisi: "Dedi" },
    ], [{ job_id: "B", status: "SUBMITTED" }], "Dedi", "2026-09-14");
    expect(delayed.map(row => row.id)).toEqual(["A"]);
  });
});
