import {
  INCOME_CATEGORY_DEFS,
  EXPENSE_CATEGORY_DEFS,
  isOtherCategory,
  popularCategories,
  remainingCategories,
} from '../constants/categories'
import type { EntryType } from '../types'
import { useState } from 'react'

type CategoryGridProps = {
  type: EntryType
  value: string
  onChange: (name: string) => void
}

export function CategoryGrid({ type, value, onChange }: CategoryGridProps) {
  const [showMore, setShowMore] = useState(() => {
    const popular = popularCategories(type).map((c) => c.name)
    return Boolean(value) && !popular.includes(value) && !isOtherCategory(value)
  })
  const popular = popularCategories(type)
  const rest = remainingCategories(type)
  const defs = type === 'expense' ? EXPENSE_CATEGORY_DEFS : INCOME_CATEGORY_DEFS
  const known = defs.some((c) => c.name === value)

  return (
    <div className="category-grid-wrap">
      <div className="category-grid">
        {popular.map((c) => (
          <button
            key={c.name}
            type="button"
            className={value === c.name ? 'cat-chip active' : 'cat-chip'}
            onClick={() => onChange(c.name)}
          >
            <span aria-hidden>{c.icon}</span>
            <span>{c.name}</span>
          </button>
        ))}
        {showMore
          ? rest.map((c) => (
              <button
                key={c.name}
                type="button"
                className={value === c.name ? 'cat-chip active' : 'cat-chip'}
                onClick={() => onChange(c.name)}
              >
                <span aria-hidden>{c.icon}</span>
                <span>{c.name}</span>
              </button>
            ))
          : null}
        {!known && value && !isOtherCategory(value) ? (
          <button type="button" className="cat-chip active" onClick={() => onChange(value)}>
            <span aria-hidden>•</span>
            <span>{value}</span>
          </button>
        ) : null}
      </div>
      {rest.length ? (
        <button type="button" className="link-btn cat-more" onClick={() => setShowMore((v) => !v)}>
          {showMore ? 'הצג פחות' : 'עוד קטגוריות'}
        </button>
      ) : null}
    </div>
  )
}
