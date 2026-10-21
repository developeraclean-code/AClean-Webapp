import { describe, expect, it } from "vitest";
import {
  INSTALL_INV_MAP, INSTALL_ITEMS, INSTALL_MATERIAL_KEYS, findInstallItemForMaterial,
} from "../laporanConstants.js";

describe("material kabel laporan instalasi", () => {
  it("menampilkan dua tipe kabel 2,5 dengan SKU stok yang berbeda", () => {
    const shown = INSTALL_ITEMS.filter(item => INSTALL_MATERIAL_KEYS.includes(item.key));
    expect(shown.filter(item => item.label.startsWith("Kabel Listrik"))).toEqual([
      expect.objectContaining({ key: "kabel_15", label: "Kabel Listrik 3x1,5" }),
      expect.objectContaining({ key: "kabel_25", label: "Kabel Listrik 3x2,5" }),
      expect.objectContaining({ key: "kabel_425", label: "Kabel Listrik 4x2,5" }),
    ]);
    expect(INSTALL_INV_MAP.kabel_25).toBe("SKU026");
    expect(INSTALL_INV_MAP.kabel_425).toBe("SKU028");
    expect(new Set([INSTALL_INV_MAP.kabel_25, INSTALL_INV_MAP.kabel_425]).size).toBe(2);
  });

  it("membaca laporan lama berdasarkan nama sebelum key kabel_25 yang ambigu", () => {
    expect(findInstallItemForMaterial({ id: "kabel_25", nama: "Kabel Listrik 3x2,5" })?.key).toBe("kabel_25");
    expect(findInstallItemForMaterial({ id: "kabel_25", nama: "Kabel Listrik 4x2,5" })?.key).toBe("kabel_425");
    expect(findInstallItemForMaterial({ id: "kabel_425", nama: "Kabel Listrik 4x2,5" })?.key).toBe("kabel_425");
  });
});
