import AraReviewPanel from "./AraReviewPanel.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePhone, samePhone, formatPhone } from "../lib/phone.js";
import { fetchWaConversations } from "../data/reads.js";
import { createWaOrderDraft, customerRecords, fetchWaCustomers, waCustomerTitle, fetchWaHistory, invoiceBalance, matchesConversation, paymentReminder, waMoney } from "../lib/waWorkspace.js";
import "./WaPanel.css";
import WaOperationsPanel from "./WaOperationsPanel.jsx";
import { WA_STATES, SEND_STATES, isDue } from "../lib/waOperations.js";

const timeLabel = value => value ? new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "";
const dateLabel = value => value ? new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "Belum dijadwalkan";
const dayKey = value => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : "";
const initials = name => (name || "WA").split(/\s+/).slice(0, 2).map(n => n[0]).join("").toUpperCase();
const safeUrl = value => /^https?:\/\//i.test(value || "") ? value : null;

export default function WaPanel({
  open, onClose, waSearch, setWaSearch, waConversations, setWaConversations,
  selectedConv, setSelectedConv, waMessages, setWaMessages, waInput, setWaInput,
  customersData, setCustomersData, ordersData, invoicesData = [], paymentSuggestions = [],
  waProvider, isMobile, currentUser, supabase, showNotif, sendWA, addAgentLog,
  onCreateOrder, onOpenInvoice, onOpenSchedule,
  technicians = [], duration, reports = [], onAppliedPayments, onSendDocument, sendWorkspaceMessage,
}) {
  const [customerLookup, setCustomerLookup] = useState({ rows: [], verified: [], error: '' });
  const [customerRefresh, setCustomerRefresh] = useState(0);
  const [followups, setFollowups] = useState({});
  const [opsError, setOpsError] = useState("");
  const [sendStatus, setSendStatus] = useState(null);
  const sendRequests = useRef(new Map());
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [messageLimit, setMessageLimit] = useState(100);
  const [sending, setSending] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const sendingNow = useRef(false);
  const lastSent = useRef({ key: "", at: 0 });
  const activePhone = useRef(selectedConv?.phone);
  const drafts = useRef(new Map());
  const draftContexts = useRef(new Map());
  const [draftContext, setDraftContext] = useState(null);
  const inputValue = useRef(waInput);
  const dialog = useRef(null);
  const composer = useRef(null);
  const messagesEnd = useRef(null);
  const messageScroll = useRef(null);
  const stickToBottom = useRef(true);
  const isOwnerAdmin = ["Owner", "Admin"].includes(currentUser?.role);
  const phone = selectedConv?.phone;
  activePhone.current = phone;
  inputValue.current = waInput;

  const contactPhones = [...new Set([...waConversations.map(c=>c.phone), phone].filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!open || !isOwnerAdmin) return;
    let cancelled = false;
    const phones = contactPhones ? contactPhones.split(',') : [];
    setCustomerLookup(prev=>({...prev,verified:[],error:''}));
    fetchWaCustomers(supabase,phones).then(rows=>{
      if (!cancelled) setCustomerLookup({rows,verified:phones.map(normalizePhone),error:''});
    }).catch(error=>{
      if (!cancelled) setCustomerLookup(prev=>({...prev,verified:[],error:error.message}));
    });
    return()=>{cancelled=true;};
  },[open,isOwnerAdmin,supabase,contactPhones,customerRefresh]);
  const verifiedPhones = useMemo(()=>new Set(customerLookup.verified),[customerLookup.verified]);
  const contextCustomers = useMemo(()=>{
    const rows = new Map(customersData.filter(c=>!verifiedPhones.has(normalizePhone(c.phone))).map(c=>[c.id,c]));
    customerLookup.rows.forEach(c=>rows.set(c.id,c));
    return [...rows.values()];
  },[customersData,customerLookup.rows,verifiedPhones]);
  const byPhone = useMemo(() => {
    const map = new Map();
    contextCustomers.forEach(c => { const key = normalizePhone(c.phone); if(key) map.set(key, [...(map.get(key) || []), c]); });
    return map;
  }, [contextCustomers]);
  const customerVerified = verifiedPhones.has(normalizePhone(phone));
  const locations = byPhone.get(normalizePhone(phone)) || [];
  const customer = locations.find(c => String(c.id) === customerId) || (locations.length === 1 ? locations[0] : null);
  const needsLocation = locations.length > 1 && !customer;
  const orders = customerRecords(ordersData, customer, phone, contextCustomers)
    .sort((a, b) => String(b.date || b.created_at || "").localeCompare(String(a.date || a.created_at || "")));
  const customerInvoices = customerRecords(invoicesData, customer, phone, contextCustomers);
  const invoices = customerInvoices.filter(i => invoiceBalance(i) > 0)
    .sort((a, b) => String(a.due || a.created_at || "").localeCompare(String(b.due || b.created_at || "")));
  const suggestions = paymentSuggestions.filter(s => s.status === "PENDING" && samePhone(s.phone, phone));
  const nextOrder = [...orders].reverse().find(o => ["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS"].includes(o.status));
  const previousOrder = orders.find(o => o.status !== "CANCELLED");
  const totalDue = invoices.reduce((sum, inv) => sum + invoiceBalance(inv), 0);
  const unreadCount = waConversations.filter(c => c.unread > 0).length;
  const filtered = waConversations.filter(conv => {
    const known = byPhone.get(normalizePhone(conv.phone)) || [];
    return (filter !== "due" || isDue(followups[conv.phone])) && (filter !== "open" || followups[conv.phone]?.status !== "DONE") && (filter !== "unread" || conv.unread > 0) && (filter !== "new" || (verifiedPhones.has(normalizePhone(conv.phone)) && !known.length)) &&
      matchesConversation(conv, known, waSearch);
  });

  const conversationPhones = waConversations.map(c=>c.phone).join(",");
  useEffect(() => {
    if (!open || !isOwnerAdmin || !conversationPhones) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const { data, error } = await supabase.from("wa_followups").select("*").in("phone", conversationPhones.split(",")).limit(1000);
        if (error) throw error;
        if (!cancelled) { setFollowups(Object.fromEntries((data || []).map(r=>[r.phone,r]))); setOpsError(""); }
      } catch (e) { if (!cancelled) setOpsError("Tindak lanjut belum dapat dimuat. " + e.message); }
    };
    load(); const timer=setInterval(load,30000);
    return () => { cancelled=true; clearInterval(timer); };
  }, [open,isOwnerAdmin,supabase,conversationPhones,refreshKey]);

  useEffect(() => {
    if (!open || !isOwnerAdmin) return;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input, textarea:not(:disabled), select, [tabindex="0"]') || [])].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", onKey); previousFocus?.focus(); };
    // onClose is an inline App callback; reopening alone owns focus/scroll lifecycle.
  }, [open, isOwnerAdmin]);

  useEffect(() => {
    if (!open || !phone || !isOwnerAdmin) return;
    let cancelled = false;
    let busy = false;
    const load = async (initial = false) => {
      if (busy || sendingNow.current === phone || (!initial && document.hidden)) return;
      busy = true;
      if (initial) setLoading(true);
      const readBefore = new Date().toISOString();
      try {
        const data = await fetchWaHistory(supabase, phone, messageLimit);
        if (cancelled || activePhone.current !== phone || sendingNow.current === phone) return;
        setWaMessages(data);
        setHistoryError("");
        // Only mark messages read while this conversation is actually visible.
        if (!document.hidden) {
          // Do not clear unread for an inbound message that arrived after this fetch began.
          const { data: readRows, error } = await supabase.from("wa_conversations").update({ unread: 0 })
            .eq("phone", phone).lte("updated_at", readBefore).select("phone");
          if (!cancelled && !error && readRows?.length) setWaConversations(prev => prev.map(c =>
            c.phone === phone && (!c.updated_at || Date.parse(c.updated_at) <= Date.parse(readBefore)) ? { ...c, unread: 0 } : c));
          if (!cancelled && error) setHistoryError("Pesan dimuat, tetapi status dibaca gagal disimpan.");
        }
      } catch (error) {
        if (!cancelled) setHistoryError(error.message || "Riwayat gagal dimuat. Coba muat ulang.");
      } finally { busy = false; if (!cancelled) setLoading(false); }
    };
    load(true);
    const timer = setInterval(() => load(), 15000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [open, phone, supabase, messageLimit, refreshKey, isOwnerAdmin]);

  useEffect(() => {
    if (open && stickToBottom.current) messagesEnd.current?.scrollIntoView({ block: "end" });
  }, [open, waMessages, phone]);

  const selectConversation = conv => {
    if (phone === conv?.phone) return;
    if (phone) drafts.current.set(phone, inputValue.current);
    activePhone.current = conv?.phone;
    setSelectedConv(conv);
    setWaMessages([]);
    setWaInput(drafts.current.get(conv?.phone) || "");
    setDraftContext(draftContexts.current.get(conv?.phone) || null);
    setSendStatus(null); setCustomerId(""); setMessageLimit(100); setHistoryError(""); setContextOpen(false);
    stickToBottom.current = true;
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { data, error } = await fetchWaConversations(supabase, 100);
      if (error) throw error;
      if (data) setWaConversations(data);
      setCustomerRefresh(k=>k+1);
      setRefreshKey(k => k + 1);
    } catch (error) { showNotif("⚠️ Percakapan gagal dimuat: " + error.message); }
    finally { setRefreshing(false); }
  };
  const insertDraft = (text, context) => {
    if (activePhone.current !== phone) return;
    if (context) { draftContexts.current.set(phone, context); setDraftContext(context); }
    setWaInput(prev => prev.trim() ? `${prev}\n\n${text}` : text);
    composer.current?.focus();
  };
  const handleSend = async () => {
    if (sendingNow.current || !waInput.trim() || !selectedConv || !isOwnerAdmin) return;
    const txt = waInput.trim(), conv = selectedConv, key = `${conv.phone}:${draftContext?.kind || "TEXT"}:${draftContext?.customer_id || ""}:${txt}`;
    if (lastSent.current.key === key && Date.now() - lastSent.current.at < 5000) {
      showNotif("⚠️ Pesan yang sama baru saja terkirim. Tunggu sebentar sebelum mengirim ulang."); return;
    }
    sendingNow.current = conv.phone; setSending(true);
    let accepted = false;
    try {
      if (sendWorkspaceMessage) {
        const previousRequest = sendRequests.current.get(key);
        const id = previousRequest?.id || crypto.randomUUID();
        sendRequests.current.set(key, { id });
        if (activePhone.current === conv.phone) setSendStatus({ status: "SENDING" });
        const row = await sendWorkspaceMessage({ id, phone: conv.phone, message: txt, kind: draftContext?.kind || "TEXT", ...(draftContext?.customer_id ? {customer_id:draftContext.customer_id} : {}) });
        if (row.status === "FAILED") sendRequests.current.delete(key);
        if (activePhone.current === conv.phone) setSendStatus(row);
        accepted = row.status === "ACCEPTED";
        if (accepted) {
          sendRequests.current.delete(key);
          lastSent.current = { key, at: Date.now() };
          drafts.current.set(conv.phone, "");
          draftContexts.current.delete(conv.phone);
          if (activePhone.current === conv.phone) {
            setDraftContext(null);
            setWaInput(prev=>prev.trim()===txt?"":prev);
            setWaMessages(prev=>prev.some(m=>m.id===(row.message_id ?? row.id))?prev:[...prev,{id:row.message_id ?? row.id,phone:conv.phone,name:currentUser?.name || "Admin",content:txt,role:"admin",created_at:row.created_at}]);
          }
          setRefreshKey(k=>k+1);
        }
        showNotif(SEND_STATES[row.status] + (row.audit_pending ? " · audit belum tersimpan; jangan kirim ulang" : ""));
        return;
      }
      accepted = await sendWA(conv.phone, txt);
      if (!accepted) { showNotif("⚠️ Pengiriman belum terkonfirmasi. Draf disimpan; periksa percakapan sebelum mencoba lagi."); return; }
      lastSent.current = { key, at: Date.now() };
      const now = new Date().toISOString();
      const message = { phone: conv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin", created_at: now };
      if ((drafts.current.get(conv.phone) || "").trim() === txt) drafts.current.set(conv.phone, "");
      if (activePhone.current === conv.phone) {
        setWaInput(prev => prev.trim() === txt ? "" : prev);
        stickToBottom.current = true;
        setWaMessages(prev => [...prev, { ...message, id: `local-${Date.now()}` }]);
      }
      const { data: saved, error: logError } = await supabase.from("wa_messages").insert(message).select("id").single();
      if (saved && activePhone.current === conv.phone) setWaMessages(prev => prev.map(m => String(m.id).startsWith("local-") && m.created_at === now ? { ...m, id: saved.id } : m));
      const { error: convError } = await supabase.from("wa_conversations").update({ last_reply: txt.slice(0, 80), updated_at: now }).eq("phone", conv.phone);
      setWaConversations(prev => prev.map(c => c.phone === conv.phone ? { ...c, last_reply: txt.slice(0, 80), updated_at: now } : c)
        .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))));
      addAgentLog("WA_SENT_MANUAL", `Manual reply ke ${conv.name}: "${txt.slice(0, 40)}"`, "SUCCESS");
      showNotif(logError || convError ? "⚠️ Pesan terkirim, tetapi riwayat belum tersimpan lengkap. Jangan kirim ulang." : "✅ Pesan diterima gateway WhatsApp");
    } catch (error) {
      if (activePhone.current === conv.phone && sendWorkspaceMessage) setSendStatus({status:"UNCERTAIN",error:error.message});
      showNotif(accepted ? "⚠️ Pesan terkirim, tetapi riwayat gagal diperbarui. Jangan kirim ulang." : "⚠️ Status pengiriman belum pasti. Periksa percakapan sebelum mencoba lagi: " + error.message);
    } finally { sendingNow.current = false; setSending(false); }
  };
  const saveCustomer = async () => {
    if (!customerVerified || locations.length) return;
    const name = window.prompt("Nama customer untuk " + phone + ":", selectedConv.name || "");
    if (!name?.trim() || savingCustomer) return;
    setSavingCustomer(true);
    try {
      const { data, error } = await supabase.from("customers").insert({ name: name.trim(), phone: normalizePhone(phone), area: "", total_orders: 0 }).select().single();
      if (error) throw error;
      setCustomersData(prev => [...prev, data]);
      setCustomerLookup(prev=>({...prev,rows:[...prev.rows,data]})); showNotif("✅ Customer berhasil ditambahkan");
    } catch (error) { showNotif("❌ Gagal menyimpan customer: " + error.message); }
    finally { setSavingCustomer(false); }
  };
  const createOrder = previous => {
    if (needsLocation || !customerVerified) return;
    onCreateOrder(createWaOrderDraft(selectedConv, customer, previous));
  };

  if (!open || !isOwnerAdmin) return null;
  const visibleMessages = waMessages.filter(m => samePhone(m.phone, phone));
  const person = waCustomerTitle(selectedConv,locations,customerId);

  return (
    <div className="wa-overlay" onClick={onClose}>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="wa-workspace-title" tabIndex={-1}
        className={`wa-workspace ${expanded ? "is-expanded" : ""} ${isMobile ? "is-mobile" : ""} ${selectedConv ? "has-chat" : ""} ${contextOpen ? "show-context" : ""}`}
        onClick={e => e.stopPropagation()}>
        <header className="wa-topbar">
          <div className="wa-brand-icon">◉</div>
          <div className="wa-grow"><h2 id="wa-workspace-title">WhatsApp <span>Workspace</span></h2><p>AClean · {waProvider === "fonnte" ? "Fonnte" : waProvider === "wa_cloud" ? "WA Cloud API" : "Twilio"} · {waConversations.length} percakapan dimuat</p></div>
          <span className="wa-top-note">Percakapan & operasional</span>
          <button className="wa-icon-button" onClick={refresh} disabled={refreshing} aria-label="Muat ulang percakapan" title="Muat ulang percakapan">{refreshing ? "…" : "↻"}</button>
          <button className="wa-icon-button wa-expand" onClick={() => setExpanded(v => !v)} aria-label={expanded ? "Perkecil panel" : "Perbesar panel"} title={expanded ? "Perkecil panel" : "Perbesar panel"}>{expanded ? "↙" : "↗"}</button>
          <button className="wa-icon-button" onClick={onClose} aria-label="Tutup WhatsApp">×</button>
        </header>
        <div className="wa-body">
          <aside className="wa-inbox" aria-label="Daftar percakapan">
            <div className="wa-inbox-tools"><div className="wa-section-heading"><h3>Kotak masuk</h3><span className="wa-count">{unreadCount} belum dibaca</span></div>
              <div className="wa-search"><span aria-hidden="true">⌕</span><input aria-label="Cari percakapan" value={waSearch} onChange={e => setWaSearch(e.target.value)} placeholder="Cari nama, nomor, pesan…" />{waSearch && <button aria-label="Hapus pencarian" onClick={() => setWaSearch("")}>×</button>}</div>
              <div className="wa-filters">{[["all", "Semua"], ["unread", "Belum dibaca"], ["new", "Baru"], ["open", "Belum selesai"], ["due", "Jatuh follow-up"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div>
            </div>
            {customerLookup.error && <p className="wa-ops-error" role="alert">Nama Customer belum dapat diverifikasi: {customerLookup.error} <button onClick={()=>setCustomerRefresh(k=>k+1)}>Coba lagi nama pelanggan</button></p>}
            {opsError && <p className="wa-ops-error" role="alert">{opsError} <button onClick={()=>setRefreshKey(k=>k+1)}>Muat ulang</button></p>}
            <div className="wa-conversations">
              {!filtered.length && <div className="wa-empty"><span>⌕</span><strong>{waSearch || filter !== "all" ? "Tidak ada percakapan yang cocok" : "Belum ada pesan masuk"}</strong><p>{waSearch || filter !== "all" ? "Ubah pencarian atau filter untuk melihat chat lainnya." : "Percakapan dari gateway WhatsApp akan muncul di sini."}</p></div>}
              {filtered.map(conv => {
                const known = byPhone.get(normalizePhone(conv.phone)) || [];
                const name = waCustomerTitle(conv,known);
                const verified = verifiedPhones.has(normalizePhone(conv.phone));
                return <button data-phone={normalizePhone(conv.phone)} key={conv.id || conv.phone} className={`wa-conversation ${phone === conv.phone ? "active" : ""}`} onClick={() => selectConversation(conv)} aria-pressed={phone === conv.phone}>
                  <span className={`wa-avatar ${known.length ? "known" : ""}`}>{initials(name)}</span>
                  <span className="wa-conversation-copy"><span className="wa-conversation-title"><strong title={name}>{name}</strong><small>{timeLabel(conv.updated_at)}</small></span>
                    <span className="wa-conversation-phone">{formatPhone(conv.phone)}</span>
                    <span className="wa-customer-label">{!verified ? (customerLookup.error ? 'Nama belum terverifikasi' : 'Memeriksa pelanggan…') : known.length > 1 ? `${known.length} lokasi pelanggan · pilih lokasi` : known.length ? 'Pelanggan terdaftar' : 'Kontak baru'}</span>
                    {followups[conv.phone] && <span className="wa-customer-label">{isDue(followups[conv.phone])?"⏰ ":""}{WA_STATES[followups[conv.phone].status]}{followups[conv.phone].assignee?` · ${followups[conv.phone].assignee}`:""}</span>}
                    <span className="wa-conversation-preview"><span>{conv.last_message || conv.last || conv.last_reply || "Belum ada pesan"}</span>{conv.unread > 0 && <b className="wa-unread">{conv.unread > 99 ? "99+" : conv.unread}</b>}</span>
                  </span>
                </button>;
              })}
            </div><footer className="wa-inbox-footer">{filtered.length} percakapan · Cari dalam chat yang dimuat</footer>
          </aside>
          <main className="wa-chat" aria-label="Percakapan WhatsApp">
            {!selectedConv ? <div className="wa-welcome"><div className="wa-welcome-icon">◉</div><span className="wa-eyebrow">WHATSAPP × ACLEAN</span><h2>Setiap chat, langkah berikutnya.</h2><p>Pilih percakapan untuk membalas pelanggan, menjadwalkan servis, dan menindaklanjuti pembayaran.</p><div className="wa-welcome-features"><span>↗ Jadwalkan servis</span><span>↻ Reorder</span><span>↗ Pembayaran</span></div><small>Riwayat yang tersedia berasal dari gateway WhatsApp AClean.</small></div> : <>
              <header className="wa-chat-header"><button className="wa-icon-button wa-back" onClick={() => selectConversation(null)} aria-label="Kembali ke daftar chat">‹</button><span className="wa-avatar known">{initials(person)}</span><div className="wa-grow"><h3>{person}</h3><p>{formatPhone(phone)} <span>· {!customerVerified ? "Nama belum terverifikasi" : locations.length ? "Pelanggan terdaftar" : "Kontak baru"}</span></p>{selectedConv.name && selectedConv.name !== person && <small className="wa-whatsapp-alias">Nama WhatsApp: {selectedConv.name}</small>}</div><button className="wa-context-toggle" aria-expanded={contextOpen} onClick={() => setContextOpen(v => !v)}>Aksi pelanggan ☷</button></header>
              <div className="wa-action-strip"><span className="wa-connected">● {customer?.name || (needsLocation ? "Pilih lokasi di panel aksi" : "WhatsApp AClean")}</span><button disabled={needsLocation || !customerVerified} onClick={() => createOrder(null)}>+ Jadwalkan</button><button disabled={!previousOrder || needsLocation || !customerVerified} onClick={() => createOrder(previousOrder)}>↻ Reorder</button><button onClick={() => { setContextOpen(true); document.getElementById("wa-payments")?.scrollIntoView({ block: "nearest" }); }}>Pembayaran {invoices.length ? `(${invoices.length})` : ""}</button></div>
              <AraReviewPanel key={phone} supabase={supabase} phone={phone} onCopy={text => insertDraft(text)} />
              {historyError && <div className="wa-error" role="alert">{historyError} <button onClick={() => setRefreshKey(k => k + 1)}>Coba lagi</button></div>}
              <div ref={messageScroll} className="wa-messages" onScroll={() => { const el = messageScroll.current; if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
                {loading && <div className="wa-history-note" role="status">Memuat percakapan…</div>}
                {!loading && visibleMessages.length >= messageLimit && <button className="wa-load-older" onClick={() => { stickToBottom.current = false; setMessageLimit(n => n + 100); }}>Muat pesan sebelumnya</button>}
                {!loading && !visibleMessages.length && !historyError && <div className="wa-empty"><strong>Belum ada riwayat pesan</strong><p>Mulai percakapan dengan pelanggan ini.</p></div>}
                {visibleMessages.map((msg, index) => {
                  const out = ["ara", "admin"].includes(msg.role);
                  return <div key={msg.id || index}>
                    {(index === 0 || dayKey(msg.created_at) !== dayKey(visibleMessages[index - 1].created_at)) && <div className="wa-date-divider"><span>{dateLabel(msg.created_at)}</span></div>}
                    <div className={`wa-message-row ${out ? "outgoing" : "incoming"}`}><div className="wa-bubble">
                      {out && <strong className="wa-sender">{msg.role === "ara" ? "ARA · Asisten" : msg.name || "Admin"}</strong>}
                      {safeUrl(msg.image_url) && <a href={safeUrl(msg.image_url)} target="_blank" rel="noopener noreferrer" className="wa-media"><img src={safeUrl(msg.image_url)} alt="Lampiran pesan WhatsApp" loading="lazy" onError={e => { e.currentTarget.hidden = true; }} /><span>Buka lampiran ↗</span></a>}
                      <div className="wa-message-content">{msg.content}</div><div className="wa-message-time">{timeLabel(msg.created_at)}{out ? " · Keluar" : ""}</div>
                    </div></div>
                  </div>;
                })}<div ref={messagesEnd} />
              </div>
              <div className="wa-composer">{draftContext && <p className="wa-ops-notice">Pengingat servis: {draftContext.customer_name} <button className="wa-text-button" onClick={()=>{draftContexts.current.delete(phone);setDraftContext(null);}}>Batalkan penanda</button></p>}{sendStatus && <p className="wa-ops-notice" role="status">{SEND_STATES[sendStatus.status]}{sendStatus.error?` · ${sendStatus.error}`:""}</p>}<div className="wa-quick-replies"><span>Balasan cepat</span><button onClick={() => insertDraft(`Halo ${person}, terima kasih sudah menghubungi AClean. Ada yang bisa kami bantu?`)}>Sapaan</button><button onClick={() => insertDraft(`Halo ${person}, boleh informasikan layanan, jumlah unit AC, alamat, serta tanggal dan jam yang diinginkan? Kami akan memeriksa ketersediaan jadwal tim.`)}>Tanya jadwal</button><button disabled={!invoices.length} onClick={() => insertDraft(paymentReminder(person, invoices[0]))}>Ingatkan pembayaran</button></div>
                <div className="wa-compose-row"><textarea ref={composer} id="waInput" aria-label="Pesan WhatsApp" rows={2} value={waInput} onChange={e => { setWaInput(e.target.value); if (!e.target.value) { draftContexts.current.delete(phone); setDraftContext(null); } }} disabled={sending} placeholder="Tulis pesan untuk pelanggan…" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isMobile) { e.preventDefault(); handleSend(); } }} /><button className="wa-send" disabled={sending || !waInput.trim()} onClick={handleSend}>{sending ? "Mengirim…" : "Kirim ↗"}</button></div><div className="wa-composer-hint">{isMobile ? "Ketuk Kirim untuk mengirim pesan." : "Enter untuk kirim · Shift + Enter untuk baris baru"}<span>Draf dapat diedit sebelum dikirim</span></div>
              </div>
            </>}
          </main>
          {selectedConv && <aside className="wa-context" aria-label="Aksi pelanggan"><header className="wa-context-heading"><div><span className="wa-eyebrow">PELANGGAN & TINDAK LANJUT</span><h3>Ringkasan pelanggan</h3></div><button className="wa-icon-button wa-context-close" onClick={() => setContextOpen(false)} aria-label="Tutup aksi pelanggan">×</button></header>
            <div className="wa-context-scroll"><section className="wa-profile"><span className="wa-avatar known">{initials(person)}</span><h3>{person}</h3><p>{formatPhone(phone)}</p>{customer?.area && <span className="wa-tag">{customer.area}</span>}{customer?.is_vip && <span className="wa-tag">VIP</span>}
              {locations.length > 1 && <label className="wa-location-label">Lokasi pelanggan<select aria-label="Lokasi pelanggan" value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">Pilih lokasi…</option>{locations.map(c => <option value={c.id} key={c.id}>{c.name}{c.address ? ` — ${c.address}` : ""}</option>)}</select></label>}
              {customer?.address && <p className="wa-address">{customer.address}</p>}{!locations.length && <button className="wa-secondary" disabled={savingCustomer || !customerVerified} onClick={saveCustomer}>{savingCustomer ? "Menyimpan…" : "+ Simpan customer"}</button>}
              <div className="wa-stats"><div><strong>{orders.length}</strong><small>Order dimuat</small></div><div><strong className="wa-amount">{waMoney(totalDue)}</strong><small>Sisa tagihan</small></div></div>
            </section>
            {customerVerified && <WaOperationsPanel key={`${phone}:${customer?.id || "none"}`} phone={phone} conv={selectedConv} customer={customer} needsLocation={needsLocation}
              orders={orders} invoices={customerInvoices} allInvoices={invoicesData} suggestions={suggestions} reports={reports}
              technicians={technicians} duration={duration} supabase={supabase} currentUser={currentUser}
              followup={followups[phone]} onFollowupSaved={row=>setFollowups(prev=>({...prev,[row.phone]:row}))}
              insertDraft={insertDraft} onCreateOrder={onCreateOrder} onAppliedPayments={onAppliedPayments}
              onSendDocument={onSendDocument ? (kind,item,id)=>onSendDocument(kind,item,id,selectedConv.phone) : null}
              onSendReminder={sendWorkspaceMessage ? (cust,message,id)=>sendWorkspaceMessage({id,phone:selectedConv.phone,kind:"SERVICE_REMINDER",customer_id:String(cust.id),message}) : null}
              refreshKey={refreshKey}/>}
            {needsLocation && <p className="wa-context-notice">Nomor ini memiliki beberapa lokasi. Pilih lokasi untuk melihat order dan tagihan yang sesuai.</p>}
            <section className="wa-context-section"><div className="wa-section-heading"><h4>Jadwal servis</h4><span>↗</span></div>{nextOrder ? <div className="wa-info-card"><span className="wa-tag">{nextOrder.status}</span><strong>{nextOrder.service} · {nextOrder.units || 1} unit</strong><p>{dateLabel(nextOrder.date)} · {nextOrder.time || "Jam belum diisi"}</p><p>{nextOrder.teknisi || "Tim belum ditentukan"}</p><button className="wa-text-button" onClick={() => insertDraft(`Halo ${person}, jadwal servis ${nextOrder.service} untuk ${nextOrder.units || 1} unit tercatat pada ${dateLabel(nextOrder.date)}${nextOrder.time ? ` pukul ${nextOrder.time} WIB` : ""}. Apakah jadwal tersebut sesuai?`)}>Buat draf konfirmasi →</button></div> : <p className="wa-muted">Belum ada jadwal aktif pada data yang dimuat.</p>}<div className="wa-button-pair"><button className="wa-primary" disabled={needsLocation || !customerVerified} onClick={() => createOrder(null)}>+ Buat jadwal</button><button className="wa-secondary" onClick={() => onOpenSchedule(customer, selectedConv)}>Lihat jadwal</button></div></section>
            <section className="wa-context-section"><div className="wa-section-heading"><h4>Order terakhir</h4><span>↻</span></div>{orders.slice(0, 3).map(order => <div className="wa-order" key={order.id}><strong>{order.service} · {order.units || 1} unit</strong><p>{order.id} · {dateLabel(order.date)}</p><div><span className="wa-tag">{order.status}</span><button className="wa-text-button" onClick={() => createOrder(order)}>Reorder →</button></div></div>)}{!orders.length && <p className="wa-muted">Belum ada riwayat order pada data yang dimuat.</p>}</section>
            <section id="wa-payments" className="wa-context-section"><div className="wa-section-heading"><h4>Pembayaran</h4><span className="wa-count">{invoices.length} tagihan</span></div>{suggestions.length > 0 && <div className="wa-payment-notice"><strong>{suggestions.length} bukti bayar perlu diperiksa</strong><p>Bukti dari nomor ini. Cocokkan invoice dan lokasi sebelum verifikasi.</p>{suggestions.slice(0, 3).map(s => <div className="wa-proof" key={s.id}><span>{s.amount ? waMoney(s.amount) : "Nominal belum terbaca"}{s.bank ? ` · ${s.bank}` : ""}</span>{safeUrl(s.image_url) && <a href={safeUrl(s.image_url)} target="_blank" rel="noopener noreferrer">Lihat bukti ↗</a>}<button className="wa-text-button" onClick={() => onOpenInvoice(s.invoice_id || phone)}>Periksa di Invoice →</button></div>)}</div>}
              {invoices.slice(0, 5).map(inv => <div className="wa-invoice" key={inv.id}><div><strong>{inv.id}</strong><span className={`wa-tag ${inv.status === "OVERDUE" ? "overdue" : ""}`}>{inv.status === "PARTIAL_PAID" ? "Dibayar sebagian" : inv.status === "OVERDUE" ? "Jatuh tempo" : "Belum lunas"}</span></div><b>{waMoney(invoiceBalance(inv))}</b>{inv.due && <p>Jatuh tempo {dateLabel(inv.due)}</p>}<div className="wa-button-pair"><button className="wa-text-button" onClick={() => insertDraft(paymentReminder(person, inv))}>Draf pengingat</button><button className="wa-text-button" onClick={() => onOpenInvoice(inv.id)}>Lihat invoice ↗</button></div></div>)}
              {!invoices.length && <p className="wa-muted">Tidak ada tagihan terbuka pada data yang dimuat.</p>}<button className="wa-secondary wa-full" onClick={() => onOpenInvoice(customer?.name || phone)}>Buka invoice pelanggan ↗</button><p className="wa-context-footnote">Saran memakai data AClean yang dimuat. Pembayaran diverifikasi melalui halaman Invoice.</p>
            </section></div>
          </aside>}
        </div>
      </section>
    </div>
  );
}
