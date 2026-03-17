import { useState, useRef } from 'react'
import { Check, Upload, X } from 'lucide-react'
import type { LogoCandidate } from '../../types'

interface LogoCheckerProps {
  candidates: LogoCandidate[]
  brandName: string
  onConfirm: (selected: LogoCandidate | null) => void
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  logo: 'bg-emerald-100 text-emerald-700',
  icon: 'bg-sky-100 text-sky-700',
  product: 'bg-amber-100 text-amber-700',
  banner: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-500',
  unknown: 'bg-gray-100 text-gray-500',
}

export function LogoChecker({ candidates, brandName, onConfirm }: LogoCheckerProps) {
  const aiPickIndex = candidates.findIndex((c) => c.isAiPick)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(aiPickIndex >= 0 ? aiPickIndex : 0)
  const [uploadedLogo, setUploadedLogo] = useState<LogoCandidate | null>(null)
  const [useUpload, setUseUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      setUploadedLogo({
        base64,
        sourceUrl: 'upload',
        name: file.name,
        mimeType: file.type || 'image/png',
        aiClassification: 'logo',
        isAiPick: false,
      })
      setUseUpload(true)
      setSelectedIndex(null)
    }
    reader.readAsDataURL(file)
  }

  const handleConfirm = () => {
    if (useUpload && uploadedLogo) {
      onConfirm(uploadedLogo)
    } else if (selectedIndex !== null && selectedIndex >= 0) {
      onConfirm(candidates[selectedIndex])
    } else {
      onConfirm(null) // use AI pick
    }
  }

  const hasSelection = useUpload ? !!uploadedLogo : selectedIndex !== null

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6">
      <div className="glass max-w-2xl w-full max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-black/[0.06]">
          <div>
            <h2 className="font-display text-lg font-medium">Choose Your Logo</h2>
            <p className="text-xs text-text-muted mt-0.5">
              We found {candidates.length} candidates for {brandName}.
              {aiPickIndex >= 0 && ' AI recommends the highlighted one.'}
            </p>
          </div>
          <button
            onClick={() => onConfirm(null)}
            className="p-1.5 rounded-lg hover:bg-black/[0.04] text-text-muted"
            title="Skip — use AI pick"
          >
            <X size={16} />
          </button>
        </div>

        {/* Candidates grid */}
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-3 gap-3">
            {candidates.map((candidate, i) => {
              const isSelected = !useUpload && selectedIndex === i
              const isAi = candidate.isAiPick
              const cls = candidate.aiClassification || 'unknown'
              return (
                <button
                  key={i}
                  onClick={() => { setSelectedIndex(i); setUseUpload(false) }}
                  className={`relative rounded-xl border-2 p-2 transition-all text-left ${
                    isSelected
                      ? 'border-text-primary ring-2 ring-text-primary/20 bg-white/60'
                      : 'border-black/[0.06] bg-white/30 hover:bg-white/50'
                  }`}
                >
                  {/* Checkered bg for transparency */}
                  <div
                    className="w-full h-20 rounded-lg overflow-hidden flex items-center justify-center"
                    style={{
                      backgroundImage: 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                    }}
                  >
                    <img
                      src={candidate.base64}
                      alt={candidate.name}
                      className="max-w-full max-h-full object-contain"
                      draggable={false}
                    />
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1 mt-2">
                    {isAi && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">
                        AI Pick
                      </span>
                    )}
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${CLASSIFICATION_COLORS[cls] || CLASSIFICATION_COLORS.unknown}`}>
                      {cls}
                    </span>
                  </div>

                  {/* File name */}
                  <p className="text-[9px] text-text-muted mt-1 truncate">{candidate.name}</p>

                  {/* Selected check */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-text-primary text-white flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </button>
              )
            })}

            {/* Upload card */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`relative rounded-xl border-2 border-dashed p-2 transition-all flex flex-col items-center justify-center gap-2 min-h-[120px] ${
                useUpload
                  ? 'border-text-primary ring-2 ring-text-primary/20 bg-white/60'
                  : 'border-black/[0.12] bg-white/20 hover:border-black/30 hover:bg-white/40'
              }`}
            >
              {uploadedLogo ? (
                <>
                  <div
                    className="w-full h-20 rounded-lg overflow-hidden flex items-center justify-center"
                    style={{
                      backgroundImage: 'linear-gradient(45deg, #e0e0e0 25%, transparent 25%), linear-gradient(-45deg, #e0e0e0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e0e0e0 75%), linear-gradient(-45deg, transparent 75%, #e0e0e0 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                    }}
                  >
                    <img src={uploadedLogo.base64} alt="Uploaded" className="max-w-full max-h-full object-contain" />
                  </div>
                  <p className="text-[9px] text-text-muted truncate w-full text-center">{uploadedLogo.name}</p>
                  {useUpload && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-text-primary text-white flex items-center justify-center">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Upload size={16} className="text-text-muted" />
                  <span className="text-[10px] text-text-muted">Upload Logo</span>
                </>
              )}
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-black/[0.06]">
          <button
            onClick={() => onConfirm(null)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            Skip, use AI pick
          </button>
          <button
            onClick={handleConfirm}
            disabled={!hasSelection}
            className="px-6 py-2.5 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Check size={14} />
            Use This Logo
          </button>
        </div>
      </div>
    </div>
  )
}
