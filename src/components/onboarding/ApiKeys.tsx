import { useState, useRef } from 'react'
import { KeyRound, ArrowRight, Loader2, CheckCircle2, AlertTriangle, ChevronDown, X, Upload } from 'lucide-react'
import { useStore } from '../../store'
import { GlassCard } from '../layout/GlassCard'
import { generateId } from '../../utils/image'
import { analyzeCustomTemplate } from '../../services/claude'
import type { CustomTemplate } from '../../types'

async function validateClaudeKey(key: string): Promise<boolean> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    return resp.ok || resp.status === 429 // 429 = valid key, just rate limited
  } catch { return false }
}

async function validateGeminiKey(key: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    )
    return resp.ok
  } catch { return false }
}

export function ApiKeys() {
  const { claudeApiKey, geminiApiKey, setClaudeApiKey, setGeminiApiKey, setStep } =
    useStore()

  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null)
  const [geminiOk, setGeminiOk] = useState<boolean | null>(null)

  const canContinue = claudeApiKey.length > 10 && geminiApiKey.length > 10

  const handleContinue = async () => {
    setValidating(true)
    setError('')
    setClaudeOk(null)
    setGeminiOk(null)

    const [cOk, gOk] = await Promise.all([
      validateClaudeKey(claudeApiKey),
      validateGeminiKey(geminiApiKey),
    ])
    setClaudeOk(cOk)
    setGeminiOk(gOk)

    if (cOk && gOk) {
      setStep('brand')
    } else {
      const issues = []
      if (!cOk) issues.push('Claude API key is invalid')
      if (!gOk) issues.push('Gemini API key is invalid')
      setError(issues.join('. ') + '. Check your keys and try again.')
    }
    setValidating(false)
  }

  return (
    <div className="max-w-xl mx-auto py-24 px-6">
      <div className="text-center mb-12">
        <img src="/odylic-logo.png" alt="Odylic" className="h-12 mx-auto mb-1" />
        <p className="text-[10px] tracking-[0.25em] uppercase text-text-muted">
          Studio
        </p>
      </div>

      <GlassCard>
        <div className="flex items-center gap-2 mb-6">
          <KeyRound size={16} className="text-text-muted" />
          <h2 className="text-sm font-medium">API Keys</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary mb-1.5">
              Anthropic (Claude)
              {claudeOk === true && <CheckCircle2 size={12} className="text-green-600" />}
              {claudeOk === false && <AlertTriangle size={12} className="text-red-500" />}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="ml-auto text-[10px] text-text-muted hover:text-text-secondary transition-colors underline underline-offset-2">Get key</a>
            </label>
            <input
              type="password"
              value={claudeApiKey}
              onChange={(e) => { setClaudeApiKey(e.target.value); setClaudeOk(null); setError('') }}
              placeholder="sk-ant-..."
              className="w-full bg-white/60 border border-black/[0.08] rounded-full px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-black/10 transition-all"
            />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary mb-1.5">
              Google AI (Gemini)
              {geminiOk === true && <CheckCircle2 size={12} className="text-green-600" />}
              {geminiOk === false && <AlertTriangle size={12} className="text-red-500" />}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="ml-auto text-[10px] text-text-muted hover:text-text-secondary transition-colors underline underline-offset-2">Get key</a>
            </label>
            <input
              type="password"
              value={geminiApiKey}
              onChange={(e) => { setGeminiApiKey(e.target.value); setGeminiOk(null); setError('') }}
              placeholder="AI..."
              className="w-full bg-white/60 border border-black/[0.08] rounded-full px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-black/10 transition-all"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600 text-center">{error}</p>
        )}

        <button
          disabled={!canContinue || validating}
          onClick={handleContinue}
          className={`mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-full text-sm font-medium transition-all ${
            canContinue && !validating
              ? 'bg-text-primary text-white hover:bg-accent-hover'
              : 'bg-black/[0.04] text-text-muted cursor-not-allowed'
          }`}
        >
          {validating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Validating keys...
            </>
          ) : (
            <>
              Continue
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </GlassCard>

      <AdvancedSettings />
      <MethodologyInfo />
    </div>
  )
}

const COMPRESS_THRESHOLD_MB = 4

async function compressImageFile(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
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
      resolve({ base64: canvas.toDataURL('image/jpeg', 0.85), mimeType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Compression failed')) }
    img.src = url
  })
}

function AdvancedSettings() {
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const {
    customTemplates, addCustomTemplate, updateCustomTemplate, removeCustomTemplate,
    excludeBuiltInTemplates, setExcludeBuiltInTemplates,
    hideTemplateReference, setHideTemplateReference,
    claudeApiKey,
  } = useStore()

  const analyzingCount = customTemplates.filter((t) => t.analysisStatus === 'pending').length

  const runAnalysis = async (t: CustomTemplate) => {
    const apiKey = useStore.getState().claudeApiKey
    if (!apiKey || apiKey.length < 10) return
    updateCustomTemplate(t.id, { analysisStatus: 'pending' })
    try {
      const analysis = await analyzeCustomTemplate(apiKey, t)
      updateCustomTemplate(t.id, { analysis, analysisStatus: 'complete' })
      console.log(`Indexed template: ${t.name} → ${analysis.format_type}`)
    } catch (e) {
      console.warn(`Template analysis failed for ${t.name}:`, e)
      updateCustomTemplate(t.id, { analysisStatus: 'error' })
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files) return
    const newTemplates: CustomTemplate[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const sizeMB = file.size / (1024 * 1024)
      let base64: string
      let mimeType: string
      if (sizeMB > COMPRESS_THRESHOLD_MB) {
        const compressed = await compressImageFile(file)
        base64 = compressed.base64
        mimeType = compressed.mimeType
      } else {
        base64 = await new Promise<string>((res) => {
          const r = new FileReader()
          r.onload = () => res(r.result as string)
          r.readAsDataURL(file)
        })
        mimeType = file.type
      }
      const t: CustomTemplate = {
        id: generateId(),
        name: file.name,
        base64,
        mimeType,
        uploadedAt: Date.now(),
        analysisStatus: 'idle',
      }
      addCustomTemplate(t)
      newTemplates.push(t)
    }
    // Kick off analysis for all new templates (3 at a time)
    const queue = [...newTemplates]
    const processNext = async () => {
      while (queue.length > 0) {
        const t = queue.shift()!
        await runAnalysis(t)
      }
    }
    const workers = Array.from({ length: Math.min(3, queue.length) }, () => processNext())
    Promise.all(workers).catch(() => {})
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  // Re-analyze any templates that failed or haven't been analyzed yet
  const handleRetryAll = () => {
    const unanalyzed = customTemplates.filter((t) => t.analysisStatus !== 'complete' && t.analysisStatus !== 'pending')
    const queue = [...unanalyzed]
    const processNext = async () => {
      while (queue.length > 0) {
        const t = queue.shift()!
        await runAnalysis(t)
      }
    }
    const workers = Array.from({ length: Math.min(3, queue.length) }, () => processNext())
    Promise.all(workers).catch(() => {})
  }

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors mx-auto"
      >
        Advanced Settings
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 rounded-2xl border border-black/[0.06] bg-white/30 backdrop-blur-sm p-5 space-y-4">
          {/* Exclude toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeBuiltInTemplates}
              onChange={(e) => setExcludeBuiltInTemplates(e.target.checked)}
              className="w-4 h-4 rounded border-black/20 text-text-primary focus:ring-text-primary/20"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">Use only my templates</p>
              <p className="text-[10px] text-text-muted">Skip built-in library, generate from your uploaded ads</p>
            </div>
          </label>

          {/* Hide template reference */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hideTemplateReference}
              onChange={(e) => setHideTemplateReference(e.target.checked)}
              className="w-4 h-4 rounded border-black/20 text-text-primary focus:ring-text-primary/20"
            />
            <div>
              <p className="text-sm font-medium text-text-primary">Hide template reference</p>
              <p className="text-[10px] text-text-muted">Don't show the template image in results detail view</p>
            </div>
          </label>

          {/* Upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-black/[0.1] rounded-xl p-4 text-center hover:border-black/20 transition-colors"
          >
            <Upload size={20} className="mx-auto text-text-muted mb-1.5" />
            <p className="text-xs text-text-secondary mb-2">
              Drop ad images here, or
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-[11px] px-3 py-1.5 rounded-full bg-text-primary text-white hover:bg-accent-hover transition-colors"
              >
                Browse files
              </button>
              <button
                onClick={() => folderRef.current?.click()}
                className="text-[11px] px-3 py-1.5 rounded-full border border-black/[0.1] text-text-secondary hover:bg-black/[0.04] transition-colors"
              >
                Select folder
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <input
              ref={folderRef}
              type="file"
              accept="image/*"
              multiple
              {...{ webkitdirectory: '', directory: '' } as any}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* Template grid */}
          {customTemplates.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-text-muted uppercase tracking-wider">
                  Your Templates ({customTemplates.length})
                  {analyzingCount > 0 && (
                    <span className="ml-1.5 normal-case tracking-normal">
                      — indexing {analyzingCount}...
                    </span>
                  )}
                </p>
                {customTemplates.some((t) => t.analysisStatus === 'error' || !t.analysisStatus || t.analysisStatus === 'idle') && claudeApiKey.length > 10 && (
                  <button
                    onClick={handleRetryAll}
                    className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                  >
                    Re-index all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                {customTemplates.map((t) => (
                  <div key={t.id} className="relative group rounded-lg overflow-hidden aspect-square bg-black/[0.04]">
                    <img
                      src={t.base64}
                      alt={t.name}
                      className="w-full h-full object-cover"
                    />
                    {/* Analysis status indicator */}
                    <div className="absolute bottom-1 left-1">
                      {t.analysisStatus === 'pending' && (
                        <Loader2 size={10} className="animate-spin text-white drop-shadow-md" />
                      )}
                      {t.analysisStatus === 'complete' && (
                        <CheckCircle2 size={10} className="text-green-400 drop-shadow-md" />
                      )}
                      {t.analysisStatus === 'error' && (
                        <AlertTriangle size={10} className="text-amber-400 drop-shadow-md" />
                      )}
                    </div>
                    {/* Format type badge */}
                    {t.analysis?.format_type && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5">
                        <p className="text-[8px] text-white/90 truncate">{t.analysis.format_type}</p>
                      </div>
                    )}
                    <button
                      onClick={() => removeCustomTemplate(t.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MethodologyInfo() {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-6 text-center">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-text-muted hover:text-text-secondary transition-colors underline underline-offset-2"
      >
        {open ? 'Hide' : 'How it works'}
      </button>

      {open && (
        <div className="mt-3 rounded-2xl border border-black/[0.06] bg-white/30 backdrop-blur-sm p-6 text-left space-y-4">
          <h3 className="font-display text-lg font-medium text-text-primary">How Odylic Studio Works</h3>

          <div className="space-y-3 text-xs text-text-secondary leading-relaxed">
            <div>
              <p className="font-medium text-text-primary mb-0.5">1. Brand DNA Extraction</p>
              <p>Enter a product URL and Claude scrapes the website, extracting brand colors, fonts, voice, target audience, key benefits, and visual style. It builds a comprehensive brand profile in seconds.</p>
            </div>

            <div>
              <p className="font-medium text-text-primary mb-0.5">2. Asset Collection</p>
              <p>Product images, logos, and lifestyle photos are automatically scraped from the website. You can also upload your own assets or search for images directly.</p>
            </div>

            <div>
              <p className="font-medium text-text-primary mb-0.5">3. Template Matching</p>
              <p>Claude analyzes a library of 700+ real ad formats (testimonials, comparisons, UGC, hero shots, etc.) and selects the best-matching templates for your brand category and style.</p>
            </div>

            <div>
              <p className="font-medium text-text-primary mb-0.5">4. Creative Briefing</p>
              <p>For each ad, Claude writes a detailed creative brief: headline, copy, layout instructions, asset placement, and strategic angle — all tailored to your brand DNA and target audience.</p>
            </div>

            <div>
              <p className="font-medium text-text-primary mb-0.5">5. Image Generation</p>
              <p>Gemini receives the brief, template reference image, and your actual product photos. It composites everything into a finished ad creative, using your real product imagery (not AI-generated products).</p>
            </div>

            <div>
              <p className="font-medium text-text-primary mb-0.5">6. QA Loop</p>
              <p>Claude reviews each generated ad for brand consistency, text accuracy, and visual quality. If issues are found, it provides feedback and the ad is regenerated — up to 2 iterations per image.</p>
            </div>
          </div>

          <div className="pt-2 border-t border-black/[0.06]">
            <p className="text-[10px] text-text-muted">
              Powered by Claude (Anthropic) for strategy and Gemini (Google) for image generation.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
