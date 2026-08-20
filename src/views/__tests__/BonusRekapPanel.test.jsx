import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import BonusRekapPanel from "../BonusRekapPanel.jsx";
import { buildBonusRekap } from "../../lib/bonusRekap.js";
import { DEFAULT_BONUS_CATEGORIES } from "../../constants/bonus.js";

const mk = (over = {}) => buildBonusRekap({
  month: "2026-07", bonusCategories: DEFAULT_BONUS_CATEGORIES,
  bonuses: [], orders: [], invMap: {}, ...over,
});

describe("BonusRekapPanel render smoke", () => {
  it("render kosong tanpa crash", () => {
    const html = renderToString(
      <BonusRekapPanel rekap={mk()} bonusMonth="2026-07" setBonusMonth={() => {}}
        addMonths={() => "2026-06"} todayYearMonth={() => "2026-08"} loading={false} onReload={() => {}} />
    );
    expect(html).toContain("Rekap bulanan");
    expect(html).toContain("Belum ada job berbonus");
  });

  it("render dengan data", () => {
    const rekap = mk({
      orders: [{ id: "J1", date: "2026-07-08", customer: "Budi", service: "Service", units: 2, teknisi: "Mulyadi", helper: "Albana", invoice_id: "I1" }],
      invMap: { I1: { total: 1500000, materials_detail: "[]" } },
      bonuses: [{ id: "b1", order_id: "J1", order_date: "2026-07-08", bonus_type: "freon", total_amount: 25000, amount_per_person: 25000, member_count: 1, team_members: ["Mulyadi"], status: "PAID" }],
    });
    const html = renderToString(
      <BonusRekapPanel rekap={rekap} bonusMonth="2026-07" setBonusMonth={() => {}}
        addMonths={() => "2026-06"} todayYearMonth={() => "2026-08"} loading={false} onReload={() => {}} />
    );
    expect(html).toContain("Budi");
    expect(html).toContain("Mulyadi");
    expect(html).toContain("Rp 25.000");
  });
});
