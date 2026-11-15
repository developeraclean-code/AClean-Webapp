// Split creation has one database transaction and a payload-bound retry ID.
// Only the intent UUID is stored; no customer details or credentials are persisted.
import { fsmCommand } from "./fsmCommand.js";
const pendingIntents = new Map();
async function getIntent(base, teams, actorId, suppliedId) {
  if (suppliedId) return { id: suppliedId, key: null };
  if (!globalThis.crypto?.randomUUID || !globalThis.crypto?.subtle) {
    throw new Error("Browser tidak mendukung ID transaksi aman");
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ base, teams }));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(v => v.toString(16).padStart(2, "0")).join("");
  const key = `aclean:fsm-split:${actorId || "session"}:${hash}`;
  let id = pendingIntents.get(key);
  try { id ||= globalThis.sessionStorage?.getItem(key); } catch { /* memory retry remains available */ }
  if (!id) id = crypto.randomUUID();
  if (pendingIntents.size >= 64) pendingIntents.delete(pendingIntents.keys().next().value);
  pendingIntents.set(key, id);
  try { globalThis.sessionStorage?.setItem(key, id); } catch { /* browser storage may be disabled */ }
  return { id, key };
}

export async function createTeamSplit({ base, teams, requestId }, {
  addAgentLog, currentUser, hitungJamSelesai, invalidateCache,
  normalizePhone, setOrdersData, showNotif, supabase,
} = {}) {
  if (!base?.date) { showNotif("❌ Tanggal wajib"); return null; }
  const valid = (teams || []).filter(t => Array.isArray(t.unitIds) && t.unitIds.length > 0);
  if (valid.length < 2 || valid.length > 8) { showNotif("❌ Pilih 2 sampai 8 tim dengan unit terisi"); return null; }
  let intent, groupId, result;
  try {
    intent = await getIntent(base, valid, currentUser?.id, requestId);
    groupId = `JOB-${intent.id.toUpperCase()}`;
    const orders = valid.map((team, i) => {
      const teknisi = (team.teknisi || "").trim() || null;
      return {
        id: i === 0 ? groupId : `${groupId}-T${i + 1}`,
        customer: base.customer, phone: base.phone ? normalizePhone(base.phone) : null,
        address: base.address || "", area: base.area || "", service: base.service,
        type: base.type || base.service, units: team.unitIds.length, teknisi,
        helper: teknisi ? ((team.helper || "").trim() || null) : null,
        date: base.date, time: base.time || "09:00",
        time_end: hitungJamSelesai(base.time || "09:00", base.service || "Cleaning", team.unitIds.length),
        job_group_id: groupId, maintenance_client_id: base.maintenance_client_id || null,
        maintenance_unit_ids: team.unitIds,
        notes: [base.notes, `Tim ${i + 1}/${valid.length}`].filter(Boolean).join(" · "),
      };
    });
    const { data, error } = await fsmCommand(supabase, "create_team_split_atomic", { p_request_id: intent.id, p_orders: orders });
    if (error) throw error;
    if (data?.group_id !== groupId || !Array.isArray(data.orders) || data.orders.length !== valid.length
        || data.orders.some((row, i) => row.id !== orders[i].id || row.job_group_id !== groupId)) {
      throw new Error("Hasil grup belum terkonfirmasi");
    }
    result = data;
  } catch (error) {
    showNotif(`❌ Grup belum terkonfirmasi: ${error.message || "koneksi terputus"}. Coba ulang dengan data yang sama untuk memeriksa permintaan${groupId ? ` ${groupId}` : ""}.`);
    return null;
  }
  // The same intent survives a lost response/reload and replays the committed group.
  if (intent.key) {
    pendingIntents.delete(intent.key);
    try { globalThis.sessionStorage?.removeItem(intent.key); } catch { /* non-critical */ }
  }
  invalidateCache("orders");
  setOrdersData(prev => {
    const ids = new Set(result.orders.map(row => row.id));
    return [...result.orders, ...prev.filter(row => !ids.has(row.id))];
  });
  addAgentLog("TEAM_SPLIT_CREATED", `Project ${groupId} — ${result.orders.length} tim · ${base.customer}`, "SUCCESS");
  showNotif(`✅ Project tersimpan: ${result.orders.length} tim (grup ${groupId})${result.replayed ? " — hasil permintaan sebelumnya" : ""}.`);
  return groupId;
}
