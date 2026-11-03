import { describe, expect, it, vi } from "vitest";
import { updateServiceReport } from "../../data/writes.js";
import { normalizeReportArray, reportArrayPersistenceFields, reportStatusAfterEdit, serviceReportUpdateError } from "../serviceReportPersistence.js";

const cases = [
  { name: "ubah PK unit", status: "SUBMITTED", units: [{ unit_no: 1, merk: "Daikin", pk: "2PK" }], materials: [] },
  { name: "ubah merk dan tipe unit", status: "VERIFIED", units: [{ unit_no: 1, merk: "Panasonic", tipe: "Inverter", pk: "1PK" }], materials: [] },
  { name: "ubah lokasi unit", status: "SUBMITTED", units: [{ unit_no: 1, label: "Lantai 1: Ruangan Tamu 1", pk: "2PK" }], materials: [] },
  { name: "ubah kondisi sebelum/sesudah dan pekerjaan", status: "REVISION", units: [{ unit_no: 1, kondisi_sebelum: ["AC Tidak Dingin"], pekerjaan: ["Cleaning"], kondisi_setelah: ["AC Normal"] }], materials: [] },
  { name: "tambah unit", status: "SUBMITTED", units: [{ unit_no: 1, pk: "1PK" }, { unit_no: 2, pk: "2PK" }], materials: [] },
  { name: "hapus unit", status: "REJECTED", units: [{ unit_no: 1, pk: "1PK" }], materials: [] },
  { name: "tambah material", status: "SUBMITTED", units: [{ unit_no: 1, pk: "1PK" }], materials: [{ nama: "Kapasitor", jumlah: 1, satuan: "pcs" }] },
  { name: "ubah jumlah material", status: "VERIFIED", units: [{ unit_no: 1, pk: "1PK" }], materials: [{ nama: "Freon R32", jumlah: 2, satuan: "kg" }] },
  { name: "edit Repair menjadi Install", status: "SUBMITTED", units: [{ unit_no: 1, pk: "2PK" }, { unit_no: 2, pk: "1PK" }], materials: [{ nama: "Pipa 1/4", jumlah: 8, satuan: "m" }] },
  { name: "edit Survey tanpa unit", status: "SUBMITTED", units: [], materials: [{ nama: "Biaya Survey", jumlah: 1, satuan: "jasa" }] },
];

describe("service report edit persistence smoke", () => {
  it.each(cases)("menyimpan dan membaca ulang $name", ({ status, units, materials }) => {
    const fields = reportArrayPersistenceFields(units, materials);
    // Simulasikan update baris lalu fetchServiceReports yang hanya memilih kolom JSONB.
    const databaseRow = {
      id: "REPORT-1",
      units: fields.units,
      units_json: fields.units_json,
      materials_used: fields.materials_used,
      materials_json: fields.materials_json,
    };
    const fetchedRow = {
      id: databaseRow.id,
      units: databaseRow.units,
      materials_used: databaseRow.materials_used,
    };

    expect(normalizeReportArray(fetchedRow.units, fetchedRow.units_json)).toEqual(units);
    expect(normalizeReportArray(fetchedRow.materials_used, fetchedRow.materials_json)).toEqual(materials);
    expect(databaseRow.units_json).toBe(JSON.stringify(units));
    expect(databaseRow.materials_json).toBe(JSON.stringify(materials));
    expect(reportStatusAfterEdit(status)).toBe(status === "REVISION" ? "SUBMITTED" : status);
  });

  it("mengutamakan JSONB, termasuk array kosong, dari legacy JSON yang tertinggal", () => {
    expect(normalizeReportArray([], '[{"pk":"1PK"}]')).toEqual([]);
    expect(normalizeReportArray([{ pk: "2PK" }], '[{"pk":"1PK"}]')).toEqual([{ pk: "2PK" }]);
  });

  it("tetap bisa membaca baris lama yang hanya punya kolom legacy", () => {
    expect(normalizeReportArray(undefined, '[{"pk":"1PK"}]')).toEqual([{ pk: "1PK" }]);
  });

  it("mengembalikan baris ter-update agar caller bisa menolak sukses palsu", async () => {
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "REPORT-1" }, error: null }),
    };
    const supabase = { from: vi.fn(() => chain) };

    await expect(updateServiceReport(supabase, "REPORT-1", { status: "SUBMITTED" }, "Owner"))
      .resolves.toEqual({ data: { id: "REPORT-1" }, error: null });
    expect(chain.update).toHaveBeenCalledWith({ status: "SUBMITTED", last_changed_by: "Owner" });
    expect(chain.eq).toHaveBeenCalledWith("id", "REPORT-1");
    expect(chain.select).toHaveBeenCalledWith("id");
    expect(serviceReportUpdateError({ id: "REPORT-1" }, null)).toBeNull();
  });

  it("menolak update tanpa baris hasil meski Supabase tidak mengembalikan error", () => {
    expect(serviceReportUpdateError(null, null)).toMatch(/tidak ditemukan|tidak dapat diubah/);
    expect(serviceReportUpdateError(null, { message: "RLS denied" })).toBe("RLS denied");
  });
});
