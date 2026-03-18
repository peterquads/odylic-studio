import { GoogleGenAI } from '@google/genai'
import type { AspectRatio, ModelTier } from '../types'
import { notifyModelUsed } from './claude'
import { detectMediaType } from '../utils/image'

// Nano Banana 2 (best image gen) — use exclusively
const MODEL_NANO_BANANA_2 = 'gemini-3.1-flash-image-preview'
// Fallbacks
const MODEL_IMAGE_PRO = 'gemini-3-pro-image-preview'
const MODEL_IMAGE_FAST = 'gemini-2.5-flash-image'

const MODEL_FRIENDLY_NAMES: Record<string, string> = {
  [MODEL_NANO_BANANA_2]: 'Nano Banana 2',
  [MODEL_IMAGE_PRO]: 'Nano Banana Pro',
  [MODEL_IMAGE_FAST]: 'Nano Banana',
}
function friendlyModel(id: string) { return MODEL_FRIENDLY_NAMES[id] || id }

// Wrap a promise with a timeout
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

async function callWithRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
  initialDelay = 2000
): Promise<T> {
  let lastError: any
  for (let i = 0; i < retries; i++) {
    try {
      return await operation()
    } catch (error: any) {
      lastError = error
      const isAccessDenied =
        error?.status === 403 ||
        error?.message?.includes('403') ||
        error?.message?.includes('PERMISSION_DENIED')
      if (isAccessDenied) throw error

      const isTimeout = error?.message?.includes('timed out')
      const isRateLimit =
        error?.status === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('quota')

      if ((isRateLimit || isTimeout) && i < retries - 1) {
        const delay = initialDelay * Math.pow(2, i)
        console.log(`${isTimeout ? 'Timeout' : 'Rate limited'}, retrying in ${delay / 1000}s...`)
        await new Promise((r) => setTimeout(r, delay))
      } else if (i === retries - 1) {
        throw error
      }
    }
  }
  throw lastError
}

export async function generateImage(
  apiKey: string,
  prompt: string,
  assetImages: { base64: string; mimeType: string }[],
  aspectRatio: AspectRatio,
  modelTier: ModelTier,
  templateImage?: { base64: string; mimeType: string } | null
): Promise<{ imageUrl: string; modelUsed: string }> {
  const ai = new GoogleGenAI({ apiKey })

  // Standard (Fast): Nano Banana (free) → Flash fallback
  // HD (Quality): Nano Banana 2 → Pro fallback
  // 2k (Pro): Nano Banana Pro → Nano Banana 2 fallback
  const model = modelTier === '2k' ? MODEL_IMAGE_PRO
    : modelTier === 'hd' ? MODEL_NANO_BANANA_2
    : MODEL_IMAGE_FAST
  const fallbackModel = modelTier === '2k' ? MODEL_NANO_BANANA_2
    : modelTier === 'hd' ? MODEL_IMAGE_PRO
    : MODEL_NANO_BANANA_2

  // Request higher res on Pro — may be silently downgraded to 1K by Google's preview models
  const imageConfig: any = { aspectRatio }
  if (modelTier === '2k') {
    imageConfig.imageSize = '2K'
  }

  // Template image goes FIRST so the prompt can reference "Image 1"
  const allImages: { base64: string; mimeType: string }[] = []
  if (templateImage) {
    allImages.push(templateImage)
  }
  allImages.push(...assetImages)

  const imageParts = allImages.map((img) => ({
    inlineData: {
      data: img.base64.includes(',') ? img.base64.split(',')[1] : img.base64,
      mimeType: img.mimeType,
    },
  }))

  console.log(`[GEMINI] imageConfig:`, JSON.stringify(imageConfig), `| models: ${model} → ${fallbackModel} → ${MODEL_IMAGE_FAST}`)

  const params = {
    contents: { parts: [...imageParts, { text: prompt }] },
    config: {
      responseModalities: ['TEXT' as any, 'IMAGE' as any],
      imageConfig,
    },
  }

  // Try Nano Banana 2 first, then fall back through older models
  const modelsToTry = [model, fallbackModel, MODEL_IMAGE_FAST]
  let lastError: any

  for (const currentModel of modelsToTry) {
    try {
      const currentParams = {
        ...params,
        config: {
          ...params.config,
          imageConfig: currentModel === MODEL_IMAGE_FAST ? { aspectRatio } : imageConfig,
        },
      }
      const response = await callWithRetry(() =>
        withTimeout(
          ai.models.generateContent({ model: currentModel, ...currentParams }),
          90000,
          `Gemini ${currentModel}`
        )
      )
      if (currentModel !== model) {
        console.log(`[GEMINI] Used fallback model: ${currentModel}`)
      }
      console.log(`[GEMINI] ✓ Success: ${friendlyModel(currentModel)} (${currentModel})`)
      notifyModelUsed('Gemini (image gen)', currentModel)
      return { imageUrl: extractImage(response), modelUsed: friendlyModel(currentModel) }
    } catch (error: any) {
      console.warn(`Model ${currentModel} failed:`, error?.message?.slice(0, 200), error?.status || '')
      lastError = error
      // Continue to next model
    }
  }

  throw lastError
}

export async function resizeImage(
  apiKey: string,
  masterImageBase64: string,
  masterRatio: AspectRatio,
  targetRatio: AspectRatio,
  modelTier: ModelTier,
): Promise<string> {
  console.log(`[RESIZE] ${masterRatio} → ${targetRatio} | sending 1 image only | tier: ${modelTier}`)
  const ai = new GoogleGenAI({ apiKey })

  const imageConfig: any = { aspectRatio: targetRatio }

  const masterData = masterImageBase64.includes(',')
    ? masterImageBase64.split(',')[1]
    : masterImageBase64
  const masterMime = detectMediaType(masterImageBase64)

  const resizePrompt = `Image 1 is a FINISHED advertisement at ${masterRatio}.
Reproduce this EXACT ad at ${targetRatio}.

RULES:
- Keep the EXACT same text (every word, every letter).
- Keep the EXACT same products, colors, layout structure.
- Adapt framing for new ratio — extend background if going wider, add breathing room if going taller.
- Do NOT crop text, products, or people at edges.
- Do NOT re-render or reimagine any product — keep photos identical.
- Do NOT add or remove any elements.`

  const params = {
    contents: {
      parts: [
        { inlineData: { data: masterData, mimeType: masterMime } },
        { text: resizePrompt },
      ],
    },
    config: {
      responseModalities: ['IMAGE' as any],
      imageConfig,
    },
  }

  const modelsToTry = [MODEL_NANO_BANANA_2, MODEL_IMAGE_PRO, MODEL_IMAGE_FAST]
  let lastError: any

  for (const currentModel of modelsToTry) {
    try {
      const currentParams = {
        ...params,
        config: {
          ...params.config,
          imageConfig: currentModel === MODEL_IMAGE_FAST ? { aspectRatio: targetRatio } : imageConfig,
        },
      }
      const response = await callWithRetry(() =>
        withTimeout(
          ai.models.generateContent({ model: currentModel, ...currentParams }),
          90000,
          `Gemini resize ${currentModel}`
        )
      )
      notifyModelUsed('Gemini (resize)', currentModel)
      return extractImage(response)
    } catch (error: any) {
      console.warn(`Resize model ${currentModel} failed:`, error?.message?.slice(0, 100))
      lastError = error
    }
  }
  throw lastError
}

export async function editImage(
  apiKey: string,
  originalImageBase64: string,
  maskBase64: string,
  editInstructions: string,
  referenceImages?: { base64: string; mimeType: string }[],
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey })

  const originalData = originalImageBase64.includes(',')
    ? originalImageBase64.split(',')[1]
    : originalImageBase64
  const maskData = maskBase64.includes(',')
    ? maskBase64.split(',')[1]
    : maskBase64

  const parts: any[] = [
    { inlineData: { data: originalData, mimeType: detectMediaType(originalImageBase64) } },
    { inlineData: { data: maskData, mimeType: 'image/png' } }, // Masks are always PNG (canvas-generated)
  ]

  // Attach reference images (product photos, logos) for region edits
  if (referenceImages?.length) {
    for (const img of referenceImages) {
      const data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64
      parts.push({ inlineData: { data, mimeType: img.mimeType } })
    }
  }

  const refNote = referenceImages?.length
    ? ` Images 3-${2 + referenceImages.length} are REAL product/logo photographs — PASTE these exact images into the edited regions when the instructions mention products or logos.`
    : ''

  parts.push({
    text: `Image 1 = original ad. Image 2 = mask (WHITE = edit, BLACK = keep unchanged).${refNote} Edit ONLY the white masked regions: ${editInstructions}. Keep everything in black regions exactly as-is.`,
  })

  const params = {
    contents: { parts },
    config: {
      responseModalities: ['IMAGE' as any],
    },
  }

  const modelsToTry = [MODEL_NANO_BANANA_2, MODEL_IMAGE_PRO, MODEL_IMAGE_FAST]
  let lastError: any

  for (const model of modelsToTry) {
    try {
      const response = await callWithRetry(() =>
        withTimeout(
          ai.models.generateContent({ model, ...params }),
          90000,
          `Gemini edit ${model}`
        )
      )
      notifyModelUsed('Gemini (image edit)', model)
      return extractImage(response)
    } catch (error: any) {
      console.warn(`Edit model ${model} failed:`, error?.message?.slice(0, 100))
      lastError = error
    }
  }
  throw lastError
}

function extractImage(response: any): string {
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (p: any) => p.inlineData
  )
  if (!imagePart?.inlineData) {
    throw new Error('No image generated — API returned no image data')
  }

  const { mimeType, data } = imagePart.inlineData
  if (!data || data.length < 100) {
    throw new Error('Empty or corrupt image returned — base64 data too small')
  }
  if (!mimeType || !mimeType.startsWith('image/')) {
    throw new Error(`Invalid image type returned: ${mimeType || 'undefined'}`)
  }

  // Validate base64 by checking first bytes for image signature
  try {
    const bytes = atob(data.substring(0, 24))
    const isJpeg = bytes.charCodeAt(0) === 0xFF && bytes.charCodeAt(1) === 0xD8
    const isPng = bytes.substring(1, 4) === 'PNG'
    const isWebp = bytes.substring(0, 4) === 'RIFF' && bytes.substring(8, 12) === 'WEBP'
    if (!isJpeg && !isPng && !isWebp) {
      console.warn('Generated image has unexpected file signature — may be corrupt')
    }
  } catch {
    throw new Error('Invalid base64 data in generated image')
  }

  return `data:${mimeType};base64,${data}`
}
