import { useEffect, useMemo, useRef, useState } from "react";
import { planningWeek, estimatedEnd } from "../lib/teamPlanning.js";
import { normalizePhone } from "../lib/phone.js";
import "./ScheduleNotesView.css";

const STORE_PREFIX = "aclean_week_planner_v1:";
const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const emptyGroup = (date, index = 0) => ({ id: `${date}-team-${index + 1}`, name: `Team ${index + 1}`, text: "" });
const emptyDay = date => ({ groups: [emptyGroup(date)] });
const EMPTY_BOOK = () => ({ weeks: {} });
const localKey = user => `${STORE_PREFIX}${user?.id || user?.email || "local"}`;

function readBook(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && value.weeks ? value : EMPTY_BOOK();
  } catch { return EMPTY_BOOK(); }
}
function shiftDate(date, amount) {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}
function labelDate(date, options = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat("id-ID", options).format(new Date(`${date}T00:00:00`));
}
function weekTitle(start) {
  const end = shiftDate(start, 7);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${labelDate(start)} – ${labelDate(end, sameMonth ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" })}`;
}
function normalizeTime(hour, minute = "00") {
  const h = Number(hour), m = Number(minute);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function textHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}
function parseGroup(group, date) {
  const lines = String(group.text || "").split(/\r?\n/);
  const starts = [];
  const pattern = /^\s*(?:jam|pukul)\s*(\d{1,2})(?::(\d{2}))?\s*[:：-]\s*(.*)$/i;
  lines.forEach(line => {
    const match = line.match(pattern);
    if (match) starts.push({ time: normalizeTime(match[1], match[2] || "00"), text: [match[3]], invalidTime: !normalizeTime(match[1], match[2] || "00") });
    else if (starts.length) starts.at(-1).text.push(line);
  });
  return starts.filter(entry => entry.time && entry.text.join(" ").trim() && !/\b(istirahat|makan siang|break)\b/i.test(entry.text.join(" ")))
    .map((entry, index) => {
      const raw = entry.text.join(" ").replace(/\s+/g, " ").trim();
      const parts = raw.split(/[|/]/).map(part => part.trim()).filter(Boolean);
      const phoneMatch = raw.match(/(?:\+?62|0)\s?\d[\d\s().-]{7,}/);
      const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : "";
      const customer = (parts[0] || raw).replace(phoneMatch?.[0] || "", "").replace(/[,:-]+$/, "").trim();
      const serviceMatch = raw.match(/\b(cleaning|repair|install|complain|maintenance)\b/i);
      const service = serviceMatch ? serviceMatch[1][0].toUpperCase() + serviceMatch[1].slice(1).toLowerCase() : "Cleaning";
      const unitMatch = raw.match(/(?:^|\D)(\d{1,2})\s*(?:unit\s*ac|ac|unit)\b/i);
      const address = parts.slice(1).filter(part => !/(cleaning|repair|install|complain|maintenance)/i.test(part) && !/(?:\+?62|0)\s?\d[\d\s().-]{7,}/.test(part)).join(" / ");
      const requestId = crypto.randomUUID();
      return { id: `${group.id}-${index}-${textHash(raw)}`, groupId: group.id, requestId, date, time: entry.time, time_end: estimatedEnd(entry.time, service, Number(unitMatch?.[1]) || 1), team_slot: "", groupName: group.name, customer, phone, address, service, units: Number(unitMatch?.[1]) || 1, notes: raw, raw, orderId: null };
    });
}

export default function ScheduleNotesView({ currentUser, TODAY, ordersData = [], incomingNote, onIncomingConsumed, onSyncDay, showNotif, supabase }) {
  const key = localKey(currentUser);
  const [book, setBook] = useState(() => readBook(key));
  const [loadedKey, setLoadedKey] = useState(key);
  const [weekOffset, setWeekOffset] = useState(() => new Date(`${TODAY}T12:00:00Z`).getUTCDay() === 0 ? 1 : 0);
  const [syncDay, setSyncDay] = useState(null);
  const [syncPreview, setSyncPreview] = useState([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [incomingDate, setIncomingDate] = useState("");
  const [incomingTime, setIncomingTime] = useState("09:00");
  const [cloudState, setCloudState] = useState("loading");
  const [cloudHint, setCloudHint] = useState("");
  const [remoteChange, setRemoteChange] = useState(null);
  const activeRemoteChange = useRef(null);
  const remoteChangeQueue = useRef([]);
  const dirtyGroups = useRef(new Set());
  const versions = useRef(new Map());
  const remoteRows = useRef(new Map());
  const deletedGroups = useRef(new Map());
  const savingGroups = useRef(new Set());
  const hydratedWeek = useRef("");
  const bookRef = useRef(book);
  bookRef.current = book;
  const queueRemoteChange = row => {
    const alreadyQueued = remoteChangeQueue.current.some(item => item.id === row.id && item.version >= row.version);
    if ((activeRemoteChange.current?.id === row.id && activeRemoteChange.current.version >= row.version) || alreadyQueued) return;
    if (activeRemoteChange.current) remoteChangeQueue.current.push(row);
    else { activeRemoteChange.current = row; setRemoteChange(row); }
  };
  const advanceRemoteChange = () => {
    const next = remoteChangeQueue.current.shift() || null;
    activeRemoteChange.current = next;
    setRemoteChange(next);
  };
  const days = useMemo(() => planningWeek(TODAY, weekOffset).slice(0, 6), [TODAY, weekOffset]);
  const weekStart = days[0]?.date;
  const week = book.weeks[weekStart] || {};
  const teamSlots = useMemo(() => [...new Set(ordersData.map(order => order.team_slot).filter(Boolean))], [ordersData]);

  useEffect(() => { setBook(readBook(key)); setLoadedKey(key); }, [key]);
  useEffect(() => {
    if (!supabase || !weekStart || loadedKey !== key) return undefined;
    let cancelled = false;
    let timer;
    const loadRemote = async () => {
      if (document.visibilityState === "hidden") return;
      const { data, error } = await supabase.from("schedule_note_blocks").select("*").eq("week_start", weekStart).order("day_date").order("sort_order");
      if (cancelled) return;
      if (error) { setCloudState("offline"); setCloudHint("Backend jadwal belum siap. Draf tersimpan lokal sampai migrasi backend diterapkan."); timer = setTimeout(loadRemote, 20000); return; }
      setCloudState("online");
      const rows = data || [];
      const nextMap = new Map(rows.map(row => [row.id, row]));
      if (hydratedWeek.current !== weekStart) {
        if (rows.length) {
          const remoteWeek = {};
          rows.filter(row => !row.is_deleted).forEach(row => {
            remoteWeek[row.day_date] ||= { groups: [], syncRows: {} };
            remoteWeek[row.day_date].groups.push({ id: row.id, name: row.group_name, text: row.content });
            versions.current.set(row.id, row.version);
          });
          setBook(previous => ({ ...previous, weeks: { ...previous.weeks, [weekStart]: remoteWeek } }));
          setCloudHint("Jadwal bersama dimuat dari backend.");
        }
        hydratedWeek.current = weekStart;
      } else {
        const changedRows = rows.filter(row => {
          const prior = remoteRows.current.get(row.id);
          return (!prior || row.version > prior.version) && row.updated_by_id !== currentUser?.id;
        });
        for (const changed of changedRows) {
          if (dirtyGroups.current.has(changed.id)) queueRemoteChange(changed);
          else {
            setBook(previous => {
              const target = previous.weeks[weekStart]?.[changed.day_date] || emptyDay(changed.day_date);
              const groups = target.groups || [];
              const exists = groups.some(group => group.id === changed.id);
              const next = changed.is_deleted ? groups.filter(group => group.id !== changed.id)
                : exists ? groups.map(group => group.id === changed.id ? { id: changed.id, name: changed.group_name, text: changed.content } : group)
                  : [...groups, { id: changed.id, name: changed.group_name, text: changed.content }];
              return { ...previous, weeks: { ...previous.weeks, [weekStart]: { ...previous.weeks[weekStart], [changed.day_date]: { ...target, groups: next } } } };
            });
            versions.current.set(changed.id, changed.version);
            setCloudHint(`${changed.updated_by || "Admin lain"} memperbarui jadwal ${labelDate(changed.day_date)}.`);
          }
        }
      }
      remoteRows.current = nextMap;
      timer = setTimeout(loadRemote, 20000);
    };
    loadRemote();
    const onVisibility = () => { if (document.visibilityState === "visible") { clearTimeout(timer); loadRemote(); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [supabase, weekStart, loadedKey, key, currentUser?.id]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(book)); }
    catch { showNotif?.("Jadwal manual gagal disimpan di browser ini.", "error"); }
  }, [book, key, loadedKey]);
  useEffect(() => {
    if (!incomingNote) return;
    const target = days.some(day => day.date === TODAY) ? TODAY : days[0]?.date || TODAY;
    setIncomingDate(target);
  }, [incomingNote, TODAY, days]);

  const updateDay = (date, updater) => setBook(prev => {
    const currentWeek = prev.weeks[weekStart] || {};
    const current = currentWeek[date] || emptyDay(date);
    const changed = typeof updater === "function" ? updater(current) : updater;
    changed.groups?.forEach(group => {
      const prior = current.groups?.find(row => row.id === group.id);
      if (!prior || prior.name !== group.name || prior.text !== group.text) dirtyGroups.current.add(group.id);
    });
    current.groups?.filter(group => !changed.groups?.some(next => next.id === group.id)).forEach(group => {
      dirtyGroups.current.add(group.id); deletedGroups.current.set(group.id, { ...group, date });
    });
    return { ...prev, weeks: { ...prev.weeks, [weekStart]: { ...currentWeek, [date]: changed } } };
  });
  useEffect(() => {
    if (!supabase || !weekStart || loadedKey !== key || hydratedWeek.current !== weekStart || !dirtyGroups.current.size) return undefined;
    setCloudState("saving");
    const timeout = setTimeout(async () => {
      const ids = [...dirtyGroups.current].filter(id => !savingGroups.current.has(id));
      if (!ids.length) return;
      const currentWeek = bookRef.current.weeks[weekStart] || {};
      for (const id of ids) {
        const located = Object.entries(currentWeek).flatMap(([date, day]) => (day.groups || []).map((group, index) => ({ ...group, date, index }))).find(group => group.id === id);
        const deleted = deletedGroups.current.get(id);
        const group = located || deleted;
        if (!group) { dirtyGroups.current.delete(id); continue; }
        const previous = remoteRows.current.get(id);
        const savedSnapshot = { date: group.date, name: group.name || "", text: group.text || "", deleted: !located };
        savingGroups.current.add(id);
        const { data, error } = await supabase.rpc("save_schedule_note_block", {
          p_id: id, p_week_start: weekStart, p_day_date: group.date,
          p_group_name: group.name || "", p_content: group.text || "",
          p_sort_order: group.index ?? previous?.sort_order ?? 0,
          p_expected_version: versions.current.get(id) ?? 0,
          p_mutation_id: crypto.randomUUID(), p_is_deleted: !located,
        });
        if (error) {
          savingGroups.current.delete(id);
          setCloudState("conflict");
          setCloudHint(error.code === "40001" ? "Ada perubahan admin lain. Pilih apakah akan memuat versi terbaru atau mencoba simpan lagi." : `Belum tersimpan di backend: ${error.message}`);
          const latest = await supabase.from("schedule_note_blocks").select("*").eq("id", id).maybeSingle();
          if (latest.data) queueRemoteChange(latest.data);
          return;
        }
        const row = data?.row;
        if (row) { versions.current.set(id, row.version); remoteRows.current.set(id, row); }
        savingGroups.current.delete(id);
        const latestWeek = bookRef.current.weeks[weekStart] || {};
        const latestGroup = Object.entries(latestWeek).flatMap(([date, day]) => (day.groups || []).map(candidate => ({ ...candidate, date }))).find(candidate => candidate.id === id);
        const latestDeleted = deletedGroups.current.get(id);
        const stillMatches = latestGroup
          ? !savedSnapshot.deleted && latestGroup.date === savedSnapshot.date && latestGroup.name === savedSnapshot.name && latestGroup.text === savedSnapshot.text
          : Boolean(latestDeleted) && savedSnapshot.deleted && latestDeleted.name === savedSnapshot.name && latestDeleted.text === savedSnapshot.text;
        if (stillMatches) { dirtyGroups.current.delete(id); deletedGroups.current.delete(id); }
      }
      const pending = dirtyGroups.current.size > 0;
      setCloudState(pending ? "saving" : "online");
      setCloudHint(pending ? "Ada ketikan baru yang sedang menunggu autosave." : "Semua perubahan tersimpan di backend.");
      if (pending) setBook(previous => ({ ...previous, weeks: { ...previous.weeks } }));
    }, 700);
    return () => clearTimeout(timeout);
  }, [book, supabase, weekStart, loadedKey, key]);
  const addTeam = date => updateDay(date, day => ({ ...day, groups: [...(day.groups || []), { id: `${date}-team-${(day.groups || []).length + 1}-${crypto.randomUUID().slice(0, 8)}`, name: `Team ${(day.groups || []).length + 1}`, text: "" }] }));
  const openSync = date => {
    const groups = week[date]?.groups || [];
    const dayState = week[date] || emptyDay(date);
    const syncRows = { ...(dayState.syncRows || {}) };
    const entries = groups.flatMap(group => parseGroup(group, date).map(entry => {
      const prior = syncRows[entry.id] || {};
      if (!prior.requestId) syncRows[entry.id] = { ...prior, requestId: entry.requestId };
      const teamMatch = group.name.match(/team\s*0?(\d+)/i);
      const matchingSlot = teamSlots.find(slot => teamMatch && new RegExp(`team\\s*0?${teamMatch[1]}\\b`, "i").test(slot));
      return { ...entry, ...prior, team_slot: prior.team_slot ?? matchingSlot ?? "", validation: "" };
    }));
    setBook(prev => ({ ...prev, weeks: { ...prev.weeks, [weekStart]: { ...(prev.weeks[weekStart] || {}), [date]: { ...dayState, syncRows } } } }));
    setSyncDay(date); setSyncPreview(entries);
  };
  const updatePreview = (id, patch) => {
    setSyncPreview(prev => prev.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
    if (syncDay) setBook(prev => {
      const currentWeek = prev.weeks[weekStart] || {};
      const day = currentWeek[syncDay] || emptyDay(syncDay);
      return { ...prev, weeks: { ...prev.weeks, [weekStart]: { ...currentWeek, [syncDay]: { ...day, syncRows: { ...(day.syncRows || {}), [id]: { ...(day.syncRows?.[id] || {}), ...patch } } } } } };
    });
  };
  const sync = async () => {
    if (!syncPreview.length || syncBusy) return;
    setSyncBusy(true);
    try {
      const valid = syncPreview.filter(row => !row.orderId && row.customer.trim() && normalizePhone(row.phone).length >= 10);
      const result = onSyncDay
        ? await onSyncDay(syncDay, valid)
        : { saved: valid.map(entry => ({ entryId: entry.id, requestId: entry.requestId, order: { id: `PREVIEW-${entry.requestId.slice(0, 8).toUpperCase()}` }, preview: true })) };
      const saved = result?.saved || [];
      if (saved.length) {
        setBook(prev => {
          const currentWeek = prev.weeks[weekStart] || {};
          const day = currentWeek[syncDay] || emptyDay(syncDay);
          const syncRows = { ...(day.syncRows || {}) };
          saved.forEach(row => { syncRows[row.entryId] = { ...(syncRows[row.entryId] || {}), requestId: row.requestId, orderId: row.order.id, preview: Boolean(row.preview) }; });
          return { ...prev, weeks: { ...prev.weeks, [weekStart]: { ...currentWeek, [syncDay]: { ...day, syncRows } } } };
        });
        setSyncPreview(prev => prev.map(entry => {
          const match = saved.find(row => row.requestId === entry.requestId);
          return match ? { ...entry, orderId: match.order.id, preview: Boolean(match.preview) } : entry;
        }));
      }
      if (result?.error) showNotif?.(`Sebagian job belum tersinkron: ${result.error}`, "error");
      else {
        const remaining = syncPreview.filter(entry => !entry.orderId && !saved.some(row => row.requestId === entry.requestId));
        if (remaining.length) showNotif?.(`${saved.length} job tersimulasi. Lengkapi data ${remaining.length} job yang tersisa.`);
        else { showNotif?.(`${saved.length} job berhasil disimulasikan. Tidak ada data database yang dibuat.`); setSyncDay(null); }
      }
    } catch (error) { showNotif?.(`Sinkronisasi gagal: ${error.message}`, "error"); }
    finally { setSyncBusy(false); }
  };
  const attachIncoming = () => {
    if (!incomingNote || !incomingDate) return;
    const day = week[incomingDate] || emptyDay(incomingDate);
    const group = day.groups?.[0] || emptyGroup(incomingDate);
    const [hour, minute] = incomingTime.split(":");
    const timeLabel = minute === "00" ? String(Number(hour)) : incomingTime;
    const text = `Jam ${timeLabel}: ${incomingNote.customer || incomingNote.phone || "Pelanggan WhatsApp"} ${incomingNote.phone || ""} / ${String(incomingNote.body || "Permintaan dari WhatsApp").replace(/\s+/g, " ").trim()} /`;
    updateDay(incomingDate, current => {
      const groups = current.groups?.length ? current.groups : [group];
      return { ...current, groups: groups.map(row => row.id === group.id ? { ...row, text: `${row.text ? `${row.text.trimEnd()}\n` : ""}${text}` } : row) };
    });
    onIncomingConsumed?.();
    showNotif?.("Permintaan WhatsApp ditambahkan ke buku jadwal. Pilih tanggal/jam yang sesuai sebelum sinkronisasi.");
  };
  const useRemoteVersion = () => {
    if (!remoteChange) return;
    const row = remoteChange;
    setBook(previous => {
      const target = previous.weeks[weekStart]?.[row.day_date] || emptyDay(row.day_date);
      const groups = target.groups || [];
      const next = row.is_deleted ? groups.filter(group => group.id !== row.id)
        : groups.some(group => group.id === row.id)
          ? groups.map(group => group.id === row.id ? { id: row.id, name: row.group_name, text: row.content } : group)
          : [...groups, { id: row.id, name: row.group_name, text: row.content }];
      return { ...previous, weeks: { ...previous.weeks, [weekStart]: { ...previous.weeks[weekStart], [row.day_date]: { ...target, groups: next } } } };
    });
    dirtyGroups.current.delete(row.id); deletedGroups.current.delete(row.id);
    versions.current.set(row.id, row.version); remoteRows.current.set(row.id, row);
    advanceRemoteChange(); setCloudState("online"); setCloudHint(`Versi ${row.updated_by || "admin lain"} dimuat.`);
  };
  const keepMyVersion = () => {
    if (!remoteChange) return;
    versions.current.set(remoteChange.id, remoteChange.version);
    remoteRows.current.set(remoteChange.id, remoteChange);
    dirtyGroups.current.add(remoteChange.id);
    advanceRemoteChange(); setCloudState("saving");
    setBook(previous => ({ ...previous, weeks: { ...previous.weeks } }));
  };

  return <main className="week-planner" aria-label="Jadwal manual mingguan">
    <header className="week-planner-header">
      <div><span className="week-planner-eyebrow">ACLEAN · CATATAN JADWAL MANUAL</span><h1>Jadwal Mingguan</h1><p>Satu buku jadwal untuk permintaan WhatsApp dan ketikan manual. Susun pekerjaan per hari dan per tim, lalu sinkronkan satu hari ke Planning Order.</p></div>
      <div className="week-planner-nav"><button aria-label="Minggu sebelumnya" onClick={() => setWeekOffset(value => value - 1)}>←</button><strong>{weekTitle(weekStart)}</strong><button aria-label="Minggu berikutnya" onClick={() => setWeekOffset(value => value + 1)}>→</button><button onClick={() => setWeekOffset(new Date(`${TODAY}T12:00:00Z`).getUTCDay() === 0 ? 1 : 0)}>Minggu ini</button></div>
    </header>

    <section className={`week-cloud-status ${cloudState}`} role="status"><span className="week-cloud-dot"/><strong>{cloudState === "online" ? "Autosave bersama aktif" : cloudState === "saving" ? "Menyimpan perubahan…" : cloudState === "conflict" ? "Perlu menyelaraskan perubahan" : cloudState === "offline" ? "Mode draf lokal" : "Menghubungkan jadwal…"}</strong><span>{cloudHint || (cloudState === "offline" ? "Backend jadwal belum siap; catatan tetap disimpan lokal." : "Perubahan dibagikan kepada Owner dan Admin aktif.")}</span></section>
    {remoteChange && <section className="week-cloud-conflict" role="alert"><div><b>{remoteChange.updated_by || "Admin lain"} mengubah grup ini</b><span>{labelDate(remoteChange.day_date, { day: "numeric", month: "long" })} · perubahan tersimpan {new Date(remoteChange.updated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}. Draf Anda tetap aman.</span></div><button onClick={useRemoteVersion}>Muat perubahan</button><button className="week-planner-sync" onClick={keepMyVersion}>Simpan versi saya</button></section>}

    {incomingNote && <section className="week-wa-intake"><div><span className="week-planner-eyebrow">PERMINTAAN WHATSAPP</span><strong>{incomingNote.customer || incomingNote.phone}</strong><p>{incomingNote.body}</p></div><label>Hari<select value={incomingDate} onChange={event => setIncomingDate(event.target.value)}>{days.map((day, index) => <option key={day.date} value={day.date}>{DAYS[index]} · {labelDate(day.date)}</option>)}</select></label><label>Jam<input type="time" value={incomingTime} onChange={event => setIncomingTime(event.target.value)}/></label><button className="week-planner-sync" onClick={attachIncoming}>Tambahkan ke hari ini ↓</button></section>}

    <div className="week-planner-days">
      {days.map((item, index) => {
        const day = week[item.date] || emptyDay(item.date);
        const allEntries = (day.groups || []).flatMap(group => parseGroup(group, item.date).map(entry => ({ ...entry, ...(day.syncRows?.[entry.id] || {}) })));
        const synced = allEntries.filter(entry => entry.orderId).length;
        const whatsappJobs = ordersData.filter(order => order.date === item.date && order.source === "whatsapp" && !["CANCELLED", "COMPLETED", "PAID"].includes(order.status)).length;
        return <section className="week-planner-day" key={item.date}>
          <header className="week-planner-day-header"><div className="week-planner-day-heading"><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{DAYS[index]}</h2><small>{labelDate(item.date, { day: "numeric", month: "long", year: "numeric" })}</small></div></div><div className="week-planner-day-tools"><span>{day.groups?.length || 0} tim · {allEntries.length} job terdeteksi{whatsappJobs ? ` · WA ${whatsappJobs}` : ""}{synced ? ` · ${synced} simulasi` : ""}</span><button className="week-planner-sync" onClick={() => openSync(item.date)} disabled={!allEntries.length}>⇧ Pratinjau sinkronisasi</button></div></header>
          {whatsappJobs > 0 && <div className="week-planner-wa-jobs">{ordersData.filter(order => order.date === item.date && order.source === "whatsapp" && !["CANCELLED", "COMPLETED", "PAID"].includes(order.status)).map(order => <div key={order.id}><span>WA</span><strong>{order.customer}</strong><small>{order.time || "Jam belum diisi"} · {order.service} · {order.status}</small></div>)}</div>}
          <div className="week-planner-groups">{(day.groups || []).map((group, groupIndex) => { const groupEntries = parseGroup(group, item.date).map(entry => ({ ...entry, ...(day.syncRows?.[entry.id] || {}) })); return <article className="week-planner-group" key={group.id}>
            <div className="week-planner-group-head"><span className="week-planner-team-mark">{groupIndex + 1}</span><input value={group.name} onChange={event => updateDay(item.date, current => ({ ...current, groups: current.groups.map(row => row.id === group.id ? { ...row, name: event.target.value } : row) }))} aria-label={`Nama kelompok tim ${DAYS[index]} ${groupIndex + 1}`} placeholder="Nama tim / kategori"/><button aria-label={`Hapus grup ${group.name}`} onClick={() => updateDay(item.date, current => ({ ...current, groups: current.groups.filter(row => row.id !== group.id) }))}>×</button></div>
            <textarea value={group.text} onChange={event => updateDay(item.date, current => ({ ...current, groups: current.groups.map(row => row.id === group.id ? { ...row, text: event.target.value } : row) }))} placeholder={`Jam 9: nama pelanggan / WhatsApp / layanan dan detail / alamat\nJam 12: istirahat\n\nTulis catatan panjang untuk ${group.name || "tim ini"}…`} rows={8} aria-label={`Catatan ${DAYS[index]} untuk ${group.name}`} />
            <div className="week-planner-group-foot"><span>{group.text.length.toLocaleString("id-ID")} karakter · {groupEntries.length} job terdeteksi</span>{groupEntries.some(entry => entry.orderId) && <span className="week-planner-synced">✓ {groupEntries.filter(entry => entry.orderId).length} simulasi</span>}</div>
          </article>; })}<button className="week-planner-add-team" onClick={() => addTeam(item.date)}>＋ Tambah grup tim</button></div>
        </section>;
      })}
    </div>
    <p className="week-planner-footnote">Autosave catatan memakai backend bersama saat migrasi tersedia; browser menyimpan draf lokal sebagai cadangan. Tombol sinkronisasi job masih berupa simulasi dan belum membuat Planning Order.</p>

    {syncDay && <div className="week-sync-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !syncBusy) setSyncDay(null); }}><section className="week-sync-dialog" role="dialog" aria-modal="true" aria-labelledby="week-sync-title">
      <header><div><span className="week-planner-eyebrow">SIMULASI LOKAL · TANPA TULIS DATABASE</span><h2 id="week-sync-title">{DAYS[days.findIndex(day => day.date === syncDay)]} · {labelDate(syncDay, { day: "numeric", month: "long", year: "numeric" })}</h2><p>Periksa data yang nantinya menjadi job Planning Order. Belum ada order atau pesan yang dibuat.</p></div><button disabled={syncBusy} aria-label="Tutup" onClick={() => setSyncDay(null)}>×</button></header>
      <div className="week-sync-list">{syncPreview.map((entry, index) => <article key={entry.id} className={entry.orderId ? "synced" : ""}><div className="week-sync-row-heading"><b>Job {index + 1} · {entry.groupName}</b><span>{entry.orderId ? `✓ ${entry.orderId}` : entry.raw}</span></div>{!entry.orderId && <div className="week-sync-fields">
        <label>Jam<input type="time" value={entry.time} onChange={event => updatePreview(entry.id, { time: event.target.value, time_end: estimatedEnd(event.target.value, entry.service, entry.units) })}/></label>
        <label>Pelanggan<input value={entry.customer} onChange={event => updatePreview(entry.id, { customer: event.target.value })}/></label>
        <label>WhatsApp<input value={entry.phone} onChange={event => updatePreview(entry.id, { phone: event.target.value })} placeholder="628…"/></label>
        <label>Alamat<input value={entry.address} onChange={event => updatePreview(entry.id, { address: event.target.value })}/></label>
        <label>Layanan<select value={entry.service} onChange={event => updatePreview(entry.id, { service: event.target.value, time_end: estimatedEnd(entry.time, event.target.value, entry.units) })}><option>Cleaning</option><option>Repair</option><option>Install</option><option>Complain</option><option>Maintenance</option></select></label>
        <label>Unit<input type="number" min="1" max="100" value={entry.units} onChange={event => updatePreview(entry.id, { units: Number(event.target.value), time_end: estimatedEnd(entry.time, entry.service, Number(event.target.value)) })}/></label>
        <label>Tim<select value={entry.team_slot} onChange={event => updatePreview(entry.id, { team_slot: event.target.value })}><option value="">Tentukan nanti di Planning</option>{teamSlots.map(slot => <option key={slot}>{slot}</option>)}</select></label>
      </div>}{!entry.orderId && (!entry.customer.trim() || normalizePhone(entry.phone).length < 10) && <small className="week-sync-error">Lengkapi nama dan nomor WhatsApp sebelum sinkron.</small>}</article>)}</div>
      <footer><span>{syncPreview.filter(row => !row.orderId).length} job dalam simulasi</span><button disabled={syncBusy} onClick={() => setSyncDay(null)}>Kembali</button><button className="week-planner-sync" disabled={syncBusy || !syncPreview.some(row => !row.orderId && row.customer.trim() && normalizePhone(row.phone).length >= 10)} onClick={sync}>{syncBusy ? "Menyiapkan…" : "Simulasikan job ke Planning"}</button></footer>
    </section></div>}
  </main>;
}
