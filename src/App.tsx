declare const __APP_VERSION__: string

import { useEffect, lazy, Suspense } from 'react'
import { Shell } from './components/layout/Shell'
import { ApiKeys } from './components/onboarding/ApiKeys'
import { useStore } from './store'
import type { CatalogTemplate } from './types'

// Lazy-load heavy page components — only loaded when navigated to
const BrandDnaPage = lazy(() => import('./components/brand/BrandDna').then(m => ({ default: m.BrandDnaPage })))
const AssetLibraryPage = lazy(() => import('./components/assets/AssetLibrary').then(m => ({ default: m.AssetLibraryPage })))
const GeneratePanelPage = lazy(() => import('./components/generate/GeneratePanel').then(m => ({ default: m.GeneratePanelPage })))
const ResultsGridPage = lazy(() => import('./components/results/ResultsGrid').then(m => ({ default: m.ResultsGridPage })))

// Check for updates against GitHub
const REPO = 'peterquads/odylic-studio'
const CURRENT_VERSION = __APP_VERSION__

function App() {
  const step = useStore((s) => s.step)
  const catalog = useStore((s) => s.catalog)
  const setCatalog = useStore((s) => s.setCatalog)
  const isGenerating = useStore((s) => s.isGenerating)
  const isResearching = useStore((s) => s.isResearching)

  // Warn before closing tab during generation or research
  useEffect(() => {
    if (!isGenerating && !isResearching) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isGenerating, isResearching])

  // Check for updates on mount (once per session)
  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha' } })
      .then(r => r.ok ? r.text() : null)
      .then(sha => {
        if (sha && sha.trim() !== CURRENT_VERSION) {
          useStore.setState({ updateAvailable: true })
        }
      })
      .catch(() => {})
  }, [])

  // Lazy-load catalog data on startup
  useEffect(() => {
    if (catalog.length === 0) {
      import('./data/catalog.json').then((mod) => {
        const data = mod.default as CatalogTemplate[]
        if (data.length > 0) setCatalog(data)
      })
    }
  }, [])

  return (
    <Shell>
      <Suspense fallback={<div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>}>
        {step === 'setup' && <ApiKeys />}
        {step === 'brand' && <BrandDnaPage />}
        {step === 'assets' && <AssetLibraryPage />}
        {step === 'generate' && <GeneratePanelPage />}
        {step === 'results' && <ResultsGridPage />}
      </Suspense>
    </Shell>
  )
}

export default App
