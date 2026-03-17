import { useState, useEffect } from 'react'
import {
  Wand2,
  Square,
  RectangleVertical,
  Smartphone,
  Zap,
  Sparkles,
  Crown,
  Minus,
  Plus,
  Diamond,
} from 'lucide-react'
import { useStore, setGenerationAbort } from '../../store'
import { GlassCard } from '../layout/GlassCard'
import { findMatchingTemplates, filterCatalogByCategory, buildGenerationPrompt, qaCheckImage, checkProductFidelity, extractProductFacts, analyzeAssetsBatch } from '../../services/claude'
import { generateImage, resizeImage, editImage } from '../../services/gemini'
import { generateId, detectMediaType, loadTemplateImage, templateUrl, createMaskFromRegions } from '../../utils/image'
import type { AspectRatio, ModelTier, CatalogTemplate, CustomTemplate } from '../../types'

const ASPECT_RATIOS: { value: AspectRatio; label: string; icon: any; desc: string }[] = [
  { value: '1:1', label: 'Feed', icon: Square, desc: '1:1' },
  { value: '3:4', label: 'Portrait', icon: RectangleVertical, desc: '3:4' },
  { value: '9:16', label: 'Story', icon: Smartphone, desc: '9:16' },
]

const QUALITY_TIERS: { value: ModelTier; label: string; desc: string; icon: any }[] = [
  { value: 'standard', label: 'Standard', desc: 'Fast', icon: Zap },
  { value: 'hd', label: 'HD', desc: 'Higher quality', icon: Sparkles },
  { value: '2k', label: '2K', desc: 'High res', icon: Crown },
  { value: '4k', label: '4K', desc: 'Max detail', icon: Diamond },
]

export function GeneratePanelPage() {
  const brandDna = useStore((s) => s.brandDna)
  const assets = useStore((s) => s.assets)
  const catalog = useStore((s) => s.catalog)
  const generationConfig = useStore((s) => s.generationConfig)
  const setGenerationConfig = useStore((s) => s.setGenerationConfig)
  const claudeApiKey = useStore((s) => s.claudeApiKey)
  const geminiApiKey = useStore((s) => s.geminiApiKey)
  const isGenerating = useStore((s) => s.isGenerating)
  const setIsGenerating = useStore((s) => s.setIsGenerating)
  const setGenerationProgress = useStore((s) => s.setGenerationProgress)
  const addResult = useStore((s) => s.addResult)
  const setStep = useStore((s) => s.setStep)
  const customTemplates = useStore((s) => s.customTemplates)
  const excludeBuiltInTemplates = useStore((s) => s.excludeBuiltInTemplates)
  const addError = useStore((s) => s.addError)

  const [creativeBrief, setCreativeBrief] = useState('')

  // Reset stuck isGenerating flag (e.g. from interrupted HMR/reload)
  useEffect(() => {
    if (isGenerating) setIsGenerating(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hasAssets = assets.some((a) => a.base64)
  const useCustom = excludeBuiltInTemplates && customTemplates.length > 0
  const hasTemplates = useCustom ? customTemplates.length > 0 : catalog.length > 0
  const canGenerate = brandDna && hasAssets && hasTemplates && !isGenerating

  const handleGenerate = async () => {
    if (!canGenerate || !brandDna) return
    const abortCtrl = new AbortController()
    setGenerationAbort(abortCtrl)
    setIsGenerating(true)

    // Snapshot the active brand — if user switches profiles mid-generation, skip stale results
    const generationBrandName = brandDna.name
    const safeAddResult: typeof addResult = (result) => {
      const currentBrand = useStore.getState().brandDna?.name
      if (currentBrand !== generationBrandName) {
        console.warn(`[GEN] Skipping result — profile changed from "${generationBrandName}" to "${currentBrand}"`)
        return
      }
      addResult(result)
    }

    // Build generation plan
    const eachSizes: AspectRatio[] = (generationConfig.selectedSizes || []).length > 0
      ? generationConfig.selectedSizes
      : ['1:1' as AspectRatio]
    const conceptCount = generationConfig.adsPerBatch || 3
    const totalQuantity = conceptCount * eachSizes.length

    setGenerationProgress({ current: 0, total: totalQuantity, stage: 'Selecting templates...' })
    setStep('results')

    try {
      // Stage 1: Template selection — one per unique creative concept
      const templateRequestCount = conceptCount
      let templateFilenames: string[]
      let customTemplateMap: Map<string, CustomTemplate> | null = null

      // Track per-template reuse count for variation directives
      const templateUseCount = new Map<string, number>()

      if (useCustom) {
        // Custom template mode — round-robin through uploaded templates
        customTemplateMap = new Map()
        templateFilenames = []
        for (let c = 0; c < templateRequestCount; c++) {
          const ct = customTemplates[c % customTemplates.length]
          const syntheticFilename = `custom-${ct.id}-${c}`
          templateFilenames.push(syntheticFilename)
          customTemplateMap.set(syntheticFilename, ct)
          const count = (templateUseCount.get(ct.id) || 0) + 1
          templateUseCount.set(ct.id, count)
        }
        console.log(`[GEN] Custom template mode: ${customTemplates.length} templates, ${templateRequestCount} concepts`)
      } else {
        // Built-in catalog flow
        const previouslyUsedTemplates = [...new Set(
          useStore.getState().results
            .filter((r) => r.imageUrl && r.templateFilename)
            .map((r) => r.templateFilename)
        )]
        if (previouslyUsedTemplates.length > 0) {
          console.log(`[GEN] Previously used ${previouslyUsedTemplates.length} templates — will avoid reuse`)
        }

        try {
          templateFilenames = await findMatchingTemplates(
            claudeApiKey, brandDna, catalog, creativeBrief, templateRequestCount,
            previouslyUsedTemplates
          )
        } catch {
          const filtered = filterCatalogByCategory(catalog, brandDna.category)
          const shuffled = [...filtered].sort(() => Math.random() - 0.5)
          templateFilenames = shuffled.slice(0, templateRequestCount).map((t) => t.filename)
        }

        const originalTemplateCount = templateFilenames.length
        while (templateFilenames.length < templateRequestCount) {
          const filtered = filterCatalogByCategory(catalog, brandDna.category)
          const idx = (templateFilenames.length - originalTemplateCount) % Math.max(1, originalTemplateCount)
          templateFilenames.push(
            templateFilenames[idx] ||
            filtered[Math.floor(Math.random() * filtered.length)]?.filename
          )
        }
      }

      // Extract product facts from packaging images (if not already done)
      let enrichedBrandDna = brandDna
      if (!brandDna.productFacts?.macros) {
        try {
          setGenerationProgress({ current: 0, total: totalQuantity, stage: 'Reading product packaging...' })
          const facts = await extractProductFacts(claudeApiKey, assets)
          if (facts.macros || facts.claims?.length) {
            enrichedBrandDna = { ...brandDna, productFacts: facts }
            console.log('Extracted product facts:', facts)
          }
        } catch (e) {
          console.warn('Product facts extraction skipped:', e)
        }
      }

      // Track headlines across the batch to prevent duplicates
      const usedHeadlines: string[] = []

      // On-demand analysis: analyze any unprocessed assets before building pools
      const unanalyzed = assets.filter((a) => a.base64 && a.analysisStatus !== 'complete')
      if (unanalyzed.length > 0) {
        setGenerationProgress({ current: 0, total: totalQuantity, stage: `Analyzing ${unanalyzed.length} unprocessed assets...` })
        const brandCtx = `${enrichedBrandDna.name} (${enrichedBrandDna.category}). Products: ${enrichedBrandDna.description}`
        await analyzeAssetsBatch(
          claudeApiKey,
          unanalyzed,
          (id, analysis) => {
            if (analysis) {
              useStore.getState().updateAsset(id, { analysis, analysisStatus: 'complete' })
            } else {
              useStore.getState().updateAsset(id, { analysisStatus: 'error' })
            }
          },
          3,
          brandCtx
        )
      }

      // Re-read assets after analysis (store may have updated)
      const currentAssets = useStore.getState().assets

      // Prepare brand asset pools
      const logoPool = currentAssets.filter((a) => a.base64 && a.analysis?.assetType === 'logo')
      const productPool = currentAssets.filter((a) => a.base64 && a.analysis?.assetType !== 'logo' && a.analysis)

      if (logoPool.length === 0 && productPool.length === 0) {
        throw new Error('No assets with image data available. Please re-upload or re-research your brand.')
      }

      // Helper: generate a single ad for a given template/prompt/ratio
      const generateSingleAd = async (
        template: typeof catalog[0],
        prompt: string,
        _orderedAssets: typeof currentAssets,
        assetImages: { base64: string; mimeType: string }[],
        assetNames: string[],
        currentRatio: AspectRatio,
        templateImg: { base64: string; mimeType: string } | null,
        globalIdx: number,
        conceptId?: string,
        productOnlyImages?: { base64: string; mimeType: string }[],
      ) => {
        const adNum = `${globalIdx + 1}/${totalQuantity}`
        const sizeLabel = ` (${currentRatio})`

        try {
          setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Generating image ${adNum}${sizeLabel}...` })
          let imageUrl = await generateImage(
            geminiApiKey, prompt, assetImages,
            currentRatio, generationConfig.modelTier,
            templateImg
          )

          setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `QA review ${adNum}${sizeLabel}...` })
          const mimeType = detectMediaType(imageUrl)
          let qa = await qaCheckImage(
            claudeApiKey, imageUrl, mimeType, prompt, enrichedBrandDna,
            template.description
          )

          let retryCount = 0
          while (!qa.passed && retryCount < 2) {
            retryCount++
            setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Iterating ${adNum}${sizeLabel}...` })
            const fixedPrompt = `${prompt}\n\nIMPORTANT FIXES NEEDED: ${qa.feedbackForRegeneration}\nMake sure to use the attached product photos prominently and follow the template layout from Image 1. ALL TEXT MUST BE SPELLED CORRECTLY. Products and people must be FULLY within the frame, not cropped off edges. Text blocks must NOT overlap/cover the product photo.`
            imageUrl = await generateImage(
              geminiApiKey, fixedPrompt, assetImages,
              currentRatio, generationConfig.modelTier,
              templateImg
            )
            qa = await qaCheckImage(
              claudeApiKey, imageUrl, mimeType, prompt, enrichedBrandDna,
              template.description
            )
          }

          // --- Product Fidelity QA (separate from text/composition QA) ---
          // Compares the product in the ad to real product photos.
          // If notably distorted, masks the region and asks Gemini to paste the real product.
          if (imageUrl && productOnlyImages && productOnlyImages.length > 0) {
            try {
              setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Product check ${adNum}${sizeLabel}...` })
              const fidelity = await checkProductFidelity(claudeApiKey, imageUrl, mimeType, productOnlyImages)
              if (!fidelity.fidelityOk && fidelity.regions.length > 0) {
                setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Fixing product ${adNum}${sizeLabel}...` })
                const mask = await createMaskFromRegions(imageUrl, fidelity.regions)
                const fixedImage = await editImage(
                  geminiApiKey, imageUrl, mask,
                  'Replace the distorted product in the masked region with the REAL product from the reference photos. Match the lighting, angle, scale, and perspective of the surrounding ad. Keep all text, backgrounds, and other elements exactly as they are.',
                  productOnlyImages.slice(0, 3),
                )
                imageUrl = fixedImage
                qa.concerns = (qa.concerns || '') + ` [Product auto-fixed: ${fidelity.overallAssessment}]`
                console.log(`[GEN] Product fidelity fix applied: ${fidelity.overallAssessment}`)
              }
            } catch (e) {
              console.warn('[GEN] Product fidelity check/fix failed, keeping original:', e)
            }
          }

          const strategyMatch = prompt.match(/STRATEGY:\s*(.+?)\s*[—\-–]\s*(.+?)$/m)
          const strategyAngle = strategyMatch?.[1]?.trim()
          const strategyConcept = strategyMatch?.[2]?.trim()

          safeAddResult({
            id: generateId(),
            imageUrl,
            templateFilename: template.filename,
            templateImageUrl: templateUrl(template.filename),
            assetsUsed: assetNames,
            aspectRatio: currentRatio,
            prompt,
            qa,
            qaStatus: qa.passed ? 'passed' : 'failed',
            retryCount,
            timestamp: Date.now(),
            version: 1,
            conceptId,
            formatType: template.format_type,
            strategyAngle,
            strategyConcept,
            adName: `${template.format_type}-${strategyAngle || 'ad'}`,
          })
        } catch (e: any) {
          console.error('Generation failed:', e)
          const raw = e.message || 'Unknown error'
          let reason = raw
          if (raw.includes('exceeds 5 MB')) reason = 'Image too large (>5 MB) — try smaller product images'
          else if (raw.includes('not supported')) reason = 'Unsupported image format — try JPG or PNG'
          else if (raw.includes('rate_limit') || raw.includes('429')) reason = 'API rate limited — wait a moment and retry'
          else if (raw.includes('credit') || raw.includes('billing')) reason = 'API credits exhausted — top up your account'
          else if (raw.includes('model_not_found') || raw.includes('404')) reason = 'AI model unavailable — try again later'
          else if (raw.includes('invalid_request')) {
            const d = raw.match(/"message":"([^"]+)"/)?.[1] || raw
            reason = `Invalid request: ${d}`
          }
          addError(`Ad failed: ${reason}`)
          safeAddResult({
            id: generateId(),
            imageUrl: '',
            templateFilename: template.filename,
            templateImageUrl: templateUrl(template.filename),
            assetsUsed: assetNames,
            aspectRatio: currentRatio,
            prompt: '',
            qa: { passed: false, concerns: reason, feedbackForRegeneration: '' },
            qaStatus: 'failed',
            retryCount: 0,
            timestamp: Date.now(),
            version: 1,
            conceptId,
            formatType: template.format_type,
          })
          setGenerationProgress({ current: globalIdx + 1, total: totalQuantity, stage: `Failed: ${reason}` })
        }
      }

      let globalIdx = 0
      const usedAssetIds: string[] = []  // Track across concepts for variety

      // Outer loop = concepts, inner loop = sizes
      {
        for (let c = 0; c < conceptCount; c++) {
          if (abortCtrl.signal.aborted) break
          const conceptId = generateId()
          const filename = templateFilenames[c]

          // Resolve template — custom or catalog
          let template: CatalogTemplate
          let templateImg: { base64: string; mimeType: string } | null

          if (customTemplateMap?.has(filename)) {
            const ct = customTemplateMap.get(filename)!
            templateImg = { base64: ct.base64, mimeType: ct.mimeType }
            const a = ct.analysis
            template = {
              filename: ct.name,
              format_type: a?.format_type || 'Custom',
              sub_format: a?.sub_format || 'User-uploaded ad template',
              description: a?.description || 'A custom ad template uploaded by the user. Analyze it visually and replicate its layout, style, and structure for this brand.',
              layout: a?.layout || { orientation: 'unknown', sections: '', background: '', text_placement: '' },
              visual_elements: a?.visual_elements || [],
              text_elements: a?.text_elements || [],
              color_scheme: a?.color_scheme || '',
              niches: [],
              current_niche: '',
              broad_category: a?.broad_category,
              brand_style: a?.brand_style,
              ad_style_tags: a?.ad_style_tags,
              photography_style: a?.photography_style,
              text_density: a?.text_density,
              product_visibility: a?.product_visibility,
              emotional_tone: a?.emotional_tone,
            }
          } else {
            const found = catalog.find((t) => t.filename === filename)
            if (!found) { globalIdx += eachSizes.length; continue }
            template = found
            templateImg = await loadTemplateImage(template.filename)
          }

          // Rotate product images per concept — unused products first for variety
          const unusedProducts = productPool.filter((p) => !usedAssetIds.includes(p.id))
          const usedProducts = productPool.filter((p) => usedAssetIds.includes(p.id))
          const rotatedPool = [...unusedProducts, ...usedProducts]
          const selectedProducts = rotatedPool.slice(0, 6)
          const selectedLogos = logoPool.slice(0, 2)
          const orderedAssets = [...selectedLogos, ...selectedProducts]

          // Load template + build prompt ONCE per concept
          setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Writing copy for concept ${c + 1}/${conceptCount}...` })

          // Build brief — inject variation directive when reusing the same custom template
          let briefForConcept = creativeBrief || ''
          if (customTemplateMap) {
            const ct = customTemplateMap.get(filename)
            if (ct) {
              const totalUses = templateUseCount.get(ct.id) || 1
              const conceptIdx = templateFilenames.slice(0, c + 1).filter(f => customTemplateMap!.get(f)?.id === ct.id).length
              if (totalUses > 1) {
                briefForConcept = `${briefForConcept}\n\nVARIATION ${conceptIdx} of ${totalUses}: This template is being reused. Create a DISTINCTLY DIFFERENT interpretation — use different copy angles, different headline styles, different color treatments, and different layout emphasis. Do NOT repeat any headlines or concepts from other variations.`.trim()
              }
            }
          }

          const { prompt, selectedAssetIds } = await buildGenerationPrompt(
            claudeApiKey, enrichedBrandDna, template, orderedAssets,
            eachSizes[0], !!templateImg,
            templateImg?.base64 || null,
            undefined, briefForConcept || undefined,
            usedHeadlines.length > 0 ? usedHeadlines : undefined
          )
          const headlineMatch = prompt.match(/headline\s*\|\s*"([^"]+)"/i)
          if (headlineMatch?.[1]) usedHeadlines.push(headlineMatch[1])
          // Track used assets for variety across concepts
          usedAssetIds.push(...selectedAssetIds)

          // Filter assets to only those Claude selected — fewer images = better Nano Banana results
          const filteredAssets = orderedAssets.filter((a) => selectedAssetIds.includes(a.id))
          console.log(`[GEN] Concept ${c + 1}: ${orderedAssets.length} total assets → ${filteredAssets.length} selected (${filteredAssets.map(a => a.name).join(', ')})`)
          // Renumber Image references in prompt to match filtered set
          const oldToNew = new Map<number, number>()
          let newIdx = (templateImg ? 1 : 0) + 1  // start after template
          const imageOffset = templateImg ? 1 : 0
          let oldIdx = imageOffset + 1
          for (const a of orderedAssets) {
            if (selectedAssetIds.includes(a.id)) {
              oldToNew.set(oldIdx, newIdx)
              newIdx++
            }
            oldIdx++
          }
          const renumberedPrompt = prompt.replace(/Image\s+(\d+)/g, (match, numStr) => {
            const n = parseInt(numStr, 10)
            const mapped = oldToNew.get(n)
            return mapped !== undefined ? `Image ${mapped}` : match
          })
          const filteredAssetImages = filteredAssets.filter((a) => a.base64).map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
          const productOnlyImages = filteredAssets.filter((a) => a.base64 && a.analysis?.assetType !== 'logo').map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
          const filteredAssetNames = filteredAssets.map((a) => a.name)

          // Generate master at 3:4 (best Meta base), then resize for other sizes
          const masterRatio: AspectRatio = eachSizes.includes('3:4' as AspectRatio) ? '3:4' : eachSizes[0]
          const otherRatios = eachSizes.filter((r) => r !== masterRatio)
          const orderedSizes = [masterRatio, ...otherRatios]
          let masterImageUrl: string | null = null

          for (const currentRatio of orderedSizes) {
            if (abortCtrl.signal.aborted) break
            if (masterImageUrl && currentRatio !== masterRatio) {
              // RESIZE existing master — sends only 1 image
              const adNum = `${globalIdx + 1}/${totalQuantity}`
              console.log(`[GEN] RESIZE: ${masterRatio} → ${currentRatio} (sending only master image, no assets)`)
              try {
                setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `Resizing to ${currentRatio} ${adNum}...` })
                const imageUrl = await resizeImage(
                  geminiApiKey, masterImageUrl, masterRatio, currentRatio,
                  generationConfig.modelTier,
                )

                setGenerationProgress({ current: globalIdx, total: totalQuantity, stage: `QA review ${adNum} (${currentRatio})...` })
                const mimeType = detectMediaType(imageUrl)
                const qa = await qaCheckImage(
                  claudeApiKey, imageUrl, mimeType, renumberedPrompt, enrichedBrandDna,
                  template.description
                )

                const strategyMatch = renumberedPrompt.match(/STRATEGY:\s*(.+?)\s*[—\-–]\s*(.+?)$/m)
                safeAddResult({
                  id: generateId(),
                  imageUrl,
                  templateFilename: template.filename,
                  templateImageUrl: templateUrl(template.filename),
                  assetsUsed: filteredAssetNames,
                  aspectRatio: currentRatio,
                  prompt: renumberedPrompt,
                  qa,
                  qaStatus: qa.passed ? 'passed' : 'failed',
                  retryCount: 0,
                  timestamp: Date.now(),
                  version: 1,
                  conceptId,
                  formatType: template.format_type,
                  strategyAngle: strategyMatch?.[1]?.trim(),
                  strategyConcept: strategyMatch?.[2]?.trim(),
                  adName: `${template.format_type}-${strategyMatch?.[1]?.trim() || 'ad'}`,
                })
              } catch (e: any) {
                console.warn(`Resize to ${currentRatio} failed, falling back to full generation:`, e?.message)
                await generateSingleAd(
                  template, renumberedPrompt, filteredAssets, filteredAssetImages, filteredAssetNames,
                  currentRatio, templateImg, globalIdx, conceptId, productOnlyImages
                )
              }
            } else {
              // MASTER generation — uses only selected assets
              console.log(`[GEN] MASTER: generating at ${currentRatio} with ${filteredAssetImages.length} asset images`)
              await generateSingleAd(
                template, renumberedPrompt, filteredAssets, filteredAssetImages, filteredAssetNames,
                currentRatio, templateImg, globalIdx, conceptId, productOnlyImages
              )
              // Capture master image for resizing subsequent sizes
              const latestResults = useStore.getState().results
              const justAdded = latestResults.find((r) => r.conceptId === conceptId && r.aspectRatio === currentRatio && r.imageUrl)
              if (justAdded?.imageUrl) masterImageUrl = justAdded.imageUrl
            }
            setGenerationProgress({ current: globalIdx + 1, total: totalQuantity, stage: globalIdx + 1 < totalQuantity ? `Starting ${globalIdx + 2}/${totalQuantity}...` : 'Finishing up...' })
            globalIdx++
          }
        }
      }
    } catch (e: any) {
      console.error('Pipeline failed:', e)
      const raw = e.message || 'Unknown error'
      let reason = raw
      if (raw.includes('exceeds 5 MB')) reason = 'Product images too large — try uploading smaller images'
      else if (raw.includes('not supported')) reason = 'Unsupported image format — use JPG or PNG'
      else if (raw.includes('rate_limit') || raw.includes('429')) reason = 'Rate limited — wait a moment and retry'
      else if (raw.includes('credit') || raw.includes('billing')) reason = 'API credits exhausted'
      setGenerationProgress({ current: 0, total: 0, stage: `Error: ${reason}` })
      addError(`Generation failed: ${reason}`)
    }

    const completed = useStore.getState().results.length
    if (abortCtrl.signal.aborted) {
      setGenerationProgress({ current: 0, total: 0, stage: `Cancelled — ${completed} ads kept` })
    } else {
      setGenerationProgress({ current: totalQuantity, total: totalQuantity, stage: `Done! ${totalQuantity} ads generated.` })
    }
    setIsGenerating(false)
    setGenerationAbort(null)
    setTimeout(() => setGenerationProgress({ current: 0, total: 0, stage: '' }), 3000)

    // Auto-save brand profile to IndexedDB after generation
    try {
      const store = useStore.getState()
      if (store.brandDna) {
        const { upsertProfile } = await import('../../lib/db')
        await upsertProfile({
          id: generateId(),
          name: store.brandDna.name,
          savedAt: Date.now(),
          brandDna: store.brandDna,
          personas: store.personas,
          assets: store.assets,
          results: store.results,
          savedAdIds: [...store.savedAdIds],
        })
        console.log(`Auto-saved profile: ${store.brandDna.name}`)
      }
    } catch (e) {
      console.warn('Auto-save profile failed:', e)
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-12 px-6 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight mb-2">Generate</h1>
        <p className="text-text-secondary text-sm">
          AI matches templates and creates on-brand ads
        </p>
      </div>

      {/* Creative Brief */}
      <GlassCard>
        <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Creative Brief</p>
        <textarea
          value={creativeBrief}
          onChange={(e) => setCreativeBrief(e.target.value)}
          placeholder="Optional: describe what you want — scene, copy, angle, ad format, target audience, promo details..."
          rows={3}
          className="w-full bg-white/60 border border-black/[0.08] rounded-2xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-black/10 transition-all resize-none"
        />
        <p className="text-[10px] text-text-muted mt-1.5">Claude will weave this into each generation brief for Gemini.</p>
      </GlassCard>

      {/* Sizes */}
      <GlassCard>
        <p className="text-xs text-text-muted uppercase tracking-wider mb-4">Sizes</p>

        {/* Size cards */}
        <div className="grid grid-cols-3 gap-3">
          {ASPECT_RATIOS.map(({ value, label, icon: Icon, desc }) => {
            const isSelected = (generationConfig.selectedSizes || []).includes(value)

            return (
              <button
                key={value}
                onClick={() => {
                  const current = generationConfig.selectedSizes || []
                  const updated = current.includes(value)
                    ? current.filter(s => s !== value)
                    : [...current, value]
                  setGenerationConfig({ selectedSizes: updated })
                }}
                className={`relative flex flex-col items-center justify-center gap-1.5 p-5 rounded-2xl transition-all border-2 ${
                  isSelected
                    ? 'bg-text-primary text-white border-transparent'
                    : 'bg-white/40 border-black/[0.06] text-text-secondary hover:bg-white/60 hover:border-black/[0.12]'
                }`}
              >
                <Icon size={28} strokeWidth={1.5} />
                <span className="text-sm font-medium">{label}</span>
                <span className={`text-[10px] ${isSelected ? 'text-white/60' : 'text-text-muted'}`}>{desc}</span>
                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Quantity of unique ads + total */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-black/[0.06]">
          <div>
            <p className="text-sm font-medium text-text-primary">Unique creatives</p>
            <p className="text-[10px] text-text-muted">Each rendered in {(generationConfig.selectedSizes || []).length || 0} size{(generationConfig.selectedSizes || []).length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGenerationConfig({ adsPerBatch: Math.max(1, (generationConfig.adsPerBatch || 3) - 1) })}
                disabled={(generationConfig.adsPerBatch || 3) <= 1}
                className="w-8 h-8 rounded-full border border-black/[0.08] flex items-center justify-center text-text-secondary hover:bg-black/[0.04] disabled:opacity-30 transition-all"
              >
                <Minus size={14} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={generationConfig.adsPerBatch || 3}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setGenerationConfig({ adsPerBatch: isNaN(n) ? 1 : Math.max(1, Math.min(20, n)) })
                }}
                className="w-14 h-8 text-center text-lg font-display font-medium rounded-xl border border-black/[0.06] bg-white/60 focus:outline-none focus:ring-2 focus:ring-text-primary/20 text-text-primary"
              />
              <button
                onClick={() => setGenerationConfig({ adsPerBatch: Math.min(20, (generationConfig.adsPerBatch || 3) + 1) })}
                className="w-8 h-8 rounded-full border border-black/[0.08] flex items-center justify-center text-text-secondary hover:bg-black/[0.04] transition-all"
              >
                <Plus size={14} />
              </button>
            </div>
            <span className="text-xs text-text-muted whitespace-nowrap">= {(generationConfig.adsPerBatch || 3) * Math.max(1, (generationConfig.selectedSizes || []).length)} images</span>
          </div>
        </div>
      </GlassCard>

      {/* Quality */}
      <GlassCard>
        <p className="text-xs text-text-muted uppercase tracking-wider mb-3">Quality</p>
        <div className="flex gap-2">
          {QUALITY_TIERS.map(({ value, label, desc, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setGenerationConfig({ modelTier: value })}
              className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all border ${
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
          ))}
        </div>
      </GlassCard>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className={`w-full flex items-center justify-center gap-2 py-4 rounded-full text-sm font-medium transition-all ${
          canGenerate
            ? 'bg-text-primary text-white hover:bg-accent-hover'
            : 'bg-black/[0.04] text-text-muted cursor-not-allowed'
        }`}
      >
        <Wand2 size={18} />
        Generate {(generationConfig.adsPerBatch || 3) * Math.max(1, (generationConfig.selectedSizes || []).length)} Ads
      </button>

      {!canGenerate && !isGenerating && (
        <p className="text-xs text-text-muted text-center">
          {!brandDna ? 'Research a brand first' : !hasAssets ? 'Upload product images in Assets' : !hasTemplates ? (useCustom ? 'Upload custom templates in Setup' : 'Loading templates...') : ''}
        </p>
      )}
    </div>
  )
}
