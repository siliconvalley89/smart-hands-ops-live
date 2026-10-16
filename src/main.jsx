import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import InstallAppButton from './InstallAppButton.jsx'
import VerifyBadge from './VerifyBadge.jsx'

const verifyMatch = window.location.pathname.match(/^\/verify\/([A-Za-z0-9]+)\/?$/)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/firebase-messaging-sw.js', { updateViaCache: 'none' })
      .catch((error) => {
        console.error('Service worker registration failed', error)
      })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {verifyMatch ? (
      <VerifyBadge uid={verifyMatch[1]} />
    ) : (
      <>
        <App />
        <InstallAppButton />
      </>
    )}
  </StrictMode>,
)
