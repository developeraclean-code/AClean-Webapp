const DB_NAME = "aclean-field-queue";
const DB_VERSION = 2;
const JOB_STORE = "job_packages";
const META_STORE = "meta";
const localDateKey = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const openDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("actions")) db.createObjectStore("actions", { keyPath: "id" });
    if (!db.objectStoreNames.contains(JOB_STORE)) db.createObjectStore(JOB_STORE, { keyPath: "id" });
    if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const getRow = async (storeName, id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("periodicsync", event => {
  if (event.tag !== "aclean-field-reminders") return;
  event.waitUntil((async () => {
    const active = await getRow(META_STORE, "active_user");
    if (!active?.userKey) return;
    const pkg = await getRow(JOB_STORE, active.userKey);
    if (!pkg || Date.now() - Number(pkg.cachedAt || 0) > 36 * 60 * 60 * 1000) return;
    const now = new Date();
    const today = localDateKey(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const next = (pkg.jobs || []).find(job => {
      if (job.date !== today || !["PENDING", "CONFIRMED"].includes(job.status)) return false;
      const [hour, minute] = String(job.time || "00:00").split(":").map(Number);
      const delta = hour * 60 + minute - nowMinutes;
      return delta >= 0 && delta <= 45;
    });
    if (!next) return;
    await self.registration.showNotification("AClean · Job berikutnya", {
      body: `${next.customer} pukul ${next.time || "--:--"}`,
      icon: "/aclean-logo.png", badge: "/favicon.svg", tag: `aclean-job-${next.id}-${today}`,
      data: { url: "/", jobId: next.id },
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const open = clients.find(client => "focus" in client);
    return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || "/");
  }));
});
