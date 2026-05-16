import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

const CustomerPortalView = lazy(() => import('./views/CustomerPortalView.jsx'))

// Deteksi path /status/:token — render portal tanpa App shell
const pathMatch = window.location.pathname.match(/^\/status\/([a-f0-9]{48})$/)

function Root() {
  if (pathMatch) {
    // Inject token ke useParams-like via context sederhana — pakai window global
    window.__portalToken = pathMatch[1]
    return (
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
    )
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
