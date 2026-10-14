import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import InstallAppButton from './InstallAppButton.jsx'

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
    <App />
    <InstallAppButton />
  </StrictMode>,
)
