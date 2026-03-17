import { useState, useEffect } from 'react'
import { FolderOpen, Trash2, Plus, X, Loader2 } from 'lucide-react'
import { useStore } from '../../store'
import { listProfiles, loadProfile, deleteProfile, upsertProfile } from '../../lib/db'
import { generateId } from '../../utils/image'

export function ProfileManager({ onClose }: { onClose: () => void }) {
  const {
    brandDna, personas, assets, results, savedAdIds,
    resetForNewBrand, setStep,
  } = useStore()

  const [profiles, setProfiles] = useState<{ id: string; name: string; savedAt: number; assetCount: number; resultCount: number; url?: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const list = await listProfiles()
    setProfiles(list)
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  const handleSave = async () => {
    if (!brandDna) return
    setSaving(true)
    await upsertProfile({
      id: generateId(),
      name: brandDna.name,
      savedAt: Date.now(),
      brandDna,
      personas,
      assets,
      results,
      savedAdIds: [...savedAdIds],
    })
    await refresh()
    setSaving(false)
  }

  const handleLoad = async (id: string) => {
    const profile = await loadProfile(id)
    if (!profile) return
    // Replace entire app state with profile data
    const store = useStore.getState()
    store.resetForNewBrand()
    store.setBrandDna(profile.brandDna)
    store.setPersonas(profile.personas)
    for (const asset of profile.assets) {
      store.addAsset(asset)
    }
    for (const result of profile.results) {
      store.addResult(result)
    }
    for (const adId of profile.savedAdIds) {
      store.toggleSavedAd(adId)
    }
    store.setStep('brand')
    onClose()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete profile "${name}"?`)) return
    await deleteProfile(id)
    await refresh()
  }

  const handleNewBrand = () => {
    resetForNewBrand()
    setStep('brand')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="glass max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-text-secondary" />
            <h2 className="font-display text-lg font-medium">Brand Profiles</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/[0.04]"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto max-h-[60vh]">
          {/* Save current */}
          {brandDna && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-text-primary text-white hover:bg-accent-hover transition-all text-sm font-medium"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              Save Current: {brandDna.name}
            </button>
          )}

          {/* New brand */}
          <button
            onClick={handleNewBrand}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-black/[0.12] text-text-muted hover:border-black/30 hover:text-text-secondary transition-all text-sm"
          >
            <Plus size={14} />
            New Brand
          </button>

          {/* Profiles list */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-text-muted" />
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No saved profiles yet</p>
          ) : (
            profiles.map((p) => {
              const domain = p.url ? (() => { try { return new URL(p.url).hostname } catch { return '' } })() : ''
              return (
              <div
                key={p.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/40 border border-black/[0.06] hover:bg-white/60 transition-all cursor-pointer group"
                onClick={() => handleLoad(p.id)}
              >
                {domain ? (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                    alt=""
                    className="w-5 h-5 rounded-sm flex-shrink-0"
                  />
                ) : (
                  <FolderOpen size={16} className="text-text-muted flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[10px] text-text-muted">
                    {p.assetCount} assets, {p.resultCount} results
                    {' · '}
                    {new Date(p.savedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.name) }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
