import { useEffect, useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import { paymentMediaState, paymentWorkerResult, paymentWorkerState } from "../lib/paymentMediaHealth.js";

const wibTime = value => value && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "belum tercatat";
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("id-ID") : "—";
const tone = level => level === "ok" ? cs.green : level === "error" ? cs.red : cs.yellow;
const buttonStyle = { color: cs.text, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 7, padding: "8px 10px", cursor: "pointer", font: "inherit" };

export default function PaymentInboxHealthPanel({ apiHeaders, inbox, onOpenPending, pendingCount }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadRef = useRef(null);
  const headersRef = useRef(apiHeaders);
  headersRef.current = apiHeaders;
  useEffect(() => {
    let active = true, running = false, lastAttempt = -Infinity;
    const controller = new AbortController();
    const load = async (force = false) => {
      if (running || (!force && (document.hidden || Date.now() - lastAttempt < 15_000))) return;
      running = true; lastAttempt = Date.now();
      if (active) setBusy(true);
      const request = new AbortController();
      const abort = () => request.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(abort, 12_000);
      try {
        const r = await fetch("/api/payment-media-health", { headers: await headersRef.current(), signal: request.signal });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Status media gagal dibaca");
        if (active) { setHealth(body); setError(""); }
      } catch (e) { if (active) setError(e.message); }
      finally { clearTimeout(deadline); controller.signal.removeEventListener("abort", abort); running = false; if (active) setBusy(false); }
    };
    loadRef.current = load;
    const resume = () => load();
    const timer = setInterval(resume, 300_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    load();
    return () => {
      active = false; controller.abort(); clearInterval(timer); loadRef.current = null;
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume);
    };
  }, []);
  return <PaymentInboxHealthView health={health} error={error || inbox?.error} busy={busy || inbox?.loading}
    onRefresh={() => { inbox?.refresh(); loadRef.current?.(true); }} onOpenPending={onOpenPending} pendingCount={pendingCount} />;
}

// Shared read-only presentation, also used by the isolated local preview.
export function PaymentInboxHealthView({ health, error, busy, onRefresh, onOpenPending, pendingCount }) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("all");
  const worker = health ? paymentWorkerState(health) : null;
  const result = health ? paymentWorkerResult(health) : null;
  const incidents = health?.incidents || [];
  const groups = [
    { key: "failed", label: "Gagal otomatis", hint: "Tidak dicoba ulang otomatis. Periksa file/arsip WA; jangan menghapus riwayat atau langsung menandai lunas." },
    { key: "admin", label: "Tinjauan admin", hint: "Riwayat media yang pernah ditandai review, termasuk media lama yang kini tersaring. Hanya bukti pembayaran muncul di Pending AI; status ini bukan kegagalan retry." },
    { key: "retry", label: "Antrean retry", hint: "Masih ditangani otomatis. Retry berjalan berkala; tanggal retry adalah jadwal paling awal, bukan janji waktu selesai." },
    { key: "complete", label: "Selesai diproses", hint: "Pemrosesan media selesai, bukan penetapan pembayaran lunas." },
    { key: "unknown", label: "Status lainnya", hint: "Perbarui status dan periksa manual bila status belum dapat dipastikan." },
  ].map(group => ({ ...group, jobs: incidents.filter(job => paymentMediaState(job).group === group.key) }));
  return <section aria-label="Kesehatan bukti pembayaran WA" style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 14, fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div><strong style={{ color: cs.text, fontSize: 14 }}>📡 Bukti Pembayaran WA</strong><div style={{ color: error ? cs.yellow : tone(worker?.level), marginTop: 4 }}>{error ? "Status terkini belum dapat dipastikan" : worker?.label || "Memeriksa pemicu retry…"}</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onOpenPending} style={{ ...buttonStyle, color: cs.accent }}>Tinjau bukti ({Number.isSafeInteger(pendingCount) ? count(pendingCount) : health ? count(health.review) : "…"})</button>
        <button disabled={busy} onClick={onRefresh} style={{ ...buttonStyle, opacity: busy ? 0.6 : 1 }}>{busy ? "Memuat…" : "↻ Perbarui status"}</button>
      </div>
    </div>
    {error && <p role="alert" style={{ color: cs.red }}>⚠ {error}. Data terakhir dipertahankan; status sehat belum dapat dipastikan.</p>}
    {health && <>
      <div aria-label="Hasil pemeriksaan retry terakhir" style={{ marginTop: 12, padding: "10px 12px", border: `1px solid ${cs.border}`, borderRadius: 8, background: cs.surface }}>
        <div style={{ color: cs.muted }}>{error ? "Hasil tersimpan terakhir" : "Hasil pemeriksaan terakhir"} · {wibTime(health.last_run?.finished_at || health.last_run?.started_at)}</div>
        <strong style={{ color: tone(result.level) }}>{result.label}</strong>
        <div style={{ color: cs.muted }}>{result.detail}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
        {[
          { label: "Antrean retry", value: health.waiting, color: health.waiting > 0 ? cs.yellow : cs.green, detail: health.waiting === 0 ? "Tidak ada media menunggu retry." : `${count(health.overdue)} media menunggu >30 menit.` },
          { label: "Belum aman di R2", value: health.unsecured, color: health.unsecured > 0 ? cs.red : cs.green, detail: "Hanya antrean aktif; kegagalan lama dihitung terpisah." },
          { label: "Pending tersimpan", value: health.review, color: cs.accent, detail: "Termasuk arsip/media lama tersaring. Tombol Tinjau bukti mengikuti daftar pembayaran aktif." },
          { label: "Gagal otomatis", value: health.failed, color: health.failed > 0 ? cs.yellow : cs.green, detail: `${count(health.recent_failed)} kegagalan baru dalam 24 jam; sisanya riwayat lebih lama.` },
        ].map(item => <div key={item.label} style={{ border: `1px solid ${cs.border}`, borderRadius: 8, padding: "9px 11px", minWidth: 0 }}>
          <div style={{ color: cs.muted }}>{item.label}</div>
          <strong style={{ display: "block", color: item.color, fontSize: 22 }}>{count(item.value)}</strong>
          <div style={{ color: cs.muted, fontSize: 11 }}>{item.detail}</div>
        </div>)}
      </div>
      <div style={{ color: cs.muted, marginTop: 8, fontSize: 11 }}>Pemicu terakhir terpantau: {wibTime(health.last_worker_at)} · Data status: {wibTime(health.generated_at)}. Perbarui status hanya membaca data, bukan menjalankan retry atau AI.</div>
      <div style={{ marginTop: 8, padding: 10, border: `1px solid ${cs.border}`, borderRadius: 8 }} aria-label="Status penerimaan webhook">
        <strong style={{ color: cs.text }}>Penerimaan dari Fonnte</strong>
        {health.ingress?.available ? <>
          <div style={{ color: cs.muted }}>Webhook terakhir diterima: {wibTime(health.ingress.last_received_at)} · {count(health.ingress.recent_received)} pesan/event dalam 24 jam.</div>
          {health.ingress.review_count > 0 && <details style={{ color: cs.yellow, marginTop: 5 }}>
            <summary style={{ cursor: "pointer" }}>Periksa penerimaan webhook ({count(health.ingress.review_count)})</summary>
            {health.ingress.incidents.map(row => <div key={row.id} style={{ borderTop: `1px solid ${cs.border}`, padding: "8px 0" }}>
              <strong>{row.sender} · {row.type}</strong><div>{row.reason}</div><div style={{ color: cs.muted }}>{wibTime(row.created_at)} · ID penerimaan {row.id}</div>
            </div>)}
            <div style={{ color: cs.muted }}>Maksimal 20 rincian. Periksa arsip WA dan lampirkan file asli jika diperlukan; ini tidak menandai pembayaran lunas.</div>
          </details>}
        </> : <div style={{ color: cs.yellow }}>{health.ingress?.error || "Status penerimaan webhook belum tersedia."}</div>}
        <div style={{ color: cs.muted, marginTop: 5 }}>Antrean retry kosong bukan jaminan semua pesan WA sudah diterima. Media yang tidak dikirim Fonnte ke server belum dapat diproses atau disimpan di R2.</div>
      </div>
    </>}
    {incidents.length > 0 && <>
      <button onClick={() => setExpanded(v => !v)} aria-expanded={expanded} style={{ ...buttonStyle, marginTop: 10, color: cs.accent, textAlign: "left" }}>{expanded ? "▾ Tutup rincian media" : `▸ Rincian media (${incidents.length})`}</button>
      {expanded && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <div role="group" aria-label="Filter rincian media" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[{ key: "all", label: "Semua", jobs: incidents }, ...groups.filter(group => ["failed", "admin", "retry"].includes(group.key) || group.jobs.length)].map(group => <button key={group.key} aria-pressed={filter === group.key} onClick={() => setFilter(group.key)} style={{ ...buttonStyle, color: filter === group.key ? cs.accent : cs.muted, borderColor: filter === group.key ? cs.accent : cs.border }}>{group.label} ({group.jobs.length})</button>)}
        </div>
        {groups.filter(group => filter === "all" ? group.jobs.length : filter === group.key).map(group => <div key={group.key} aria-label={`Rincian ${group.label}`}>
          <h4 style={{ color: cs.text, margin: "8px 0 2px" }}>{group.label} · {group.jobs.length} rincian</h4>
          <p style={{ color: cs.muted, margin: "0 0 8px" }}>{group.hint}</p>
          {group.jobs.length === 0 && <p style={{ color: cs.muted }}>Tidak ada media pada kategori ini dalam rincian yang dimuat.</p>}
          <div style={{ display: "grid", gap: 8 }}>{group.jobs.map(job => { const state = paymentMediaState(job); return <article key={job.id} style={{ padding: 10, border: `1px solid ${cs.border}`, borderRadius: 8 }}>
            <strong style={{ color: cs.text }}>{job.sender_name || job.phone || "Pengirim belum diketahui"}</strong>{job.sender_name && job.phone && <span style={{ color: cs.muted }}> · {job.phone}</span>}
            <div style={{ color: tone(state.level), marginTop: 4 }}>{state.label}</div>
            <div style={{ color: cs.muted }}>{state.explanation}</div>
            <div style={{ color: cs.muted, marginTop: 4 }}>Diterima: {wibTime(job.created_at)} · {job.attempts > 0 ? `${count(job.attempts)} percobaan worker tercatat` : "Belum ada percobaan worker tercatat"}</div>
            {state.group === "retry" && job.status !== "PROCESSING" && <div style={{ color: cs.muted }}>Retry paling awal: {wibTime(job.next_retry_at)}</div>}
            {job.last_error && <details style={{ marginTop: 4, color: cs.muted }}><summary style={{ cursor: "pointer" }}>Alasan/kendala terakhir</summary>{job.last_error}</details>}
            <div style={{ color: cs.text, marginTop: 6 }}>Tindak lanjut: {state.action}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 6 }}>
              {job.r2_url && <a href={job.r2_url} target="_blank" rel="noreferrer" style={{ color: cs.accent }}>Buka media tersimpan ↗</a>}
              {job.has_suggestion && <button onClick={onOpenPending} style={{ ...buttonStyle, color: cs.accent }}>Ke daftar tinjauan</button>}
            </div>
          </article>; })}</div>
        </div>)}
        <div style={{ color: cs.muted }}>Ditampilkan {incidents.length} rincian (maksimal 50), bukan seluruh Pending AI. Angka ringkasan mencakup seluruh antrean. Tidak ada transaksi diubah atau dihapus.</div>
      </div>}
    </>}
  </section>;
}
