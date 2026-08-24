import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { computeDayDeduct, deductLines } from "../lib/materialDeduct.js";
import { isFreonItem } from "../lib/inventory.js";

// Klasifikasi jenis material dari baris inventory (utk cocokkan unit picker ke draft AI).
function classifyMat(inv) {
  const mt = String(inv?.material_type || "").toLowerCase();
  const n = String(inv?.name || "").toLowerCase();
  if (mt.includes("freon") || isFreonItem(inv)) return "freon";
  if (mt.includes("pipa") || n.includes("pipa")) return "pipa";
  if (mt.includes("kabel") || n.includes("kabel")) return "kabel";
  return "lain";
}

// Owner/Admin confirm Material Harian (Opsi A). Saat confirm → potong stok asli:
//  - insert inventory_transactions (trigger update inventory.stock agregat)
//  - kurangi inventory_units.stock per unit_id
//  - tandai row CONFIRMED + simpan deduct_tx_ids (idempotent).
// Dua model:
//  - sesi 'pulang' → terpakai = dibawa − sisa (per unit, dari app Material Harian).
//  - sesi 'pakai'  → DRAFT AI (foto+teks grup): qty pemakaian per baris, owner pilih job+unit lalu confirm.
function MaterialConfirmTab({ supabase, currentUser, showNotif, fetchInventoryUnits, setInvUnitsData, setInventoryData }) {
  const [rows, setRows] = useState([]);        // entri 'pulang' {pulang, pagi, jobs, lines}
  const [pakai, setPakai] = useState([]);      // entri 'pakai' {row, jobOptions, unitsByType}
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [view, setView] = useState("PENDING"); // PENDING | CONFIRMED

  const load = useCallback(async () => {
    setLoading(true);
    // ── PULANG (model bawa−sisa) ──
    const { data: puls } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("session_type", "pulang").eq("confirm_status", view)
      .order("checkout_date", { ascending: false }).limit(60);
    const pulRows = puls || [];
    const pagiMap = {};
    for (const p of pulRows) {
      const { data: pg } = await supabase.from("teknisi_material_checkout")
        .select("items,photo_urls,photo_url").eq("teknisi_name", p.teknisi_name).eq("checkout_date", p.checkout_date).eq("session_type", "pagi").maybeSingle();
      pagiMap[p.id] = pg || { items: [] };
    }

    // ── PAKAI (draft AI) ──
    const { data: paks } = await supabase.from("teknisi_material_checkout")
      .select("*").eq("session_type", "pakai").eq("confirm_status", view)
      .order("checkout_date", { ascending: false }).limit(60);
    const pakRows = paks || [];

    // Kumpulkan job_ids semua (pulang + pakai) untuk nama customer
    const allIds = [...new Set([...pulRows, ...pakRows].flatMap((p) => (p.job_ids || [])))];
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

    // Untuk pakai: opsi job (order teknisi di tanggal itu) + unit picker per jenis
    let pakEntries = [];
    if (pakRows.length) {
      const dates = [...new Set(pakRows.map((p) => p.checkout_date))];
      const { data: dayOrders } = await supabase.from("orders")
        .select("id,customer,service,date,teknisi,teknisi2,teknisi3,helper,helper2,helper3")
        .in("date", dates).limit(400);
      const [{ data: inv }, unitsRes] = await Promise.all([
        supabase.from("inventory").select("code,name,material_type,unit"),
        fetchInventoryUnits ? fetchInventoryUnits(supabase) : Promise.resolve({ data: [] }),
      ]);
      const codeMeta = Object.fromEntries((inv || []).map((r) => [r.code, r]).filter(([c]) => c));
      const unitsByType = { pipa: [], kabel: [], freon: [] };
      for (const u of (unitsRes?.data || [])) {
        if (u.archived || u.is_active === false || Number(u.stock) <= 0) continue;
        const t = classifyMat(codeMeta[u.inventory_code]);
        if (unitsByType[t]) unitsByType[t].push({ id: u.id, inventory_code: u.inventory_code, unit_label: u.unit_label, stock: Number(u.stock) });
      }
      pakEntries = pakRows.map((row) => {
        const tekLower = String(row.teknisi_name || "").toLowerCase();
        const jobOptions = (dayOrders || []).filter((o) => o.date === row.checkout_date &&
          [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3].some((s) => s && String(s).toLowerCase() === tekLower))
          .map((o) => ({ id: o.id, customer: o.customer, service: o.service }));
        return { row, jobOptions, unitsByType, jobMap };
      });
    }
    setPakai(pakEntries);
    setLoading(false);
  }, [supabase, view, fetchInventoryUnits]);
  useEffect(() => { load(); }, [load]);

  const refreshStock = async () => {
    try {
      if (fetchInventoryUnits) { const { data } = await fetchInventoryUnits(supabase); if (data && setInvUnitsData) setInvUnitsData(data); }
    } catch { /* refresh stok unit opsional — abaikan */ }
  };

  // ── CONFIRM PULANG (bawa−sisa) ──
  const confirm = async (entry) => {
    const row = entry.pulang;
    setBusy(row.id);
    try {
      const { data: claimed, error: claimErr } = await supabase
        .from("teknisi_material_checkout")
        .update({ confirm_status: "CONFIRMED", confirmed_by: currentUser?.name || null, confirmed_at: new Date().toISOString() })
        .eq("id", row.id).eq("confirm_status", "PENDING")
        .select("*");
      if (claimErr) { showNotif("❌ Gagal confirm: " + claimErr.message); return; }
      if (!claimed || claimed.length === 0) { showNotif("Sudah dikonfirmasi (oleh proses lain)"); await load(); return; }
      const fresh = claimed[0];
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
      await supabase.from("teknisi_material_checkout").update({ deduct_tx_ids: txIds }).eq("id", row.id);
      showNotif(`✅ Dikonfirmasi — ${lines.length} unit dipotong dari stok`);
      await refreshStock();
      await load();
    } catch (e) { showNotif("❌ Gagal potong stok (row sudah CONFIRMED — cek stok manual): " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const reject = async (row) => {
    setBusy(row.id);
    try {
      await supabase.from("teknisi_material_checkout").update({ confirm_status: "REJECTED", confirmed_by: currentUser?.name || null, confirmed_at: new Date().toISOString() }).eq("id", row.id);
      showNotif("Ditolak — stok tidak dipotong");
      await load();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  // ── CONFIRM PAKAI (draft AI) — potong qty per baris dari unit terpilih ──
  const confirmPakai = async (row, editedLines) => {
    // Validasi: baris tracked (pipa/kabel/freon) wajib punya unit_id + qty>0.
    const tracked = editedLines.filter((l) => ["pipa", "kabel", "freon"].includes(l.material_type));
    const missing = tracked.filter((l) => Number(l.qty) > 0 && !l.unit_id);
    if (missing.length) { showNotif(`⚠️ Pilih tabung/roll dulu untuk: ${missing.map((l) => l.label).join(", ")}`); return; }
    setBusy(row.id);
    try {
      const { data: claimed, error: claimErr } = await supabase
        .from("teknisi_material_checkout")
        .update({ confirm_status: "CONFIRMED", confirmed_by: currentUser?.name || null, confirmed_at: new Date().toISOString(), items: editedLines })
        .eq("id", row.id).eq("confirm_status", "PENDING")
        .select("id");
      if (claimErr) { showNotif("❌ Gagal confirm: " + claimErr.message); return; }
      if (!claimed || claimed.length === 0) { showNotif("Sudah dikonfirmasi (oleh proses lain)"); await load(); return; }
      const txIds = [];
      for (const l of tracked) {
        const qty = Number(l.qty);
        if (!(qty > 0) || !l.unit_id) continue;
        const { data: ins } = await supabase.from("inventory_transactions").insert({
          inventory_code: l.inventory_code, inventory_name: l.label,
          qty: -qty, qty_actual: -qty, type: "usage",
          teknisi_name: row.teknisi_name, job_date: row.checkout_date,
          order_id: l.per_job?.[0]?.job_id || null,
          unit_id: l.unit_id, unit_label: l.label,
          notes: "Pemakaian (draft AI) confirm oleh " + (currentUser?.name || ""),
          customer_name: l.per_job?.[0]?.customer || null,
          created_by: currentUser?.id || null, created_by_name: currentUser?.name || "",
        }).select("id").single();
        if (ins?.id) txIds.push(ins.id);
        const { data: u } = await supabase.from("inventory_units").select("stock").eq("id", l.unit_id).single();
        if (u) await supabase.from("inventory_units").update({ stock: Math.max(0, Number(u.stock) - qty), updated_at: new Date().toISOString() }).eq("id", l.unit_id);
      }
      await supabase.from("teknisi_material_checkout").update({ deduct_tx_ids: txIds }).eq("id", row.id);
      showNotif(`✅ Draft dikonfirmasi — ${txIds.length} pemakaian dipotong dari stok`);
      await refreshStock();
      await load();
    } catch (e) { showNotif("❌ Gagal potong stok (row sudah CONFIRMED — cek manual): " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const photosOf = (entry) => {
    const pg = entry.pagi || {}; const pl = entry.pulang || {};
    const a = (Array.isArray(pg.photo_urls) && pg.photo_urls.length ? pg.photo_urls : (pg.photo_url ? [pg.photo_url] : []));
    const b = (Array.isArray(pl.photo_urls) && pl.photo_urls.length ? pl.photo_urls : (pl.photo_url ? [pl.photo_url] : []));
    return [...a, ...b];
  };

  const empty = rows.length === 0 && pakai.length === 0;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: cs.muted }}>Confirm pemakaian material → <b style={{ color: cs.text }}>potong stok asli</b>. Baris <b>🤖 draft AI</b> = dari foto/laporan grup, pilih job + tabung/roll lalu confirm.</div>
        <div style={{ display: "flex", gap: 4, background: cs.surface, borderRadius: 8, padding: 3 }}>
          {["PENDING", "CONFIRMED"].map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 12px", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", background: view === v ? cs.accent : "transparent", color: view === v ? "#fff" : cs.muted }}>{v === "PENDING" ? "Menunggu" : "Selesai"}</button>
          ))}
        </div>
      </div>

      {loading ? <div style={{ color: cs.muted, fontSize: 13, padding: 16 }}>Memuat…</div>
        : empty ? <div style={{ color: cs.muted, fontSize: 13, padding: 16, textAlign: "center", background: cs.card, border: "1px solid " + cs.border, borderRadius: 12 }}>{view === "PENDING" ? "Tidak ada yang menunggu konfirmasi." : "Belum ada yang dikonfirmasi."}</div>
        : <>
          {/* DRAFT AI (pakai) — di atas biar cepat terlihat */}
          {pakai.map((entry) => (
            <PakaiCard key={entry.row.id} entry={entry} view={view} busy={busy}
              onConfirm={confirmPakai} onReject={() => reject(entry.row)} />
          ))}

          {/* PULANG (bawa−sisa) */}
          {rows.map((entry) => {
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
                    <button disabled={busy === r.id} onClick={() => reject(r)} style={{ background: cs.card, border: "1px solid " + cs.red + "55", color: cs.red, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Tolak</button>
                    <button disabled={busy === r.id} onClick={() => confirm(entry)} style={{ background: busy === r.id ? cs.border : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                      {busy === r.id ? "Memproses…" : `✓ Confirm & Potong Stok (${used.length} unit)`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>}
    </div>
  );
}

// Kartu draft AI (sesi 'pakai') — baris editable: qty, job (nama customer), tabung/roll.
function PakaiCard({ entry, view, busy, onConfirm, onReject }) {
  const { row, jobOptions, unitsByType } = entry;
  const [lines, setLines] = useState(() => (Array.isArray(row.items) ? row.items.map((l) => ({ ...l })) : []));
  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const dropLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const icon = (t) => t === "freon" ? "🛢" : t === "lain" ? "🔩" : "📦";
  const confBadge = (l) => {
    const c = String(l.confidence || "").toLowerCase();
    const col = l.match_action === "auto" && c === "high" ? cs.green : l.match_action === "none" ? cs.red : cs.yellow;
    const txt = l.match_action === "auto" ? "cocok otomatis" : l.match_action === "ambiguous" ? "perlu pilih job" : l.match_action === "none" ? "job tak ketemu" : "";
    return txt ? <span style={{ fontSize: 10, fontWeight: 700, color: col }}>{txt}</span> : null;
  };

  return (
    <div style={{ background: cs.card, border: "1px solid " + cs.accent + "55", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>{row.teknisi_name} <span style={{ fontSize: 10, background: cs.accent + "22", color: cs.accent, padding: "2px 6px", borderRadius: 5, fontWeight: 800 }}>🤖 DRAFT AI</span></div>
          <div style={{ fontSize: 12, color: cs.muted }}>{row.checkout_date} · dari {row.draft_source === "wa_text" ? "laporan grup" : row.draft_source || "grup"}{row.confirmed_by ? " · oleh " + row.confirmed_by : ""}</div>
        </div>
        {view === "CONFIRMED" && <span style={{ fontSize: 11, color: cs.green, fontWeight: 700 }}>✓ {row.deduct_tx_ids?.length || 0} dipotong</span>}
      </div>

      {row.photo_url && (
        <div style={{ marginBottom: 8 }}><img src={row.photo_url} alt="bukti" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid " + cs.border }} /></div>
      )}

      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        {lines.length === 0 && <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada baris material.</div>}
        {lines.map((l, i) => {
          const isTracked = ["pipa", "kabel", "freon"].includes(l.material_type);
          const units = unitsByType[l.material_type] || [];
          return (
            <div key={i} style={{ background: cs.surface, borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: view === "PENDING" ? 8 : 0 }}>
                <span style={{ color: cs.text, fontSize: 13, fontWeight: 700 }}>{icon(l.material_type)} {l.label} {confBadge(l)}</span>
                <span style={{ color: cs.accent, fontSize: 13, fontWeight: 800 }}>{l.qty}{l.unit || ""}</span>
              </div>
              {view === "PENDING" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: cs.muted }}>Jumlah</span>
                    <input type="number" step="0.1" min="0" value={l.qty ?? ""} onChange={(e) => setLine(i, { qty: e.target.value === "" ? 0 : Number(e.target.value) })}
                      style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 13, width: 100 }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: cs.muted }}>Job</span>
                    <select value={l.per_job?.[0]?.job_id || ""} onChange={(e) => {
                      const jid = e.target.value || null;
                      const opt = jobOptions.find((o) => o.id === jid);
                      setLine(i, { per_job: [{ job_id: jid, customer: opt?.customer || l.per_job?.[0]?.customer || null, qty: Number(l.qty) || 0 }] });
                    }} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 12.5 }}>
                      <option value="">— pilih customer —{l.per_job?.[0]?.customer && !l.per_job?.[0]?.job_id ? ` (AI: ${l.per_job[0].customer})` : ""}</option>
                      {jobOptions.map((o) => <option key={o.id} value={o.id}>{o.customer}{o.service ? " · " + o.service : ""}</option>)}
                    </select>
                  </div>
                  {isTracked && (
                    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: cs.muted }}>Tabung/Roll</span>
                      <select value={l.unit_id || ""} onChange={(e) => {
                        const uid = e.target.value || null;
                        const u = units.find((x) => x.id === uid);
                        setLine(i, { unit_id: uid, inventory_code: u?.inventory_code || l.inventory_code || null });
                      }} style={{ background: cs.card, border: "1px solid " + (l.unit_id ? cs.border : cs.yellow), borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 12.5 }}>
                        <option value="">— pilih unit stok —</option>
                        {units.map((u) => <option key={u.id} value={u.id}>{u.unit_label} · {u.inventory_code} (stok {u.stock})</option>)}
                      </select>
                    </div>
                  )}
                  {!isTracked && <div style={{ fontSize: 11, color: cs.muted }}>Material lain — tidak memotong stok unit.</div>}
                  <button onClick={() => dropLine(i)} style={{ justifySelf: "start", background: "transparent", border: "none", color: cs.red, fontSize: 11, cursor: "pointer", padding: 0 }}>✕ hapus baris</button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: cs.muted }}>{l.per_job?.[0]?.customer || "job?"}{l.unit_id ? " · unit dipilih" : ""}</div>
              )}
            </div>
          );
        })}
      </div>

      {view === "PENDING" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <button disabled={busy === row.id} onClick={onReject} style={{ background: cs.card, border: "1px solid " + cs.red + "55", color: cs.red, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Tolak</button>
          <button disabled={busy === row.id} onClick={() => onConfirm(row, lines)} style={{ background: busy === row.id ? cs.border : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
            {busy === row.id ? "Memproses…" : "✓ Confirm & Potong Stok"}
          </button>
        </div>
      )}
    </div>
  );
}

export default MaterialConfirmTab;
