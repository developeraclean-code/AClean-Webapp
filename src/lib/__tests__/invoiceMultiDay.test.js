import { describe, it, expect } from "vitest";
import {
  resolveMultiDayInvoiceAction,
  mergeInvoiceDetail,
  recomputeInvoiceTotals,
  tagDetailSource,
  multiDayProjectKey,
} from "../invoiceMultiDay.js";

const row = (nama, subtotal, keterangan = "jasa", extra = {}) => ({
  nama, jumlah: 1, satuan: "pcs", harga_satuan: subtotal, subtotal, keterangan, ...extra,
});

const inv = (job_id, status, extra = {}) => ({
  id: "INV-" + job_id + "-" + status, job_id, status, created_at: "2026-06-01T00:00:00Z", ...extra,
});

describe("multiDayProjectKey", () => {
  it("null untuk non multi-hari", () => {
    expect(multiDayProjectKey({ id: "JOB-1", is_multi_day: false })).toBeNull();
    expect(multiDayProjectKey({ id: "JOB-1" })).toBeNull();
  });
  it("induk → id sendiri", () => {
    expect(multiDayProjectKey({ id: "JOB-1", is_multi_day: true })).toBe("JOB-1");
  });
  it("anak → parent_job_id", () => {
    expect(multiDayProjectKey({ id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true })).toBe("JOB-1");
  });
});

describe("resolveMultiDayInvoiceAction", () => {
  it("non multi-hari → CREATE anchor id sendiri", () => {
    const a = resolveMultiDayInvoiceAction({ report: { id: "JOB-9", is_multi_day: false }, invoices: [] });
    expect(a.type).toBe("CREATE");
    expect(a.anchorJobId).toBe("JOB-9");
    expect(a.projectKey).toBeNull();
  });

  it("induk hari-1, belum ada invoice → CREATE anchor induk", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-1", is_multi_day: true }, invoices: [],
    });
    expect(a.type).toBe("CREATE");
    expect(a.anchorJobId).toBe("JOB-1");
  });

  it("anak hari-2 dgn invoice grup aktif → SKIP (jangan tambah, anchor induk)", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true, day_number: 2 },
      invoices: [inv("JOB-1", "PENDING_APPROVAL")],
    });
    expect(a.type).toBe("SKIP");
    expect(a.anchorJobId).toBe("JOB-1");
    expect(a.existing.job_id).toBe("JOB-1");
  });

  it("anak diverifikasi DULUAN (induk belum) → CREATE anchor induk (anti urutan-kebalik)", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true, day_number: 2 },
      invoices: [],
    });
    expect(a.type).toBe("CREATE");
    expect(a.anchorJobId).toBe("JOB-1");
  });

  it("induk diverifikasi SETELAH anak buat invoice grup → SKIP (tutup celah duplikat induk)", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-1", is_multi_day: true }, // induk, projectKey = JOB-1
      invoices: [inv("JOB-1", "PENDING_APPROVAL")], // dibuat oleh anak duluan
    });
    expect(a.type).toBe("SKIP");
    expect(a.anchorJobId).toBe("JOB-1");
  });

  it("invoice grup LUNAS → CREATE_SEPARATE anchor id sendiri", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-3", parent_job_id: "JOB-1", is_multi_day: true, day_number: 3 },
      invoices: [inv("JOB-1", "PAID")],
    });
    expect(a.type).toBe("CREATE_SEPARATE");
    expect(a.anchorJobId).toBe("JOB-3");
  });

  it("invoice grup CANCELLED → diabaikan → CREATE invoice grup baru", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true },
      invoices: [inv("JOB-1", "CANCELLED")],
    });
    expect(a.type).toBe("CREATE");
    expect(a.anchorJobId).toBe("JOB-1");
  });

  it.each(["APPROVED", "UNPAID", "PARTIAL_PAID", "OVERDUE"])(
    "status %s (belum lunas) → SKIP",
    (status) => {
      const a = resolveMultiDayInvoiceAction({
        report: { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true },
        invoices: [inv("JOB-1", status)],
      });
      expect(a.type).toBe("SKIP");
    }
  );

  it("pilih invoice grup TERLAMA sebagai jangkar bila ada beberapa", () => {
    const a = resolveMultiDayInvoiceAction({
      report: { id: "JOB-2", parent_job_id: "JOB-1", is_multi_day: true },
      invoices: [
        inv("JOB-1", "UNPAID", { id: "INV-NEW", created_at: "2026-06-05T00:00:00Z" }),
        inv("JOB-1", "PENDING_APPROVAL", { id: "INV-OLD", created_at: "2026-06-01T00:00:00Z" }),
      ],
    });
    expect(a.type).toBe("SKIP");
    expect(a.existing.id).toBe("INV-OLD");
  });
});

describe("mergeInvoiceDetail (idempotent)", () => {
  it("menambah baris sumber baru", () => {
    const existing = [row("Cleaning", 100000, "jasa", { source_job_id: "JOB-1" })];
    const newRows = [row("Pasang pipa", 200000, "jasa")];
    const merged = mergeInvoiceDetail(existing, newRows, "JOB-2");
    expect(merged).toHaveLength(2);
    expect(merged[1].source_job_id).toBe("JOB-2");
  });

  it("re-submit hari yang sama → REPLACE, bukan dobel", () => {
    const existing = [
      row("Cleaning", 100000, "jasa", { source_job_id: "JOB-1" }),
      row("Pasang pipa", 200000, "jasa", { source_job_id: "JOB-2" }),
    ];
    // JOB-2 di-submit ulang dgn nilai berbeda
    const newRows = [row("Pasang pipa", 250000, "jasa")];
    const merged = mergeInvoiceDetail(existing, newRows, "JOB-2");
    expect(merged).toHaveLength(2);
    const job2Rows = merged.filter(r => r.source_job_id === "JOB-2");
    expect(job2Rows).toHaveLength(1);
    expect(job2Rows[0].subtotal).toBe(250000);
  });

  it("aman bila existing null/undefined", () => {
    const merged = mergeInvoiceDetail(null, [row("X", 50000)], "JOB-1");
    expect(merged).toHaveLength(1);
    expect(merged[0].source_job_id).toBe("JOB-1");
  });
});

describe("recomputeInvoiceTotals", () => {
  it("pisah labor (jasa/repair) vs material, total = jumlah semua", () => {
    const detail = [
      row("Cleaning", 100000, "jasa"),
      row("Ganti kapasitor", 150000, "repair"),
      row("Freon R32", 200000, "freon"),
      row("Bracket", 50000, ""),
    ];
    const t = recomputeInvoiceTotals(detail);
    expect(t.labor).toBe(250000);   // jasa + repair
    expect(t.material).toBe(250000); // freon + bracket
    expect(t.total).toBe(500000);
  });

  it("akumulasi multi-hari: hari1 + hari2 + hari3", () => {
    const h1 = tagDetailSource([row("Pasang unit", 300000, "jasa")], "JOB-1");
    let detail = h1;
    detail = mergeInvoiceDetail(detail, [row("Pasang pipa", 200000, "jasa")], "JOB-2");
    detail = mergeInvoiceDetail(detail, [row("Freon", 180000, "freon")], "JOB-3");
    const t = recomputeInvoiceTotals(detail);
    expect(detail).toHaveLength(3);
    expect(t.labor).toBe(500000);
    expect(t.material).toBe(180000);
    expect(t.total).toBe(680000);
  });

  it("kosong → semua 0", () => {
    expect(recomputeInvoiceTotals([])).toEqual({ labor: 0, material: 0, total: 0 });
    expect(recomputeInvoiceTotals(null)).toEqual({ labor: 0, material: 0, total: 0 });
  });
});

describe("tagDetailSource", () => {
  it("menandai baris tanpa source_job_id, mempertahankan yang sudah ada", () => {
    const out = tagDetailSource([
      row("A", 1000),
      row("B", 2000, "jasa", { source_job_id: "JOB-LAMA" }),
    ], "JOB-1");
    expect(out[0].source_job_id).toBe("JOB-1");
    expect(out[1].source_job_id).toBe("JOB-LAMA");
  });
});
