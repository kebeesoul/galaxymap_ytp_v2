export interface SelectableComment {
  is_selected?: boolean | null
}

export function selectCommentsForRender<T extends SelectableComment>(comments: T[]): T[] {
  const selected = comments.filter((comment) => comment.is_selected)
  return selected.length > 0 ? selected : comments
}
