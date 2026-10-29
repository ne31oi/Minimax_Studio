/** Shared, serializable RefMod contracts. No filesystem or GPU imports here. */
export type RefModKind = 'image' | 'video' | 'audio'
export type RefModTarget =
  | 'generate'
  | 'extend'
  | 'controlnet'
  | 'refine'
  | 'face-refine'
  | 'tile-upscale'
export const REF_MOD_TARGETS: RefModTarget[] = [
  'generate',
  'extend',
  'controlnet',
  'refine',
  'face-refine',
  'tile-upscale',
]
export const CURVE_DIRECTIONS = [
  'constant',
  'concept_at_start',
  'concept_at_middle',
  'concept_at_end',
  'concept_at_ends',
] as const
export const CURVE_SHAPES = [
  'linear',
  'ease',
  'sigmoid',
  'tanh',
  'quadratic',
  'cubic',
  'exponential',
  'stair',
  'elastic',
  'bump',
  'dip',
] as const
export interface RefModCurve {
  direction: (typeof CURVE_DIRECTIONS)[number]
  shape: (typeof CURVE_SHAPES)[number]
  value: number
}
export interface RefModMember {
  index: number
  name: string
  kind: RefModKind
  tokens: number
  shape: number[]
  mode: string
  description: string
  config?: Record<string, unknown>
}
export interface RefModEntry {
  id: string
  name: string
  folder: string
  kind: RefModKind | 'bundle'
  members: RefModMember[]
  tokens: number
  size: number
  fingerprint: string
  root: string
  previewUrl?: string
}
export interface RefModSelection {
  previewUrl?: string
  id: string
  entryId: string
  name: string
  fingerprint: string
  enabled: boolean
  strength: number
  visualStrength: number
  audioStrength: number
  copies: number
  components: 'All' | 'Visual' | 'Audio'
  memberIndices?: number[]
  members: RefModMember[]
}
export interface RefModSet {
  items: RefModSelection[]
  frameCurve: RefModCurve
  stepCurve: RefModCurve
  maxTokens: number
  retention?: number
}
export function emptyRefModSet(): RefModSet {
  return {
    items: [],
    frameCurve: { direction: 'constant', shape: 'linear', value: 1 },
    stepCurve: { direction: 'constant', shape: 'linear', value: 1 },
    maxTokens: 5120,
    retention: 1,
  }
}
export function allowsRefModAudio(target: RefModTarget): boolean {
  return ['generate', 'extend', 'controlnet'].includes(target)
}
export function activeMembers(item: RefModSelection, audio = true): RefModMember[] {
  if (!item.enabled || item.strength === 0) return []
  return item.members.filter(
    (m) =>
      (!item.memberIndices || item.memberIndices.includes(m.index)) &&
      (m.kind === 'audio'
        ? audio && item.components !== 'Visual' && item.audioStrength > 0
        : item.components !== 'Audio' && item.visualStrength > 0),
  )
}
export function refModTokens(set: RefModSet, audio = true): number {
  if (set.retention === 0) return 0
  return set.items.reduce(
    (sum, i) => sum + activeSetMembers(set, i, audio).reduce((n, m) => n + m.tokens * i.copies, 0),
    0,
  )
}
export function activeSetMembers(set: RefModSet, item: RefModSelection, audio = true): RefModMember[] {
  if (set.retention === 0) return []
  return activeMembers(item, audio).filter((m) =>
    !(m.shape?.[2] === 1 && m.kind !== 'audio' && set.frameCurve.direction !== 'constant' && set.frameCurve.value === 0),
  )
}
export interface ReferenceLabel {
  id: string
  label: string
  kind: RefModKind
  trigger: string
  previewUrl?: string
}
/** Same ordering as native H3: images, each video soundtrack before its video, then standalone audio. */
export function referenceLabels(
  raw: Array<{
    id?: string
    name?: string
    kind: RefModKind
    includeAudio?: boolean
    hasAudio?: boolean
    previewUrl?: string
  }>,
  set: RefModSet,
  audio = true,
): ReferenceLabel[] {
  const counts = { image: 0, video: 0, audio: 0 }
  const out: ReferenceLabel[] = []
  const add = (id: string, label: string, kind: RefModKind, previewUrl?: string) =>
    out.push({
      id,
      label,
      kind,
      previewUrl,
      trigger: `<${{ image: 'Picture', video: 'Video', audio: 'Audio' }[kind]} ${++counts[kind]}>`,
    })
  for (const [i, r] of raw.filter((r) => r.kind === 'image').entries())
    add(r.id || `image-${i}`, r.name || 'Изображение', 'image', r.previewUrl)
  for (const [i, r] of raw.filter((r) => r.kind === 'video').entries()) {
    if (r.includeAudio && r.hasAudio !== false)
      add(`${r.id || i}:audio`, `${r.name || 'Видео'} · звук`, 'audio')
    add(r.id || `video-${i}`, r.name || 'Видео', 'video', r.previewUrl)
  }
  for (const [i, r] of raw.filter((r) => r.kind === 'audio').entries())
    add(r.id || `audio-${i}`, r.name || 'Аудио', 'audio')
  for (const item of set.retention === 0 ? [] : set.items)
    for (const member of activeSetMembers(set, item, audio))
      for (let copy = 0; copy < item.copies; copy++) {
        add(
          `${item.id}:${member.index}:${copy}`,
          `${item.name} · ${member.name}${copy ? ` · копия ${copy + 1}` : ''}`,
          member.kind,
          item.previewUrl,
        )
      }
  return out
}
export function remapReferenceTags(
  prompt: string,
  before: ReferenceLabel[],
  after: ReferenceLabel[],
): string {
  const next = new Map(after.map((r) => [r.id, r.trigger]))
  const old = new Map(before.map((r) => [r.trigger, next.get(r.id) || '']))
  return prompt.replace(/<(?:Picture|Video|Audio) \d+>/g, (tag) =>
    old.has(tag) ? old.get(tag)! : tag,
  )
}
export interface RefModSource {
  id: string
  kind: RefModKind
  name: string
  file: string
  start: number
  end: number | null
  includeAudio: boolean
  crop?: { x: number; y: number; width: number; height: number }
  mask?: string
}
export interface RefModProject {
  id: string
  name: string
  description: string
  sources: RefModSource[]
  updatedAt: string
  mode: 'encode' | 'training'
  resolution: number
  poolSize: number
  frameLimit: number
  refinementSteps: number
  maxTokens: number
  builds: Array<{
    name: string
    entryId?: string
    createdAt: string
    promptId: string
    tokens?: number
  }>
}
export interface RefModJob {
  snapshot?: { project?: RefModProject; set?: RefModSet; fullVideo?: boolean }
  id: string
  kind: 'build' | 'preview'
  promptId: string
  projectId?: string
  entryId?: string
  status: 'submitting' | 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  createdAt: string
  error?: string
  outputName?: string
  result?: Record<string, unknown>
  clientToken: string
}
