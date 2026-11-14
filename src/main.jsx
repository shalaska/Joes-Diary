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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
