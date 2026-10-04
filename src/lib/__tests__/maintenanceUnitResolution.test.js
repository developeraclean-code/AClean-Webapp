import { describe, expect, it } from "vitest";
import { resolveMaintenanceReportUnits as resolve } from "../maintenanceUnitResolution.js";

const registry = [
  { id: "U-1", client_id: "C-1" },
  { id: "U-2", client_id: "C-1" },
  { id: "U-3", client_id: "C-2" },
];

describe("maintenance report unit resolution", () => {
  it("menggunakan urutan aktual laporan, bukan urutan planning", () => {
    expect(resolve([{ maint_unit_id: "U-2" }, { maint_unit_id: "U-1" }], registry, "C-1"))
      .toMatchObject({ ok: true, pairs: [{ uid: "U-2" }, { uid: "U-1" }] });
  });
  it("ID UUID dengan huruf besar tetap cocok ke registry kanonik", () => {
    const id = "a1111111-1111-4111-8111-111111111111";
    expect(resolve([{ maint_unit_id: id.toUpperCase() }], [{ id, client_id: "C-1" }], "C-1"))
      .toMatchObject({ ok: true, pairs: [{ uid: id }] });
  });
  it.each([
    [[{ maint_unit_id: "U-1" }, {}], "unit_id_missing"],
    [[{ maint_unit_id: "U-1" }, { maint_unit_id: "U-1" }], "unit_id_duplicate"],
    [[{ maint_unit_id: "U-X" }], "unit_id_unknown"],
    [[{ maint_unit_id: "U-3" }], "unit_other_client"],
    [[], "report_empty"],
  ])("mengarantina laporan ambigu tanpa membuat sebagian log", (units, reason) => {
    expect(resolve(units, registry, "C-1")).toMatchObject({ ok: false, reason, pairs: [] });
  });
});
