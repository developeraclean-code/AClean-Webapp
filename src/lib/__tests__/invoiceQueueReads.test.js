import { describe, expect, it } from "vitest";
import { fetchBootstrapInvoices, fetchInvoices } from "../../data/reads.js";
import { isProjectReportArchive } from "../projectReportArchive.js";

const invoiceClient = (rows) => ({
  from(table) {
    expect(table).toBe("invoices");
    let result = [...rows];
    const query = {
      select() { return query; },
      in(column, values) { result = result.filter(row => values.includes(row[column])); return query; },
      gte(column, value) { result = result.filter(row => row[column] >= value); return query; },
      order(column, { ascending = true } = {}) {
        result.sort((a, b) => ascending
          ? String(a[column]).localeCompare(String(b[column]))
          : String(b[column]).localeCompare(String(a[column])));
        return query;
      },
      limit(count) { return Promise.resolve({ data: result.slice(0, count), error: null }); },
      range(from, to) { return Promise.resolve({ data: result.slice(from, to + 1), error: null }); },
    };
    return query;
  },
});

describe("invoice queue", () => {
  it("mempertahankan pending lama setelah reload Invoice meski di luar 300 terbaru", async () => {
    const recent = Array.from({ length: 320 }, (_, i) => ({
      id: `new-${i}`, status: "PAID", created_at: `2026-10-09T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    const old = Array.from({ length: 12 }, (_, i) => ({
      id: `old-${i}`, status: "PENDING_APPROVAL", created_at: "2026-04-02T00:00:00Z",
    }));
    const client = invoiceClient([...recent, ...old]);
    const [bootstrap, full] = await Promise.all([
      fetchBootstrapInvoices(client, "2026-09-25T00:00:00Z"),
      fetchInvoices(client),
    ]);
    expect(bootstrap.error).toBeNull();
    expect(full.error).toBeNull();
    expect(bootstrap.data.filter(row => row.status === "PENDING_APPROVAL")).toHaveLength(12);
    expect(full.data.filter(row => row.status === "PENDING_APPROVAL")).toHaveLength(12);
    expect(full.data.map(row => row.id).filter(id => id === "old-0")).toHaveLength(1);
  });
});

describe("arsip laporan Project", () => {
  it("hanya mengenali laporan yang tercatat dipindah dari status VERIFIED", () => {
    expect(isProjectReportArchive({ editLog: [{ field: "project_migration", old: "VERIFIED", new: "REVISION" }] })).toBe(true);
    expect(isProjectReportArchive({ editLog: [{ field: "units+materials", old: "previous" }] })).toBe(false);
    expect(isProjectReportArchive({ editLog: "[]" })).toBe(false);
  });
});
