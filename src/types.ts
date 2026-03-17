// ============ Brand ============

export interface PhotographyDirection {
  lighting: string
  colorGrading: string
  composition: string
  subjectMatter: string
  propsAndSurfaces: string
  mood: string
}

export interface PackagingDetails {
  physicalDescription: string
  labelLogoPlacement: string
  distinctiveFeatures: string
}

export interface AdCreativeStyle {
  typicalFormats: string
  textOverlayStyle: string
  photoVsIllustration: string
  ugcUsage: string
  offerPresentation: string
}

export interface BrandDna {
  name: string
  url: string
  description: string
  category: string
  brandSummary: string
  colors: string[]
  fonts: string[]
  voiceTone: string
  targetAudience: string
  keyBenefits: string[]
  usps: string[]
  featuresAndBenefits: string
  brandGuidelinesAnalysis: string
  // Enhanced brand DNA fields
  photographyDirection?: PhotographyDirection
  packagingDetails?: PackagingDetails
  adCreativeStyle?: AdCreativeStyle
  promptModifier?: string      // 50-75 word paragraph to prepend to image prompts
  backgroundColors?: string[]  // BG colors distinct from brand accent colors
  ctaStyle?: string            // CTA color + style description
  competitiveDifferentiation?: string
  voiceAdjectives?: string[]   // 5 distinct brand voice adjectives
  productFacts?: ProductFacts  // Verified product data from packaging/website
  guarantee?: string           // Warranty, guarantee, trial period
  productType?: string         // Specific product type (wallet, protein bar, etc.)
  socialProof?: SocialProof    // Real, verified social proof from researched sources
}

export interface SocialProof {
  reviews?: { quote: string; source: string; author?: string; rating?: number }[]
  pressQuotes?: { quote: string; publication: string }[]
  customerCount?: string    // e.g. "200,000+"
  averageRating?: string    // e.g. "4.8/5"
}

export interface LogoCandidate {
  base64: string
  sourceUrl: string
  name: string
  mimeType: string
  aiClassification?: string  // 'logo' | 'product' | 'banner' | 'icon' | 'other'
  isAiPick?: boolean
}

export interface ProductFacts {
  macros?: { protein?: string; calories?: string; sugar?: string; fat?: string; carbs?: string; fiber?: string }
  claims?: string[]           // e.g. ["Third-Party Tested", "No Artificial Sweeteners", "Gluten Free"]
  ingredients?: string[]      // Key visible ingredients
  certifications?: string[]   // e.g. ["NSF Certified", "Informed Choice"]
  flavors?: string[]          // e.g. ["Chocolate Chip Cookie Dough", "Peanut Butter Crunch"]
  servingSize?: string        // e.g. "1 bar (60g)"
}

export interface Persona {
  id: string
  name: string
  age: string
  description: string
  painPoints: string[]
  motivations: string[]
}

// ============ Assets ============

export type AssetType =
  | 'product_on_white'
  | 'lifestyle'
  | 'logo'
  | 'modeled_product'
  | 'packaging'
  | 'texture_pattern'
  | 'icon'
  | 'document'
  | 'unknown'

export type ProductionStyle =
  | 'UGC'
  | 'Product Feature'
  | 'Us vs. Them'
  | 'High Production'
  | 'Text Overlay'
  | 'Testimonial/Quote'
  | 'Meme/Viral'
  | 'Explainer/Demo'
  | 'Before & After'
  | 'Other'
  | 'N/A'

export type MarketAwareness = 'Unaware' | 'Problem Aware' | 'Solution Aware' | 'Product Aware' | 'Most Aware' | 'Unknown'
export type FunnelPosition = 'TOFU' | 'MOFU' | 'BOFU' | 'Unknown'
export type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Urgent' | 'Inspirational' | 'Informative' | 'Humorous'

export interface CompositionAnalysis {
  subjectBoundingBox: { x: number; y: number; width: number; height: number }
  textPlacements: Array<{
    text: string
    type: 'headline' | 'subheadline' | 'cta' | 'body'
    placementDescription: string
    scaleDescription: string
    fontStyleDescription: string
  }>
  negativeSpaceDescription: string
  overallComposition: string
}

export interface AssetAnalysis {
  // Classification
  assetType: AssetType
  description: string

  // Core Strategy (for ad creatives / inspiration assets)
  angle?: string
  hook?: string
  concept?: string
  persona?: string

  // Audience & Market
  marketAwareness?: MarketAwareness
  brandAwareness?: 'High' | 'Medium' | 'Low' | 'Unknown'
  demographics?: string
  funnelPosition?: FunnelPosition
  offer?: string

  // Copy Breakdown
  headline?: string
  bodyCopy?: string
  cta?: string
  sentiment?: Sentiment

  // Visual & Production
  style: string
  productionStyle?: ProductionStyle
  productionQuality?: 'High' | 'Medium' | 'Low' | 'Unknown'
  layoutDescription?: string
  textOverlay?: string
  dominantColors: string[]
  products?: string[]
  compositionAnalysis?: CompositionAnalysis

  // Technical
  format?: string
  aspectRatio?: string
  intendedPlacement?: string

  // Thematic
  emotion?: string
  marketingMoment?: string
  category?: string
  tags?: string[]
  suggestedUses: string[]
}

export interface UploadedAsset {
  id: string
  name: string
  mimeType: string
  base64: string
  thumbnail?: string
  analysis?: AssetAnalysis
  analysisStatus: 'idle' | 'pending' | 'complete' | 'error'
  source: 'upload' | 'scraped'
}

// ============ Catalog ============

export interface TemplateLayout {
  orientation: string      // "square" | "portrait" | "landscape"
  sections: string         // Description of how sections are arranged
  background: string       // Background style description
  text_placement: string   // Where text elements are positioned
}

export interface CatalogTemplate {
  filename: string
  format_type: string
  sub_format: string
  layout: TemplateLayout
  visual_elements: string[]
  text_elements: string[]
  color_scheme: string
  description: string
  niches: string[]
  current_niche: string
  // Standardized high-level category and style
  broad_category?: string        // e.g. 'supplements', 'fashion', 'food_beverage', 'beauty', 'home_kitchen', etc.
  brand_style?: string           // 'aesthetic' (visual/lifestyle) or 'utility' (features/benefits/problem-solving)
  // Enhanced style tags for better matching
  ad_style_tags?: string[]       // e.g. 'clean-minimal', 'bold-graphic', 'UGC-native', 'data-heavy'
  photography_style?: string     // e.g. 'studio product shot', 'lifestyle in-context', 'flat-lay'
  text_density?: string          // 'minimal' | 'moderate' | 'heavy'
  product_visibility?: string    // 'hero-centered' | 'supporting' | 'background' | 'none'
  emotional_tone?: string        // e.g. 'urgent/FOMO', 'educational', 'playful'
  // UI state
  selected?: boolean
}

// ============ Custom Templates ============
export interface CustomTemplateAnalysis {
  format_type: string
  sub_format: string
  layout: TemplateLayout
  visual_elements: string[]
  text_elements: string[]
  color_scheme: string
  description: string
  broad_category: string
  brand_style: string
  ad_style_tags: string[]
  photography_style: string
  text_density: string
  product_visibility: string
  emotional_tone: string
}

export interface CustomTemplate {
  id: string
  name: string
  base64: string       // data URI of uploaded ad image
  mimeType: string
  uploadedAt: number
  analysis?: CustomTemplateAnalysis
  analysisStatus?: 'idle' | 'pending' | 'complete' | 'error'
}

// ============ Generation ============

export type AspectRatio = '1:1' | '3:4' | '9:16'
export type ModelTier = 'standard' | 'hd' | '2k' | '4k'

export interface SizeQuantity {
  ratio: AspectRatio
  quantity: number
}

export type SizeMode = 'each' | 'custom'
// 'each' = generate N unique ads, each rendered in all selected sizes
// 'custom' = set quantity per ratio independently

export interface GenerationConfig {
  aspectRatio: AspectRatio
  modelTier: ModelTier
  quantity: number
  customDescription: string
  sizeQuantities: SizeQuantity[]  // Per-ratio quantity selection
  sizeMode: SizeMode
  selectedSizes: AspectRatio[]    // For 'each' mode: which sizes each ad gets
  adsPerBatch: number             // For 'each' mode: how many unique ads
}

export interface QaResult {
  passed: boolean
  concerns: string
  feedbackForRegeneration: string
}

export interface GeneratedAd {
  id: string
  imageUrl: string
  templateFilename: string
  templateImageUrl?: string
  assetsUsed?: string[]
  aspectRatio: AspectRatio
  prompt: string
  qa: QaResult | null
  qaStatus: 'pending' | 'passed' | 'failed' | 'skipped'
  retryCount: number
  timestamp: number
  // Naming + versioning
  adName?: string
  version: number
  parentId?: string
  // Concept grouping
  conceptId?: string
  // Strategy metadata
  strategyAngle?: string
  strategyConcept?: string
  formatType?: string
}

// ============ Advanced ============

export interface CustomCopy {
  headline: string
  subHeadline: string
  cta: string
  features: string[]
  benefits: string[]
  callouts: string[]
}

// ============ App State ============

export type AppStep = 'setup' | 'brand' | 'assets' | 'generate' | 'results'

export interface AppState {
  step: AppStep
  setStep: (step: AppStep) => void

  // API keys
  claudeApiKey: string
  geminiApiKey: string
  setClaudeApiKey: (key: string) => void
  setGeminiApiKey: (key: string) => void

  // Brand
  brandDna: BrandDna | null
  setBrandDna: (brand: BrandDna | null) => void
  personas: Persona[]
  setPersonas: (personas: Persona[]) => void
  isResearching: boolean
  setIsResearching: (v: boolean) => void

  // Assets
  assets: UploadedAsset[]
  addAsset: (asset: UploadedAsset) => void
  addAssets: (assets: UploadedAsset[]) => void
  updateAsset: (id: string, updates: Partial<UploadedAsset>) => void
  removeAsset: (id: string) => void

  // Catalog
  catalog: CatalogTemplate[]
  setCatalog: (templates: CatalogTemplate[]) => void
  selectedTemplates: CatalogTemplate[]
  toggleTemplate: (filename: string) => void
  clearSelectedTemplates: () => void

  // Generation
  generationConfig: GenerationConfig
  setGenerationConfig: (config: Partial<GenerationConfig>) => void
  isGenerating: boolean
  setIsGenerating: (v: boolean) => void
  generationProgress: { current: number; total: number; stage: string }
  setGenerationProgress: (p: { current: number; total: number; stage?: string }) => void

  // Results
  results: GeneratedAd[]
  addResult: (result: GeneratedAd) => void
  updateResult: (id: string, updates: Partial<GeneratedAd>) => void
  removeResults: (ids: string[]) => void
  clearResults: () => void

  // Saved ads
  savedAdIds: Set<string>
  toggleSavedAd: (id: string) => void

  // Errors (toast notifications)
  errors: string[]
  addError: (msg: string) => void
  dismissError: (idx: number) => void

  // Reset
  resetForNewBrand: () => void

  // Advanced
  advancedMode: boolean
  setAdvancedMode: (v: boolean) => void
  customCopy: CustomCopy
  setCustomCopy: (copy: Partial<CustomCopy>) => void

  // Custom templates
  customTemplates: CustomTemplate[]
  excludeBuiltInTemplates: boolean
  hideTemplateReference: boolean
  addCustomTemplate: (t: CustomTemplate) => void
  updateCustomTemplate: (id: string, updates: Partial<CustomTemplate>) => void
  removeCustomTemplate: (id: string) => void
  setExcludeBuiltInTemplates: (v: boolean) => void
  setHideTemplateReference: (v: boolean) => void
}
