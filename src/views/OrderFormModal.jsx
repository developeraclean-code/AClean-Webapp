import { useState } from "react";
import { normalizePhone, samePhone } from "../lib/phone.js";
import { findCustomer, buildCustomerHistory, sameCustomer } from "../lib/customers.js";
import { cs } from "../theme/cs.js";

const inp = { width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" };
const lbl = { fontSize: 11, color: cs.muted, marginBottom: 4, display: "block", fontWeight: 600 };
const card = { background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" };
const secTitle = { fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 };

const STEPS = [
  { id: 1, icon: "👤", label: "Pelanggan" },
  { id: 2, icon: "🔧", label: "Pekerjaan" },
  { id: 3, icon: "📅", label: "Jadwal & Tim" },
];

export default function OrderFormModal({
  open, onClose,
  form, setForm,
  onSubmit, isSubmitting,

  customersData = [], ordersData = [], teknisiData = [],
  laporanReports = [], invoicesData = [], quotationsData = [],
  maintClientsForOrder = [], maintUnitsForOrder = [],
  orderPhoneLookup = { phone: "", matches: [] },
  teamDailyCache = {}, loadTeamDaily,
  continuationSuggestion = [], setContinuationSuggestion,
  continuationParentId, setContinuationParentId,
  effectiveServiceTypes = [],
  MAX_LOKASI_PER_HARI = 6,

  hitungJamSelesai, hitungDurasi,
  cekTeknisiAvailable, cariSlotKosong, araSchedulingSuggest,

  showNotif, setActiveMenu,
}) {
  const [step, setStep] = useState(1);

  if (!open) return null;

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // ── Customer lookup helpers ──
  const normPhone = normalizePhone(form.phone || "");
  const clientMatches = customersData.filter(c => samePhone(c.phone, form.phone));
  const serverMatches = orderPhoneLookup.phone === normPhone ? orderPhoneLookup.matches : [];
  const _map = new Map();
  [...clientMatches, ...serverMatches].forEach(c => { if (c?.id) _map.set(c.id, c); });
  const phoneMatches = Array.from(_map.values());
  const exactMatch = findCustomer(phoneMatches, form.phone, form.customer);

  // ── Teknisi availability ──
  const jamSelesai = hitungJamSelesai ? hitungJamSelesai(form.time || "09:00", form.service, form.units) : "--:--";
  const dur = hitungDurasi ? hitungDurasi(form.service, form.units) : 0;
  const avail = (cekTeknisiAvailable && form.teknisi && form.date)
    ? cekTeknisiAvailable(form.teknisi, form.date, form.time || "09:00", form.service, form.units)
    : true;
  const slotSaran = (!avail && cariSlotKosong && form.teknisi && form.date)
    ? cariSlotKosong(form.teknisi, form.date, form.service, form.units)
    : null;
  const capReached = !!(form.teknisi && form.date && ordersData.filter(o =>
    o.teknisi === form.teknisi && o.date === form.date &&
    ["PENDING", "CONFIRMED", "DISPATCHED", "ON_SITE", "IN_PROGRESS"].includes(o.status)
  ).length >= MAX_LOKASI_PER_HARI);
  const clashDetected = !!(form.teknisi && form.date && form.time && !avail);
  const isBlocked = capReached || clashDetected;

  // ── Step navigation ──
  const goNext = () => {
    if (step === 1 && !form.customer?.trim()) { showNotif("Nama customer wajib diisi"); return; }
    setStep(s => Math.min(s + 1, 3));
  };
  const goBack = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!form.customer) { showNotif("Nama customer wajib diisi"); return; }
    if (!form.teknisi) { showNotif("Pilih teknisi dulu"); return; }
    if (!form.date) { showNotif("Pilih tanggal dulu"); return; }
    await onSubmit({ ...form, parent_job_id: continuationParentId || null, is_multi_day: !!(continuationParentId && continuationParentId !== "") });
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📋 Buat Order Baru</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Isi data lengkap untuk menjadwalkan servis</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
          </div>
          {/* Progress Steps */}
          <div style={{ display: "flex", gap: 0, marginTop: 14 }}>
            {STEPS.map((s, i) => {
              const done = step > s.id;
              const active = step === s.id;
              return (
                <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
                  {i > 0 && (
                    <div style={{ position: "absolute", top: 10, right: "50%", left: "-50%", height: 2, background: done ? cs.accent : cs.border }} />
                  )}
                  <div style={{ width: 22, height: 22, borderRadius: 11, background: done ? cs.accent : active ? cs.accent + "33" : cs.card, border: "2px solid " + (done || active ? cs.accent : cs.border), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: done ? "#0a0f1e" : active ? cs.accent : cs.muted, position: "relative", zIndex: 1 }}>
                    {done ? "✓" : s.id}
                  </div>
                  <div style={{ fontSize: 10, marginTop: 4, color: active ? cs.accent : done ? cs.muted : cs.muted, fontWeight: active ? 700 : 400 }}>{s.icon} {s.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ════ STEP 1: PELANGGAN ════ */}
          {step === 1 && (
            <>
              <div style={card}>
                <div style={secTitle}>Data Pelanggan</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[["Nama Customer", "customer", "Nama customer"], ["Nomor HP", "phone", "628xxx"], ["Alamat Lengkap", "address", "Jl. ..."], ["Catatan", "notes", "Catatan tambahan..."]].map(([label, key, ph]) => (
                    <div key={key}>
                      <label style={lbl}>{label}{(key === "customer" || key === "phone") && <span style={{ color: cs.red }}> *</span>}</label>
                      <input
                        value={form[key] || ""}
                        placeholder={ph}
                        onChange={e => {
                          const val = e.target.value;
                          if (key === "phone") {
                            const norm = normalizePhone(val);
                            const matches = customersData.filter(c => samePhone(c.phone, norm));
                            if (matches.length === 1) {
                              setForm(f => ({ ...f, phone: norm, customer: matches[0].name, address: matches[0].address || f.address, area: matches[0].area || f.area }));
                            } else {
                              setForm(f => ({ ...f, phone: norm || val }));
                            }
                          } else {
                            set(key, val);
                          }
                        }}
                        style={inp}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Customer auto-detect */}
              {form.phone && form.phone.length >= 6 && (
                <div>
                  {phoneMatches.length > 1 ? (
                    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid " + cs.yellow + "44" }}>
                      <div style={{ padding: "8px 12px", background: cs.yellow + "18", fontSize: 12, fontWeight: 700, color: "#d97706" }}>
                        📍 {phoneMatches.length} lokasi ditemukan — pilih atau isi nama baru:
                      </div>
                      {phoneMatches.map(m => (
                        <div key={m.id}
                          onClick={() => setForm(f => ({ ...f, customer: m.name, address: m.address || f.address, area: m.area || f.area }))}
                          style={{ padding: "7px 12px", background: form.customer === m.name ? cs.green + "18" : cs.card, borderTop: "1px solid " + cs.border, cursor: "pointer", fontSize: 12, color: form.customer === m.name ? cs.green : cs.text, display: "flex", justifyContent: "space-between" }}>
                          <span>{form.customer === m.name ? "✅ " : ""}<strong>{m.name}</strong></span>
                          <span style={{ color: cs.muted, fontSize: 11 }}>{m.address || m.area || "—"}</span>
                        </div>
                      ))}
                      {form.customer?.trim() && (() => {
                        const isKnown = phoneMatches.some(m => (m.name || "").trim().toLowerCase() === form.customer.trim().toLowerCase());
                        return (
                          <div style={{ padding: "7px 12px", fontSize: 11, fontWeight: 700, borderTop: "1px solid " + cs.border, background: isKnown ? cs.green + "14" : cs.yellow + "18", color: isKnown ? cs.green : "#d97706" }}>
                            {isKnown ? `✅ Lokasi terdaftar: ${form.customer.trim()}` : `🆕 "${form.customer.trim()}" = LOKASI BARU`}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: exactMatch ? cs.green + "18" : cs.yellow + "18", border: "1px solid " + (exactMatch ? cs.green : cs.yellow) + "44", color: exactMatch ? cs.green : "#d97706", display: "flex", alignItems: "center", gap: 8 }}>
                        {exactMatch ? "✅" : "🆕"}
                        {exactMatch ? `Customer EXISTING: ${exactMatch.name} — ${exactMatch.total_orders || 0} order` : "Customer BARU — otomatis ditambahkan ke menu Customer"}
                      </div>
                      {exactMatch && (() => {
                        const history = buildCustomerHistory(exactMatch, ordersData, laporanReports, invoicesData, customersData);
                        const recentJobs = (history.orders || []).filter(o => o.status !== "CANCELLED").sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 3);
                        if (!recentJobs.length) return null;
                        const lastCleaning = recentJobs.find(o => (o.service || "").toLowerCase().includes("cleaning"));
                        const daysSince = lastCleaning ? Math.floor((new Date() - new Date(lastCleaning.date)) / 86400000) : null;
                        return (
                          <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, overflow: "hidden" }}>
                            <div style={{ padding: "8px 12px", background: cs.accent + "12", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>📋 {recentJobs.length} job terakhir</span>
                              {daysSince !== null && daysSince > 90 && <span style={{ fontSize: 10, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, padding: "2px 8px", borderRadius: 99 }}>💡 Cleaning {daysSince}h lalu</span>}
                            </div>
                            <div style={{ padding: "8px 12px", display: "grid", gap: 5 }}>
                              {recentJobs.map(o => (
                                <div key={o.id} style={{ display: "flex", gap: 8, fontSize: 11 }}>
                                  <span style={{ color: cs.muted, minWidth: 68, fontFamily: "monospace" }}>{o.date}</span>
                                  <span style={{ color: cs.text, fontWeight: 600 }}>{o.service}</span>
                                  <span style={{ color: cs.muted }}> · {o.units}u · {o.teknisi}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Continuation job suggestion */}
              {continuationSuggestion.length > 0 && continuationParentId === null && (
                <div style={{ background: cs.yellow + "14", border: "1px solid " + cs.yellow + "44", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "10px 14px", background: cs.yellow + "1a", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 15 }}>🔗</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: cs.yellow }}>Terdeteksi Pekerjaan Belum Selesai</div>
                      <div style={{ fontSize: 11, color: cs.yellow + "cc" }}>{continuationSuggestion.length} job aktif dalam 3 hari terakhir</div>
                    </div>
                  </div>
                  {continuationSuggestion.map(o => (
                    <div key={o.id} style={{ padding: "9px 14px", borderTop: "1px solid " + cs.yellow + "22", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: cs.yellow, fontFamily: "monospace" }}>{o.id}</span>
                        <span style={{ color: cs.muted, marginLeft: 8 }}>{o.date} · {o.service} {o.units}u</span>
                      </div>
                      <button onClick={() => setContinuationParentId(o.id)}
                        style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: cs.yellow, color: "#0a0f1e", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                        Ya, Lanjutan
                      </button>
                    </div>
                  ))}
                  <div style={{ padding: "8px 14px", borderTop: "1px solid " + cs.yellow + "22", display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={() => setContinuationParentId("")}
                      style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, fontSize: 11, cursor: "pointer" }}>
                      Tidak, Job Baru
                    </button>
                  </div>
                </div>
              )}

              {continuationParentId && continuationParentId !== "" && (() => {
                const parent = ordersData.find(o => o.id === continuationParentId);
                return (
                  <div style={{ background: cs.green + "14", border: "1px solid " + cs.green + "44", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: cs.green }}>🔗 Lanjutan dari {continuationParentId}</span>
                      {parent && <span style={{ color: cs.muted, marginLeft: 8 }}>· {parent.date} · {parent.service}</span>}
                    </div>
                    <button onClick={() => setContinuationParentId(null)}
                      style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid " + cs.border, background: "transparent", color: cs.muted, fontSize: 11, cursor: "pointer" }}>
                      Ubah
                    </button>
                  </div>
                );
              })()}

              {/* Quotation aktif */}
              {(() => {
                const phone = normPhone;
                if (!phone || !quotationsData.length) return null;
                const activeQuo = quotationsData.filter(q => ["SENT","DRAFT"].includes(q.status) && q.phone && normalizePhone(q.phone) === phone);
                if (!activeQuo.length) return null;
                return (
                  <div style={{ background: "#6366f114", border: "1px solid #6366f144", borderRadius: 10, padding: "10px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#818cf8", marginBottom: 4 }}>📋 {activeQuo.length} Quotation Aktif</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 11, color: "#a5b4fc" }}>Customer ini punya quotation belum diproses</div>
                      <button onClick={() => setActiveMenu("quotations")}
                        style={{ padding: "4px 10px", borderRadius: 7, border: "none", background: "#6366f1", color: "#fff", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                        Lihat
                      </button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* ════ STEP 2: PEKERJAAN ════ */}
          {step === 2 && (
            <>
              <div style={card}>
                <div style={secTitle}>Detail Pekerjaan</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={lbl}>Jenis Layanan</label>
                    <select value={form.service} onChange={e => set("service", e.target.value)}
                      style={{ ...inp, background: cs.card }}>
                      {effectiveServiceTypes.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Jumlah Unit</label>
                    <input type="number" min="1" max="20" value={form.units} onChange={e => set("units", parseInt(e.target.value) || 1)}
                      style={{ ...inp, background: cs.card }} />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Area / Lokasi <span style={{ fontWeight: 400, color: cs.muted }}>(tersimpan ke data customer)</span></label>
                  <input value={form.area || ""} onChange={e => set("area", e.target.value)}
                    placeholder="Graha Raya, BSD, Alam Sutera..." style={{ ...inp, background: cs.card }} />
                </div>
              </div>

              {/* Maintenance Korporat */}
              {maintClientsForOrder.length > 0 && (
                <div style={card}>
                  <div style={secTitle}>Maintenance Korporat (opsional)</div>
                  <select value={form.maintenance_client_id || ""}
                    onChange={e => setForm(f => ({ ...f, maintenance_client_id: e.target.value, maintenance_unit_ids: [] }))}
                    style={{ ...inp, background: cs.surface, marginBottom: form.maintenance_client_id ? 10 : 0 }}>
                    <option value="">— Bukan order maintenance —</option>
                    {maintClientsForOrder.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {form.maintenance_client_id && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: cs.muted }}>Unit dipilih: {(form.maintenance_unit_ids || []).length}/{maintUnitsForOrder.length}</span>
                        <button type="button" onClick={() => setForm(f => ({ ...f, maintenance_unit_ids: (f.maintenance_unit_ids || []).length === maintUnitsForOrder.length ? [] : maintUnitsForOrder.map(u => u.id) }))}
                          style={{ marginLeft: "auto", background: "transparent", border: "1px solid " + cs.border, color: cs.text, borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
                          {(form.maintenance_unit_ids || []).length === maintUnitsForOrder.length ? "Hapus semua" : "Pilih semua"}
                        </button>
                      </div>
                      <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid " + cs.border, borderRadius: 8 }}>
                        {maintUnitsForOrder.map(u => {
                          const checked = (form.maintenance_unit_ids || []).includes(u.id);
                          return (
                            <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 10px", borderBottom: "1px solid " + cs.border, cursor: "pointer", fontSize: 12, color: cs.text }}>
                              <input type="checkbox" checked={checked} onChange={e => setForm(f => {
                                const cur = f.maintenance_unit_ids || [];
                                return { ...f, maintenance_unit_ids: e.target.checked ? [...cur, u.id] : cur.filter(x => x !== u.id) };
                              })} />
                              <b>{u.unit_code}</b><span style={{ color: cs.muted }}> {u.location || ""} · {u.brand || ""}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ════ STEP 3: JADWAL & TIM ════ */}
          {step === 3 && (
            <>
              {/* Quick Tim Selection */}
              {form.date && (() => {
                const teams = teamDailyCache[form.date];
                if (!teams) { if (loadTeamDaily) loadTeamDaily(form.date); return null; }
                const filledTeams = teams.filter(t => t.member1);
                if (!filledTeams.length) return null;
                return (
                  <div style={card}>
                    <div style={secTitle}>Pilih Tim</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {filledTeams.map(t => {
                        const tek = t.member1 || "";
                        const hlp = t.member1_role === "helper" ? "" : (t.member2 || "");
                        const sel = form.teknisi === tek;
                        return (
                          <button key={t.slot} onClick={() => setForm(f => ({ ...f, teknisi: tek, helper: hlp, team_slot: t.slot }))}
                            style={{ padding: "6px 12px", borderRadius: 9, border: "1px solid " + (sel ? cs.accent : t.confirmed ? cs.green + "66" : cs.border), background: sel ? cs.accent + "22" : cs.card, color: sel ? cs.accent : cs.text, cursor: "pointer", fontSize: 12, fontWeight: sel ? 700 : 500 }}>
                            <span style={{ fontWeight: 700, color: sel ? cs.accent : cs.muted, marginRight: 4 }}>{t.slot}</span>
                            {tek}{hlp ? <span style={{ color: cs.muted }}> + {hlp}</span> : ""}
                            {t.confirmed && <span style={{ fontSize: 9, color: cs.green, marginLeft: 4 }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>Tim ✓ = sudah dikonfirmasi di Planning Order</div>
                  </div>
                );
              })()}

              {/* Tanggal + Teknisi */}
              <div style={card}>
                <div style={secTitle}>Jadwal</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={lbl}>Tanggal <span style={{ color: cs.red }}>*</span></label>
                    <input type="date" value={form.date} onChange={e => { set("date", e.target.value); if (loadTeamDaily) loadTeamDaily(e.target.value); }}
                      style={{ ...inp, background: cs.surface }} />
                  </div>
                  <div>
                    <label style={lbl}>Teknisi <span style={{ color: cs.red }}>*</span></label>
                    {(() => {
                      const tgl = form.date || "";
                      return (
                        <select value={form.teknisi} onChange={e => setForm(f => ({ ...f, teknisi: e.target.value, helper: "" }))}
                          style={{ ...inp, background: cs.surface }}>
                          <option value="">Pilih teknisi...</option>
                          {teknisiData.filter(t => t.role === "Teknisi" || t.role === "Helper").map(t => {
                            const cnt = tgl ? ordersData.filter(o => o.teknisi === t.name && o.date === tgl && ["PENDING","CONFIRMED","DISPATCHED","ON_SITE","IN_PROGRESS"].includes(o.status)).length : 0;
                            const penuh = cnt >= MAX_LOKASI_PER_HARI;
                            return (
                              <option key={t.id} value={t.name} disabled={penuh}>
                                {penuh ? "🔴" : cnt >= 4 ? "🟡" : "🟢"} {t.name}{t.role === "Helper" ? " [H]" : ""} — {cnt}/6{penuh ? " (PENUH)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      );
                    })()}
                    {capReached && <div style={{ fontSize: 11, color: cs.red, marginTop: 3 }}>🔴 Teknisi sudah penuh di tanggal ini</div>}
                  </div>
                </div>

                {/* Time slots */}
                <label style={lbl}>Jam Mulai <span style={{ fontWeight: 400 }}>(09:00 – 17:00 WIB)</span></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 5, marginBottom: 8 }}>
                  {["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00"].map(t => {
                    const endT = hitungJamSelesai ? hitungJamSelesai(t, form.service, form.units) : "00:00";
                    const ok = endT <= "17:00";
                    const isAvail = (cekTeknisiAvailable && form.teknisi && form.date)
                      ? cekTeknisiAvailable(form.teknisi, form.date, t, form.service, form.units) : true;
                    const sel = form.time === t;
                    return (
                      <button key={t} onClick={() => ok && set("time", t)} disabled={!ok}
                        style={{ background: sel ? "linear-gradient(135deg," + cs.accent + ",#3b82f6)" : !ok ? cs.border + "33" : !isAvail ? cs.red + "22" : cs.card, border: "1px solid " + (sel ? cs.accent : !ok ? "transparent" : !isAvail ? cs.red + "44" : cs.border), color: sel ? "#0a0f1e" : !ok ? cs.border : !isAvail ? cs.red : cs.text, borderRadius: 8, padding: "7px 2px", cursor: ok ? "pointer" : "not-allowed", fontSize: 11, fontWeight: sel ? 800 : 400 }}>
                        {t}
                        {!isAvail && ok && <span style={{ fontSize: 7, display: "block", color: cs.red }}>⚠ bentrok</span>}
                      </button>
                    );
                  })}
                </div>
                <input type="time" min="09:00" max="17:00" value={form.time || "09:00"} onChange={e => set("time", e.target.value)}
                  style={{ ...inp, background: cs.surface, marginBottom: 8 }} />
                <div style={{ background: avail ? cs.green + "10" : cs.red + "10", border: "1px solid " + (avail ? cs.green : cs.red) + "22", borderRadius: 8, padding: "8px 12px", display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
                  <span>⏱ <b style={{ color: cs.accent }}>{dur >= 8 ? "1 hari kerja" : dur + "j"}</b></span>
                  <span>🕐 Selesai ±: <b style={{ color: cs.green }}>{jamSelesai} WIB</b></span>
                  {form.teknisi && form.date && <span>{avail ? <span style={{ color: cs.green }}>✓ Tersedia</span> : <span style={{ color: cs.red }}>⚠ Bentrok!</span>}</span>}
                  {!avail && slotSaran && (
                    <span style={{ color: cs.yellow, cursor: "pointer", textDecoration: "underline" }} onClick={() => set("time", slotSaran)}>
                      Slot kosong: {slotSaran} (klik)
                    </span>
                  )}
                </div>
                {clashDetected && (
                  <div style={{ background: cs.red + "12", border: "1px solid " + cs.red + "40", borderRadius: 9, padding: "10px 14px", fontSize: 12, color: cs.red, fontWeight: 700, marginTop: 8 }}>
                    🚫 Jadwal Bentrok! <strong>{form.teknisi}</strong> sudah ada job di jam ini. Pilih jam lain atau ganti teknisi.
                  </div>
                )}
              </div>

              {/* Helper */}
              <div style={card}>
                <div style={secTitle}>Tim</div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <label style={{ ...lbl, marginBottom: 0 }}>Helper</label>
                    {form.teknisi && form.date && araSchedulingSuggest && (() => {
                      const { pref } = araSchedulingSuggest(form.date, form.service, form.units);
                      const sug = pref[form.teknisi];
                      return sug ? (
                        <span onClick={() => set("helper", sug)}
                          style={{ fontSize: 10, color: cs.green, background: cs.green + "18", padding: "2px 8px", borderRadius: 99, border: "1px solid " + cs.green + "33", cursor: "pointer" }}>
                          ARA: {sug} (klik)
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <select value={form.helper} onChange={e => set("helper", e.target.value)}
                    style={{ ...inp, background: cs.surface }}>
                    <option value="">Tidak ada helper</option>
                    {teknisiData.filter(t => t.status !== "inactive" && t.name !== form.teknisi).map(t => {
                      const { pref } = araSchedulingSuggest ? araSchedulingSuggest(form.date || "", form.service, form.units) : { pref: {} };
                      const isSug = pref[form.teknisi] === t.name;
                      return <option key={t.id} value={t.name}>{isSug ? "★ " : ""}{t.name}{t.role === "Teknisi" ? " [T]" : t.role === "Helper" ? "" : ` [${t.role}]`}{isSug ? " (ARA)" : ""}</option>;
                    })}
                  </select>
                </div>

                {/* Tim Tambahan */}
                <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: cs.muted, marginBottom: 8 }}>👥 TIM TAMBAHAN (opsional)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[["Teknisi ke-2","teknisi2"],["Helper ke-2","helper2"],["Teknisi ke-3","teknisi3"],["Helper ke-3","helper3"]].map(([lbl2, key]) => (
                      <div key={key}>
                        <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>{lbl2}</div>
                        <select value={form[key] || ""} onChange={e => set(key, e.target.value)}
                          style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12 }}>
                          <option value="">— Tidak ada —</option>
                          {teknisiData.filter(t => t.name !== form.teknisi && t.name !== form.helper && t.name !== form.teknisi2 && t.name !== form.helper2).map(t => (
                            <option key={t.id} value={t.name}>{t.name}{t.role === "Helper" ? " [H]" : ""}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {(form.teknisi2 || form.helper2 || form.teknisi3 || form.helper3) && (
                    <div style={{ marginTop: 8, background: cs.accent + "10", borderRadius: 7, padding: "6px 10px", fontSize: 11, color: cs.muted }}>
                      Tim: {[form.teknisi, form.teknisi2, form.teknisi3, form.helper, form.helper2, form.helper3].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
          {step === 1 ? (
            <button onClick={onClose}
              style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              Batal
            </button>
          ) : (
            <button onClick={goBack}
              style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              ← Kembali
            </button>
          )}

          {step < 3 ? (
            <button onClick={goNext}
              style={{ flex: 2, background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
              Lanjut → {STEPS[step]?.icon} {STEPS[step]?.label}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={isBlocked || isSubmitting}
              style={{ flex: 2, background: isBlocked ? cs.border : isSubmitting ? cs.accent + "88" : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: isBlocked ? cs.muted : "#0a0f1e", padding: "11px", borderRadius: 10, cursor: (isBlocked || isSubmitting) ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: (isBlocked || isSubmitting) ? 0.7 : 1 }}>
              {isSubmitting ? "Membuat Order..." : capReached ? "🔴 Teknisi Penuh" : clashDetected ? "🚫 Jadwal Bentrok" : "✓ Buat Order"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
