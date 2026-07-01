// createTeamSplit — pecah 1 project maintenance jadi N sub-order paralel (multi-tim).
// Diekstrak dari App.jsx (Fase 3, pola ctx). Return groupId (parent id) atau null.
export async function createTeamSplit({ base, teams }, {
  addAgentLog, cekTeknisiAvailableDB, hitungJamSelesai, insertOrder, invalidateCache,
  normalizePhone, setOrdersData, showNotif, supabase,
} = {}) {
    if (!base?.date) { showNotif("❌ Tanggal wajib"); return null; }
    const valid = (teams || []).filter(t => Array.isArray(t.unitIds) && t.unitIds.length > 0);
    if (valid.length < 2) { showNotif("❌ Minimal 2 tim dengan unit terisi"); return null; }

    const mkId = () => "JOB-" + Date.now().toString(36).toUpperCase().slice(-6) + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const groupId = mkId();
    const created = [];

    for (let i = 0; i < valid.length; i++) {
      const t = valid[i];
      const id = i === 0 ? groupId : mkId();
      const units = t.unitIds.length;
      const timeEnd = hitungJamSelesai(base.time || "09:00", base.service || "Cleaning", units);
      let teknisi = (t.teknisi || "").trim() || null;
      let helper = teknisi ? ((t.helper || "").trim() || null) : null;
      let status = teknisi ? "CONFIRMED" : "PENDING";

      // Cek bentrok jadwal teknisi (real-time DB). Bentrok → turunkan ke PENDING.
      if (teknisi && base.time) {
        const dbCheck = await cekTeknisiAvailableDB(teknisi, base.date, base.time, base.service, units);
        if (!dbCheck.ok) {
          showNotif(`⚠️ Tim ${i + 1}: ${teknisi} bentrok jadwal → dibuat PENDING (assign ulang di Planning Order)`);
          teknisi = null; helper = null; status = "PENDING";
        }
      }

      const order = {
        id,
        customer: base.customer, phone: base.phone ? normalizePhone(base.phone) : null,
        address: base.address || "", area: base.area || "",
        service: base.service, type: base.type || base.service, units,
        teknisi, helper,
        date: base.date, time: base.time || "09:00", time_end: timeEnd, status,
        dispatch: false, source: "maintenance",
        job_group_id: groupId, is_team_split: true,
        maintenance_client_id: base.maintenance_client_id || null,
        maintenance_unit_ids: t.unitIds,
        notes: [base.notes, `Tim ${i + 1}/${valid.length}`].filter(Boolean).join(" · "),
      };

      const { error } = await insertOrder(supabase, order);
      if (error) { showNotif(`❌ Tim ${i + 1} gagal disimpan: ${error.message}`); continue; }
      created.push(order);

      // Gerbang atomik anti double-book (sama pola createOrder). Kalah race → turunkan PENDING.
      if (teknisi && base.time && timeEnd) {
        try {
          const { data: claimOk } = await supabase.rpc("try_claim_teknisi_slot", {
            p_teknisi: teknisi, p_date: base.date, p_order_id: id,
            p_start: base.time, p_end: timeEnd,
          });
          if (claimOk === false) {
            await supabase.from("orders").update({ teknisi: null, helper: null, status: "PENDING" }).eq("id", id);
            order.teknisi = null; order.helper = null; order.status = "PENDING";
            showNotif(`🚫 Tim ${i + 1}: ${teknisi} slot baru saja terisi → jadi PENDING`);
          }
        } catch (e) { console.warn("team-split claim slot:", e.message); }
      }
    }

    if (!created.length) return null;
    invalidateCache("orders");
    // Dedup: realtime bisa keburu menambah order yang baru dibuat ke `prev`
    // sebelum baris ini jalan → buang dulu id yang sama agar tak dobel.
    setOrdersData(prev => {
      const ids = new Set(created.map(o => o.id));
      return [...created, ...prev.filter(o => !ids.has(o.id))];
    });
    addAgentLog("TEAM_SPLIT_CREATED",
      `Project ${groupId} — ${created.length} tim · ${base.customer} (${valid.reduce((s, t) => s + t.unitIds.length, 0)} unit)`, "SUCCESS");
    showNotif(`✅ Project dibuat: ${created.length} tim (grup ${groupId}). Cek/assign di Planning Order.`);
    return groupId;
}
