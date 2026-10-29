import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { getAppConfig } from '../app-config'
import type { RefModEntry, RefModMember } from './types'

export const REF_MOD_REVISION = '517e8c419a8584fbf69fceb487bc39d83e6a6ec8'
export function refModRoots(): string[] {
  const cfg = getAppConfig()
  const models = path.join(cfg.comfyRoot, 'ComfyUI', 'models')
  return [
    ...new Set([
      path.join(models, 'refmods'),
      ...cfg.modelExtraPaths
        .filter((p) => p.category === 'refmods')
        .map((p) => path.resolve(p.path)),
      path.join(models, 'audio_refmods'),
      path.join(cfg.comfyRoot, 'ComfyUI', 'custom_nodes', 'ComfyUI-MiniMaxH3Mod', 'mods'),
    ]),
  ]
}
export function refModRoot(): string {
  return refModRoots()[0]
}
export function inside(root: string, file: string): string {
  const resolved = path.resolve(root, file)
  const rel = path.relative(path.resolve(root), resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Путь выходит за пределы папки')
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync(root)
    const real = fs.realpathSync(resolved)
    const realRel = path.relative(realRoot, real)
    if (realRel.startsWith('..') || path.isAbsolute(realRel))
      throw new Error('Ссылка ведёт за пределы папки')
  }
  return resolved
}
const dtypeBytes: Record<string, number> = {
  F16: 2,
  BF16: 2,
  F32: 4,
  F64: 8,
  I8: 1,
  U8: 1,
  I16: 2,
  I32: 4,
  I64: 8,
  BOOL: 1,
}
type Tensor = { dtype: string; shape: number[]; data_offsets: number[] }
/** Reads only bounded headers, never tensor payloads. Rejects LoRA and malformed files. */
export function inspectRefMod(file: string, id = '', root = ''): RefModEntry {
  const fd = fs.openSync(file, 'r')
  try {
    const stat = fs.fstatSync(fd)
    const len = Buffer.alloc(8)
    if (fs.readSync(fd, len, 0, 8, 0) !== 8) throw new Error('Обрезанный заголовок safetensors')
    const length = Number(len.readBigUInt64LE())
    if (
      !Number.isSafeInteger(length) ||
      length < 2 ||
      length > 8 * 1024 * 1024 ||
      length + 8 > stat.size
    )
      throw new Error('Некорректный размер заголовка')
    const bytes = Buffer.alloc(length)
    if (fs.readSync(fd, bytes, 0, length, 8) !== length) throw new Error('Обрезанный заголовок')
    const header = JSON.parse(bytes.toString('utf8'))
    const metadata = header.__metadata__ || {}
    let meta: Record<string, unknown>
    if (metadata.refmod_meta || metadata.audio_refmod_meta)
      meta = JSON.parse(metadata.refmod_meta || metadata.audio_refmod_meta)
    else if (fs.existsSync(file.replace(/\.safetensors$/i, '.json'))) {
      const sidecar = file.replace(/\.safetensors$/i, '.json')
      if (fs.statSync(sidecar).size > 1024 * 1024) throw new Error('Слишком большой sidecar')
      meta = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    } else throw new Error('Это не RefMod: отсутствуют метаданные RefMod (возможно, LoRA/ReFLora)')
    if (
      meta._format_version != null &&
      (!Number.isInteger(meta._format_version) ||
        Number(meta._format_version) < 1 ||
        Number(meta._format_version) > 5)
    )
      throw new Error('Неподдерживаемая версия RefMod')
    const bundle = meta.kind === 'bundle'
    const refs = bundle ? meta.members : [meta]
    if (bundle && meta._format_version !== 5) throw new Error('Неподдерживаемая версия комплекта')
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 256)
      throw new Error('Комплект должен содержать 1–256 компонентов')
    const ranges: number[][] = []
    for (const [key, value] of Object.entries(header)) {
      if (key === '__metadata__') continue
      const t = value as Tensor
      if (
        !t ||
        !Array.isArray(t.shape) ||
        !t.shape.length ||
        !t.shape.every((n) => Number.isSafeInteger(n) && n > 0) ||
        !dtypeBytes[t.dtype] ||
        !Array.isArray(t.data_offsets) ||
        t.data_offsets.length !== 2
      )
        throw new Error('Некорректный тензор')
      const [a, b] = t.data_offsets
      const count = t.shape.reduce((x, y) => x * y, 1)
      if (
        ![a, b, count].every(Number.isSafeInteger) ||
        a < 0 ||
        b < a ||
        b - a !== count * dtypeBytes[t.dtype] ||
        b > stat.size - length - 8
      )
        throw new Error('Размер тензора не совпадает с файлом')
      ranges.push([a, b])
    }
    ranges.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < ranges.length; i++)
      if (ranges[i][0] !== ranges[i - 1][1])
        throw new Error('Перекрывающиеся тензоры или пропуск данных')
    if (
      !ranges.length ||
      ranges[0][0] !== 0 ||
      ranges[ranges.length - 1][1] !== stat.size - length - 8
    )
      throw new Error('Границы данных safetensors не совпадают с файлом')
    const members: RefModMember[] = refs.map((m, index) => {
      if (!m || !['image', 'video', 'audio'].includes(m.kind))
        throw new Error('Неподдерживаемый компонент RefMod')
      const t = header[bundle ? `ref_${index}` : 'latent'] as Tensor
      if (!t || !['F16', 'BF16', 'F32'].includes(t.dtype))
        throw new Error('Отсутствует или повреждён латент RefMod')
      const s = t.shape
      const audio = m.kind === 'audio'
      if (
        audio
          ? s.length !== 4 || s[0] !== 1 || s[1] !== 32 || s[2] !== 2
          : s.length !== 5 ||
            s[0] !== 1 ||
            s[1] !== 24 ||
            s[3] % 2 !== 0 ||
            s[4] % 2 !== 0 ||
            (m.kind === 'image' && s[2] !== 1)
      )
        throw new Error('Некорректная геометрия латента H3')
      const [tt, hh, ww] = audio ? [s[3], 0, 0] : s.slice(2)
      for (const [key, actual] of [
        ['latent_t', tt],
        ['latent_h', hh],
        ['latent_w', ww],
      ] as const)
        if (m[key] != null && (!audio || key === 'latent_t') && Number(m[key]) !== actual)
          throw new Error('Метаданные не совпадают с геометрией тензора')
      let config
      try {
        config = typeof m.refmod_config === 'string' ? JSON.parse(m.refmod_config) : m.refmod_config
      } catch {
        config = undefined
      }
      return {
        index,
        name: String(m.name || `Компонент ${index + 1}`),
        kind: m.kind,
        shape: s,
        tokens: audio ? tt * 2 : tt * (hh / 2) * (ww / 2),
        mode: String(m.mode || 'encode'),
        description: String(m.description || ''),
        config,
      }
    })
    // Header plus stat catches ordinary replacement; full SHA is recorded for queued tasks below.
    const fingerprint = createHash('sha256')
      .update(bytes)
      .update(`${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
    return {
      id,
      name: String(meta.name || path.basename(file, '.safetensors')),
      folder: path.posix.dirname(id.split(':').slice(1).join(':')).replace(/^\.$/, ''),
      kind: bundle ? 'bundle' : members[0].kind,
      members,
      tokens: members.reduce((n, m) => n + m.tokens, 0),
      size: stat.size,
      fingerprint,
      root,
    }
  } finally {
    fs.closeSync(fd)
  }
}
export function resolveRefMod(id: string): string {
  const match = /^(\d+):(.+\.safetensors)$/.exec(id)
  if (!match) throw new Error('Некорректный идентификатор RefMod')
  const root = refModRoots()[Number(match[1])]
  if (!root) throw new Error('Папка RefMod больше не подключена')
  return inside(root, match[2])
}
export function refModLibrary(): {
  entries: RefModEntry[]
  errors: Array<{ file: string; error: string }>
} {
  const entries: RefModEntry[] = []
  const errors: Array<{ file: string; error: string }> = []
  refModRoots().forEach((root, ri) => {
    const walk = (dir: string, depth: number) => {
      if (depth > 12 || !fs.existsSync(dir)) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink() || ['.git', '__pycache__', 'graph_presets'].includes(e.name))
          continue
        const file = path.join(dir, e.name)
        if (e.isDirectory()) walk(file, depth + 1)
        else if (e.name.endsWith('.safetensors')) {
          const id = `${ri}:${path.relative(root, file).replace(/\\/g, '/')}`
          try {
            const entry = inspectRefMod(file, id, root)
            const cover = file.replace(/\.safetensors$/, '.png')
            if (fs.existsSync(cover))
              entry.previewUrl = `/api/refmods?cover=${encodeURIComponent(id)}`
            entries.push(entry)
          } catch (error) {
            errors.push({ file: id, error: String(error instanceof Error ? error.message : error) })
          }
        }
      }
    }
    walk(root, 0)
  })
  return { entries, errors }
}
export function refModDataDir(): string {
  const dir = path.join(process.cwd(), 'data', 'refmods')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
export function atomicJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2))
    fs.renameSync(temp, file)
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}
