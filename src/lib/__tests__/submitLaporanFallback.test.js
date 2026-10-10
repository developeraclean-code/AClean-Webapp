import { describe, expect, it } from "vitest";
import { invoiceBlocksReportRewrite, reportSubmissionMutationKey, shouldFallbackAtomicReportSubmit } from "../submitLaporan.js";

describe("atomic report submit fallback", () => {
  it("memakai jalur kompatibilitas untuk mismatch foto_urls migration 177", () => {
    expect(shouldFallbackAtomicReportSubmit({
      code: "42804",
      message: 'column "foto_urls" is of type text[] but expression is of type jsonb',
    })).toBe(true);
  });

  it("tetap fallback bila RPC belum tersedia", () => {
    expect(shouldFallbackAtomicReportSubmit({ code: "PGRST202", message: "not found" })).toBe(true);
  });

  it("tidak menyamarkan error database lain", () => {
    expect(shouldFallbackAtomicReportSubmit({ code: "23503", message: "foreign key violation" })).toBe(false);
  });
});

describe("koreksi satu laporan sebelum verifikasi", () => {
  it("memakai mutation key baru saat menulis ulang ID laporan yang sama", () => {
    expect(reportSubmissionMutationKey("R1", false)).toBe("report-submit:R1");
    expect(reportSubmissionMutationKey("R1", true, "edit-1")).toBe("report-submit:R1:revision:edit-1");
    expect(reportSubmissionMutationKey("R1", true, "edit-2")).not.toBe(reportSubmissionMutationKey("R1", true, "edit-1"));
  });

  it("melindungi invoice final saat laporan ditulis ulang", () => {
    expect(invoiceBlocksReportRewrite({ status: "PENDING_APPROVAL", sent: false, paid_amount: 0 })).toBe(false);
    expect(invoiceBlocksReportRewrite({ status: "APPROVED", sent: false, paid_amount: 0 })).toBe(true);
    expect(invoiceBlocksReportRewrite({ status: "PENDING_APPROVAL", sent: true, paid_amount: 0 })).toBe(true);
    expect(invoiceBlocksReportRewrite({ status: "PENDING_APPROVAL", sent: false, paid_amount: 100000 })).toBe(true);
  });
});
