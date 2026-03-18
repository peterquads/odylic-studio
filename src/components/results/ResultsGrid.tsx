import { useState, useCallback, useRef, useEffect, useMemo, Fragment } from 'react'
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  X,
  Archive,
  Pencil,
  FileText,
  Heart,
} from 'lucide-react'
import { useStore, selectLatestVersions, selectAllVersions, getGenerationAbort } from '../../store'
import { GlassBadge } from '../layout/GlassCard'
import { downloadSingleImage, downloadAllAsZip } from '../../utils/download'
import { RegionEditor } from './RegionEditor'
import { getModelReport } from '../../services/claude'
import { resizeImage } from '../../services/gemini'
import { generateId } from '../../utils/image'
import type { AspectRatio } from '../../types'

export function ResultsGridPage() {
  const results = useStore((s) => s.results)
  const clearResults = useStore((s) => s.clearResults)
  const removeResults = useStore((s) => s.removeResults)
  const addResult = useStore((s) => s.addResult)
  const brandDna = useStore((s) => s.brandDna)
  const isGenerating = useStore((s) => s.isGenerating)
  const generationProgress = useStore((s) => s.generationProgress)
  const setGenerationProgress = useStore((s) => s.setGenerationProgress)
  const assets = useStore((s) => s.assets)
  const savedAdIds = useStore((s) => s.savedAdIds)
  const toggleSavedAd = useStore((s) => s.toggleSavedAd)
  const hideTemplateReference = useStore((s) => s.hideTemplateReference)
  const geminiApiKey = useStore((s) => s.geminiApiKey)
  const generationConfig = useStore((s) => s.generationConfig)
  const [selectedResult, setSelectedResult] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingResult, setEditingResult] = useState<string | null>(null)
  const [showModelReport, setShowModelReport] = useState(false)
  const [resizingSize, setResizingSize] = useState<string | null>(null)

  // Hover zoom with delay
  const [hoveredImage, setHoveredImage] = useState<{ url: string; x: number; y: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHoverRef = useRef<{ url: string; x: number; y: number } | null>(null)

  const { latestResults, validResults, passedCount, failedCount } = useMemo(() => {
    const latest = selectLatestVersions(results)
    const valid: typeof latest = []
    let passed = 0, failed = 0
    for (const r of latest) {
      if (r.imageUrl) valid.push(r)
      if (r.qaStatus === 'passed') passed++
      else if (r.qaStatus === 'failed') failed++
    }
    return { latestResults: latest, validResults: valid, passedCount: passed, failedCount: failed }
  }, [results])
  const detail = useMemo(() => results.find((r) => r.id === selectedResult), [results, selectedResult])
  const editingAd = useMemo(() => results.find((r) => r.id === editingResult), [results, editingResult])
  const hasSelection = selectedIds.size > 0

  // Arrow key navigation in detail modal
  useEffect(() => {
    if (!selectedResult || editingResult) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const idx = validResults.findIndex((r) => r.id === selectedResult)
        if (idx === -1) return
        const next = e.key === 'ArrowRight'
          ? (idx + 1) % validResults.length
          : (idx - 1 + validResults.length) % validResults.length
        setSelectedResult(validResults[next].id)
      } else if (e.key === 'Escape') {
        setSelectedResult(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedResult, editingResult, validResults])

  const toggleSelect = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = () => setSelectedIds(new Set(validResults.map((r) => r.id)))
  const deselectAll = () => setSelectedIds(new Set())

  const handleBulkDownload = async () => {
    const selected = validResults.filter((r) => selectedIds.has(r.id))
    if (selected.length > 0) await downloadAllAsZip(selected, brandDna?.name || 'ads')
  }

  const handleBulkDelete = () => {
    if (!confirm(`Delete ${selectedIds.size} result${selectedIds.size > 1 ? 's' : ''}?`)) return
    removeResults([...selectedIds])
    setSelectedIds(new Set())
  }

  // Hover zoom with 750ms delay
  const handleMouseEnter = useCallback((e: React.MouseEvent, url: string) => {
    pendingHoverRef.current = { url, x: e.clientX, y: e.clientY }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      if (pendingHoverRef.current) setHoveredImage(pendingHoverRef.current)
    }, 750)
  }, [])

  const handleMouseMoveOnCard = useCallback((e: React.MouseEvent) => {
    if (pendingHoverRef.current) pendingHoverRef.current = { ...pendingHoverRef.current, x: e.clientX, y: e.clientY }
    if (hoveredImage) setHoveredImage((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)
  }, [hoveredImage])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    pendingHoverRef.current = null
    setHoveredImage(null)
  }, [])

  // Cleanup timer on unmount
  useEffect(() => () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current) }, [])

  return (
    <div className="max-w-6xl mx-auto py-12 px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight mb-1">Results</h1>
          <p className="text-text-secondary text-sm">
            {validResults.length} generated
            {passedCount > 0 && <span className="text-success"> · {passedCount} passed</span>}
            {failedCount > 0 && <span className="text-warning"> · {failedCount} flagged</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {validResults.length > 0 && (
            <>
              <button
                onClick={() => setShowModelReport(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium bg-white/60 border border-black/[0.08] text-text-secondary hover:bg-white/80 transition-all"
              >
                <FileText size={14} /> Model Report
              </button>
              <button
                onClick={() => downloadAllAsZip(validResults, brandDna?.name || 'ads')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all"
              >
                <Archive size={14} />
                Download All ({validResults.length})
              </button>
            </>
          )}
          {results.length > 0 && !isGenerating && (
            <button
              onClick={clearResults}
              className="p-2.5 rounded-full text-text-muted hover:text-error hover:bg-error/10 transition-all"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar — shows when items are checked */}
      {hasSelection && (
        <div className="glass !p-3 flex items-center justify-between">
          <span className="text-sm text-text-secondary">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={selectAll} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-black/[0.04]">
              Select All
            </button>
            <button onClick={deselectAll} className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-black/[0.04]">
              Deselect All
            </button>
            <button
              onClick={handleBulkDownload}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium bg-text-primary text-white hover:bg-accent-hover transition-all"
            >
              <Download size={12} /> Download
            </button>
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium bg-error/10 text-error hover:bg-error/20 transition-all"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Progress — visible during generation AND while progress is incomplete */}
      {(isGenerating || (generationProgress.total > 0 && generationProgress.stage)) && (
        <div className="glass !p-4">
          <div className="flex items-center gap-3">
            {isGenerating ? (
              <Loader2 size={16} className="animate-spin text-text-primary" />
            ) : (
              <CheckCircle2 size={16} className="text-success" />
            )}
            <div className="flex-1">
              <div className="flex justify-between text-xs text-text-secondary mb-1.5">
                <span>{generationProgress.stage || 'Starting...'}</span>
                <span>{generationProgress.current}/{generationProgress.total}</span>
              </div>
              <div className="w-full bg-black/[0.04] rounded-full h-1.5">
                <div
                  className="bg-text-primary rounded-full h-1.5 transition-all duration-500"
                  style={{ width: `${generationProgress.total > 0 ? (generationProgress.current / generationProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
            {isGenerating && (
              <button
                onClick={() => {
                  if (window.confirm('Stop generating? Completed ads will be kept.')) {
                    getGenerationAbort()?.abort()
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-black/[0.04] hover:bg-red-50 text-xs text-text-muted hover:text-error transition-colors border border-black/[0.06]"
                title="Cancel generation"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {results.length === 0 && !isGenerating && (
        <div className="text-center py-20 text-text-muted">
          <p className="text-sm">No results yet.</p>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-3 gap-5">
        {latestResults.map((result) => {
          const versionCount = selectAllVersions(results, result.id).length
          const isChecked = selectedIds.has(result.id)
          return (
            <div
              key={result.id}
              className={`glass !p-0 overflow-hidden group cursor-pointer ${isChecked ? 'ring-2 ring-text-primary' : ''}`}
              onClick={() => setSelectedResult(result.id)}
            >
              <div
                className="aspect-square relative bg-white/20"
                onMouseEnter={(e) => result.imageUrl && handleMouseEnter(e, result.imageUrl)}
                onMouseMove={handleMouseMoveOnCard}
                onMouseLeave={handleMouseLeave}
              >
                {result.imageUrl ? (
                  <img src={result.imageUrl} alt="Generated ad" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-error text-xs">Failed</div>
                )}

                {/* Checkbox — always visible on hover (top-left) */}
                <div
                  className={`absolute top-2 left-2 z-10 transition-opacity ${isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  onClick={(e) => toggleSelect(e, result.id)}
                >
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${
                    isChecked
                      ? 'bg-text-primary border-text-primary text-white'
                      : 'bg-white/80 border-black/20 hover:border-black/40'
                  }`}>
                    {isChecked && <CheckCircle2 size={12} />}
                  </div>
                </div>

                {/* Version + aspect badges (top-right) — single version indicator */}
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {versionCount > 1 && <GlassBadge>v{result.version || 1} ({versionCount})</GlassBadge>}
                  <GlassBadge>{result.aspectRatio}</GlassBadge>
                </div>

                {/* QA badge (bottom-left) */}
                <div className="absolute bottom-2 left-2">
                  {result.qaStatus === 'passed' ? (
                    <GlassBadge color="success"><CheckCircle2 size={10} className="mr-0.5" /> Passed</GlassBadge>
                  ) : result.qaStatus === 'failed' ? (
                    <GlassBadge color="warning"><AlertTriangle size={10} className="mr-0.5" /> Flagged</GlassBadge>
                  ) : null}
                </div>

                {/* Quick actions — always visible during generation so re-renders don't kill hover */}
                {isGenerating && result.imageUrl && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5 z-10">
                    <button
                      onClick={(e) => { e.stopPropagation(); downloadSingleImage(result, brandDna?.name || 'ad') }}
                      className="p-1.5 rounded-full bg-white/90 text-text-primary hover:bg-white shadow-sm"
                      title="Download"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSavedAd(result.id) }}
                      className={`p-1.5 rounded-full shadow-sm hover:bg-white transition-colors ${
                        savedAdIds.has(result.id) ? 'bg-red-500/90 text-white' : 'bg-white/90 text-text-primary'
                      }`}
                      title={savedAdIds.has(result.id) ? 'Remove from saved' : 'Save'}
                    >
                      <Heart size={14} fill={savedAdIds.has(result.id) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )}

                {/* Full hover overlay — works normally when not generating */}
                <div className={`absolute inset-0 bg-black/20 transition-opacity flex items-center justify-center gap-3 ${
                  isGenerating ? 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto' : 'opacity-0 group-hover:opacity-100'
                }`}>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (result.imageUrl) downloadSingleImage(result, brandDna?.name || 'ad') }}
                    className="p-2.5 rounded-full bg-white/90 text-text-primary hover:bg-white"
                  >
                    <Download size={16} />
                  </button>
                  {result.imageUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedResult(null); setEditingResult(result.id) }}
                      className="p-2.5 rounded-full bg-white/90 text-text-primary hover:bg-white"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {result.imageUrl && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSavedAd(result.id) }}
                      className={`p-2.5 rounded-full hover:bg-white transition-colors ${
                        savedAdIds.has(result.id)
                          ? 'bg-red-500/90 text-white'
                          : 'bg-white/90 text-text-primary'
                      }`}
                      title={savedAdIds.has(result.id) ? 'Remove from saved' : 'Save'}
                    >
                      <Heart size={16} fill={savedAdIds.has(result.id) ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 flex items-center justify-between">
                <p className="text-[10px] text-text-muted truncate">{result.adName || result.templateFilename}</p>
                {result.retryCount > 0 && <p className="text-[10px] text-warning">{result.retryCount} retries</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hover Zoom Preview (delayed) */}
      {hoveredImage && (
        <div
          className="fixed z-[60] pointer-events-none"
          style={{
            left: hoveredImage.x + 420 > window.innerWidth ? hoveredImage.x - 420 : hoveredImage.x + 20,
            top: Math.max(20, Math.min(hoveredImage.y - 200, window.innerHeight - 420)),
            width: 400,
          }}
        >
          <img src={hoveredImage.url} alt="Preview" className="w-full h-auto rounded-2xl shadow-2xl border border-white/30" />
        </div>
      )}

      {/* Detail Modal */}
      {detail && !editingAd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={() => setSelectedResult(null)}>
          <div className="glass max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-2">
                {detail.qaStatus === 'passed' ? (
                  <GlassBadge color="success"><CheckCircle2 size={10} className="mr-0.5" /> Passed</GlassBadge>
                ) : (
                  <GlassBadge color="warning"><AlertTriangle size={10} className="mr-0.5" /> Flagged</GlassBadge>
                )}
                <GlassBadge>{detail.aspectRatio}</GlassBadge>
                {(detail.version || 1) > 1 && <GlassBadge>v{detail.version}</GlassBadge>}
                {detail.retryCount > 0 && <GlassBadge color="warning">{detail.retryCount} retries</GlassBadge>}
                {detail.strategyAngle && <GlassBadge>{detail.strategyAngle}</GlassBadge>}
                {detail.modelUsed && <GlassBadge>{detail.modelUsed}</GlassBadge>}
              </div>
              <button onClick={() => setSelectedResult(null)} className="p-1 rounded-lg hover:bg-black/[0.04]">
                <X size={16} />
              </button>
            </div>

            <div className={`${hideTemplateReference ? '' : 'grid grid-cols-2 gap-4'} mb-4`}>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Generated</p>
                {detail.imageUrl ? (
                  <img src={detail.imageUrl} alt="Generated ad" className={`w-full rounded-2xl ${hideTemplateReference ? 'max-h-[80vh] object-contain mx-auto' : ''}`} />
                ) : (
                  <div className="aspect-square rounded-2xl bg-white/20 flex items-center justify-center text-error text-sm">Failed</div>
                )}
              </div>
              {!hideTemplateReference && (
                <div>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Template Reference</p>
                  {detail.templateImageUrl ? (
                    <img
                      src={detail.templateImageUrl}
                      alt={`Template: ${detail.templateFilename}`}
                      className="w-full rounded-2xl"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <div className="aspect-square rounded-2xl bg-white/20 flex items-center justify-center text-text-muted text-xs">
                      {detail.templateFilename}
                    </div>
                  )}
                </div>
              )}
            </div>

            {detail.qa?.concerns && (
              <div className="bg-warning/10 border border-warning/20 rounded-2xl p-3 mb-4">
                <p className="text-xs text-warning font-medium mb-1">QA Concerns</p>
                <p className="text-xs text-text-secondary">{detail.qa.concerns}</p>
              </div>
            )}

            {detail.assetsUsed && detail.assetsUsed.length > 0 && (
              <div className="mb-4">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Assets Used</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.assetsUsed.map((name, i) => (
                    <span key={i} className="text-[10px] px-2 py-1 rounded-lg bg-black/[0.04] text-text-secondary">{name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Concept siblings — other sizes of the same ad */}
            {(() => {
              const siblings = detail.conceptId
                ? results.filter(r => r.conceptId === detail.conceptId && r.id !== detail.id && r.imageUrl)
                : []
              const ALL_SIZES: AspectRatio[] = ['1:1', '3:4', '9:16']
              const existingSizes = new Set(
                detail.conceptId
                  ? results.filter(r => r.conceptId === detail.conceptId).map(r => r.aspectRatio)
                  : [detail.aspectRatio]
              )
              const missingSizes = ALL_SIZES.filter(s => !existingSizes.has(s))

              return (
                <>
                  {siblings.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Other sizes</p>
                      <div className="flex gap-2">
                        {siblings.map(sib => (
                          <button
                            key={sib.id}
                            onClick={() => setSelectedResult(sib.id)}
                            className="relative w-16 h-16 rounded-lg overflow-hidden border border-black/[0.08] hover:border-black/20 transition-all"
                          >
                            <img src={sib.imageUrl} alt={sib.aspectRatio} loading="lazy" className="w-full h-full object-cover" />
                            <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/60 text-white px-1 rounded">
                              {sib.aspectRatio}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {missingSizes.length > 0 && detail.imageUrl && detail.prompt && (
                    <div className="mb-4">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Generate size</p>
                      <div className="flex gap-1.5">
                        {missingSizes.map(size => (
                          <button
                            key={size}
                            onClick={async () => {
                              if (resizingSize) return
                              setResizingSize(size)
                              const cid = detail.conceptId || generateId()
                              if (!detail.conceptId) {
                                useStore.getState().updateResult(detail.id, { conceptId: cid })
                              }
                              setGenerationProgress({ current: 0, total: 1, stage: `Resizing to ${size}...` })
                              console.log(`[RESULTS] Resize: ${detail.aspectRatio} → ${size}`)
                              try {
                                const imageUrl = await resizeImage(
                                  geminiApiKey, detail.imageUrl, detail.aspectRatio,
                                  size, generationConfig.modelTier,
                                )
                                addResult({
                                  id: generateId(),
                                  imageUrl,
                                  templateFilename: detail.templateFilename,
                                  templateImageUrl: detail.templateImageUrl,
                                  assetsUsed: detail.assetsUsed,
                                  aspectRatio: size,
                                  prompt: detail.prompt,
                                  qa: null,
                                  qaStatus: 'skipped',
                                  retryCount: 0,
                                  timestamp: Date.now(),
                                  version: 1,
                                  conceptId: cid,
                                  formatType: detail.formatType,
                                  strategyAngle: detail.strategyAngle,
                                  strategyConcept: detail.strategyConcept,
                                  adName: detail.adName,
                                })
                                setGenerationProgress({ current: 1, total: 1, stage: 'Done!' })
                              } catch (e) {
                                console.error(`Resize to ${size} failed:`, e)
                              }
                              setTimeout(() => setGenerationProgress({ current: 0, total: 0, stage: '' }), 3000)
                              setResizingSize(null)
                            }}
                            disabled={!!resizingSize}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                              resizingSize === size
                                ? 'bg-black/[0.08] text-text-primary'
                                : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.08]'
                            } disabled:opacity-50`}
                          >
                            {resizingSize === size ? (
                              <><Loader2 size={10} className="animate-spin" /> {size}</>
                            ) : (
                              size
                            )}
                          </button>
                        ))}
                        {missingSizes.length > 1 && (
                          <button
                            onClick={async () => {
                              if (resizingSize) return
                              setResizingSize('all')
                              const cid = detail.conceptId || generateId()
                              if (!detail.conceptId) {
                                useStore.getState().updateResult(detail.id, { conceptId: cid })
                              }
                              for (let i = 0; i < missingSizes.length; i++) {
                                const size = missingSizes[i]
                                setGenerationProgress({ current: i, total: missingSizes.length, stage: `Resizing to ${size}...` })
                                console.log(`[RESULTS] Resize: ${detail.aspectRatio} → ${size}`)
                                try {
                                  const imageUrl = await resizeImage(
                                    geminiApiKey, detail.imageUrl, detail.aspectRatio,
                                    size, generationConfig.modelTier,
                                  )
                                  addResult({
                                    id: generateId(),
                                    imageUrl,
                                    templateFilename: detail.templateFilename,
                                    templateImageUrl: detail.templateImageUrl,
                                    assetsUsed: detail.assetsUsed,
                                    aspectRatio: size,
                                    prompt: detail.prompt,
                                    qa: null,
                                    qaStatus: 'skipped',
                                    retryCount: 0,
                                    timestamp: Date.now(),
                                    version: 1,
                                    conceptId: cid,
                                    formatType: detail.formatType,
                                    strategyAngle: detail.strategyAngle,
                                    strategyConcept: detail.strategyConcept,
                                    adName: detail.adName,
                                  })
                                } catch (e) {
                                  console.error(`Resize to ${size} failed:`, e)
                                }
                              }
                              setGenerationProgress({ current: missingSizes.length, total: missingSizes.length, stage: 'Done!' })
                              setTimeout(() => setGenerationProgress({ current: 0, total: 0, stage: '' }), 3000)
                              setResizingSize(null)
                            }}
                            disabled={!!resizingSize}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                              resizingSize === 'all'
                                ? 'bg-black/[0.08] text-text-primary'
                                : 'bg-black/[0.04] text-text-secondary hover:bg-black/[0.08]'
                            } disabled:opacity-50`}
                          >
                            {resizingSize === 'all' ? (
                              <><Loader2 size={10} className="animate-spin" /> All</>
                            ) : (
                              'All'
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {missingSizes.length === 0 && detail.conceptId && (
                    <div className="mb-4 py-2 rounded-full text-xs font-medium text-success/70 text-center flex items-center justify-center gap-1.5">
                      <CheckCircle2 size={12} /> All sizes generated
                    </div>
                  )}
                </>
              )
            })()}

            <details className="mb-4">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">View Prompt</summary>
              <pre className="text-xs text-text-muted bg-white/40 rounded-2xl p-3 mt-2 whitespace-pre-wrap font-mono border border-black/[0.04]">
                {detail.prompt}
              </pre>
            </details>

            <div className="flex gap-2">
              <button
                onClick={() => { if (detail.imageUrl) downloadSingleImage(detail, brandDna?.name || 'ad') }}
                className="flex-1 py-3 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all flex items-center justify-center gap-2"
              >
                <Download size={14} /> Download
              </button>
              {detail.imageUrl && (
                <button
                  onClick={() => { setSelectedResult(null); setEditingResult(detail.id) }}
                  className="flex-1 py-3 rounded-full text-sm font-medium bg-white/60 border border-black/[0.08] text-text-primary hover:bg-white/80 transition-all flex items-center justify-center gap-2"
                >
                  <Pencil size={14} /> Edit Regions
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Region Editor */}
      {editingAd && (
        <RegionEditor
          ad={editingAd}
          assets={assets}
          onClose={() => setEditingResult(null)}
          onSave={(newAd) => {
            addResult(newAd)
            setEditingResult(null)
          }}
        />
      )}

      {/* Model Report Modal */}
      {showModelReport && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 flex items-center justify-center p-6" onClick={() => setShowModelReport(false)}>
          <div className="glass max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-display text-xl font-medium">Model Usage Report</h2>
              <button onClick={() => setShowModelReport(false)} className="p-1 rounded-lg hover:bg-black/[0.04]">
                <X size={16} />
              </button>
            </div>
            <ModelReport />
          </div>
        </div>
      )}
    </div>
  )
}

// Model usage report component — polls for updates while visible
function ModelReport() {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    // Force re-render every 1.5s — always increment to guarantee state change
    const interval = setInterval(() => forceUpdate(n => n + 1), 1500)
    return () => clearInterval(interval)
  }, [])

  const report = getModelReport()
  if (report.length === 0) {
    return <p className="text-sm text-text-muted">No model usage data yet. Generate some ads first.</p>
  }

  const totalCalls = report.reduce((sum, e) => sum + e.count, 0)

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">{totalCalls} total API calls</p>
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-text-muted font-medium uppercase tracking-wider">Step</span>
        <span className="text-text-muted font-medium uppercase tracking-wider">Model</span>
        <span className="text-text-muted font-medium uppercase tracking-wider">Calls</span>
        {report.map((entry, i) => (
          <Fragment key={i}>
            <span className="text-text-secondary">{entry.tier}</span>
            <span className="font-mono text-text-primary">{entry.model}</span>
            <span className="text-text-secondary text-right">{entry.count}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

