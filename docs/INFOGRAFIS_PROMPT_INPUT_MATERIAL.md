# Prompt Desain Infografis — Step-Step Input Material

> **Cara pakai file ini:** dump seluruh isi file ini sebagai prompt ke Claude (design/artifact mode). Ini bukan draft infografisnya — ini BRIEF lengkap supaya AI desain punya semua fakta yang benar tentang alur di aplikasi, tanpa perlu menebak.

## 1. Peran & Tugas
Anda adalah desainer infografis. Buat **satu infografis compact** (target 1 halaman/1 layar, format vertikal — enak dibaca di HP maupun dicetak A4) yang mengajarkan tim lapangan cara input material dengan benar di AClean Webapp.

## 2. Tujuan
Tim sering bingung karena ada **beberapa titik input material yang tampak mirip tapi tujuannya berbeda total**. Infografis ini harus membuat tim paham dalam <2 menit baca:
- Kapan pakai titik input yang mana.
- **Paling penting:** bagian mana yang benar-benar menentukan **tagihan (invoice) ke customer**, dan bagian mana yang **cuma pencatatan stok kantor** — supaya tidak ada lagi kasus customer kurang ditagih karena material dicatat di tempat yang salah.

## 3. Audiens
**Teknisi & Helper** (pengguna HP di lapangan) — bukan Owner/Admin. Bahasa Indonesia, praktis, langsung ke tindakan. Hindari istilah database/sistem backend.

## 4. Insight Kunci (jangan sampai hilang saat didesain — ini inti masalahnya)

### 4.1 Ada 2 sistem material dengan tujuan berbeda
| | Material Harian | Material di Laporan Pekerjaan |
|---|---|---|
| Lokasi | Menu terpisah "📥 Material Harian" | Di dalam alur submit laporan per job (Step 3) |
| Frekuensi | 1x per hari (bukan per job) | 1x per job |
| Fungsi | Rekonsiliasi **stok kantor** (brankas alat) | Menentukan **tagihan invoice** customer |
| Siapa yang "mengunci" | Owner confirm → baru potong stok asli | Langsung ikut ke invoice saat laporan di-submit/verify |

Kalau cuma isi salah satu, akibatnya beda: (a) isi Material Harian saja tanpa isi Laporan → **customer tidak ditagih material itu** (rugi perusahaan); (b) isi Laporan saja tanpa Material Harian → **stok kantor jadi tidak akurat** untuk rekonsiliasi.

### 4.2 Freon/Pipa/Kabel punya 3 titik input — WAJIB dijelaskan beda fungsinya
Ini bagian paling sering bikin salah paham. Tegaskan dengan visual kontras kuat (warna/label besar):

**a) Material Harian (pagi bawa → sore lapor sisa)**
Pilih tabung/roll fisik dari stok kantor, dikonfirmasi Owner, baru stok asli terpotong. **Tidak nyambung ke invoice customer sama sekali.**

**b) "📊 Stok Terpakai (Tracking)" — di dalam Laporan Pekerjaan Step 3**
Label di aplikasi secara eksplisit bilang: **"Hanya tracking stok, TIDAK masuk invoice."** Ini catatan freon/pipa/kabel yang dipakai di job itu (boleh pilih tabung spesifik). Kalau Material Harian sedang aktif dipakai kantor, bagian ini otomatis jadi info-saja (potong stok tetap lewat Material Harian, bukan dari sini) — cegah dobel potong stok.

**c) "💰 Yang Ditagih ke Customer" (section Jasa + section Barang/Sparepart) — di dalam Laporan Pekerjaan Step 3**
**INI SATU-SATUNYA yang benar-benar menentukan nilai invoice.** Freon yang mau di-charge ke customer harus **dipilih manual** dari dropdown "+ Tambah Item" di sini (masuk kategori Barang otomatis), isi jumlah dalam kg. **Tidak otomatis terisi dari (a) atau (b) di atas** — ini 3 input yang benar-benar terpisah di sistem.

### 4.3 Aturan emas untuk teknisi (jadikan 1 callout box besar di infografis)
> "Kalau customer pakai freon dan itu harus dibayar customer → **WAJIB tambahkan juga di section 💰 Barang (Yang Ditagih ke Customer)**, jangan cuma dicatat di 📊 Stok Terpakai atau di 📥 Material Harian saja. Kalau lupa langkah ini, customer TIDAK akan ditagih freon-nya sama sekali."

## 5. ALUR A — Material Harian (per hari, bukan per job)
Lokasi: menu "📥 Material Harian" (halaman terpisah dari laporan job).

**🌅 Pagi — sebelum berangkat kerja:**
1. Buka menu Material Harian.
2. Untuk tiap kategori — 🔧 Pipa AC / ⚡ Kabel / 🧪 Freon — pilih unit/tabung spesifik dari dropdown "+ Tambah unit…" (dropdown menampilkan sisa stok tiap tabung/roll di kantor).
3. Boleh pilih lebih dari 1 tabung/roll per kategori.
4. Boleh sesuaikan jumlah yang dibawa (default = seluruh stok tabung/roll itu).
5. Upload foto bukti (maksimal 5).
6. Tekan **"Simpan pagi."**
   - 💡 Kalau material "dibawa" sudah diinput lewat kartu job (tombol "📝 Laporan & Material") pagi itu, bagian ini **otomatis terisi** (badge "↺ otomatis dari job") — cukup cek angkanya lalu simpan, tidak perlu input dua kali.

**🌇 Pulang — sore setelah kerja:**
1. Buka menu yang sama, bagian "Pulang — Material Dikembalikan."
2. Untuk tiap tabung/roll yang dibawa pagi, isi **SISA** — bukan yang terpakai. Sistem otomatis hitung: **terpakai = dibawa − sisa**.
3. Centang job/customer yang dikerjakan hari itu di checklist "📋 Dipakai untuk pekerjaan hari ini."
   - ⚠️ **Ini HANYA label/tanda, bukan pembagi kuantitas.** Kalau dicentang 2 customer, sistem **TIDAK** otomatis membagi rata (misal 1kg-1kg) — qty tetap 1 angka gabungan untuk tabung itu hari itu. Boleh centang lebih dari 1 job tanpa error, tapi jangan berharap ada pembagian otomatis.
4. Upload foto bukti.
5. Tekan **"Simpan pulang."** → status jadi **PENDING**, menunggu konfirmasi Owner.
6. Setelah Owner confirm → stok kantor baru benar-benar terpotong.

## 6. ALUR B — Material per-Job di Laporan Pekerjaan (yang menentukan invoice)
Lokasi: tombol "📝 Laporan & Material" di kartu job (Dashboard/Jadwal) → Step 3 form laporan.

Ada 2 sub-bagian yang **terlihat mirip tapi fungsinya sangat beda** — di infografis WAJIB dipisah visual dengan tegas (2 kotak warna kontras + label besar "MASUK INVOICE" vs "TIDAK MASUK INVOICE").

**B1. 💰 "Yang Ditagih ke Customer" (Jasa + Barang) → MASUK INVOICE**
1. Klik dropdown "+ Tambah Item."
2. Pilih dari katalog — otomatis terkategori ⚡ Jasa/Layanan atau 📦 Sparepart & Material — atau pilih "Input manual" kalau tidak ada di katalog.
3. Isi jumlah unit/qty.
4. Freon yang mau dicharge ke customer → cari & pilih di sini (masuk kategori Barang), isi qty dalam kg.
5. Teknisi/Helper **tidak perlu isi harga** — harga & total diatur Owner saat approve invoice.

**B2. 📊 "Stok Terpakai (Tracking)" → TIDAK MASUK INVOICE**
1. Klik "+ Tambah Material" atau pakai tombol "📦 Preset" (freon/kapasitor/thermis sesuai jenis servis).
2. Cari/pilih nama material, isi jumlah.
3. Khusus freon/pipa/kabel: kalau muncul dropdown "Dari tabung/roll mana?" → pilih tabung fisik spesifik (supaya stok yang tepat yang berkurang).
   - Kalau Material Harian sedang aktif dipakai kantor, dropdown ini diganti info "potong stok dilakukan di Material Harian" — cukup catat pemakaian di sini, tanpa pilih tabung.
4. Bagian ini **tidak pernah** mempengaruhi nilai invoice — murni supaya stok internal tercatat akurat.

## 7. Struktur visual yang disarankan
- Judul besar: **"Step-Step Input Material — Mana yang Menentukan Tagihan Customer?"**
- 2 section besar berdampingan/bertumpuk: **[A] Material Harian (Stok Kantor)** vs **[B] Material di Laporan Job (Invoice Customer)** — warna kontras jelas (mis. biru netral untuk stok, ungu `#8b5cf6` untuk "Yang Ditagih" — mengikuti skema warna aplikasi asli).
- Di section B, pisahkan lagi B1 vs B2 dengan ikon beda (💰 vs 📊) dan label besar **"MASUK INVOICE"** vs **"TIDAK MASUK INVOICE"** — jangan sampai bisa salah baca sekilas.
- Callout box besar di bagian bawah (dari poin 4.3): "⚠️ Freon dicentang di HP tapi customer tidak ditagih? Cek: sudah ditambahkan di section 💰 Barang (Yang Ditagih ke Customer)?"
- Ikon konsisten dengan aplikasi: 🌅 pagi, 🌇 pulang, 🧪/❄️ freon, 🔧 pipa, ⚡ kabel, 📸 foto bukti, 📥 Material Harian, 📝 Laporan & Material.
- Format compact: prioritaskan flow diagram/numbered steps + ikon, minim paragraf panjang. Target dibaca <2 menit oleh teknisi di lapangan.

## 8. Di luar scope (jangan dimasukkan)
- Detail teknis konfirmasi Owner/Admin di back-office (atomic claim, race condition, dsb) — cukup 1 baris "menunggu konfirmasi Owner", tanpa detail teknis.
- Nama tabel database / kode internal.
