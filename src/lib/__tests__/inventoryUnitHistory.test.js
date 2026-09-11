import { describe, expect, it } from "vitest";
import { transactionsForInventoryUnit } from "../inventoryUnitHistory.js";

const oldUnit = {
  id: "unit-old",
  inventory_code: "SKU009",
  unit_label: "Tabung R32 - D",
  created_at: "2026-01-01T01:00:00Z",
  archived: true,
};

const newUnit = {
  id: "unit-new",
  inventory_code: "SKU009",
  unit_label: "Tabung R32 - D",
  created_at: "2026-09-01T01:00:00Z",
  archived: false,
};

describe("transactionsForInventoryUnit", () => {
  it("memisahkan dua tabung berlabel sama berdasarkan unit_id", () => {
    const txs = [
      { id: "old-job", unit_id: oldUnit.id, inventory_code: "SKU009", unit_label: oldUnit.unit_label },
      { id: "new-job", unit_id: newUnit.id, inventory_code: "SKU009", unit_label: newUnit.unit_label },
    ];

    expect(transactionsForInventoryUnit(oldUnit, [oldUnit, newUnit], txs).map((tx) => tx.id)).toEqual(["old-job"]);
    expect(transactionsForInventoryUnit(newUnit, [oldUnit, newUnit], txs).map((tx) => tx.id)).toEqual(["new-job"]);
  });

  it("tidak memindahkan transaksi ber-ID lain walau label dan waktunya cocok", () => {
    const tx = {
      id: "foreign-job",
      unit_id: "unit-lain",
      inventory_code: "SKU009",
      unit_label: newUnit.unit_label,
      created_at: "2026-09-02T01:00:00Z",
    };

    expect(transactionsForInventoryUnit(newUnit, [oldUnit, newUnit], [tx])).toEqual([]);
  });

  it("membagi transaksi legacy tanpa unit_id menurut waktu pembuatan unit", () => {
    const txs = [
      { id: "legacy-old", inventory_code: "SKU009", unit_label: oldUnit.unit_label, created_at: "2026-02-01T01:00:00Z" },
      { id: "legacy-new", inventory_code: "SKU009", unit_label: newUnit.unit_label, created_at: "2026-09-02T01:00:00Z" },
    ];

    expect(transactionsForInventoryUnit(oldUnit, [oldUnit, newUnit], txs).map((tx) => tx.id)).toEqual(["legacy-old"]);
    expect(transactionsForInventoryUnit(newUnit, [oldUnit, newUnit], txs).map((tx) => tx.id)).toEqual(["legacy-new"]);
  });

  it("tidak menebak transaksi legacy bila label duplikat tidak punya waktu lifecycle", () => {
    const tanpaWaktu = { ...oldUnit, created_at: null };
    const tx = { id: "legacy", inventory_code: "SKU009", unit_label: oldUnit.unit_label };

    expect(transactionsForInventoryUnit(tanpaWaktu, [tanpaWaktu, newUnit], [tx])).toEqual([]);
  });
});
