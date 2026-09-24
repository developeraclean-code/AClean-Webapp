import { describe, expect, it } from "vitest";
import {
  computeWorkStats,
  dashboardUnpaidSummary,
  dashboardWeekConfirmedCount,
} from "../DashboardView.jsx";

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

describe("ringkasan KPI Dashboard", () => {
  it("jumlah dan nominal unpaid memakai himpunan status yang sama", () => {
    expect(dashboardUnpaidSummary([
      { status: "UNPAID", total: 125000 },
      { status: "OVERDUE", total: "275000" },
      { status: "PAID", total: 900000 },
      { status: "PARTIAL_PAID", total: 500000 },
    ])).toEqual({ count: 2, total: 400000 });
  });

  it("menghitung Senin-Minggu dan mempertahankan order yang sudah maju dari CONFIRMED", () => {
    const orders = [
      { date: "2026-09-21", status: "CONFIRMED" },
      { date: "2026-09-24", status: "REPORT_SUBMITTED" },
      { date: "2026-09-27", status: "PAID" },
      { date: "2026-09-24", status: "PENDING" },
      { date: "2026-09-24", status: "CANCELLED" },
      { date: "2026-09-20", status: "CONFIRMED" },
      { date: "2026-09-28", status: "CONFIRMED" },
    ];
    expect(dashboardWeekConfirmedCount(orders, "2026-09-24")).toBe(3);
  });

  it("aman bila tanggal dashboard tidak valid", () => {
    expect(dashboardWeekConfirmedCount([{ date: "2026-09-24", status: "CONFIRMED" }], "")).toBe(0);
  });
});
