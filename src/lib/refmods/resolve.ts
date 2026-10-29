import fs from 'fs'
import { createHash } from 'crypto'
import { inspectRefMod, resolveRefMod } from './files'
import { activeSetMembers, allowsRefModAudio, refModTokens, type RefModTarget } from './types'
import { validateRefModSet, type ResolvedRefModSet } from './workflow'
export async function resolveRefModSet(
  value: unknown,
  target: RefModTarget,
): Promise<ResolvedRefModSet> {
  const set = validateRefModSet(value)
  const files: Record<string, string> = {}
  const versions: Record<string, string> = {}
  if (set.retention === 0) return { ...set, files, versions }
  for (const item of set.items) {
    if (!allowsRefModAudio(target)) {
      item.audioStrength = 0
      if (item.components === 'All') item.components = 'Visual'
    }
    if (!activeSetMembers(set, item).length) continue
    const file = resolveRefMod(item.entryId)
    const current = inspectRefMod(file, item.entryId)
    if (item.fingerprint && item.fingerprint !== current.fingerprint)
      throw new Error(`RefMod «${item.name}» изменён. Обновите его в наборе перед запуском.`)
    item.members = current.members
    item.fingerprint = current.fingerprint
    if (item.memberIndices?.some((i) => !current.members.some((m) => m.index === i)))
      throw new Error(`В «${item.name}» отсутствует выбранный компонент`)
    if (!activeSetMembers(set, item).length) continue
    files[item.entryId] = file
    const hash = createHash('sha256')
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
    const sidecar = file.replace(/\.safetensors$/i, '.json')
    if (fs.existsSync(sidecar)) {
      if (fs.statSync(sidecar).size > 1024 * 1024) throw new Error('Слишком большой sidecar RefMod')
      hash.update(fs.readFileSync(sidecar))
    }
    versions[item.entryId] = hash.digest('hex')
  }
  const tokens = refModTokens(set)
  if (tokens > set.maxTokens)
    throw new Error(
      `RefMods требуют ${tokens} токенов при бюджете ${set.maxTokens}. Уменьшите набор, число копий или увеличьте бюджет.`,
    )
  if (tokens) {
    const { COMFY_URL } = await import('../comfy/minimax-h3-client')
    const res = await fetch(`${COMFY_URL}/object_info/StudioH3RefModLoad`, {
      signal: AbortSignal.timeout(8000),
    })
    const info = await res.json()
    if (!info.StudioH3RefModLoad)
      throw new Error('RefMod-ноды не загружены. Установите зависимости и перезапустите ComfyUI.')
  }
  return { ...set, files, versions }
}
