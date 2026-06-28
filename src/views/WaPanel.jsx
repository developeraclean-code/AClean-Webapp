import { cs } from "../theme/cs.js";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { fetchWaConversations } from "../data/reads.js";

// Panel monitor WhatsApp (drawer kanan) — diekstrak dari App.jsx (Fase 0 iterasi 4).
// Hanya Owner/Admin yang bisa membuka panel ini (gate di App.jsx via
// wa_monitor_enabled + role). State WA tetap di App.jsx, dioper sebagai prop.
//
// CATATAN BUGFIX: di App.jsx, `isOwnerAdmin` dipakai (tombol "+ Simpan Customer")
// tapi TIDAK PERNAH didefinisikan → ReferenceError saat Owner/Admin membuka chat
// dari nomor yang belum jadi customer (cabang !selConvCust). Di sini didefinisikan
// benar (sama pola dgn view lain) sehingga crash laten itu hilang.
export default function WaPanel({
  open, onClose,
  waSearch, setWaSearch,
  waConversations, setWaConversations,
  selectedConv, setSelectedConv,
  waMessages, setWaMessages,
  waInput, setWaInput,
  customersData, setCustomersData,
  ordersData,
  waProvider, isMobile, currentUser,
  supabase, showNotif, sendWA, addAgentLog, setActiveMenu,
}) {
  if (!open) return null;

  const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin";
  const waSearchLower = waSearch.toLowerCase();
  const filteredConvs = waConversations.map(conv => {
    const cust = customersData.find(x => samePhone(x.phone, conv.phone));
    return { ...conv, _cust: cust || null };
  }).filter(conv => {
    if (!waSearchLower) return true;
    return (conv.name || "").toLowerCase().includes(waSearchLower) ||
      (conv.phone || "").includes(waSearch) ||
      (conv._cust?.name || "").toLowerCase().includes(waSearchLower) ||
      (conv.last_message || conv.last || "").toLowerCase().includes(waSearchLower);
  });
  const selConvCust = selectedConv ? customersData.find(x => samePhone(x.phone, selectedConv.phone)) : null;
  const selConvOrders = selectedConv ? ordersData.filter(o => samePhone(o.phone || "", selectedConv.phone) || (selConvCust && o.customer === selConvCust.name)).slice(0, 5) : [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 300, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ width: isMobile ? "100%" : 440, background: cs.surface, borderLeft: isMobile ? "none" : "1px solid " + cs.border, display: "flex", flexDirection: "column", height: "100vh" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ background: cs.card, padding: "12px 16px", borderBottom: "1px solid " + cs.border, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 800, color: "#25D366", fontSize: 14 }}>📱 WhatsApp Monitor</div>
              <div style={{ fontSize: 10, color: cs.muted }}>via {waProvider === "fonnte" ? "Fonnte" : waProvider === "wa_cloud" ? "WA Cloud API" : "Twilio"} · {waConversations.length} chat dimuat</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={async () => {
                const { data, error } = await fetchWaConversations(supabase, 100);
                if (error) {
                  if (error.code === "42P01") showNotif("⚠️ Tabel wa_conversations belum dibuat");
                  else showNotif("⚠️ WA Monitor error: " + (error.message || error.code));
                } else {
                  if (data) setWaConversations(data);
                  showNotif(data?.length > 0 ? `✅ ${data.length} percakapan dimuat` : "ℹ️ Belum ada percakapan masuk");
                }
              }} style={{ background: "none", border: "1px solid " + cs.border, color: cs.muted, fontSize: 11, padding: "4px 8px", borderRadius: 7, cursor: "pointer" }}>🔄</button>
              <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
          </div>
          {/* Search bar */}
          {!selectedConv && (
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: cs.muted, pointerEvents: "none" }}>🔍</span>
              <input value={waSearch} onChange={e => setWaSearch(e.target.value)}
                placeholder="Cari nama, nomor, atau isi pesan..."
                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "7px 30px 7px 30px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              {waSearch && <button onClick={() => setWaSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Conversation list */}
          <div style={{ width: "100%", overflowY: "auto", display: selectedConv ? "none" : "block" }}>
            {filteredConvs.length === 0 && (
              <div style={{ padding: 16, fontSize: 11, color: cs.muted, textAlign: "center", lineHeight: 1.8 }}>
                {waSearch ? (
                  <div>Tidak ada hasil untuk <b>"{waSearch}"</b></div>
                ) : (
                  <>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>📭</div>
                    <div>Belum ada pesan masuk</div>
                    <div style={{ marginTop: 6, color: cs.accent, fontSize: 10 }}>Pastikan webhook Fonnte aktif · Klik 🔄 setelah kirim WA test</div>
                  </>
                )}
              </div>
            )}
            {filteredConvs.map(conv => {
              const cust = conv._cust;
              const isKnown = !!cust;
              return (
                <div key={conv.id} onClick={() => {
                  setSelectedConv(conv);
                  supabase.from("wa_messages").select("id,phone,name,content,role,created_at,image_url")
                    .eq("phone", conv.phone).order("created_at", { ascending: true }).limit(100)
                    .then(({ data, error }) => {
                      if (error && error.code === "42703") {
                        supabase.from("wa_messages").select("id,phone,name,content,role,created_at")
                          .eq("phone", conv.phone).order("created_at", { ascending: true }).limit(100)
                          .then(({ data: d2 }) => { if (d2) setWaMessages(d2); });
                      } else if (data) setWaMessages(data);
                    });
                  supabase.from("wa_conversations").update({ unread: 0 }).eq("phone", conv.phone).then(() => {});
                  setWaConversations(prev => prev.map(cv => cv.id === conv.id ? { ...cv, unread: 0 } : cv));
                }}
                  style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, cursor: "pointer", background: "transparent", transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = cs.card}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                        <span style={{ fontWeight: 700, color: cs.text, fontSize: 12 }}>{conv.name}</span>
                        {isKnown ? (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "#25D36622", color: "#25D366", fontWeight: 700, flexShrink: 0 }}>✓ {cust.name}</span>
                        ) : (
                          <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: cs.yellow + "22", color: cs.yellow, fontWeight: 600, flexShrink: 0 }}>Baru</span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: cs.accent, marginBottom: 2 }}>{conv.phone}{isKnown && cust.total_orders > 0 ? ` · ${cust.total_orders}× order` : ""}</div>
                      <div style={{ fontSize: 10, color: cs.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.last_message || conv.last || ""}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      {conv.unread > 0 && <span style={{ background: "#25D366", color: "#fff", fontSize: 9, borderRadius: "50%", minWidth: 16, height: 16, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{conv.unread}</span>}
                      {conv.updated_at && <span style={{ fontSize: 9, color: cs.muted }}>{new Date(conv.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Chat detail */}
          <div style={{ flex: 1, flexDirection: "column", display: !selectedConv ? "none" : "flex" }}>
            {selectedConv ? (
              <>
                {/* Chat header dengan info customer */}
                <div style={{ padding: "10px 14px", borderBottom: "1px solid " + cs.border, flexShrink: 0, background: cs.card }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: selConvCust ? 6 : 0 }}>
                    <button onClick={() => { setSelectedConv(null); }} style={{ background: "none", border: "none", color: cs.accent, fontSize: 22, cursor: "pointer", padding: "0 4px", lineHeight: 1, fontWeight: 700 }}>‹</button>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, color: cs.text, fontSize: 13 }}>{selectedConv.name}</div>
                      <div style={{ fontSize: 10, color: cs.muted }}>{selectedConv.phone}{selectedConv.intent ? " · " + selectedConv.intent : ""}</div>
                    </div>
                    {/* Tombol buat customer jika belum terdaftar */}
                    {!selConvCust && isOwnerAdmin && (
                      <button onClick={async () => {
                        const name = window.prompt("Nama customer untuk " + selectedConv.phone + ":", selectedConv.name || "");
                        if (!name?.trim()) return;
                        const { data: newCust, error } = await supabase.from("customers").insert({ name: name.trim(), phone: normalizePhone(selectedConv.phone), area: "", total_orders: 0 }).select().single();
                        if (error) { showNotif("❌ Gagal buat customer: " + error.message); return; }
                        setCustomersData(prev => [...prev, newCust]);
                        showNotif("✅ Customer " + name.trim() + " ditambahkan!");
                      }} style={{ padding: "5px 10px", background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 7, cursor: "pointer", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                        + Simpan Customer
                      </button>
                    )}
                  </div>
                  {/* Customer info strip */}
                  {selConvCust && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#25D36622", color: "#25D366", fontWeight: 700 }}>✓ {selConvCust.name}</span>
                      {selConvCust.area && <span style={{ fontSize: 10, color: cs.muted }}>{selConvCust.area}</span>}
                      {selConvCust.total_orders > 0 && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.accent + "22", color: cs.accent, fontWeight: 600 }}>{selConvCust.total_orders}× order</span>}
                      {selConvCust.is_vip && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.yellow + "22", color: cs.yellow, fontWeight: 700 }}>⭐ VIP</span>}
                      {selConvOrders.length > 0 && (
                        <button onClick={() => { onClose(); setActiveMenu("orders"); }}
                          style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: cs.surface, border: "1px solid " + cs.border, color: cs.text, cursor: "pointer" }}>
                          📋 {selConvOrders.length} order terakhir
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, padding: "12px 14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {waMessages.length === 0 ? (
                    <div style={{ textAlign: "center", color: cs.muted, fontSize: 12, paddingTop: 30 }}>Belum ada riwayat pesan.<br/>Pesan masuk dari customer akan muncul di sini.</div>
                  ) : waMessages.map((msg, mi) => {
                    const isOut = msg.role === "ara" || msg.role === "admin";
                    return (
                      <div key={msg.id || mi} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                        <div style={{ maxWidth: "80%", background: isOut ? "#25D36622" : cs.card, border: "1px solid " + (isOut ? "#25D36633" : cs.border), borderRadius: isOut ? "12px 2px 12px 12px" : "2px 12px 12px 12px", padding: "8px 12px", fontSize: 12 }}>
                          {isOut && <div style={{ fontSize: 10, color: "#25D366", fontWeight: 700, marginBottom: 3 }}>{msg.role === "ara" ? "🤖 ARA" : "👤 Admin"}</div>}
                          {msg.image_url && (
                            <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
                              <img src={msg.image_url} alt="gambar" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginBottom: 4, display: "block", cursor: "pointer" }} onError={e => { e.target.style.display="none"; }} />
                            </a>
                          )}
                          <div style={{ color: cs.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.content}</div>
                          <div style={{ fontSize: 9, color: cs.muted, marginTop: 3, textAlign: "right" }}>{msg.created_at ? new Date(msg.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: "10px 14px", borderTop: "1px solid " + cs.border, display: "flex", gap: 8, flexShrink: 0 }}>
                  <input id="waInput" value={waInput} onChange={e => setWaInput(e.target.value)}
                    onKeyDown={async e => {
                      if (e.key === "Enter" && waInput.trim() && selectedConv) {
                        const txt = waInput; setWaInput("");
                        const ok = await sendWA(selectedConv.phone, txt);
                        if (ok) {
                          const nowIso = new Date().toISOString();
                          setWaMessages(prev => [...prev, { id: Date.now(), phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin", created_at: nowIso }]);
                          supabase.from("wa_messages").insert({ phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin" }).then(() => {});
                          supabase.from("wa_conversations").update({ last_reply: txt.slice(0, 80), updated_at: nowIso }).eq("phone", selectedConv.phone).then(() => {});
                          setWaConversations(prev => prev.map(cv => cv.id === selectedConv.id ? { ...cv, last_reply: txt.slice(0, 80) } : cv));
                        }
                        addAgentLog("WA_SENT_MANUAL", `Manual reply ke ${selectedConv.name}: "${txt.slice(0, 40)}"`, "SUCCESS");
                        showNotif(ok ? "✅ Pesan terkirim via Fonnte" : "📱 Fonnte gagal — cek koneksi");
                      }
                    }}
                    placeholder="Balas manual..." style={{ flex: 1, background: cs.bg, border: "1px solid " + cs.border, borderRadius: 10, padding: "8px 12px", color: cs.text, fontSize: 12, outline: "none" }} />
                  <button onClick={async () => {
                    if (waInput.trim() && selectedConv) {
                      const txt = waInput; setWaInput("");
                      const ok = await sendWA(selectedConv.phone, txt);
                      if (ok) {
                        const nowIso = new Date().toISOString();
                        setWaMessages(prev => [...prev, { id: Date.now(), phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin", created_at: nowIso }]);
                        supabase.from("wa_messages").insert({ phone: selectedConv.phone, name: currentUser?.name || "Admin", content: txt, role: "admin" }).then(() => {});
                        supabase.from("wa_conversations").update({ last_reply: txt.slice(0, 80), updated_at: nowIso }).eq("phone", selectedConv.phone).then(() => {});
                        setWaConversations(prev => prev.map(cv => cv.id === selectedConv.id ? { ...cv, last_reply: txt.slice(0, 80) } : cv));
                      }
                      addAgentLog("WA_SENT_MANUAL", `Manual reply ke ${selectedConv.name}: "${txt.slice(0, 40)}"`, "SUCCESS");
                      showNotif(ok ? "✅ Pesan terkirim via Fonnte" : "📱 Fonnte gagal — cek koneksi");
                    }
                  }}
                    style={{ background: "#25D366", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Kirim</button>
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: cs.muted, fontSize: 13 }}>Pilih percakapan</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
