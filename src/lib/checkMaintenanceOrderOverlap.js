// checkMaintenanceOrderOverlap — cek apakah unit maintenance yang mau dijadwalkan
// SUDAH punya order aktif di tanggal yang sama, sebelum order baru dibuat.
//
// Kenapa perlu: ada 4 jalur independen yang bisa bikin order untuk unit maintenance
// (tab Unit, Follow-up "Buat Order", Quotasi Approve, Manifest "Buat Order dari
// Manifest) — tidak satu pun saling tahu satu sama lain, jadi 2 admin (atau 1 admin
// lewat 2 tab beda) bisa dengan mudah bikin order dobel untuk unit & tanggal yang
// sama tanpa sadar. Ini WARNING (showConfirm), bukan hard block — kadang memang
// perlu order kedua di hari sama (mis. repair darurat di hari cuci rutin sudah ada).
export async function checkMaintenanceOrderOverlap(supabase, { clientId, unitIds, date }) {
  if (!supabase || !clientId || !date || !Array.isArray(unitIds) || unitIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from("orders")
    .select("id,teknisi,helper,status,service,maintenance_unit_ids")
    .eq("maintenance_client_id", clientId)
    .eq("date", date)
    .not("status", "in", "(CANCELLED,COMPLETED)");
  if (error || !Array.isArray(data)) return [];

  const wanted = new Set(unitIds);
  return data
    .map(o => ({ ...o, overlapUnitIds: (o.maintenance_unit_ids || []).filter(id => wanted.has(id)) }))
    .filter(o => o.overlapUnitIds.length > 0);
}

// Format ringkas untuk ditampilkan di showConfirm — dipakai sama di semua caller
// (Unit/Follow-up/Quotasi/Manifest) supaya pesannya konsisten.
export function formatOverlapWarning(conflicts, unitLabelById) {
  const lines = conflicts.map(c => {
    const units = c.overlapUnitIds.map(id => unitLabelById?.[id] || id).join(", ");
    const who = c.teknisi ? ` (${c.teknisi}${c.helper ? " + " + c.helper : ""})` : " (belum ditugaskan)";
    return `• ${c.id}${who} — ${units}`;
  });
  return `Unit berikut sudah punya order di tanggal ini:\n${lines.join("\n")}\n\nTetap buat order baru?`;
}
