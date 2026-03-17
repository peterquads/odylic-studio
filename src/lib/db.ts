import { createStore, get, set, del, keys } from 'idb-keyval'
import type { BrandDna, Persona, UploadedAsset, GeneratedAd, CustomTemplate } from '../types'

const profileStore = createStore('odylic-profiles', 'profiles')
const sessionStore = createStore('odylic-session', 'session')

// Session-level persistence for in-memory data that would be lost on reload
const SESSION_ASSETS_KEY = 'session-assets'
const SESSION_RESULTS_KEY = 'session-results'
const CUSTOM_TEMPLATES_KEY = 'custom-templates'

export async function saveSessionAssets(assets: UploadedAsset[]): Promise<void> {
  await set(SESSION_ASSETS_KEY, assets, sessionStore)
}

export async function loadSessionAssets(): Promise<UploadedAsset[]> {
  return (await get<UploadedAsset[]>(SESSION_ASSETS_KEY, sessionStore)) || []
}

export async function saveSessionResults(results: GeneratedAd[]): Promise<void> {
  await set(SESSION_RESULTS_KEY, results, sessionStore)
}

export async function loadSessionResults(): Promise<GeneratedAd[]> {
  return (await get<GeneratedAd[]>(SESSION_RESULTS_KEY, sessionStore)) || []
}

export async function saveCustomTemplates(templates: CustomTemplate[]): Promise<void> {
  await set(CUSTOM_TEMPLATES_KEY, templates, sessionStore)
}

export async function loadCustomTemplates(): Promise<CustomTemplate[]> {
  return (await get<CustomTemplate[]>(CUSTOM_TEMPLATES_KEY, sessionStore)) || []
}

export async function clearSession(): Promise<void> {
  await del(SESSION_ASSETS_KEY, sessionStore)
  await del(SESSION_RESULTS_KEY, sessionStore)
}

export interface BrandProfile {
  id: string
  name: string
  savedAt: number
  brandDna: BrandDna
  personas: Persona[]
  assets: UploadedAsset[]
  results: GeneratedAd[]
  savedAdIds: string[]
}

export async function saveProfile(profile: BrandProfile): Promise<void> {
  await set(profile.id, profile, profileStore)
}

export async function loadProfile(id: string): Promise<BrandProfile | undefined> {
  return get<BrandProfile>(id, profileStore)
}

export async function deleteProfile(id: string): Promise<void> {
  await del(id, profileStore)
}

export async function listProfiles(): Promise<{ id: string; name: string; savedAt: number; assetCount: number; resultCount: number; url?: string }[]> {
  const allKeys = await keys(profileStore)
  const summaries: { id: string; name: string; savedAt: number; assetCount: number; resultCount: number; url?: string }[] = []
  for (const key of allKeys) {
    const profile = await get<BrandProfile>(key as string, profileStore)
    if (profile) {
      summaries.push({
        id: profile.id,
        name: profile.name,
        savedAt: profile.savedAt,
        assetCount: profile.assets.length,
        resultCount: profile.results.length,
        url: profile.brandDna?.url,
      })
    }
  }
  return summaries.sort((a, b) => b.savedAt - a.savedAt)
}

// Upsert: find existing profile by brand name, update it, or create new
export async function upsertProfile(profile: BrandProfile): Promise<void> {
  const allKeys = await keys(profileStore)
  for (const key of allKeys) {
    const existing = await get<BrandProfile>(key as string, profileStore)
    if (existing && existing.name === profile.name) {
      // Update existing profile
      await set(key as string, { ...profile, id: key as string }, profileStore)
      return
    }
  }
  // New profile
  await set(profile.id, profile, profileStore)
}
