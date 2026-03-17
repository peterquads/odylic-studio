import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { GeneratedAd } from '../types'

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 30)
}

function buildRichFilename(ad: GeneratedAd, ext: string): string {
  const date = new Date(ad.timestamp).toISOString().slice(0, 10).replace(/-/g, '')
  const parts = [
    ad.id.slice(-6),                                          // unique ID
    date,                                                      // YYYYMMDD
    slugify(ad.strategyAngle || 'general'),                    // angle
    slugify(ad.strategyConcept || 'ad'),                       // concept
    slugify(ad.formatType || ad.templateFilename.replace(/\.\w+$/, '')), // production style
    `v${ad.version || 1}`,                                     // iteration
  ]
  return parts.join('-') + '.' + ext
}

export async function downloadSingleImage(ad: GeneratedAd, brandName: string) {
  if (!ad.imageUrl) {
    console.warn('Cannot download ad with no image')
    return
  }
  const blob = dataUrlToBlob(ad.imageUrl)
  const ext = ad.imageUrl.includes('image/png') ? 'png' : 'jpg'
  const filename = `${slugify(brandName)}-${buildRichFilename(ad, ext)}`
  saveAs(blob, filename)
}

export async function downloadAllAsZip(ads: GeneratedAd[], brandName: string) {
  // Filter out ads with no image (failed generations)
  const validAds = ads.filter((ad) => ad.imageUrl && ad.imageUrl.length > 100)
  if (validAds.length === 0) {
    console.warn('No valid images to download')
    return
  }

  const zip = new JSZip()
  const folder = zip.folder(`${slugify(brandName)}-creatives`)!

  // Track filenames to prevent collisions
  const usedNames = new Set<string>()

  validAds.forEach((ad) => {
    const ext = ad.imageUrl.includes('image/png') ? 'png' : 'jpg'
    let name = buildRichFilename(ad, ext)

    // Deduplicate filenames
    if (usedNames.has(name)) {
      let counter = 2
      const base = name.replace(/\.\w+$/, '')
      const extPart = name.match(/\.\w+$/)?.[0] || '.jpg'
      while (usedNames.has(`${base}-${counter}${extPart}`)) counter++
      name = `${base}-${counter}${extPart}`
    }
    usedNames.add(name)

    const blob = dataUrlToBlob(ad.imageUrl)
    folder.file(name, blob)
  })

  const content = await zip.generateAsync({ type: 'blob' })
  saveAs(content, `${slugify(brandName)}-creatives.zip`)
}

function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl || !dataUrl.includes(',')) {
    throw new Error('Invalid data URL — cannot convert to blob')
  }
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
  try {
    const bytes = atob(data)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    return new Blob([arr], { type: mime })
  } catch {
    throw new Error('Corrupted image data — cannot download')
  }
}
