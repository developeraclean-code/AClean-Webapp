// Smoke render Step 1 versi maintenance. Build (Rollup/esbuild) TIDAK menangkap
// variabel yang belum dideklarasikan di dalam JSX — bug seperti itu baru meledak
// sebagai ReferenceError saat komponen dirender di HP teknisi. Test ini benar-benar
// menjalankan render (react-dom/server, tanpa dependensi baru / tanpa jsdom) untuk
// berbagai bentuk data produksi yang sudah terverifikasi ada di DB.
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import MaintUnitPickerStep, { unitKurangLengkap } from "../MaintUnitPickerStep.jsx";
import { mkUnit, maintUnitToHist } from "../../lib/laporanConstants.js";

const noop = () => {};
const order = { id: "JOB-TEST", customer: "PT Uji", maintenance_client_id: "c1", units: 2 };

// Bentuk baris maintenance_units seperti yang dikirim PostgREST (numeric → string)
const mu = (over = {}) => ({
  id: "u-1", unit_code: "AC-01", location: "Lt.2 Ruang Kerja",
  brand: "Gree", ac_type: "split", capacity_pk: "1.5",
  status: "active", next_service_date: "2026-09-01", ...over,
});

// React SSR menyisipkan penanda <!-- --> di antara text node ("1<!-- --> unit").
// Bersihkan supaya asersi menguji teks yang DILIHAT teknisi, bukan artefak render.
const teks = (html) => html.replace(/<!--\s*-->/g, "");

const render = (props = {}) => teks(renderToString(
  <MaintUnitPickerStep
    laporanModal={order}
    laporanUnits={[]} setLaporanUnits={noop} setLaporanStep={noop}
    maintUnitPool={[]} maintLogsPool={[]}
    setActiveUnitIdx={noop} setLaporanFotos={noop} setLaporanCleaningInRepair={noop}
    setLaporanJasaItems={noop} setLaporanBarangItems={noop}
    currentUser={{ name: "Usaeri", role: "Teknisi" }}
    _apiFetch={noop} showNotif={noop} onNewUnitProposed={noop}
    {...props}
  />
));

describe("MaintUnitPickerStep — render tanpa crash", () => {
  it("registry kosong → ajakan tambah unit baru", () => {
    const html = render();
    expect(html).toContain("Belum ada unit terdaftar");
  });

  it("grid menampilkan kode unit & lokasi", () => {
    const html = render({ maintUnitPool: [mu(), mu({ id: "u-2", unit_code: "AC-02", location: "Ruang Server" })] });
    expect(html).toContain("AC-01");
    expect(html).toContain("Ruang Server");
  });

  it("unit terpilih tampil sebagai tercentang", () => {
    const u = mu();
    const html = render({ maintUnitPool: [u], laporanUnits: [mkUnit(1, maintUnitToHist(u))] });
    expect(html).toContain("☑️");
    expect(html).toContain("1 unit dipilih");
  });

  it("unit terpilih dgn data kurang → peringatan lengkapi muncul (bukan diam)", () => {
    // cassette tanpa PK → tipe tidak resolve → wajib dikoreksi teknisi
    const u = mu({ ac_type: "cassette", capacity_pk: null });
    const html = render({ maintUnitPool: [u], laporanUnits: [mkUnit(1, maintUnitToHist(u))] });
    expect(html).toContain("Lengkapi");
    expect(html).toContain("Tipe AC");
  });

  it("unit registry lengkap → TIDAK memunculkan peringatan (siap lanjut)", () => {
    const u = mu();
    const html = render({ maintUnitPool: [u], laporanUnits: [mkUnit(1, maintUnitToHist(u))] });
    expect(html).not.toContain("Lengkapi dulu");
  });

  it("slot kosong bawaan order tetap terlihat, tidak hilang senyap", () => {
    const html = render({ maintUnitPool: [mu()], laporanUnits: [mkUnit(1), mkUnit(2)] });
    expect(html).toContain("belum terhubung ke registry");
  });

  it("tombol lanjut selalu tersedia (regresi: dulu teknisi terjebak tanpa navigasi)", () => {
    expect(render({ maintUnitPool: [mu()] })).toContain("Lanjut");
  });

  it("badge kesehatan tampil dari riwayat log", () => {
    const u = mu();
    const logs = [{ unit_id: u.id, service_date: "2026-07-01", measurements: { kondisi_setelah: ["AC Masih Terkendala"] }, materials: [] }];
    const html = render({ maintUnitPool: [u], maintLogsPool: logs });
    expect(html).toContain("Bermasalah");
  });

  it("data registry cacat (field null) tidak bikin crash", () => {
    const rusak = { id: "x", unit_code: "AC-9", location: null, brand: null, ac_type: null, capacity_pk: null, status: "active", next_service_date: null };
    expect(() => render({ maintUnitPool: [rusak] })).not.toThrow();
  });
});

describe("unitKurangLengkap — syarat lanjut", () => {
  it("merk kosong TIDAK memblokir (registry milik admin, merk tak menentukan tarif)", () => {
    const u = mkUnit(1, maintUnitToHist(mu({ brand: null })));
    expect(unitKurangLengkap(u)).toEqual([]);
  });
  it("tipe kosong memblokir (tipe = dasar tarif)", () => {
    const u = mkUnit(1, maintUnitToHist(mu({ ac_type: "cassette", capacity_pk: null })));
    expect(unitKurangLengkap(u)).toContain("Tipe AC");
  });
});
