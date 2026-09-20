import { describe, expect, it, vi } from "vitest";
import {
  createOrderWorkflowAtomic,
  finalizeServiceReportAtomic,
  submitServiceReportAtomic,
} from "../writes.js";
import { PROJECT_VIEW_KEYS } from "../../project/data/projectApi.ts";

describe("atomic workflow RPC contracts", () => {
  it("mengirim idempotency key yang stabil saat submit laporan", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { report: { id: "LPR-1" } }, error: null });
    const report = { id: "LPR-1", job_id: "JOB-1" };
    await submitServiceReportAtomic({ rpc }, report, "Admin", "report-submit:LPR-1");
    expect(rpc).toHaveBeenCalledWith("submit_service_report_atomic", {
      p_report: report,
      p_actor_name: "Admin",
      p_mutation_key: "report-submit:LPR-1",
    });
  });

  it("finalisasi laporan membawa invoice dalam transaksi yang sama", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const invoice = { id: "INV-1", job_id: "JOB-1", total: 250000 };
    await finalizeServiceReportAtomic({ rpc }, "LPR-1", invoice, "Owner", "report-finalize:LPR-1");
    expect(rpc).toHaveBeenCalledWith("finalize_service_report_atomic", {
      p_report_id: "LPR-1",
      p_invoice: invoice,
      p_actor_name: "Owner",
      p_mutation_key: "report-finalize:LPR-1",
    });
  });

  it("order workflow mengirim marker auto-dispatch dalam RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    const order = { id: "JOB-1", customer: "Customer" };
    await createOrderWorkflowAtomic({ rpc }, order, true, "Admin", "order-create:JOB-1");
    expect(rpc).toHaveBeenCalledWith("create_order_workflow_atomic", {
      p_order: order,
      p_auto_dispatch: true,
      p_actor_name: "Admin",
      p_mutation_key: "order-create:JOB-1",
    });
  });
});

describe("Project lazy bootstrap", () => {
  it("tidak memuat attachment dokumen dan alat pada bootstrap Dashboard", () => {
    expect(PROJECT_VIEW_KEYS.dashboard).not.toContain("documents");
    expect(PROJECT_VIEW_KEYS.dashboard).not.toContain("tools");
  });

  it("memuat dokumen hanya ketika tab Dokumen dibuka", () => {
    expect(PROJECT_VIEW_KEYS.docs).toEqual(["projects", "documents"]);
  });
});
