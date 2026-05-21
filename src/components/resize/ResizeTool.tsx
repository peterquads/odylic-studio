import { useCallback, useRef, useState } from 'react'
import {
  Upload,
  Download,
  Loader2,
  X,
  Square,
  RectangleVertical,
  Smartphone,
  Zap,
  Sparkles,
  Crown,
  Image as ImageIcon,
} from 'lucide-react'
import { saveAs } from 'file-saver'
import { useStore } from '../../store'
import { resizeImage } from '../../services/gemini'
import { fileToBase64, generateId } from '../../utils/image'
import { GlassCard, GlassBadge } from '../layout/GlassCard'
import type { AspectRatio, ModelTier } from '../../types'

const ASPECT_RATIOS: { value: AspectRatio; label: string; icon: any; desc: string }[] = [
  { value: '1:1', label: 'Feed', icon: Square, desc: '1:1' },
  { value: '3:4', label: 'Portrait', icon: RectangleVertical, desc: '3:4' },
  { value: '9:16', label: 'Story', icon: Smartphone, desc: '9:16' },
]

const QUALITY_TIERS: { value: ModelTier; label: string; desc: string; tooltip: string; icon: any }[] = [
  { value: 'standard', label: 'Fast', desc: 'Nano Banana', tooltip: 'Gemini 2.5 Flash · Free tier · Fastest', icon: Zap },
  { value: 'hd', label: 'Quality', desc: 'Nano Banana 2', tooltip: 'Gemini 3.1 Flash · Paid · Better quality', icon: Sparkles },
  { value: '2k', label: 'Pro', desc: 'Nano Banana Pro', tooltip: 'Gemini 3 Pro · Paid · Best quality', icon: Crown },
]

interface SourceImage {
  dataUrl: string
  width: number
  height: number
  filename: string
}

interface ResizedOutput {
  id: string
  ratio: AspectRatio
  dataUrl?: string
  status: 'pending' | 'done' | 'error'
  error?: string
}

function nearestRatio(w: number, h: number): { ratio: AspectRatio; isExact: boolean } {
  if (!w || !h) return { ratio: '1:1', isExact: false }
  const r = w / h
  const candidates: { ratio: AspectRatio; value: number }[] = [
    { ratio: '1:1', value: 1 },
    { ratio: '3:4', value: 3 / 4 },
    { ratio: '9:16', value: 9 / 16 },
  ]
  let best = candidates[0]
  for (const c of candidates) {
    if (Math.abs(c.value - r) < Math.abs(best.value - r)) best = c
  }
  return { ratio: best.ratio, isExact: Math.abs(best.value - r) / best.value < 0.04 }
}

export function ResizeToolPage() {
  const geminiApiKey = useStore((s) => s.geminiApiKey)
  const generationConfig = useStore((s) => s.generationConfig)
  const setGenerationConfig = useStore((s) => s.setGenerationConfig)

  const [source, setSource] = useState<SourceImage | null>(null)
  const [outputs, setOutputs] = useState<ResizedOutput[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [sourceRatio, setSourceRatio] = useState<AspectRatio>('1:1')
  const [targetRatios, setTargetRatios] = useState<AspectRatio[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const dataUrl = await fileToBase64(file)
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      const { ratio, isExact } = nearestRatio(w, h)
      setSource({ dataUrl, width: w, height: h, filename: file.name })
      if (isExact) setSourceRatio(ratio)
      setTargetRatios(ASPECT_RATIOS.map((r) => r.value).filter((r) => r !== ratio))
      setOutputs([])
    }
    img.src = dataUrl
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const toggleTarget = (r: AspectRatio) => {
    setTargetRatios((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])
  }

  const runResize = async () => {
    if (!source || !geminiApiKey || targetRatios.length === 0) return
    const queue = targetRatios.map((ratio) => ({ id: generateId(), ratio }))
    setOutputs((prev) => [
      ...prev,
      ...queue.map((q) => ({ id: q.id, ratio: q.ratio, status: 'pending' as const })),
    ])
    await Promise.all(
      queue.map(async ({ id, ratio }) => {
        try {
          const dataUrl = await resizeImage(
            geminiApiKey,
            source.dataUrl,
            sourceRatio,
            ratio,
            generationConfig.modelTier,
          )
          setOutputs((prev) => prev.map((o) => o.id === id ? { ...o, dataUrl, status: 'done' } : o))
        } catch (e: any) {
          setOutputs((prev) => prev.map((o) => o.id === id
            ? { ...o, status: 'error', error: e?.message?.slice(0, 200) || 'Unknown error' }
            : o,
          ))
        }
      }),
    )
  }

  const download = (o: ResizedOutput) => {
    if (!o.dataUrl) return
    const ext = o.dataUrl.includes('image/png') ? 'png' : 'jpg'
    const base = source?.filename.replace(/\.[^.]+$/, '') || 'image'
    saveAs(o.dataUrl, `${base}_${o.ratio.replace(':', 'x')}.${ext}`)
  }

  const reset = () => {
    setSource(null)
    setOutputs([])
    setTargetRatios([])
  }

  const pendingCount = outputs.filter((o) => o.status === 'pending').length
  const canResize = !!source && targetRatios.length > 0 && pendingCount === 0

  return (
    <div className="max-w-5xl mx-auto py-12 px-6 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight mb-1">Resize</h1>
        <p className="text-text-secondary text-sm">
          Reframe any image to a new aspect ratio — text, products, and layout are preserved.
        </p>
      </div>

      {!source ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`glass border-2 border-dashed p-10 text-center transition-all ${
            isDragging ? 'border-text-primary bg-white/60' : 'border-black/[0.08] hover:border-black/[0.12]'
          }`}
        >
          <Upload size={24} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm text-text-secondary mb-1">Drag & drop an image</p>
          <p className="text-xs text-text-muted mb-4">PNG, JPG, WebP — any size</p>
          <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm border border-black/[0.08] bg-white/60 hover:bg-white cursor-pointer transition-all">
            <ImageIcon size={14} />
            Browse
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </label>
        </div>
      ) : (
        <>
          {/* Source */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">Source</p>
              <button
                onClick={reset}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-text-secondary hover:bg-black/[0.04] transition-all"
              >
                <X size={12} />
                Change image
              </button>
            </div>

            <div className="grid grid-cols-[200px_1fr] gap-5 items-start">
              <div className="rounded-2xl overflow-hidden border border-black/[0.06] bg-black/[0.02]">
                <img src={source.dataUrl} alt="Source" className="w-full" />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary truncate" title={source.filename}>
                    {source.filename}
                  </span>
                  <GlassBadge>{source.width}×{source.height}</GlassBadge>
                </div>
                <div>
                  <p className="text-[11px] text-text-muted mb-1.5">Source aspect ratio</p>
                  <div className="flex gap-1.5">
                    {ASPECT_RATIOS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setSourceRatio(value)}
                        className={`px-3 py-1.5 rounded-full text-xs transition-all border ${
                          sourceRatio === value
                            ? 'bg-text-primary text-white border-transparent'
                            : 'bg-white/40 border-black/[0.06] text-text-secondary hover:bg-white/60'
                        }`}
                      >
                        {label} <span className="opacity-60">{value}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Target sizes */}
          <GlassCard>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-4">Resize to</p>
            <div className="grid grid-cols-3 gap-3">
              {ASPECT_RATIOS.map(({ value, label, icon: Icon, desc }) => {
                const isSelected = targetRatios.includes(value)
                const isSource = sourceRatio === value
                return (
                  <button
                    key={value}
                    onClick={() => !isSource && toggleTarget(value)}
                    disabled={isSource}
                    className={`relative flex flex-col items-center justify-center gap-1.5 p-5 rounded-2xl transition-all border-2 ${
                      isSource
                        ? 'bg-black/[0.02] border-black/[0.04] text-text-muted/60 cursor-not-allowed'
                        : isSelected
                          ? 'bg-text-primary text-white border-transparent'
                          : 'bg-white/40 border-black/[0.06] text-text-secondary hover:bg-white/60 hover:border-black/[0.12]'
                    }`}
                  >
                    <Icon size={28} strokeWidth={1.5} />
                    <span className="text-sm font-medium">{label}</span>
                    <span className={`text-[10px] ${isSelected ? 'text-white/60' : 'text-text-muted'}`}>
                      {isSource ? 'source' : desc}
                    </span>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </GlassCard>

          {/* Quality */}
          <GlassCard>
            <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Quality</p>
            <div className="flex gap-2">
              {QUALITY_TIERS.map(({ value, label, desc, tooltip, icon: Icon }) => (
                <div key={value} className="relative flex-1 group">
                  <button
                    onClick={() => setGenerationConfig({ modelTier: value })}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all border ${
                      generationConfig.modelTier === value
                        ? 'bg-text-primary text-white border-transparent'
                        : 'bg-white/40 border-black/[0.06] text-text-secondary hover:bg-white/60'
                    }`}
                  >
                    <Icon size={14} />
                    <div>
                      <p className="font-medium text-xs">{label}</p>
                      <p className="text-[10px] opacity-70">{desc}</p>
                    </div>
                  </button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg text-[10px] leading-snug text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 backdrop-blur-xl bg-white/70 border border-white/40 shadow-lg z-50">
                    {tooltip}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-white/70" />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Resize button */}
          <button
            onClick={runResize}
            disabled={!canResize}
            className={`w-full flex items-center justify-center gap-2 py-4 rounded-full text-sm font-medium transition-all ${
              canResize
                ? 'bg-text-primary text-white hover:bg-accent-hover'
                : 'bg-black/[0.04] text-text-muted cursor-not-allowed'
            }`}
          >
            {pendingCount > 0 ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generating {pendingCount} resize{pendingCount !== 1 ? 's' : ''}…
              </>
            ) : (
              <>
                Resize to {targetRatios.length || 0} format{targetRatios.length !== 1 ? 's' : ''}
              </>
            )}
          </button>

          {/* Outputs */}
          {outputs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-text-muted uppercase tracking-wider">
                  Resized ({outputs.length})
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {outputs.map((o) => (
                  <div key={o.id} className="glass overflow-hidden !p-0">
                    <div className="relative aspect-square flex items-center justify-center bg-black/[0.03]">
                      {o.status === 'pending' && (
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <Loader2 size={22} className="animate-spin" />
                          <span className="text-[11px]">Generating {o.ratio}…</span>
                        </div>
                      )}
                      {o.status === 'done' && o.dataUrl && (
                        <img src={o.dataUrl} alt={o.ratio} className="w-full h-full object-contain" />
                      )}
                      {o.status === 'error' && (
                        <div className="px-4 text-center">
                          <p className="text-xs text-red-600 font-medium">Failed</p>
                          <p className="text-[10px] text-text-muted mt-1">{o.error}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 border-t border-black/[0.06]">
                      <GlassBadge>{o.ratio}</GlassBadge>
                      {o.status === 'done' && (
                        <button
                          onClick={() => download(o)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-text-secondary hover:bg-black/[0.04] transition-all"
                        >
                          <Download size={11} />
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
