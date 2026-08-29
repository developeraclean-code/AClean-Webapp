// Panel Harga Beli (HPP) — tab Inventori.
//
// Kenapa ada: sampai 28 Agu 2026 harga beli material tidak tersimpan di mana pun (27 item,
// `price` = 0 semua, `purchase_price` terisi 2). Akibatnya "Biaya Material Aktual" di modal
// Komisi harus diketik tangan dan laporan biaya MatTrack selalu Rp 0. Panel ini pintu
// pengisian HPP, dan satu-satunya tempat HPP boleh di-set langsung (bukan hasil pembelian).
//
// Beda dengan Restock: di sini Owner/Admin MENETAPKAN harga (koreksi / isi awal), jadi nilainya
// menimpa. Restock & Tautkan Stok memakai rata-rata bergerak (src/lib/hpp.js) karena itu
// pembelian nyata yang harus dicampur dengan stok lama.
import { Fragment, useMemo, useState } from "react";
import { cs } from "../theme/cs.js";
import { useAppContext } from "../context/AppContext.js";
import { unitCostFromPack, hppLabel, hppAgeDays, isHppStale, HPP_STALE_DAYS } from "../lib/hpp.js";

const inp = {
  background: cs.card, border: "1px solid " + cs.border, borderRadius: 8,
  padding: "7px 10px", color: cs.text, fontSize: 13, outline: "none",
  boxSizing: "border-box", width: "100%",
};

const rp = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });

export default function HargaBeliTab({ inventoryData, setInventoryData }) {
  const { currentUser, supabase, showNotif } = useAppContext();
  // HPP mengubah dasar Bonus Margin & biaya material → edit manual = Owner only (anti-fraud).
  // HPP tetap terupdate otomatis dari Restock/Tautkan Stok (harga beli nyata, teraudit).
  const bolehEdit = currentUser?.role === "Owner";

  const [editCode, setEditCode] = useState(null);
  const [form, setForm] = useState({ harga: "", perPack: false, packSize: "", packUnit: "" });
  const [saving, setSaving] = useState(false);
  const [cari, setCari] = useState("");

  // Item tanpa HPP naik ke atas — kekosongan harus kelihatan, bukan tenggelam di urutan kode.
  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return [...inventoryData]
      .filter(it => !q || (it.name || "").toLowerCase().includes(q) || (it.code || "").toLowerCase().includes(q))
      .sort((a, b) => {
        const ha = Number(a.purchase_price) > 0 ? 1 : 0;
        const hb = Number(b.purchase_price) > 0 ? 1 : 0;
        if (ha !== hb) return ha - hb;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [inventoryData, cari]);

  const stat = useMemo(() => {
    const total = inventoryData.length;
    const terisi = inventoryData.filter(i => Number(i.purchase_price) > 0).length;
    const basi = inventoryData.filter(i => Number(i.purchase_price) > 0 && isHppStale(i.purchase_price_updated_at)).length;
    return { total, terisi, kosong: total - terisi, basi };
  }, [inventoryData]);

  const bukaEdit = (item) => {
    setEditCode(item.code);
    setForm({
      harga: item.purchase_price ? String(item.purchase_price) : "",
      perPack: false,
      packSize: item.pack_size ? String(item.pack_size) : "",
      packUnit: item.pack_unit || "",
    });
  };

  const packSizeNum = parseFloat(form.packSize) || 0;
  const hargaNum = parseFloat(form.harga) || 0;
  const hppBaru = form.perPack && packSizeNum > 0 ? unitCostFromPack(hargaNum, packSizeNum) : hargaNum;

  const simpan = async (item) => {
    if (!(hppBaru > 0)) { showNotif("❌ Harga beli harus lebih dari 0"); return; }
    if (form.perPack && !(packSizeNum > 0)) { showNotif("❌ Isi kemasan harus diisi dulu (mis. 30 meter per roll)"); return; }
    setSaving(true);

    const patch = {
      purchase_price: hppBaru,
      purchase_price_last: hppBaru,
      purchase_price_source: "manual",
      purchase_price_updated_at: new Date().toISOString(),
      pack_size: packSizeNum > 0 ? packSizeNum : null,
      pack_unit: form.packUnit.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("inventory").update(patch).eq("code", item.code);
    if (error) {
      showNotif("❌ Gagal simpan harga beli: " + error.message);
      setSaving(false);
      return;
    }

    setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, ...patch } : i));
    showNotif(`✅ HPP ${item.name} = ${rp(hppBaru)} ${hppLabel(item.unit)}`);
    setSaving(false);
    setEditCode(null);
  };

  const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: "0.5px" };
  const td = { padding: "9px 12px", fontSize: 12, color: cs.text };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>💵 Harga Beli Material (HPP)</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 3 }}>
          Harga yang AClean <b>bayar ke supplier</b>, per satuan dasar. Dipakai menghitung biaya material
          job & bonus margin. Bukan harga jual ke customer (itu di Price List).
        </div>
      </div>

      {/* Ringkasan kelengkapan — angka kosong harus terlihat, bukan disembunyikan */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Sudah ada HPP", val: `${stat.terisi}/${stat.total}`, warna: stat.kosong === 0 ? cs.green : cs.accent },
          { label: "Belum ada HPP", val: stat.kosong, warna: stat.kosong > 0 ? cs.red : cs.muted },
          { label: `Harga >${HPP_STALE_DAYS} hari`, val: stat.basi, warna: stat.basi > 0 ? cs.yellow : cs.muted },
        ].map(k => (
          <div key={k.label} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "10px 16px", minWidth: 130 }}>
            <div style={{ fontSize: 11, color: cs.muted }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.warna }}>{k.val}</div>
          </div>
        ))}
      </div>

      {stat.kosong > 0 && (
        <div style={{ background: cs.red + "12", border: "1px solid " + cs.red + "33", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: cs.text }}>
          ⚠️ <b>{stat.kosong} item belum punya harga beli.</b> Selama kosong, item itu dihitung
          Rp 0 di biaya material job — autosum bonus akan kurang hitung dan menandainya sebagai
          "belum ada harga beli".
        </div>
      )}

      <input value={cari} onChange={e => setCari(e.target.value)} placeholder="Cari nama / kode material..."
        style={{ ...inp, padding: "10px 14px" }} />

      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
              {["Nama Material", "Satuan", "Kemasan", "HPP / Satuan", "Umur Harga", "Sumber", ""].map(h => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, i) => {
              const hpp = Number(item.purchase_price) || 0;
              const umur = hppAgeDays(item.purchase_price_updated_at);
              const basi = hpp > 0 && isHppStale(item.purchase_price_updated_at);
              const sedangEdit = editCode === item.code;
              return (
                <Fragment key={item.code}>
                  <tr style={{ borderTop: "1px solid " + cs.border, background: i % 2 === 0 ? "transparent" : cs.surface + "80" }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {item.name}
                      <div style={{ fontFamily: "monospace", fontSize: 10, color: cs.muted }}>{item.code}</div>
                    </td>
                    <td style={{ ...td, color: cs.muted }}>{item.unit}</td>
                    <td style={{ ...td, color: cs.muted }}>
                      {item.pack_size > 0 ? `${item.pack_size} ${item.unit}/${item.pack_unit || "kemasan"}` : "—"}
                    </td>
                    <td style={{ ...td, fontFamily: "monospace", fontWeight: 700, color: hpp > 0 ? cs.text : cs.red }}>
                      {hpp > 0 ? rp(hpp) : "belum diisi"}
                    </td>
                    <td style={td}>
                      {hpp <= 0 ? <span style={{ color: cs.muted }}>—</span>
                        : <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700, background: (basi ? cs.yellow : cs.green) + "22", color: basi ? cs.yellow : cs.green, border: "1px solid " + (basi ? cs.yellow : cs.green) + "44" }}>
                            {umur === Infinity ? "tak tercatat" : umur === 0 ? "hari ini" : `${umur} hari`}
                          </span>}
                    </td>
                    <td style={{ ...td, color: cs.muted, fontSize: 11 }}>{item.purchase_price_source || "—"}</td>
                    <td style={td}>
                      {bolehEdit
                        ? <button onClick={() => sedangEdit ? setEditCode(null) : bukaEdit(item)}
                            style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                            {sedangEdit ? "Tutup" : hpp > 0 ? "✏️ Ubah" : "+ Isi Harga"}
                          </button>
                        : <span style={{ fontSize: 10, color: cs.muted, border: "1px dashed " + cs.border, borderRadius: 6, padding: "3px 8px", whiteSpace: "nowrap" }} title="Ubah harga beli (HPP) hanya bisa Owner — anti-fraud">🔒 Owner</span>}
                    </td>
                  </tr>

                  {sedangEdit && (
                    <tr style={{ background: cs.surface }}>
                      <td colSpan={7} style={{ padding: "14px 16px", borderTop: "1px solid " + cs.border }}>
                        <div style={{ display: "grid", gap: 10, maxWidth: 620 }}>
                          <div style={{ fontSize: 12, color: cs.muted }}>
                            Beli per kemasan (roll / tabung / dus)? Isi dulu isinya, lalu masukkan harga
                            per kemasan — HPP per {item.unit} dihitung otomatis.
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>
                                Isi 1 kemasan ({item.unit})
                              </div>
                              <input type="number" min="0" step="0.1" placeholder="mis. 30" value={form.packSize}
                                onChange={e => setForm(f => ({ ...f, packSize: e.target.value }))} style={inp} />
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Nama kemasan</div>
                              <input placeholder="roll / tabung / dus" value={form.packUnit}
                                onChange={e => setForm(f => ({ ...f, packUnit: e.target.value }))} style={inp} />
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga beli (Rp)</div>
                              <input type="number" min="0" autoFocus placeholder="0" value={form.harga}
                                onChange={e => setForm(f => ({ ...f, harga: e.target.value }))} style={inp} />
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga itu untuk</div>
                              <select value={form.perPack ? "pack" : "unit"}
                                onChange={e => setForm(f => ({ ...f, perPack: e.target.value === "pack" }))}
                                style={{ ...inp, cursor: "pointer" }}>
                                <option value="unit">1 {item.unit}</option>
                                <option value="pack" disabled={!(packSizeNum > 0)}>
                                  1 {form.packUnit.trim() || "kemasan"}{packSizeNum > 0 ? ` (${packSizeNum} ${item.unit})` : " — isi kemasan dulu"}
                                </option>
                              </select>
                            </div>
                          </div>

                          <div style={{ background: (hppBaru > 0 ? cs.green : cs.border) + "18", border: "1px solid " + (hppBaru > 0 ? cs.green : cs.border) + "44", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontWeight: 700, color: hppBaru > 0 ? cs.green : cs.muted }}>
                            HPP: {hppBaru > 0 ? `${rp(hppBaru)} ${hppLabel(item.unit)}` : "—"}
                          </div>

                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setEditCode(null)}
                              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "9px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Batal</button>
                            <button onClick={() => simpan(item)} disabled={saving || !(hppBaru > 0)}
                              style={{ background: saving || !(hppBaru > 0) ? cs.border : cs.green, border: "none", color: saving || !(hppBaru > 0) ? cs.muted : "#fff", padding: "9px 20px", borderRadius: 8, cursor: saving || !(hppBaru > 0) ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 12 }}>
                              {saving ? "Menyimpan..." : "💾 Simpan HPP"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: cs.muted, fontSize: 13 }}>Tidak ada material cocok.</div>}
      </div>
    </div>
  );
}
