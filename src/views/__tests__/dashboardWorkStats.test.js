import { describe, expect, it } from "vitest";
import { computeWorkStats } from "../DashboardView.jsx";

describe("computeWorkStats dashboard RPC", () => {
  it("memberi hasil sama untuk laporan mentah dan hasil agregasi RPC", () => {
    const invoices = {
      JOB1: { repair_gratis: "false", total: 350000 },
      JOB2: { repair_gratis: "true", total: 0 },
    };
    const raw = [
      {
        job_id: "JOB1", service: "Repair", total_units: 2,
        units: [
          { pekerjaan: ["Cleaning", "Ganti kapasitor", "Penambahan freon"] },
          { pekerjaan: ["Bongkar pasang unit", "Jasa vacum"] },
        ],
      },
      {
        job_id: "JOB2", service: "Cleaning", total_units: 2,
        units: [{ pekerjaan: ["Penambahan freon"] }, { pekerjaan: [] }],
      },
    ];
    const aggregated = [
      {
        job_id: "JOB1", dashboard_aggregated: true, cleaning_count: 1,
        install_count: 1, kapasitor_count: 1, has_freon_add: true, has_freon_vac: true,
      },
      {
        job_id: "JOB2", dashboard_aggregated: true, cleaning_count: 2,
        install_count: 0, kapasitor_count: 0, has_freon_add: true, has_freon_vac: false,
      },
    ];

    expect(computeWorkStats(aggregated, invoices)).toEqual(computeWorkStats(raw, invoices));
  });
});
