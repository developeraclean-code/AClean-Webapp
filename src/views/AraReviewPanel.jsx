import { useEffect, useRef, useState } from "react";
import { formatAraCustomerReply } from "../lib/araPolicy.js";

export default function AraReviewPanel({ supabase, phone, onCopy }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: readError } = await supabase.from("wa_ara_reviews").select("id,reply,intent,status,reasons,created_at")
          .eq("phone", phone).in("status", ["PENDING", "GENERATING", "FAILED", "UNCERTAIN"]).order("created_at", { ascending: false }).limit(20);
        if (readError) throw readError;
        if (!cancelled) { setRows(data || []); setError(""); }
      } catch (e) { if (!cancelled) setError("Draf ARA belum dapat dimuat. Pastikan migrasi 196 sudah diterapkan. " + e.message); }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [supabase, phone, refresh]);
  const resolve = async (row, status) => {
    if (lock.current) return;
    lock.current = true; setBusy(row.id);
    try {
      const { error: saveError } = await supabase.rpc("resolve_ara_review", { p_id: row.id, p_status: status });
      if (saveError) throw saveError;
      if (!mounted.current) return;
      if (status === "COPIED") onCopy(formatAraCustomerReply(row.reply));
      setRows(prev => prev.filter(r => r.id !== row.id)); setError("");
    } catch (e) { if (mounted.current) setError(e.message || "Review gagal disimpan"); }
    finally { lock.current = false; if (mounted.current) setBusy(null); }
  };
  return <details className="wa-context-section" open={!!error}>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>🤖 Draf ARA ({rows.length}{rows.length === 20 ? "+" : ""}) · belum dikirim</summary>
    <p className="wa-muted">Periksa jawaban lalu masukkan ke kolom pesan. Pengiriman tetap memakai tombol Kirim.</p>
    <button className="wa-text-button" onClick={() => setRefresh(n => n + 1)}>Muat ulang draf</button>
    {error && <p className="wa-ops-error" role="alert">{error}</p>}
    {!rows.length && !error && <p className="wa-muted">Belum ada draf. Aktifkan ARA Chatbot Customer dengan mode Tinjau Admin untuk pesan baru.</p>}
    {rows.map(row => <article className="wa-info-card" key={row.id}>
      <strong>{row.intent || "ARA"} · {row.status}</strong>
      <small>{new Date(row.created_at).toLocaleString("id-ID")}</small>
      {row.reply && <p style={{ whiteSpace: "pre-wrap" }}>{formatAraCustomerReply(row.reply)}</p>}
      {(row.reasons || []).map((reason, i) => <p className="wa-muted" key={i}>{reason}</p>)}
      {row.status === "GENERATING" && <p className="wa-muted">Sedang diproses. Jika tidak berubah, periksa Monitoring; pesan belum dikirim.</p>}
      {row.status === "UNCERTAIN" && <p role="alert">Status pengiriman belum pasti. Periksa WhatsApp sebelum mengirim ulang.</p>}
      {row.status === "PENDING" && <div className="wa-button-pair">
        <button className="wa-primary" disabled={busy !== null} onClick={() => resolve(row, "COPIED")}>{busy === row.id ? "Memproses…" : "Tinjau & masukkan ke pesan"}</button>
        <button className="wa-secondary" disabled={busy !== null} onClick={() => resolve(row, "DISMISSED")}>Abaikan</button>
      </div>}
    </article>)}
  </details>;
}
