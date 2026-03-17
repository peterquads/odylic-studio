import { useState, useMemo } from 'react'
import {
  Search,
  Sparkles,
  Loader2,
  Check,
  ArrowRight,
  X,
} from 'lucide-react'
import { useStore } from '../../store'
import { GlassCard, GlassBadge } from '../layout/GlassCard'
import { findMatchingTemplates } from '../../services/claude'
import type { CatalogTemplate } from '../../types'

// Import catalog data
import catalogData from '../../data/catalog.json'

const FORMAT_TYPES = [
  'Us vs Them', 'Before/After', 'Feature & Benefits', 'Testimonial/Review',
  'Product Showcase', 'Lifestyle', 'UGC Style', 'Listicle', 'Comparison Chart',
  'Social Proof', 'Problem/Solution', 'How It Works', 'Ingredients/What\'s Inside',
  'Stat/Data Callout', 'Offer/Discount', 'Infographic', 'Meme/Humor', 'Advertorial',
  'Bundle/Kit', 'Founder Story', 'FAQ', 'Myth vs Fact', 'Editorial', 'Minimal/Clean',
]

export function CatalogBrowserPage() {
  const {
    catalog,
    setCatalog,
    selectedTemplates,
    toggleTemplate,
    brandDna,
    claudeApiKey,
    setStep,
  } = useStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [formatFilter, setFormatFilter] = useState<string>('all')
  const [nicheFilter, setNicheFilter] = useState<string>('all')
  const [isAiSearching, setIsAiSearching] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [showAiSearch, setShowAiSearch] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<CatalogTemplate | null>(null)

  // Load catalog on first render
  useMemo(() => {
    if (catalog.length === 0 && catalogData.length > 0) {
      setCatalog(catalogData as CatalogTemplate[])
    }
  }, [])

  const allNiches = useMemo(() => {
    const niches = new Set<string>()
    catalog.forEach((t) => t.niches?.forEach((n) => niches.add(n)))
    return Array.from(niches).sort()
  }, [catalog])

  const formatCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    catalog.forEach((t) => {
      const ft = t.format_type || 'Other'
      counts[ft] = (counts[ft] || 0) + 1
    })
    return counts
  }, [catalog])

  const filtered = useMemo(() => {
    return catalog.filter((t) => {
      if (formatFilter !== 'all' && t.format_type !== formatFilter) return false
      if (nicheFilter !== 'all' && !t.niches?.includes(nicheFilter)) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const searchable = [
          t.format_type,
          t.sub_format,
          t.description,
          ...(t.niches || []),
          t.color_scheme,
          ...(t.ad_style_tags || []),
          t.photography_style || '',
          t.emotional_tone || '',
        ]
          .join(' ')
          .toLowerCase()
        if (!searchable.includes(q)) return false
      }
      return true
    })
  }, [catalog, formatFilter, nicheFilter, searchQuery])

  const handleAiSearch = async () => {
    if (!brandDna || !aiDescription.trim()) return
    setIsAiSearching(true)
    try {
      const filenames = await findMatchingTemplates(
        claudeApiKey,
        brandDna,
        catalog,
        aiDescription
      )
      // Reorder catalog to put matched templates first
      const matchSet = new Set(filenames)
      const sorted = [
        ...catalog.filter((t) => matchSet.has(t.filename)),
        ...catalog.filter((t) => !matchSet.has(t.filename)),
      ]
      setCatalog(sorted)
      setFormatFilter('all')
      setNicheFilter('all')
      setSearchQuery('')
    } catch (e: any) {
      console.error('AI search failed:', e)
    } finally {
      setIsAiSearching(false)
      setShowAiSearch(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-10 px-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight mb-1">Template Library</h1>
          <p className="text-text-secondary text-sm">
            {catalog.length} ad templates &middot; {selectedTemplates.length} selected
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAiSearch(!showAiSearch)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors"
          >
            <Sparkles size={14} className="text-accent" />
            AI Recommend
          </button>
          {selectedTemplates.length > 0 && (
            <button
              onClick={() => setStep('generate')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-all"
            >
              Generate ({selectedTemplates.length})
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* AI Search */}
      {showAiSearch && (
        <GlassCard className="!p-4">
          <div className="flex gap-3">
            <input
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder="Describe what kind of ad you want, e.g. 'us vs them comparison for skincare'"
              className="flex-1 bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={handleAiSearch}
              disabled={isAiSearching}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white disabled:opacity-50 transition-all"
            >
              {isAiSearching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Find'
              )}
            </button>
          </div>
        </GlassCard>
      )}

      {/* Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full bg-white/5 border border-glass-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          className="bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none appearance-none cursor-pointer min-w-[160px]"
        >
          <option value="all">All Formats ({catalog.length})</option>
          {FORMAT_TYPES.filter((f) => formatCounts[f]).map((f) => (
            <option key={f} value={f}>
              {f} ({formatCounts[f]})
            </option>
          ))}
        </select>
        <select
          value={nicheFilter}
          onChange={(e) => setNicheFilter(e.target.value)}
          className="bg-white/5 border border-glass-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none appearance-none cursor-pointer min-w-[140px]"
        >
          <option value="all">All Niches</option>
          {allNiches.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <p className="text-xs text-text-muted">{filtered.length} templates shown</p>

      {/* Template Grid */}
      <div className="grid grid-cols-4 gap-3">
        {filtered.slice(0, 60).map((template) => {
          const isSelected = selectedTemplates.some(
            (t) => t.filename === template.filename
          )
          return (
            <div
              key={template.filename}
              className={`glass rounded-xl overflow-hidden cursor-pointer transition-all group ${
                isSelected ? 'ring-2 ring-accent' : 'hover:bg-white/[0.03]'
              }`}
            >
              {/* Thumbnail */}
              <div
                className="aspect-square bg-surface-raised relative"
                onClick={() => setSelectedDetail(template)}
              >
                <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
                  {template.filename}
                </div>
              </div>

              {/* Info */}
              <div className="p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <GlassBadge color="accent">{template.format_type}</GlassBadge>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleTemplate(template.filename)
                    }}
                    className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-accent text-white'
                        : 'bg-white/10 text-transparent hover:bg-white/20'
                    }`}
                  >
                    <Check size={12} />
                  </button>
                </div>
                <p className="text-[10px] text-text-muted line-clamp-2">
                  {template.sub_format}
                </p>
                {template.niches?.slice(0, 2).map((n, i) => (
                  <GlassBadge key={i} className="mr-1 mt-1">
                    {n}
                  </GlassBadge>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Template Detail Modal */}
      {selectedDetail && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setSelectedDetail(null)}
        >
          <div
            className="glass rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <GlassBadge color="accent">{selectedDetail.format_type}</GlassBadge>
                <p className="text-sm text-text-secondary mt-1">
                  {selectedDetail.sub_format}
                </p>
              </div>
              <button
                onClick={() => setSelectedDetail(null)}
                className="p-1 rounded-lg hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-xs text-text-muted uppercase mb-1">Description</h4>
                <p className="text-sm text-text-secondary">
                  {selectedDetail.description}
                </p>
              </div>

              {selectedDetail.layout && (
                <div>
                  <h4 className="text-xs text-text-muted uppercase mb-1">Layout</h4>
                  <div className="space-y-2 text-sm text-text-secondary">
                    <p><span className="text-text-muted">Orientation:</span> {selectedDetail.layout.orientation}</p>
                    <p><span className="text-text-muted">Sections:</span> {selectedDetail.layout.sections}</p>
                    <p><span className="text-text-muted">Background:</span> {selectedDetail.layout.background}</p>
                    <p><span className="text-text-muted">Text Placement:</span> {selectedDetail.layout.text_placement}</p>
                  </div>
                </div>
              )}

              {selectedDetail.visual_elements?.length > 0 && (
                <div>
                  <h4 className="text-xs text-text-muted uppercase mb-1">Visual Elements</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedDetail.visual_elements.map((el, i) => (
                      <GlassBadge key={i}>{el}</GlassBadge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs text-text-muted uppercase mb-1">Niches</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedDetail.niches?.map((n, i) => (
                    <GlassBadge key={i}>{n}</GlassBadge>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs text-text-muted uppercase mb-1">Color Scheme</h4>
                <p className="text-sm text-text-secondary">{selectedDetail.color_scheme}</p>
              </div>

              {selectedDetail.ad_style_tags && selectedDetail.ad_style_tags.length > 0 && (
                <div>
                  <h4 className="text-xs text-text-muted uppercase mb-1">Style Tags</h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedDetail.ad_style_tags.map((tag, i) => (
                      <GlassBadge key={i} color="accent">{tag}</GlassBadge>
                    ))}
                  </div>
                </div>
              )}

              {(selectedDetail.photography_style || selectedDetail.emotional_tone) && (
                <div className="space-y-2 text-sm text-text-secondary">
                  {selectedDetail.photography_style && (
                    <p><span className="text-text-muted">Photo Style:</span> {selectedDetail.photography_style}</p>
                  )}
                  {selectedDetail.emotional_tone && (
                    <p><span className="text-text-muted">Tone:</span> {selectedDetail.emotional_tone}</p>
                  )}
                  {selectedDetail.text_density && (
                    <p><span className="text-text-muted">Text Density:</span> {selectedDetail.text_density}</p>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                toggleTemplate(selectedDetail.filename)
                setSelectedDetail(null)
              }}
              className="mt-4 w-full py-2.5 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-all"
            >
              {selectedTemplates.some((t) => t.filename === selectedDetail.filename)
                ? 'Deselect Template'
                : 'Select Template'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
