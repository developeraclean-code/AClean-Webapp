import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canOriginalReporterEdit, fieldReportAssignedNames, findDelayedFieldReports, isFieldOrderAssigned, isFieldReportAssigned,
  loadFieldReportDraft, saveFieldReportDraft, uploadWithRetry,
} from "../fieldReportWorkflow.js";
import { openLaporanModal } from "../openLaporanModal.js";
import { fieldUserKey } from "../fieldOfflineQueue.js";

const makeStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
};

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeStorage(), sessionStorage: makeStorage() });
});

describe("field report workflow", () => {
  it("mengizinkan hanya pengirim awal mengedit sampai diverifikasi", () => {
    const reporter = { id: "USER-ANGGA" };
    const teammate = { id: "USER-FIKRI" };
    for (const status of ["SUBMITTED", "REVISION"]) {
      const report = { status, submitted_by_user_id: reporter.id };
      expect(canOriginalReporterEdit(report, reporter)).toBe(true);
      expect(canOriginalReporterEdit(report, teammate)).toBe(false);
    }
    expect(canOriginalReporterEdit({ status: "VERIFIED", submitted_by_user_id: reporter.id }, reporter)).toBe(false);
    expect(canOriginalReporterEdit({ status: "SUBMITTED", submitted_by_user_id: null }, reporter)).toBe(false);
  });
  it("matches every technician/helper slot case-insensitively", () => {
    const order = { teknisi: "Dedi", helper2: "  ARI  " };
    expect(isFieldOrderAssigned(order, "ari")).toBe(true);
    expect(isFieldOrderAssigned(order, "dedi")).toBe(true);
    expect(isFieldOrderAssigned(order, "Putra")).toBe(false);
  });

  it("links one submitted report to every assigned member of its order", () => {
    const order = {
      id: "JAYA-KREASI", teknisi: "Dedi", teknisi2: "Rey", teknisi3: "Angga",
      helper: "Aji", helper2: "Rizal", helper3: "Ezra",
    };
    const report = { job_id: order.id, teknisi: "Dedi", helper: "Aji" };
    for (const name of ["Dedi", "Rey", "Angga", "Aji", "Rizal", "Ezra"]) {
      expect(isFieldReportAssigned(report, order, name)).toBe(true);
    }
    expect(fieldReportAssignedNames(report, order)).toEqual(["Dedi", "Rey", "Angga", "Aji", "Rizal", "Ezra"]);
    expect(isFieldReportAssigned(report, order, "Putra")).toBe(false);
    expect(isFieldReportAssigned(report, null, "Dedi")).toBe(true);
    expect(isFieldReportAssigned(report, null, "Angga")).toBe(false);
  });

  it("includes roster members beyond the six legacy order columns", () => {
    const order = { teknisi: "Dedi", helper: "Aji", assigned_members: ["Dedi", "Aji", "Angga", "Boim", "Fikri", "Rey", "Rizal", "Ezra"] };
    const report = { teknisi: "Dedi", helper: "Aji" };
    expect(isFieldOrderAssigned(order, "Ezra")).toBe(true);
    expect(isFieldReportAssigned(report, order, "Ezra")).toBe(true);
    expect(fieldReportAssignedNames(report, order)).toContain("Ezra");
  });

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

  it("isolates drafts for different field users on the same device", () => {
    saveFieldReportDraft("JOB1", { units: [{ label: "Milik A" }] }, "tech-a");
    saveFieldReportDraft("JOB1", { units: [{ label: "Milik B" }] }, "tech-b");
    expect(loadFieldReportDraft("JOB1", "tech-a").units[0].label).toBe("Milik A");
    expect(loadFieldReportDraft("JOB1", "tech-b").units[0].label).toBe("Milik B");
    expect(loadFieldReportDraft("JOB1", "tech-c")).toBeNull();
  });

  it("does not let async maintenance prefill replace the signed-in user's draft", async () => {
    const currentUser = { id: "TECH-1", name: "Dedi" };
    saveFieldReportDraft("JOB-MAINT", { units: [{ label: "Draft Unit" }] }, fieldUserKey(currentUser));
    const setLaporanUnits = vi.fn();
    const noOp = vi.fn();
    const ctx = new Proxy({
      currentUser,
      laporanReports: [],
      setLaporanUnits,
      submitLaporanLock: { current: false },
      _apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ units: [{ id: "REGISTRY-1" }] }) })),
      supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: async () => ({ data: [] }) }) }) }) }) },
    }, { get: (target, key) => key in target ? target[key] : noOp });

    openLaporanModal({ id: "JOB-MAINT", maintenance_client_id: "CLIENT-1", maintenance_unit_ids: ["REGISTRY-1"], units: 1 }, ctx);
    await new Promise(resolve => setTimeout(resolve, 0));

    // Pembukaan modal mengosongkan form; registry yang datang async tidak boleh
    // mengisi ulangnya karena draft akun aktif akan dipulihkan oleh modal.
    expect(setLaporanUnits).toHaveBeenCalledTimes(1);
    expect(setLaporanUnits).toHaveBeenCalledWith([]);
  });

  it("mengarahkan anggota tambahan ke satu laporan yang sudah ada", () => {
    const showNotif = vi.fn();
    const setLaporanModal = vi.fn();
    const ctx = new Proxy({
      currentUser: { name: "Angga", role: "Teknisi" },
      laporanReports: [{ job_id: "JAYA", teknisi: "Dedi", helper: "Aji", status: "SUBMITTED" }],
      showNotif, setLaporanModal,
    }, { get: (target, key) => key in target ? target[key] : vi.fn() });
    openLaporanModal({ id: "JAYA", teknisi: "Dedi", teknisi3: "Angga", helper: "Aji" }, ctx);
    expect(showNotif).toHaveBeenCalledWith(expect.stringContaining("Laporan Saya"));
    expect(setLaporanModal).not.toHaveBeenCalled();
  });

  it("menolak tulis ulang oleh anggota lain", () => {
    const showNotif = vi.fn();
    const setLaporanModal = vi.fn();
    const ctx = new Proxy({
      currentUser: { id: "USER-ANGGA", name: "Angga", role: "Teknisi" },
      laporanReports: [{ id: "R1", job_id: "JAYA", teknisi: "Dedi", status: "REVISION", submitted_by_user_id: "USER-DEDI" }],
      showNotif, setLaporanModal,
    }, { get: (target, key) => key in target ? target[key] : vi.fn() });
    openLaporanModal({ id: "JAYA", teknisi: "Dedi", teknisi3: "Angga", _rewriteId: "R1" }, ctx);
    expect(showNotif).toHaveBeenCalledWith(expect.stringContaining("terkunci"));
    expect(setLaporanModal).not.toHaveBeenCalled();
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

  it("does not flag invoiced jobs when paginated reports are absent", () => {
    const delayed = findDelayedFieldReports([
      { id: "A", date: "2026-09-10", status: "INVOICE_APPROVED", helper: "Dedi" },
      { id: "B", date: "2026-09-10", status: "PAID", helper: "Dedi" },
      { id: "C", date: "2026-09-10", status: "COMPLETED", helper: "Dedi" },
    ], [], "Dedi", "2026-09-14");
    expect(delayed.map(row => row.id)).toEqual(["C"]);
  });

  it("recognizes reports linked through order_id", () => {
    const delayed = findDelayedFieldReports([
      { id: "A", date: "2026-09-10", status: "COMPLETED", teknisi2: "Dedi" },
    ], [{ order_id: "A", status: "SUBMITTED" }], "Dedi", "2026-09-14");
    expect(delayed).toEqual([]);
  });
});
