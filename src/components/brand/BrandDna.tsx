import { useState, useRef, useCallback, useEffect } from 'react'
import { Search, Loader2, Globe, ArrowRight, Plus, X } from 'lucide-react'
import { useStore } from '../../store'
import { scrapeProductUrl, researchBrand, fetchImageAsBase64, searchLogosWithBrandName } from '../../services/scraper'
import { pickBestLogo, analyzeAssetsBatch, validateBrandColors } from '../../services/claude'
import { generateId, detectMediaType } from '../../utils/image'
import type { UploadedAsset, LogoCandidate } from '../../types'
import { LogoChecker } from './LogoChecker'
import googleFonts from '../../data/google-fonts.json'

// Guess asset type from URL/filename without an API call
function guessAssetType(url: string, isLogo: boolean): string | null {
  if (isLogo) return 'logo'
  const lower = url.toLowerCase()
  if (lower.includes('logo') || lower.includes('wordmark')) return 'logo'
  if (lower.includes('wrapper') || lower.includes('packaging') || lower.includes('carton') || lower.includes('box')) return 'packaging'
  if (lower.includes('texture') || lower.includes('pattern')) return 'texture_pattern'
  if (lower.includes('nutrition') || lower.includes('nfp') || lower.includes('label')) return 'packaging'
  if (lower.includes('lifestyle') || lower.includes('claire') || lower.includes('model') || lower.includes('mouth') || lower.includes('person')) return 'lifestyle'
  if (lower.includes('fullres') || lower.includes('product') || lower.includes('food_imagery')) return 'product_on_white'
  return null // needs classification
}

// Separate component so color picker drag doesn't cause parent re-renders
function ColorSwatches({ colors, onChange }: { colors: string[]; onChange: (c: string[]) => void }) {
  const [liveColors, setLiveColors] = useState(colors)
  const isDragging = useRef(false)

  // Sync from parent when not dragging
  if (!isDragging.current && colors.join(',') !== liveColors.join(',')) {
    setLiveColors(colors)
  }

  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Brand Colors</p>
      <div className="flex items-center gap-2.5 flex-wrap">
        {liveColors.map((c, i) => (
          <div key={`color-${i}`} className="group relative">
            <label className="cursor-pointer">
              <div
                className="w-9 h-9 rounded-full border border-black/[0.08] shadow-sm hover:ring-2 hover:ring-black/20 transition-all"
                style={{ backgroundColor: c }}
              />
              <input
                type="color"
                value={c.startsWith('#') ? c : '#000000'}
                onInput={(e) => {
                  // Live preview while dragging — local state only
                  isDragging.current = true
                  const updated = [...liveColors]
                  updated[i] = (e.target as HTMLInputElement).value.toUpperCase()
                  setLiveColors(updated)
                }}
                onChange={(e) => {
                  // Commit on picker close
                  isDragging.current = false
                  const updated = [...liveColors]
                  updated[i] = e.target.value.toUpperCase()
                  setLiveColors(updated)
                  onChange(updated)
                }}
                className="sr-only"
              />
            </label>
            <button
              onClick={() => {
                const updated = liveColors.filter((_, j) => j !== i)
                setLiveColors(updated)
                onChange(updated)
              }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={8} />
            </button>
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-text-muted font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {c}
            </span>
          </div>
        ))}
        <label className="w-9 h-9 rounded-full border-2 border-dashed border-black/[0.12] flex items-center justify-center cursor-pointer hover:border-black/30 transition-all">
          <Plus size={14} className="text-text-muted" />
          <input
            type="color"
            value="#000000"
            onChange={(e) => {
              const updated = [...liveColors, e.target.value.toUpperCase()]
              setLiveColors(updated)
              onChange(updated)
            }}
            className="sr-only"
          />
        </label>
      </div>
    </div>
  )
}

// googleFonts imported statically from src/data/google-fonts.json (~1,900 fonts)
// To refresh: npx tsx scripts/fetch-google-fonts.ts

// Dynamic Google Fonts loader — injects <link> tags so fonts render in their actual typeface
function loadGoogleFont(fontName: string): void {
  const id = `gf-${fontName.replace(/\s+/g, '-').toLowerCase()}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;700&display=swap`
  document.head.appendChild(link)
}

const FONT_ROLES = ['heading', 'subheading', 'body', 'cta', 'accent', 'display', 'mono'] as const
type FontRole = typeof FONT_ROLES[number]

const ROLE_TAG_RE = /\s*\[(\w+)\]$/

function parseFontEntry(f: string): { name: string; role: FontRole | null } {
  const match = f.match(ROLE_TAG_RE)
  return {
    name: f.replace(ROLE_TAG_RE, ''),
    role: match ? (match[1] as FontRole) : null,
  }
}

function FontPicker({ fonts, onChange }: { fonts: string[]; onChange: (f: string[]) => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load Google Fonts for current brand fonts
  useEffect(() => {
    for (const f of fonts) {
      const { name } = parseFontEntry(f)
      loadGoogleFont(name)
    }
  }, [fonts])

  // Load fonts for dropdown suggestions (first 15 visible)
  useEffect(() => {
    if (showDropdown) {
      for (const s of suggestions.slice(0, 15)) {
        loadGoogleFont(s)
      }
    }
  }, [suggestions, showDropdown])

  const updateSuggestions = useCallback((query: string) => {
    if (query.length === 0) {
      // Show popular fonts when empty
      setSuggestions(googleFonts.slice(0, 15))
      return
    }
    const lower = query.toLowerCase()
    const startsWith = googleFonts.filter((f: string) => f.toLowerCase().startsWith(lower))
    const includes = googleFonts.filter((f: string) => !f.toLowerCase().startsWith(lower) && f.toLowerCase().includes(lower))
    setSuggestions([...startsWith, ...includes].slice(0, 15))
  }, [])

  const openSearch = useCallback((idx: number | null, initialQuery = '') => {
    setEditingIndex(idx)
    setSearchQuery(initialQuery)
    setShowDropdown(true)
    updateSuggestions(initialQuery)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [updateSuggestions])

  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query)
    updateSuggestions(query)
  }, [updateSuggestions])

  const selectFont = useCallback((fontName: string) => {
    if (editingIndex !== null) {
      const updated = [...fonts]
      const { role } = parseFontEntry(fonts[editingIndex])
      updated[editingIndex] = role ? `${fontName} [${role}]` : fontName
      onChange(updated)
    } else {
      onChange([...fonts, fontName])
    }
    setSearchQuery('')
    setShowDropdown(false)
    setEditingIndex(null)
  }, [editingIndex, fonts, onChange])

  const cycleRole = useCallback((idx: number) => {
    const { name, role } = parseFontEntry(fonts[idx])
    const currentIdx = role ? FONT_ROLES.indexOf(role) : -1
    const nextIdx = (currentIdx + 1) % (FONT_ROLES.length + 1) // +1 for "no role"
    const updated = [...fonts]
    if (nextIdx === FONT_ROLES.length) {
      // No role
      updated[idx] = name
    } else {
      updated[idx] = `${name} [${FONT_ROLES[nextIdx]}]`
    }
    onChange(updated)
  }, [fonts, onChange])

  return (
    <div>
      <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Fonts</p>
      <div className="flex flex-wrap gap-2">
        {fonts.map((f, i) => {
          const { name, role } = parseFontEntry(f)
          return (
            <div key={i} className="flex items-center gap-1.5 bg-white/60 border border-black/[0.08] rounded-lg px-3 py-1.5 group">
              <button
                onClick={() => openSearch(i, name)}
                className="text-sm text-text-primary bg-transparent outline-none text-left"
                style={{ fontFamily: `'${name}', sans-serif` }}
              >
                {name}
              </button>
              <button
                onClick={() => cycleRole(i)}
                className={`text-[9px] rounded px-1 py-0.5 transition-colors ${
                  role
                    ? 'text-white bg-text-primary/70 hover:bg-text-primary'
                    : 'text-text-muted bg-black/[0.04] hover:bg-black/[0.08]'
                }`}
                title="Click to cycle role: heading → subheading → body → cta → accent → display → mono → none"
              >
                {role || 'tag'}
              </button>
              <button
                onClick={() => onChange(fonts.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        <button
          onClick={() => openSearch(null)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-dashed border-black/[0.12] text-xs text-text-muted hover:border-black/30 transition-all"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Search dropdown — stays open while interacting */}
      {showDropdown && (
        <div className="mt-2 relative">
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) selectFont(suggestions[0])
              if (e.key === 'Escape') { setShowDropdown(false); setSearchQuery('') }
            }}
            placeholder="Search Google Fonts..."
            autoFocus
            className="w-full bg-white/80 border border-black/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-black/10"
          />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-black/[0.08] rounded-lg shadow-lg overflow-hidden z-50 max-h-[240px] overflow-y-auto">
            {suggestions.length > 0 ? suggestions.map((s) => (
              <button
                key={s}
                onClick={() => selectFont(s)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-black/[0.04] transition-colors"
                style={{ fontFamily: `'${s}', sans-serif` }}
              >
                {s}
              </button>
            )) : (
              <p className="px-3 py-2 text-xs text-text-muted">No matches found</p>
            )}
          </div>
          <button
            onClick={() => { setShowDropdown(false); setSearchQuery('') }}
            className="absolute right-2 top-2 text-text-muted hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

export function BrandDnaPage() {
  const {
    claudeApiKey,
    brandDna,
    setBrandDna,
    personas,
    setPersonas,
    isResearching,
    setIsResearching,
    addAsset,
    updateAsset,
    resetForNewBrand,
    setStep,
    addError,
  } = useStore()

  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [logoCandidates, setLogoCandidates] = useState<LogoCandidate[]>([])
  const [showLogoChecker, setShowLogoChecker] = useState(false)
  const logoResolverRef = useRef<((selected: LogoCandidate | null) => void) | null>(null)

  const handleResearch = async () => {
    if (!url.trim()) return
    setError('')
    setIsResearching(true)

    // Clear previous brand data, assets, and results
    resetForNewBrand()

    try {
      setStatus('Scraping product page...')
      const { pageContent, imageUrls, logoUrls, detectedFonts, detectedColors, socialProof, warnings } = await scrapeProductUrl(url.trim())

      console.log(`Scraped: ${imageUrls.length} product images, ${logoUrls.length} logos, fonts: [${detectedFonts.join(', ')}], colors: [${detectedColors.join(', ')}]`)
      // Surface scraper warnings as toasts so users know what happened
      for (const warn of warnings) {
        addError(warn)
      }

      setStatus('Researching brand...')
      const result = await researchBrand(claudeApiKey, url.trim(), pageContent, detectedFonts, detectedColors, setStatus)
      // Merge scraped social proof into brandDna
      const brandDnaWithProof = {
        ...result.brandDna,
        socialProof: {
          ...socialProof,
          ...result.brandDna.socialProof,
          // Prefer scraped reviews (direct from page) over research-inferred ones
          reviews: socialProof.reviews?.length ? socialProof.reviews : result.brandDna.socialProof?.reviews,
        },
      }
      setBrandDna(brandDnaWithProof)
      setPersonas(result.personas)

      // Re-run logo search with the REAL brand name (not domain guess)
      let finalLogoUrls = logoUrls
      if (result.brandDna.name) {
        try {
          setStatus('Re-searching logos with real brand name...')
          const betterLogos = await searchLogosWithBrandName(result.brandDna.name, url.trim(), {
            category: result.brandDna.category,
            description: result.brandDna.description,
          })
          if (betterLogos.length > 0) {
            // Merge: real-name results first, then original scraped ones (deduplicated)
            const seen = new Set(betterLogos)
            const merged = [...betterLogos]
            for (const u of logoUrls) {
              if (!seen.has(u)) { merged.push(u); seen.add(u) }
            }
            finalLogoUrls = merged
            console.log(`Logo search: merged ${betterLogos.length} real-name + ${logoUrls.length} original → ${finalLogoUrls.length} total`)
          }
        } catch (e) {
          console.warn('Real-name logo search failed, using original:', e)
        }
      }

      const total = finalLogoUrls.length + imageUrls.length
      if (total === 0) {
        setStatus('')
        setIsResearching(false)
        return
      }

      setStatus(`Downloading assets (0/${total})...`)
      let downloaded = 0
      const needsClassification: UploadedAsset[] = []
      const pageDomain = new URL(url.trim()).hostname.replace('www.', '')

      // Download top logo candidates and let Claude COMPARE them to pick the best one
      const MAX_LOGO_CANDIDATES = 6
      const logoCandidatesToTry = finalLogoUrls.slice(0, MAX_LOGO_CANDIDATES)
      console.log(`Downloading top ${logoCandidatesToTry.length} logo candidates for comparison...`, logoCandidatesToTry)

      const downloadedLogos: { base64: string; sourceUrl: string; name: string; mimeType: string }[] = []
      for (const imgUrl of logoCandidatesToTry) {
        try {
          // 10s timeout per logo download to avoid hanging
          const base64 = await Promise.race([
            fetchImageAsBase64(imgUrl),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
          ])
          if (base64) {
            downloaded++
            setStatus(`Downloading logos (${downloadedLogos.length + 1}/${logoCandidatesToTry.length})...`)
            const name = imgUrl.split('/').pop()?.split('?')[0] || 'logo.png'
            const mimeType = detectMediaType(base64)
            downloadedLogos.push({ base64, sourceUrl: imgUrl, name, mimeType })
            console.log(`Downloaded logo candidate ${downloadedLogos.length}: ${name}`)
          } else {
            console.log(`Failed to download logo candidate: ${imgUrl}`)
          }
        } catch (err) {
          console.warn(`Logo candidate download error: ${imgUrl}`, err)
        }
      }

      // Send ALL downloaded candidates to Claude in ONE call for comparative pick
      if (downloadedLogos.length > 0) {
        setStatus(`AI comparing ${downloadedLogos.length} logo candidates...`)
        const brandName = result.brandDna.name || pageDomain.split('.')[0]
        try {
          const pick = await pickBestLogo(
            claudeApiKey,
            downloadedLogos.map(l => ({ base64: l.base64, sourceUrl: l.sourceUrl })),
            brandName,
          )
          console.log(`Logo pick: index=${pick.bestIndex}, reasoning="${pick.reasoning}", classifications=[${pick.classifications.join(', ')}]`)

          // Build candidates with AI classifications for the LogoChecker
          const candidatesWithAI: LogoCandidate[] = downloadedLogos.map((l, i) => ({
            base64: l.base64,
            sourceUrl: l.sourceUrl,
            name: l.name,
            mimeType: l.mimeType,
            aiClassification: pick.classifications[i] || 'unknown',
            isAiPick: i === pick.bestIndex,
          }))

          // Show LogoChecker and wait for user selection
          setStatus('Choose your logo...')
          const userChoice = await new Promise<LogoCandidate | null>((resolve) => {
            logoResolverRef.current = resolve
            setLogoCandidates(candidatesWithAI)
            setShowLogoChecker(true)
          })
          setShowLogoChecker(false)
          setLogoCandidates([])
          setStatus('Processing logo selection...')

          // Determine which logo to use
          const selectedLogo = userChoice || candidatesWithAI.find(c => c.isAiPick) || candidatesWithAI[0]
          if (selectedLogo) {
            addAsset({
              id: generateId(),
              name: `logo-${selectedLogo.name}`,
              mimeType: selectedLogo.mimeType,
              base64: selectedLogo.base64,
              source: selectedLogo.sourceUrl === 'upload' ? 'upload' : 'scraped',
              analysisStatus: 'complete',
              analysis: {
                assetType: 'logo',
                description: `Primary brand logo${userChoice ? ' (user selected)' : `: ${pick.reasoning}`}`,
                style: 'Logo / brand mark',
                dominantColors: result.brandDna.colors || [],
                products: [],
                tags: ['logo', brandName.toLowerCase()],
                suggestedUses: ['Brand logo overlay on ad creatives'],
              },
            })
            console.log(`Logo confirmed: ${selectedLogo.name} from ${selectedLogo.sourceUrl}`)
          }

          // Only the selected logo is added — user can manually upload more from Asset Library
        } catch (err) {
          console.warn('Logo comparison failed, falling back to first candidate:', err)
          const first = downloadedLogos[0]
          addAsset({
            id: generateId(),
            name: `logo-${first.name}`,
            mimeType: first.mimeType,
            base64: first.base64,
            source: 'scraped',
            analysisStatus: 'pending',
          })
          needsClassification.push({
            id: generateId(), name: first.name, mimeType: first.mimeType,
            base64: first.base64, analysisStatus: 'pending', source: 'scraped',
          })
        }
      }

      // Download product images — all in parallel with timeout
      const IMG_TIMEOUT = 15000
      setStatus(`Downloading ${imageUrls.length} product images...`)
      console.log(`[ASSETS] Starting download of ${imageUrls.length} product images`)

      const dlResults = await Promise.allSettled(
        imageUrls.map(async (imgUrl) => {
          const base64 = await Promise.race([
            fetchImageAsBase64(imgUrl),
            new Promise<null>((r) => setTimeout(() => r(null), IMG_TIMEOUT)),
          ])
          if (!base64) console.warn(`[ASSETS] Failed to download: ${imgUrl.slice(0, 80)}`)
          return base64 ? { imgUrl, base64 } : null
        })
      )

      let dlSuccess = 0
      let dlFail = 0
      for (const r of dlResults) {
        if (r.status !== 'fulfilled' || !r.value) { dlFail++; continue }
        const { imgUrl, base64 } = r.value
        dlSuccess++
        downloaded++
        setStatus(`Downloading assets (${downloaded}/${total})...`)
        const name = imgUrl.split('/').pop()?.split('?')[0] || 'image.jpg'
        const guessedType = guessAssetType(imgUrl, false)

        const asset: UploadedAsset = {
          id: generateId(),
          name,
          mimeType: detectMediaType(base64),
          base64,
          analysisStatus: guessedType ? 'complete' : 'pending',
          source: 'scraped',
          ...(guessedType ? {
            analysis: {
              assetType: guessedType as any,
              description: `${guessedType.replace(/_/g, ' ')} - ${name}`,
              style: guessedType === 'lifestyle' ? 'Lifestyle photography' : 'Product photography',
              dominantColors: result.brandDna.colors,
              products: [result.brandDna.name],
              tags: [guessedType, result.brandDna.name.toLowerCase()],
              suggestedUses: [`Use as ${guessedType.replace(/_/g, ' ')} in ad creatives`],
            },
          } : {}),
        }
        addAsset(asset)

        if (!guessedType) {
          needsClassification.push(asset)
        }
      }
      console.log(`[ASSETS] Download complete: ${dlSuccess} succeeded, ${dlFail} failed out of ${imageUrls.length}`)

      // Only classify assets we couldn't identify from URL (much fewer API calls)
      if (needsClassification.length > 0) {
        setStatus(`Classifying ${needsClassification.length} assets...`)
        const batchBrandCtx = `${result.brandDna.name} (${result.brandDna.category}). Products: ${result.brandDna.description}`
        await analyzeAssetsBatch(
          claudeApiKey,
          needsClassification,
          (id, analysis) => {
            if (analysis) {
              updateAsset(id, { analysis, analysisStatus: 'complete' })
            } else {
              updateAsset(id, { analysisStatus: 'error' })
            }
          },
          3,
          batchBrandCtx
        )
      }

      // Validate brand colors using logo + product images
      if (result.brandDna.colors?.length > 0) {
        try {
          setStatus('Validating brand colors...')
          const logoAsset = downloadedLogos.find((_, i) => i === (downloadedLogos.length > 0 ? 0 : -1))
          const logoB64 = logoAsset?.base64 || null
          const productImgs = imageUrls.length > 0
            ? (await Promise.all(imageUrls.slice(0, 2).map(async (u) => {
                try {
                  const b64 = await fetchImageAsBase64(u)
                  return b64 ? { base64: b64, mimeType: detectMediaType(b64) } : null
                } catch { return null }
              }))).filter(Boolean) as { base64: string; mimeType: string }[]
            : []

          const validatedColors = await validateBrandColors(
            claudeApiKey, result.brandDna.colors, logoB64, productImgs, result.brandDna.name
          )
          if (validatedColors.length > 0) {
            console.log(`Colors validated: [${result.brandDna.colors.join(', ')}] → [${validatedColors.join(', ')}]`)
            setBrandDna({ ...brandDnaWithProof, colors: validatedColors })
          }
        } catch (e) {
          console.warn('Color validation skipped:', e)
        }
      }

      setStatus('')
    } catch (e: any) {
      const msg = e.message || 'Research failed'
      setError(msg)
      addError(`Research failed: ${msg}`)
      setStatus('')
    } finally {
      setIsResearching(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-16 px-6">
      <h1 className="font-display text-4xl font-medium tracking-tight mb-2">Brand Guide</h1>
      <p className="text-text-secondary text-sm mb-10">
        Enter a product page to build a brand profile
      </p>

      {/* URL Input */}
      <div className="glass p-4 mb-12">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Globe size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
              placeholder="https://brand.com/product"
              className="w-full bg-white/60 border border-black/[0.08] rounded-full pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-black/10 transition-all"
            />
          </div>
          <button
            onClick={handleResearch}
            disabled={isResearching || !url.trim()}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {isResearching ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} />
            )}
            Research
          </button>
        </div>
        {status && (
          <p className="text-xs text-text-secondary mt-3 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {status}
          </p>
        )}
        {error && <p className="text-xs text-error mt-3">{error}</p>}
      </div>

      {/* Brand Guide Display */}
      {brandDna && (
        <div className="space-y-10">
          {/* Brand Header (editable) */}
          <div>
            <div className="flex items-baseline gap-3 mb-1">
              <input
                type="text"
                value={brandDna.name}
                onChange={(e) => setBrandDna({ ...brandDna, name: e.target.value })}
                className="font-display text-3xl font-medium bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors"
              />
              <input
                type="text"
                value={brandDna.category}
                onChange={(e) => setBrandDna({ ...brandDna, category: e.target.value })}
                className="text-sm text-text-muted bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors max-w-[200px]"
              />
            </div>
            <textarea
              value={brandDna.brandSummary}
              onChange={(e) => setBrandDna({ ...brandDna, brandSummary: e.target.value })}
              rows={2}
              className="w-full text-text-secondary leading-relaxed bg-transparent outline-none border border-transparent hover:border-black/[0.06] focus:border-black/10 rounded-lg px-0 focus:px-2 transition-all resize-none"
            />
            {brandDna.description && brandDna.description !== brandDna.brandSummary && (
              <textarea
                value={brandDna.description}
                onChange={(e) => setBrandDna({ ...brandDna, description: e.target.value })}
                rows={2}
                className="w-full text-sm text-text-muted mt-2 leading-relaxed bg-transparent outline-none border border-transparent hover:border-black/[0.06] focus:border-black/10 rounded-lg px-0 focus:px-2 transition-all resize-none"
              />
            )}
          </div>

          {/* Colors (editable) */}
          <ColorSwatches
            colors={brandDna.colors}
            onChange={(colors) => setBrandDna({ ...brandDna, colors })}
          />

          {/* Fonts (Google Fonts search) */}
          <FontPicker
            fonts={brandDna.fonts}
            onChange={(fonts) => setBrandDna({ ...brandDna, fonts })}
          />

          {/* Benefits + USPs (editable) */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="font-display text-lg font-medium mb-3">Key Benefits</h3>
              <ul className="space-y-2">
                {brandDna.keyBenefits.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-black/[0.12] mt-[7px] shrink-0" />
                    <input
                      type="text"
                      value={b}
                      onChange={(e) => {
                        const updated = [...brandDna.keyBenefits]
                        updated[i] = e.target.value
                        setBrandDna({ ...brandDna, keyBenefits: updated })
                      }}
                      className="flex-1 text-sm text-text-secondary bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors"
                    />
                    <button
                      onClick={() => setBrandDna({ ...brandDna, keyBenefits: brandDna.keyBenefits.filter((_, j) => j !== i) })}
                      className="text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                    >
                      <X size={10} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setBrandDna({ ...brandDna, keyBenefits: [...brandDna.keyBenefits, ''] })}
                className="flex items-center gap-1 mt-2 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <Plus size={10} /> Add benefit
              </button>
            </div>
            <div>
              <h3 className="font-display text-lg font-medium mb-3">Differentiators</h3>
              <ul className="space-y-2">
                {brandDna.usps.map((u, i) => (
                  <li key={i} className="flex items-start gap-1.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-black/[0.12] mt-[7px] shrink-0" />
                    <input
                      type="text"
                      value={u}
                      onChange={(e) => {
                        const updated = [...brandDna.usps]
                        updated[i] = e.target.value
                        setBrandDna({ ...brandDna, usps: updated })
                      }}
                      className="flex-1 text-sm text-text-secondary bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors"
                    />
                    <button
                      onClick={() => setBrandDna({ ...brandDna, usps: brandDna.usps.filter((_, j) => j !== i) })}
                      className="text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                    >
                      <X size={10} />
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setBrandDna({ ...brandDna, usps: [...brandDna.usps, ''] })}
                className="flex items-center gap-1 mt-2 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <Plus size={10} /> Add differentiator
              </button>
            </div>
          </div>

          {/* Voice & Audience (editable) */}
          <div className="glass p-5">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Voice & Tone</p>
                <textarea
                  value={brandDna.voiceTone}
                  onChange={(e) => setBrandDna({ ...brandDna, voiceTone: e.target.value })}
                  rows={3}
                  className="w-full text-sm text-text-secondary leading-relaxed bg-transparent outline-none border border-transparent hover:border-black/[0.06] focus:border-black/10 rounded-lg px-0 focus:px-2 transition-all resize-none"
                />
              </div>
              <div>
                <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Target Audience</p>
                <textarea
                  value={brandDna.targetAudience}
                  onChange={(e) => setBrandDna({ ...brandDna, targetAudience: e.target.value })}
                  rows={3}
                  className="w-full text-sm text-text-secondary leading-relaxed bg-transparent outline-none border border-transparent hover:border-black/[0.06] focus:border-black/10 rounded-lg px-0 focus:px-2 transition-all resize-none"
                />
              </div>
            </div>
          </div>

          {/* Guarantee (editable, if present) */}
          {(brandDna.guarantee || brandDna.productType) && (
            <div className="glass p-5">
              <div className="grid grid-cols-2 gap-8">
                {brandDna.productType && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Product Type</p>
                    <input
                      type="text"
                      value={brandDna.productType}
                      onChange={(e) => setBrandDna({ ...brandDna, productType: e.target.value })}
                      className="w-full text-sm text-text-secondary bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors"
                    />
                  </div>
                )}
                {brandDna.guarantee && (
                  <div>
                    <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Guarantee</p>
                    <input
                      type="text"
                      value={brandDna.guarantee}
                      onChange={(e) => setBrandDna({ ...brandDna, guarantee: e.target.value })}
                      className="w-full text-sm text-text-secondary bg-transparent outline-none border-b border-transparent hover:border-black/10 focus:border-black/20 transition-colors"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Personas */}
          {personas.length > 0 && (
            <div>
              <h3 className="font-display text-lg font-medium mb-5">Personas</h3>
              <div className="space-y-6">
                {personas.map((p, i) => (
                  <div key={p.id}>
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="w-6 h-6 rounded-full bg-black/[0.06] flex items-center justify-center text-[10px] font-medium text-text-muted">
                        {i + 1}
                      </span>
                      <span className="font-medium text-sm">{p.name}</span>
                      <span className="text-xs text-text-muted">{p.age}</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed ml-9">{p.description}</p>
                    {i < personas.length - 1 && <div className="border-b border-black/[0.05] mt-6" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Continue */}
          <button
            onClick={() => setStep('assets')}
            className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium bg-text-primary text-white hover:bg-accent-hover transition-all"
          >
            Continue to Assets
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {showLogoChecker && (
        <LogoChecker
          candidates={logoCandidates}
          brandName={brandDna?.name || ''}
          onConfirm={(selected) => logoResolverRef.current?.(selected)}
        />
      )}
    </div>
  )
}
