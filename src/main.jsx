import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConnectPage from './components/ConnectPage.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'

// /connect is the consent page outside AI apps send the user to (Phase 3). It is its own
// small page: it never loads the diary itself.
const page = window.location.pathname === '/connect'
  ? <AuthProvider><ConnectPage /></AuthProvider>
  : <App />

// After a deploy, a tab opened earlier may ask for a code chunk that no longer exists
// (for example when Settings is first opened). Reloading picks up the new version.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
