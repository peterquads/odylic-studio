import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Clean up any legacy bloated localStorage (old versions persisted base64 assets)
try {
  const stored = localStorage.getItem('odylic-studio')
  if (stored && stored.length > 100_000) {
    const parsed = JSON.parse(stored)
    // Remove persisted assets/brandDna/personas — they're no longer persisted
    if (parsed?.state) {
      delete parsed.state.assets
      delete parsed.state.brandDna
      delete parsed.state.personas
      localStorage.setItem('odylic-studio', JSON.stringify(parsed))
    }
  }
} catch {
  localStorage.removeItem('odylic-studio')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
