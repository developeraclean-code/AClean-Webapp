import { describe, expect, it, vi } from "vitest";
import { hydratePriceListCache } from "../loadAllData.js";

describe("hydratePriceListCache", () => {
  it("menyamakan state UI dan cache kalkulasi dengan harga aktif dari DB", () => {
    const rows = [
      { service: "Cleaning", type: "AC Split 0.5-1PK", price: 95000, is_active: true },
      { service: "Cleaning", type: "Lama", price: 1, is_active: false },
    ];
    const built = { Cleaning: { "AC Split 0.5-1PK": 95000 } };
    const buildPriceListFromDB = vi.fn(() => built);
    const setPriceListData = vi.fn();
    const setPriceListCache = vi.fn();
    const setPriceListSyncedAt = vi.fn();

    expect(hydratePriceListCache(rows, {
      buildPriceListFromDB, setPriceListData, setPriceListCache, setPriceListSyncedAt,
    })).toBe(built);
    expect(setPriceListData).toHaveBeenCalledWith(rows);
    expect(buildPriceListFromDB).toHaveBeenCalledWith([rows[0]]);
    expect(setPriceListCache).toHaveBeenCalledWith(built);
    expect(setPriceListSyncedAt.mock.calls[0][0]).toBeInstanceOf(Date);
  });
});
