import { describe, it, expect } from "vitest";
import { multiDayMembers, multiDayProgress } from "../orders.js";

// Grup multi-hari: induk (day 1) + lanjutan (parent_job_id, day 2..N).
const parent = { id: "JOB-1", is_multi_day: true, day_number: 1, status: "CONTINUED" };
const day2 = { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true, day_number: 2, status: "PENDING" };
const day3 = { id: "JOB-3", parent_job_id: "JOB-1", is_multi_day: true, day_number: 3, status: "PENDING" };
const unrelated = { id: "JOB-9", is_multi_day: false, status: "PENDING" };

describe("multiDayMembers", () => {
  it("kumpulkan induk + semua anak dari order anak manapun", () => {
    const all = [parent, day2, day3, unrelated];
    const ids = multiDayMembers(day2, all).map(o => o.id).sort();
    expect(ids).toEqual(["JOB-1", "JOB-2", "JOB-3"]);
  });

  it("dari induk juga dapat seluruh grup", () => {
    const all = [parent, day2, day3, unrelated];
    expect(multiDayMembers(parent, all).map(o => o.id).sort()).toEqual(["JOB-1", "JOB-2", "JOB-3"]);
  });

  it("order non multi-hari → []", () => {
    expect(multiDayMembers(unrelated, [parent, day2, unrelated])).toEqual([]);
    expect(multiDayMembers(null, [])).toEqual([]);
  });
});

describe("multiDayProgress", () => {
  it("null untuk order non multi-hari", () => {
    expect(multiDayProgress(unrelated, [unrelated])).toBeNull();
  });

  it("belum selesai saat semua hari masih open (cuma Material Harian masuk)", () => {
    const all = [parent, day2, day3];
    const md = multiDayProgress(parent, all);
    expect(md.finished).toBe(false);
    expect(md.label).toBe("🚧 Belum selesai");
    expect(md.totalDays).toBe(3);
    expect(md.isParent).toBe(true);
  });

  it("selesai begitu satu member sudah REPORT_SUBMITTED", () => {
    const all = [parent, { ...day2, status: "REPORT_SUBMITTED" }, day3];
    expect(multiDayProgress(parent, all).finished).toBe(true);
    expect(multiDayProgress(parent, all).label).toBe("✅ Selesai");
  });

  it("selesai bila ada member ter-link invoice (invoice_id)", () => {
    const all = [{ ...parent, invoice_id: "INV-1" }, day2, day3];
    expect(multiDayProgress(day3, all).finished).toBe(true);
  });

  it("anak lanjutan ditandai isParent=false", () => {
    const md = multiDayProgress(day2, [parent, day2, day3]);
    expect(md.isParent).toBe(false);
  });
});
