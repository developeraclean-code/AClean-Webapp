import { useEffect, useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import { paymentMediaState, paymentWorkerState } from "../lib/paymentMediaHealth.js";

export default function PaymentInboxHealthPanel({ apiHeaders, inbox, onOpenPending }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
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
  const worker = health ? paymentWorkerState(health) : null;
  const color = worker?.level === "ok" ? cs.green : worker?.level === "error" ? cs.red : cs.yellow;
  const incidents = health?.incidents || [];
  return <section aria-label="Kesehatan bukti pembayaran WA" style={{ background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 12, fontSize: 12, overflowWrap: "anywhere" }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div><strong style={{ color: cs.text }}>📡 Bukti Pembayaran WA</strong><div style={{ color, marginTop: 4 }}>{worker?.label || "Memeriksa pemicu retry…"}</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onOpenPending} style={{ color: cs.accent, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 7, padding: 7 }}>Tinjau bukti ({health?.review ?? "…"})</button>
        <button disabled={busy || inbox?.loading} onClick={() => { inbox?.refresh(); loadRef.current?.(true); }} style={{ color: cs.text, background: cs.surface, border: `1px solid ${cs.border}`, borderRadius: 7, padding: 7 }}>{busy || inbox?.loading ? "Memuat…" : "↻ Perbarui"}</button>
      </div>
    </div>
    {(error || inbox?.error) && <p role="alert" style={{ color: cs.red }}>⚠ {error || inbox.error}. Data terakhir dipertahankan; status sehat belum dapat dipastikan.</p>}
    {health && <div style={{ color: cs.muted, marginTop: 8 }}>
      Menunggu {health.waiting} · Belum aman di R2 {health.unsecured} · Gagal {health.failed} · Retry terakhir {health.last_worker_at ? new Date(health.last_worker_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "belum tercatat"}
    </div>}
    {incidents.length > 0 && <>
      <button onClick={() => setExpanded(v => !v)} aria-expanded={expanded} style={{ marginTop: 8, color: cs.yellow, border: "none", background: "transparent", textAlign: "left" }}>{expanded ? "▾ Tutup rincian" : `▸ Periksa ${incidents.length} media bermasalah/tertunda`}</button>
      {expanded && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {incidents.map(job => { const state = paymentMediaState(job); return <article key={job.id} style={{ padding: 10, border: `1px solid ${cs.border}`, borderRadius: 8 }}>
          <strong style={{ color: cs.text }}>{job.sender_name || job.phone}</strong><span style={{ color: cs.muted }}> · {job.phone}</span>
          <div style={{ color: state.level === "error" ? cs.red : cs.yellow, marginTop: 4 }}>{state.label}</div>
          {job.last_error && <div style={{ color: cs.muted, marginTop: 4 }}>{job.last_error}</div>}
          <div style={{ color: cs.muted, marginTop: 4 }}>{new Date(job.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} · percobaan {job.attempts}/3</div>
          {job.r2_url && <a href={job.r2_url} target="_blank" rel="noreferrer" style={{ color: cs.accent }}>Buka media tersimpan</a>}
          {!job.r2_url && <div style={{ color: cs.muted }}>Periksa arsip WA. Jika ini bukti bayar, unggah melalui Lampirkan Bukti pada invoice yang benar; jangan langsung tandai lunas.</div>}
        </article>; })}
        <div style={{ color: cs.muted }}>Maksimal 50 rincian ditampilkan. Angka ringkasan mencakup seluruh antrean; tidak ada transaksi dihapus.</div>
      </div>}
    </>}
  </section>;
}
