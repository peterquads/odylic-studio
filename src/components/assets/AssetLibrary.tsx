import { useState, useCallback } from 'react'
import {
  Upload,
  X,
  Image as ImageIcon,
  Loader2,
  ArrowRight,
  Palette,
  Tag,
  AlertTriangle,
  RefreshCw,
  Search,
  Plus,
  Check,
} from 'lucide-react'
import { useStore } from '../../store'
import { GlassBadge } from '../layout/GlassCard'
import { analyzeAssetsBatch, analyzeAsset } from '../../services/claude'
import { webImageSearch, fetchImageAsBase64 } from '../../services/scraper'
import { fileToBase64, generateId, detectMediaType } from '../../utils/image'
import type { UploadedAsset, AssetType } from '../../types'

const MAX_FILE_SIZE_MB = 10
const COMPRESS_THRESHOLD_MB = 4 // Auto-compress above this (Gemini limit is ~5MB per image)

/** Compress an image file by re-encoding via canvas at reduced quality/size */
async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Scale down if very large (max 2048px on longest side)
      const maxDim = 2048
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      // JPEG at 0.85 quality keeps good detail while staying under 5MB
      const base64 = canvas.toDataURL('image/jpeg', 0.85)
      resolve({ base64, mimeType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image for compression')) }
    img.src = url
  })
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  product_on_white: 'Product',
  lifestyle: 'Lifestyle',
  logo: 'Logo',
  modeled_product: 'Modeled',
  packaging: 'Packaging',
  texture_pattern: 'Texture',
  icon: 'Icon',
  document: 'Document',
  unknown: 'Unknown',
}

export function AssetLibraryPage() {
  const { assets, addAsset, updateAsset, removeAsset, claudeApiKey, brandDna, setStep } = useStore()
  const [isDragging, setIsDragging] = useState(false)
  const [filterType, setFilterType] = useState<AssetType | 'all'>('all')
  const [selectedAsset, setSelectedAsset] = useState<UploadedAsset | null>(null)
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([])
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())
  const [imageQuery, setImageQuery] = useState('')
  const [imageSearchResults, setImageSearchResults] = useState<string[]>([])
  const [imageSearching, setImageSearching] = useState(false)
  const [downloadingImages, setDownloadingImages] = useState<Set<string>>(new Set())
  const [downloadedImages, setDownloadedImages] = useState<Set<string>>(new Set())

  const handleRetryAnalysis = async (asset: UploadedAsset) => {
    setRetryingIds((prev) => new Set([...prev, asset.id]))
    updateAsset(asset.id, { analysisStatus: 'pending' })
    const brandCtx = brandDna ? `${brandDna.name} (${brandDna.category}). ${brandDna.description}` : undefined
    try {
      const analysis = await analyzeAsset(claudeApiKey, asset, brandCtx)
      updateAsset(asset.id, { analysis, analysisStatus: 'complete' })
    } catch {
      updateAsset(asset.id, { analysisStatus: 'error' })
    } finally {
      setRetryingIds((prev) => { const s = new Set(prev); s.delete(asset.id); return s })
    }
  }

  const handleImageSearch = async () => {
    if (!imageQuery.trim()) return
    setImageSearching(true)
    setImageSearchResults([])
    setDownloadedImages(new Set())
    try {
      const results = await webImageSearch(imageQuery.trim(), 20)
      setImageSearchResults(results)
    } catch (e) {
      console.error('Image search failed:', e)
    } finally {
      setImageSearching(false)
    }
  }

  const handleDownloadSearchImage = async (imgUrl: string) => {
    setDownloadingImages((prev) => new Set([...prev, imgUrl]))
    try {
      const base64 = await fetchImageAsBase64(imgUrl)
      if (base64) {
        const name = imgUrl.split('/').pop()?.split('?')[0]?.slice(0, 60) || 'image.jpg'
        const mimeType = detectMediaType(base64)
        const asset: UploadedAsset = {
          id: generateId(), name, mimeType,
          base64, analysisStatus: 'pending', source: 'scraped',
        }
        addAsset(asset)
        setDownloadedImages((prev) => new Set([...prev, imgUrl]))
        // Analyze the new asset
        const brandCtx = brandDna ? `${brandDna.name} (${brandDna.category}). ${brandDna.description}` : undefined
        analyzeAsset(claudeApiKey, asset, brandCtx).then((analysis) => {
          if (analysis) updateAsset(asset.id, { analysis, analysisStatus: 'complete' })
          else updateAsset(asset.id, { analysisStatus: 'error' })
        })
      }
    } catch (e) {
      console.error('Failed to download image:', e)
    } finally {
      setDownloadingImages((prev) => { const s = new Set(prev); s.delete(imgUrl); return s })
    }
  }

  const handleFiles = useCallback(
    async (files: FileList) => {
      const newAssets: UploadedAsset[] = []
      const warnings: string[] = []

      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue

        const sizeMB = file.size / (1024 * 1024)

        // Reject files over hard limit
        if (sizeMB > MAX_FILE_SIZE_MB) {
          warnings.push(`${file.name} skipped (${sizeMB.toFixed(1)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit)`)
          continue
        }

        let base64: string
        let mimeType = file.type

        // SVG files: rasterize to PNG via canvas (AI models can't process SVGs)
        if (file.type === 'image/svg+xml') {
          try {
            const svgUrl = URL.createObjectURL(file)
            base64 = await new Promise<string>((resolve, reject) => {
              const img = new Image()
              img.onload = () => {
                URL.revokeObjectURL(svgUrl)
                const w = Math.max(img.naturalWidth || 400, 400)
                const h = Math.max(img.naturalHeight || 200, Math.round(w * ((img.naturalHeight || 200) / (img.naturalWidth || 400))))
                const canvas = document.createElement('canvas')
                canvas.width = w; canvas.height = h
                const ctx = canvas.getContext('2d')!
                ctx.fillStyle = '#FFFFFF'
                ctx.fillRect(0, 0, w, h)
                ctx.drawImage(img, 0, 0, w, h)
                resolve(canvas.toDataURL('image/png'))
              }
              img.onerror = () => { URL.revokeObjectURL(svgUrl); reject(new Error('SVG load failed')) }
              setTimeout(() => { URL.revokeObjectURL(svgUrl); reject(new Error('SVG timeout')) }, 5000)
              img.src = svgUrl
            })
            mimeType = 'image/png'
          } catch {
            warnings.push(`${file.name} skipped (SVG rasterization failed)`)
            continue
          }
        }
        // Auto-compress large files to stay under Gemini's ~5MB limit
        else if (sizeMB > COMPRESS_THRESHOLD_MB) {
          try {
            const compressed = await compressImage(file)
            base64 = compressed.base64
            mimeType = compressed.mimeType
            warnings.push(`${file.name} auto-compressed (${sizeMB.toFixed(1)}MB → smaller)`)
          } catch {
            base64 = await fileToBase64(file)
          }
        } else {
          base64 = await fileToBase64(file)
        }

        const asset: UploadedAsset = {
          id: generateId(), name: file.name, mimeType,
          base64, analysisStatus: 'pending', source: 'upload',
        }
        addAsset(asset)
        newAssets.push(asset)
      }

      if (warnings.length) setUploadWarnings(warnings)
      // Analyze in parallel batches of 3
      if (newAssets.length > 0) {
        const brandCtx = brandDna ? `${brandDna.name} (${brandDna.category}). ${brandDna.description}${brandDna.packagingDetails?.physicalDescription ? `. Packaging: ${brandDna.packagingDetails.physicalDescription}` : ''}` : undefined
        analyzeAssetsBatch(claudeApiKey, newAssets, (id, analysis) => {
          if (analysis) {
            updateAsset(id, { analysis, analysisStatus: 'complete' })
          } else {
            updateAsset(id, { analysisStatus: 'error' })
          }
        }, 3, brandCtx)
      }
    },
    [addAsset, updateAsset, claudeApiKey]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const filtered = assets.filter((a) => {
    if (filterType !== 'all' && a.analysis?.assetType !== filterType) return false
    return true
  })

  const typeCounts = assets.reduce((acc, a) => {
    const t = a.analysis?.assetType || 'unknown'
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const pendingCount = assets.filter((a) => a.analysisStatus === 'pending').length

  return (
    <div className="max-w-5xl mx-auto py-12 px-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight mb-1">Assets</h1>
          <p className="text-text-secondary text-sm">
            {assets.length} assets{pendingCount > 0 && ` · ${pendingCount} analyzing...`}
          </p>
        </div>
        <button
          onClick={() => setStep('generate')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all"
        >
          Generate <ArrowRight size={14} />
        </button>
      </div>

      {/* Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`glass border-2 border-dashed p-10 text-center transition-all ${
          isDragging ? 'border-text-primary bg-white/60' : 'border-black/[0.08] hover:border-black/[0.12]'
        }`}
      >
        <Upload size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm text-text-secondary mb-1">Drag & drop images</p>
        <p className="text-xs text-text-muted mb-4">Product photos, logos, lifestyle</p>
        <label className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm border border-black/[0.08] bg-white/60 hover:bg-white cursor-pointer transition-all">
          <ImageIcon size={14} />
          Browse
          <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </label>
      </div>

      {/* Image Search */}
      <div className="glass p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-text-muted" />
          <span className="text-sm font-medium text-text-primary">Search Images</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); handleImageSearch() }} className="flex gap-2">
          <input
            type="text"
            value={imageQuery}
            onChange={(e) => setImageQuery(e.target.value)}
            placeholder="e.g. Nike running shoes product photo"
            className="flex-1 px-3 py-2 rounded-xl text-sm border border-black/[0.08] bg-white/60 focus:outline-none focus:border-black/[0.15] placeholder:text-text-muted/60"
          />
          <button
            type="submit"
            disabled={imageSearching || !imageQuery.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all disabled:opacity-40"
          >
            {imageSearching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
          </button>
        </form>
        {imageSearchResults.length > 0 && (
          <div className="grid grid-cols-5 gap-2">
            {imageSearchResults.map((url) => {
              const isDownloading = downloadingImages.has(url)
              const isDownloaded = downloadedImages.has(url)
              return (
                <div key={url} className="relative group aspect-square rounded-lg overflow-hidden border border-black/[0.06] bg-white/40">
                  <img
                    src={`https://wsrv.nl/?url=${encodeURIComponent(url)}&w=200&h=200&fit=cover&q=70`}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <button
                    onClick={() => !isDownloading && !isDownloaded && handleDownloadSearchImage(url)}
                    disabled={isDownloading || isDownloaded}
                    className={`absolute inset-0 flex items-center justify-center transition-all ${
                      isDownloaded
                        ? 'bg-green-500/30'
                        : isDownloading
                          ? 'bg-black/30'
                          : 'bg-black/0 hover:bg-black/30 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {isDownloaded ? (
                      <Check size={20} className="text-white" />
                    ) : isDownloading ? (
                      <Loader2 size={20} className="text-white animate-spin" />
                    ) : (
                      <Plus size={20} className="text-white" />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upload Warnings */}
      {uploadWarnings.length > 0 && (
        <div className="glass !bg-amber-50/80 border border-amber-200/50 p-3 space-y-1">
          {uploadWarnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 flex items-center gap-1.5">
              <AlertTriangle size={11} className="flex-shrink-0" /> {w}
            </p>
          ))}
          <button onClick={() => setUploadWarnings([])} className="text-[10px] text-amber-600 hover:text-amber-800 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Filters */}
      {assets.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filterType === 'all' ? 'bg-text-primary text-white' : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.06]'
            }`}
          >
            All ({assets.length})
          </button>
          {Object.entries(typeCounts).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilterType(type as AssetType)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterType === type ? 'bg-text-primary text-white' : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.06]'
              }`}
            >
              {ASSET_TYPE_LABELS[type as AssetType] || type} ({count})
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-4 gap-4">
        {filtered.map((asset) => (
          <div key={asset.id} className="glass !p-0 overflow-hidden group cursor-pointer" onClick={() => setSelectedAsset(asset)}>
            <div className="aspect-square relative">
              <img src={asset.base64} alt={asset.name} className="w-full h-full object-cover" />
              <button
                onClick={(e) => { e.stopPropagation(); removeAsset(asset.id) }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={11} />
              </button>
              {asset.analysisStatus === 'pending' && (
                <div className="absolute inset-0 bg-white/50 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-text-primary" />
                </div>
              )}
              {asset.analysisStatus === 'error' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRetryAnalysis(asset) }}
                  disabled={retryingIds.has(asset.id)}
                  className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/90 text-white text-[10px] font-medium hover:bg-amber-600 transition-colors"
                >
                  {retryingIds.has(asset.id) ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                  Retry
                </button>
              )}
            </div>
            <div className="p-3">
              <p className="text-xs truncate text-text-secondary mb-1.5">{asset.name}</p>
              {asset.analysis && (
                <div className="flex flex-wrap gap-1">
                  <GlassBadge color="accent">{ASSET_TYPE_LABELS[asset.analysis.assetType]}</GlassBadge>
                  {asset.analysis.productionStyle && asset.analysis.productionStyle !== 'N/A' && (
                    <GlassBadge>{asset.analysis.productionStyle}</GlassBadge>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={() => setSelectedAsset(null)}>
          <div className="glass max-w-4xl w-full max-h-[85vh] overflow-hidden !p-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex">
              <div className="w-1/2 flex-shrink-0 bg-white/20">
                <img src={selectedAsset.base64} alt={selectedAsset.name} className="w-full h-full object-contain" />
              </div>
              <div className="w-1/2 p-6 space-y-4 overflow-y-auto max-h-[85vh]">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium truncate">{selectedAsset.name}</p>
                  <button onClick={() => setSelectedAsset(null)} className="p-1 rounded-lg hover:bg-black/[0.04]"><X size={16} /></button>
                </div>

                {selectedAsset.analysis ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      <GlassBadge color="accent">{ASSET_TYPE_LABELS[selectedAsset.analysis.assetType]}</GlassBadge>
                      {selectedAsset.analysis.productionStyle && selectedAsset.analysis.productionStyle !== 'N/A' && <GlassBadge>{selectedAsset.analysis.productionStyle}</GlassBadge>}
                      {selectedAsset.analysis.productionQuality && <GlassBadge color={selectedAsset.analysis.productionQuality === 'High' ? 'success' : 'default'}>{selectedAsset.analysis.productionQuality}</GlassBadge>}
                      {selectedAsset.analysis.funnelPosition && selectedAsset.analysis.funnelPosition !== 'Unknown' && <GlassBadge color="warning">{selectedAsset.analysis.funnelPosition}</GlassBadge>}
                    </div>

                    <div>
                      <p className="text-xs text-text-muted uppercase mb-1">Description</p>
                      <p className="text-sm text-text-secondary">{selectedAsset.analysis.description}</p>
                    </div>

                    {selectedAsset.analysis.angle && (
                      <div>
                        <p className="text-xs text-text-muted uppercase mb-1">Strategy</p>
                        <div className="space-y-1 text-sm text-text-secondary">
                          {selectedAsset.analysis.angle && <p><span className="text-text-muted">Angle:</span> {selectedAsset.analysis.angle}</p>}
                          {selectedAsset.analysis.hook && <p><span className="text-text-muted">Hook:</span> {selectedAsset.analysis.hook}</p>}
                          {selectedAsset.analysis.concept && <p><span className="text-text-muted">Concept:</span> {selectedAsset.analysis.concept}</p>}
                        </div>
                      </div>
                    )}

                    {(selectedAsset.analysis.headline || selectedAsset.analysis.cta) && (
                      <div>
                        <p className="text-xs text-text-muted uppercase mb-1">Copy</p>
                        <div className="space-y-1 text-sm text-text-secondary">
                          {selectedAsset.analysis.headline && <p>"{selectedAsset.analysis.headline}"</p>}
                          {selectedAsset.analysis.cta && <p className="text-text-muted">CTA: "{selectedAsset.analysis.cta}"</p>}
                        </div>
                      </div>
                    )}

                    {selectedAsset.analysis.dominantColors?.length > 0 && (
                      <div>
                        <p className="text-xs text-text-muted uppercase mb-1"><Palette size={10} className="inline mr-1" />Colors</p>
                        <div className="flex gap-2">
                          {selectedAsset.analysis.dominantColors.map((c, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: c }} />
                              <span className="text-xs text-text-muted font-mono">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedAsset.analysis.tags && selectedAsset.analysis.tags.length > 0 && (
                      <div>
                        <p className="text-xs text-text-muted uppercase mb-1"><Tag size={10} className="inline mr-1" />Tags</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedAsset.analysis.tags.map((tag, i) => <GlassBadge key={i}>{tag}</GlassBadge>)}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-text-muted">
                    {selectedAsset.analysisStatus === 'pending' ? 'Analyzing...' : 'Not analyzed'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
