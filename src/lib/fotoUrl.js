// Satu sumber kebenaran URL foto/berkas R2.
//
// LATAR: dulu setiap foto disajikan lewat proxy `/api/foto` (serverless function
// yang menandatangani request AWS Sig V4 ke endpoint R2 privat). Artinya SETIAP
// thumbnail galeri, foto laporan, dan foto portal customer mengalir melalui
// Vercel — kena kuota bandwidth DAN invocation sekaligus. Ini penyumbang
// terbesar pemakaian kuota.
//
// Custom domain R2 (mis. https://cdn.aclean.id) disajikan langsung dari CDN.
// Domain pengembangan r2.dev tidak dipakai sebagai CDN browser karena dapat
// gagal di resolver/jaringan pelanggan; selama itu terkonfigurasi, pakai proxy.
//
// Kalau env kosong → semua kembali ke proxy lama persis seperti sebelumnya.
// Jadi ini aman di-deploy duluan sebelum custom domain-nya jadi.
//
// CATATAN KEAMANAN: kontrak produksi lama mengandalkan key yang sulit ditebak;
// jangan simpan berkas rahasia di bucket produksi publik. Bucket staging
// terisolasi memakai proxy dengan pemeriksaan peran, tanpa URL CDN langsung.
//
// JANGAN simpan URL CDN ke database. Simpan bentuk proxy/`key` apa adanya, lalu
// panggil fotoUrl() saat render — supaya pindah domain cukup ganti 1 env var.

// Basis CDN publik. Dibaca defensif: modul ini ikut ter-import di konteks tanpa
// import.meta.env (mis. runner node polos), jangan sampai meledak di sana.
const cdnBase = () => {
  try {
    return String(import.meta.env?.VITE_R2_CDN_URL || "").replace(/\/+$/, "");
  } catch { return ""; }
};

const isR2DevelopmentDomain = (base) => {
  try { return new URL(base).hostname.toLowerCase().endsWith(".r2.dev"); }
  catch { return false; }
};

// Berkas yang HARUS tetap lewat proxy, tidak boleh kena cache CDN:
// - .pdf  → invoice/report di-regenerate; proxy mengirim no-cache + Content-Disposition
//           inline (lihat api/_handlers/foto.js). Volumenya kecil, sekali unduh.
// - .html → report card, alasan sama.
const BYPASS_CDN = /\.(pdf|html?)$/i;
// Both self-hosted UI domains use the authenticated API. Keep legacy website/
// Vercel delivery unchanged; this alone does not disable public R2 URLs.
const privateStagingHost = () => {
  try { return ["staging.aclean.id", "app.aclean.id"].includes(window.location.hostname); } catch { return false; }
};

// Ambil key R2 dari bentuk apa pun yang pernah tersimpan di DB selama ini.
// Mengembalikan "" kalau url bukan berkas R2 (biar pemanggil melewatkannya apa adanya).
export const r2Key = (url) => {
  if (!url) return "";
  const s = String(url).trim();

  // 1. Bentuk proxy: /api/foto?key=... (juga versi absolut https://host/api/foto?key=...)
  if (s.includes("/foto?") || s.includes("/foto&")) {
    const m = s.match(/[?&]key=([^&#]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  }

  // 2. Domain CDN sendiri → sisanya sudah key (idempotent, aman dipanggil 2x)
  const cdn = cdnBase();
  if (cdn && s.startsWith(cdn + "/")) return s.slice(cdn.length + 1).split(/[?#]/)[0];

  // 3. Domain publik bawaan R2 (pub-xxx.r2.dev)
  if (s.includes(".r2.dev/")) {
    const m = s.match(/\.r2\.dev\/(.+)$/);
    if (m) return m[1].split(/[?#]/)[0];
  }

  // 4. Endpoint S3 privat (<account>.r2.cloudflarestorage.com/<bucket>/<key>)
  if (s.includes(".r2.cloudflarestorage.com/")) {
    const m = s.match(/cloudflarestorage\.com\/[^/]+\/(.+)$/);
    if (m) return m[1].split(/[?#]/)[0];
  }

  // 5. Path polos yang tersimpan tanpa host (mis. "laporan/JOB-123/abc.jpg")
  if (!/^https?:\/\//i.test(s) && !s.startsWith("/api/")) {
    return s.replace(/^\/+/, "").split(/[?#]/)[0];
  }

  return "";
};

// Key R2 sudah disanitasi saat upload ([^a-zA-Z0-9_\-/.] → "_"), tapi berkas lama
// dari jalur WA bisa memuat karakter lain. Encode per-segmen agar "/" tetap utuh.
const encodeKeyPath = (key) => key.split("/").map(encodeURIComponent).join("/");

// URL siap pakai untuk <img src>, <a href>, dan fetch di frontend.
// opts.apiBase → basis proxy ("/api" default; portal memakai konstanta sendiri).
export const fotoUrl = (url, opts = {}) => {
  if (!url) return "";
  const apiBase = (opts.apiBase || "/api").replace(/\/+$/, "");
  const s = String(url).trim();

  // Supabase Storage bukan R2 — biarkan apa adanya.
  if (s.includes("supabase")) return s;

  const key = r2Key(s);
  if (!key) return s; // bukan berkas R2 (URL luar) → jangan diutak-atik

  const cdn = cdnBase();
  if (cdn && !privateStagingHost() && !isR2DevelopmentDomain(cdn) && !BYPASS_CDN.test(key)) return cdn + "/" + encodeKeyPath(key);

  return apiBase + "/foto?key=" + encodeURIComponent(key);
};

// Portal publik memakai token yang sama dengan halaman status. API memeriksa
// hubungan token dengan foto laporan sebelum mengambil objek dari R2.
export const portalFotoUrl = (url, token, opts = {}) => {
  const key = r2Key(url);
  if (!key || !token) return "";
  const apiBase = (opts.apiBase || "/api").replace(/\/+$/, "");
  return `${apiBase}/portal-foto?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
};

// Bukti bayar dibuka melalui server agar URL R2 lama tidak terkena DNS/filter ISP.
export const fotoProxyUrl = (url, opts = {}) => {
  const key = r2Key(url);
  if (!key) return String(url || "").trim();
  const apiBase = (opts.apiBase || "/api").replace(/\/+$/, "");
  return `${apiBase}/foto?key=${encodeURIComponent(key)}`;
};

export default fotoUrl;
