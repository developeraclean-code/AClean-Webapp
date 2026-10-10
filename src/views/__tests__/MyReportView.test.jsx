import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MyReportView from "../MyReportView.jsx";

const order = {
  id: "JAYA-KREASI", customer: "Jaya Kreasi", date: "2026-10-10", service: "Install",
  teknisi: "Dedi", teknisi2: "Rey", teknisi3: "Angga",
  helper: "Aji", helper2: "Rizal", helper3: "Ezra",
};
const report = {
  id: "REPORT-JAYA", job_id: order.id, customer: order.customer, date: order.date,
  service: order.service, teknisi: "Dedi", helper: "Aji", status: "SUBMITTED",
  submitted_by_user_id: "USER-DEDI",
  editLog: [], materials: [], units: [],
};

const renderFor = (name, overrides = {}) => renderToStaticMarkup(createElement(MyReportView, {
  laporanReports: [{ ...report, ...overrides }], projectDailyReports: [], ordersData: [order], invoicesData: [],
  currentUser: { id: name === "Dedi" ? "USER-DEDI" : `USER-${name.toUpperCase()}`, name, role: "Teknisi" }, searchLaporan: "", setSearchLaporan: () => {},
  safeArr: value => Array.isArray(value) ? value : [], TODAY: "2026-10-10", INSTALL_ITEMS: [],
}));

describe("Laporan Saya multi anggota", () => {
  it.each(["Dedi", "Rey", "Angga", "Aji", "Rizal", "Ezra"])("menampilkan laporan yang sama untuk %s", name => {
    const html = renderFor(name);
    expect(html).toContain("JAYA-KREASI");
    expect(html).toContain("Lihat Detail");
    if (name === "Dedi") expect(html).toContain("Tulis Ulang");
    else expect(html).not.toContain("Tulis Ulang");
  });

  it("tidak menampilkan laporan kepada anggota yang tidak ditugaskan", () => {
    expect(renderFor("Putra")).not.toContain("JAYA-KREASI");
  });

  it("menampilkan laporan untuk anggota roster ke-7/8 yang tidak muat di kolom lama", () => {
    const html = renderToStaticMarkup(createElement(MyReportView, {
      laporanReports: [report], projectDailyReports: [],
      ordersData: [{ ...order, assigned_members: ["Dedi", "Rey", "Angga", "Aji", "Rizal", "Ezra", "Boim", "Fikri"] }],
      invoicesData: [], currentUser: { name: "Fikri", role: "Teknisi" },
      searchLaporan: "", setSearchLaporan: () => {},
      safeArr: value => Array.isArray(value) ? value : [], TODAY: "2026-10-10", INSTALL_ITEMS: [],
    }));
    expect(html).toContain("JAYA-KREASI");
    expect(html).not.toContain("Tulis Ulang");
  });

  it("membuka revisi hanya untuk pengirim awal setelah Admin memintanya", () => {
    const revision = { status: "REVISION", submitted_by_user_id: "USER-DEDI" };
    expect(renderFor("Dedi", revision)).toContain("Tulis Ulang");
    expect(renderFor("Angga", revision)).not.toContain("Tulis Ulang");
    expect(renderFor("Fikri", revision)).not.toContain("Tulis Ulang");
  });

  it("mengunci pengirim awal setelah laporan diverifikasi", () => {
    const html = renderFor("Dedi", { status: "VERIFIED" });
    expect(html).toContain("Lihat Detail");
    expect(html).not.toContain("Tulis Ulang");
  });
});
