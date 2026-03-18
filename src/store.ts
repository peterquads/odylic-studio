import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, GeneratedAd } from './types'

// Module-level abort controller for generation (not serializable, not in store)
let generationAbort: AbortController | null = null
export function getGenerationAbort() { return generationAbort }
export function setGenerationAbort(ac: AbortController | null) { generationAbort = ac }

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      step: 'setup',
      setStep: (step) => set({ step }),

      claudeApiKey: '',
      geminiApiKey: '',
      setClaudeApiKey: (claudeApiKey) => set({ claudeApiKey }),
      setGeminiApiKey: (geminiApiKey) => set({ geminiApiKey }),

      brandDna: null,
      setBrandDna: (brandDna) => set({ brandDna }),
      personas: [],
      setPersonas: (personas) => set({ personas }),
      isResearching: false,
      setIsResearching: (isResearching) => set({ isResearching }),

      assets: [],
      addAsset: (asset) => set((s) => ({ assets: [...s.assets, asset] })),
      addAssets: (newAssets) => set((s) => ({ assets: [...s.assets, ...newAssets] })),
      updateAsset: (id, updates) =>
        set((s) => ({
          assets: s.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)),
        })),
      removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

      catalog: [],
      setCatalog: (catalog) => set({ catalog }),
      selectedTemplates: [],
      toggleTemplate: (filename) =>
        set((s) => {
          const exists = s.selectedTemplates.find((t) => t.filename === filename)
          if (exists) {
            return { selectedTemplates: s.selectedTemplates.filter((t) => t.filename !== filename) }
          }
          const template = s.catalog.find((t) => t.filename === filename)
          if (template) {
            return { selectedTemplates: [...s.selectedTemplates, template] }
          }
          return s
        }),
      clearSelectedTemplates: () => set({ selectedTemplates: [] }),

      generationConfig: {
        aspectRatio: '1:1',
        modelTier: 'hd',
        quantity: 3,
        customDescription: '',
        sizeQuantities: [
          { ratio: '1:1', quantity: 3 },
          { ratio: '3:4', quantity: 0 },
          { ratio: '9:16', quantity: 0 },
        ],
        sizeMode: 'each',
        selectedSizes: ['1:1'] as import('./types').AspectRatio[],
        adsPerBatch: 3,
      },
      setGenerationConfig: (config) =>
        set((s) => ({ generationConfig: { ...s.generationConfig, ...config } })),
      isGenerating: false,
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      generationProgress: { current: 0, total: 0, stage: '' },
      setGenerationProgress: (p) => set((s) => ({ generationProgress: { ...s.generationProgress, ...p } })),

      results: [],
      addResult: (result) => set((s) => ({ results: [result, ...s.results] })),
      updateResult: (id, updates) =>
        set((s) => ({
          results: s.results.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      removeResults: (ids) =>
        set((s) => {
          const idSet = new Set(ids)
          return { results: s.results.filter((r) => !idSet.has(r.id)) }
        }),
      clearResults: () => set({ results: [] }),

      errors: [] as string[],
      addError: (msg: string) => set((s) => ({ errors: [...s.errors.slice(-4), msg] })),
      dismissError: (idx: number) => set((s) => ({ errors: s.errors.filter((_, i) => i !== idx) })),

      savedAdIds: new Set<string>(),
      toggleSavedAd: (id) => set((s) => {
        const next = new Set(s.savedAdIds)
        if (next.has(id)) next.delete(id); else next.add(id)
        return { savedAdIds: next }
      }),

      resetForNewBrand: () => {
        import('./lib/db').then(({ clearSession }) => clearSession()).catch(() => {})
        return set({
          brandDna: null,
          personas: [],
          assets: [],
          results: [],
          selectedTemplates: [],
          savedAdIds: new Set<string>(),
          isGenerating: false,
          generationProgress: { current: 0, total: 0, stage: '' },
        })
      },

      customTemplates: [],
      excludeBuiltInTemplates: false,
      hideTemplateReference: false,
      setHideTemplateReference: (hideTemplateReference) => set({ hideTemplateReference }),
      addCustomTemplate: (t) => set((s) => ({ customTemplates: [...s.customTemplates, t] })),
      updateCustomTemplate: (id, updates) =>
        set((s) => ({
          customTemplates: s.customTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),
      removeCustomTemplate: (id) => set((s) => ({ customTemplates: s.customTemplates.filter((t) => t.id !== id) })),
      setExcludeBuiltInTemplates: (excludeBuiltInTemplates) => set({ excludeBuiltInTemplates }),

      advancedMode: false,
      setAdvancedMode: (advancedMode) => set({ advancedMode }),
      customCopy: {
        headline: '',
        subHeadline: '',
        cta: '',
        features: [],
        benefits: [],
        callouts: [],
      },
      setCustomCopy: (copy) =>
        set((s) => ({ customCopy: { ...s.customCopy, ...copy } })),
    }),
    {
      name: 'odylic-studio',
      partialize: (state) => ({
        step: state.step,
        claudeApiKey: state.claudeApiKey,
        geminiApiKey: state.geminiApiKey,
        generationConfig: state.generationConfig,
        advancedMode: state.advancedMode,
        customCopy: state.customCopy,
        excludeBuiltInTemplates: state.excludeBuiltInTemplates,
        hideTemplateReference: state.hideTemplateReference,
        brandDna: state.brandDna,
        personas: state.personas,
        // NOTE: assets and results NOT persisted — they contain base64 data that exceeds localStorage limits
      }),
    }
  )
)

// ── Session persistence: auto-save assets & results to IndexedDB ──
// Assets/results contain base64 blobs too large for localStorage, so we use IndexedDB.
// This survives hot-reloads, page refreshes, and crashes.
let saveTimer: ReturnType<typeof setTimeout> | null = null
useStore.subscribe((state, prev) => {
  if (state.assets !== prev.assets || state.results !== prev.results || state.customTemplates !== prev.customTemplates) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      try {
        const { saveSessionAssets, saveSessionResults, saveCustomTemplates } = await import('./lib/db')
        if (state.assets.length > 0) await saveSessionAssets(state.assets)
        if (state.results.length > 0) await saveSessionResults(state.results)
        await saveCustomTemplates(state.customTemplates)
      } catch (e) {
        console.warn('Session auto-save failed:', e)
      }
    }, 1000)
  }
})

// Restore assets & results from IndexedDB on app boot (if store is empty)
;(async () => {
  try {
    const store = useStore.getState()
    if (store.assets.length === 0 || store.results.length === 0 || store.customTemplates.length === 0) {
      const { loadSessionAssets, loadSessionResults, loadCustomTemplates } = await import('./lib/db')
      const [savedAssets, savedResults, savedCustomTemplates] = await Promise.all([
        loadSessionAssets(),
        loadSessionResults(),
        loadCustomTemplates(),
      ])
      const current = useStore.getState()
      if (current.assets.length === 0 && savedAssets.length > 0) {
        useStore.setState({ assets: savedAssets })
        console.log(`Restored ${savedAssets.length} assets from session`)
      }
      if (current.results.length === 0 && savedResults.length > 0) {
        useStore.setState({ results: savedResults })
        console.log(`Restored ${savedResults.length} results from session`)
      }
      if (current.customTemplates.length === 0 && savedCustomTemplates.length > 0) {
        useStore.setState({ customTemplates: savedCustomTemplates })
        console.log(`Restored ${savedCustomTemplates.length} custom templates`)
      }
    }
  } catch (e) {
    console.warn('Session restore failed:', e)
  }
})()

// Version selectors — used by ResultsGrid to show latest versions and version history
export function selectLatestVersions(results: GeneratedAd[]): GeneratedAd[] {
  const childParentIds = new Set(results.filter((r) => r.parentId).map((r) => r.parentId))
  return results.filter((r) => !childParentIds.has(r.id))
}

export function selectAllVersions(results: GeneratedAd[], id: string): GeneratedAd[] {
  const target = results.find((r) => r.id === id)
  if (!target) return []
  // Walk up to root
  let rootId = id
  let current = target
  while (current.parentId) {
    const parent = results.find((r) => r.id === current.parentId)
    if (!parent) break
    rootId = current.parentId
    current = parent
  }
  // Collect all descendants from root
  const versions: GeneratedAd[] = [current]
  const visited = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const r of results) {
      if (r.parentId && visited.has(r.parentId) && !visited.has(r.id)) {
        versions.push(r)
        visited.add(r.id)
        changed = true
      }
    }
  }
  return versions.sort((a, b) => (a.version || 1) - (b.version || 1))
}
