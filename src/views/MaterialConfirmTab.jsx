import { useState, useEffect, useCallback } from "react";
import { cs } from "../theme/cs.js";
import { computeDayDeduct, applyAdminOverrides, lineKey, buildReversalRow, reversalByUnit } from "../lib/materialDeduct.js";
import { defaultSplit, splitRemainder, belumTerbagi, splitToAllocations } from "../lib/materialSplit.js";
import { isFreonItem } from "../lib/inventory.js";
import { shiftDateStr, shortDateID, getLocalDate } from "../lib/dateTime.js";

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
function MaterialConfirmTab({ supabase, currentUser, showNotif, fetchInventoryUnits, setInvUnitsData, setInventoryData, addAgentLog }) {
  const [rows, setRows] = useState([]);        // entri 'pulang' {pulang, pagi, jobs, lines}
  const [pakai, setPakai] = useState([]);      // entri 'pakai' {row, jobOptions, unitsByType}
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  // Input mewakili teknisi — jalur bantuan admin saat teknisi lupa mengisi.
  // Sengaja BUKAN dengan membuka menu "Material Harian" untuk admin: sesinya
  // dibuat di sini sebagai draft 'pakai' PENDING, lalu diisi & dikonfirmasi
  // lewat kartu yang sama dengan draft AI — satu tujuan, satu gerbang.
  const [mewakiliOpen, setMewakiliOpen] = useState(false);
  const [tekList, setTekList] = useState([]);
  const [mewakiliTek, setMewakiliTek] = useState("");
  const [mewakiliTgl, setMewakiliTgl] = useState(getLocalDate());
  const [view, setView] = useState("PENDING"); // PENDING | CONFIRMED
  // Seberapa jauh ke belakang job boleh dipilih untuk ditautkan ke material.
  // Dulu terkunci di tanggal sesi itu saja, jadi material yang baru dilaporkan
  // beberapa hari kemudian tidak bisa ditautkan sama sekali (keluhan admin,
  // 25 Agu 2026). Job hari yang sama tetap tampil paling atas & terpisah.
  const [jobDays, setJobDays] = useState(7);

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

    // ── Opsi job — untuk PULANG maupun PAKAI ──
    // Sesi 'pulang' sekarang ikut membagi qty terpakai per job (materialSplit.js),
    // jadi daftar job teknisi diambil sekali untuk kedua jenis sesi. Sebelumnya
    // hanya draft AI yang punya daftar ini, dan itulah kenapa pemotongan dari
    // sesi pulang menempel ke job_ids[0] saja — atau tanpa job sama sekali.
    const semuaSesi = [...pulRows, ...pakRows];
    const dates = [...new Set(semuaSesi.map((p) => p.checkout_date))].filter(Boolean).sort();
    let dayOrders = [];
    if (dates.length) {
      const dariTgl = shiftDateStr(dates[0], -Number(jobDays || 0));
      const sampaiTgl = dates[dates.length - 1];
      const { data } = await supabase.from("orders")
        .select("id,customer,service,date,teknisi,teknisi2,teknisi3,helper,helper2,helper3")
        .gte("date", dariTgl).lte("date", sampaiTgl).limit(900);
      dayOrders = data || [];
    }
    const jobOptionsFor = (row) => {
      const tekLower = String(row.teknisi_name || "").toLowerCase();
      const batasAwal = shiftDateStr(row.checkout_date, -Number(jobDays || 0));
      return dayOrders.filter((o) =>
        o.date && o.date <= row.checkout_date && o.date >= batasAwal &&
        [o.teknisi, o.teknisi2, o.teknisi3, o.helper, o.helper2, o.helper3].some((s) => s && String(s).toLowerCase() === tekLower))
        .map((o) => ({ id: o.id, customer: o.customer, service: o.service, date: o.date }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.customer).localeCompare(String(b.customer)));
    };

    setRows(pulRows.map((p) => ({
      pulang: p, pagi: pagiMap[p.id],
      jobs: (p.job_ids || []).map((id) => jobMap[id] || { id, customer: id }),
      jobOptions: jobOptionsFor(p),
      lines: computeDayDeduct(pagiMap[p.id]?.items || [], p.items || []),
    })));

    // Untuk pakai: unit picker per jenis
    let pakEntries = [];
    if (pakRows.length) {
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
      pakEntries = pakRows.map((row) => ({ row, jobOptions: jobOptionsFor(row), unitsByType, jobMap }));
    }
    setPakai(pakEntries);
    setLoading(false);
  }, [supabase, view, fetchInventoryUnits, jobDays]);
  useEffect(() => { load(); }, [load]);

  const refreshStock = async () => {
    try {
      if (fetchInventoryUnits) { const { data } = await fetchInventoryUnits(supabase); if (data && setInvUnitsData) setInvUnitsData(data); }
    } catch { /* refresh stok unit opsional — abaikan */ }
  };

  // ── CONFIRM PULANG (bawa−sisa) ──
  // overrides = koreksi admin { [lineKey]: qtyTerpakai }, alasan = wajib bila ada koreksi.
  const confirm = async (entry, overrides = {}, alasan = "", splitMap = {}) => {
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
      // Sengaja dihitung ulang dari data SEGAR (bukan dari state kartu) supaya
      // koreksi admin ditempel di atas angka terbaru, bukan angka basi di layar.
      const base = computeDayDeduct(pg?.items || [], fresh.items || []);
      const { lines: adjusted, changes } = applyAdminOverrides(base, overrides);
      const lines = adjusted.filter((l) => l.used > 0);
      const koreksiMap = Object.fromEntries(changes.map((c) => [c.key, c]));
      const txIds = [];
      for (const l of lines) {
        const k = lineKey(l);
        const c = koreksiMap[k];
        const catatan = "Material Harian confirm oleh " + (currentUser?.name || "")
          + (c ? ` · DIKOREKSI ADMIN ${c.dari} → ${c.jadi}${alasan ? " (" + alasan + ")" : ""}` : "");
        // Satu transaksi per JOB, bukan satu untuk seluruh hari. Kalau teknisi
        // tidak punya job di rentang (pembagian mustahil), jatuh ke perilaku lama
        // supaya stok tetap terpotong — hanya keterangan jobnya yang kosong.
        const alokasi = splitToAllocations(splitMap[k] || {}, entry.jobOptions || []);
        const tulis = alokasi.length > 0 ? alokasi : [{
          job_id: (row.job_ids && row.job_ids[0]) || null,
          qty: l.used,
          customer: entry.jobs[0]?.customer || null,
          job_date: null,
        }];
        for (const a of tulis) {
          const { data: ins } = await supabase.from("inventory_transactions").insert({
            inventory_code: l.inventory_code, inventory_name: l.label,
            qty: -a.qty, qty_actual: -a.qty, type: "usage",
            teknisi_name: row.teknisi_name,
            job_date: a.job_date || row.checkout_date,
            order_id: a.job_id || null,
            unit_id: l.unit_id || null, unit_label: l.unit_id ? l.label : null,
            notes: catatan,
            customer_name: a.customer || null,
            created_by: currentUser?.id || null, created_by_name: currentUser?.name || "",
          }).select("id").single();
          if (ins?.id) txIds.push(ins.id);
        }
        if (l.unit_id) {
          const total = tulis.reduce((sum, a) => sum + (Number(a.qty) || 0), 0);
          const { data: u } = await supabase.from("inventory_units").select("stock").eq("id", l.unit_id).single();
          if (u) await supabase.from("inventory_units").update({ stock: Math.max(0, Number(u.stock) - total), updated_at: new Date().toISOString() }).eq("id", l.unit_id);
        }
      }
      // Jejak koreksi: kolom terpisah + confirm_notes + agent log. Kolom `items`
      // (laporan asli teknisi) sengaja TIDAK disentuh supaya bisa dibandingkan.
      const patch = { deduct_tx_ids: txIds };
      if (changes.length) {
        const stamp = new Date().toISOString();
        patch.admin_adjustments = changes.map((c) => ({ ...c, oleh: currentUser?.name || "?", pada: stamp, alasan }));
        patch.confirm_notes = alasan;
      }
      await supabase.from("teknisi_material_checkout").update(patch).eq("id", row.id);
      if (changes.length) {
        addAgentLog?.("MATERIAL_KOREKSI_ADMIN",
          `${currentUser?.name || "?"} koreksi material ${row.teknisi_name} ${row.checkout_date}: `
          + changes.map((c) => `${c.label} ${c.dari}→${c.jadi}`).join(", ") + ` | alasan: ${alasan}`,
          "WARNING");
      }
      showNotif(`✅ Dikonfirmasi — ${lines.length} unit dipotong${changes.length ? ` (${changes.length} dikoreksi)` : ""}`);
      await refreshStock();
      await load();
    } catch (e) { showNotif("❌ Gagal potong stok (row sudah CONFIRMED — cek stok manual): " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  // ── BUKA KOREKSI — kembalikan stok sesi yang sudah dikonfirmasi, lalu set
  // sesinya kembali PENDING supaya admin membetulkan & konfirmasi ulang lewat
  // jalur normal. Tidak menyunting transaksi lama: potongannya DIBALIK dengan
  // transaksi lawan, jadi riwayatnya tetap utuh dan bisa ditelusuri.
  const bukaKoreksi = async (row) => {
    const alasan = window.prompt(
      `Buka koreksi sesi ${row.teknisi_name} ${row.checkout_date}?\n\n` +
      "Stok yang sudah dipotong akan DIKEMBALIKAN, lalu sesi ini kembali ke Menunggu " +
      "supaya Anda betulkan angka & pembagian jobnya, lalu konfirmasi ulang.\n\n" +
      "Alasan (wajib, min 5 huruf):", "");
    if (alasan === null) return;
    if (alasan.trim().length < 5) { showNotif("Alasan terlalu pendek — dibatalkan."); return; }
    setBusy(row.id);
    try {
      const { data: cur } = await supabase.from("teknisi_material_checkout")
        .select("deduct_tx_ids").eq("id", row.id).single();
      const txIds = Array.isArray(cur?.deduct_tx_ids) ? cur.deduct_tx_ids : [];

      // Klaim dulu supaya dua admin tidak membalik sesi yang sama dua kali.
      const { data: claimed } = await supabase.from("teknisi_material_checkout")
        .update({ confirm_status: "PENDING", confirmed_by: null, confirmed_at: null })
        .eq("id", row.id).eq("confirm_status", "CONFIRMED").select("id");
      if (!claimed || claimed.length === 0) {
        showNotif("Sesi ini sudah dibuka/diubah proses lain."); await load(); return;
      }

      let dikembalikan = 0;
      if (txIds.length) {
        const { data: txs } = await supabase.from("inventory_transactions")
          .select("*").in("id", txIds);
        for (const tx of (txs || [])) {
          const balik = buildReversalRow(tx, { oleh: currentUser?.name || "?", alasan: alasan.trim() });
          if (!balik) continue;
          await supabase.from("inventory_transactions").insert({ ...balik, created_by: currentUser?.id || null });
          dikembalikan++;
        }
        // Stok per tabung/roll dikembalikan sesuai jumlah yang dibalik.
        for (const [unitId, qty] of Object.entries(reversalByUnit(txs || []))) {
          const { data: u } = await supabase.from("inventory_units").select("stock").eq("id", unitId).single();
          if (u) await supabase.from("inventory_units")
            .update({ stock: Number(u.stock) + qty, updated_at: new Date().toISOString() }).eq("id", unitId);
        }
      }
      await supabase.from("teknisi_material_checkout")
        .update({ deduct_tx_ids: [], confirm_notes: `Dibuka untuk koreksi oleh ${currentUser?.name || "?"}: ${alasan.trim()}` })
        .eq("id", row.id);
      addAgentLog?.("MATERIAL_BUKA_KOREKSI",
        `${currentUser?.name || "?"} buka koreksi sesi ${row.teknisi_name} ${row.checkout_date} — ${dikembalikan} potongan dikembalikan | alasan: ${alasan.trim()}`,
        "WARNING");
      showNotif(`↩︎ ${dikembalikan} potongan dikembalikan — sesi kembali ke Menunggu`);
      await refreshStock();
      setView("PENDING");
    } catch (e) { showNotif("❌ Gagal buka koreksi: " + (e?.message || e)); }
    finally { setBusy(""); }
  };

  const bukaMewakili = async () => {
    setMewakiliOpen(true);
    if (tekList.length === 0) {
      const { data } = await supabase.from("user_profiles")
        .select("id,name,role,active").in("role", ["Teknisi", "Helper"])
        .order("name");
      setTekList((data || []).filter((u) => u.active !== false));
    }
  };

  const buatSesiMewakili = async () => {
    if (!mewakiliTek) { showNotif("Pilih teknisi dulu"); return; }
    setBusy("mewakili");
    try {
      const prof = tekList.find((u) => u.name === mewakiliTek);
      // Kalau sudah ada draft PENDING untuk teknisi+tanggal itu, jangan bikin
      // yang kedua — nanti malah jadi dua kartu untuk hari yang sama.
      const { data: ada } = await supabase.from("teknisi_material_checkout")
        .select("id").eq("teknisi_name", mewakiliTek).eq("checkout_date", mewakiliTgl)
        .eq("session_type", "pakai").eq("confirm_status", "PENDING").limit(1);
      if (ada && ada.length) {
        showNotif("Sudah ada draft untuk teknisi & tanggal itu — isi kartunya saja.");
        setMewakiliOpen(false); setView("PENDING"); await load(); return;
      }
      const { error } = await supabase.from("teknisi_material_checkout").insert({
        teknisi_name: mewakiliTek, teknisi_id: prof?.id || null,
        checkout_date: mewakiliTgl, session_type: "pakai", items: [], job_ids: [],
        confirm_status: "PENDING", source: "admin", draft_source: "admin_manual",
        needs_unit_pick: true, created_by: currentUser?.id || null,
        created_by_name: currentUser?.name || "",
        notes: `Diisi ${currentUser?.name || "admin"} mewakili ${mewakiliTek}`,
      });
      if (error) throw error;
      addAgentLog?.("MATERIAL_INPUT_MEWAKILI",
        `${currentUser?.name || "?"} buat sesi material mewakili ${mewakiliTek} tgl ${mewakiliTgl}`, "INFO");
      showNotif("✅ Draft dibuat — tambahkan barisnya di kartu bawah");
      setMewakiliOpen(false); setView("PENDING");
      await load();
    } catch (e) { showNotif("❌ Gagal: " + (e?.message || e)); }
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
    // Baris tambahan admin bisa saja belum diberi nama — tanpa nama, transaksi
    // stoknya tidak bisa dibaca siapa pun nanti.
    const tanpaNama = editedLines.filter((l) => Number(l.qty) > 0 && !String(l.label || "").trim());
    if (tanpaNama.length) { showNotif("⚠️ Isi nama material dulu untuk semua baris"); return; }
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
          // Tanggal job yang ditautkan — bukan tanggal sesi material. Kalau material
          // baru dilaporkan beberapa hari setelah pekerjaan, riwayat pemakaian &
          // biaya per job tetap jatuh di hari pekerjaan yang benar.
          teknisi_name: row.teknisi_name,
          job_date: l.per_job?.[0]?.job_date || row.checkout_date,
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={bukaMewakili}
          title="Teknisi lupa mengisi? Buat sesi materialnya dari sini — tetap lewat konfirmasi yang sama"
          style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "55", color: cs.accent, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          + Input Mewakili Teknisi
        </button>
        {pakai.length > 0 && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: cs.muted }}>
            Job sampai
            <select value={jobDays} onChange={(e) => setJobDays(Number(e.target.value))}
              style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12, cursor: "pointer" }}>
              <option value={0}>hari itu saja</option>
              <option value={3}>3 hari ke belakang</option>
              <option value={7}>7 hari ke belakang</option>
              <option value={30}>30 hari ke belakang</option>
            </select>
          </label>
        )}
        <div style={{ display: "flex", gap: 4, background: cs.surface, borderRadius: 8, padding: 3 }}>
          {["PENDING", "CONFIRMED"].map((v) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "5px 12px", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", background: view === v ? cs.accent : "transparent", color: view === v ? "#fff" : cs.muted }}>{v === "PENDING" ? "Menunggu" : "Selesai"}</button>
          ))}
        </div>
        </div>
      </div>

      {mewakiliOpen && (
        <div onClick={() => setMewakiliOpen(false)}
          style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 14, padding: 18, width: "100%", maxWidth: 420, display: "grid", gap: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>Input Material Mewakili Teknisi</div>
            <div style={{ fontSize: 12, color: cs.muted }}>
              Dipakai saat teknisi lupa mengisi Material Harian. Sesinya tetap masuk antrean
              konfirmasi yang sama — stok baru berkurang setelah Anda tekan Confirm.
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: cs.muted }}>
              Teknisi / Helper
              <select value={mewakiliTek} onChange={(e) => setMewakiliTek(e.target.value)}
                style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13 }}>
                <option value="">— pilih —</option>
                {tekList.map((u) => <option key={u.id} value={u.name}>{u.name} · {u.role}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: cs.muted }}>
              Tanggal pekerjaan
              <input type="date" value={mewakiliTgl} onChange={(e) => setMewakiliTgl(e.target.value)}
                style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13 }} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => setMewakiliOpen(false)}
                style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.text, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Batal</button>
              <button disabled={busy === "mewakili" || !mewakiliTek} onClick={buatSesiMewakili}
                style={{ background: (busy === "mewakili" || !mewakiliTek) ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: (busy === "mewakili" || !mewakiliTek) ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13 }}>
                {busy === "mewakili" ? "Membuat…" : "Buat Draft"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div style={{ color: cs.muted, fontSize: 13, padding: 16 }}>Memuat…</div>
        : empty ? <div style={{ color: cs.muted, fontSize: 13, padding: 16, textAlign: "center", background: cs.card, border: "1px solid " + cs.border, borderRadius: 12 }}>{view === "PENDING" ? "Tidak ada yang menunggu konfirmasi." : "Belum ada yang dikonfirmasi."}</div>
        : <>
          {/* DRAFT AI (pakai) — di atas biar cepat terlihat */}
          {pakai.map((entry) => (
            <PakaiCard key={entry.row.id} entry={entry} view={view} busy={busy}
              onConfirm={confirmPakai} onReject={() => reject(entry.row)}
              onBukaKoreksi={bukaKoreksi} />
          ))}

          {/* PULANG (bawa−sisa) — qty terpakai bisa dikoreksi admin sebelum potong stok */}
          {rows.map((entry) => (
            <PulangCard key={entry.pulang.id} entry={entry} view={view} busy={busy}
              photos={photosOf(entry)} onConfirm={confirm} onReject={() => reject(entry.pulang)}
              onBukaKoreksi={bukaKoreksi} />
          ))}
        </>}
    </div>
  );
}

// Kartu sesi 'pulang' (model bawa−sisa). Qty terpakai dihitung otomatis dari
// selisih laporan teknisi, tapi admin boleh mengoreksinya sebagai double-check
// sebelum stok dipotong — wajib beralasan, dan setiap koreksi ditinggalkan
// jejaknya (lihat migrasi 146).
function PulangCard({ entry, view, busy, photos, onConfirm, onReject, onBukaKoreksi }) {
  const r = entry.pulang;
  const jobOptions = entry.jobOptions || [];
  const [edit, setEdit] = useState({});     // { [lineKey]: string dari input }
  const [alasan, setAlasan] = useState("");
  // Pembagian qty terpakai per job: { [lineKey]: { [jobId]: qty } }.
  // Sengaja TIDAK di-seed ke state di awal — nilai default dihitung ulang dari
  // `used` terkini, supaya saat admin mengoreksi qty (mis. 30 → 42) pembagian
  // untuk kasus satu-job ikut menyesuaikan, bukan tertinggal di angka lama.
  const [splitMap, setSplitMap] = useState({});
  const setSplit = (k, jobId, val) =>
    setSplitMap((p) => ({ ...p, [k]: { ...(p[k] || {}), [jobId]: val } }));

  // Hanya baris yang benar-benar dibawa yang relevan. Baris terpakai 0 tetap
  // ditampilkan saat PENDING supaya admin bisa MENAIKKAN kalau teknisi lupa catat.
  const baris = entry.lines.filter((l) => Number(l.brought) > 0);
  const overrides = Object.fromEntries(
    Object.entries(edit).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, Number(v)])
  );
  const { lines: hasil, changes } = applyAdminOverrides(baris, overrides);
  const terpakai = hasil.filter((l) => l.used > 0);
  const adaKoreksi = changes.length > 0;
  const alasanKurang = adaKoreksi && alasan.trim().length < 5;

  // Pembagian efektif per baris: yang admin isi, atau default (1 job = penuh).
  const getSplit = (l) => splitMap[lineKey(l)] ?? defaultSplit(l.used, jobOptions);
  const splitEfektif = Object.fromEntries(hasil.map((l) => [lineKey(l), getSplit(l)]));
  // Kalau teknisi ini tidak punya job sama sekali di rentang, pembagian tidak
  // mungkin dilakukan — jangan kunci tombolnya, tapi beri tahu konsekuensinya.
  const tanpaJob = jobOptions.length === 0;
  const kurangBagi = tanpaJob ? [] : belumTerbagi(
    terpakai.map((l) => ({ key: lineKey(l), label: l.label, used: l.used })), splitEfektif);

  const fmt = (n) => Number(n).toLocaleString("id-ID");

  return (
    <div style={{ background: cs.card, border: "1px solid " + (adaKoreksi ? cs.yellow + "88" : cs.border), borderRadius: 12, padding: 14 }}>
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

      {/* Riwayat koreksi yang sudah tersimpan (tab Selesai) */}
      {Array.isArray(r.admin_adjustments) && r.admin_adjustments.length > 0 && (
        <div style={{ background: cs.yellow + "14", border: "1px solid " + cs.yellow + "44", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: cs.yellow, marginBottom: 4 }}>✏️ Dikoreksi admin</div>
          {r.admin_adjustments.map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: cs.text }}>{a.label}: {fmt(a.dari)} → <b>{fmt(a.jadi)}</b> <span style={{ color: cs.muted }}>· {a.oleh}</span></div>
          ))}
          {r.confirm_notes && <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 4 }}>Alasan: {r.confirm_notes}</div>}
        </div>
      )}

      <div style={{ background: cs.surface, borderRadius: 8, padding: 10, marginBottom: 8 }}>
        {baris.length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada material dibawa hari ini.</div>
          : view !== "PENDING" ? (
            terpakai.length === 0 ? <div style={{ fontSize: 12, color: cs.muted }}>Tidak ada material terpakai (semua dikembalikan).</div>
              : terpakai.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", borderTop: i ? "1px solid " + cs.border : "none" }}>
                  <span style={{ color: cs.text }}>{l.material_type === "freon" ? "🛢" : "📦"} {l.label}</span>
                  <span style={{ color: cs.muted }}>bawa {fmt(l.brought)} · sisa {fmt(l.returned)} · <b style={{ color: cs.accent }}>terpakai {fmt(l.used)}</b></span>
                </div>
              ))
          ) : hasil.map((l, i) => {
            const k = lineKey(l);
            const berubah = l.dikoreksi;
            return (
              <div key={k} style={{ padding: "7px 0", borderTop: i ? "1px solid " + cs.border : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: cs.text, fontSize: 12.5, fontWeight: 700 }}>
                    {l.material_type === "freon" ? "🛢" : "📦"} {l.label}
                    {berubah && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: cs.yellow }}>dikoreksi</span>}
                  </span>
                  <span style={{ color: cs.muted, fontSize: 11.5 }}>bawa {fmt(l.brought)} · sisa {fmt(l.returned)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                  <span style={{ fontSize: 11, color: cs.muted }}>Terpakai</span>
                  <input type="number" step="0.1" min="0" max={l.brought}
                    value={edit[k] ?? String(l.used ?? 0)}
                    onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))}
                    style={{ background: cs.card, border: "1px solid " + (berubah ? cs.yellow : cs.border), borderRadius: 6, padding: "5px 8px", color: berubah ? cs.yellow : cs.text, fontSize: 13, fontWeight: 700, width: 92 }} />
                  {berubah && <span style={{ fontSize: 11, color: cs.muted }}>asli {fmt(l.used_asli)}</span>}
                  {edit[k] != null && Number(edit[k]) > Number(l.brought) &&
                    <span style={{ fontSize: 11, color: cs.red }}>maks {fmt(l.brought)} (tak boleh lebih dari yang dibawa)</span>}
                </div>

                {/* Pembagian per job — supaya stok tercatat terpakai di pekerjaan MANA */}
                {l.used > 0 && (
                  tanpaJob ? (
                    <div style={{ fontSize: 11.5, color: cs.yellow, marginTop: 6 }}>
                      ⚠️ Tidak ada job {r.teknisi_name} di rentang ini — stok terpotong tanpa keterangan job.
                    </div>
                  ) : (
                    <div style={{ marginTop: 7, paddingLeft: 10, borderLeft: "2px solid " + cs.border, display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 11, color: cs.muted }}>Terpakai di job mana?</div>
                      {jobOptions.map((j) => (
                        <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input type="number" step="0.1" min="0"
                            value={splitEfektif[k]?.[j.id] ?? ""}
                            onChange={(e) => setSplit(k, j.id, e.target.value === "" ? "" : Number(e.target.value))}
                            style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "4px 7px", color: cs.text, fontSize: 12, width: 72 }} />
                          <span style={{ fontSize: 12, color: cs.text }}>{j.customer}</span>
                          {j.date !== r.checkout_date && <span style={{ fontSize: 10.5, color: cs.muted }}>· {j.date}</span>}
                        </div>
                      ))}
                      {(() => {
                        const sisa = splitRemainder(l.used, splitEfektif[k] || {});
                        if (Math.abs(sisa) < 0.005) return <div style={{ fontSize: 11, color: cs.green }}>✓ terbagi habis</div>;
                        return <div style={{ fontSize: 11, color: cs.yellow }}>
                          {sisa > 0 ? `sisa belum dibagi ${fmt(sisa)}` : `kelebihan ${fmt(Math.abs(sisa))}`}
                        </div>;
                      })()}
                    </div>
                  )
                )}
              </div>
            );
          })}
      </div>

      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {photos.map((u, i) => <img key={i} src={u} alt="bukti" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid " + cs.border }} />)}
        </div>
      )}

      {view === "PENDING" && adaKoreksi && (
        <div style={{ background: cs.yellow + "14", border: "1px solid " + cs.yellow + "44", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: cs.yellow, fontWeight: 700, marginBottom: 5 }}>
            {changes.length} baris dikoreksi — alasan wajib diisi (tersimpan sebagai jejak audit)
          </div>
          <input value={alasan} onChange={(e) => setAlasan(e.target.value)}
            placeholder="Contoh: sisa roll salah ukur, dicek ulang di gudang"
            style={{ width: "100%", background: cs.card, border: "1px solid " + (alasanKurang ? cs.red : cs.border), borderRadius: 6, padding: "7px 9px", color: cs.text, fontSize: 12.5 }} />
        </div>
      )}

      {view === "PENDING" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <button disabled={busy === r.id} onClick={onReject}
            style={{ background: cs.card, border: "1px solid " + cs.red + "55", color: cs.red, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Tolak</button>
          <button disabled={busy === r.id || alasanKurang || kurangBagi.length > 0}
            onClick={() => onConfirm(entry, overrides, alasan.trim(), splitEfektif)}
            style={{ background: (busy === r.id || alasanKurang || kurangBagi.length > 0) ? cs.border : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: (busy === r.id || alasanKurang || kurangBagi.length > 0) ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13 }}>
            {busy === r.id ? "Memproses…"
              : alasanKurang ? "Isi alasan koreksi dulu"
              : kurangBagi.length > 0 ? `Bagi dulu: ${kurangBagi.map((b) => b.label).join(", ")}`
              : `✓ Confirm & Potong Stok (${terpakai.length} unit)`}
          </button>
        </div>
      )}

      {view === "CONFIRMED" && (
        <button disabled={busy === r.id} onClick={() => onBukaKoreksi?.(r)}
          title="Kembalikan stok yang sudah dipotong, sesi kembali ke Menunggu untuk dibetulkan"
          style={{ background: "transparent", border: "1px solid " + cs.yellow + "66", color: cs.yellow, padding: "8px 12px", borderRadius: 9, cursor: busy === r.id ? "wait" : "pointer", fontWeight: 700, fontSize: 12.5, justifySelf: "start" }}>
          {busy === r.id ? "Memproses…" : "↩︎ Buka Koreksi (stok dikembalikan)"}
        </button>
      )}
    </div>
  );
}

// Kartu draft AI (sesi 'pakai') — baris editable: qty, job (nama customer), tabung/roll.
function PakaiCard({ entry, view, busy, onConfirm, onReject, onBukaKoreksi }) {
  const { row, jobOptions, unitsByType } = entry;
  // Job hari yang sama tetap didahulukan; job hari sebelumnya dipisah ke grup
  // tersendiri lengkap dgn tanggal, supaya admin tidak salah tempel material.
  const jobHariSama = jobOptions.filter((o) => o.date === row.checkout_date);
  const jobHariLalu = jobOptions.filter((o) => o.date !== row.checkout_date);
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
                {view === "PENDING" && l._manual ? (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, marginRight: 8 }}>
                    <select value={l.material_type} onChange={(e) => {
                      const t = e.target.value;
                      // Ganti jenis = unit lama tidak relevan lagi, jangan diwariskan.
                      setLine(i, { material_type: t, unit: t === "freon" ? "kg" : "m", unit_id: null, inventory_code: null });
                    }} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "5px 7px", color: cs.text, fontSize: 12 }}>
                      <option value="pipa">🔧 Pipa</option>
                      <option value="kabel">⚡ Kabel</option>
                      <option value="freon">🛢 Freon</option>
                      <option value="lain">📦 Lain</option>
                    </select>
                    <input value={l.label || ""} onChange={(e) => setLine(i, { label: e.target.value })}
                      placeholder="nama material"
                      style={{ background: cs.card, border: "1px solid " + (l.label ? cs.border : cs.yellow), borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12.5, flex: 1, minWidth: 90 }} />
                  </span>
                ) : (
                  <span style={{ color: cs.text, fontSize: 13, fontWeight: 700 }}>{icon(l.material_type)} {l.label} {confBadge(l)}</span>
                )}
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
                      setLine(i, { per_job: [{ job_id: jid, customer: opt?.customer || l.per_job?.[0]?.customer || null, job_date: opt?.date || null, qty: Number(l.qty) || 0 }] });
                    }} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 12.5 }}>
                      <option value="">— pilih customer —{l.per_job?.[0]?.customer && !l.per_job?.[0]?.job_id ? ` (AI: ${l.per_job[0].customer})` : ""}</option>
                      {jobHariSama.length > 0 && (
                        <optgroup label={`Hari yang sama · ${shortDateID(row.checkout_date)}`}>
                          {jobHariSama.map((o) => <option key={o.id} value={o.id}>{o.customer}{o.service ? " · " + o.service : ""}</option>)}
                        </optgroup>
                      )}
                      {jobHariLalu.length > 0 && (
                        <optgroup label="Hari sebelumnya">
                          {jobHariLalu.map((o) => <option key={o.id} value={o.id}>{shortDateID(o.date, row.checkout_date)} · {o.customer}{o.service ? " · " + o.service : ""}</option>)}
                        </optgroup>
                      )}
                      {jobOptions.length === 0 && <option value="" disabled>(tidak ada job {row.teknisi_name} di rentang ini)</option>}
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
        {view === "PENDING" && (
          <button onClick={() => setLines((ls) => [...ls, {
            material_type: "pipa", label: "", qty: 0, unit: "m",
            unit_id: null, inventory_code: null, per_job: [], _manual: true,
          }])}
            style={{ justifySelf: "start", background: "transparent", border: "1px dashed " + cs.border, color: cs.accent, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            + Tambah Baris Material
          </button>
        )}
      </div>

      {view === "PENDING" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <button disabled={busy === row.id} onClick={onReject} style={{ background: cs.card, border: "1px solid " + cs.red + "55", color: cs.red, padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Tolak</button>
          <button disabled={busy === row.id} onClick={() => onConfirm(row, lines)} style={{ background: busy === row.id ? cs.border : "linear-gradient(135deg,#10b981,#059669)", border: "none", color: "#fff", padding: 10, borderRadius: 9, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
            {busy === row.id ? "Memproses…" : "✓ Confirm & Potong Stok"}
          </button>
        </div>
      )}

      {view === "CONFIRMED" && (
        <button disabled={busy === row.id} onClick={() => onBukaKoreksi?.(row)}
          title="Kembalikan stok yang sudah dipotong, sesi kembali ke Menunggu untuk dibetulkan"
          style={{ background: "transparent", border: "1px solid " + cs.yellow + "66", color: cs.yellow, padding: "8px 12px", borderRadius: 9, cursor: busy === row.id ? "wait" : "pointer", fontWeight: 700, fontSize: 12.5, justifySelf: "start" }}>
          {busy === row.id ? "Memproses…" : "↩︎ Buka Koreksi (stok dikembalikan)"}
        </button>
      )}
    </div>
  );
}

export default MaterialConfirmTab;
