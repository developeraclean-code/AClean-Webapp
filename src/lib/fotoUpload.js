// handleFotoUpload — validasi + kompres + upload foto laporan ke R2, tag per-unit.
// Diekstrak dari App.jsx (Fase 3, pola ctx). `crypto` = global browser (bukan ctx).
export async function handleFotoUpload(e, {
  _apiFetch, _apiHeaders, appSettings, compressImg, currentUser, fotoTargetUnitRef,
  fotoUnitInputRef, laporanFotos, laporanModal, setLaporanFotos, showNotif,
} = {}) {
    const MAX_PHOTOS = 20;
    // Foto baru di-tag ke unit hanya jika event berasal dari input per-unit (fotoUnitInputRef).
    // Upload dari uploader global (fotoInputRef) selalu unit_no=null (umum). Cara ini kebal
    // stale-ref: kalau picker per-unit dibatalkan, upload global berikutnya tidak salah tag.
    const fromUnitInput = e.target === fotoUnitInputRef.current;
    const targetUnitNo = fromUnitInput ? fotoTargetUnitRef.current : null;
    fotoTargetUnitRef.current = null;

    // ── Validasi format — JANGAN andalkan f.type/ekstensi ──
    // Di Android (mis. Oppo/Xiaomi dgn Motion/Live Photo, atau app kamera watermark spt Timemark)
    // foto .jpg yang valid SERING salah-label: browser melapor f.type="video/mp4" dan/atau File.name
    // disintesis jadi *.mp4 padahal isinya JPEG → validasi lama (reject by MIME) menolak foto asli
    // (kasus teknisi Rey). MIME kosong ("") juga umum & dulu ikut ketolak. Gerbang SEBENARNYA =
    // decode konten via compressImg (canvas): byte gambar valid → lolos & di-encode ulang ke JPEG;
    // video/korup → gagal decode & dilewati dgn pesan jelas. Di sini cukup saring UKURAN (video
    // umumnya jauh lebih besar dari foto HP).
    const rawFiles = Array.from(e.target.files || []);
    const MAX_IMG_BYTES = 15 * 1024 * 1024; // 15MB — di atas ini hampir pasti video, bukan foto
    const tooBig = rawFiles.filter(f => f.size > MAX_IMG_BYTES);
    if (tooBig.length > 0) {
      showNotif(`❌ ${tooBig.length} file terlalu besar (>15MB) — sepertinya video. Kirim FOTO biasa (matikan Motion/Live Photo di kamera).`);
      e.target.value = "";
      return;
    }

    // ── Cek max 20 foto ──
    if (laporanFotos.length >= MAX_PHOTOS) {
      showNotif(`❌ Maksimal ${MAX_PHOTOS} foto per job. Hapus foto lain untuk upload baru.`);
      e.target.value = "";
      return;
    }

    const validFiles = rawFiles.slice(0, MAX_PHOTOS - laporanFotos.length);
    if (validFiles.length === 0) return;
    const reportId = laporanModal?.id || "tmp";

    // ── LAYER 1: Hash setiap file SEBELUM compress ──
    // Fungsi hash SHA-256 sederhana via SubtleCrypto (tersedia di semua browser modern)
    const hashFile = async (file) => {
      const buf = await file.arrayBuffer();
      const hashBuf = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16); // 16 char = cukup unik
    };

    // Hitung hash semua file sebelum compress
    const fileHashes = await Promise.all(validFiles.map(hashFile));

    // ── Get compression quality dari settings (default 0.70) ──
    const fotoQualityValue = parseFloat(appSettings?.foto_compression_quality) || 0.70;
    const fotoQuality = Math.max(0.3, Math.min(1, fotoQualityValue)); // Clamp: 30% - 100%

    // ── LAYER 2: Cek duplikat vs foto yang sudah ada di state (per sesi) ──
    const existingHashes = new Set(laporanFotos.map(f => f.hash).filter(Boolean));
    const files = [];
    const hashes = [];
    let skippedCount = 0;
    validFiles.forEach((file, i) => {
      if (existingHashes.has(fileHashes[i])) {
        skippedCount++;
      } else {
        files.push(file);
        hashes.push(fileHashes[i]);
      }
    });

    if (skippedCount > 0) {
      showNotif(`⚠️ ${skippedCount} foto sudah ada (duplikat diabaikan).`);
    }
    if (files.length === 0) { e.target.value = ""; return; }

    showNotif(`⏳ Mengkompresi & upload ${files.length} foto ke R2 (quality: ${Math.round(fotoQuality * 100)}%)...`);
    // Decode per-file (allSettled) → 1 file gagal TIDAK menggagalkan seluruh batch (dulu Promise.all
    // all-or-nothing). File yang gagal decode = bukan gambar valid (video/korup) → dilewati + dihitung.
    const settled = await Promise.allSettled(files.map(f => compressImg(f, fotoQuality)));
    const compressed = [];
    const compressedHashes = [];
    let decodeFail = 0;
    settled.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) { compressed.push(r.value); compressedHashes.push(hashes[i]); }
      else { decodeFail++; console.warn("[COMPRESS_SKIP]", files[i]?.name, r.reason?.message || r.reason); }
    });
    if (decodeFail > 0) {
      showNotif(`⚠️ ${decodeFail} file bukan gambar valid (mungkin video/Motion Photo) — dilewati.`);
    }
    if (compressed.length === 0) { e.target.value = ""; return; }

    // ✨ FIX #1: Parallel upload dengan batch 3 (3-5x lebih cepat)
    //   - Foto placeholder langsung muncul dengan flag `uploading:true`
    //   - Tombol "Next" di Step 3 di-gate selama ada yang `uploading`
    //   - Upload batch 3 concurrent → balance speed vs bandwidth HP teknisi
    const BATCH_SIZE = 3;
    const placeholders = compressed.map((dataUrl, i) => ({
      id: Date.now() + i,
      label: `Foto ${laporanFotos.length + i + 1}`,
      data_url: dataUrl,
      url: null,
      errMsg: "",
      hash: compressedHashes[i],
      uploading: true,
      unit_no: targetUnitNo || null,
    }));
    // Push placeholders ke state supaya user lihat progress langsung
    setLaporanFotos(prev => [...prev, ...placeholders]);

    const uploadOne = async (ph) => {
      try {
        const r = await _apiFetch("/api/upload-foto", {
          method: "POST",
          headers: await _apiHeaders(),
          body: JSON.stringify({
            base64: ph.data_url,
            filename: `${ph.hash}.jpg`,
            reportId,
            mimeType: "image/jpeg",
            hash: ph.hash,
            currentUserRole: currentUser?.role || "Unknown",
          }),
        });
        const d = await r.json();
        if (d.success && d.url) {
          return { id: ph.id, url: d.url, errMsg: "", uploading: false };
        }
        return { id: ph.id, url: null, errMsg: d.error || "Upload gagal", uploading: false };
      } catch (err) {
        return { id: ph.id, url: null, errMsg: err.message || "Network error", uploading: false };
      }
    };

    let savedCount = 0, failedCount = 0;
    for (let i = 0; i < placeholders.length; i += BATCH_SIZE) {
      const batch = placeholders.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(uploadOne));
      // Update state incremental per-batch
      setLaporanFotos(prev => prev.map(foto => {
        const res = results.find(r => r.id === foto.id);
        return res ? { ...foto, ...res } : foto;
      }));
      results.forEach(r => r.url ? savedCount++ : failedCount++);
    }

    if (savedCount === placeholders.length) {
      showNotif(`✅ ${savedCount} foto tersimpan di R2!`);
    } else if (savedCount > 0) {
      showNotif(`⚠️ ${savedCount} berhasil, ${failedCount} gagal. Tap ⏳ untuk retry.`);
    } else {
      showNotif(`❌ Upload gagal. Cek koneksi & coba lagi.`);
    }
    e.target.value = "";
}
