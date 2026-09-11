import { describe, expect, it } from "vitest";
import {
  isSubmittedServiceReport,
  planningDisplayStatus,
  submittedReportJobIds,
} from "../planningStatus.js";

describe("planning status", () => {
  it("hanya menganggap laporan yang sudah dikirim sebagai laporan masuk", () => {
    expect(isSubmittedServiceReport({ job_id: "JOB-1", status: "SUBMITTED" })).toBe(true);
    expect(isSubmittedServiceReport({ job_id: "JOB-2", status: "VERIFIED" })).toBe(true);
    expect(isSubmittedServiceReport({ job_id: "JOB-3", status: "REVISION" })).toBe(true);
    expect(isSubmittedServiceReport({ job_id: "JOB-4", status: "PENDING" })).toBe(false);
    expect(isSubmittedServiceReport({ job_id: "JOB-5" })).toBe(false);
  });

  it("membangun daftar job tanpa memasukkan draft", () => {
    const ids = submittedReportJobIds([
      { job_id: "JOB-1", status: "SUBMITTED" },
      { job_id: "JOB-2", status: "PENDING" },
    ]);

    expect([...ids]).toEqual(["JOB-1"]);
  });

  it("menampilkan Selesai ketika laporan sudah masuk walau status order masih lama", () => {
    const ids = new Set(["JOB-1"]);
    expect(planningDisplayStatus({ id: "JOB-1", status: "CONFIRMED" }, ids)).toBe("COMPLETED");
    expect(planningDisplayStatus({ id: "JOB-2", status: "PENDING" }, ids)).toBe("PENDING");
  });

  it("menormalkan status tahap lanjut menjadi Selesai dan mempertahankan pembatalan", () => {
    expect(planningDisplayStatus({ id: "JOB-1", status: "REPORT_SUBMITTED" })).toBe("COMPLETED");
    expect(planningDisplayStatus({ id: "JOB-2", status: "PAID" })).toBe("COMPLETED");
    expect(planningDisplayStatus({ id: "JOB-3", status: "CANCELLED" }, new Set(["JOB-3"]))).toBe("CANCELLED");
  });
});
