// Smoke render Step 1 versi REGULER (non-maintenance) dari LaporanTeknisiModal.
// Build (Rollup/esbuild) TIDAK menangkap variabel JSX yang belum dideklarasikan —
// bug macam itu (dulu: `belumLengkap` undefined) baru meledak sebagai ReferenceError
// saat modal dirender di HP teknisi. Test ini menjalankan render sungguhan
// (react-dom/server, tanpa jsdom) untuk mengunci kartu grid unit reguler.
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import LaporanTeknisiModal from "../LaporanTeknisiModal.jsx";
import { mkUnit } from "../../lib/laporanConstants.js";

const noop = () => {};
const ref = { current: null };

// laporanModal REGULER: tidak punya maintenance_client_id → render branch kartu grid.
const order = { id: "JOB-REG", customer: "Bapak Uji", phone: "628123", units: 2, service: "Cuci AC" };

const teks = (html) => html.replace(/<!--\s*-->/g, "");

const render = (props = {}) => teks(renderToString(
  <LaporanTeknisiModal
    open laporanSubmitted={false}
    laporanModal={order} setLaporanModal={noop}
    setLaporanSubmitted={noop} setActiveMenu={noop}
    laporanStep={1} setLaporanStep={noop}
    laporanUnits={[mkUnit(1), mkUnit(2)]} setLaporanUnits={noop}
    laporanMaterials={[]} setLaporanMaterials={noop}
    laporanJasaItems={[]} setLaporanJasaItems={noop}
    laporanBarangItems={[]} setLaporanBarangItems={noop}
    laporanInstallItems={[]} setLaporanInstallItems={noop}
    laporanCleaningInRepair={[]} setLaporanCleaningInRepair={noop}
    laporanFotos={[]} setLaporanFotos={noop}
    laporanRekomendasi="" setLaporanRekomendasi={noop}
    laporanCatatan="" setLaporanCatatan={noop}
    laporanSurveyHasil="" setLaporanSurveyHasil={noop}
    laporanSurveyCatatan="" setLaporanSurveyCatatan={noop}
    activeUnitIdx={0} setActiveUnitIdx={noop}
    showUnitPresetModal={false} setShowUnitPresetModal={noop}
    unitPresetHistory={[]} setUnitPresetHistory={noop}
    unitPresetSelected={new Set()} setUnitPresetSelected={noop}
    maintUnitPool={[]} maintLogsPool={[]} onNewUnitProposed={noop} acUnitPool={[]}
    fotoInputRef={ref} fotoUnitInputRef={ref} fotoTargetUnitRef={ref}
    ordersData={[]} laporanReports={[]} invoicesData={[]} customersData={[]}
    priceListData={[]} inventoryData={[]} invUnitsData={[]} userAccounts={[]}
    submitLaporan={noop} handleFotoUpload={noop} buildCustomerHistory={() => []} fotoSrc={() => ""}
    showNotif={noop} addAgentLog={noop} sendWA={noop} findCustomer={() => null} insertOrder={noop}
    setOrdersData={noop} supabase={{}}
    _apiFetch={noop} _apiHeaders={{}} currentUser={{ name: "Teknisi Uji", role: "Teknisi" }} isMobile
    {...props}
  />
));

describe("LaporanTeknisiModal Step 1 reguler — render tanpa crash", () => {
  it("menampilkan kartu per unit dengan nomor & field wajib", () => {
    const html = render();
    expect(html).toContain("Unit 1");
    expect(html).toContain("Unit 2");
    expect(html).toContain("Nama Ruangan");
    expect(html).toContain("Tipe AC");
    expect(html).toContain("Merk AC");
  });

  it("datalist preset ruangan dirender sekali (id tunggal, bukan duplikat per unit)", () => {
    const html = render();
    const count = (html.match(/id="ruangan-preset"/g) || []).length;
    expect(count).toBe(1);
  });

  it("unit lengkap → badge ✅; tombol lanjut selalu ada", () => {
    const full = mkUnit(1, { label: "Kamar", tipe: "AC Split 1PK", merk: "Daikin" });
    const html = render({ laporanUnits: [full] });
    expect(html).toContain("✅");
    expect(html).toContain("Lanjut");
  });

  it("data unit kosong (field null) tidak bikin crash", () => {
    const kosong = mkUnit(1, { label: null, tipe: null, merk: null, model: null });
    expect(() => render({ laporanUnits: [kosong] })).not.toThrow();
  });
});
