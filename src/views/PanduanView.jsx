import { useState } from "react";
import { cs } from "../theme/cs.js";

// Panduan in-app untuk Teknisi/Helper — versi native dari 2 infografis:
// "Step-Step Input Material" & "Cara Isi Laporan Pekerjaan". Isi diverifikasi
// langsung dari kode (laporanConstants.js, LaporanTeknisiModal.jsx,
// MaterialCheckoutView.jsx, MaterialConfirmTab.jsx) — bukan tebakan.
// Murni statis (tanpa data Supabase) supaya ringan & bisa dibaca kapan saja.

const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" };
const cardHead = (color) => ({ padding: "12px 16px", background: color + "14", borderBottom: "1px solid " + color + "33", display: "flex", alignItems: "center", gap: 10 });
const cardBody = { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 };
const stepNum = (color) => ({ flex: "none", width: 30, height: 30, borderRadius: 99, background: color, color: "#0a0f1e", fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" });
const bullet = { display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, lineHeight: 1.55, color: cs.text };
const gold = { background: cs.yellow + "12", border: "1px solid " + cs.yellow + "44", borderRadius: 10, padding: "10px 13px", fontSize: 12.5, lineHeight: 1.5, color: cs.yellow, fontWeight: 600 };
const badge = (bg, color) => ({ display: "inline-block", background: bg, color, borderRadius: 99, padding: "3px 10px", fontSize: 10.5, fontWeight: 800, letterSpacing: .3 });

function Bullet({ icon, children }) {
  return <div style={bullet}><span style={{ flex: "none" }}>{icon}</span><span>{children}</span></div>;
}

function MaterialGuide() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Insight kunci */}
      <div style={{ ...card, border: "1px solid " + cs.red + "44" }}>
        <div style={cardHead(cs.red)}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.red }}>Ada 2 Sistem Material — Tujuan Beda Total</div>
        </div>
        <div style={cardBody}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: cs.surface, borderRadius: 10, padding: 12, border: "1px solid " + cs.border }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>📥</div>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: cs.text }}>Material Harian</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Stok kantor · per hari</div>
              <div style={{ marginTop: 6 }}><span style={badge(cs.muted + "22", cs.muted)}>TIDAK KE INVOICE</span></div>
            </div>
            <div style={{ background: cs.ara + "10", borderRadius: 10, padding: 12, border: "1px solid " + cs.ara + "44" }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>📝</div>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: cs.ara }}>Material di Laporan Job</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Invoice customer · per job</div>
              <div style={{ marginTop: 6 }}><span style={badge(cs.ara, "#0a0f1e")}>MASUK INVOICE</span></div>
            </div>
          </div>
          <div style={gold}>⚠️ Isi salah satu saja → akibatnya beda: Material Harian saja → <b>customer tidak ditagih</b>. Laporan saja → <b>stok kantor meleset</b>. Sering-sering keduanya perlu diisi.</div>
        </div>
      </div>

      {/* 3 titik input freon/pipa/kabel */}
      <div style={card}>
        <div style={cardHead(cs.accent)}>
          <span style={{ fontSize: 20 }}>❄️</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Freon / Pipa / Kabel — 3 Titik Input Terpisah</div>
        </div>
        <div style={cardBody}>
          <div style={{ background: cs.surface, borderRadius: 10, padding: 12, border: "1px solid " + cs.border }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: cs.text, marginBottom: 3 }}>📥 a. Material Harian (pagi bawa → sore lapor sisa)</div>
            <div style={{ fontSize: 12, color: cs.muted, lineHeight: 1.5 }}>Pilih tabung/roll fisik dari stok kantor, dikonfirmasi Owner, baru stok asli terpotong. <b>Tidak nyambung ke invoice sama sekali.</b></div>
          </div>
          <div style={{ background: cs.surface, borderRadius: 10, padding: 12, border: "1px solid " + cs.border }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: cs.text, marginBottom: 3 }}>📊 b. "Stok Terpakai (Tracking)" — di Laporan Step 3</div>
            <div style={{ fontSize: 12, color: cs.muted, lineHeight: 1.5 }}>Catatan freon/pipa/kabel yang dipakai di job itu. Label di app sendiri bilang: <i>"Hanya tracking stok, TIDAK masuk invoice."</i></div>
          </div>
          <div style={{ background: cs.ara + "10", borderRadius: 10, padding: 12, border: "1.5px solid " + cs.ara }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: cs.ara, marginBottom: 3 }}>💰 c. "Yang Ditagih ke Customer" — di Laporan Step 3</div>
            <div style={{ fontSize: 12, color: cs.text, lineHeight: 1.5 }}><b>SATU-SATUNYA</b> yang menentukan nilai invoice. Freon yang mau di-charge harus <b>dipilih manual</b> di "+ Tambah Item" (kategori Barang), isi qty dalam <b>kg</b>.</div>
          </div>
        </div>
      </div>

      {/* Alur A */}
      <div style={card}>
        <div style={cardHead(cs.accent)}>
          <span style={{ fontSize: 20 }}>📥</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Alur A — Material Harian (Stok Kantor)</div>
        </div>
        <div style={cardBody}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: cs.yellow }}>🌅 Pagi — sebelum berangkat</div>
          <Bullet icon="1️⃣">Buka menu <b>Material Harian</b>.</Bullet>
          <Bullet icon="2️⃣">Tiap kategori (🔧 Pipa / ⚡ Kabel / 🧪 Freon) → pilih tabung dari <b>"+ Tambah unit…"</b> (tampil sisa stok tiap tabung).</Bullet>
          <Bullet icon="3️⃣">Boleh pilih &gt;1 tabung per kategori. Sesuaikan jumlah dibawa (default = semua stok tabung itu).</Bullet>
          <Bullet icon="4️⃣">📸 Upload foto bukti → tekan <b>"Simpan pagi."</b></Bullet>
          <div style={{ fontSize: 11.5, color: cs.accent, background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "8px 11px" }}>💡 Kalau material "dibawa" sudah diinput lewat kartu job (📝 Laporan &amp; Material), bagian ini <b>otomatis terisi</b> — cukup cek, tak perlu input dua kali.</div>

          <div style={{ fontWeight: 700, fontSize: 12.5, color: cs.text, marginTop: 6 }}>🌇 Pulang — sore setelah kerja</div>
          <Bullet icon="1️⃣">Buka bagian <b>"Pulang — Material Dikembalikan."</b></Bullet>
          <Bullet icon="2️⃣">Tiap tabung: isi <b>SISA</b> (bukan yang terpakai). Sistem otomatis hitung: <b>terpakai = dibawa − sisa</b>.</Bullet>
          <Bullet icon="3️⃣">Centang job hari ini di "📋 Dipakai untuk pekerjaan hari ini."</Bullet>
          <div style={gold}>⚠️ Centang ini <b>hanya label</b>, bukan pembagi qty. Centang 2 customer TIDAK otomatis bagi rata — qty tetap 1 angka gabungan untuk tabung itu.</div>
          <Bullet icon="4️⃣">📸 Upload foto → tekan <b>"Simpan pulang."</b> → status <b>PENDING</b>, menunggu konfirmasi Owner.</Bullet>
        </div>
      </div>

      {/* Alur B */}
      <div style={card}>
        <div style={cardHead(cs.ara)}>
          <span style={{ fontSize: 20 }}>📝</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Alur B — Material di Laporan Job (Menentukan Invoice)</div>
        </div>
        <div style={cardBody}>
          <div style={{ fontSize: 12, color: cs.muted }}>Tombol <b style={{ color: cs.text }}>"📝 Laporan &amp; Material"</b> di kartu job → Step 3. Ada 2 bagian mirip yang WAJIB dibedakan:</div>

          <div style={{ background: cs.ara + "10", border: "1.5px solid " + cs.ara, borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12.5, color: cs.ara }}>💰 Yang Ditagih ke Customer</span>
              <span style={badge(cs.ara, "#0a0f1e")}>MASUK INVOICE</span>
            </div>
            <Bullet icon="1️⃣">Klik dropdown <b>"+ Tambah Item."</b></Bullet>
            <Bullet icon="2️⃣">Pilih dari katalog (otomatis ⚡ Jasa / 📦 Sparepart) atau "Input manual."</Bullet>
            <Bullet icon="3️⃣">Freon yang mau dicharge → pilih di sini (Barang), isi qty <b>kg</b>.</Bullet>
            <div style={{ fontSize: 11.5, color: cs.muted }}>💡 Teknisi/Helper tak perlu isi harga — harga &amp; total diatur Owner saat approve invoice.</div>
          </div>

          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 12.5, color: cs.muted }}>📊 Stok Terpakai (Tracking)</span>
              <span style={badge(cs.muted + "22", cs.muted)}>TIDAK MASUK INVOICE</span>
            </div>
            <Bullet icon="1️⃣">Klik "+ Tambah Material" atau "📦 Preset" (freon/kapasitor/thermis).</Bullet>
            <Bullet icon="2️⃣">Cari/pilih nama material, isi jumlah.</Bullet>
            <Bullet icon="3️⃣">Freon/pipa/kabel: kalau muncul "Dari tabung mana?" → pilih tabung fisik.</Bullet>
          </div>
        </div>
      </div>

      {/* Aturan emas */}
      <div style={{ borderRadius: 14, overflow: "hidden", background: "linear-gradient(135deg," + cs.ara + "," + cs.accent + ")", padding: 2 }}>
        <div style={{ background: cs.bg, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "inline-block", background: cs.yellow, color: "#0a0f1e", borderRadius: 99, padding: "3px 11px", fontSize: 10.5, fontWeight: 800, letterSpacing: .5, marginBottom: 8 }}>🏆 ATURAN EMAS TEKNISI</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: cs.text, fontWeight: 600 }}>
            Kalau customer pakai freon dan itu harus dibayar customer → <span style={{ color: cs.accent }}>WAJIB tambahkan juga di section 💰 Barang (Yang Ditagih ke Customer)</span>, jangan cuma dicatat di 📊 Stok Terpakai atau 📥 Material Harian saja.
          </div>
          <div style={{ fontSize: 12, color: cs.muted, marginTop: 6 }}>Lupa langkah ini → customer TIDAK akan ditagih freon-nya sama sekali.</div>
        </div>
      </div>
    </div>
  );
}

function LaporanGuide() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 13px" }}>
        <span style={{ fontSize: 18 }}>ℹ️</span>
        <div style={{ fontSize: 12, color: cs.muted, lineHeight: 1.5 }}>Wizard <b style={{ color: cs.text }}>4 langkah</b> di HP. Tombol "Lanjut" akan <b style={{ color: cs.text }}>terkunci</b> kalau syarat step belum lengkap — cek kotak kuning di tiap step.</div>
      </div>

      {/* Step 1 */}
      <div style={card}>
        <div style={cardHead(cs.accent)}>
          <span style={stepNum(cs.accent)}>1</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Konfirmasi Unit</div>
        </div>
        <div style={cardBody}>
          <Bullet icon="📋">Pernah diservis? Kotak riwayat AC muncul otomatis di atas — contekan, tak wajib diisi ulang.</Bullet>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: cs.text }}>Tiap unit AC — isi 3 hal WAJIB:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={badge(cs.green + "22", cs.green)}>✓ Nama Ruangan*</span>
            <span style={badge(cs.green + "22", cs.green)}>✓ Tipe AC*</span>
            <span style={badge(cs.green + "22", cs.green)}>✓ Merk AC*</span>
            <span style={badge(cs.muted + "22", cs.muted)}>Model (opsional)</span>
          </div>
          <Bullet icon="➕">"+ Tambah Unit AC" (maks 30) kalau unit di lokasi lebih banyak dari order — Admin auto-dinotif untuk verifikasi.</Bullet>
          <Bullet icon="🏢">Customer Maintenance/B2B: bisa pilih dari "Unit Tersimpan" — tipe/merk/model otomatis terisi.</Bullet>
          <div style={gold}>⭐ Tipe AC WAJIB dipilih dari dropdown resmi (bukan ketik manual) — ini yang menentukan harga cleaning per PK.</div>
          <div style={gold}>🔒 Syarat lolos ke Step 2: semua unit lengkap Tipe AC + Nama Ruangan + Merk.</div>
        </div>
      </div>

      {/* Step 2 */}
      <div style={card}>
        <div style={cardHead(cs.yellow)}>
          <span style={stepNum(cs.yellow)}>2</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Detail Per Unit</div>
          <span style={{ marginLeft: "auto", ...badge(cs.ara + "22", cs.ara) }}>Dilewati untuk Install</span>
        </div>
        <div style={cardBody}>
          <Bullet icon="🗂️">Unit &gt;1? Pilih tab unit — jadi hijau + centang kalau sudah lengkap.</Bullet>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: cs.text }}>3 checklist per unit:</div>
          <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.yellow, marginBottom: 3 }}>⚠️ Kondisi Sebelum</div>
            <div style={{ fontSize: 11.5, color: cs.muted, lineHeight: 1.5 }}>AC Normal · Tidak Dingin · Bau Tidak Sedap · Bocor Air · Mampet Karna Lendir/Lumut · Bunyi Berisik · Tidak Menyala · Freon Habis/Kurang · Kompresor Bermasalah · AC Error</div>
          </div>
          <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.accent, marginBottom: 3 }}>🔧 Pekerjaan Dilakukan</div>
            <div style={{ fontSize: 11.5, color: cs.muted, lineHeight: 1.5 }}>Beda per jenis servis. Cleaning: Service Cleaning · <b style={{ color: cs.text }}>Deep Cleaning (Service Besar)</b> · Cleaning Indoor &amp; Outdoor · Kuras Vacum Freon · Penambahan Freon · Bersihkan Drain/Talang · Pemasangan Sparepart · Pekerjaan Lainnya.</div>
          </div>
          <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.green, marginBottom: 3 }}>✓ Kondisi Sesudah</div>
            <div style={{ fontSize: 11.5, color: cs.muted, lineHeight: 1.5 }}>AC Dingin Kembali · Masih Terkendala · Perlu Pergantian Sparepart · AC Rusak Perlu Pergantian Unit · Semua Fungsi Normal · Perlu Test Press · Perlu Pengisian/Tambah Freon · Perlu Service Besar · Tidak Melakukan Cek Freon · Tidak Melakukan Cek Ampere</div>
          </div>
          <div style={gold}>⭐ "Deep Cleaning (Service Besar)" WAJIB dicentang kalau memang kerja deep-clean — harga jasa unit itu otomatis pakai tarif Jasa Service Besar. Lupa centang = harga kepakai salah (lebih murah).</div>
          <Bullet icon="📏">Tekanan Freon (psi) &amp; Ampere Akhir (A) — opsional. <span style={{ color: cs.accent }}>Murni catatan teknis, tidak mempengaruhi invoice.</span></Bullet>
          <div style={gold}>🔒 Syarat lolos ke Step 3: tiap unit minimal 1 pekerjaan dicentang, DAN minimal 1 kondisi (sebelum/sesudah) dicentang.</div>
        </div>
      </div>

      {/* Step 3 */}
      <div style={card}>
        <div style={cardHead(cs.ara)}>
          <span style={stepNum(cs.ara)}>3</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Material &amp; Foto</div>
          <span style={{ marginLeft: "auto", ...badge(cs.ara + "22", cs.ara) }}>Install → "Form Instalasi"</span>
        </div>
        <div style={cardBody}>
          <Bullet icon="🧽">Job Repair + sekalian ada unit dicuci → centang "Tambahan Cleaning" (harga otomatis dari price list per PK).</Bullet>
          <div style={{ fontSize: 12, color: cs.muted }}>📖 Detail lengkap material &amp; freon → lihat tab <b style={{ color: cs.text }}>"Input Material"</b> di panduan ini.</div>
          <Bullet icon="📸">Foto Dokumentasi (maks 20 total termasuk foto per-unit) — bisa dikasih label &amp; ditandai untuk unit tertentu.</Bullet>
          <Bullet icon="💬">"Rekomendasi untuk Customer" (tampil ke customer) &amp; "Catatan ke Admin" (internal saja) — opsional.</Bullet>
          <div style={gold}>🔒 Syarat lolos ke Step 4: tombol "Lanjut" menunggu kalau ada foto masih upload, dan minta konfirmasi kalau ada foto gagal upload.</div>
        </div>
      </div>

      {/* Step 4 */}
      <div style={card}>
        <div style={cardHead(cs.green)}>
          <span style={stepNum(cs.green)}>4</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Ringkasan &amp; Submit</div>
        </div>
        <div style={cardBody}>
          <Bullet icon="📋">Cek ringkasan: jumlah unit, kondisi &amp; pekerjaan per unit, material, rekomendasi.</Bullet>
          <Bullet icon="🔧">Job Complain ternyata perlu perbaikan? Tombol "Upgrade ke Job Repair" bikin job Repair baru terpisah = ada invoice perbaikan sendiri (bukan gratis garansi).</Bullet>
          <Bullet icon="✓">Tekan "✓ Submit Laporan." Muncul peringatan (bukan blokir keras) kalau: unit AC kosong · Repair tanpa jasa/barang · Install tanpa detail instalasi.</Bullet>
        </div>
      </div>

      {/* Status akhir */}
      <div style={{ borderRadius: 14, background: "linear-gradient(135deg,#0F2354," + cs.accent + "22)", border: "1px solid " + cs.accent + "44", padding: 16, display: "flex", gap: 14, alignItems: "center" }}>
        <span style={{ fontSize: 30 }}>📨</span>
        <div>
          <div style={{ ...badge(cs.yellow, "#0a0f1e"), marginBottom: 6 }}>STATUS: SUBMITTED</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: cs.text }}>Setelah submit, laporan dikirim ke <b>Owner/Admin</b> untuk verifikasi &amp; pembuatan invoice — <b>bukan</b> langsung final/dibayar.</div>
        </div>
      </div>
    </div>
  );
}

function ToolBagGuide() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 13px" }}>
        <span style={{ fontSize: 18 }}>ℹ️</span>
        <div style={{ fontSize: 12, color: cs.muted, lineHeight: 1.5 }}>Cek kelengkapan tas langsung di app — <b style={{ color: cs.text }}>tanpa perlu WA</b>. Hasil AI langsung tampil di layar.</div>
      </div>

      <div style={card}>
        <div style={cardHead(cs.accent)}>
          <span style={{ fontSize: 20 }}>🎒</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Cara Cek Tas Teknisi</div>
        </div>
        <div style={cardBody}>
          <Bullet icon="1️⃣">Buka menu <b>Alat Saya</b> → cari card <b>"🎒 Cek Tas Teknisi"</b>.</Bullet>
          <Bullet icon="2️⃣">Pilih tas kamu (<b>Tas 1 – Tas 10</b>) dari dropdown.</Bullet>
          <Bullet icon="3️⃣">Pilih sesi: <b>🌅 Pagi</b> (sebelum berangkat) atau <b>🌇 Pulang</b> (selesai kerja).</Bullet>
          <Bullet icon="4️⃣">Tekan <b>"📸 Foto Isi Tas"</b> → foto semua alat dalam 1 jepretan, pastikan terang &amp; jelas.</Bullet>
          <div style={gold}>⏳ AI butuh ±15 detik menganalisa — tunggu sampai hasil muncul, jangan tutup halaman.</div>
        </div>
      </div>

      <div style={card}>
        <div style={cardHead(cs.green)}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div style={{ fontWeight: 800, fontSize: 14, color: cs.text }}>Arti Hasil Cek</div>
        </div>
        <div style={cardBody}>
          <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.green }}>✅ OK</div>
            <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 2 }}>Semua alat wajib terdeteksi lengkap. Tidak perlu tindakan apa-apa.</div>
          </div>
          <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.yellow }}>⚠️ WARNING</div>
            <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 2 }}>Ada alat non-wajib (🟡) tidak terdeteksi. Cek lagi tas, atau lapor kalau memang hilang.</div>
          </div>
          <div style={{ background: cs.red + "10", border: "1px solid " + cs.red + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.red }}>🚨 CRITICAL</div>
            <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 2 }}>Ada alat <b style={{ color: cs.text }}>WAJIB (🔴)</b> tidak terdeteksi — Owner otomatis dapat notifikasi WA. Segera cek/lengkapi tas.</div>
          </div>
          <div style={{ background: cs.muted + "10", border: "1px solid " + cs.muted + "33", borderRadius: 8, padding: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: cs.muted }}>❌ ERROR</div>
            <div style={{ fontSize: 11.5, color: cs.muted, marginTop: 2 }}>Foto buram/gelap/terlalu jauh, AI tidak bisa membaca. Foto ulang dengan pencahayaan cukup.</div>
          </div>
          <div style={gold}>⭐ Alat yang tidak seharusnya ada di tas tertentu tidak akan dihitung "hilang" — sudah otomatis diabaikan sistem berdasarkan checklist tas itu.</div>
        </div>
      </div>
    </div>
  );
}

export default function PanduanView() {
  const [tab, setTab] = useState("laporan");

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 4px" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: cs.text }}>📖 Panduan Teknisi &amp; Helper</div>
        <div style={{ fontSize: 13, color: cs.muted, marginTop: 2 }}>Baca sambil kerja kalau bingung — semua sesuai alur asli di app.</div>
      </div>

      <div style={{ display: "flex", gap: 6, background: cs.surface, borderRadius: 10, padding: 4, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setTab("material")}
          style={{ flex: 1, minWidth: 100, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12.5, background: tab === "material" ? cs.accent : "transparent", color: tab === "material" ? "#0a0f1e" : cs.muted }}>
          📥 Input Material
        </button>
        <button onClick={() => setTab("laporan")}
          style={{ flex: 1, minWidth: 100, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12.5, background: tab === "laporan" ? cs.accent : "transparent", color: tab === "laporan" ? "#0a0f1e" : cs.muted }}>
          📝 Cara Isi Laporan
        </button>
        <button onClick={() => setTab("toolbag")}
          style={{ flex: 1, minWidth: 100, padding: "9px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12.5, background: tab === "toolbag" ? cs.accent : "transparent", color: tab === "toolbag" ? "#0a0f1e" : cs.muted }}>
          🎒 Tas Teknisi
        </button>
      </div>

      {tab === "material" ? <MaterialGuide /> : tab === "laporan" ? <LaporanGuide /> : <ToolBagGuide />}
    </div>
  );
}
