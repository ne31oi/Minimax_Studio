import type { ReferenceLabel } from './types'

/** Later extension segments insert an additional last-frame anchor before RefMods. */
export function assistantClipLabels(labels: ReferenceLabel[], clip = 1): ReferenceLabel[] {
  if (clip <= 1 || !labels.some(l => l.id === 'native-extension-anchor') || labels.filter(l => l.kind === 'image' && !/:\d+:\d+$/.test(l.id)).length >= 9) return labels
  return labels.map(l => l.kind === 'image' && /:\d+:\d+$/.test(l.id)
    ? { ...l, trigger: l.trigger.replace(/\d+/, n => String(Number(n) + 1)) }
    : l)
}

export const MISSING_ASSISTANT_REFERENCE = '⟦Недоступен референс:'

/** Replace by identity, never by position. Removed components must remain visible. */
export function remapAssistantReferences(content: string, before: ReferenceLabel[] | undefined, after: ReferenceLabel[]): string {
  if (!before) return content
  return content.replace(/<(?:Picture|Video|Audio) \d+>/g, (tag, offset: number) => {
    const markers = [...content.slice(0, offset).matchAll(/(?:^|\n)\s*clip:\s*(\d+)/g)]
    const clip = Number(markers.at(-1)?.[1] || 1)
    const previous = assistantClipLabels(before, clip).find(l => l.trigger === tag)
    if (!previous) return tag
    const next = assistantClipLabels(after, clip).find(l => l.id === previous.id)
    return next?.trigger || `${MISSING_ASSISTANT_REFERENCE} ${previous.label}⟧`
  })
}
