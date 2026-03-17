import { useState, useEffect, type ReactNode } from 'react'
import {
  Palette,
  ImagePlus,
  Wand2,
  Images,
  Settings,
  FolderOpen,
  Heart,
  X,
  AlertTriangle,
} from 'lucide-react'
import { useStore } from '../../store'
import { ProfileManager } from '../profiles/ProfileManager'
import type { AppStep } from '../../types'

const NAV_ITEMS: { step: AppStep; icon: ReactNode; label: string }[] = [
  { step: 'setup', icon: <Settings size={16} />, label: 'Setup' },
  { step: 'brand', icon: <Palette size={16} />, label: 'Brand Guide' },
  { step: 'assets', icon: <ImagePlus size={16} />, label: 'Assets' },
  { step: 'generate', icon: <Wand2 size={16} />, label: 'Generate' },
  { step: 'results', icon: <Images size={16} />, label: 'Results' },
]

export function Shell({ children }: { children: ReactNode }) {
  const { step, setStep, brandDna, savedAdIds } = useStore()
  const [showProfiles, setShowProfiles] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const savedCount = savedAdIds.size

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 glass !rounded-none !border-r border-t-0 border-b-0 border-l-0 flex flex-col" style={{ borderRadius: 0 }}>
        <div className="px-5 py-4 border-b border-black/[0.06] flex items-center gap-2">
          <a href="https://www.odylicmedia.com/" target="_blank" rel="noopener noreferrer">
            <img src="/odylic-logo.png" alt="Odylic" className="h-7 object-contain hover:opacity-80 transition-opacity" />
          </a>
          <span className="text-[9px] tracking-[0.25em] uppercase text-text-muted leading-none">Studio</span>
        </div>

        <div className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = step === item.step
            const isDisabled =
              !brandDna &&
              item.step !== 'setup' &&
              item.step !== 'brand'

            return (
              <button
                key={item.step}
                onClick={() => !isDisabled && setStep(item.step)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-black/[0.06] text-text-primary font-medium'
                    : isDisabled
                      ? 'text-text-muted/40 cursor-not-allowed'
                      : 'text-text-secondary hover:bg-black/[0.03] hover:text-text-primary'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Bottom actions */}
        <div className="px-2 py-3 border-t border-black/[0.06] space-y-0.5">
          <button
            onClick={() => setShowProfiles(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-text-secondary hover:bg-black/[0.03] hover:text-text-primary transition-all"
          >
            <FolderOpen size={16} />
            Profiles
          </button>
          {savedCount > 0 && (
            <button
              onClick={() => setShowSaved(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-text-secondary hover:bg-black/[0.03] hover:text-text-primary transition-all"
            >
              <Heart size={16} />
              Saved
              <span className="ml-auto text-[10px] bg-text-primary text-white rounded-full px-1.5 py-0.5">{savedCount}</span>
            </button>
          )}
        </div>
      </nav>

      {showProfiles && <ProfileManager onClose={() => setShowProfiles(false)} />}
      {showSaved && <SavedAdsModal onClose={() => setShowSaved(false)} />}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">{children}</main>

      {/* Error Toasts */}
      <ErrorToasts />
    </div>
  )
}

function ErrorToasts() {
  const errors = useStore((s) => s.errors)
  const dismissError = useStore((s) => s.dismissError)

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (errors.length === 0) return
    const timer = setTimeout(() => dismissError(0), 8000)
    return () => clearTimeout(timer)
  }, [errors, dismissError])

  if (errors.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {errors.map((msg, i) => (
        <div
          key={`${i}-${msg.slice(0, 20)}`}
          className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 shadow-lg animate-in slide-in-from-right"
        >
          <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700 flex-1">{msg}</p>
          <button
            onClick={() => dismissError(i)}
            className="p-0.5 rounded hover:bg-red-100 text-red-400 hover:text-red-600 flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function SavedAdsModal({ onClose }: { onClose: () => void }) {
  const { results, savedAdIds, toggleSavedAd } = useStore()
  const savedAds = results.filter(r => savedAdIds.has(r.id) && r.imageUrl)

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="glass max-w-4xl w-full max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-black/[0.06]">
          <div className="flex items-center gap-2">
            <Heart size={18} className="text-red-500" />
            <h2 className="font-display text-lg font-medium">Saved Creatives ({savedAds.length})</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/[0.04]">
            <Images size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[70vh]">
          {savedAds.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">No saved creatives yet. Click the heart icon on generated ads to save them.</p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {savedAds.map(ad => (
                <div key={ad.id} className="relative group rounded-xl overflow-hidden border border-black/[0.06]">
                  <img src={ad.imageUrl} alt={ad.adName || 'Ad'} className="w-full aspect-square object-cover" />
                  <button
                    onClick={() => toggleSavedAd(ad.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-red-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove from saved"
                  >
                    <Heart size={12} fill="currentColor" />
                  </button>
                  <div className="p-2">
                    <p className="text-[10px] text-text-muted truncate">{ad.adName || ad.templateFilename}</p>
                    <p className="text-[10px] text-text-muted">{ad.aspectRatio}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
