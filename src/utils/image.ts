export function detectMediaType(base64: string): string {
  // Also check the data URI header for exotic formats the browser decoded
  if (base64.startsWith('data:')) {
    const headerMime = base64.split(';')[0]?.split(':')[1] || ''
    // For formats we can detect by magic bytes, fall through to byte detection
    // For exotic formats, trust the header
    if (headerMime === 'image/avif' || headerMime === 'image/heic' || headerMime === 'image/heif' ||
        headerMime === 'image/svg+xml' || headerMime === 'image/tiff' || headerMime === 'image/bmp') {
      return headerMime
    }
  }
  const data = base64.includes(',') ? base64.split(',')[1] : base64
  if (!data || data.length < 16) return 'image/jpeg'
  const bytes = atob(data.substring(0, 32))
  if (bytes.charCodeAt(0) === 0xff && bytes.charCodeAt(1) === 0xd8) return 'image/jpeg'
  if (bytes.substring(1, 4) === 'PNG') return 'image/png'
  if (bytes.substring(0, 4) === 'RIFF' && bytes.substring(8, 12) === 'WEBP') return 'image/webp'
  if (bytes.substring(0, 3) === 'GIF') return 'image/gif'
  // HEIC/HEIF: ftyp box at offset 4, brand heic/heix/mif1
  if (bytes.substring(4, 8) === 'ftyp') {
    const brand = bytes.substring(8, 12)
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'image/heic'
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  // BMP
  if (bytes.substring(0, 2) === 'BM') return 'image/bmp'
  // TIFF (little-endian II or big-endian MM)
  if ((bytes.substring(0, 2) === 'II' || bytes.substring(0, 2) === 'MM') &&
      bytes.charCodeAt(2) === 42) return 'image/tiff'
  return 'image/jpeg'
}

export function stripDataUri(base64: string): string {
  return base64.includes(',') ? base64.split(',')[1] : base64
}

export function toDataUrl(base64: string, mimeType: string): string {
  if (base64.startsWith('data:')) return base64
  return `data:${mimeType};base64,${base64}`
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Claude API limit: 5 MB base64. Compress images that exceed this.
const MAX_BASE64_BYTES = 4_500_000 // Leave headroom below 5MB

export async function compressForApi(base64DataUrl: string): Promise<string> {
  const raw = stripDataUri(base64DataUrl)
  // Check size (base64 is ~4/3 of binary, so raw length ≈ bytes * 1.37)
  if (raw.length <= MAX_BASE64_BYTES) return base64DataUrl

  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // Scale down to fit under limit
      let { naturalWidth: w, naturalHeight: h } = img
      // Start with quality reduction, then scale if still too big
      let quality = 0.8
      let scale = 1

      // If image is very large, scale down proportionally
      const pixels = w * h
      if (pixels > 4_000_000) { // > 4 megapixels
        scale = Math.sqrt(4_000_000 / pixels)
        w = Math.round(w * scale)
        h = Math.round(h * scale)
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)

      // Try progressively lower quality until under limit
      for (quality = 0.8; quality >= 0.3; quality -= 0.1) {
        const result = canvas.toDataURL('image/jpeg', quality)
        if (stripDataUri(result).length <= MAX_BASE64_BYTES) {
          console.log(`Compressed image: ${(raw.length / 1024).toFixed(0)}KB → ${(stripDataUri(result).length / 1024).toFixed(0)}KB (q=${quality.toFixed(1)}, ${w}x${h})`)
          resolve(result)
          return
        }
      }

      // Nuclear: scale down more aggressively
      const smallW = Math.round(w * 0.5)
      const smallH = Math.round(h * 0.5)
      canvas.width = smallW
      canvas.height = smallH
      ctx.drawImage(img, 0, 0, smallW, smallH)
      const result = canvas.toDataURL('image/jpeg', 0.6)
      console.log(`Compressed image (aggressive): ${(raw.length / 1024).toFixed(0)}KB → ${(stripDataUri(result).length / 1024).toFixed(0)}KB (${smallW}x${smallH})`)
      resolve(result)
    }
    img.onerror = () => resolve(base64DataUrl) // Can't compress, return original
    img.src = base64DataUrl
  })
}

// Check if a base64 image is in a format Claude can read
export function isApiSupportedFormat(base64: string): boolean {
  const type = detectMediaType(base64)
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
}

// Convert unsupported formats (AVIF, etc.) to JPEG via canvas
export async function convertToJpeg(base64DataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => resolve(base64DataUrl)
    img.src = base64DataUrl
  })
}

// Create a mask image from region bounding boxes (for Gemini editImage inpainting)
// Regions use percentage coordinates (0-1). White = edit zone, black = keep.
export async function createMaskFromRegions(
  imageBase64: string,
  regions: { x: number; y: number; w: number; h: number }[],
  padding = 0.03,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!

      // Fill black (keep everything)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw white rectangles for edit regions (with padding)
      ctx.fillStyle = '#ffffff'
      for (const r of regions) {
        const x = Math.max(0, (r.x - padding) * canvas.width)
        const y = Math.max(0, (r.y - padding) * canvas.height)
        const w = Math.min(canvas.width - x, (r.w + padding * 2) * canvas.width)
        const h = Math.min(canvas.height - y, (r.h + padding * 2) * canvas.height)
        ctx.fillRect(x, y, w, h)
      }

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load image for mask generation'))
    img.src = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
  })
}

// Template base URL — local dev: Vite middleware, production: CDN
const TEMPLATES_BASE = import.meta.env.VITE_TEMPLATES_BASE_URL || '/templates'

export function templateUrl(filename: string): string {
  const base = TEMPLATES_BASE.endsWith('/') ? TEMPLATES_BASE.slice(0, -1) : TEMPLATES_BASE
  return `${base}/${filename}`
}

// Load a template image as base64
export async function loadTemplateImage(filename: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(templateUrl(filename))
    if (!response.ok) return null
    const blob = await response.blob()
    const mimeType = blob.type || 'image/jpeg'
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve({ base64: result, mimeType })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
