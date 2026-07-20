// api/_tool-bag-vision.js
// Analisa foto Tas Teknisi via Claude Vision — dipakai bersama oleh webhook WA
// (api/_handlers/wa.js) dan endpoint upload in-app (api/upload-toolbag.js).
// Satu sumber prompt & parsing supaya kedua jalur tidak divergen.

import { sanitizeForPrompt } from "./_validate.js";

const TOOL_VISUAL_GUIDE = `
PANDUAN VISUAL ALAT (gunakan untuk identifikasi):
- Tang Ampere Value: tang merk Value berbentuk seperti tang biasa tapi ada kepala/rahang bulat besar di tengah (clamp meter) untuk mengukur arus, biasanya ada layar LCD digital di badan tang, warna dominan kuning/hitam/merah — jika terlihat clamp meter/tang ampere apapun merknya, catat sebagai "Tang Ampere Value"
- Manifold Value: alat merk Value dengan 2-3 selang warna merah, biru, kuning/hijau terhubung ke blok logam dengan 2-3 gauge/manometer bulat besar, dipakai untuk mengukur tekanan freon AC — jika terlihat manifold gauge apapun merknya, catat sebagai "Manifold Value"
- Kunci Inggris Ukuran 10: kunci pas/wrench logam kecil ukuran kepala ~10mm, rahang bisa diputar, lebih kecil dari kunci inggris ukuran 8 yang lebih besar
- Kunci Inggris Ukuran 8: kunci pas/wrench logam ukuran kepala ~8mm, lebih besar dari ukuran 10 — PERHATIAN: ukuran 8 justru lebih besar fisiknya dari ukuran 10 karena nomor merujuk ke ukuran baut bukan ukuran kunci
- Kunci L Set: set kunci berbentuk huruf L (hex/allen key), biasanya dalam satu set/pouch berisi banyak ukuran dari kecil ke besar, bentuk silinder panjang dengan ujung segi enam
- Palu: gagang panjang kayu/plastik dengan kepala logam berat di ujung, digunakan untuk memukul
- Pahat: batang logam panjang lurus dengan ujung pipih/runcing, lebih kecil dari palu, biasanya 20-30cm
- Tang Lancip: tang dengan rahang panjang runcing/lancip seperti jarum di ujungnya, untuk memegang benda kecil di tempat sempit
- Tang Kombinasi: tang serbaguna dengan rahang bergerigi di bagian depan dan pemotong kawat di tengah, ukuran sedang
- Tang Potong: tang dengan rahang berbentuk V tanpa gigi, khusus untuk memotong kawat/kabel, ujung rahang tajam/rata
- Obeng Standar: obeng kepala plus/bintang (+) berukuran sedang-panjang, gagang biasanya merah/kuning/hitam
- Obeng Cebol: obeng pendek/kecil kepala plus (+) untuk ruang sempit, panjang total hanya 10-15cm
- Obeng Minus: obeng kepala minus/flat (-) ujung pipih lurus, gagang biasanya berwarna
- Water Pass: alat pengukur kerataan berbentuk tabung panjang (30-60cm) dengan gelembung udara di dalam tabung kaca di tengahnya, berwarna kuning/hijau/silver
- Meteran Roll 5 Meter: pita ukur dalam kotak plastik kecil, bisa ditarik dan otomatis menggulung kembali, biasanya kuning atau oranye
- Flaring Tool: alat khusus pipa tembaga terdiri dari klem/ragum logam dengan lubang berbagai ukuran dan cone/bor kerucut terpisah, untuk membuat flare di ujung pipa AC
- Cutter Pipa AC: pemotong pipa berbentuk lingkaran kecil dengan roda pemotong, cara pakai diputar mengelilingi pipa, ukuran kecil genggaman satu tangan
- Mata Las Hicook: tabung/botol kecil gas las portabel dengan selang kecil dan torch/nozel pembakar di ujung, atau kepala torch-nya saja, digunakan untuk menyolder pipa
- Kunci Pas 10: kunci pas/wrench berbentuk U di kedua ujung (double end), salah satu ujung ukuran 10mm, logam silver/chrome, bentuk lurus
- Kunci Pas 12: kunci pas/wrench double end salah satu ujung ukuran 12mm, sedikit lebih besar dari kunci pas 10
- Kabel Roll: gulungan kabel listrik/extension cord panjang dengan stop kontak di ujungnya, digulung rapi berbentuk lingkaran/koil besar
- Test Pen Kecil: obeng kecil transparan dengan lampu indikator di dalamnya untuk mendeteksi arus listrik, ukuran kecil seperti pulpen
- Gergaji Besi: gergaji dengan bingkai logam berbentuk U/C dan bilah bergerigi tipis di tengahnya, digunakan untuk memotong logam/pipa
- Cutter Standar: pisau cutter biasa dengan bilah bisa digeser masuk-keluar dari gagang plastik, ukuran standar genggaman tangan`;

function buildVisionPrompt(checklist) {
  const activeChecklist = checklist.filter(t => (t.qty_min ?? 1) > 0);
  const absentItems = checklist.filter(t => (t.qty_min ?? 1) === 0);
  const toolListText = activeChecklist.map(t =>
    `- ${sanitizeForPrompt(t.tool_name)} (dibutuhkan: ${Number(t.qty_min) || 1}×)${t.is_priority ? " [WAJIB]" : ""}`
  ).join("\n");

  return `Kamu adalah quality control untuk tim teknisi AC. Analisa foto tas alat teknisi ini dengan teliti.

DAFTAR ALAT YANG HARUS ADA DI TAS (cek keberadaan & jumlahnya):
${toolListText}

${absentItems.length > 0 ? `ALAT YANG SUDAH DIKETAHUI TIDAK ADA DI TAS INI (ABAIKAN — jangan cari di foto):
${absentItems.map(t => `- ${sanitizeForPrompt(t.tool_name)}`).join("\n")}

` : ""}${TOOL_VISUAL_GUIDE}

INSTRUKSI:
1. Gunakan panduan visual di atas untuk mengidentifikasi setiap alat dengan benar
2. Identifikasi setiap alat yang TERLIHAT JELAS di foto dan hitung jumlahnya
3. Bandingkan jumlah ditemukan vs jumlah yang dibutuhkan (qty_min)
4. Tandai sebagai hilang jika tidak ditemukan ATAU jumlahnya kurang dari yang dibutuhkan
5. Abaikan alat yang sudah ada di daftar "TIDAK ADA DI TAS INI" di atas
6. Jika foto buram, gelap, atau terlalu jauh sehingga tidak bisa dianalisa → status "foto_tidak_layak"
7. Gunakan confidence "high" hanya jika yakin betul, "medium" jika cukup yakin, "low" jika tidak yakin

FORMAT RESPONSE — JSON SAJA, tanpa teks lain:
{
  "photo_quality": "ok" | "blur" | "too_dark" | "too_far" | "foto_tidak_layak",
  "tools_found": [{"name":"Tang Ampere","qty":1,"confidence":"high"}],
  "tools_missing": [{"name":"Manifold","is_priority":true,"qty_expected":1,"qty_found":0}],
  "notes": "catatan singkat opsional"
}`;
}

// analyzeToolBagPhoto({ imageBase64, mimeType, checklist }) → { analysisResult, toolsFound, toolsMissing, checkStatus, rawText }
// checklist: [{ tool_name, qty_min, is_priority }] — hasil query tool_bag_checklist utk bag_id terkait.
export async function analyzeToolBagPhoto({ imageBase64, mimeType, checklist }) {
  const AK = (process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!AK) throw new Error("AI vision belum dikonfigurasi (ANTHROPIC_API_KEY kosong)");

  const activeChecklist = checklist.filter(t => (t.qty_min ?? 1) > 0);
  const visionPrompt = buildVisionPrompt(checklist);

  let visionRes;
  try {
    visionRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": AK, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: visionPrompt }
        ]}]
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch (e) { throw new Error("AI vision gagal/timeout: " + e.message); }
  if (!visionRes.ok) throw new Error("AI vision HTTP " + visionRes.status);

  const visionData = await visionRes.json();
  const rawText = (visionData.content || []).map(c => c.text || "").join("").trim();
  let analysisResult = null;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { analysisResult = JSON.parse(jsonMatch[0]); } catch (_) {}
  }

  let toolsFound = [];
  let toolsMissing = [];
  let checkStatus = "ERROR";

  if (analysisResult && analysisResult.photo_quality !== "foto_tidak_layak") {
    toolsFound = analysisResult.tools_found || [];
    toolsMissing = (analysisResult.tools_missing || []).map(t => {
      const cl = activeChecklist.find(c => c.tool_name.toLowerCase() === (t.name || "").toLowerCase());
      return { name: t.name, is_priority: cl?.is_priority || t.is_priority || false, qty_expected: cl?.qty_min || 1, qty_found: t.qty_found || 0 };
    });
    const hasCriticalMissing = toolsMissing.some(t => t.is_priority);
    const hasWarning = toolsMissing.length > 0;
    checkStatus = hasCriticalMissing ? "CRITICAL" : hasWarning ? "WARNING" : "OK";
  }

  return { analysisResult, toolsFound, toolsMissing, checkStatus, rawText };
}
