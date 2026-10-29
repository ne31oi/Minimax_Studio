import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { inside, refModDataDir } from '@/lib/refmods/files'
import { readProject, projectDir, saveProject } from '@/lib/refmods/projects'
import { receiveRefModFile, serveRefModFile, refModError } from '@/lib/refmods/http'
import type { RefModProject } from '@/lib/refmods/types'
import { getAppConfig } from '@/lib/app-config'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      const project = readProject(id)
      const source = req.nextUrl.searchParams.get('source')
      if (source) return serveRefModFile(req, inside(projectDir(id), source))
      return NextResponse.json({ project })
    }
    const root = path.join(refModDataDir(), 'projects')
    const projects: RefModProject[] = []
    if (fs.existsSync(root))
      for (const entry of fs.readdirSync(root, { withFileTypes: true }))
        if (entry.isDirectory())
          try {
            projects.push(readProject(entry.name))
          } catch {}
    return NextResponse.json({
      projects: projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    })
  } catch (e) {
    return refModError(e)
  }
}
export async function POST(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (id && req.headers.get('content-type')?.startsWith('multipart/form-data')) {
      readProject(id)
      const { file, name } = await receiveRefModFile(req, path.join(projectDir(id), 'sources'))
      const ext = path.extname(name).toLowerCase()
      if (
        ![
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.bmp',
          '.mp4',
          '.mov',
          '.webm',
          '.mkv',
          '.wav',
          '.mp3',
          '.flac',
          '.ogg',
          '.m4a',
        ].includes(ext)
      ) {
        fs.unlinkSync(file)
        throw new Error('Неподдерживаемый исходник')
      }
      return NextResponse.json({
        file: path.relative(projectDir(id), file).replace(/\\/g, '/'),
        name,
      })
    }
    const data = await req.json()
    if (data.id && data.source) {
      const project = readProject(data.id)
      const cfg = getAppConfig()
      const source = data.source
      if (
        !['input', 'output'].includes(source.type) ||
        typeof source.filename !== 'string' ||
        typeof source.subfolder !== 'string'
      )
        throw new Error('Некорректный источник студии')
      const file = inside(
        source.type === 'input' ? cfg.inputDir : cfg.outputDir,
        path.join(source.subfolder, source.filename),
      )
      if (!fs.statSync(file).isFile()) throw new Error('Исходник не найден')
      const dir = path.join(projectDir(project.id), 'sources')
      fs.mkdirSync(dir, { recursive: true })
      const dest = path.join(dir, `${crypto.randomUUID()}-${path.basename(file)}`)
      fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL)
      return NextResponse.json({
        file: path.relative(projectDir(project.id), dest).replace(/\\/g, '/'),
        name: path.basename(file),
      })
    }
    const project: RefModProject = {
      id: crypto.randomUUID(),
      name: typeof data.name === 'string' ? data.name : 'Новый RefMod',
      description: '',
      sources: [],
      updatedAt: '',
      mode: 'encode',
      resolution: 1024,
      poolSize: 16,
      frameLimit: 16,
      refinementSteps: 100,
      maxTokens: 5120,
      builds: [],
    }
    return NextResponse.json({ project: saveProject(project) })
  } catch (e) {
    return refModError(e)
  }
}
export async function PUT(req: NextRequest) {
  try {
    return NextResponse.json({ project: saveProject((await req.json()).project) })
  } catch (e) {
    return refModError(e)
  }
}
