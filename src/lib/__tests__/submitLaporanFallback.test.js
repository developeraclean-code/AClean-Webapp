import { describe, expect, it } from "vitest";
import { shouldFallbackAtomicReportSubmit } from "../submitLaporan.js";

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
