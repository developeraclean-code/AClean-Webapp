import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import * as Sentry from "@sentry/react"

// Initialize Sentry for error tracking
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 1.0,
    beforeSend(event, hint) {
      // Skip noisy errors (optional)
      if (event.exception?.values?.[0]?.type === "ChunkLoadError") {
        return null; // Chunk load errors sudah ditangani dengan reload
      }
      return event;
    }
  });
}

// Auto-reload saat dynamic import gagal (deploy baru di Vercel — asset hash lama hilang).
// Cek flag agar tidak infinite reload loop.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('chunk_reload') === '1') return;
  sessionStorage.setItem('chunk_reload', '1');
  event.preventDefault();
  window.location.reload();
});
// Reset flag setelah app load sukses
setTimeout(() => sessionStorage.removeItem('chunk_reload'), 5000);

const CustomerPortalView = lazy(() => import('./views/CustomerPortalView.jsx'))

// Deteksi path token portal — render portal tanpa App shell.
// Terima dua format: /status/<token> (lama) DAN /<token> (status.aclean.id/<token>).
const pathMatch = window.location.pathname.match(/^\/(?:status\/)?([a-f0-9]{48})$/)

// Jika dibuka di domain customer (status.aclean.id) tanpa token yang valid,
// redirect ke landing page agar tidak tampil halaman login internal
const isCustomerDomain = window.location.hostname === "status.aclean.id";
if (isCustomerDomain && !pathMatch) {
  window.location.replace("https://aclean.id");
}

function Root() {
  if (pathMatch) {
    return (
      <Sentry.ErrorBoundary fallback={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f0f4f8" }}>
          <div style={{ textAlign: "center", fontFamily: "sans-serif" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontWeight: 700, color: "#dc2626" }}>Ada kesalahan</div>
            <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Silakan refresh halaman</div>
          </div>
        </div>
      }>
        <Suspense fallback={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f0f4f8" }}>
            <div style={{ textAlign: "center", fontFamily: "sans-serif" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>❄️</div>
              <div style={{ fontWeight: 700, color: "#0369a1" }}>Memuat...</div>
            </div>
          </div>
        }>
          <CustomerPortalView token={pathMatch[1]} />
        </Suspense>
      </Sentry.ErrorBoundary>
    )
  }
  return (
    <Sentry.ErrorBoundary fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f0f4f8" }}>
        <div style={{ textAlign: "center", fontFamily: "sans-serif" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, color: "#dc2626" }}>Ada kesalahan</div>
          <div style={{ fontSize: 14, color: "#666", marginTop: 8 }}>Silakan refresh halaman</div>
        </div>
      </div>
    }>
      <App />
    </Sentry.ErrorBoundary>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
