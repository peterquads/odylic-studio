import type {
  UploadedAsset,
  AssetAnalysis,
  BrandDna,
  CatalogTemplate,
  CustomCopy,
  AspectRatio,
  ProductFacts,
  CustomTemplate,
  CustomTemplateAnalysis,
} from '../types'
import { stripDataUri, detectMediaType, compressForApi, isApiSupportedFormat, convertToJpeg, toDataUrl } from '../utils/image'

// Model tiers: Opus (briefing), Sonnet (image understanding/QA), Haiku (fast tagging)
const OPUS_CANDIDATES = [
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
]
const SONNET_CANDIDATES = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4-20250514',
]
const HAIKU = 'claude-haiku-4-5-20251001'

// All valid model IDs — used to validate cache
const ALL_VALID_MODELS = new Set([...OPUS_CANDIDATES, ...SONNET_CANDIDATES, HAIKU])

// Model usage log — accumulated across generations, queryable via getModelReport()
export interface ModelUsageEntry { tier: string; model: string; count: number }
const modelUsageLog: Map<string, ModelUsageEntry> = new Map()
let modelUsageVersion = 0

export function notifyModelUsed(tier: string, model: string) {
  const key = `${tier}::${model}`
  const existing = modelUsageLog.get(key)
  if (existing) {
    existing.count++
  } else {
    modelUsageLog.set(key, { tier, model, count: 1 })
  }
  modelUsageVersion++
}

export function getModelReport(): ModelUsageEntry[] {
  return Array.from(modelUsageLog.values()).sort((a, b) => b.count - a.count)
}

// Returns a version number that increments on every model call — use to trigger re-renders
export function getModelUsageVersion(): number {
  return modelUsageVersion
}

export function clearModelReport() {
  modelUsageLog.clear()
  modelUsageVersion++
}

function loadCachedModel(key: string): string | null {
  try {
    const cached = localStorage.getItem(key)
    if (!cached || cached === HAIKU || !ALL_VALID_MODELS.has(cached)) {
      // Clear stale/invalid cached model IDs
      if (cached) localStorage.removeItem(key)
      return null
    }
    return cached
  } catch { return null }
}

let resolvedOpus: string | null = loadCachedModel('odylic-resolved-opus')
let resolvedSonnet: string | null = loadCachedModel('odylic-resolved-sonnet')

async function callModel(
  apiKey: string,
  model: string,
  messages: any[],
  maxTokens = 1500
): Promise<string> {
  const maxRetries = 5

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    let response: Response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages,
        }),
      })
    } catch (e: any) {
      clearTimeout(timeout)
      if (e.name === 'AbortError' && attempt < maxRetries - 1) {
        console.log(`Request timeout (${model}), retrying...`)
        continue
      }
      throw e
    }
    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json()
      return data.content[0].text.trim()
    }

    // Parse error safely — never expose raw API response (may contain key/request details)
    let errType = ''
    try {
      const errJson = await response.json()
      errType = errJson?.error?.type || errJson?.error?.message || ''
    } catch {
      errType = `HTTP ${response.status}`
    }

    // Model not found - don't retry, throw immediately so caller can try next model
    if (response.status === 404) {
      throw new Error(`model_not_found:${model}`)
    }

    // Auth errors - don't retry, fail immediately. Never include raw response.
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Claude API auth error (${response.status}): Check your API key`)
    }

    if ((response.status === 429 || response.status === 529) && attempt < maxRetries - 1) {
      const delay = response.status === 529 ? (attempt + 1) * 15000 : (attempt + 1) * 20000
      console.log(`${response.status === 529 ? 'Overloaded' : 'Rate limited'} (${model}), retrying in ${delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, delay))
      continue
    }

    throw new Error(`Claude API error (${response.status}): ${errType || 'Request failed'}`)
  }

  throw new Error('Max retries exceeded')
}

// Auto-discover working model from a candidate list, cache result, fall back down the chain
async function callWithFallback(
  apiKey: string,
  candidates: string[],
  resolved: string | null,
  cacheKey: string,
  setResolved: (model: string) => void,
  fallbackFn: (apiKey: string, messages: any[], maxTokens: number) => Promise<string>,
  tierName: string,
  messages: any[],
  maxTokens: number
): Promise<string> {
  if (resolved) {
    notifyModelUsed(tierName, resolved)
    return callModel(apiKey, resolved, messages, maxTokens)
  }
  for (const candidate of candidates) {
    try {
      const result = await callModel(apiKey, candidate, messages, maxTokens)
      setResolved(candidate)
      try { localStorage.setItem(cacheKey, candidate) } catch {}
      console.log(`Using ${tierName} model: ${candidate}`)
      notifyModelUsed(tierName, candidate)
      return result
    } catch (e: any) {
      if (e.message?.startsWith('model_not_found')) {
        console.log(`Model ${candidate} not available, trying next...`)
        continue
      }
      throw e
    }
  }
  console.log(`No ${tierName} model available, falling back`)
  return fallbackFn(apiKey, messages, maxTokens)
}

// Opus for briefing/creative direction — falls back to Sonnet → Haiku
async function callOpus(apiKey: string, messages: any[], maxTokens = 2000): Promise<string> {
  return callWithFallback(
    apiKey, OPUS_CANDIDATES, resolvedOpus, 'odylic-resolved-opus',
    (m) => { resolvedOpus = m },
    callSonnet, 'Opus', messages, maxTokens
  )
}

// Sonnet for image understanding/QA — falls back to Haiku
async function callSonnet(apiKey: string, messages: any[], maxTokens = 1500): Promise<string> {
  return callWithFallback(
    apiKey, SONNET_CANDIDATES, resolvedSonnet, 'odylic-resolved-sonnet',
    (m) => { resolvedSonnet = m },
    (api, msgs, mt) => {
      console.log('No Sonnet model available, using Haiku')
      notifyModelUsed('Sonnet→Haiku', HAIKU)
      return callModel(api, HAIKU, msgs, mt)
    },
    'Sonnet', messages, maxTokens
  )
}

// Haiku for fast classification/analysis
function callHaiku(apiKey: string, messages: any[], maxTokens = 1000) {
  notifyModelUsed('Haiku', HAIKU)
  return callModel(apiKey, HAIKU, messages, maxTokens)
}

function cleanJson(text: string): string {
  let t = text
  if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n')
  if (t.endsWith('```')) t = t.slice(0, t.lastIndexOf('```'))
  if (t.startsWith('json')) t = t.slice(4)
  return t.trim()
}

// Valid Claude image types + safe fallback
const VALID_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function safeMediaType(raw: string | undefined, base64?: string): string {
  if (raw && VALID_IMAGE_TYPES.has(raw)) return raw
  if (base64) {
    const detected = detectMediaType(base64)
    if (VALID_IMAGE_TYPES.has(detected)) return detected
  }
  return 'image/jpeg'
}

// ============ Logo Verification (blind — no context bias) ============

export async function verifyLogoVisually(
  apiKey: string,
  asset: UploadedAsset,
): Promise<AssetAnalysis> {
  let dataUrl = asset.base64.startsWith('data:') ? asset.base64 : toDataUrl(asset.base64, asset.mimeType || 'image/jpeg')
  if (!isApiSupportedFormat(dataUrl)) dataUrl = await convertToJpeg(dataUrl)
  dataUrl = await compressForApi(dataUrl)
  const mediaType = safeMediaType(undefined, dataUrl)
  const base64Data = stripDataUri(dataUrl)

  // BLIND prompt — do NOT mention "logo", brand names, or filenames
  // Let Claude classify purely from pixels
  const text = await callSonnet(
    apiKey,
    [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: `What is this image? Look at the actual pixels. Classify it:

- "logo" = a brand logo, wordmark, or brand symbol/monogram. Usually vector-like, clean, on transparent or solid background. NOT a photograph, NOT a product shot, NOT an article header.
- "product_on_white" = product photo on clean background
- "lifestyle" = product in real-world context
- "packaging" = product packaging
- "icon" = simple icon or symbol
- "unknown" = article image, PR photo, screenshot, banner, or anything else

Be strict about "logo": a photograph of a product with a logo ON it is "product_on_white" not "logo". A news article header image is "unknown" not "logo". Only pure logo/wordmark graphics count.

Return JSON:
{"assetType": "one of the types above", "description": "what you actually see", "style": "visual style", "dominantColors": ["#hex"], "products": [], "tags": [], "suggestedUses": []}
Return ONLY valid JSON.`,
          },
        ],
      },
    ],
    500
  )

  return JSON.parse(cleanJson(text))
}

// Pick the best logo from multiple candidates in a SINGLE comparative vision call
// Returns the 0-based index of the best logo, or -1 if none are logos
export async function pickBestLogo(
  apiKey: string,
  candidates: { base64: string; sourceUrl: string }[],
  brandName: string,
): Promise<{ bestIndex: number; reasoning: string; classifications: string[] }> {
  if (candidates.length === 0) return { bestIndex: -1, reasoning: 'No candidates', classifications: [] }
  if (candidates.length === 1) {
    // Single candidate — just verify it
    const dataUrl = candidates[0].base64.startsWith('data:') ? candidates[0].base64 : toDataUrl(candidates[0].base64, 'image/jpeg')
    const compressed = await compressForApi(dataUrl)
    const mt = safeMediaType(undefined, compressed)
    const b64 = stripDataUri(compressed)
    const text = await callSonnet(apiKey, [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
        { type: 'text', text: `Is this a logo/wordmark/brand symbol for "${brandName}"? Return JSON: {"isLogo": true/false, "reasoning": "why"}` },
      ],
    }], 200)
    try {
      const parsed = JSON.parse(cleanJson(text))
      return {
        bestIndex: parsed.isLogo ? 0 : -1,
        reasoning: parsed.reasoning || '',
        classifications: [parsed.isLogo ? 'logo' : 'not_logo'],
      }
    } catch {
      return { bestIndex: 0, reasoning: 'Verification parse failed, assuming logo', classifications: ['unknown'] }
    }
  }

  // Multiple candidates — send all at once for comparison
  const imageBlocks: any[] = []
  for (let i = 0; i < candidates.length; i++) {
    let dataUrl = candidates[i].base64.startsWith('data:') ? candidates[i].base64 : toDataUrl(candidates[i].base64, 'image/jpeg')
    if (!isApiSupportedFormat(dataUrl)) dataUrl = await convertToJpeg(dataUrl)
    dataUrl = await compressForApi(dataUrl)
    const mt = safeMediaType(undefined, dataUrl)
    const b64 = stripDataUri(dataUrl)
    imageBlocks.push(
      { type: 'text', text: `--- IMAGE ${i + 1} ---` },
      { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } },
    )
  }

  imageBlocks.push({
    type: 'text',
    text: `I'm looking for the PRIMARY LOGO of the brand "${brandName}".

Above are ${candidates.length} candidate images. For EACH image, classify it as one of:
- "logo" = a clean brand logo, wordmark, monogram, or brand symbol. Usually vector-like, on transparent or solid background.
- "product" = a product photo
- "banner" = a website banner, collection header, or hero image
- "icon" = a favicon or small icon
- "other" = anything else (article image, screenshot, decorative element, etc.)

A LOGO is NOT:
- A photograph with a logo printed on a product
- A hero banner that happens to show the brand name
- A collection/category header image
- A social media profile photo (unless it IS the logo itself)

Return JSON:
{
  "classifications": ["type_for_image_1", "type_for_image_2", ...],
  "bestLogoIndex": 1-based index of the BEST logo (the cleanest, most recognizable brand logo), or 0 if NONE are logos,
  "reasoning": "Brief explanation of your pick"
}
Return ONLY valid JSON.`,
  })

  const text = await callSonnet(apiKey, [{ role: 'user', content: imageBlocks }], 500)
  try {
    const parsed = JSON.parse(cleanJson(text))
    const bestIdx = (parsed.bestLogoIndex || 0) - 1 // Convert 1-based to 0-based
    return {
      bestIndex: bestIdx,
      reasoning: parsed.reasoning || '',
      classifications: parsed.classifications || [],
    }
  } catch {
    // Parse failed — fall back to first candidate
    return { bestIndex: 0, reasoning: 'Parse failed, using first candidate', classifications: [] }
  }
}

// ============ Asset Analysis (Sonnet, with brand context) ============

function buildClassifyPrompt(brandContext?: string): string {
  return `${brandContext ? `BRAND CONTEXT: You are analyzing assets for ${brandContext}. Use this context to accurately identify products.\n\n` : ''}Classify this image for ad creative use.

First determine: is this an AD CREATIVE (has text overlays, designed layout, marketing content) or a PRODUCT/ASSET image (product photo, logo, texture, raw asset)?

If AD CREATIVE, return JSON with strategic fields:
{
  "assetType": "lifestyle | unknown",
  "description": "Brief description of the ad",
  "style": "Visual style",
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "products": ["visible products"],
  "tags": ["searchable", "tags"],
  "suggestedUses": ["how to use as inspiration"],
  "productionStyle": "UGC | Product Feature | Us vs. Them | High Production | Text Overlay | Testimonial/Quote | Meme/Viral | Explainer/Demo | Before & After | Other",
  "productionQuality": "High | Medium | Low",
  "angle": "marketing angle in 2-4 words",
  "hook": "primary hook or attention-grabber",
  "concept": "core concept in 2-5 words",
  "funnelPosition": "TOFU | MOFU | BOFU",
  "marketAwareness": "Unaware | Problem Aware | Solution Aware | Product Aware | Most Aware",
  "sentiment": "Positive | Neutral | Negative | Urgent | Inspirational | Informative | Humorous",
  "headline": "visible headline text or null",
  "cta": "visible CTA text or null"
}

If PRODUCT/ASSET image, return base fields only:
{
  "assetType": "product_on_white | lifestyle | logo | modeled_product | packaging | texture_pattern | icon | unknown",
  "description": "Brief description",
  "style": "Visual style",
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "products": ["visible products"],
  "tags": ["searchable", "tags"],
  "suggestedUses": ["how to use in ads"]
}

Return ONLY valid JSON.`
}

/** Validate brand colors by having Claude look at the logo + product images.
 *  Returns refined color list — only colors that are actually part of the brand identity. */
export async function validateBrandColors(
  apiKey: string,
  cssColors: string[],
  logoBase64: string | null,
  productImages: { base64: string; mimeType: string }[],
  brandName: string,
): Promise<string[]> {
  if (cssColors.length === 0 && !logoBase64) return cssColors

  const content: any[] = []

  // Send logo image if available
  if (logoBase64) {
    const data = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64
    const mt = safeMediaType(undefined, logoBase64)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mt, data },
    })
  }

  // Send first 2 product images for additional context
  for (const img of productImages.slice(0, 2)) {
    let dataUrl = img.base64.startsWith('data:') ? img.base64 : `data:${img.mimeType};base64,${img.base64}`
    dataUrl = await compressForApi(dataUrl)
    const data = stripDataUri(dataUrl)
    const mt = safeMediaType(img.mimeType, dataUrl)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mt, data },
    })
  }

  content.push({
    type: 'text',
    text: `You are a brand color expert. ${logoBase64 ? 'Image 1 is the brand logo.' : ''} The remaining images are product photos for "${brandName}".

These colors were detected from the website CSS:
${cssColors.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Your job: identify which of these colors are ACTUAL BRAND COLORS (used intentionally as part of the brand identity — logo colors, primary brand color, accent/CTA color). Remove any that are:
- Random UI/framework colors not related to the brand
- Colors from third-party widgets or ad platforms
- Generic web colors (standard link blue, error red, success green)
- Colors that don't match what you see in the logo or product imagery

Also: if you see a CLEAR brand color in the logo or packaging that is MISSING from the CSS list, add it.

Return ONLY a JSON array of hex color strings, ordered by importance (primary brand color first). Maximum 5 colors. Example: ["#E87A2D", "#1A1A1A", "#F5E6D3"]

Return ONLY the JSON array, nothing else.`,
  })

  try {
    const text = await callHaiku(apiKey, [{ role: 'user', content }], 200)
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((c: any) => typeof c === 'string' && c.startsWith('#'))) {
      return parsed.map((c: string) => c.toUpperCase()).slice(0, 5)
    }
  } catch (e) {
    console.warn('Color validation failed, using CSS colors:', e)
  }

  return cssColors.slice(0, 5)
}

export async function analyzeAsset(
  apiKey: string,
  asset: UploadedAsset,
  brandContext?: string
): Promise<AssetAnalysis> {
  let dataUrl = asset.base64.startsWith('data:') ? asset.base64 : toDataUrl(asset.base64, asset.mimeType || 'image/jpeg')

  // Convert unsupported formats (AVIF, etc.) to JPEG
  if (!isApiSupportedFormat(dataUrl)) {
    console.log(`Converting unsupported format for ${asset.name}`)
    dataUrl = await convertToJpeg(dataUrl)
  }

  // Compress if over 5MB limit
  dataUrl = await compressForApi(dataUrl)

  const mediaType = safeMediaType(undefined, dataUrl)
  const base64Data = stripDataUri(dataUrl)

  const text = await callSonnet(
    apiKey,
    [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          { type: 'text', text: buildClassifyPrompt(brandContext) },
        ],
      },
    ],
    1000
  )

  return JSON.parse(cleanJson(text))
}

// Extract product facts from packaging/nutrition images
export async function extractProductFacts(
  apiKey: string,
  assets: UploadedAsset[]
): Promise<ProductFacts> {
  const packagingAssets = assets.filter(
    (a) => a.base64 && (a.analysis?.assetType === 'packaging' || a.analysis?.assetType === 'product_on_white')
  ).slice(0, 3)

  if (packagingAssets.length === 0) return {}

  const content: any[] = []
  for (const asset of packagingAssets) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: safeMediaType(asset.mimeType, asset.base64), data: stripDataUri(asset.base64) },
    })
  }

  content.push({
    type: 'text',
    text: `Read ALL text visible on these product images/packaging. Extract VERIFIED product facts.

Return JSON:
{
  "macros": {"protein": "28g", "calories": "150", "sugar": "0g", "fat": "6g"},
  "claims": ["Third-Party Tested", "No Artificial Sweeteners"],
  "ingredients": ["chocolate chips", "sea salt", "whey protein"],
  "certifications": ["NSF Certified"],
  "flavors": ["Chocolate Chip Cookie Dough"],
  "servingSize": "1 bar (60g)"
}

Only include facts you can ACTUALLY READ on the packaging. Leave fields empty if not visible.
Return ONLY valid JSON.`,
  })

  try {
    const text = await callSonnet(apiKey, [{ role: 'user', content }], 600)
    return JSON.parse(cleanJson(text))
  } catch (e) {
    console.warn('Product facts extraction failed:', e)
    return {}
  }
}

// Analyze multiple assets in parallel batches
export async function analyzeAssetsBatch(
  apiKey: string,
  assets: UploadedAsset[],
  onProgress: (id: string, result: AssetAnalysis | null) => void,
  concurrency = 3,
  brandContext?: string
): Promise<void> {
  const queue = [...assets]

  async function processNext() {
    while (queue.length > 0) {
      const asset = queue.shift()!
      try {
        const analysis = await analyzeAsset(apiKey, asset, brandContext)
        onProgress(asset.id, analysis)
      } catch (e) {
        // Retry up to 2 times with exponential backoff
        let succeeded = false
        for (let attempt = 1; attempt <= 2; attempt++) {
          const delay = attempt * 2000
          console.warn(`Failed to analyze ${asset.name}, retry ${attempt}/2 in ${delay}ms...`, e)
          try {
            await new Promise((r) => setTimeout(r, delay))
            const analysis = await analyzeAsset(apiKey, asset, brandContext)
            onProgress(asset.id, analysis)
            succeeded = true
            break
          } catch (retryErr) {
            if (attempt === 2) {
              console.error(`Failed to analyze ${asset.name} after 2 retries:`, retryErr)
            }
          }
        }
        if (!succeeded) {
          onProgress(asset.id, null)
        }
      }
    }
  }

  // Run N workers in parallel
  const workers = Array.from({ length: Math.min(concurrency, assets.length) }, () => processNext())
  await Promise.all(workers)
}

// ============ Custom Template Analysis ============

export async function analyzeCustomTemplate(
  apiKey: string,
  template: CustomTemplate
): Promise<CustomTemplateAnalysis> {
  let dataUrl = template.base64.startsWith('data:') ? template.base64 : toDataUrl(template.base64, template.mimeType || 'image/jpeg')
  if (!isApiSupportedFormat(dataUrl)) dataUrl = await convertToJpeg(dataUrl)
  dataUrl = await compressForApi(dataUrl)

  const mediaType = safeMediaType(undefined, dataUrl)
  const base64Data = stripDataUri(dataUrl)

  const text = await callSonnet(
    apiKey,
    [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          {
            type: 'text',
            text: `Analyze this ad creative template image. Extract structured metadata exactly matching this JSON schema:

{
  "format_type": "Testimonial/Review | Before/After | Product Feature | Comparison | UGC/Social | Hero/Lifestyle | Offer/Sale | Educational | Carousel Card | Other",
  "sub_format": "Specific description of the format variant, e.g. 'Customer quote with star rating and product showcase'",
  "layout": {
    "orientation": "square | portrait | landscape",
    "sections": "Describe how the ad's sections are arranged (e.g. 'headline top, product center, CTA bottom')",
    "background": "Background style (e.g. 'solid warm beige', 'gradient blue to purple', 'lifestyle photo')",
    "text_placement": "Where text elements sit relative to visuals"
  },
  "visual_elements": ["list", "every", "visual", "element", "visible"],
  "text_elements": ["list", "every", "text", "element", "visible"],
  "color_scheme": "Describe the overall color palette used",
  "description": "2-3 sentence description of the ad format, layout, and what makes it effective. Describe it as a reusable template.",
  "broad_category": "supplements | fashion | food_beverage | beauty | home_kitchen | tech | fitness | pets | baby | general",
  "brand_style": "aesthetic | utility",
  "ad_style_tags": ["e.g. clean-minimal | bold-graphic | UGC-native | data-heavy | editorial | playful"],
  "photography_style": "e.g. 'studio product shot', 'lifestyle in-context', 'flat-lay', 'UGC selfie'",
  "text_density": "minimal | moderate | heavy",
  "product_visibility": "hero-centered | supporting | background | none",
  "emotional_tone": "e.g. 'urgent/FOMO', 'educational', 'playful', 'premium', 'trust-building'"
}

Be specific and accurate. Describe what you SEE in the image.
Return ONLY valid JSON, no markdown.`,
          },
        ],
      },
    ],
    1200
  )

  return JSON.parse(cleanJson(text))
}

// ============ Catalog Matching (Haiku - fast search) ============

// Hard BLOCKLIST: if a template's current_niche matches these, it is EXCLUDED for the brand category.
// This prevents food templates showing for jewelry, skincare showing for tech, etc.
// Map brand categories to allowed template broad_categories
// Each brand type can use templates from its own category + "general"
const BRAND_TO_TEMPLATE_CATEGORIES: { brandPattern: RegExp; allowed: Set<string> }[] = [
  {
    brandPattern: /supplement|vitamin|greens|collagen|protein.*powder|nootropic|adaptogen/i,
    allowed: new Set(['supplements', 'health_wellness', 'general']),
  },
  {
    brandPattern: /food|beverage|snack|drink|coffee|tea|juice|candy|cereal|bar\b|meal/i,
    allowed: new Set(['food_beverage', 'general']),
  },
  {
    brandPattern: /beauty|skincare|cosmetic|makeup|dermatolog|personal.*care|hair.*care/i,
    allowed: new Set(['beauty', 'health_wellness', 'general']),
  },
  {
    brandPattern: /fashion|apparel|clothing|denim|streetwear|activewear|athleisure/i,
    allowed: new Set(['fashion', 'footwear', 'accessories', 'general']),
  },
  {
    brandPattern: /footwear|shoe|sneaker|boot/i,
    allowed: new Set(['footwear', 'fashion', 'accessories', 'general']),
  },
  {
    brandPattern: /jewel|accessor|watch|wallet|sunglasses|eyewear|bag|luggage/i,
    allowed: new Set(['accessories', 'fashion', 'general']),
  },
  {
    brandPattern: /home|furniture|kitchen|cookware|bedding|decor|cleaning/i,
    allowed: new Set(['home_kitchen', 'general']),
  },
  {
    brandPattern: /tech|software|saas|app|platform|digital|ai\b/i,
    allowed: new Set(['tech', 'general']),
  },
  {
    brandPattern: /pet|dog|cat\b/i,
    allowed: new Set(['pet', 'general']),
  },
  {
    brandPattern: /baby|infant|kid|children/i,
    allowed: new Set(['baby_kids', 'general']),
  },
  {
    brandPattern: /health|wellness|fitness|weight.*loss|diet|mental.*health/i,
    allowed: new Set(['health_wellness', 'supplements', 'general']),
  },
]

export function filterCatalogByCategory(catalog: CatalogTemplate[], brandCategory: string): CatalogTemplate[] {
  const categoryLower = brandCategory.toLowerCase()

  // Find which template categories are allowed for this brand
  const match = BRAND_TO_TEMPLATE_CATEGORIES.find(({ brandPattern }) => brandPattern.test(categoryLower))

  if (!match) {
    // Unknown brand category — return all templates
    console.log(`Category filter: unknown brand "${brandCategory}", returning all ${catalog.length} templates`)
    return catalog
  }

  const allowed = match.allowed
  const filtered = catalog.filter((t) => {
    const templateCat = t.broad_category || 'general'
    return allowed.has(templateCat)
  })

  console.log(`Category filter: ${catalog.length} → ${filtered.length} templates (allowed: ${[...allowed].join(', ')} for "${brandCategory}")`)
  return filtered
}

export async function findMatchingTemplates(
  apiKey: string,
  brandDna: BrandDna,
  catalog: CatalogTemplate[],
  description: string,
  limit = 10,
  previouslyUsedTemplates?: string[]
): Promise<string[]> {
  // Pre-filter: remove templates from incompatible niches
  const compatible = filterCatalogByCategory(catalog, brandDna.category)
  console.log(`Niche filter: ${catalog.length} → ${compatible.length} templates (removed ${catalog.length - compatible.length} incompatible)`)

  const index = compatible.map((t) => ({
    f: t.filename,
    type: t.format_type,
    sub: t.sub_format,
    cat: t.broad_category || 'general',
    style: t.brand_style || 'utility',
    desc: t.description?.substring(0, 100),
    ...(t.photography_style && { photo: t.photography_style }),
    ...(t.text_density && { textDensity: t.text_density }),
    ...(t.emotional_tone && { tone: t.emotional_tone }),
  }))

  // Determine brand style: aesthetic (visual-led) vs utility (feature/benefit-led)
  const brandCatLower = brandDna.category.toLowerCase()
  const isAesthetic = /fashion|apparel|clothing|footwear|shoe|sneaker|accessor|jewel|watch|sunglasses|home.*decor|furniture/i.test(brandCatLower)
  const brandStyle = isAesthetic ? 'aesthetic' : 'utility'

  const text = await callSonnet(
    apiKey,
    [
      {
        role: 'user',
        content: `Pick ${limit} ad templates for ${brandDna.name} (${brandDna.category}${brandDna.productType ? `, sells ${brandDna.productType}` : ''}).

Brand style: ${brandStyle} (${isAesthetic ? 'visual/lifestyle — prefer minimal text, image-led layouts' : 'feature/benefit-led — prefer templates with text overlays, claims, badges'})
${description ? `\nCREATIVE BRIEF (HIGH PRIORITY): "${description}"\nAnalyze this brief and pick templates that best serve the user's intent:\n- "% off" / "sale" / "discount" / "deal" → pick Discount/Offer, Price-Led, or Promo templates\n- "us vs them" / "comparison" / "versus" → pick Comparison or Before/After templates\n- "testimonial" / "review" / "social proof" → pick Social Proof or UGC templates\n- "feature" / "benefit" / "ingredient" → pick Feature & Benefits or Ingredient Spotlight templates\n- "lifestyle" / "aspirational" → pick Lifestyle or Hero Shot templates\n- General/unspecified → pick a diverse mix\nThe brief should be the PRIMARY driver of template selection.\n` : ''}
CATALOG (${index.length} templates):
${JSON.stringify(index)}

Each template has:
- "cat": broad category (supplements, food_beverage, beauty, fashion, footwear, accessories, home_kitchen, tech, pet, health_wellness, baby_kids, general)
- "style": aesthetic or utility
- "type": format type (Product Showcase, Feature & Benefits, etc.)

RULES:
1. ONLY pick templates whose "cat" matches the brand. A supplement brand should get supplements or health_wellness templates. A food brand should get food_beverage templates. NEVER cross categories (no fashion for supplements, no food for tech).
2. Prefer templates whose "style" matches: ${brandStyle}.
3. ${description ? 'MOST IMPORTANT: Pick templates that match the creative brief above. If the brief says "30% off", pick offer/discount layouts. If it says "us vs them", pick comparison layouts.' : 'Maximize variety in "type" — pick different format types.'}
4. Maximize variety in "type" — pick different format types within the brief's intent.
${previouslyUsedTemplates && previouslyUsedTemplates.length > 0 ? `5. AVOID REUSING: These templates were already used in previous batches — pick DIFFERENT templates unless there truly aren't enough options: [${previouslyUsedTemplates.slice(0, 30).join(', ')}]` : ''}
Return ONLY a JSON array of ${limit} filenames: ["file1.jpg", "file2.jpg"]. No duplicates.`,
      },
    ],
    1000
  )

  const results = JSON.parse(cleanJson(text)) as string[]
  // Deduplicate
  return [...new Set(results)].slice(0, limit)
}

// ============ Copy Generation (Sonnet - just writes ad text) ============

// Vision-based copy generation: Claude SEES the template, deeply understands its strategy,
// then produces context-aware text replacements + a validation pass.
async function generateAdCopy(
  apiKey: string,
  brandDna: BrandDna,
  template: CatalogTemplate,
  templateImageBase64: string | null,
  _assetDescriptions: string[],
  productImages: { base64: string; mimeType: string; desc: string }[],
  logos: UploadedAsset[],
  imageOffset: number,
  customCopy?: CustomCopy,
  customDescription?: string,
  previousHeadlines?: string[]
): Promise<string> {
  // brandFacts/featuresContext available from brandDna.keyBenefits + usps

  const content: any[] = []

  if (templateImageBase64) {
    let tplUrl = templateImageBase64.startsWith('data:') ? templateImageBase64 : toDataUrl(templateImageBase64, 'image/jpeg')
    tplUrl = await compressForApi(tplUrl)
    const imgData = stripDataUri(tplUrl)
    const templateMimeType = safeMediaType(undefined, tplUrl)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: templateMimeType, data: imgData },
    })
  }

  // Include actual product images so Claude can see what the product REALLY looks like
  for (const img of productImages.slice(0, 3)) {
    const imgData = stripDataUri(img.base64)
    const mt = safeMediaType(img.mimeType, img.base64)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mt, data: imgData },
    })
  }

  const productImageNote = productImages.length > 0
    ? `The NEXT ${productImages.length} image(s) are actual ${brandDna.name} product photos — study these carefully to see what the product REALLY looks like.`
    : ''

  const brandColorList = brandDna.colors.join(', ')
  const brandFonts = brandDna.fonts?.filter((f: string) => f && !f.includes('Not visible')) || []
  // Detect fonts by role tag — supports heading, subheading, body, cta, accent, display, mono
  const fontsByRole = new Map<string, string>()
  const untaggedFonts: string[] = []
  for (const f of brandFonts) {
    const roleMatch = f.match(/\s*\[(\w+)\]$/)
    if (roleMatch) {
      fontsByRole.set(roleMatch[1], f.replace(/\s*\[\w+\]$/, ''))
    } else {
      untaggedFonts.push(f)
    }
  }
  const headlineStyle = fontsByRole.has('heading')
    ? describeFontStyle(fontsByRole.get('heading')!)
    : fontsByRole.has('display')
      ? describeFontStyle(fontsByRole.get('display')!)
      : untaggedFonts.length > 0
        ? describeFontStyle(untaggedFonts[0])
        : 'bold clean'
  const bodyStyle = fontsByRole.has('body')
    ? describeFontStyle(fontsByRole.get('body')!)
    : untaggedFonts.length > 1
      ? describeFontStyle(untaggedFonts[1])
      : 'clean modern'
  const subheadingStyle = fontsByRole.has('subheading')
    ? describeFontStyle(fontsByRole.get('subheading')!)
    : headlineStyle
  const ctaStyle = fontsByRole.has('cta')
    ? describeFontStyle(fontsByRole.get('cta')!)
    : 'bold ' + bodyStyle

  // Build template metadata string so Claude knows the template structure even without great vision
  const templateMeta = [
    `Format: ${template.format_type}`,
    template.sub_format ? `Sub-format: ${template.sub_format}` : '',
    template.description ? `Description: ${template.description}` : '',
    template.layout ? `Layout: ${template.layout.orientation}, ${template.layout.sections}. Background: ${template.layout.background}. Text: ${template.layout.text_placement}` : '',
    template.text_elements?.length ? `Text elements: ${template.text_elements.join(', ')}` : '',
    template.visual_elements?.length ? `Visual elements: ${template.visual_elements.join(', ')}` : '',
    template.color_scheme ? `Original colors: ${template.color_scheme} (DO NOT USE — replace with brand colors)` : '',
    template.photography_style ? `Photo style: ${template.photography_style}` : '',
    template.emotional_tone ? `Tone: ${template.emotional_tone}` : '',
  ].filter(Boolean).join('\n')

  // Build product facts section
  const productFactsSection = brandDna.productFacts ? [
    brandDna.productFacts.macros ? `Macros: ${Object.entries(brandDna.productFacts.macros).filter(([,v]) => v).map(([k,v]) => `${v} ${k}`).join(', ')}` : '',
    brandDna.productFacts.claims?.length ? `Claims: ${brandDna.productFacts.claims.join(', ')}` : '',
    brandDna.productFacts.certifications?.length ? `Certifications: ${brandDna.productFacts.certifications.join(', ')}` : '',
    brandDna.productFacts.flavors?.length ? `Flavors: ${brandDna.productFacts.flavors.join(', ')}` : '',
  ].filter(Boolean).join('. ') : ''

  // Build trust elements from brand data (for badge/sticker recreation)
  const trustElements: string[] = []
  if (brandDna.productFacts?.certifications?.length) trustElements.push(...brandDna.productFacts.certifications)
  if (brandDna.productFacts?.claims?.length) trustElements.push(...brandDna.productFacts.claims)
  if (brandDna.guarantee) trustElements.push(brandDna.guarantee)

  // Build verified social proof section
  const sp = brandDna.socialProof
  const socialProofLines: string[] = []
  if (sp?.averageRating) socialProofLines.push(`VERIFIED RATING: ${sp.averageRating}${sp.customerCount ? ` (${sp.customerCount})` : ''}`)
  if (sp?.reviews?.length) {
    socialProofLines.push('VERIFIED REVIEWS (use these EXACT quotes, do NOT fabricate):')
    for (const r of sp.reviews.slice(0, 3)) {
      socialProofLines.push(`  - "${r.quote}"${r.author ? ` — ${r.author}` : ''}${r.source ? ` (${r.source})` : ''}`)
    }
  }
  if (sp?.pressQuotes?.length) {
    socialProofLines.push('PRESS QUOTES:')
    for (const pq of sp.pressQuotes.slice(0, 2)) {
      socialProofLines.push(`  - "${pq.quote}" — ${pq.publication}`)
    }
  }
  const socialProofSection = socialProofLines.length > 0 ? socialProofLines.join('\n') : ''
  const trustElementsList = trustElements.length > 0 ? trustElements.join(', ') : ''

  // Issue 4: Build image manifest for reference integrity
  const manifestLines: string[] = []
  if (templateImageBase64) manifestLines.push('- Image 1: TEMPLATE (layout reference only — do not copy content)')
  let mIdx = (templateImageBase64 ? 1 : 0) + 1
  for (const logo of logos.slice(0, 2)) {
    manifestLines.push(`- Image ${mIdx}: LOGO — ${logo.name}`)
    mIdx++
  }
  for (const img of productImages.slice(0, 3)) {
    manifestLines.push(`- Image ${mIdx}: PRODUCT — ${img.desc}`)
    mIdx++
  }
  const totalImages = mIdx - 1
  const imageManifest = manifestLines.join('\n')

  // Issue 7: Detect UI/screenshot templates
  const templateText = (template.format_type + ' ' + (template.description || '') + ' ' + (template.niches || []).join(' ')).toLowerCase()
  const isUITemplate = /dashboard|app\s*screenshot|ui\s*design|interface|saas\b|software|mobile\s*app|web\s*app/i.test(templateText)
  const uiTemplateNote = isUITemplate
    ? `\nNOTE: This template appears to be a UI/app screenshot. Focus ONLY on the overall LAYOUT structure (grid, sections, proportions, text placement zones) — ignore all interface elements, buttons, menus, form fields, data tables, and app-specific content. Treat it purely as a spatial arrangement guide.\n`
    : ''

  content.push({
    type: 'text',
    text: `You are building an image generation prompt by adapting a template ad for ${brandDna.name}. Work through 3 steps.

Image 1 is the TEMPLATE AD (for a different brand). ${productImageNote}

IMAGE MANIFEST (valid image references — use ONLY these):
${imageManifest}
Total attached images: ${totalImages}. Do NOT reference any Image number above ${totalImages}.

TEMPLATE INFO:
${templateMeta}

BRAND: ${brandDna.name} — ${brandDna.category}${brandDna.productType ? ` (${brandDna.productType})` : ''}
Voice: ${brandDna.voiceTone}
Benefits: ${brandDna.keyBenefits.join(', ')}
USPs: ${brandDna.usps.join(', ')}
Colors: ${brandColorList}
Font styles — Headline: ${headlineStyle}. Subheadline: ${subheadingStyle}. Body: ${bodyStyle}. CTA: ${ctaStyle}
${productFactsSection ? `Product facts: ${productFactsSection}` : ''}
${brandDna.guarantee ? `Guarantee: ${brandDna.guarantee}` : ''}
${trustElementsList ? `Trust elements (use for badges/stickers): ${trustElementsList}` : ''}
${customDescription ? `\n===== USER CREATIVE DIRECTION (HIGH PRIORITY) =====\nThe user has provided this creative brief — you MUST incorporate and ENHANCE these instructions. Amplify their intent with specific visual, copy, and layout decisions. If they reference specific images, products, angles, or tones, make those the DOMINANT theme of the ad. If they say to exclude something, absolutely exclude it.\n\nUser brief: "${customDescription}"\n===== END CREATIVE DIRECTION =====` : ''}
${customCopy?.headline ? `MUST use headline: "${customCopy.headline}"` : ''}
${customCopy?.cta ? `MUST use CTA: "${customCopy.cta}"` : ''}
${uiTemplateNote}${previousHeadlines?.length ? `\nDO NOT REPEAT these headlines/angles already used in this batch:\n${previousHeadlines.map((h: string) => `- "${h}"`).join('\n')}\nWrite a COMPLETELY DIFFERENT headline with a fresh angle and different wording.\n` : ''}
===== STEP 1: PARSE TEMPLATE INTO ELEMENTS =====
Look at the template image carefully. Extract EVERY visual element as a numbered list.
For EACH element, write one line in this exact format:
[N] TYPE | POSITION | CONTENT | PURPOSE

Types: BACKGROUND, BACKGROUND_TEXTURE, PRODUCT_IMAGE, INGREDIENT_IMAGE, LOGO, SOCIAL_PROOF_LOGO, HEADLINE, SUBHEADLINE, BODY_TEXT, TEXT_BOX, CTA_BUTTON, PRICE_TAG, BADGE, STICKER, SEAL, ICON, DECORATIVE, DIVIDER, SHAPE, OVERLAY, STAR_RATING, SOCIAL_PROOF, GUARANTEE, OTHER

If an element doesn't fit any listed type, use OTHER and still describe it fully — shape, color, placement, content, and purpose. ALL visual elements must be cataloged. Miss nothing.

Position: Use verbal zones only (top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right) + relative size (small, medium, large, full-width).

Content: What it actually says or shows (exact text, or describe the image/graphic). For ALL text elements, count the words and note it: e.g. '"BURN FAT WHILE YOU SLEEP" (5 words)'.

Purpose: What this element COMMUNICATES (e.g. "builds trust", "primary selling point", "brand identity", "call to action", "price anchor", "certification proof").

Example:
[1] BACKGROUND | full-frame | warm gradient cream to light peach | sets premium organic mood
[2] PRODUCT_IMAGE | center, large | bottle of supplement, close-up shot | hero product display
[3] LOGO | top-left, small | "Obvi" wordmark in pink | brand identity
[4] HEADLINE | top-center, large | "BURN FAT WHILE YOU SLEEP" | primary selling point
[5] BADGE | bottom-right, small | circular seal "NON-GMO" | certification proof
[6] SOCIAL_PROOF | bottom-center, medium | "TRUSTED BY OVER 200,000 CUSTOMERS" in banner | builds trust
[7] STAR_RATING | bottom-left, small | 5 gold stars with "4.8/5" | customer satisfaction proof
[8] CTA_BUTTON | bottom-center, medium | "SHOP NOW" in rounded button | call to action
[9] PRICE_TAG | center-right, small | "$1.33 per cup" | price anchor

List ALL elements. Miss nothing. Write this as "ELEMENTS:" followed by your numbered list.

===== STEP 2: MAP EACH ELEMENT TO BRAND =====
Now go through EVERY element from Step 1 and decide what to do with it. Write one line per element:
[N] ACTION → BRAND REPLACEMENT

Actions:
- KEEP → keep the visual element type but swap content for ${brandDna.name}
- REMOVE → delete this element entirely (only for category-specific, seasonal, placeholder, or watermark elements)
- ADAPT → keep the visual concept but reinterpret for ${brandDna.name}

Rules for each type:
- BACKGROUND → KEEP: describe new background using brand colors (${brandColorList})
- PRODUCT_IMAGE → KEEP: choose the BEST matching product image from the manifest. If template shows a close-up, pick a close-up product photo. If template shows product in-use/lifestyle, pick a lifestyle photo. If template shows packaging, pick a packaging shot. Reference by Image number. Do NOT use all product images — pick the 1-2 that best match the template's composition. CRITICAL: The product MUST be the EXACT attached photograph — never reimagine, redraw, illustrate, or recreate any version of the product. The image generator must PASTE the attached file pixels, not generate something that "looks like" the product.
- LOGO → ${logos.length > 0 ? `KEEP: replace with brand logo from manifest (reference exact Image number and filename). Brand name "${brandDna.name}" must ONLY appear via this logo image file, never as generated text.` : `REMOVE: no logo uploaded. Do not display brand name as text.`}
- HEADLINE → KEEP: write new headline for ${brandDna.name}. CRITICAL: count the words in the original and match that count (±1 word). If original is 4 words, write exactly 3-5 words.
- SUBHEADLINE → KEEP: write new subheadline using brand benefits/USPs. Match the original word count (±1 word).
- BODY_TEXT → KEEP: write new body copy from brand features. Match the original word count closely (±2 words). Do not expand a 6-word line into a 15-word paragraph.
- CTA_BUTTON → KEEP: write new CTA matching original word count.${customCopy?.cta ? ` MUST use: "${customCopy.cta}".` : ''}
- PRICE_TAG → ADAPT: if brand has equivalent pricing info, use it. Otherwise REMOVE.
- BADGE/STICKER/SEAL → KEEP: replace text with a real ${brandDna.name} claim.${trustElementsList ? ` Use from: ${trustElementsList}.` : ' Use brand benefits as claims.'}
- STAR_RATING → KEEP: ${sp?.averageRating ? `Use verified rating: ${sp.averageRating}${sp.customerCount ? ` (${sp.customerCount})` : ''}.` : 'show stars but remove specific numbers unless verified.'}
- SOCIAL_PROOF → ADAPT: ${socialProofSection ? 'Use ONLY the following VERIFIED social proof — do NOT fabricate reviews, stats, or quotes:\n' + socialProofSection : `replace with brand-appropriate trust statement.${brandDna.guarantee ? ` Can use: "${brandDna.guarantee}".` : ''}`}
- ICON → KEEP if generic (checkmark, leaf, etc.), REMOVE if category-specific to wrong industry.
- DIVIDER/SHAPE/OVERLAY → KEEP: re-color to brand colors.
- DECORATIVE → KEEP: re-color swirls, flourishes, or decorative graphics to brand colors (${brandColorList}). If brand-specific (another brand's visual identity), ADAPT to a similar decorative style in brand colors.
- BACKGROUND_TEXTURE → KEEP: describe the texture/pattern style (e.g. "subtle linen texture", "geometric pattern") but render in brand colors.
- SOCIAL_PROOF_LOGO → REMOVE unless ${brandDna.name} has equivalent publication features or partnerships. These are "as seen in" logos, not the brand's own logo.
- TEXT_BOX → KEEP: describe box shape, border style, shadow, corner radius. Re-color background and border to brand colors.
- INGREDIENT_IMAGE → ADAPT: replace with a brand-relevant ingredient or feature image description that matches ${brandDna.category}.
- OTHER → Decide KEEP, REMOVE, or ADAPT based on your analysis of the element's purpose. Explain your reasoning.
${customCopy?.headline ? `MUST use this headline: "${customCopy.headline}"` : ''}

Write this as "MAPPING:" followed by your replacement list.

===== STEP 3: WRITE FINAL PROMPT =====
Using your element mapping, write the FINAL image generation prompt as a structured element table. This goes directly to an image generator.

CRITICAL FORMATTING RULES:
- Do NOT include percentages, coordinates, or numbers like "50% x" or "40% y" — the image generator renders these as literal text on the image.
- Do NOT write font family names — describe the style instead (bold serif, clean sans-serif, etc.).
- Reference products and logos by Image number ONLY (1-${totalImages}).
- Keep under 200 words total.
- COPY LENGTH: Every text element must match the word count of the original template text it replaces (±1-2 words). A 3-word headline stays 3-4 words. A 6-word body line stays 5-7 words. Never inflate short copy into long sentences.
- SPELLING: Triple-check every single word. All text must be spelled correctly. No typos, no made-up words, no garbled text. If you write "protien" instead of "protein" or "Everthing" instead of "Everything", the ad is ruined. Verify each word before including it.
- NO CROPPING: Product photos and people must fit FULLY within the frame. Never place a product or person so they get cut off at the edge. Leave margin/breathing room on all sides.
- NO OVERLAP: Text blocks (and their background boxes) must NOT cover the product photo or key subject. Assign text and product to SEPARATE zones — e.g. text on the left, product on the right. If you need a text background for readability, keep it within the text zone only.
- Only use brand colors: ${brandColorList}.

Format as:
STRATEGY: [marketing angle] — [concept in 1 sentence, e.g. "Social proof authority play using customer count + trust badges"]
LAYOUT: [1-2 sentences: overall layout structure, how the frame is divided, mood]
Then a structured element table — one element per line, POSITION first:

| POSITION | ELEMENT | DETAILS |
| full-frame | background | [color/gradient description with hex codes] |
| [zone, size] | product photo | PASTE Image N AS-IS, UNMODIFIED — [placement: e.g. "filling right half"]. This is a REAL photograph. Do NOT redraw, reimagine, illustrate, or recreate. PASTE the exact attached file. |
${logos.length > 0 ? '| [zone, size] | logo | Image N (filename) — [placement description. Brand name ONLY via this file, never as text] |' : ''}
| [zone, size] | headline | "[exact text]" — [hex color], [font style], [weight] |
| [zone, size] | subheadline | "[exact text]" — [hex color], [font style] |
| [zone, size] | body text | "[exact text]" — [hex color], [font style] |
| [zone, size] | cta button | "[exact text]" — [button color hex], [text color hex] |
| [zone, size] | badge | [shape] with text "[exact short claim]" — [colors] |
| [zone, size] | sticker | [shape] with text "[exact short claim]" — [colors] |
| [zone, size] | decorative | [decorative element description] — [brand color hexes] |
| [zone, size] | background texture | [texture/pattern description] — [brand color hexes] |
| [zone, size] | text box | [box style: border, shadow, corners] containing "[text]" — [box color hex], [text color hex] |
| [zone, size] | ingredient image | [brand-relevant ingredient/feature description] |
[Include ONLY elements that exist in your mapping. Omit any row types not present.]

POSITION zones: top-left, top-center, top-right, center-left, center, center-right, bottom-left, bottom-center, bottom-right
POSITION sizes: small, medium, large, full-width, full-height`,
  })

  // Generate the 3-step prompt using Opus (best creative briefing)
  let result = await callOpus(apiKey, [{ role: 'user', content }], 2500)

  // Extract only the FINAL PROMPT (Step 3) — strip Steps 1-2 which were thinking
  // STRATEGY line comes before LAYOUT, so capture from STRATEGY if present
  if (result.includes('STRATEGY:') && result.includes('LAYOUT:') && result.includes('|')) {
    const stratIdx = result.lastIndexOf('STRATEGY:')
    result = result.substring(stratIdx)
  } else if (result.includes('LAYOUT:') && result.includes('|')) {
    const lastIdx = result.lastIndexOf('LAYOUT:')
    result = result.substring(lastIdx)
  } else if (result.includes('COMPOSITION:')) {
    // Fallback: old format
    const lastIdx = result.lastIndexOf('COMPOSITION:')
    result = result.substring(lastIdx)
  } else if (result.includes('FINAL PROMPT')) {
    result = result.substring(result.indexOf('FINAL PROMPT'))
    // Strip the header line itself
    const nextLine = result.indexOf('\n')
    if (nextLine > 0) result = result.substring(nextLine + 1).trim()
  }

  // Strip any leaked coordinate patterns that image generators render as literal text
  result = result.replace(/\b\d+%\s*[xX]\b/g, '').replace(/\b\d+%\s*[yY]\b/g, '').replace(/\s{2,}/g, ' ')

  // Build logo filename references for validation
  const logoFiles = logos.slice(0, 2).map((l, i) => ({
    imgNum: imageOffset + 1 + i,
    filename: l.name,
  }))
  const logoRefStr = logoFiles.length > 0
    ? logoFiles.map((l) => `Image ${l.imgNum} (${l.filename})`).join(', ')
    : ''

  // QA Pass — Sonnet sees the TEMPLATE IMAGE alongside the prompt to verify element fidelity
  try {
    const qaContent: any[] = []
    // Attach the template image so Sonnet can compare element-by-element
    if (templateImageBase64) {
      const templateData = stripDataUri(templateImageBase64)
      const templateMime = safeMediaType(undefined, templateImageBase64)
      qaContent.push({
        type: 'image',
        source: { type: 'base64', media_type: templateMime, data: templateData },
      })
    }

    const logoValidationRules = logoFiles.length > 0
      ? `1. BRAND NAME AS TEXT: "${brandDna.name}" must NEVER appear as display text in the ad. Every instance of the brand name should be replaced with a reference to the logo image file: "Place logo from ${logoFiles.map((l) => `Image ${l.imgNum} (${l.filename})`).join(' or ')}". The brand name can ONLY appear via the attached logo image, never as generated text.

2. LOGO REFERENCES: Logo references must include both Image number AND filename. Not just "logo" or "Image 2" — use "${logoFiles[0] ? `Image ${logoFiles[0].imgNum} (${logoFiles[0].filename})` : ''}". The logo can be recolored to match brand palette but must use the actual logo file.`
      : `1. NO LOGO ATTACHED: There is no logo image attached. Remove ALL references to a logo, brand logo, or brand name display. The brand name "${brandDna.name}" should NOT appear as visible text anywhere since there is no logo file to reference.

2. LOGO REFERENCES: Remove any "Image N" references that claim to be a logo — no logo was provided.`

    qaContent.push({
      type: 'text',
      text: `${templateImageBase64 ? 'The attached image is the ORIGINAL TEMPLATE. ' : ''}QA this image generation prompt for ${brandDna.name}. Brand colors: ${brandColorList}.

LOGO FILES: ${logoRefStr || 'NONE — no logo attached'}

PROMPT TO QA:
${result}

${templateImageBase64 ? `ELEMENT-BY-ELEMENT COMPARISON (most important):
Look at every text element visible in the template image. For each one, find its replacement in the prompt table.
- Count the words in the original template text vs the replacement text
- If a headline in the template is 3-5 words, the replacement MUST be 3-5 words
- If a subheadline in the template is ~8 words, the replacement should be 6-10 words
- If a body text line is ~6 words, do NOT expand it to 15+ words
- If a CTA button says "SHOP NOW" (2 words), the replacement should be 2-3 words
- Shorten ANY replacement that is significantly longer than the original
- Also verify EVERY visible element in the template has a corresponding row in the table (nothing missed)
- Verify element positions match where they actually appear in the template image
` : ''}
Also check:

${logoValidationRules}

3. PRODUCT REFERENCES: Products must reference specific Image numbers. Never say "a product" — say "the product from Image 4".

4. TEMPLATE COLORS LEAKING: Any hex color NOT in ${brandColorList}? Replace with nearest brand color.

5. REPEATED INFO: Same fact mentioned twice? Deduplicate.

6. FORBIDDEN CONTENT: Remove any font family names (e.g. "Montserrat", "Open Sans"), placeholder text ("Lorem ipsum", "[YOUR TEXT]", "XX%"). Trust badges and certification claims ARE allowed.

7. IMAGE REFERENCES: Every "Image N" reference must be in range 1-${totalImages}. Flag and fix any references to images that don't exist (e.g. "Image ${totalImages + 1}" or higher).

8. LEAKED COORDINATES: Remove any literal percentage coordinates like "50% x", "40% y", "centered at 50%x 40%y". Use verbal positions instead (top-left, center, bottom-right, etc.).

9. ELEMENT LOGIC: Check that no element was replaced with something nonsensical (e.g. a logo slot replaced with a guarantee claim, a price tag replaced with a certification, a DECORATIVE element turned into text, an INGREDIENT_IMAGE replaced with unrelated imagery). Each replacement must match the PURPOSE of the original. DECORATIVE stays decorative. TEXT_BOX stays a styled container. INGREDIENT_IMAGE shows brand-relevant ingredients.

If ANY issues found, output "FIXED:" then the corrected full prompt (keep the LAYOUT: + table format). If perfectly clean, output "OK".`,
    })

    const validationResult = await callSonnet(apiKey, [
      { role: 'user', content: qaContent },
    ], 1500)

    if (validationResult.startsWith('FIXED:')) {
      let fixed = validationResult.slice(6).trim()
      if (fixed.includes('LAYOUT:') && fixed.includes('|')) {
        fixed = fixed.substring(fixed.indexOf('LAYOUT:'))
      } else if (fixed.includes('COMPOSITION:')) {
        fixed = fixed.substring(fixed.indexOf('COMPOSITION:'))
      }
      result = fixed
      console.log('Prompt QA fixed issues')
    } else {
      console.log('Prompt QA passed clean')
    }
  } catch (e) {
    console.warn('Prompt QA skipped:', e)
  }

  // Prepend anti-leakage preamble — tells Gemini to NEVER copy template logos, text, or branding
  const antiLeakage = `CRITICAL RULES FOR IMAGE 1 (TEMPLATE):
Image 1 is a LAYOUT REFERENCE from a DIFFERENT brand. Use it ONLY for spatial arrangement (where elements go, relative sizes, composition flow).
NEVER COPY from the template: logos, brand names, watermarks, seasonal text ("Holiday Sale", "Summer Collection", etc.), promotional text, URLs, social handles, QR codes, or any text/branding that belongs to the template's original brand.
The ONLY brand name, logo, and text in the output must be for ${brandDna.name}. If the template has a logo in a corner, put the ${brandDna.name} logo there instead (from the attached logo image). If no logo image is attached, leave that spot empty or use a decorative element.
ALL text in the output must be freshly written for ${brandDna.name} as specified below. Zero template text should survive.\n\n`

  return antiLeakage + result
}

// ============ Concept Adaptation ============

// Reinterpret template concepts for the brand's category so they make sense
function getConceptAdaptation(template: CatalogTemplate, brandDna: BrandDna): string | null {
  const format = template.format_type
  const category = (brandDna.category || '').toLowerCase()
  const isFood = /food|beverage|nutrition|snack|protein|supplement|drink|bar|powder|cereal|coffee|tea/i.test(category)
  // isBeauty available: /beauty|skincare|cosmetic|makeup|personal\s*care/i.test(category)
  const isTech = /tech|software|saas|app|platform/i.test(category)

  if (format === 'Before/After' && isFood) {
    return 'CONCEPT NOTE: This is a before/after format. For a food product, show "before" as the boring/unhealthy alternative and "after" as the product being the better choice. Do NOT show body transformation. Show product comparison instead.'
  }

  if (format === 'Before/After' && isTech) {
    return 'CONCEPT NOTE: This is a before/after format. For a tech product, show "before" as the old/complicated way and "after" as the easy/modern solution with the product.'
  }

  if (format === 'Us vs Them' && isFood) {
    return 'CONCEPT NOTE: This is a comparison format. Compare the product vs typical alternatives in the food category (e.g. nutrition facts, ingredients, taste). Do NOT compare bodies or appearances.'
  }

  if (format === 'Problem/Solution' && isFood) {
    return 'CONCEPT NOTE: Frame the problem as a food/nutrition problem (e.g. "tired of bland protein bars?") and the solution as this product.'
  }

  if (format === 'Testimonial/Review') {
    const realReviews = brandDna.socialProof?.reviews
    if (realReviews?.length) {
      const reviewText = realReviews.slice(0, 2).map(r => `"${r.quote}"${r.author ? ` — ${r.author}` : ''}`).join(' OR ')
      return `CONCEPT NOTE: Use one of these REAL customer reviews for ${brandDna.name}: ${reviewText}. Do NOT fabricate quotes.`
    }
    return `CONCEPT NOTE: Adapt the testimonial to be about ${brandDna.name} products. The quote should sound like a real customer review for ${brandDna.category}.`
  }

  return null
}

// Convert font names to style descriptions so Gemini doesn't render font names as text
function describeFontStyle(fontName: string): string {
  if (!fontName) return 'clean modern typeface'
  const lower = fontName.toLowerCase()
  const parts: string[] = []

  // Weight
  if (/bold|black|heavy|extrabold/i.test(lower)) parts.push('bold')
  else if (/semi\s*bold|medium/i.test(lower)) parts.push('medium-weight')
  else if (/light|thin|hairline/i.test(lower)) parts.push('light-weight')

  // Classification
  if (/mono/i.test(lower)) parts.push('monospace')
  else if (/grotesk|grotesque|gothic|futura|avant/i.test(lower)) parts.push('geometric sans-serif')
  else if (/helvetica|arial|inter|roboto|open.?sans|lato|nunito|poppins|montserrat|proxima|source.?sans|dm.?sans|work.?sans/i.test(lower)) parts.push('clean sans-serif')
  else if (/sans/i.test(lower)) parts.push('sans-serif')
  else if (/slab|rockwell|courier|roboto.?slab/i.test(lower)) parts.push('slab-serif')
  else if (/playfair|garamond|georgia|times|baskerville|didot|bodoni|caslon|merriweather|lora|dm.?serif/i.test(lower)) parts.push('elegant serif')
  else if (/serif/i.test(lower)) parts.push('serif')

  // Shape modifiers
  if (/condensed|narrow|compressed/i.test(lower)) parts.push('condensed')
  if (/extended|wide/i.test(lower)) parts.push('wide')
  if (/rounded/i.test(lower)) parts.push('rounded')
  if (/display|poster|impact/i.test(lower)) parts.push('display')
  if (/script|cursive|brush|handwrit|pacifico|dancing/i.test(lower)) parts.push('handwritten script')
  if (/italic/i.test(lower)) parts.push('italic')
  if (/stencil/i.test(lower)) parts.push('stencil')

  if (parts.length === 0) parts.push('clean modern')
  return parts.join(' ')
}

// ============ Prompt Construction ============

export interface GenerationPromptResult {
  prompt: string
  selectedAssetIds: string[]  // IDs of assets Claude referenced for this concept
}

export async function buildGenerationPrompt(
  apiKey: string,
  brandDna: BrandDna,
  template: CatalogTemplate,
  assets: UploadedAsset[],
  aspectRatio: AspectRatio,
  hasTemplateImage: boolean,
  templateImageBase64: string | null,
  customCopy?: CustomCopy,
  customDescription?: string,
  previousHeadlines?: string[]
): Promise<GenerationPromptResult> {
  // Step 1: Build image numbering + asset descriptions
  const logos = assets.filter((a) => a.analysis?.assetType === 'logo')
  const productAssets = assets.filter((a) => a.base64 && a.analysis?.assetType !== 'logo')
  const imageOffset = hasTemplateImage ? 1 : 0
  const logoCount = Math.min(logos.length, 2)
  const productCount = Math.min(productAssets.length, 6)

  const logoRef = logoCount > 0
    ? `Images ${imageOffset + 1}${logoCount > 1 ? `-${imageOffset + logoCount}` : ''}`
    : null
  const productRef = productCount > 0
    ? `Images ${imageOffset + logoCount + 1}${productCount > 1 ? `-${imageOffset + logoCount + productCount}` : ''}`
    : null

  // Build detailed asset descriptions for Claude and Gemini
  const assetDescriptions: string[] = []
  let imgNum = imageOffset + 1
  for (const logo of logos.slice(0, 2)) {
    const desc = logo.analysis?.description || logo.name
    assetDescriptions.push(`Image ${imgNum}: LOGO — ${desc}`)
    imgNum++
  }
  for (const asset of productAssets.slice(0, 6)) {
    const desc = asset.analysis?.description || asset.name
    const type = asset.analysis?.assetType || 'product photo'
    assetDescriptions.push(`Image ${imgNum}: ${type.toUpperCase()} — ${desc}`)
    imgNum++
  }

  // Step 2: Prepare product images for Claude — compress oversized images, convert unsupported formats
  const productImagesForClaude: { base64: string; mimeType: string; desc: string }[] = []
  for (const asset of productAssets.slice(0, 3)) {
    if (asset.base64) {
      let dataUrl = asset.base64.startsWith('data:') ? asset.base64 : toDataUrl(asset.base64, asset.mimeType || 'image/jpeg')
      if (!isApiSupportedFormat(dataUrl)) dataUrl = await convertToJpeg(dataUrl)
      dataUrl = await compressForApi(dataUrl)
      productImagesForClaude.push({
        base64: dataUrl,
        mimeType: safeMediaType(undefined, dataUrl),
        desc: asset.analysis?.description || asset.name,
      })
    }
  }

  // Step 3: Claude SEES the template + product images and writes a standalone creative prompt
  const standalonePrompt = await generateAdCopy(
    apiKey, brandDna, template, templateImageBase64,
    assetDescriptions, productImagesForClaude, logos, imageOffset,
    customCopy, customDescription, previousHeadlines
  )

  // Step 4: Concept adaptation
  const conceptNote = getConceptAdaptation(template, brandDna)

  // Compute font style descriptions for Gemini (same logic as in generateAdCopy)
  const brandFontsForGemini = brandDna.fonts?.filter((f: string) => f && !f.includes('Not visible')) || []
  const fontsByRoleG = new Map<string, string>()
  const untaggedFontsG: string[] = []
  for (const f of brandFontsForGemini) {
    const roleMatch = f.match(/\s*\[(\w+)\]$/)
    if (roleMatch) fontsByRoleG.set(roleMatch[1], f.replace(/\s*\[\w+\]$/, ''))
    else untaggedFontsG.push(f)
  }
  const gHeadline = fontsByRoleG.has('heading') ? describeFontStyle(fontsByRoleG.get('heading')!)
    : fontsByRoleG.has('display') ? describeFontStyle(fontsByRoleG.get('display')!)
    : untaggedFontsG.length > 0 ? describeFontStyle(untaggedFontsG[0]) : ''
  const gBody = fontsByRoleG.has('body') ? describeFontStyle(fontsByRoleG.get('body')!)
    : untaggedFontsG.length > 1 ? describeFontStyle(untaggedFontsG[1]) : ''
  const gCta = fontsByRoleG.has('cta') ? describeFontStyle(fontsByRoleG.get('cta')!) : ''
  const hasFontInfo = gHeadline || gBody

  // Step 5: Build the final Gemini prompt — SHORT and DIRECT
  // NanoBanana gets lost in long prompts. Product placement must be the LOUDEST instruction.
  const lines: string[] = []

  // *** PRODUCT PLACEMENT FIRST — most important instruction ***
  if (productRef) {
    lines.push(`CRITICAL: The attached product photos are REAL photographs. PASTE them AS-IS into the ad — exact pixels, exact colors. NEVER redraw, reimagine, or generate any product. You may slightly adjust angle or lighting but the product must be the REAL attached photo, not a recreation.`)
    lines.push('')
  }

  // Logo
  if (logoRef) {
    const logoFileNames = logos.slice(0, 2).map((l, i) => `Image ${imageOffset + 1 + i} (${l.name})`).join(', ')
    lines.push(`LOGO: Place the exact logo from ${logoFileNames}. Do NOT generate text for "${brandDna.name}" — only use this logo image.`)
    lines.push('')
  }

  // Template reference
  lines.push(`Create a ${aspectRatio} ad for ${brandDna.name}.`)
  if (hasTemplateImage) {
    lines.push('Image 1 = layout guide only. Match its spatial arrangement. Ignore all text/content from Image 1.')
  }
  lines.push('')

  // Concept adaptation (short)
  if (conceptNote) {
    lines.push(conceptNote)
    lines.push('')
  }

  // Claude's creative direction — THE core prompt
  lines.push(standalonePrompt)
  lines.push('')

  // NOTE: Creative brief is NOT echoed raw to Gemini — Claude already interpreted it
  // and wrote the full creative prompt above. Passing raw user text to Nano Banana
  // causes confusion and conflicting instructions.

  // Minimal rules — only the ones NanoBanana actually violates
  const fontRule = hasFontInfo
    ? `\n- FONTS: Headline text must use a ${gHeadline} typeface. ${gBody ? `Body/subheadline text must use a ${gBody} typeface.` : ''} ${gCta ? `CTA button text must use a ${gCta} typeface.` : ''} Do NOT write font names as visible text — just render the text in the described style.`
    : ''
  lines.push(`RULES:
- PRODUCT PHOTOS: PASTE the EXACT attached photo. Never redraw. Never generate "similar" products. Slight angle/lighting adjustments OK, but the product must come from the attached files.
- Colors: ${brandDna.colors.join(', ')} only.${fontRule}
- ALL TEXT MUST BE SPELLED CORRECTLY — no typos, no garbled words. Check every word.
- NO CROPPING: All product photos and people must be FULLY visible within the frame. Do not let any subject get cut off at edges. Leave breathing room around all subjects.
- NO OVERLAP: Text blocks and their backgrounds must NOT cover/obscure the product photo. Keep text zones and product zones in separate areas of the layout.`)

  // Repeat product placement at END — NanoBanana follows last instructions most
  if (productRef) {
    lines.push('')
    lines.push(`FINAL REMINDER — MANDATORY:
- Product photos are ${productRef} = REAL camera photographs. PASTE them into the ad AS-IS.
- NEVER redraw, illustrate, or reimagine any product. Use the EXACT attached photo files.
- If the product in your output does not look like the attached photograph, your output is WRONG.`)
  }

  const finalPrompt = lines.join('\n')

  // Parse which Image numbers Claude actually referenced → map to asset IDs
  const referencedImageNums = new Set<number>()
  const imageRefPattern = /Image\s+(\d+)/gi
  let refMatch
  while ((refMatch = imageRefPattern.exec(finalPrompt)) !== null) {
    referencedImageNums.add(parseInt(refMatch[1], 10))
  }

  const selectedAssetIds: string[] = []
  let assetIdx = imageOffset + 1  // start after template
  for (const logo of logos.slice(0, 2)) {
    if (referencedImageNums.has(assetIdx)) selectedAssetIds.push(logo.id)
    assetIdx++
  }
  for (const asset of productAssets.slice(0, 6)) {
    if (referencedImageNums.has(assetIdx)) selectedAssetIds.push(asset.id)
    assetIdx++
  }

  // Ensure at least 1 logo + 1 product always included
  if (!selectedAssetIds.some(id => logos.some(l => l.id === id)) && logos.length > 0) {
    selectedAssetIds.unshift(logos[0].id)
  }
  if (!selectedAssetIds.some(id => productAssets.some(p => p.id === id)) && productAssets.length > 0) {
    selectedAssetIds.push(productAssets[0].id)
  }

  return { prompt: finalPrompt, selectedAssetIds }
}

// ============ Edit Prompt Builder (Sonnet) ============
// Interprets user's raw region edit instructions, identifies which assets to attach,
// and rewrites into a clear Gemini-compatible edit prompt.

export async function buildEditPrompt(
  apiKey: string,
  rawInstructions: string,
  adImageBase64: string,
  assets: UploadedAsset[],
  brandDna: BrandDna,
): Promise<{ prompt: string; assetIds: string[] }> {
  const adBase64 = stripDataUri(adImageBase64)
  const adMime = detectMediaType(adImageBase64)

  // Build asset inventory for Sonnet
  const assetList = assets
    .filter(a => a.base64 && a.analysis)
    .slice(0, 8)
    .map(a => ({
      id: a.id,
      name: a.name,
      type: a.analysis!.assetType,
      desc: a.analysis!.description,
    }))

  const text = await callSonnet(apiKey, [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: adMime, data: adBase64 },
        },
        {
          type: 'text',
          text: `You are helping edit a generated ad for ${brandDna.name}. The user drew regions on the ad and wrote instructions.

USER'S RAW INSTRUCTIONS: "${rawInstructions}"

AVAILABLE BRAND ASSETS (by ID):
${assetList.map(a => `- ${a.id}: ${a.name} (${a.type}) — ${a.desc}`).join('\n')}

Your job:
1. Interpret what the user wants changed in the masked regions
2. If they reference products, logos, or real images, pick the best matching asset IDs from the list above
3. Rewrite their instructions into a clear, precise edit prompt for an image generation AI

Return JSON:
{"prompt": "Clear edit instructions referencing 'Images 3+' for any attached product/logo photos. Be specific about placement, size, and what to change.", "assetIds": ["id1", "id2"]}

If the user wants to replace an AI-generated product with the real one, your prompt MUST say: "Replace the product in this region with the REAL product photo from Image 3. PASTE the exact photograph, do not redraw."

Return ONLY valid JSON.`,
        },
      ],
    },
  ])

  try {
    return JSON.parse(cleanJson(text))
  } catch {
    // Fallback: pass through raw instructions, attach all product assets
    const productIds = assetList.filter(a => a.type !== 'logo').slice(0, 3).map(a => a.id)
    return { prompt: rawInstructions, assetIds: productIds }
  }
}

// ============ QA Check (Haiku - fast) ============

export async function qaCheckImage(
  apiKey: string,
  imageBase64: string,
  imageMimeType: string,
  _originalPrompt: string,
  brandDna: BrandDna,
  _templateDesc?: string
): Promise<{ passed: boolean; concerns: string; feedbackForRegeneration: string }> {
  const base64Data = stripDataUri(imageBase64)

  // Build allowlist of verified brand claims — broad sources
  const allowedClaims: string[] = []
  if (brandDna.productFacts?.claims) allowedClaims.push(...brandDna.productFacts.claims)
  if (brandDna.keyBenefits) allowedClaims.push(...brandDna.keyBenefits)
  if (brandDna.guarantee) allowedClaims.push(brandDna.guarantee)
  if (brandDna.usps) allowedClaims.push(...brandDna.usps)
  if (brandDna.adCreativeStyle?.offerPresentation) allowedClaims.push(brandDna.adCreativeStyle.offerPresentation)
  if (brandDna.competitiveDifferentiation) allowedClaims.push(brandDna.competitiveDifferentiation)
  if (brandDna.productFacts?.certifications) allowedClaims.push(...brandDna.productFacts.certifications)
  if (brandDna.socialProof?.averageRating) allowedClaims.push(brandDna.socialProof.averageRating)
  if (brandDna.socialProof?.customerCount) allowedClaims.push(brandDna.socialProof.customerCount)
  if (brandDna.featuresAndBenefits) allowedClaims.push(brandDna.featuresAndBenefits)
  const filteredClaims = allowedClaims.filter(Boolean)
  const claimsNote = filteredClaims.length > 0
    ? `\n- VERIFIED BRAND DATA (all of these are OK to show in any form): ${filteredClaims.join(' | ')}`
    : ''

  const text = await callSonnet(apiKey, [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: imageMimeType, data: base64Data },
        },
        {
          type: 'text',
          text: `QA check for a ${brandDna.name} ad (${brandDna.category}${brandDna.productType ? `, product: ${brandDna.productType}` : ''}). Brand colors: ${brandDna.colors.join(', ')}.

IMPORTANT: Focus on ACTUAL quality issues (misspellings, garbled text, wrong product, cropped elements). Do NOT flag creative choices — promotional offers from the brand, text styling, brand name placement, layout decisions are normal advertising. When in doubt, PASS.

FAIL for these critical issues:

1. MISSPELLED TEXT: Read EVERY word letter by letter. ANY misspelling = FAIL. Common AI mistakes: "Everthing" (Everything), "protien" (protein), "nutrtion" (nutrition), "premimum" (premium), "guarntee" (guarantee), "beaty" (beauty), swapped/missing/extra letters.

2. GARBLED TEXT: Nonsensical, scrambled, or unreadable text = FAIL.

3. CROPPED PRODUCT/PERSON: If any product, person, or key subject is cut off at the frame edge (head cropped, product sliced, body parts missing at border) = FAIL. Everything must be fully visible with breathing room from edges.

4. TEXT OVERLAPPING PRODUCT: If a text block, text background, or colored overlay covers/obscures the product or key subject = FAIL. Text and product must occupy separate zones.

5. EDGE MARGINS: If ANY text or product touches or nearly touches the frame edge (less than ~5% margin) = FAIL. Social platforms crop edges. All elements need safe-zone padding.

6. BRAND NAME MISSPELLED: If the brand name "${brandDna.name}" appears as text in the ad, that is FINE — brand names in advertising are completely normal. Only FAIL if the brand name is MISSPELLED (wrong letters, missing letters, extra letters). Correctly spelled brand name text = PASS.

7. WRONG/HALLUCINATED PRODUCT: The product in the ad must look like a REAL photograph (attached file), not an AI-generated illustration or reimagined version. Signs of hallucination: product shape/label/packaging looks different from what ${brandDna.name} actually sells (${brandDna.productType || brandDna.category}), distorted labels, wrong proportions, made-up branding, or an illustrated/painted style instead of photographic. If the product looks AI-generated rather than photographed = FAIL.

8. UNREADABLE CONTRAST: Text invisible or nearly invisible against background = FAIL.

9. FABRICATED CLAIMS: Only FAIL if the ad contains a factual claim that is CLEARLY INVENTED with NO basis in the brand research data below. Promotions, discounts, percentages, offers, and statistics from brand research are ALLOWED — they don't need exact string match ("52% OFF" and "Save 52%" are equivalent). If the claim could reasonably come from the brand's research, PASS.

10. FONT NAMES AS TEXT: Font names as visible text ("Grotesk", "Helvetica") = FAIL.

Note but do NOT fail for:
- Background/environment looking AI-generated (expected — only the PRODUCT must look photographic)
- Colors slightly off from brand palette (note which)
- Brand name appearing as text (that is normal advertising)
- Promotional offers that match brand research data${claimsNote}

Check every word, every edge, every overlap. Be thorough but fair.

Return JSON:
{"passed": true/false, "concerns": "list every issue found", "feedbackForRegeneration": "specific fix instructions for each issue: spelling corrections, repositioning for crops/margins, zone separation for overlaps"}
Return ONLY valid JSON.`,
        },
      ],
    },
  ])

  return JSON.parse(cleanJson(text))
}

// ============ Product Fidelity QA (Sonnet) ============
// Separate pass after text/composition QA — compares the product in the ad
// against real product photos and returns bounding boxes of distorted regions.

export interface ProductFidelityResult {
  fidelityOk: boolean
  regions: { x: number; y: number; w: number; h: number; description: string }[]
  overallAssessment: string
}

export async function checkProductFidelity(
  apiKey: string,
  adImageBase64: string,
  adMimeType: string,
  productImages: { base64: string; mimeType: string }[],
): Promise<ProductFidelityResult> {
  const content: any[] = []

  // Image 1: the generated ad
  let adData = adImageBase64.startsWith('data:') ? adImageBase64 : toDataUrl(adImageBase64, adMimeType)
  if (!isApiSupportedFormat(adData)) adData = await convertToJpeg(adData)
  adData = await compressForApi(adData)
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: safeMediaType(adMimeType, adData), data: stripDataUri(adData) },
  })
  content.push({ type: 'text', text: 'IMAGE 1 above: The generated ad creative.' })

  // Images 2+: real product photos
  for (let i = 0; i < Math.min(productImages.length, 3); i++) {
    let pData = productImages[i].base64.startsWith('data:')
      ? productImages[i].base64
      : toDataUrl(productImages[i].base64, productImages[i].mimeType)
    if (!isApiSupportedFormat(pData)) pData = await convertToJpeg(pData)
    pData = await compressForApi(pData)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: safeMediaType(productImages[i].mimeType, pData), data: stripDataUri(pData) },
    })
    content.push({ type: 'text', text: `IMAGE ${i + 2} above: Real product photograph ${i + 1}.` })
  }

  content.push({
    type: 'text',
    text: `You are a product fidelity inspector for ad creatives. Compare the product as it appears in the generated ad (Image 1) against the real product photographs (Images 2+).

IMPORTANT: You are looking for NOTABLE distortions only. These are problems worth fixing:
- Product shape is wrong (melted, warped, stretched, squished)
- Product is completely the wrong item or has hallucinated features
- Product colors are drastically wrong (not just slight tinting from ad lighting)
- Product is missing key recognizable features (wrong label, missing handle, etc.)
- Product proportions are clearly off (too fat, too thin, wrong aspect ratio)

These are NOT problems — IGNORE these:
- Slight blur or softness (normal for AI generation)
- Minor color shifts from ad lighting/mood
- Stylistic reinterpretation that still looks like the product
- Product shown from a different angle than the reference photos
- Text on product packaging being slightly different
- Product appearing smaller or larger than in photos
- Background/context changes around the product

For each distorted product region, return bounding box coordinates as percentages (0.0 to 1.0) relative to the ad image dimensions:
- x: left edge of the region
- y: top edge of the region
- w: width of the region
- h: height of the region

Make the bounding box generous — include some margin around the distorted product so the replacement has room.

Return JSON:
{
  "fidelityOk": true/false,
  "regions": [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "description": "Product bottle is melted/warped"}],
  "overallAssessment": "Brief description of what's wrong (or 'Products look accurate')"
}

If the product looks fine (even if not perfect), set fidelityOk: true and return empty regions.
Return ONLY valid JSON.`,
  })

  try {
    const text = await callSonnet(apiKey, [{ role: 'user', content }], 800)
    const result = JSON.parse(cleanJson(text))
    console.log(`Product fidelity check: ${result.fidelityOk ? 'OK' : 'FAILED'} — ${result.overallAssessment}`)
    return result
  } catch (e) {
    console.warn('Product fidelity check failed, assuming OK:', e)
    return { fidelityOk: true, regions: [], overallAssessment: 'Check failed — skipped' }
  }
}

// ============ Brand Guide Analysis (Sonnet) ============

export async function analyzeBrandGuide(
  apiKey: string,
  content: string,
  mimeType: string,
  base64?: string
): Promise<string> {
  const messages: any[] = []

  if (base64 && mimeType.startsWith('image/')) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: stripDataUri(base64) },
        },
        {
          type: 'text',
          text: `Extract all brand guidelines from this document. Include: colors (hex codes), typography rules, logo usage, spacing, tone of voice, do's and don'ts. Return as structured text.`,
        },
      ],
    })
  } else {
    messages.push({
      role: 'user',
      content: `Extract brand guidelines from this content: colors, typography, tone, messaging, product details.\n\nContent:\n${content.substring(0, 10000)}`,
    })
  }

  return callSonnet(apiKey, messages, 2000)
}
