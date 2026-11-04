import { referenceLabels, type ReferenceLabel, type RefModSet } from './types'

export interface RefineRefModBindings {
  source: ReferenceLabel[]
  set: RefModSet
}

/** Prefer the actual encoder map; older outputs can be reconstructed from metadata. */
export function sourceRefModLabels(meta: Record<string, unknown>, set: RefModSet): ReferenceLabel[] {
  const saved = referenceLabels([], set)
  if (!saved.length) return []
  const findMap = (value: unknown, depth = 0): Array<{ trigger: string; kind: string }> | undefined => {
    if (depth > 4 || !value || typeof value !== 'object') return
    if (Array.isArray(value) && value.length && value.every(l => l && typeof l.trigger === 'string' && typeof l.kind === 'string')) return value
    for (const child of Object.values(value)) {
      const found = findMap(child, depth + 1)
      if (found) return found
    }
  }
  const actual = findMap(meta.refmod_reference_maps)
  if (actual && actual.length >= saved.length) {
    const tail = actual.slice(actual.length - saved.length)
    if (tail.every((l, i) => l.kind === saved[i].kind))
      return saved.map((l, i) => ({ ...l, trigger: tail[i].trigger }))
  }
  const refs = (Array.isArray(meta.references) ? meta.references : Array.isArray(meta.minimax_h3_references) ? meta.minimax_h3_references : []) as Array<{type?: string;path?: string;includeAudio?:boolean;hasAudio?:boolean}>
  const raw: Parameters<typeof referenceLabels>[0] = refs.flatMap((r, i) => ['image','video','audio'].includes(r.type || '')
    ? [{ id: `raw-${i}`, kind: r.type as 'image'|'video'|'audio', includeAudio: r.includeAudio, hasAudio: r.hasAudio }] : [])
  if (meta.generation_mode === 'flf') {
    raw.length = 0
    if (meta.first_frame) raw.push({ kind: 'image' })
    if (meta.last_frame) raw.push({ kind: 'image' })
  }
  if (meta.audio_guide) for (let i = raw.length - 1; i >= 0; i--) if (raw[i].kind === 'audio') raw.splice(i, 1)
  return referenceLabels(raw, set).filter(l => saved.some(s => s.id === l.id))
}

export function refineRefModLabels(bindings: RefineRefModBindings, rawImages: number): ReferenceLabel[] {
  return referenceLabels(Array.from({ length: rawImages }, (_, i) => ({ id: `native-${i}`, kind: 'image' as const })), bindings.set, false)
    .filter(l => /:\d+:\d+$/.test(l.id))
}

/** Rewrite only inherited RefMod tags, before adding the refiner's native captions. */
export function refineRefModPrompt(prompt: string, bindings: RefineRefModBindings | undefined, rawImages: number): string {
  if (!bindings) return prompt
  const after = new Map(refineRefModLabels(bindings, rawImages).map(l => [l.id, l.trigger]))
  const before = new Map(bindings.source.map(l => [l.trigger, after.get(l.id) || '']))
  return prompt.replace(/<(?:Picture|Video|Audio) \d+>/g, tag => before.has(tag) ? before.get(tag)! : tag)
}

/** Every window receives the visual bindings, including windows without a story caption. */
export function refineRefModCaptions(bindings: RefineRefModBindings | undefined, rawImages: number): string {
  if (!bindings) return ''
  return refineRefModLabels(bindings, rawImages).map(l => `${l.trigger} is a saved visual reference for appearance, subjects and style consistency.`).join(' ')
}
