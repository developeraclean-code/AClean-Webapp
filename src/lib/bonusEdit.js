const cleanMembers = (members) => {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(members) ? members : []) {
    const name = String(raw || "").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
};

const nullableNumber = (value) => {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

/** Bentuk payload aman untuk revisi satu baris order_bonuses. */
export function buildBonusEditPayload(form) {
  const bonusType = String(form?.bonus_type || "").trim();
  const totalAmount = Number(form?.total_amount);
  const teamMembers = cleanMembers(form?.team_members);

  if (!bonusType || bonusType === "dismissed") throw new Error("Pilih jenis bonus yang valid");
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error("Total bonus harus lebih dari Rp 0");
  if (teamMembers.length === 0) throw new Error("Pilih minimal satu anggota tim");

  const isMargin = bonusType.startsWith("margin_");
  return {
    bonus_type: bonusType,
    total_amount: totalAmount,
    team_members: teamMembers,
    note: String(form?.note || "").trim() || null,
    gross_revenue: isMargin ? nullableNumber(form?.gross_revenue) : null,
    material_cost: isMargin ? nullableNumber(form?.material_cost) : null,
    material_cost_source: isMargin
      ? (String(form?.material_cost_source || "").trim() || "manual")
      : null,
  };
}

export function bonusEditChanges(before, after) {
  const changes = [];
  if (before?.bonus_type !== after?.bonus_type) changes.push(`jenis ${before?.bonus_type || "-"} → ${after?.bonus_type || "-"}`);
  if (Number(before?.total_amount || 0) !== Number(after?.total_amount || 0)) changes.push(`total ${Number(before?.total_amount || 0)} → ${Number(after?.total_amount || 0)}`);
  if (JSON.stringify(before?.team_members || []) !== JSON.stringify(after?.team_members || [])) changes.push(`tim ${(before?.team_members || []).join(", ") || "-"} → ${(after?.team_members || []).join(", ") || "-"}`);
  if ((before?.note || null) !== (after?.note || null)) changes.push("catatan diubah");
  if (Number(before?.gross_revenue || 0) !== Number(after?.gross_revenue || 0)) changes.push(`omset ${Number(before?.gross_revenue || 0)} → ${Number(after?.gross_revenue || 0)}`);
  if (Number(before?.material_cost || 0) !== Number(after?.material_cost || 0)) changes.push(`material ${Number(before?.material_cost || 0)} → ${Number(after?.material_cost || 0)}`);
  return changes;
}
