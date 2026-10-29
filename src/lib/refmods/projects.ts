import fs from 'fs'
import path from 'path'
import { atomicJson, inside, refModDataDir } from './files'
import type { RefModProject } from './types'
export function projectDir(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Некорректный ID проекта')
  return path.join(refModDataDir(), 'projects', id)
}
export function readProject(id: string): RefModProject {
  return JSON.parse(fs.readFileSync(path.join(projectDir(id), 'project.json'), 'utf8'))
}
export function validateProject(p: RefModProject): void {
  projectDir(p.id)
  if (
    typeof p.name !== 'string' ||
    !p.name.trim() ||
    p.name.length > 150 ||
    typeof p.description !== 'string' ||
    p.description.length > 4000 ||
    !['encode', 'training'].includes(p.mode) ||
    !Array.isArray(p.sources) ||
    p.sources.length > 128
  )
    throw new Error('Некорректный проект RefMod')
  for (const [value, min, max] of [
    [p.resolution, 128, 2048],
    [p.poolSize, 2, 128],
    [p.frameLimit, 5, 1024],
    [p.refinementSteps, 0, 2000],
    [p.maxTokens, 1, 1048576],
  ])
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error('Некорректные настройки сборки')
  if (p.poolSize % 2) throw new Error('Размер сетки сжатия должен быть чётным')
  const ids = new Set<string>()
  for (const s of p.sources) {
    if (
      !s ||
      typeof s.id !== 'string' ||
      ids.has(s.id) ||
      !['image', 'video', 'audio'].includes(s.kind) ||
      typeof s.name !== 'string' ||
      typeof s.file !== 'string' ||
      typeof s.includeAudio !== 'boolean' ||
      !Number.isFinite(s.start) ||
      s.start < 0 ||
      (s.end != null && (!Number.isFinite(s.end) || s.end <= s.start))
    )
      throw new Error('Некорректный исходник')
    ids.add(s.id)
    inside(projectDir(p.id), s.file)
    if (s.mask) inside(projectDir(p.id), s.mask)
    if (s.crop) {
      const c = s.crop
      if (
        ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width <= 0 ||
        c.height <= 0 ||
        c.x + c.width > 1.000001 ||
        c.y + c.height > 1.000001
      )
        throw new Error('Некорректная область изображения')
    }
  }
}
export function saveProject(project: RefModProject): RefModProject {
  validateProject(project)
  let previous: RefModProject | undefined
  try {
    previous = readProject(project.id)
  } catch {}
  if (previous && previous.updatedAt !== project.updatedAt)
    throw new Error('Проект изменён в другой вкладке. Откройте его заново.')
  const saved = { ...project, builds: previous?.builds || [], updatedAt: new Date().toISOString() }
  atomicJson(path.join(projectDir(project.id), 'project.json'), saved)
  return saved
}
