import { useState, useRef, useCallback } from 'react'
import { X, Trash2, Loader2 } from 'lucide-react'
import { editImage } from '../../services/gemini'
import { buildEditPrompt } from '../../services/claude'
import { useStore } from '../../store'
import type { GeneratedAd, UploadedAsset } from '../../types'

interface EditRegion {
  id: string
  x: number
  y: number
  width: number
  height: number
  instruction: string
}

const REGION_COLORS = [
  'rgba(99, 102, 241, 0.3)',   // indigo
  'rgba(236, 72, 153, 0.3)',   // pink
  'rgba(34, 197, 94, 0.3)',    // green
  'rgba(251, 146, 60, 0.3)',   // orange
  'rgba(56, 189, 248, 0.3)',   // sky
]

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

interface Props {
  ad: GeneratedAd
  assets?: UploadedAsset[]
  onClose: () => void
  onSave: (newAd: GeneratedAd) => void
}


export function RegionEditor({ ad, assets = [], onClose, onSave }: Props) {
  const { geminiApiKey, claudeApiKey, brandDna } = useStore()
  const [regions, setRegions] = useState<EditRegion[]>([])
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use refs for drawing state to avoid stale closures in pointer events
  const drawingRef = useRef(false)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const getRelativePos = useCallback((e: React.MouseEvent | PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isEditing) return
    e.preventDefault()
    // Capture pointer for smooth drag even outside element
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const pos = getRelativePos(e)
    drawingRef.current = true
    drawStartRef.current = pos
    setDrawPreview({ x: pos.x, y: pos.y, w: 0, h: 0 })
  }, [getRelativePos, isEditing])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || !drawStartRef.current) return
    const pos = getRelativePos(e)
    const start = drawStartRef.current
    setDrawPreview({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      w: Math.abs(pos.x - start.x),
      h: Math.abs(pos.y - start.y),
    })
  }, [getRelativePos])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drawingRef.current || !drawStartRef.current) return
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    drawingRef.current = false

    const pos = getRelativePos(e)
    const start = drawStartRef.current
    const x = Math.min(start.x, pos.x)
    const y = Math.min(start.y, pos.y)
    const width = Math.abs(pos.x - start.x)
    const height = Math.abs(pos.y - start.y)

    drawStartRef.current = null
    setDrawPreview(null)

    // Ignore tiny accidental clicks
    if (width < 2 || height < 2) return

    setRegions((prev) => [...prev, {
      id: generateId(),
      x, y, width, height,
      instruction: '',
    }])
  }, [getRelativePos])

  const removeRegion = (id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id))
  }

  const updateInstruction = (id: string, instruction: string) => {
    setRegions((prev) => prev.map((r) => r.id === id ? { ...r, instruction } : r))
  }

  const generateMask = async (): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!

        // Black background (keep)
        ctx.fillStyle = 'black'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // White regions (edit)
        ctx.fillStyle = 'white'
        for (const region of regions) {
          const rx = (region.x / 100) * canvas.width
          const ry = (region.y / 100) * canvas.height
          const rw = (region.width / 100) * canvas.width
          const rh = (region.height / 100) * canvas.height
          ctx.fillRect(rx, ry, rw, rh)
        }

        resolve(canvas.toDataURL('image/png'))
      }
      img.src = ad.imageUrl
    })
  }

  const handleRegenerate = async () => {
    const validRegions = regions.filter((r) => r.instruction.trim())
    if (validRegions.length === 0) {
      setError('Add instructions to at least one region')
      return
    }

    setIsEditing(true)
    setError(null)

    try {
      const mask = await generateMask()
      const rawInstructions = validRegions
        .map((r, i) => `Region ${i + 1}: ${r.instruction}`)
        .join('. ')

      // Stage 1: Sonnet interprets instructions and picks assets to attach
      let editPrompt = rawInstructions
      let referenceImages: { base64: string; mimeType: string }[] | undefined

      if (brandDna && claudeApiKey) {
        try {
          const result = await buildEditPrompt(
            claudeApiKey, rawInstructions, ad.imageUrl, assets, brandDna
          )
          editPrompt = result.prompt
          // Gather the referenced assets
          if (result.assetIds?.length) {
            referenceImages = result.assetIds
              .map(id => assets.find(a => a.id === id))
              .filter((a): a is UploadedAsset => !!a?.base64)
              .map(a => ({ base64: a.base64, mimeType: a.mimeType }))
          }
        } catch (e) {
          console.warn('Sonnet edit prompt failed, using raw instructions:', e)
          // Fallback: if user mentions product/logo, attach all product assets
          const assetRefPattern = /\b(product|logo|real|actual|original|brand)\b/i
          if (assetRefPattern.test(rawInstructions)) {
            referenceImages = assets
              .filter(a => a.base64 && a.analysis?.assetType !== 'unknown')
              .slice(0, 4)
              .map(a => ({ base64: a.base64, mimeType: a.mimeType }))
          }
        }
      }

      // Stage 2: Gemini executes the edit with real images attached
      const newImageUrl = await editImage(
        geminiApiKey,
        ad.imageUrl,
        mask,
        editPrompt,
        referenceImages,
      )

      const newAd: GeneratedAd = {
        id: generateId(),
        imageUrl: newImageUrl,
        templateFilename: ad.templateFilename,
        templateImageUrl: ad.templateImageUrl,
        assetsUsed: ad.assetsUsed,
        aspectRatio: ad.aspectRatio,
        prompt: `${ad.prompt}\n\n[EDITED: ${editPrompt}]`,
        qa: null,
        qaStatus: 'skipped',
        retryCount: 0,
        timestamp: Date.now(),
        version: (ad.version || 1) + 1,
        parentId: ad.id,
        conceptId: ad.conceptId,
        formatType: ad.formatType,
        strategyAngle: ad.strategyAngle,
        strategyConcept: ad.strategyConcept,
        adName: ad.adName,
      }

      onSave(newAd)
    } catch (e: any) {
      setError(e.message || 'Edit failed')
    } finally {
      setIsEditing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md z-50 flex items-center justify-center p-6">
      <div className="glass max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="font-display text-xl font-medium">Edit Regions</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Draw rectangles on areas you want to edit, then add instructions for each region.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/[0.04]">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_300px] gap-4">
          {/* Image canvas — uses pointer events for reliable drag */}
          <div
            ref={containerRef}
            className="relative rounded-2xl overflow-hidden cursor-crosshair select-none touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <img src={ad.imageUrl} alt="Edit" className="w-full h-auto block" draggable={false} />

            {/* Drawn regions */}
            {regions.map((region, i) => (
              <div
                key={region.id}
                className="absolute border-2 border-dashed pointer-events-none"
                style={{
                  left: `${region.x}%`,
                  top: `${region.y}%`,
                  width: `${region.width}%`,
                  height: `${region.height}%`,
                  backgroundColor: REGION_COLORS[i % REGION_COLORS.length],
                  borderColor: REGION_COLORS[i % REGION_COLORS.length].replace('0.3', '0.8'),
                }}
              >
                <span className="absolute -top-5 left-0 text-[10px] font-bold text-white bg-black/60 px-1.5 rounded">
                  {i + 1}
                </span>
              </div>
            ))}

            {/* Drawing preview */}
            {drawPreview && drawPreview.w > 0 && (
              <div
                className="absolute border-2 border-dashed border-white/60 bg-white/20 pointer-events-none"
                style={{
                  left: `${drawPreview.x}%`,
                  top: `${drawPreview.y}%`,
                  width: `${drawPreview.w}%`,
                  height: `${drawPreview.h}%`,
                }}
              />
            )}
          </div>

          {/* Region instructions panel */}
          <div className="space-y-3">
            <p className="text-xs text-text-muted uppercase tracking-wider">Regions ({regions.length})</p>

            {regions.length === 0 && (
              <p className="text-xs text-text-muted py-8 text-center">
                Click and drag on the image to select a region to edit.
              </p>
            )}

            {regions.map((region, i) => (
              <div
                key={region.id}
                className="rounded-xl border border-black/[0.06] p-3 space-y-2"
                style={{ borderLeftColor: REGION_COLORS[i % REGION_COLORS.length].replace('0.3', '0.6'), borderLeftWidth: 3 }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">Region {i + 1}</span>
                  <button onClick={() => removeRegion(region.id)} className="p-1 rounded hover:bg-error/10 text-text-muted hover:text-error">
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  value={region.instruction}
                  onChange={(e) => updateInstruction(region.id, e.target.value)}
                  placeholder="What should change here... (you can reference 'product image', 'logo', etc.)"
                  className="w-full text-xs bg-white/40 border border-black/[0.06] rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-text-primary/20"
                  rows={2}
                  autoFocus={i === regions.length - 1}
                />
              </div>
            ))}

            {error && (
              <p className="text-xs text-error">{error}</p>
            )}

            <button
              onClick={handleRegenerate}
              disabled={isEditing || regions.length === 0}
              className="w-full py-3 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isEditing ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Editing...
                </>
              ) : (
                'Regenerate'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
