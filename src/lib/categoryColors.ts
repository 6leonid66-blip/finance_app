// Stable, hash-based color picker so the same category always gets the same
// color across months and across renders, regardless of sort order or ranking.
// Empty / nullish category names fall back to a neutral slate hue.

const CATEGORY_PALETTE = [
  '#38bdf8',
  '#34d399',
  '#f59e0b',
  '#f97316',
  '#a78bfa',
  '#f472b6',
  '#fb7185',
  '#22d3ee',
  '#84cc16',
  '#eab308',
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#10b981',
  '#f43f5e',
  '#0ea5e9',
] as const

const FALLBACK_COLOR = '#64748b'

export function colorForCategory(category: string | null | undefined): string {
  const name = (category ?? '').trim()
  if (!name) return FALLBACK_COLOR
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % CATEGORY_PALETTE.length
  return CATEGORY_PALETTE[idx]
}
