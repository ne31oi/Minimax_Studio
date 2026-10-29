import {
  emptyRefModSet,
  activeSetMembers,
  CURVE_DIRECTIONS,
  CURVE_SHAPES,
  type RefModSet,
} from './types'

export interface ResolvedRefModSet extends RefModSet {
  files: Record<string, string>
  versions: Record<string, string>
}
export function validateRefModSet(value: unknown): RefModSet {
  if (value == null) return emptyRefModSet()
  const set = value as RefModSet
  if (!set || !Array.isArray(set.items) || set.items.length > 8)
    throw new Error('Допускается до 8 RefMods в наборе')
  if (!Number.isInteger(set.maxTokens) || set.maxTokens < 1 || set.maxTokens > 1048576)
    throw new Error('Некорректный бюджет RefMods')
  if (
    set.retention !== undefined &&
    (!Number.isFinite(set.retention) || set.retention < 0 || set.retention > 1)
  )
    throw new Error('Некорректная общая сила RefMods')
  for (const curve of [set.frameCurve, set.stepCurve])
    if (
      !curve ||
      !CURVE_DIRECTIONS.includes(curve.direction) ||
      !CURVE_SHAPES.includes(curve.shape) ||
      !Number.isFinite(curve.value) ||
      curve.value < 0 ||
      curve.value > 1
    )
      throw new Error('Некорректная кривая RefMods')
  const ids = new Set<string>()
  for (const i of set.items) {
    if (
      !i ||
      typeof i.id !== 'string' ||
      ids.has(i.id) ||
      typeof i.entryId !== 'string' ||
      typeof i.name !== 'string' ||
      typeof i.fingerprint !== 'string' ||
      typeof i.enabled !== 'boolean' ||
      !Array.isArray(i.members) ||
      i.members.length > 256 ||
      !['All', 'Visual', 'Audio'].includes(i.components)
    )
      throw new Error('Некорректный элемент RefMods')
    if (
      i.members.some(
        (m) =>
          !m ||
          !['image', 'video', 'audio'].includes(m.kind) ||
          !Number.isInteger(m.index) ||
          m.index < 0 ||
          !Number.isSafeInteger(m.tokens) ||
          m.tokens < 1 ||
          typeof m.name !== 'string',
      )
    )
      throw new Error('Некорректные метаданные компонентов RefMod')
    ids.add(i.id)
    if (
      ![i.strength, i.visualStrength, i.audioStrength].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
      ) ||
      !Number.isInteger(i.copies) ||
      i.copies < 1 ||
      i.copies > 8
    )
      throw new Error('Сила RefMod должна быть 0–1, копии — 1–8')
    if (
      i.memberIndices &&
      (!Array.isArray(i.memberIndices) ||
        new Set(i.memberIndices).size !== i.memberIndices.length ||
        !i.memberIndices.every((n) => Number.isInteger(n) && n >= 0 && n < 256))
    )
      throw new Error('Некорректный выбор компонентов')
  }
  return structuredClone(set)
}
type Node = { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }
/** Pure graph transform. Empty/disabled sets leave the graph byte-for-byte unchanged. */
export function attachRefMods(
  workflow: Record<string, unknown>,
  set?: ResolvedRefModSet,
): Record<string, unknown> {
  if (!set || !set.items.some((i) => activeSetMembers(set, i).length)) return workflow
  const out = structuredClone(workflow) as Record<string, Node>
  const prefix = 'studio_refmods'
  if (out[prefix]) throw new Error('Повторное подключение RefMods')
  out[prefix] = { class_type: 'StudioH3RefModLoad', inputs: { settings: JSON.stringify(set) } }
  let found = 0
  for (const node of Object.values(out)) {
    if (
      node.class_type === 'MiniMaxH3ReferenceToVideo' ||
      node.class_type === 'MiniMaxH3ImageToVideo'
    ) {
      node.class_type =
        node.class_type === 'MiniMaxH3ReferenceToVideo'
          ? 'StudioH3RefModReferenceToVideo'
          : 'StudioH3RefModImageToVideo'
      node.inputs = {
        ...node.inputs,
        mods: [prefix, 0],
        settings: JSON.stringify({
          frameCurve: set.frameCurve,
          maxTokens: set.maxTokens,
          retention: set.retention ?? 1,
        }),
      }
      found++
    }
  }
  if (!found) throw new Error('В этой операции отсутствует H3-conditioning для RefMods')
  // Each MODEL branch receives one local-progress curve; existing preview/attention wrappers remain intact.
  if (
    set.stepCurve.direction !== 'constant' ||
    set.stepCurve.value !== 1 ||
    set.stepCurve.shape !== 'linear'
  ) {
    const models = new Map<string, string>()
    let n = 0
    for (const node of Object.values(out))
      if (
        (node.class_type === 'BasicGuider' || node.inputs.conditioning || node.inputs.positive) &&
        Array.isArray(node.inputs.model)
      ) {
        const input = node.inputs.model
        const key = JSON.stringify(input)
        let id = models.get(key)
        if (!id) {
          id = `${prefix}_step_${n++}`
          models.set(key, id)
          out[id] = {
            class_type: 'MiniMaxH3RefModStepCurve',
            inputs: {
              model: input,
              mods: [prefix, 0],
              override: false,
              curve_direction: set.stepCurve.direction,
              curve_shape: set.stepCurve.shape,
              curve_value: set.stepCurve.value,
            },
          }
        }
        node.inputs.model = [id, 0]
      }
  }
  return out
}
