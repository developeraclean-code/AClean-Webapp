import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { computeDayDeduct, deductLines } from "../lib/materialDeduct.js";

// Owner/Admin confirm Material Harian (Opsi A). Saat confirm → potong stok asli:
//  - insert inventory_transactions (trigger update inventory.stock agregat)
//  - kurangi inventory_units.stock per unit_id
//  - tandai row pulang CONFIRMED + simpan deduct_tx_ids (idempotent).
function MaterialConfirmTab({ supabase, currentUser, showNotif, fetchInventoryUnits, setInvUnitsData, setInventoryData }) {
  const [rows, setRows] = useState([]);     // {pulang, pagi, jobs:[{id,customer}], lines}
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [view, setView] = useState("PENDING"); // PENDING | CONFIRMED

  const load = useCallback(async () => {
    setLoading(true);
    const { data: puls } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("session_type", "pulang").eq("confirm_status", view)
      .order("checkout_date", { ascending: false }).limit(60);
    const pulRows = puls || [];
    // pagi pasangan (teknisi+date)
    const pagiMap = {};
    for (const p of pulRows) {
      const { data: pg } = await supabase.from("teknisi_material_checkout")
        .select("items,photo_urls,photo_url").eq("teknisi_name", p.teknisi_name).eq("checkout_date", p.checkout_date).eq("session_type", "pagi").maybeSingle();
      pagiMap[p.id] = pg || { items: [] };
    }
    // nama customer utk job_ids
    const allIds = [...new Set(pulRows.flatMap((p) => (p.job_ids || [])))];
    let jobMap = {};
    if (allIds.length) {
      const { data: ords } = await supabase.from("orders").select("id,customer,service").in("id", allIds);
      jobMap = Object.fromEntries((ords || []).map((o) => [o.id, o]));
    }
    setRows(pulRows.map((p) => ({
      pulang: p, pagi: pagiMap[p.id],
      jobs: (p.job_ids || []).map((id) => jobMap[id] || { id, customer: id }),
      lines: computeDayDeduct(pagiMap[p.id]?.items || [], p.items || []),
    })));
    setLoading(false);
  }, [supabase, view]);
  useEffect(() => { load(); }, [load]);

  const refreshStock = async () => {
    try {
      if (fetchInventoryUnits) { const { data } = await fetchInventoryUnits(supabase); if (data && setInvUnitsData) setInvUnitsData(data); }
    } catch { /* refresh stok unit opsional — abaikan */ }
  };

  const confirm = async (entry) => {
    const row = entry.pulang;
    setBusy(row.id);
    try {
      // ATOMIC CLAIM: PENDING → CONFIRMED (compare-and-set). Hanya proses PERTAMA yang menang →
      // cegah dobel potong stok akibat race (2 Owner klik bareng) ATAU retry setelah gagal parsial.
      const { data: claimed, error: claimErr } = await supabase
        .from("teknisi_material_checkout")
        .update({ confirm_status: "CONFIRMED", confirmed_by: currentUser?.name || null, confirmed_at: new Date().toISOString() })
        .eq("id", row.id).eq("confirm_status", "PENDING")
        .select("*");
      if (claimErr) { showNotif("❌ Gagal confirm: " + claimErr.message); return; }
      if (!claimed || claimed.length === 0) { showNotif("Sudah dikonfirmasi (oleh proses lain)"); await load(); return; }
      const fresh = claimed[0];
      // Sudah jadi pemilik proses → aman potong stok (status sudah bukan PENDING).
      const { data: pg } = await supabase.from("teknisi_material_checkout").select("items").eq("teknisi_name", row.teknisi_name).eq("checkout_date", row.checkout_date).eq("session_type", "pagi").maybeSingle();
      const lines = deductLines(pg?.items || [], fresh.items || []);
      const txIds = [];
      for (const l of lines) {
        const { data: ins } = await supabase.from("inventory_transactions").insert({
          inventory_code: l.inventory_code, inventory_name: l.label,
          qty: -l.used, qty_actual: -l.used, type: "usage",
          teknisi_name: row.teknisi_name, job_date: row.checkout_date,
          order_id: (row.job_ids && row.job_ids[0]) || null,
          unit_id: l.unit_id || null, unit_label: l.unit_id ? l.label : null,
          notes: "Material Harian confirm oleh " + (currentUser?.name || ""),
          customer_name: entry.jobs[0]?.customer || null,
          created_by: currentUser?.id || null, created_by_name: currentUser?.name || "",
        }).select("id").single();
        if (ins?.id) txIds.push(ins.id);
        if (l.unit_id) {
          const { data: u } = await supabase.from("inventory_units").select("stock").eq("id", l.unit_id).single();
          if (u) await supabase.from("inventory_units").update({ stock: Math.max(0, Number(u.stock) - l.used), updated_at: new Date().toISOString() }).eq("id", l.unit_id);
        }
      }
      // Simpan deduct_tx_ids (jejak; status CONFIRMED sudah di-set saat claim).
      await supabase.from("teknisi_material_checkout").update({ deduct_tx_ids: txIds }).eq("id", row.id);
      showNotif(`✅ Dikonfirmasi — ${lines.length} unit dipotong dari stok`);
      await refreshStock();
      await load();
    } catch (e) { showNotif("❌ Gagal potong stok (row sudah CONFIRMED — cek stok manual): " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const reject = async (entry) => {
    const row = entry.pulang;
    setBusy(row.id);
    try {
      await supabase.from("teknisi_material_checkout").update({ confirm_status: "REJECTED", confirmed_by: currentUser?.name || null, confirmed_at: new Date().toISOString() }).eq("id", row.id);
      showNotif("Ditolak — stok tidak dipotong");
      await load();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const photosOf = (entry) => {
    const pg = entry.pagi || {}; const pl = entry.pulang || {};
    const a = (Array.isArray(pg.photo_urls) && pg.photo_urls.length ? pg.photo_urls : (pg.photo_url ? [pg.photo_url] : []));
    const b = (Array.isArray(pl.photo_urls) && pl.photo_urls.length ? pl.photo_urls : (pl.photo_url ? [pl.photo_url] : []));
    return [...a, ...b];
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: cs.muted }}>Confirm pemakaian material harian → <b style={{ color: cs.text }}>potong stok asli</b> (terpakai = dibawa − sisa, per unit).</div>
        <div style={{ display: "flex", gap: 4, background: cs.surface, borderRadius: 8, padding: 3 }}>
          {["PENDING", "CONFIRMED"].map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 12px", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", background: view === v ? cs.accent : "transparent", color: view === v ? "#fff" : cs.muted }}>{v === "PENDING" ? "Menunggu" : "Selesai"}</button>
          ))}
        </div>
      </div>

      {loading ? <div style={{ color: cs.muted, fontSize: 13, padding: 16 }}>Memuat…</div>
        : rows.length === 0 ? <div style={{ color: cs.muted, fontSize: 13, padding: 16, textAlign: "center", background: cs.card, border: "1px solid " + cs.border, borderRadius: 12 }}>{view === "PENDING" ? "Tidak ada yang menunggu konfirmasi." : "Belum ada yang dikonfirmasi."}</div>
        : rows.map((entry) => {
          const r = entry.pulang;
          const used = entry.lines.filter((l) => l.used > 0);
          const photos = photosOf(entry);
          return (
            <div key={r.id} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>{r.teknisi_name}</div>
                  <div style={{ fontSize: 12, color: cs.muted }}>{r.checkout_date}{r.confirmed_by ? " · oleh " + r.confirmed_by : ""}</div>
                </div>
                {view === "CONFIRMED" && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ {r.deduct_tx_ids?.length || 0} unit dipotong</span>}
              </div>

              {entry.jobs.length > 0 && (
                <div style={{ fontSize: 12, color: cs.muted, marginBottom: 8 }}>📋 Job: {entry.jobs.map((j) => j.customer).join(", ")}</div>
              )}

              <div style={{ background: cs.surface, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                {used.length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada material terpakai (semua dikembalikan).</div>
                  : used.map((l, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", borderTop: i ? "1px solid " + cs.border : "none" }}>
                      <span style={{ color: cs.text }}>{l.material_type === "freon" ? "🛢" : "📦"} {l.label}</span>
                      <span style={{ color: cs.muted }}>bawa {l.brought} · sisa {l.returned} · <b style={{ color: cs.accent }}>terpakai {l.used}</b></span>
                    </div>
                  ))}
              </div>

              {photos.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {photos.map((u, i) => <img key={i} src={u} alt="bukti" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid " + cs.border }} />)}
                </div>
              )}

              {view === "PENDING" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                  <button disabled={busy === r.id} onClick={() => reject(entry)} style={{ background: cs.card, border: "1px solid " + cs.red + "55", color: cs.red, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Tolak</button>
                  <button disabled={busy === r.id} onClick={() => confirm(entry)} style={{ background: busy === r.id ? cs.border : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                    {busy === r.id ? "Memproses…" : `✓ Confirm & Potong Stok (${used.length} unit)`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

export default MaterialConfirmTab;
