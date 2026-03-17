import type { BrandDna, Persona, SocialProof } from '../types'

const JINA_READER_URL = 'https://r.jina.ai/'
const JINA_SEARCH_URL = 'https://s.jina.ai/'

// Icon/symbol fonts to filter out
const ICON_FONT = /font\s*awesome|material\s*icon|icomoon|glyphicon|ionicon|feather|fontello|typicon|entypo|foundation.icon|dashicons|genericons|weathericon|fa-solid|fa-brand|fa-regular/i

// Normalize a raw font name: strip weight/style suffixes, add spaces, deduplicate families
function normalizeFontFamily(raw: string): string | null {
  if (!raw) return null
  if (ICON_FONT.test(raw)) return null
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|inherit|initial|unset|auto|-apple-system|BlinkMacSystemFont)$/i.test(raw)) return null
  if (raw.includes(',')) return null

  let name = raw.trim()

  // Strip PostScript weight/style suffix after hyphen: -Bold, -Lt, -BdCn20, -01
  const sfx = /[-](Bold|Italic|Light|Thin|Medium|Heavy|Black|Regular|Normal|Semi[Bb]old|Demi[Bb]old|Extra[Bb]old|Extra[Ll]ight|Ultra[Ll]ight|Condensed|Extended|Compressed|Narrow|Wide|Oblique|Slanted|BoldItalic|LightItalic|ThinItalic|MediumItalic|UltraLightItalic|CondensedBlack|CondensedBold|Bd|Lt|Rg|Hv|Cn|Md|Bk|It|Ob|BdCn\d*|Cn\d*|\d{1,2})$/
  name = name.replace(sfx, '')
  name = name.replace(sfx, '') // second pass for compound suffixes

  // Insert spaces: camelCase "HelveticaNeue" → "Helvetica Neue"
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2')
  // Uppercase run before capitalized word: "LTPro" → "LT Pro"
  name = name.replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')

  // Strip trailing optical size numbers: "Trade Gothic 18" → "Trade Gothic"
  if (name.length > 5) name = name.replace(/\s+\d{1,2}$/, '')

  name = name.replace(/[-_]+$/, '').trim()
  if (!name || name.length < 2) return null
  return name
}

// Extract first font name from CSS value like '"Trade Gothic", sans-serif'
function cleanCssFontValue(val: string): string {
  return val.split(',')[0].trim().replace(/['"]/g, '')
}

// Extract fonts from raw HTML — normalize, detect heading/body roles
function extractFontsFromHtml(html: string): string[] {
  const rawFamilies = new Set<string>()
  let headingFont: string | null = null
  let bodyFont: string | null = null

  // METHOD 1: CSS custom properties (Shopify themes, modern frameworks)
  const headingVar = html.match(/--font-heading[^:]*:\s*["']?([^"';},]+)/i)
  const bodyVar = html.match(/--font-body[^:]*:\s*["']?([^"';},]+)/i)
  if (headingVar) headingFont = normalizeFontFamily(cleanCssFontValue(headingVar[1]))
  if (bodyVar) bodyFont = normalizeFontFamily(cleanCssFontValue(bodyVar[1]))

  // METHOD 2: CSS rules for h1-h6 and body/p selectors
  if (!headingFont) {
    const headingCss = html.match(/h[1-3][^{]*\{[^}]*font-family:\s*['"]?([^'";},]+)/i)
    if (headingCss) headingFont = normalizeFontFamily(cleanCssFontValue(headingCss[1]))
  }
  if (!bodyFont) {
    const bodyCss = html.match(/(?:body|\.body-text|p\b)[^{]*\{[^}]*font-family:\s*['"]?([^'";},]+)/i)
    if (bodyCss) bodyFont = normalizeFontFamily(cleanCssFontValue(bodyCss[1]))
  }

  // Collect all declared font families
  const ffBlocks = html.match(/@font-face\s*\{[^}]+\}/gi) || []
  for (const block of ffBlocks) {
    const fam = block.match(/font-family:\s*['"]([^'"]+)['"]/i)
    if (fam) rawFamilies.add(fam[1].trim())
  }

  if (rawFamilies.size === 0) {
    const cssRegex = /font-family:\s*['"]([^'"]+)['"]/gi
    let match
    while ((match = cssRegex.exec(html)) !== null) {
      rawFamilies.add(match[1].trim())
    }
  }

  // Normalize and deduplicate
  const familySet = new Set<string>()
  for (const raw of rawFamilies) {
    const norm = normalizeFontFamily(raw)
    if (norm) familySet.add(norm)
  }

  // Build result: heading font first (prefixed), body font second (prefixed), then rest
  const result: string[] = []
  if (headingFont) {
    result.push(`${headingFont} [heading]`)
    familySet.delete(headingFont)
  }
  if (bodyFont && bodyFont !== headingFont) {
    result.push(`${bodyFont} [body]`)
    familySet.delete(bodyFont)
  }
  for (const fam of familySet) {
    if (!result.includes(fam)) result.push(fam)
  }

  return result
}

// Neutral colors to ignore — utility/layout colors, not brand colors
const NEUTRAL_COLORS = new Set([
  '#FFFFFF', '#000000', '#111111', '#222222', '#333333', '#444444', '#555555',
  '#666666', '#777777', '#888888', '#999999', '#AAAAAA', '#BBBBBB', '#CCCCCC',
  '#DDDDDD', '#EEEEEE', '#F5F5F5', '#E5E5E5', '#FAFAFA', '#F0F0F0', '#D9D9D9',
  '#3A3A3A', '#1A1A1A', '#2C2C2C', '#4A4A4A', '#F4F4F4', '#E1E3E4', '#EFEDED',
  '#F8F8F8', '#F9F9F9', '#FBFBFB', '#E0E0E0', '#C0C0C0', '#808080', '#A0A0A0',
  '#1D1D1D', '#2D2D2D', '#3D3D3D', '#4D4D4D', '#5D5D5D', '#6D6D6D',
])

// Common framework/library colors — NOT brand colors
const FRAMEWORK_COLORS = new Set([
  // Bootstrap
  '#0D6EFD', '#6610F2', '#6F42C1', '#D63384', '#DC3545', '#FD7E14', '#FFC107',
  '#198754', '#20C997', '#0DCAF0', '#6C757D', '#212529',
  // Tailwind defaults
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4',
  '#6366F1', '#14B8A6', '#F97316', '#A855F7', '#E11D48',
  // Shopify
  '#5C6AC4', '#006FBB', '#008060', '#96BF48',
  // Common UI states
  '#FF0000', '#00FF00', '#0000FF', '#FF4444', '#44FF44', '#4444FF',
  '#28A745', '#17A2B8', '#FFC107', '#DC3545', // success/info/warning/danger
])

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function isNeutral(hex: string): boolean {
  if (NEUTRAL_COLORS.has(hex)) return true
  const [r, g, b] = parseHex(hex)
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  // Wider threshold catches near-grays, off-whites, near-blacks
  if (spread < 25) return true
  // Very light desaturated colors (near-white pastels) — not brand colors
  if (r > 230 && g > 230 && b > 230) return true
  // Very dark near-blacks
  if (r < 30 && g < 30 && b < 30) return true
  return false
}

function isFrameworkColor(hex: string): boolean {
  if (FRAMEWORK_COLORS.has(hex)) return true
  // Check if it's very close to a framework color (within distance 15)
  for (const fc of FRAMEWORK_COLORS) {
    if (colorDistance(hex, fc) < 15) return true
  }
  return false
}

/** Cluster similar colors, keeping the highest-scored representative */
function clusterColors(entries: [string, number][], threshold = 35): [string, number][] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1])
  const clusters: [string, number][] = []

  for (const [hex, score] of sorted) {
    const existing = clusters.find(([ch]) => colorDistance(ch, hex) < threshold)
    if (existing) {
      // Merge score into the existing cluster leader
      existing[1] += score
    } else {
      clusters.push([hex, score])
    }
  }

  return clusters.sort((a, b) => b[1] - a[1])
}

// Extract brand colors from raw HTML/CSS — context-aware scoring with clustering
function extractColorsFromHtml(html: string): string[] {
  const colorScores = new Map<string, number>()

  function addColor(hex: string, weight: number) {
    const upper = hex.toUpperCase()
    if (isNeutral(upper) || isFrameworkColor(upper)) return
    colorScores.set(upper, (colorScores.get(upper) || 0) + weight)
  }

  // PRIORITY 1: CSS custom properties — strongest brand signal
  const cssVarRegex = /--(?:color-?(?:brand|primary|accent|secondary|button|cta|link|heading|text-heading)|brand-?color|primary-?color|accent-?color)[^:]*:\s*#([0-9a-fA-F]{6})\b/gi
  let match
  while ((match = cssVarRegex.exec(html)) !== null) {
    addColor('#' + match[1], 60)
  }

  // Also catch broader CSS var patterns: --theme-*, --site-*, --global-*
  const broadVarRegex = /--(?:theme|site|global|shop|store)-[^:]*?(?:color|bg|background|accent|primary|brand)[^:]*:\s*#([0-9a-fA-F]{6})\b/gi
  while ((match = broadVarRegex.exec(html)) !== null) {
    addColor('#' + match[1], 50)
  }

  // PRIORITY 2: Header/nav — brand identity zone
  const headerBlocks = html.match(/<(?:header|nav)[^>]*style=["'][^"']*["']/gi) || []
  for (const block of headerBlocks) {
    const hexes = block.match(/#[0-9a-fA-F]{6}\b/g) || []
    for (const h of hexes) addColor(h, 30)
  }
  const headerCss = html.match(/(?:header|nav|\.header|\.nav|\.navbar|#header|#nav)[^{]*\{[^}]*\}/gi) || []
  for (const rule of headerCss) {
    const hexes = rule.match(/#[0-9a-fA-F]{6}\b/g) || []
    for (const h of hexes) addColor(h, 30)
  }

  // PRIORITY 3: Button/CTA backgrounds — strong brand signal
  const btnCss = html.match(/(?:\.btn|\.button|\.cta|button|a\.btn|\.add-to-cart|\.shopify-payment-button)[^{]*\{[^}]*\}/gi) || []
  for (const rule of btnCss) {
    const bgMatch = rule.match(/background(?:-color)?:\s*#([0-9a-fA-F]{6})/i)
    if (bgMatch) addColor('#' + bgMatch[1], 25)
  }

  // PRIORITY 4: Link and heading colors
  const linkCss = html.match(/(?:^|\s)a\s*\{[^}]*\}/gim) || []
  for (const rule of linkCss) {
    const colorMatch = rule.match(/(?:^|;)\s*color:\s*#([0-9a-fA-F]{6})/i)
    if (colorMatch) addColor('#' + colorMatch[1], 20)
  }
  const headingCss = html.match(/h[1-6][^{]*\{[^}]*\}/gi) || []
  for (const rule of headingCss) {
    const colorMatch = rule.match(/(?:^|;)\s*color:\s*#([0-9a-fA-F]{6})/i)
    if (colorMatch) addColor('#' + colorMatch[1], 20)
  }

  // PRIORITY 5: Footer backgrounds
  const footerCss = html.match(/(?:footer|\.footer|#footer)[^{]*\{[^}]*\}/gi) || []
  for (const rule of footerCss) {
    const bgMatch = rule.match(/background(?:-color)?:\s*#([0-9a-fA-F]{6})/i)
    if (bgMatch) addColor('#' + bgMatch[1], 15)
  }

  // NO catch-all scan — that's where random colors came from

  // Cluster similar colors together, return top 5
  const clustered = clusterColors([...colorScores.entries()])
  return clustered.slice(0, 5).map(([c]) => c)
}

// Extract product gallery images from structured data in page HTML
function normalizeAvifUrl(u: string): string {
  if (u.includes('fm=avif')) return u.replace(/fm=avif/g, 'fm=jpg')
  if (u.includes('format=avif')) return u.replace(/format=avif/g, 'format=jpg')
  return u
}

function extractProductGalleryFromHtml(html: string): string[] {
  const images: string[] = []

  // 1. JSON-LD structured data (@type: Product/ProductGroup) — most reliable, cross-platform
  const ldScripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []
  for (const script of ldScripts) {
    try {
      const jsonStr = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim()
      const data = JSON.parse(jsonStr)
      collectProductImages(data, images)
    } catch { /* malformed JSON-LD */ }
  }
  if (images.length > 0) return [...new Set(images.map(normalizeAvifUrl))]

  // 2. __NEXT_DATA__ (Next.js sites: lululemon, Nike, etc.) — deeply nested product images
  const nextDataMatch = html.match(/<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1])
      extractImagesFromNextData(nextData, images)
      if (images.length > 0) {
        console.log(`Found ${images.length} images from __NEXT_DATA__`)
        return [...new Set(images.map(normalizeAvifUrl))]
      }
    } catch { /* malformed JSON */ }
  }

  // 3. Generic embedded JSON state (window.__STATE__, window.__PRELOADED_STATE__, etc.)
  const stateRegex = /window\.__(?:STATE|PRELOADED_STATE|INITIAL_STATE|APP_DATA)__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/gi
  let stateMatch
  while ((stateMatch = stateRegex.exec(html)) !== null) {
    try {
      const state = JSON.parse(stateMatch[1])
      extractImagesFromDeepJson(state, images)
    } catch { /* skip */ }
  }
  if (images.length > 0) return [...new Set(images.map(normalizeAvifUrl))]

  // 4. Open Graph meta images (fallback — usually 1 hero image)
  const ogPatterns = [
    /<meta[^>]*property=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?::url)?["']/gi,
  ]
  for (const regex of ogPatterns) {
    let match
    while ((match = regex.exec(html)) !== null) {
      const url = match[1]
      if (url.startsWith('http') && !url.endsWith('.svg')) images.push(url)
    }
  }

  return [...new Set(images)]
}

/** Extract product images from Next.js __NEXT_DATA__ JSON (deeply nested) */
function extractImagesFromNextData(data: any, images: string[]): void {
  const json = JSON.stringify(data)
  // Find all image URLs that look like product images (CDN patterns)
  const urlRegex = /https?:\/\/[^"'\s]+?\/(?:is\/image|images|cdn)[^"'\s]*?(?:_\d+|\/\d+|product)[^"'\s]*/g
  let m
  while ((m = urlRegex.exec(json)) !== null) {
    let url = m[0].replace(/\\u002F/g, '/').replace(/\\/g, '')
    // Clean trailing punctuation
    url = url.replace(/[",}\]]+$/, '')
    if (url.startsWith('http') && !url.endsWith('.svg') && url.length < 500) {
      images.push(url)
    }
  }

  // Also look for imageInfo/mediaInfo arrays (lululemon-specific)
  try {
    const queries = data?.props?.pageProps?.dehydratedState?.queries
    if (Array.isArray(queries)) {
      for (const q of queries) {
        const qData = q?.state?.data
        if (!qData) continue
        // productCarousel (lululemon)
        if (qData.productCarousel) {
          for (const entry of qData.productCarousel) {
            if (entry.imageInfo) {
              for (const url of entry.imageInfo) {
                if (typeof url === 'string' && url.startsWith('http')) images.push(url)
              }
            }
            if (entry.mediaInfo) {
              for (const media of entry.mediaInfo) {
                if (media?.url && typeof media.url === 'string') images.push(media.url)
              }
            }
          }
        }
        // Generic product images in query data
        if (qData.images) {
          for (const img of Array.isArray(qData.images) ? qData.images : [qData.images]) {
            if (typeof img === 'string') images.push(img)
            else if (img?.url) images.push(img.url)
            else if (img?.src) images.push(img.src)
          }
        }
      }
    }
  } catch { /* skip nested extraction */ }
}

/** Recursively find image URLs in any deeply nested JSON object */
function extractImagesFromDeepJson(data: any, images: string[], depth = 0): void {
  if (depth > 8 || !data) return
  if (typeof data === 'string' && data.startsWith('http') && /\.(jpg|jpeg|png|webp)/i.test(data)) {
    images.push(data)
  }
  if (Array.isArray(data)) {
    for (const item of data.slice(0, 100)) extractImagesFromDeepJson(item, images, depth + 1)
  } else if (typeof data === 'object') {
    const imageKeys = ['image', 'images', 'imageUrl', 'imageUrls', 'src', 'url', 'photo', 'thumbnail', 'hero']
    for (const key of imageKeys) {
      if (data[key]) extractImagesFromDeepJson(data[key], images, depth + 1)
    }
  }
}

function collectProductImages(data: any, images: string[]): void {
  if (!data) return
  if (Array.isArray(data)) { data.forEach((d) => collectProductImages(d, images)); return }

  // Handle Product, ProductGroup, and IndividualProduct types
  const type = data['@type']
  const isProduct = type === 'Product' || type === 'ProductGroup' || type === 'IndividualProduct'

  if (isProduct) {
    // Direct image field
    const imgField = data.image
    if (Array.isArray(imgField)) {
      for (const img of imgField) {
        if (typeof img === 'string') images.push(img)
        else if (img?.url) images.push(img.url)
        else if (img?.contentUrl) images.push(img.contentUrl)
      }
    } else if (typeof imgField === 'string') {
      images.push(imgField)
    } else if (imgField?.url) {
      images.push(imgField.url)
    }

    // ProductGroup with variants (lululemon, Nike, etc.)
    if (data.hasVariant) {
      collectProductImages(data.hasVariant, images)
    }
    // Offers with images
    if (data.offers) {
      const offers = Array.isArray(data.offers) ? data.offers : [data.offers]
      for (const offer of offers) {
        if (offer.image) {
          if (typeof offer.image === 'string') images.push(offer.image)
          else if (offer.image?.url) images.push(offer.image.url)
        }
      }
    }
  }

  if (data['@graph']) collectProductImages(data['@graph'], images)
  if (data.mainEntity) collectProductImages(data.mainEntity, images)
}

// Bing Image Search via proxy — extracts real image URLs from Bing results HTML
// Works without JavaScript (unlike Google) and returns full-res original URLs
export async function webImageSearch(query: string, count = 10): Promise<string[]> {
  const urls: string[] = []
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(bingUrl)}`
    const resp = await fetch(proxyUrl)
    if (!resp.ok) return urls
    const html = await resp.text()

    // Bing embeds original URLs as murl (media URL) in HTML-encoded JSON
    const murlMatches = html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+)/gi)
    for (const m of murlMatches) {
      if (urls.length >= count) break
      let u = m[1].replace(/&amp;/g, '&')
      // Skip Bing's own assets and irrelevant domains
      if (u.includes('bing.com') || u.includes('microsoft.com')) continue
      if (!urls.includes(u)) urls.push(u)
    }

    console.log(`Bing Image Search "${query}": found ${urls.length} images`)
  } catch (e) {
    console.log(`Bing Image Search failed for "${query}":`, e)
  }
  return urls
}

// Fetch raw HTML — try proxy first, fall back to direct then Jina
async function fetchRawHtml(url: string): Promise<string> {
  // Attempt 1: Local proxy (server-side fetch — no CORS restrictions)
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
    const response = await fetch(proxyUrl)
    if (response.ok) {
      const text = await response.text()
      if (text.length > 500) return text
    }
  } catch { /* proxy unavailable */ }

  // Attempt 2: direct fetch (works when CORS allows it)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      redirect: 'follow',
    })
    if (response.ok) {
      const text = await response.text()
      if (text.length > 500) return text
    }
  } catch { /* CORS blocked */ }

  // Attempt 3: Jina Reader with HTML return format (preserves CSS/structured data)
  try {
    const response = await fetch(JINA_READER_URL + url, {
      headers: { Accept: 'text/html', 'X-Return-Format': 'html' },
    })
    if (response.ok) {
      const text = await response.text()
      if (text.length > 500) return text
    }
  } catch { /* Jina failure */ }

  return ''
}

// Fetch Shopify product JSON for reliable gallery images
async function fetchShopifyProductJson(url: string): Promise<{ images: string[]; title: string } | null> {
  if (!url.includes('/products/')) return null
  const jsonUrl = url.replace(/\?.*$/, '') + '.json'

  function parseShopifyJson(data: any): { images: string[]; title: string } | null {
    if (data.product?.images?.length) {
      // Deduplicate variant images by base filename and request 1200px width
      const seen = new Set<string>()
      const images: string[] = []
      for (const img of data.product.images) {
        const src: string = img.src || ''
        if (!src) continue
        // Normalize: strip size suffix and query params to detect duplicates
        const base = src.replace(/(_\d+x\d+|_\d+x)?\.(jpg|jpeg|png|webp|gif)/i, '.$2').split('?')[0]
        if (seen.has(base)) continue
        seen.add(base)
        // Request reasonable size (Shopify supports width param)
        const sized = src.includes('?') ? src + '&width=1200' : src + '?width=1200'
        images.push(sized)
      }
      console.log(`Shopify JSON: ${data.product.images.length} total → ${images.length} unique images`)
      return {
        images,
        title: data.product.title || '',
      }
    }
    return null
  }

  // Try via local proxy first (no CORS)
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(jsonUrl)}`
    const response = await fetch(proxyUrl)
    if (response.ok) {
      const text = await response.text()
      if (text.trim().startsWith('{')) {
        const result = parseShopifyJson(JSON.parse(text))
        if (result) return result
      }
    }
  } catch { /* proxy failure */ }

  // Try direct fetch (some Shopify stores allow CORS on .json)
  try {
    const response = await fetch(jsonUrl, {
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      const result = parseShopifyJson(await response.json())
      if (result) return result
    }
  } catch { /* CORS blocked */ }

  // Fallback for Shopify Hydrogen/headless: scrape product page HTML for images
  // Hydrogen sites don't support .json but still have Shopify CDN images in their HTML/scripts
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
    const resp = await fetch(proxyUrl)
    if (resp.ok) {
      const html = await resp.text()
      const cdnImages = new Set<string>()

      // Extract Shopify CDN image URLs from anywhere in the HTML (scripts, data attributes, etc.)
      // Match cdn.shopify.com AND any domain's /cdn/shop/ paths (BERO uses berobrewing.com/cdn/...)
      // Also match protocol-relative URLs (//domain.com/cdn/...)
      const cdnRegex = /(?:https?:)?\/\/(?:cdn\.shopify\.com\/s\/files|[a-z0-9.-]+\/cdn\/shop\/(?:files|products|images))\/[^"'\s<>),]+\.(?:jpg|jpeg|png|webp)/gi
      const allCdnImages: string[] = []
      let m
      while ((m = cdnRegex.exec(html)) !== null) {
        let imgUrl = m[0].replace(/&amp;/g, '&')
        // Normalize protocol-relative to https
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl
        // Strip srcset width descriptors (e.g. " 800w" at end)
        imgUrl = imgUrl.replace(/\s+\d+w$/, '')
        // Skip tiny icons, nav images, badges
        if (/icon|badge|payment|social|sprite|logo|favicon/i.test(imgUrl)) continue
        if (!cdnImages.has(imgUrl)) {
          cdnImages.add(imgUrl)
          allCdnImages.push(imgUrl)
        }
      }

      // Also extract from OG/meta tags — accept any image domain (not just cdn.shopify.com)
      const ogImg = html.match(/property="og:image"[^>]*content="([^"]+)"/i)?.[1] ||
                     html.match(/content="([^"]+)"[^>]*property="og:image"/i)?.[1]
      if (ogImg) {
        let ogUrl = ogImg.startsWith('//') ? 'https:' + ogImg : ogImg
        if (ogUrl.startsWith('http') && !cdnImages.has(ogUrl)) {
          cdnImages.add(ogUrl)
          allCdnImages.unshift(ogUrl) // OG image first
        }
      }

      // Extract product title from OG/JSON-LD for smarter fallback searches
      const ogTitle = html.match(/property="og:title"[^>]*content="([^"]+)"/i)?.[1] ||
                       html.match(/content="([^"]+)"[^>]*property="og:title"/i)?.[1] || ''
      const htmlTitle = html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || ''
      const productTitle = ogTitle || htmlTitle

      if (allCdnImages.length > 0) {
        // Try to filter to product-specific images using URL slug
        const slug = url.split('/products/')[1]?.split(/[?#]/)[0]?.toLowerCase() || ''
        const slugParts = slug.split('-').filter(p => p.length > 2) // e.g. "drop-cut-lux" → ["drop", "cut", "lux"]
        let productImages = allCdnImages
        if (slugParts.length > 0) {
          const relevant = allCdnImages.filter(u => {
            const lower = u.toLowerCase()
            return slugParts.some(part => lower.includes(part))
          })
          if (relevant.length >= 3) {
            productImages = relevant
          }
        }

        console.log(`Shopify Hydrogen fallback: ${allCdnImages.length} CDN images, ${productImages.length} product-relevant`)
        const images = productImages.slice(0, 20).map(src => {
          if (!src.includes('width=')) return src + (src.includes('?') ? '&' : '?') + 'width=1200'
          return src
        })
        return { images, title: productTitle }
      }
    }
  } catch { /* Hydrogen fallback failed */ }

  return null
}

// Deduplicate Shopify/CDN URLs by stripping width/format params → keep largest
function deduplicateImages(urls: string[]): string[] {
  const byBase = new Map<string, { url: string; width: number }>()

  for (const url of urls) {
    try {
      const u = new URL(url)
      // Strip width/format params to get base image identity for dedup
      const base = u.origin + u.pathname + (u.searchParams.get('v') ? `?v=${u.searchParams.get('v')}` : '')

      // Detect Shopify URLs (have ?width= param) vs other CDNs
      const shopifyWidth = u.searchParams.get('width')
      const contentfulW = u.searchParams.get('w')
      const isShopify = !!shopifyWidth

      let width: number
      if (isShopify) {
        width = parseInt(shopifyWidth!) || 1000
      } else if (contentfulW) {
        width = parseInt(contentfulW) || 1000
      } else {
        width = 1000
      }

      const existing = byBase.get(base)
      if (!existing || width > existing.width) {
        if (isShopify) {
          // Shopify: set width param to reasonable size
          const targetWidth = Math.min(width, 1200)
          u.searchParams.set('width', String(targetWidth))
          byBase.set(base, { url: u.toString(), width: targetWidth })
        } else {
          // Non-Shopify: keep URL as-is, don't inject foreign params
          byBase.set(base, { url, width })
        }
      }
    } catch {
      // Non-URL (e.g. svg-inline:..., data:...) — include as-is, no dedup needed
      byBase.set(url, { url, width: 0 })
    }
  }

  return [...byBase.values()].map((v) => v.url)
}

// Extract social proof (reviews, ratings, testimonials) from page HTML and structured data
function extractSocialProof(rawHtml: string, pageContent: string): SocialProof {
  const proof: SocialProof = {}

  // 1. JSON-LD AggregateRating
  try {
    const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let m
    while ((m = ldRegex.exec(rawHtml)) !== null) {
      try {
        const data = JSON.parse(m[1])
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item.aggregateRating) {
            const ar = item.aggregateRating
            if (ar.ratingValue) proof.averageRating = `${ar.ratingValue}/${ar.bestRating || 5}`
            if (ar.reviewCount) proof.customerCount = `${ar.reviewCount} reviews`
            else if (ar.ratingCount) proof.customerCount = `${ar.ratingCount} ratings`
          }
          // JSON-LD Review objects
          if (item.review && Array.isArray(item.review)) {
            proof.reviews = proof.reviews || []
            for (const r of item.review.slice(0, 5)) {
              const quote = r.reviewBody || r.description || ''
              if (quote.length > 20 && quote.length < 300) {
                proof.reviews.push({
                  quote: quote.trim(),
                  source: 'product page',
                  author: r.author?.name || r.author || undefined,
                  rating: r.reviewRating?.ratingValue ? Number(r.reviewRating.ratingValue) : undefined,
                })
              }
            }
          }
        }
      } catch { /* malformed JSON-LD */ }
    }
  } catch { /* no JSON-LD */ }

  // 2. Markdown content — look for review patterns
  if (!proof.reviews?.length) {
    const reviewPatterns = [
      // "★★★★★ - Great product" or "5/5 stars"
      /(?:★{4,5}|[45](?:\.[\d])?\/5)\s*[-–—]\s*[""]?(.{20,200})[""]?/g,
      // "- Customer Name" followed by a quote
      /"([^"]{20,200})"\s*[-–—]\s*(\w[\w\s]{2,30})/g,
    ]
    const reviews: SocialProof['reviews'] = []
    for (const re of reviewPatterns) {
      let mm
      while ((mm = re.exec(pageContent)) !== null && reviews.length < 5) {
        const quote = (mm[1] || mm[0]).trim().replace(/^[""]|[""]$/g, '')
        if (quote.length > 20) {
          reviews.push({ quote, source: 'product page', author: mm[2]?.trim() })
        }
      }
    }
    if (reviews.length > 0) proof.reviews = reviews
  }

  // 3. Rating from HTML meta/spans
  if (!proof.averageRating) {
    const ratingMatch = rawHtml.match(
      /(?:data-rating|itemprop=["']ratingValue["'])[^>]*(?:content|value)=["']([0-9.]+)["']/i
    ) || rawHtml.match(
      /(?:class=["'][^"']*rating[^"']*["'][^>]*>)\s*([0-9]\.[0-9])\s/i
    )
    if (ratingMatch) proof.averageRating = `${ratingMatch[1]}/5`
  }

  // 4. Review count from HTML
  if (!proof.customerCount) {
    const countMatch = rawHtml.match(
      /(?:itemprop=["']reviewCount["'])[^>]*(?:content)=["'](\d+)["']/i
    ) || pageContent.match(
      /(\d[\d,]+)\s*(?:reviews?|ratings?|customers?)/i
    )
    if (countMatch) proof.customerCount = countMatch[1].replace(/,/g, '') + ' reviews'
  }

  return proof
}

export async function scrapeProductUrl(url: string): Promise<{
  pageContent: string
  imageUrls: string[]
  logoUrls: string[]
  detectedFonts: string[]
  detectedColors: string[]
  socialProof: SocialProof
}> {
  let pageContent = ''
  let jinaData: any = {}
  try {
    const response = await fetch(JINA_READER_URL + url, {
      headers: { Accept: 'application/json', 'X-Return-Format': 'markdown' },
    })
    if (response.ok) {
      jinaData = await response.json()
      pageContent = jinaData.data?.content || jinaData.data?.text || ''
    } else {
      console.warn(`Jina Reader returned ${response.status} — continuing with HTML/Shopify fallbacks`)
    }
  } catch (e) {
    console.warn('Jina Reader failed — continuing with HTML/Shopify fallbacks:', e)
  }
  const pageDomain = new URL(url).hostname.replace('www.', '')

  // Extract product slug from URL for filtering
  const parsedUrl = new URL(url)
  const urlPath = parsedUrl.pathname
  const pathSegments = urlPath.split('/').filter(Boolean)
  let productSlug = pathSegments.pop()?.split('?')[0] || ''
  // Strip file extensions (.html, .htm, .php, .asp, .aspx)
  productSlug = productSlug.replace(/\.(html?|php|aspx?)$/i, '')
  // Fallback: try hash fragment for SPAs (e.g. gruns.co/#buybox)
  if (!productSlug && parsedUrl.hash) {
    productSlug = parsedUrl.hash.replace('#', '').split('/').filter(Boolean).pop() || ''
  }
  // Build search terms from slug: "chocolate-chip-cookie-dough" → ["chocolate", "chip", "cookie", "dough", "cccd"]
  let slugParts = productSlug.split('-').filter((p) => p.length > 2)
  // If slug is a short model number (e.g. "NC301"), also use parent path for product name matching
  // This handles URLs like /ninja-creami-7-in-1-ice-cream-maker/NC301.html
  if (slugParts.length < 2 && pathSegments.length > 0) {
    const parentSlug = pathSegments[pathSegments.length - 1]
    const parentParts = parentSlug.split('-').filter((p) => p.length > 2)
    if (parentParts.length >= 2) {
      slugParts = [...slugParts, ...parentParts]
      console.log(`Short slug "${productSlug}", using parent path "${parentSlug}" for matching`)
    }
  }
  // Also try abbreviation (first letters)
  const abbreviation = slugParts.map((p) => p[0]).join('').toUpperCase()
  const hasSlug = slugParts.length > 0
  // Also store the model number for matching CDN filenames like "NC301_01.jpg"
  const modelNumber = productSlug.match(/^[A-Z]{1,3}\d{2,5}$/i)?.[0]?.toUpperCase() || ''

  // Normalize AVIF format params — convert to jpg for browser/canvas compatibility
  const normalizeAvif = (imgUrl: string): string => {
    if (imgUrl.includes('fm=avif')) return imgUrl.replace(/fm=avif/g, 'fm=jpg')
    if (imgUrl.includes('format=avif')) return imgUrl.replace(/format=avif/g, 'format=jpg')
    return imgUrl
  }

  const logoUrls: string[] = []

  const isLogoUrl = (u: string, alt?: string) => {
    const lower = u.toLowerCase()
    const altLower = (alt || '').toLowerCase()
    return (
      lower.includes('logo') ||
      lower.includes('wordmark') ||
      altLower.includes('logo') ||
      altLower.includes('wordmark') ||
      lower.includes('favicon') ||
      /\/logo[_.-]/.test(lower) ||
      /[_.-]logo[_.]/.test(lower)
    )
  }

  // Skip junk: tiny icons, tracking pixels, social icons, nav/footer assets
  const isJunkImage = (u: string) => {
    const lower = u.toLowerCase()
    return (
      lower.includes('badge') ||
      lower.includes('payment') ||
      lower.includes('social') ||
      lower.includes('twitter') ||
      lower.includes('facebook') ||
      lower.includes('instagram') ||
      lower.includes('pinterest') ||
      lower.includes('youtube') ||
      lower.includes('tiktok') ||
      lower.includes('pixel') ||
      lower.includes('tracking') ||
      lower.includes('sprite') ||
      lower.includes('arrow') ||
      lower.includes('chevron') ||
      lower.includes('placeholder') ||
      lower.includes('spinner') ||
      lower.includes('analytics') ||
      lower.includes('t.co/') ||
      lower.includes('adsct') ||
      lower.includes('check_yes') ||
      lower.includes('/x.png') ||
      lower.endsWith('.gif')
    )
  }

  // Check if a URL is too small to be useful
  const isTooSmall = (u: string) => {
    try {
      const params = new URL(u).searchParams
      const width = params.get('width') || params.get('w')
      return width ? parseInt(width) < 100 : false
    } catch { return false }
  }

  // Check if image URL is product-relevant (contains product slug terms, abbreviation, or model number)
  const isProductRelevant = (u: string, alt?: string) => {
    const lower = u.toLowerCase()
    const altLower = (alt || '').toLowerCase()

    // Check model number in filename (e.g., "NC301" matches "NC301_01.jpg")
    if (modelNumber && lower.includes(modelNumber.toLowerCase())) return true

    // Check abbreviation in URL (e.g., "cccd" for Chocolate Chip Cookie Dough)
    if (abbreviation.length >= 3 && lower.includes(abbreviation.toLowerCase())) return true

    // Check slug parts — at least 2 must match in URL for specificity
    let urlMatches = 0
    for (const part of slugParts) {
      if (lower.includes(part)) urlMatches++
    }
    if (urlMatches >= 2) return true

    // Check alt text — at least 2 slug parts must match (relaxed from 3 for better recall)
    if (altLower) {
      let altMatches = 0
      for (const part of slugParts) {
        if (altLower.includes(part)) altMatches++
      }
      if (altMatches >= 2) return true
    }

    return false
  }

  // Extract all image URLs from markdown (with alt text for filtering)
  const imgRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/gi
  const allImagesWithAlt: { url: string; alt: string }[] = []
  let match
  while ((match = imgRegex.exec(pageContent)) !== null) {
    const alt = match[1]
    const imgUrl = normalizeAvif(match[2])
    if (isJunkImage(imgUrl)) continue
    if (isTooSmall(imgUrl)) continue

    if (isLogoUrl(imgUrl, alt)) {
      if (!logoUrls.includes(imgUrl)) logoUrls.push(imgUrl)
    } else {
      allImagesWithAlt.push({ url: imgUrl, alt })
    }
  }

  // Deduplicate (same base image at different sizes → keep largest)
  const deduped = deduplicateImages(allImagesWithAlt.map((i) => i.url))

  // Build alt lookup for deduped URLs (match by pathname)
  const altByPath = new Map<string, string>()
  for (const { url, alt } of allImagesWithAlt) {
    try {
      const path = new URL(url).pathname
      if (!altByPath.has(path)) altByPath.set(path, alt)
    } catch { /* skip */ }
  }
  const getAlt = (u: string) => {
    try { return altByPath.get(new URL(u).pathname) || '' } catch { return '' }
  }

  // Filter to product-relevant images (URL + alt text matching)
  // When we have no slug (root URL or SPA with hash routing), skip relevance filter
  let productImages: string[] = []
  if (hasSlug) {
    productImages = deduped.filter((u) => isProductRelevant(u, getAlt(u)))
  }

  // If we didn't find enough product-specific images, include same-domain images
  if (productImages.length < 3) {
    const domainImages = deduped.filter((u) => {
      try {
        const imgHost = new URL(u).hostname.replace('www.', '')
        return imgHost.includes(pageDomain) || pageDomain.includes(imgHost.split('.')[0])
      } catch { return false }
    })
    // Merge: keep slug-matched images first, then add domain images
    const existing = new Set(productImages)
    for (const img of domainImages) {
      if (!existing.has(img)) productImages.push(img)
    }
  }

  // Final fallback: if still nothing, use ALL deduped images
  if (productImages.length === 0 && deduped.length > 0) {
    console.log(`No product-specific images found, using all ${deduped.length} extracted images`)
    productImages = deduped
  }

  // Fetch raw HTML for font/color extraction AND product gallery
  const rawHtml = await fetchRawHtml(url)
  const detectedFonts = extractFontsFromHtml(rawHtml)
  const detectedColors = extractColorsFromHtml(rawHtml)

  // PRODUCT GALLERY: Try multiple sources in priority order
  // 1. Shopify product JSON API (most reliable for Shopify stores)
  const shopifyProduct = await fetchShopifyProductJson(url)
  if (shopifyProduct && shopifyProduct.images.length > 0) {
    console.log(`Found ${shopifyProduct.images.length} product images from Shopify JSON API`)
    productImages = shopifyProduct.images
  }
  // 2. JSON-LD structured data from HTML — ALWAYS try this (JSON-LD images are inherently product-relevant)
  if (rawHtml) {
    const galleryImages = extractProductGalleryFromHtml(rawHtml)
    if (galleryImages.length > 0) {
      console.log(`Found ${galleryImages.length} product gallery images from JSON-LD/OG`)
      // JSON-LD images are from structured product data — prepend them (highest confidence)
      const existing = new Set(productImages)
      const newImages = galleryImages.filter((u) => !existing.has(u))
      if (productImages.length === 0) {
        productImages = galleryImages
      } else if (newImages.length > 0) {
        productImages = [...newImages, ...productImages]
        console.log(`Added ${newImages.length} JSON-LD images to existing ${existing.size} product images`)
      }
    }
  }
  // 3. Extract <img> tags directly from raw HTML (catches images markdown conversion missed)
  // Handles both src= and srcset= (some sites like lululemon only use srcset)
  // Always run this — JSON-LD often has too few or wrong images (e.g. wrong variant/color)
  if (productImages.length < 4 && rawHtml) {
    const htmlImgRegex = /<img[^>]*>/gi
    const htmlImages: string[] = []
    let htmlMatch
    while ((htmlMatch = htmlImgRegex.exec(rawHtml)) !== null) {
      const tag = htmlMatch[0]
      let imgUrl = ''

      // Try src first
      const srcMatch = tag.match(/\ssrc=["']([^"']+)["']/i)
      if (srcMatch) {
        const src = srcMatch[1]
        // Skip data URIs and empty placeholders
        if (!src.startsWith('data:') && src.length > 5) {
          imgUrl = src
        }
      }

      // If no valid src, try srcset (pick the largest resolution)
      if (!imgUrl) {
        const srcsetMatch = tag.match(/\ssrcset=["']([^"']+)["']/i)
        if (srcsetMatch) {
          const entries = srcsetMatch[1].split(',').map(s => s.trim()).filter(Boolean)
          // Pick the entry with the largest width (e.g., "url 1440w")
          let bestUrl = ''
          let bestWidth = 0
          for (const entry of entries) {
            const parts = entry.split(/\s+/)
            const entryUrl = parts[0]
            const widthStr = parts[1]
            const width = widthStr?.endsWith('w') ? parseInt(widthStr) : 0
            if (width > bestWidth || !bestUrl) {
              bestWidth = width
              bestUrl = entryUrl
            }
          }
          if (bestUrl) imgUrl = bestUrl
        }
      }

      if (!imgUrl) continue

      // Normalize URL + AVIF format
      imgUrl = normalizeAvif(imgUrl)
      if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl
      else if (imgUrl.startsWith('/')) {
        try { imgUrl = new URL(imgUrl, url).toString() } catch { continue }
      }
      if (!imgUrl.startsWith('http')) continue
      // Strip excessive query params for dedup but keep the URL functional
      if (isJunkImage(imgUrl)) continue
      if (isTooSmall(imgUrl)) continue
      if (isLogoUrl(imgUrl)) {
        if (!logoUrls.includes(imgUrl)) logoUrls.push(imgUrl)
      } else {
        // When supplementing existing images, filter by product relevance or same-domain product-like images
        const altMatch = tag.match(/\salt=["']([^"']*)["']/i)
        const alt = altMatch?.[1] || ''
        if (productImages.length > 0) {
          // Accept if: product-relevant URL/alt, OR same-domain image with reasonable size indicator
          const sameDomain = imgUrl.includes(pageDomain)
          const hasSizeHint = tag.includes('fetchpriority') || tag.includes('srcset') || tag.includes('loading="eager"')
          if (!isProductRelevant(imgUrl, alt) && !(sameDomain && hasSizeHint)) continue
        }
        htmlImages.push(imgUrl)
      }
    }
    if (htmlImages.length > 0) {
      const dedupedHtml = deduplicateImages(htmlImages)
      console.log(`Found ${dedupedHtml.length} images from HTML img tags (src + srcset)`)
      if (productImages.length === 0) {
        productImages = dedupedHtml
      } else {
        // Merge — avoid duplicates
        const existing = new Set(productImages)
        const newImgs = dedupedHtml.filter((u) => !existing.has(u))
        if (newImgs.length > 0) {
          productImages = [...productImages, ...newImgs]
          console.log(`Merged ${newImgs.length} HTML img tag images with ${existing.size} existing`)
        }
      }
    }
  }
  // 4. Bing Image Search — fallback when scraping found too few images
  // Extract product title from OG/JSON-LD/Shopify for precise queries
  let productTitle = shopifyProduct?.title || ''
  if (!productTitle && rawHtml) {
    productTitle = rawHtml.match(/property="og:title"[^>]*content="([^"]+)"/i)?.[1] ||
                   rawHtml.match(/content="([^"]+)"[^>]*property="og:title"/i)?.[1] || ''
    // Strip " - BrandName" / " | BrandName" suffix from OG title
    if (productTitle) productTitle = productTitle.replace(/\s*[|–—-]\s*[^|–—-]+$/, '').trim()
  }
  if (!productTitle) {
    productTitle = productSlug.replace(/-/g, ' ')
  }
  const brandName = pageDomain.split('.')[0]

  if (productImages.length < 3) {
    // Try multiple queries for best coverage — specific product name + brand
    const bingQueries = [
      `"${brandName}" "${productTitle}" product`,
      `${brandName} ${productTitle} product photo`,
      `site:${pageDomain} ${productTitle}`,
    ]
    console.log(`Product images insufficient (${productImages.length}), trying Bing Image Search for "${productTitle}"...`)
    for (const query of bingQueries) {
      const bingImages = await webImageSearch(query, 10)
      for (const img of bingImages) {
        if (productImages.includes(img) || isJunkImage(img)) continue
        // Skip stock photo sites
        if (/shutterstock|istock|getty|dreamstime|alamy|depositphoto/i.test(img)) continue
        productImages.push(img)
      }
      if (productImages.length >= 6) break // Got enough
    }
    if (productImages.length > 0) {
      console.log(`Bing Image Search brought total to ${productImages.length} product images`)
    }
  }
  // 5. Markdown image extraction already ran above as earlier fallback
  if (productImages.length === 0) {
    console.log(`No images found from any source for ${url}`)
  }

  // ===== SMART LOGO DISCOVERY — multi-source, scored, deduplicated =====
  const brandGuessForLogo = pageDomain.split('.')[0]
  const pageOrigin = new URL(url).origin
  console.log(`Smart logo search for "${brandGuessForLogo}"...`)

  // Scored candidate pool — higher score = more likely to be the actual logo
  const logoCandidates = new Map<string, number>() // url → score

  function addLogoCandidate(u: string, score: number) {
    if (!u || u.startsWith('data:') || u.length < 5) return
    // Make absolute
    if (u.startsWith('//')) u = 'https:' + u
    else if (u.startsWith('/')) {
      try { u = new URL(u, pageOrigin).href } catch { return }
    }
    if (!u.startsWith('http')) return
    if (isJunkImage(u)) return
    // SVG images can't be sent to Claude — skip them
    if (u.endsWith('.svg') || u.includes('.svg?')) return
    // Skip obvious product/lifestyle/editorial images
    const lower = u.toLowerCase()
    if (/\/products?\//i.test(lower) && !urlHasLogoKeyword(u)) return
    if (/(?:_\d{4,}x|lifestyle|editorial|lookbook|campaign|_model|_look_)/i.test(lower)) return
    // Skip very long CDN URLs with rendering params (likely product carousel images)
    if (lower.includes('is/image/') && !urlHasLogoKeyword(u) && lower.includes('wid=')) return
    // Request a decent size for Shopify CDN images
    if (u.includes('cdn.shopify.com') && !u.includes('width=')) {
      u += (u.includes('?') ? '&' : '?') + 'width=500'
    }
    logoCandidates.set(u, (logoCandidates.get(u) || 0) + score)
  }

  function urlHasLogoKeyword(u: string): boolean {
    return /[/_.=-]logo[/_.=-s]|logo\.(png|jpg|svg|webp)|wordmark|brand.?mark/i.test(u)
  }

  // Helper: extract header/nav section from HTML
  function extractHeaderNav(html: string): string {
    // Get all header and nav blocks (including nested)
    const blocks: string[] = []
    const headerRegex = /<(?:header|nav)[\s>][\s\S]*?<\/(?:header|nav)>/gi
    let m
    while ((m = headerRegex.exec(html)) !== null) blocks.push(m[0])
    // Also get first 5000 chars (top of page typically has logo)
    blocks.push(html.substring(0, 5000))
    return blocks.join('\n')
  }

  // Helper: extract all image URLs from an HTML fragment
  function extractImageUrlsFromHtml(html: string): { url: string; alt: string; context: string }[] {
    const results: { url: string; alt: string; context: string }[] = []
    // <img> tags
    const imgRegex = /<img[^>]*>/gi
    let m
    while ((m = imgRegex.exec(html)) !== null) {
      const tag = m[0]
      const src = tag.match(/src=["']([^"']+)["']/i)?.[1]
      const alt = tag.match(/alt=["']([^"']*?)["']/i)?.[1] || ''
      const cls = tag.match(/class=["']([^"']*?)["']/i)?.[1] || ''
      if (src) results.push({ url: src.split(/\s/)[0], alt, context: cls })
    }
    // CSS background-image: url(...)
    const bgRegex = /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi
    while ((m = bgRegex.exec(html)) !== null) {
      results.push({ url: m[1], alt: '', context: 'css-bg' })
    }
    // <source> in <picture>
    const srcsetRegex = /srcset=["']([^"']+)["']/gi
    while ((m = srcsetRegex.exec(html)) !== null) {
      const firstUrl = m[1].split(/\s/)[0].split(',')[0].trim()
      if (firstUrl) results.push({ url: firstUrl, alt: '', context: 'srcset' })
    }
    return results
  }

  // === SOURCE 1: Homepage header/nav (highest confidence) ===
  let homepageHtml = ''
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(pageOrigin)}`
    const resp = await fetch(proxyUrl)
    if (resp.ok) {
      homepageHtml = await resp.text()
      const headerHtml = extractHeaderNav(homepageHtml)
      const headerImages = extractImageUrlsFromHtml(headerHtml)
      for (const { url: imgUrl, alt, context } of headerImages) {
        const hasKeyword = urlHasLogoKeyword(imgUrl) || /logo/i.test(alt) || /logo/i.test(context)
        const hasBrandName = imgUrl.toLowerCase().includes(brandGuessForLogo.toLowerCase()) ||
          alt.toLowerCase().includes(brandGuessForLogo.toLowerCase())
        // Only add header images that have a logo keyword OR brand name — don't add random nav images
        if (!hasKeyword && !hasBrandName) continue
        let score = 25
        if (hasKeyword) score += 35
        if (hasBrandName) score += 15
        if (/\.(png|webp)/i.test(imgUrl)) score += 5
        addLogoCandidate(imgUrl, score)
      }
      // Scan homepage for any URL with "logo" in it
      const allUrls = homepageHtml.matchAll(/(?:src|href|srcset)=["']([^"']+)["']/gi)
      for (const m of allUrls) {
        const u = m[1].split(/\s/)[0]
        if (u && urlHasLogoKeyword(u)) addLogoCandidate(u, 40)
      }
    }
  } catch { /* proxy unavailable */ }

  // === SOURCE 2: Product page header/nav (rawHtml already fetched) ===
  if (rawHtml) {
    const headerHtml = extractHeaderNav(rawHtml)
    const headerImages = extractImageUrlsFromHtml(headerHtml)
    for (const { url: imgUrl, alt, context } of headerImages) {
      const hasKeyword = urlHasLogoKeyword(imgUrl) || /logo/i.test(alt) || /logo/i.test(context)
      const hasBrandName = imgUrl.toLowerCase().includes(brandGuessForLogo.toLowerCase())
      // Only add if has logo keyword or brand name
      if (!hasKeyword && !hasBrandName) continue
      let score = 20
      if (hasKeyword) score += 35
      if (hasBrandName) score += 15
      addLogoCandidate(imgUrl, score)
    }
    // Scan product page for "logo" URLs only
    const allUrls = rawHtml.matchAll(/(?:src|href|srcset)=["']([^"']+)["']/gi)
    for (const m of allUrls) {
      const u = m[1].split(/\s/)[0]
      if (u && urlHasLogoKeyword(u)) addLogoCandidate(u, 35)
    }
  }

  // === SOURCE 3: CSS selectors for logo (class/id containing "logo") ===
  for (const html of [homepageHtml, rawHtml].filter(Boolean)) {
    // Elements with class/id containing "logo" — get their child img or bg-image
    const logoContainerRegex = /<(?:a|div|span|figure|picture)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div|span|figure|picture)>/gi
    let m
    while ((m = logoContainerRegex.exec(html)) !== null) {
      const inner = extractImageUrlsFromHtml(m[0])
      for (const { url: imgUrl } of inner) {
        addLogoCandidate(imgUrl, 50) // Very high confidence — explicitly marked as logo container
      }
    }
    // Direct img with class/id containing "logo"
    const logoImgRegex = /<img[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>/gi
    while ((m = logoImgRegex.exec(html)) !== null) {
      const src = m[0].match(/src=["']([^"']+)["']/i)?.[1]
      if (src) addLogoCandidate(src.split(/\s/)[0], 55)
    }
  }

  // === SOURCE 4: Shopify CDN logo paths (very common) ===
  if (homepageHtml.includes('shopify') || homepageHtml.includes('Shopify') || rawHtml.includes('cdn.shopify.com')) {
    // Shopify stores often have logos at /cdn/shop/files/*logo*
    const shopifyLogoRegex = /https?:\/\/cdn\.shopify\.com\/[^"'\s]+logo[^"'\s]*/gi
    for (const html of [homepageHtml, rawHtml].filter(Boolean)) {
      let m
      while ((m = shopifyLogoRegex.exec(html)) !== null) {
        addLogoCandidate(m[0], 45)
      }
    }
  }

  // === SOURCE 5: og:image meta tags — ONLY from homepage, and only if URL has logo keyword ===
  // Product page og:image is almost always the PRODUCT photo, not the logo
  if (homepageHtml) {
    const ogRegex = /<meta[^>]*(?:property|name)=["']og:image(?::(?:secure_)?url)?["'][^>]*content=["']([^"']+)["']/gi
    const ogRegex2 = /<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::(?:secure_)?url)?["']/gi
    for (const re of [ogRegex, ogRegex2]) {
      let m
      while ((m = re.exec(homepageHtml)) !== null) {
        const ogUrl = m[1]
        if (ogUrl && ogUrl.startsWith('http') && urlHasLogoKeyword(ogUrl)) {
          addLogoCandidate(ogUrl, 55)
          console.log(`Found logo via homepage og:image: ${ogUrl}`)
        }
      }
    }
  }

  // === SOURCE 6: Bing Image Search (backup — only add results that look like logos) ===
  const bingQueries = [
    `"${brandGuessForLogo}" logo`,
    `"${brandGuessForLogo}" brand logo png transparent`,
    `site:${pageDomain} logo`,
  ]
  for (const query of bingQueries) {
    const bingLogos = await webImageSearch(query, 6)
    for (const u of bingLogos) {
      const lower = u.toLowerCase()
      const fromBrand = lower.includes(brandGuessForLogo.toLowerCase())
      const hasKeyword = urlHasLogoKeyword(u)
      // Skip results that are clearly product images, not logos
      if (lower.includes('product') || lower.includes('lifestyle') || lower.includes('model') ||
          lower.includes('gallery') || lower.includes('hero') || lower.includes('banner') ||
          lower.includes('collection') || lower.includes('campaign')) continue
      // Only add Bing results that have SOME logo signal
      if (!hasKeyword && !fromBrand) continue
      let score = 10
      if (hasKeyword) score += 20
      if (fromBrand) score += 15
      if (/\.(png|webp)/i.test(u)) score += 5
      addLogoCandidate(u, score)
    }
  }

  // === SOURCE 7: Previously discovered logos from markdown extraction ===
  for (const u of [...logoUrls]) {
    addLogoCandidate(u, urlHasLogoKeyword(u) ? 35 : 15)
  }

  // === SOURCE 8: Well-known icon/logo paths on the brand's domain ===
  const wellKnownLogoPaths = [
    // Standard favicon/icon paths (high quality brand marks)
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/android-chrome-512x512.png',
    '/android-chrome-192x192.png',
    '/favicon.svg',
    // Common logo paths
    '/logo.png', '/logo.svg', '/logo.webp', '/images/logo.png',
    `/images/${brandGuessForLogo}-logo.png`,
    '/assets/logo.png', '/img/logo.png',
  ]
  for (const path of wellKnownLogoPaths) {
    const score = path.includes('android-chrome-512') ? 35
      : path.includes('apple-touch-icon') ? 30
      : path.includes('favicon.svg') ? 30
      : 25
    addLogoCandidate(pageOrigin + path, score)
  }

  // === SOURCE 8b: Parse <link rel="apple-touch-icon">, <link rel="icon"> from HTML ===
  for (const html of [homepageHtml, rawHtml].filter(Boolean)) {
    const linkPatterns = [
      { re: /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["']/gi, score: 40 },
      { re: /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["']/gi, score: 40 },
      { re: /<link[^>]*rel=["']icon["'][^>]*type=["']image\/svg\+xml["'][^>]*href=["']([^"']+)["']/gi, score: 45 },
      { re: /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*sizes=["'](?:192|256|512)/gi, score: 35 },
    ]
    for (const { re, score } of linkPatterns) {
      let lm
      while ((lm = re.exec(html)) !== null) {
        const href = lm[1]
        if (href) {
          const resolved = href.startsWith('http') ? href : (pageOrigin + (href.startsWith('/') ? '' : '/') + href)
          addLogoCandidate(resolved, score)
        }
      }
    }
  }

  // === SOURCE 9: Inline SVG logos → convert to data URL for rasterization ===
  // Many modern sites (Jones Road, etc.) use inline <svg> with class/id "logo" — no <img> tag
  for (const html of [homepageHtml, rawHtml].filter(Boolean)) {
    // Find SVGs with logo-related class/id
    const svgLogoRegex = /<svg[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/svg>/gi
    let m
    while ((m = svgLogoRegex.exec(html)) !== null) {
      try {
        const svgMarkup = m[0]
        const encoded = encodeURIComponent(svgMarkup)
        const dataUrl = `data:image/svg+xml,${encoded}`
        logoCandidates.set(`svg-inline:${dataUrl}`, 65)
        console.log(`Found inline SVG logo (${svgMarkup.length} chars)`)
      } catch { /* malformed SVG */ }
    }
    // Also check for SVGs inside logo containers (a.logo, div.logo, etc.)
    const logoContainerSvgRegex = /<(?:a|div|span)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>\s*<svg[^>]*>[\s\S]*?<\/svg>/gi
    while ((m = logoContainerSvgRegex.exec(html)) !== null) {
      try {
        const svgMatch = m[0].match(/<svg[^>]*>[\s\S]*?<\/svg>/i)
        if (svgMatch) {
          const encoded = encodeURIComponent(svgMatch[0])
          const dataUrl = `data:image/svg+xml,${encoded}`
          logoCandidates.set(`svg-inline:${dataUrl}`, 65)
          console.log(`Found inline SVG logo in container (${svgMatch[0].length} chars)`)
        }
      } catch { /* malformed */ }
    }

    // SOURCE 9b: SVGs inside <a href="/"> in header/nav — very common logo pattern
    // Sites like ILIA Beauty use <a href="/"><svg viewBox="...">paths</svg></a> with no "logo" class
    const headerNavHtml = extractHeaderNav(html)
    const homeLinkSvgRegex = /<a[^>]*href=["']\/["'][^>]*>[\s\S]*?<\/a>/gi
    while ((m = homeLinkSvgRegex.exec(headerNavHtml)) !== null) {
      try {
        const svgMatch = m[0].match(/<svg[\s\S]*?<\/svg>/i)
        if (svgMatch && svgMatch[0].length < 50000 && svgMatch[0].length > 50) {
          // Skip if it's a tiny icon (hamburger menus, arrows, etc.)
          const pathCount = (svgMatch[0].match(/<path/gi) || []).length
          const viewBox = svgMatch[0].match(/viewBox=["']([^"']+)["']/i)?.[1]
          const vbWidth = viewBox ? parseFloat(viewBox.split(/\s+/)[2] || '0') : 0
          // Logo SVGs typically have multiple paths and decent width
          if (pathCount >= 2 || vbWidth > 40) {
            const encoded = encodeURIComponent(svgMatch[0])
            const dataUrl = `data:image/svg+xml,${encoded}`
            logoCandidates.set(`svg-inline:${dataUrl}`, 60)
            console.log(`Found inline SVG in homepage link (${svgMatch[0].length} chars, ${pathCount} paths, viewBox width: ${vbWidth})`)
          }
        }
      } catch { /* malformed */ }
    }
  }

  // === SOURCE 10: Google favicon (guaranteed, low quality fallback) ===
  addLogoCandidate(`https://www.google.com/s2/favicons?domain=${pageDomain}&sz=128`, 5)

  // Sort by score descending, deduplicate by base path
  const scoredCandidates = [...logoCandidates.entries()]
    .sort((a, b) => b[1] - a[1])
  const seenPaths = new Set<string>()
  const rankedLogoUrls: string[] = []
  for (const [u] of scoredCandidates) {
    try {
      const basePath = new URL(u).pathname.replace(/\?.*$/, '').toLowerCase()
      if (seenPaths.has(basePath)) continue
      seenPaths.add(basePath)
    } catch { /* non-parseable, include anyway */ }
    rankedLogoUrls.push(u)
  }

  // Replace logoUrls with ranked candidates
  logoUrls.length = 0
  logoUrls.push(...rankedLogoUrls)

  console.log(`Logo candidates (${logoUrls.length} total, scored):`, logoUrls.slice(0, 10).map(u => {
    const score = logoCandidates.get(u) || 0
    const short = u.length > 80 ? u.slice(0, 77) + '...' : u
    return `[${score}] ${short}`
  }))

  // ===== BING IMAGE SEARCH — always runs to supplement scraping =====
  // Safety net: product images are almost always findable via Bing
  // even when the page itself is impossible to scrape (SPAs, JS-rendered, CORS, etc.)
  // Uses product title (from OG/JSON-LD/Shopify) for accurate variant-specific results
  if (productImages.length < 8) {
    try {
      const supplementQuery = productTitle && productTitle !== brandName
        ? `"${brandName}" "${productTitle}" product`
        : `${brandName} ${productSlug.replace(/-/g, ' ')} product`
      console.log(`Bing supplement search: "${supplementQuery}" (have ${productImages.length} images)`)
      const bingResults = await webImageSearch(supplementQuery, 10)

      const existingSet = new Set(productImages.map((u) => {
        try { return new URL(u).pathname } catch { return u }
      }))
      let added = 0
      for (const imgUrl of bingResults) {
        if (isJunkImage(imgUrl)) continue
        // Skip stock photo sites
        if (/shutterstock|istock|getty|dreamstime|alamy|depositphoto/i.test(imgUrl)) continue
        try {
          if (existingSet.has(new URL(imgUrl).pathname)) continue
        } catch { continue }
        productImages.push(imgUrl)
        existingSet.add(new URL(imgUrl).pathname)
        added++
        if (productImages.length >= 12) break
      }
      if (added > 0) {
        console.log(`Bing supplement added ${added} product images (total: ${productImages.length})`)
      }
    } catch {
      console.warn('Bing image search supplement failed')
    }
  }

  // Deduplicate logos too
  const dedupedLogos = deduplicateImages(logoUrls)

  // Extract social proof from the page
  const socialProof = extractSocialProof(rawHtml, pageContent)
  if (socialProof.averageRating || socialProof.reviews?.length) {
    console.log(`Social proof found: rating=${socialProof.averageRating}, reviews=${socialProof.reviews?.length || 0}, customers=${socialProof.customerCount}`)
  }

  return {
    pageContent,
    imageUrls: productImages.slice(0, 12),
    logoUrls: dedupedLogos.slice(0, 10),
    detectedFonts,
    detectedColors,
    socialProof,
  }
}

// ============ Re-run Logo Search with Real Brand Name ============
// Called AFTER researchBrand() returns the real brand name (not the domain guess)

export async function searchLogosWithBrandName(
  realBrandName: string,
  pageUrl: string,
  brandContext?: { category?: string; description?: string },
): Promise<string[]> {
  const origin = new URL(pageUrl).origin
  const pageDomain = new URL(pageUrl).hostname.replace('www.', '')
  const brandLower = realBrandName.toLowerCase()
  console.log(`Re-running logo search with real brand name: "${realBrandName}"`, brandContext)

  const candidates = new Map<string, number>()

  const isJunk = (u: string) => {
    const l = u.toLowerCase()
    return l.includes('badge') || l.includes('payment') || l.includes('social') ||
      l.includes('twitter') || l.includes('facebook') || l.includes('instagram') ||
      l.includes('pinterest') || l.includes('youtube') || l.includes('tiktok') ||
      l.includes('pixel') || l.includes('tracking') || l.includes('sprite') ||
      l.includes('analytics') || l.endsWith('.gif')
  }

  const hasLogoKeyword = (u: string) =>
    /[/_.=-]logo[/_.=-s]|logo\.(png|jpg|svg|webp)|wordmark|brand.?mark/i.test(u)

  function addCandidate(u: string, score: number) {
    if (!u || u.length < 5) return
    // Allow data:image/svg+xml (inline SVG data URIs)
    if (u.startsWith('data:') && !u.startsWith('data:image/svg+xml')) return
    if (u.startsWith('//')) u = 'https:' + u
    else if (u.startsWith('/')) {
      try { u = new URL(u, origin).href } catch { return }
    }
    if (!u.startsWith('http') && !u.startsWith('data:')) return
    if (isJunk(u)) return
    // Allow SVG URLs — many modern logos are SVGs
    const lower = u.toLowerCase()
    if (/\/products?\//i.test(lower) && !hasLogoKeyword(u)) return
    if (/(?:_\d{4,}x|lifestyle|editorial|lookbook|campaign|_model|_look_)/i.test(lower)) return
    if (lower.includes('is/image/') && !hasLogoKeyword(u) && lower.includes('wid=')) return
    if (u.includes('cdn.shopify.com') && !u.includes('width=') && !u.endsWith('.svg') && !u.includes('.svg?')) {
      u += (u.includes('?') ? '&' : '?') + 'width=500'
    }
    candidates.set(u, (candidates.get(u) || 0) + score)
  }

  // --- SOURCE A: Bing Image Search with REAL brand name + context ---
  // Use category/description to disambiguate generic names like "Seed", "Method", "Native"
  const categoryHint = brandContext?.category || ''
  const descHint = brandContext?.description || ''
  // Extract a short disambiguator: e.g. "probiotics" from "Seed is a probiotic company"
  const disambiguator = categoryHint
    ? categoryHint.split(/[,;]/)[0].trim()
    : descHint.split(/[.!]/)[0].substring(0, 60).trim()
  const bingQueries = [
    `"${realBrandName}" logo`,
    disambiguator
      ? `"${realBrandName}" ${disambiguator} logo`
      : `"${realBrandName}" brand logo png transparent`,
    `site:${pageDomain} logo`,
  ]
  for (const query of bingQueries) {
    const results = await webImageSearch(query, 8)
    for (const u of results) {
      const lower = u.toLowerCase()
      // Must be from the brand or have a logo keyword
      const fromBrand = lower.includes(brandLower) || lower.includes(brandLower.replace(/\s+/g, ''))
      const hasKw = hasLogoKeyword(u)
      if (lower.includes('product') || lower.includes('lifestyle') || lower.includes('model') ||
          lower.includes('gallery') || lower.includes('hero') || lower.includes('banner') ||
          lower.includes('collection') || lower.includes('campaign') ||
          lower.includes('stock') || lower.includes('shutterstock') || lower.includes('istock')) continue
      // Require logo signal OR brand name in URL
      if (!hasKw && !fromBrand) continue
      let score = 15
      if (hasKw) score += 25
      if (fromBrand) score += 20
      if (/\.(png|webp)/i.test(u)) score += 5
      addCandidate(u, score)
    }
  }

  // --- SOURCE B: Homepage header/nav re-scan with real brand name ---
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(origin)}`
    const resp = await fetch(proxyUrl)
    if (resp.ok) {
      const homepageHtml = await resp.text()

      // Extract header/nav
      const blocks: string[] = []
      const hRe = /<(?:header|nav)[\s>][\s\S]*?<\/(?:header|nav)>/gi
      let m
      while ((m = hRe.exec(homepageHtml)) !== null) blocks.push(m[0])
      blocks.push(homepageHtml.substring(0, 5000))
      const headerHtml = blocks.join('\n')

      // Extract images
      const imgRe = /<img[^>]*>/gi
      while ((m = imgRe.exec(headerHtml)) !== null) {
        const tag = m[0]
        const src = tag.match(/src=["']([^"']+)["']/i)?.[1]
        const alt = tag.match(/alt=["']([^"']*?)["']/i)?.[1] || ''
        const cls = tag.match(/class=["']([^"']*?)["']/i)?.[1] || ''
        if (!src) continue
        const imgUrl = src.split(/\s/)[0]
        const hasKw = hasLogoKeyword(imgUrl) || /logo/i.test(alt) || /logo/i.test(cls)
        const hasBrand = imgUrl.toLowerCase().includes(brandLower) ||
          alt.toLowerCase().includes(brandLower)
        if (!hasKw && !hasBrand) continue
        let score = 30
        if (hasKw) score += 35
        if (hasBrand) score += 20
        addCandidate(imgUrl, score)
      }

      // Scan all URLs with "logo" keyword
      const allUrls = homepageHtml.matchAll(/(?:src|href|srcset)=["']([^"']+)["']/gi)
      for (const mm of allUrls) {
        const u = mm[1].split(/\s/)[0]
        if (u && hasLogoKeyword(u)) addCandidate(u, 45)
      }

      // CSS selectors with "logo" class/id
      const logoContainerRe = /<(?:a|div|span|figure|picture)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div|span|figure|picture)>/gi
      while ((m = logoContainerRe.exec(homepageHtml)) !== null) {
        const innerImgRe = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi
        let im
        while ((im = innerImgRe.exec(m[0])) !== null) {
          addCandidate(im[1].split(/\s/)[0], 55)
        }
      }

      // Inline SVGs inside logo containers — convert to data URI
      const logoSvgContainerRe = /<(?:a|div|span|header|nav)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/(?:a|div|span|header|nav)>/gi
      while ((m = logoSvgContainerRe.exec(homepageHtml)) !== null) {
        const svgMatch = m[0].match(/<svg[\s\S]*?<\/svg>/i)
        if (svgMatch) {
          const svgStr = svgMatch[0]
          // Only use reasonably-sized SVGs (logos, not huge illustrations)
          if (svgStr.length < 50000) {
            const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
            addCandidate(dataUri, 70)
          }
        }
        // Also grab <img> inside (already handled above, but with higher score here)
        const innerImg2 = m[0].matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi)
        for (const im of innerImg2) {
          addCandidate(im[1].split(/\s/)[0], 55)
        }
      }

      // Inline SVGs in header/nav with logo-related aria-label or title
      const headerSvgRe = /<svg[^>]*(?:aria-label|title)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<\/svg>/gi
      while ((m = headerSvgRe.exec(headerHtml)) !== null) {
        if (m[0].length < 50000) {
          const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(m[0])))
          addCandidate(dataUri, 75)
        }
      }

      // <a> tags linking to "/" (homepage link) in header — often wraps the logo
      const homeLinkRe = /<a[^>]*href=["']\/["'][^>]*>[\s\S]*?<\/a>/gi
      while ((m = homeLinkRe.exec(headerHtml)) !== null) {
        // Check for SVG inside
        const svgMatch = m[0].match(/<svg[\s\S]*?<\/svg>/i)
        if (svgMatch && svgMatch[0].length < 50000) {
          const dataUri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgMatch[0])))
          addCandidate(dataUri, 65)
        }
        // Check for <img> inside
        const imgMatch = m[0].match(/<img[^>]*src=["']([^"']+)["']/i)
        if (imgMatch) addCandidate(imgMatch[1].split(/\s/)[0], 60)
      }

      // <picture> elements with <source> — grab srcset URLs
      const pictureRe = /<picture[^>]*>[\s\S]*?<\/picture>/gi
      while ((m = pictureRe.exec(headerHtml)) !== null) {
        const srcsetRe = /srcset=["']([^"']+)["']/gi
        let ss
        while ((ss = srcsetRe.exec(m[0])) !== null) {
          const firstUrl = ss[1].split(/[,\s]/)[0]
          if (firstUrl && hasLogoKeyword(firstUrl)) addCandidate(firstUrl, 50)
        }
        const imgMatch = m[0].match(/<img[^>]*src=["']([^"']+)["']/i)
        if (imgMatch && hasLogoKeyword(imgMatch[1])) addCandidate(imgMatch[1].split(/\s/)[0], 50)
      }

      // SVG files referenced anywhere with "logo" in URL
      const svgUrlRe = /(?:src|href|srcset)=["']([^"'\s]*\.svg[^"'\s]*)["']/gi
      while ((m = svgUrlRe.exec(homepageHtml)) !== null) {
        const u = m[1]
        if (hasLogoKeyword(u) || u.toLowerCase().includes(brandLower)) {
          addCandidate(u, 55)
        }
      }

      // Shopify CDN logo paths
      if (homepageHtml.includes('shopify') || homepageHtml.includes('cdn.shopify.com')) {
        const shopRe = /https?:\/\/cdn\.shopify\.com\/[^"'\s]+logo[^"'\s]*/gi
        while ((m = shopRe.exec(homepageHtml)) !== null) {
          addCandidate(m[0], 50)
        }
      }

      // --- Parse <link rel="apple-touch-icon"> and <link rel="icon"> from HTML ---
      // These are standardized, always present, and always the brand's own icon
      const linkRels = [
        { re: /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*href=["']([^"']+)["']/gi, score: 40 },
        { re: /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon(?:-precomposed)?["']/gi, score: 40 },
        { re: /<link[^>]*rel=["']icon["'][^>]*type=["']image\/svg\+xml["'][^>]*href=["']([^"']+)["']/gi, score: 45 },
        { re: /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["'][^>]*sizes=["'](?:192|256|512)/gi, score: 35 },
      ]
      for (const { re, score } of linkRels) {
        while ((m = re.exec(homepageHtml)) !== null) {
          const href = m[1]
          if (href) {
            const resolved = href.startsWith('http') ? href : new URL(href, origin).href
            addCandidate(resolved, score)
            console.log(`Found icon via <link>: ${resolved} (score ${score})`)
          }
        }
      }
    }
  } catch { /* proxy unavailable */ }

  // --- SOURCE C: Well-known icon/logo paths ---
  const brandSlug = realBrandName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const wellKnownPaths = [
    // Standard favicon/icon paths (high quality)
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/android-chrome-512x512.png',
    '/android-chrome-192x192.png',
    '/favicon.svg',
    // Common logo paths
    '/logo.png', '/logo.svg', '/logo.webp',
    '/images/logo.png', '/images/logo.svg',
    `/images/${brandSlug}-logo.png`,
    '/assets/logo.png', '/img/logo.png',
  ]
  for (const p of wellKnownPaths) {
    const score = p.includes('android-chrome-512') ? 35
      : p.includes('apple-touch-icon') ? 30
      : p.includes('favicon.svg') ? 30
      : 25
    addCandidate(origin + p, score)
  }

  // --- SOURCE D: Google favicon (low-res fallback) ---
  addCandidate(`https://www.google.com/s2/favicons?domain=${pageDomain}&sz=128`, 5)

  // Sort by score, deduplicate by path
  const scored = [...candidates.entries()].sort((a, b) => b[1] - a[1])
  const seenPaths = new Set<string>()
  const ranked: string[] = []
  for (const [u] of scored) {
    try {
      const bp = new URL(u).pathname.replace(/\?.*$/, '').toLowerCase()
      if (seenPaths.has(bp)) continue
      seenPaths.add(bp)
    } catch { /* include anyway */ }
    ranked.push(u)
  }

  console.log(`Real-name logo search found ${ranked.length} candidates:`,
    ranked.slice(0, 8).map(u => {
      const s = candidates.get(u) || 0
      return `[${s}] ${u.length > 70 ? u.slice(0, 67) + '...' : u}`
    }))

  return ranked.slice(0, 10)
}

// ============ Deep Brand Research Helpers ============

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(JINA_READER_URL + url, {
      headers: { Accept: 'application/json', 'X-Return-Format': 'markdown' },
    })
    if (response.ok) {
      const data = await response.json()
      return (data.data?.content || data.data?.text || '').substring(0, 5000)
    }
  } catch { /* skip */ }
  return ''
}

async function jinaSearch(query: string, limit = 5): Promise<string> {
  try {
    const response = await fetch(JINA_SEARCH_URL + encodeURIComponent(query), {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return ''
    const data = await response.json()
    const results = data.data || []
    return results
      .slice(0, limit)
      .map((r: any) => `${r.title || ''}: ${(r.content || r.description || '').substring(0, 400)}`)
      .join('\n\n')
  } catch {
    return ''
  }
}

// Discover and fetch the About Us / Our Story page
async function fetchAboutPage(baseUrl: string): Promise<string> {
  const origin = new URL(baseUrl).origin
  const candidates = [
    `${origin}/pages/about`, `${origin}/pages/about-us`, `${origin}/pages/our-story`,
    `${origin}/about`, `${origin}/about-us`, `${origin}/our-story`,
    `${origin}/pages/our-mission`, `${origin}/pages/who-we-are`,
  ]
  for (const candidate of candidates) {
    const content = await fetchPageContent(candidate)
    if (content.length > 200) {
      console.log(`Found About page: ${candidate}`)
      return content
    }
  }
  return ''
}

// Fetch the homepage for brand-level signals
async function fetchHomepage(baseUrl: string): Promise<string> {
  const origin = new URL(baseUrl).origin
  return fetchPageContent(origin)
}

// Search Facebook Ad Library for brand ads
async function searchFacebookAds(brandName: string): Promise<string> {
  return jinaSearch(`${brandName} facebook ad library ads examples`, 3)
}

// Search for press coverage
async function searchPressMedia(brandName: string): Promise<string> {
  return jinaSearch(`${brandName} brand review press coverage`, 4)
}

// Search for Reddit reviews
async function searchRedditReviews(brandName: string): Promise<string> {
  return jinaSearch(`${brandName} review reddit`, 5)
}

// Search for guarantee/warranty/return policy
async function searchGuarantee(brandName: string): Promise<string> {
  return jinaSearch(`${brandName} guarantee warranty return policy`, 3)
}

// Opus → Sonnet → Haiku cascade for brand research (most important analysis in the app)
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
let resolvedResearchModel: string | null = null

async function callWithRetry(
  apiKey: string,
  model: string,
  messages: any[],
  maxTokens: number
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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

    if (response.ok) {
      const data = await response.json()
      return data.content[0].text.trim()
    }

    if (response.status === 404) {
      throw new Error(`model_not_found:${model}`)
    }

    if (response.status === 429 && attempt < 4) {
      const delay = (attempt + 1) * 20000
      console.log(`Rate limited (${model}), waiting ${delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, delay))
      continue
    }

    const err = await response.text()
    throw new Error(`Claude API error: ${err}`)
  }
  throw new Error('Max retries exceeded')
}

// Try Opus → Sonnet → Haiku for brand research
async function callBestAvailableModel(
  apiKey: string,
  messages: any[],
  maxTokens: number
): Promise<string> {
  if (resolvedResearchModel) {
    return callWithRetry(apiKey, resolvedResearchModel, messages, maxTokens)
  }

  const allCandidates = [...OPUS_CANDIDATES, ...SONNET_CANDIDATES]
  for (const candidate of allCandidates) {
    try {
      const result = await callWithRetry(apiKey, candidate, messages, maxTokens)
      resolvedResearchModel = candidate
      console.log(`Brand research using model: ${candidate}`)
      return result
    } catch (e: any) {
      if (e.message?.startsWith('model_not_found')) {
        console.log(`Model ${candidate} not available, trying next...`)
        continue
      }
      throw e
    }
  }

  // Don't cache Haiku — retry higher models next time
  console.log('No Opus/Sonnet available, using Haiku for this call')
  return callWithRetry(apiKey, HAIKU, messages, maxTokens)
}

function cleanJson(text: string): string {
  let t = text
  if (t.startsWith('```')) t = t.split('\n').slice(1).join('\n')
  if (t.endsWith('```')) t = t.slice(0, t.lastIndexOf('```'))
  if (t.startsWith('json')) t = t.slice(4)
  return t.trim()
}

export async function researchBrand(
  claudeApiKey: string,
  url: string,
  pageContent: string,
  detectedFonts?: string[],
  detectedColors?: string[],
  onStatus?: (status: string) => void
): Promise<{ brandDna: BrandDna; personas: Persona[] }> {
  const brandNameGuess = new URL(url).hostname.replace('www.', '').split('.')[0]

  const fontHint = detectedFonts && detectedFonts.length > 0
    ? `\n\nDETECTED FONTS FROM CSS (use these exactly, do not guess): ${detectedFonts.join(', ')}`
    : ''
  const colorHint = detectedColors && detectedColors.length > 0
    ? `\nDETECTED COLORS FROM CSS (use these as the brand colors): ${detectedColors.join(', ')}`
    : ''

  // ===== DEEP RESEARCH — all in parallel =====
  onStatus?.('Deep research: scanning brand presence...')
  const [
    aboutPageContent,
    homepageContent,
    redditReviews,
    guaranteeInfo,
    pressMedia,
    facebookAds,
  ] = await Promise.all([
    fetchAboutPage(url),
    fetchHomepage(url),
    searchRedditReviews(brandNameGuess),
    searchGuarantee(brandNameGuess),
    searchPressMedia(brandNameGuess),
    searchFacebookAds(brandNameGuess),
  ])

  console.log(`Deep research complete: about=${aboutPageContent.length > 0}, homepage=${homepageContent.length > 0}, reddit=${redditReviews.length > 0}, press=${pressMedia.length > 0}, fbAds=${facebookAds.length > 0}, guarantee=${guaranteeInfo.length > 0}`)

  // Build research dossier
  const researchSections: string[] = []

  researchSections.push(`=== PRODUCT PAGE ===\n${pageContent.substring(0, 6000)}`)

  if (aboutPageContent) {
    researchSections.push(`=== ABOUT US / OUR STORY PAGE ===\n${aboutPageContent.substring(0, 3000)}`)
  }

  if (homepageContent) {
    researchSections.push(`=== HOMEPAGE ===\n${homepageContent.substring(0, 3000)}`)
  }

  if (redditReviews) {
    researchSections.push(`=== CUSTOMER REVIEWS (Reddit) ===\n${redditReviews.substring(0, 2000)}`)
  }

  if (pressMedia) {
    researchSections.push(`=== PRESS & MEDIA COVERAGE ===\n${pressMedia.substring(0, 2000)}`)
  }

  if (facebookAds) {
    researchSections.push(`=== FACEBOOK AD LIBRARY / AD EXAMPLES ===\n${facebookAds.substring(0, 1500)}`)
  }

  if (guaranteeInfo) {
    researchSections.push(`=== GUARANTEE / WARRANTY / RETURN POLICY ===\n${guaranteeInfo}`)
  }

  onStatus?.('Analyzing brand identity...')

  const text = await callBestAvailableModel(
    claudeApiKey,
    [
      {
        role: 'user',
        content: `You are a Senior Brand Strategist building a comprehensive brand identity dossier for AI ad generation. You have been given research from MULTIPLE sources: the product page, About Us page, homepage, customer reviews, press coverage, and Facebook Ad Library results. Synthesize ALL of this to build the most accurate, detailed brand profile possible.

Every detail matters because the output feeds into an image model that needs exact visual specifications.

URL: ${url}
${fontHint}${colorHint}

${researchSections.join('\n\n')}

===== YOUR ANALYSIS BRIEF =====

Study ALL provided sources to understand:

1. BRAND VOICE & IDENTITY: How do they talk about themselves? What words do they use? What's the brand personality? Study the About Us page, homepage hero copy, and product descriptions. Note the tone, word choice, sentence structure.

2. PHOTOGRAPHY STYLE: From the product page imagery, describe EXACTLY what you see — lighting setup (hard flash? soft natural? warm ambient?), color grading (cool and clinical? warm and golden? saturated?), composition (centered hero? lifestyle context? flat lay?), surfaces/props used, and overall mood. Also note if Facebook ads show a different style.

3. PACKAGING & PRODUCT: Describe the actual physical product and packaging visible on the page. Shape, materials, label design, distinctive features.

4. LAYOUT DENSITY: Is the site minimal with lots of white space, or dense with information? How much text overlays on images? This informs ad template matching.

5. COMPETITIVE POSITIONING: From press coverage and their own copy, how do they position against competitors? What claims do they emphasize?

6. AD CREATIVE PATTERNS: If Facebook Ad Library results are available, describe the ad creative style they already use — formats, copy patterns, visual approaches, UGC usage.

7. CUSTOMER PERCEPTION: From Reddit reviews, what do real customers say? What do they praise? What do they complain about?

CATEGORY RULES — be SPECIFIC and ACCURATE:
- "Wallets & Accessories" NOT "Fashion" for a wallet brand
- "Protein Bars & Nutrition" NOT just "Food" for a protein bar
- "Outdoor Gear" NOT "Fashion" for outdoor equipment
- "EDC & Gear" NOT "Accessories" for everyday carry
- Use the most specific applicable category. Look at what they ACTUALLY sell.

Return this exact JSON structure:
{
  "brandDna": {
    "name": "Brand name",
    "url": "${url}",
    "description": "2 sentence brand/product description. Plain language.",
    "category": "SPECIFIC market category based on actual products sold",
    "brandSummary": "1 sentence positioning statement",
    "colors": [${detectedColors && detectedColors.length > 0 ? detectedColors.map((c) => `"${c}"`).join(', ') : '"#hex1", "#hex2", "#hex3"'}],
    "fonts": [${detectedFonts && detectedFonts.length > 0 ? detectedFonts.map((f) => `"${f}"`).join(', ') : '"font1"'}],
    "voiceTone": "Detailed tone description synthesized from About Us, homepage copy, and product descriptions. Include specific word choices and sentence style the brand uses.",
    "voiceAdjectives": ["adj1", "adj2", "adj3", "adj4", "adj5"],
    "targetAudience": "Detailed audience description from customer reviews, brand messaging, and press",
    "keyBenefits": ["benefit1", "benefit2", "benefit3"],
    "usps": ["usp1", "usp2"],
    "featuresAndBenefits": "Key features summary including any guarantees, warranties, or return policies found",
    "brandGuidelinesAnalysis": "Synthesis of brand visual rules inferred from site: color usage patterns, typography hierarchy, image treatment, whitespace approach, CTA style",
    "photographyDirection": {
      "lighting": "DESCRIBE EXACTLY what you see — e.g. 'Hard direct flash with sharp shadows, high contrast' or 'Soft diffused daylight from upper left, minimal shadows'",
      "colorGrading": "DESCRIBE EXACTLY — e.g. 'Desaturated cool tones with teal shadows and warm highlights' or 'High saturation, punchy colors, lifted blacks'",
      "composition": "DESCRIBE EXACTLY — e.g. 'Product centered at 60% frame, 45-degree angle, shallow DOF with blurred background' or 'Flat lay overhead, product arranged with props on textured surface'",
      "subjectMatter": "What is typically shown — product alone? person using it? lifestyle scene? ingredients? Close-up or wide?",
      "propsAndSurfaces": "DESCRIBE EXACTLY — e.g. 'Dark slate surface, scattered raw ingredients, moody lighting' or 'Clean white background, no props, minimal styling'",
      "mood": "DESCRIBE EXACTLY — e.g. 'Rugged and masculine, outdoor adventure feel' or 'Clean and premium, Apple-inspired minimalism'"
    },
    "packagingDetails": {
      "physicalDescription": "Describe actual product/packaging visible on page — shape, size, materials, finish",
      "labelLogoPlacement": "Where logo and text sit on the product",
      "distinctiveFeatures": "What makes this product visually recognizable"
    },
    "adCreativeStyle": {
      "typicalFormats": "If Facebook ad data available, describe actual ad formats used. Otherwise infer from site style.",
      "textOverlayStyle": "How text is used over images — bold headlines? minimal? data-heavy?",
      "photoVsIllustration": "Photography only? Illustrations? Mixed? CGI/3D renders?",
      "ugcUsage": "Do they use UGC in ads? Customer photos? Influencer content?",
      "offerPresentation": "How they present deals/offers in ads"
    },
    "promptModifier": "Write a 50-75 word paragraph that can prepend ANY image prompt to match this brand. Include exact hex colors, lighting direction, color grading, surface/prop preferences, photography angle, and emotional mood. Be specific enough that an AI image model produces on-brand results every time. This is THE most important field.",
    "backgroundColors": ["#hex for typical background", "#hex for alternate bg"],
    "ctaStyle": "Exact CTA button style from the website",
    "competitiveDifferentiation": "1 sentence on what makes this brand unique, sourced from press coverage or brand copy",
    "guarantee": "e.g. Lifetime Warranty, 99-day trial, 30-day money-back guarantee. Write null if none found.",
    "productType": "The SPECIFIC type of physical product (e.g. titanium wallet, whey protein bar, vitamin C serum)"
  },
  "personas": [
    {
      "id": "p1",
      "name": "Short first name only",
      "age": "25-35",
      "description": "1-2 short sentences based on actual customer reviews and brand audience data.",
      "painPoints": ["from real customer complaints/needs"],
      "motivations": ["from real customer praise/desires"]
    }
  ]
}

${detectedFonts && detectedFonts.length > 0 ? `CRITICAL: The fonts array MUST be exactly: [${detectedFonts.map((f) => `"${f}"`).join(', ')}]. These were detected from the actual CSS. Do not change or guess different fonts.` : ''}
${detectedColors && detectedColors.length > 0 ? `CRITICAL: The colors array MUST use these detected CSS colors: [${detectedColors.map((c) => `"${c}"`).join(', ')}]. Do not guess different colors.` : ''}

IMPORTANT:
- Plain language, no em dashes, no semicolons. Short sentences.
- Generate 3 personas based on REAL customer review data when available, not generic archetypes.
- category: Be PRECISE — "Wallets & EDC" for wallets, "Protein Bars" for protein bars. Never generic categories.
- photographyDirection: DESCRIBE WHAT YOU ACTUALLY SEE. Specific lighting setups, angles, color grading. Not generic descriptions.
- promptModifier: This is THE most important field. Must be hyper-specific to this brand's exact visual style.
- brandGuidelinesAnalysis: Synthesize visual rules from everything you observed across all pages.
- adCreativeStyle: Use Facebook Ad Library data if available to describe their actual ad approach.
- If a field is not observable from any source, write "Not visible" rather than guessing.

Return ONLY valid JSON.`,
      },
    ],
    4000
  )

  return JSON.parse(cleanJson(text))
}

export async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  // Handle data: URIs directly (e.g. data:image/svg+xml;base64,...)
  if (imageUrl.startsWith('data:image/')) {
    // For SVG data URIs, rasterize to PNG via canvas
    if (imageUrl.startsWith('data:image/svg+xml')) {
      try {
        return await new Promise((resolve) => {
          const img = new Image()
          img.onload = () => {
            const w = Math.max(img.naturalWidth || 400, 400)
            const h = Math.max(img.naturalHeight || 200, Math.round(400 * ((img.naturalHeight || 200) / (img.naturalWidth || 400))))
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')!
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, w, h)
            ctx.drawImage(img, 0, 0, w, h)
            resolve(canvas.toDataURL('image/png'))
          }
          img.onerror = () => resolve(null)
          setTimeout(() => resolve(null), 5000)
          img.src = imageUrl
        })
      } catch { return null }
    }
    // Other data URIs (PNG, JPEG) — return as-is
    return imageUrl
  }

  // Handle inline SVG data URLs — rasterize via canvas
  if (imageUrl.startsWith('svg-inline:')) {
    const dataUrl = imageUrl.slice('svg-inline:'.length)
    try {
      return await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          // Scale up if tiny (SVGs often have small viewBox)
          const w = Math.max(img.naturalWidth, 400)
          const h = Math.max(img.naturalHeight, Math.round(400 * (img.naturalHeight / img.naturalWidth)))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')!
          // White background for transparent SVGs
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          const result = canvas.toDataURL('image/png')
          console.log(`Rasterized inline SVG logo: ${w}x${h}`)
          resolve(result)
        }
        img.onerror = () => { console.log('Failed to rasterize inline SVG'); resolve(null) }
        setTimeout(() => resolve(null), 5000)
        img.src = dataUrl
      })
    } catch {
      return null
    }
  }

  const MIN_SIZE = 200 // Logos can be small — 200 bytes is enough for a simple SVG/PNG

  function blobToBase64(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  }

  // Rasterize an SVG data URI to PNG via canvas (SVGs can't be sent to AI models)
  function rasterizeSvgDataUri(dataUri: string): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        try {
          const w = Math.max(img.naturalWidth || 400, 400)
          const h = Math.max(img.naturalHeight || 200, Math.round(w * ((img.naturalHeight || 200) / (img.naturalWidth || 400))))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/png'))
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      setTimeout(() => resolve(null), 5000)
      img.src = dataUri
    })
  }

  // Helper: convert non-standard formats (SVG, AVIF, HEIC, WebP) to JPEG/PNG via canvas
  async function ensureRasterized(result: string | null, label: string): Promise<string | null> {
    if (!result) return null
    if (result.startsWith('data:image/svg+xml')) {
      console.log(`${label}: SVG detected, rasterizing to PNG...`)
      const rasterized = await rasterizeSvgDataUri(result)
      if (rasterized) { console.log(`${label}: SVG rasterized OK`); return rasterized }
      console.log(`${label}: SVG rasterization failed`)
      return null
    }
    // Convert AVIF, HEIC, and other exotic formats to JPEG
    const mime = result.split(';')[0]?.split(':')[1] || ''
    if (mime && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
      console.log(`${label}: Converting ${mime} to JPEG...`)
      try {
        return await new Promise((resolve) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)
            resolve(canvas.toDataURL('image/jpeg', 0.9))
          }
          img.onerror = () => resolve(result) // Can't convert, return original
          setTimeout(() => resolve(result), 5000)
          img.src = result
        })
      } catch { return result }
    }
    return result
  }

  // Method 1: Local Vite proxy (Node.js server-side fetch — no CORS restrictions at all)
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`
    const response = await fetch(proxyUrl)
    if (response.ok) {
      const blob = await response.blob()
      if (blob.size > MIN_SIZE) {
        const result = await ensureRasterized(await blobToBase64(blob), 'local proxy')
        if (result) { console.log(`Logo download OK (local proxy): ${imageUrl} (${blob.size}b)`); return result }
      }
    }
  } catch (e: any) {
    console.log(`Logo local proxy failed (${e.message?.slice(0, 40)}): ${imageUrl}`)
  }

  // Method 2: Direct fetch (works if server allows CORS)
  try {
    const response = await fetch(imageUrl, { mode: 'cors', headers: { Accept: 'image/*' } })
    if (response.ok) {
      const blob = await response.blob()
      if (blob.size > MIN_SIZE && blob.type.startsWith('image/')) {
        const result = await ensureRasterized(await blobToBase64(blob), 'direct')
        if (result) { console.log(`Logo download OK (direct): ${imageUrl} (${blob.size}b)`); return result }
      }
    }
  } catch (e: any) {
    console.log(`Logo direct fetch failed (${e.message?.slice(0, 40)}): ${imageUrl}`)
  }

  // Method 3: CORS proxy via wsrv.nl
  try {
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&w=800&q=90&output=jpg`
    const response = await fetch(proxyUrl, { mode: 'cors' })
    if (response.ok) {
      const blob = await response.blob()
      if (blob.size > MIN_SIZE) {
        const result = await ensureRasterized(await blobToBase64(blob), 'wsrv proxy')
        if (result) { console.log(`Logo download OK (wsrv proxy): ${imageUrl} (${blob.size}b)`); return result }
      }
    }
  } catch (e: any) {
    console.log(`Logo proxy failed (${e.message?.slice(0, 40)}): ${imageUrl}`)
  }

  // Method 4: Image element + canvas (works for images with permissive CORS headers)
  try {
    return await new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          if (img.naturalWidth < 10 || img.naturalHeight < 10) { resolve(null); return }
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0)
            const result = canvas.toDataURL('image/png')
            console.log(`Logo download OK (canvas): ${imageUrl} (${img.naturalWidth}x${img.naturalHeight})`)
            resolve(result)
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => { console.log(`Logo canvas load failed: ${imageUrl}`); resolve(null) }
      setTimeout(() => { console.log(`Logo canvas timeout: ${imageUrl}`); resolve(null) }, 10000)
      img.src = imageUrl
    })
  } catch {
    return null
  }
}
