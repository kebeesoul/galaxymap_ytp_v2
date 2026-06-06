import { describe, expect, it } from 'vitest'
import { selectCommentsForRender } from '@/lib/comments/select-for-render'

describe('selectCommentsForRender', () => {
  it('uses only explicitly selected comments when any are selected', () => {
    const comments = [
      { body: 'first', is_selected: false },
      { body: 'second', is_selected: true },
    ]

    expect(selectCommentsForRender(comments)).toEqual([
      { body: 'second', is_selected: true },
    ])
  })

  it('uses all comments when none are explicitly selected', () => {
    const comments = [
      { body: 'first', is_selected: false },
      { body: 'second', is_selected: false },
    ]

    expect(selectCommentsForRender(comments)).toEqual(comments)
  })
})
