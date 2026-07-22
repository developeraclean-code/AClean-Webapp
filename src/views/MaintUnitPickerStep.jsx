// Step 1 laporan KHUSUS customer maintenance (B2B kontrak, bisa 40-50 unit terdaftar).
// Ganti form isi-manual dengan grid card + search: teknisi tinggal cari & klik unit
// yang dikerjakan hari itu — data (lokasi/merk/tipe/PK) sudah dari registry admin.
// Customer REGULER tidak memakai komponen ini (lihat percabangan di LaporanTeknisiModal).
//
// Kontrak penting:
// - Unit dipilih disimpan ke laporanUnits pakai mkUnit()+maintUnitToHist() — bentuk
//   objek unit SAMA PERSIS dengan jalur lain (Step 2/3/submit tak perlu tahu bedanya).
// - Hapus unit WAJIB remap unit_no foto & cleaning-in-repair (pola sama seperti tombol
//   hapus di Step 1 reguler) supaya foto tidak nempel ke unit yang salah.
import { useState, useMemo } from "react";
import { cs } from "../theme/cs.js";
import { mkUnit, maintUnitToHist, TIPE_AC_OPT, remapUnitNo, remapUnitNoList } from "../lib/laporanConstants.js";
import { unitHealth } from "../lib/maintenanceHealth.js";
import { daysUntil } from "../lib/dateTime.js";

const MAX_UNITS = 30; // selaras cap existing (openLaporanModal & tombol tambah reguler)

const AC_TYPE_OPT = [
  { v: "split", l: "Split Wall" },
  { v: "cassette", l: "Cassette" },
  { v: "standing", l: "Floor Standing" },
  { v: "ducted", l: "Split Duct" },
];

// Syarat lolos ke Step 2 untuk jalur maintenance: Tipe AC + Nama ruangan.
// SENGAJA BEDA dari Step 1 reguler yang juga mewajibkan Merk. Alasannya (verifikasi
// data prod 20 Jul 2026): registry dimiliki Admin, dan 94 dari 343 unit aktif memang
// tidak punya merk. Merk tidak memengaruhi harga (yang dipakai untuk tarif adalah
// tipe+PK) maupun penamaan baris invoice (pakai label/unit_code) — memaksa teknisi
// mengarang merk di lapangan hanya menghasilkan data sampah. Tipe TETAP wajib karena
// itulah dasar tarif; tanpa tipe, baris jasa unit bisa hilang dari invoice.
export function unitKurangLengkap(u) {
  const kurang = [];
  if (!TIPE_AC_OPT.includes(u?.tipe)) kurang.push("Tipe AC");
  if (!u?.label || !u.label.trim()) kurang.push("Nama ruangan");
  return kurang;
}

export default function MaintUnitPickerStep({
  laporanModal, laporanUnits, setLaporanUnits, setLaporanStep,
  maintUnitPool = [], maintLogsPool = [],
  setActiveUnitIdx, setLaporanFotos, setLaporanCleaningInRepair,
  setLaporanJasaItems, setLaporanBarangItems,
  currentUser, _apiFetch, showNotif, onNewUnitProposed,
}) {
  const [q, setQ] = useState("");
  // Panel edit dikunci ke IDENTITAS unit (maint_unit_id), bukan index: index bergeser
  // tiap ada unit dihapus → panel bisa melompat & menimpa data unit lain.
  // editClosed = unit yang panelnya sengaja ditutup teknisi walau datanya masih kurang.
  const [editId, setEditId] = useState(null);
  const [editClosed, setEditClosed] = useState(() => new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [nf, setNf] = useState({ location: "", brand: "", ac_type: "split", capacity_pk: "", unit_code: "" });

  // maint_unit_id unit yang sudah masuk laporan → penanda card "terpilih"
  const pickedIds = useMemo(
    () => new Set(laporanUnits.map(u => u.maint_unit_id).filter(Boolean)),
    [laporanUnits]
  );

  // Kesehatan dihitung SEKALI per unit (bukan per render card) — pool bisa 50 unit.
  const healthById = useMemo(() => {
    const m = {};
    maintUnitPool.forEach(mu => { m[mu.id] = unitHealth(mu, maintLogsPool); });
    return m;
  }, [maintUnitPool, maintLogsPool]);

  // Unit yang SUDAH DIPILIH selalu ikut tampil walau tidak cocok pencarian — kalau
  // tersembunyi, teknisi mengira belum memilih lalu memilih ulang unit lain, dan unit
  // tersembunyi itu tak bisa di-deselect/dikoreksi (state tak terlihat).
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return maintUnitPool;
    return maintUnitPool.filter(mu =>
      pickedIds.has(mu.id) ||
      `${mu.unit_code || ""} ${mu.location || ""} ${mu.brand || ""}`.toLowerCase().includes(s));
  }, [maintUnitPool, q, pickedIds]);

  // Unit di laporan yang TIDAK berasal dari registry (mis. sisa slot kosong bawaan
  // order, atau unit manual lama) — ditampilkan terpisah supaya tidak "hilang".
  const nonRegistryUnits = laporanUnits
    .map((u, i) => ({ u, i }))
    .filter(({ u }) => !u.maint_unit_id);

  // Unit terpilih yang datanya belum memenuhi syarat lanjut ke Step 2.
  const belumLengkap = laporanUnits
    .map((u, i) => ({ u, i, kurang: unitKurangLengkap(u) }))
    .filter(x => x.kurang.length > 0);

  function removeUnitAt(idx) {
    const deletedNo = idx + 1;
    const nu = laporanUnits.filter((_, i) => i !== idx).map((u2, i) => ({ ...u2, unit_no: i + 1 }));
    setLaporanUnits(nu);
    setActiveUnitIdx(prev => Math.max(0, Math.min(prev ?? 0, nu.length - 1)));
    setEditId(null);
    // Semua referensi unit_no ikut digeser (helper bersama — jalur hapus reguler pakai yang sama)
    setLaporanFotos(prev => prev.map(f => ({ ...f, unit_no: remapUnitNo(f.unit_no, deletedNo) })));
    setLaporanCleaningInRepair(prev => remapUnitNoList(prev, deletedNo));
    setLaporanJasaItems?.(prev => (prev || []).map(j => ({ ...j, unit_no: remapUnitNo(j.unit_no, deletedNo) })));
    setLaporanBarangItems?.(prev => (prev || []).map(b => ({ ...b, unit_no: remapUnitNo(b.unit_no, deletedNo) })));
  }

  function toggleUnit(mu) {
    const idx = laporanUnits.findIndex(u => u.maint_unit_id === mu.id);
    if (idx >= 0) { removeUnitAt(idx); return; }
    if (laporanUnits.length >= MAX_UNITS) {
      showNotif?.(`⚠️ Maksimal ${MAX_UNITS} unit per laporan. Hapus unit lain dulu atau buat laporan terpisah.`);
      return;
    }
    setLaporanUnits(prev => {
      const next = [...prev, mkUnit(prev.length + 1, maintUnitToHist(mu))];
      setActiveUnitIdx(next.length - 1);
      return next.map((u, i) => ({ ...u, unit_no: i + 1 }));
    });
  }

  async function submitNewUnit() {
    if (!nf.location.trim() && !nf.unit_code.trim()) {
      showNotif?.("❌ Isi minimal Lokasi/Nama Ruangan"); return;
    }
    if (laporanUnits.length >= MAX_UNITS) {
      showNotif?.(`⚠️ Maksimal ${MAX_UNITS} unit per laporan.`); return;
    }
    setAddBusy(true);
    try {
      const r = await _apiFetch("/api/maintenance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose-new-unit",
          client_id: laporanModal.maintenance_client_id,
          job_id: laporanModal.id,
          proposed_by: currentUser?.name || "",
          unit: {
            unit_code: nf.unit_code.trim() || null,
            location: nf.location.trim(),
            brand: nf.brand.trim() || null,
            ac_type: nf.ac_type || null,
            capacity_pk: nf.capacity_pk || null,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.unit) { showNotif?.("❌ " + (j.error || "Gagal simpan unit baru")); return; }
      // Masuk pool lokal + langsung terpilih di laporan
      onNewUnitProposed?.(j.unit);
      // Index unit baru dihitung DI DALAM updater — `laporanUnits` di scope ini adalah
      // snapshot sebelum await, bisa basi kalau teknisi memilih unit lain saat request
      // masih jalan (→ Step 2 membuka unit yang salah).
      setLaporanUnits(prev => {
        const next = [...prev, mkUnit(prev.length + 1, maintUnitToHist(j.unit))];
        setActiveUnitIdx(next.length - 1);
        return next.map((u, i) => ({ ...u, unit_no: i + 1 }));
      });
      setNf({ location: "", brand: "", ac_type: "split", capacity_pk: "", unit_code: "" });
      setShowAddForm(false);
      showNotif?.(`✅ Unit ${j.unit.unit_code} ditambahkan & diajukan ke admin untuk verifikasi`);
    } catch (e) {
      showNotif?.("❌ " + (e?.message || "Gagal simpan unit baru"));
    } finally { setAddBusy(false); }
  }

  const inp = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box", width: "100%" };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Ringkasan + search */}
      <div style={{ background: "#0ea5e908", border: "1px solid #0ea5e933", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontWeight: 700, color: "#7dd3fc", fontSize: 12, marginBottom: 4 }}>
          🏢 {laporanModal.customer} — Pilih Unit yang Dikerjakan
        </div>
        <div style={{ fontSize: 11, color: cs.muted }}>
          Klik kartu unit yang kamu kerjakan hari ini. Data unit sudah terdaftar — tidak perlu ketik manual.
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: laporanUnits.length ? cs.green : cs.muted }}>
            {laporanUnits.length} unit dipilih
          </span>
          {laporanModal.units > 0 && (
            <span style={{ fontSize: 11, color: cs.muted }}>· order tercatat {laporanModal.units} unit</span>
          )}
        </div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)}
        placeholder="🔍 Cari kode unit / lokasi / merk…" style={inp} />

      {/* Grid card unit registry */}
      {maintUnitPool.length === 0 ? (
        <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic", padding: 12 }}>
          Belum ada unit terdaftar untuk klien ini — pakai "+ Tambah Unit Baru" di bawah.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 12, color: cs.muted, fontStyle: "italic", padding: 12 }}>
          Tidak ada unit cocok dengan "{q}".
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 8 }}>
          {filtered.map(mu => {
            const picked = pickedIds.has(mu.id);
            const idx = picked ? laporanUnits.findIndex(u => u.maint_unit_id === mu.id) : -1;
            const kurang = picked ? unitKurangLengkap(laporanUnits[idx]) : [];
            // Form koreksi terbuka OTOMATIS saat data unit kurang — jangan sembunyikan
            // syarat submit di balik tombol yang mungkin tak diklik teknisi.
            const isEditing = picked && (editId === mu.id || (kurang.length > 0 && !editClosed.has(mu.id)));
            const h = healthById[mu.id];
            const d = daysUntil(mu.next_service_date);
            const overdue = d !== null && d < 0;
            const dueSoon = d !== null && d >= 0 && d <= 14;
            return (
              <div key={mu.id} onClick={() => toggleUnit(mu)}
                style={{
                  background: picked ? (kurang.length ? cs.red + "0d" : cs.green + "12") : cs.card,
                  border: "2px solid " + (picked ? (kurang.length ? cs.red : cs.green) : cs.border),
                  borderRadius: 10, padding: 10, cursor: "pointer", transition: "all .15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13 }}>{picked ? "☑️" : "⬜"}</span>
                  <b style={{ color: cs.text, fontSize: 13 }}>{mu.unit_code}</b>
                  {h && h.key !== "NO_DATA" && (
                    <span title={h.reasons?.join(" · ")}
                      style={{ background: h.color + "22", color: h.color, padding: "1px 6px", borderRadius: 999, fontSize: 9, fontWeight: 700 }}>
                      {h.emoji} {h.label}
                    </span>
                  )}
                  {overdue && <span style={{ background: cs.red + "22", color: cs.red, padding: "1px 6px", borderRadius: 999, fontSize: 9, fontWeight: 700 }}>PM lewat</span>}
                  {dueSoon && !overdue && <span style={{ background: (cs.yellow || "#eab308") + "22", color: cs.yellow || "#eab308", padding: "1px 6px", borderRadius: 999, fontSize: 9, fontWeight: 700 }}>Due {d}h</span>}
                </div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>
                  {mu.location && <div>📍 {mu.location}</div>}
                  <div>{mu.brand || "—"}{mu.capacity_pk ? ` ${mu.capacity_pk}PK` : ""}{mu.ac_type ? ` · ${mu.ac_type}` : ""}</div>
                </div>
                {picked && kurang.length > 0 && (
                  <div style={{ marginTop: 6, background: cs.red + "15", border: "1px solid " + cs.red + "44", borderRadius: 6, padding: "4px 8px", fontSize: 10, color: cs.red, fontWeight: 700 }}>
                    ❗ Lengkapi: {kurang.join(", ")}
                  </div>
                )}
                {picked && (
                  <button onClick={e => {
                    e.stopPropagation();
                    if (isEditing) {
                      setEditId(null);
                      setEditClosed(prev => new Set(prev).add(mu.id));
                    } else {
                      setEditId(mu.id);
                      setEditClosed(prev => { const n = new Set(prev); n.delete(mu.id); return n; });
                    }
                  }}
                    style={{ marginTop: 6, width: "100%", background: "transparent", border: "1px dashed " + cs.border, color: cs.muted, borderRadius: 6, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>
                    ✏️ {isEditing ? "Tutup" : "Koreksi data unit"}
                  </button>
                )}
                {picked && isEditing && (
                  <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, display: "grid", gap: 6 }}>
                    <input value={laporanUnits[idx]?.label || ""} placeholder="Nama ruangan"
                      onChange={e => setLaporanUnits(prev => prev.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                      style={{ ...inp, fontSize: 11, padding: "6px 8px" }} />
                    <input value={laporanUnits[idx]?.merk || ""} placeholder="Merk (opsional)"
                      onChange={e => setLaporanUnits(prev => prev.map((x, i) => i === idx ? { ...x, merk: e.target.value } : x))}
                      style={{ ...inp, fontSize: 11, padding: "6px 8px" }} />
                    <select value={laporanUnits[idx]?.tipe || ""}
                      onChange={e => {
                        const t = e.target.value;
                        const pk = t.match(/(\d[\d.,]*PK)/i);
                        setLaporanUnits(prev => prev.map((x, i) => i === idx ? { ...x, tipe: t, pk: pk ? pk[1] : x.pk } : x));
                      }}
                      style={{ ...inp, fontSize: 11, padding: "6px 8px" }}>
                      <option value="">-- Tipe AC --</option>
                      {TIPE_AC_OPT.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div style={{ fontSize: 9, color: cs.muted }}>
                      Koreksi hanya untuk laporan ini. Perubahan permanen registry lewat Admin.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unit di laporan yang bukan dari registry — jangan sampai tak terlihat */}
      {nonRegistryUnits.length > 0 && (
        <div style={{ background: (cs.yellow || "#eab308") + "10", border: "1px solid " + (cs.yellow || "#eab308") + "33", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: cs.yellow || "#eab308", marginBottom: 6 }}>
            ⚠️ {nonRegistryUnits.length} unit belum terhubung ke registry
          </div>
          <div style={{ fontSize: 10, color: cs.muted, marginBottom: 8 }}>
            Slot bawaan order yang belum dipetakan. Pilih unit dari daftar di atas, atau hapus slot ini bila tidak dipakai.
          </div>
          <div style={{ display: "grid", gap: 5 }}>
            {nonRegistryUnits.map(({ u, i }) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: cs.text }}>
                <span style={{ flex: 1 }}>Unit {u.unit_no}{u.label ? ` — ${u.label}` : " (kosong)"}</span>
                {laporanUnits.length > 1 && (
                  <button onClick={() => removeUnitAt(i)}
                    style={{ background: "#ef444415", border: "1px solid #ef444430", color: "#ef4444", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                    Hapus
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tambah unit baru → registry (status 'baru', antre verifikasi admin) */}
      {!showAddForm ? (
        <button onClick={() => setShowAddForm(true)}
          style={{ width: "100%", background: cs.accent + "12", border: "1px dashed " + cs.accent + "55", color: cs.accent, borderRadius: 8, padding: "10px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
          + Tambah Unit Baru (belum terdaftar)
        </button>
      ) : (
        <div style={{ background: cs.card, border: "1px solid " + cs.accent + "44", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>+ Unit Baru di Lokasi Ini</div>
          <div style={{ fontSize: 10, color: cs.muted }}>
            Unit akan masuk daftar klien dengan status <b>Baru</b> dan menunggu verifikasi Admin/Owner.
          </div>
          <input value={nf.location} onChange={e => setNf(p => ({ ...p, location: e.target.value }))}
            placeholder="Lokasi / Nama Ruangan *" style={inp} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input value={nf.brand} onChange={e => setNf(p => ({ ...p, brand: e.target.value }))}
              placeholder="Merk (mis. Daikin)" style={inp} />
            <input type="number" step="0.25" value={nf.capacity_pk}
              onChange={e => setNf(p => ({ ...p, capacity_pk: e.target.value }))}
              placeholder="PK (mis. 1.5)" style={inp} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select value={nf.ac_type} onChange={e => setNf(p => ({ ...p, ac_type: e.target.value }))} style={inp}>
              {AC_TYPE_OPT.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <input value={nf.unit_code} onChange={e => setNf(p => ({ ...p, unit_code: e.target.value }))}
              placeholder="Kode unit (opsional)" style={inp} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setShowAddForm(false); setNf({ location: "", brand: "", ac_type: "split", capacity_pk: "", unit_code: "" }); }}
              style={{ flex: 1, background: cs.border, color: cs.muted, border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Batal
            </button>
            <button onClick={submitNewUnit} disabled={addBusy}
              style={{ flex: 1, background: addBusy ? cs.border : cs.accent, color: addBusy ? cs.muted : "#fff", border: "none", borderRadius: 8, padding: "9px", cursor: addBusy ? "default" : "pointer", fontWeight: 700, fontSize: 12 }}>
              {addBusy ? "⏳ Menyimpan…" : "Simpan & Pilih"}
            </button>
          </div>
        </div>
      )}

      {laporanUnits.length !== (laporanModal.units || 1) && (
        <div style={{ background: (cs.yellow || "#eab308") + "10", border: "1px solid " + (cs.yellow || "#eab308") + "22", borderRadius: 9, padding: "9px 13px", fontSize: 11, color: cs.yellow || "#eab308" }}>
          ⚠ Jumlah unit berbeda dari order. Admin akan dinotifikasi untuk verifikasi.
        </div>
      )}

      {/* Daftar kekurangan + tombol lanjut. Validasi SAMA PERSIS dengan Step 1 reguler
          supaya tidak ada jalur yang lolos dengan data lebih longgar. */}
      {belumLengkap.length > 0 && (
        <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 9, padding: "10px 13px", fontSize: 11, color: "#ef4444", fontWeight: 600 }}>
          ❌ Lengkapi dulu (kartu bertanda merah di atas):
          <div style={{ marginTop: 4, fontWeight: 500 }}>
            {belumLengkap.map(({ u, kurang }) => (
              <div key={u.unit_no}>• Unit {u.unit_no}{u.label ? ` — ${u.label}` : ""}: {kurang.join(", ")}</div>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => {
        if (laporanUnits.length === 0) { showNotif?.("⚠️ Pilih minimal 1 unit yang dikerjakan"); return; }
        if (belumLengkap.length > 0) {
          showNotif?.(`⚠️ Lengkapi dulu: ${belumLengkap.map(({ u, kurang }) => `Unit ${u.unit_no} (${kurang.join(", ")})`).join("; ")}`);
          return;
        }
        setLaporanStep(laporanModal?.service === "Install" ? 3 : 2);
      }} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "13px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 14 }}>
        Lanjut — Isi Detail Unit →
      </button>
    </div>
  );
}
