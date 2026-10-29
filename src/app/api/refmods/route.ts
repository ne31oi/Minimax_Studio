import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import {
  refModLibrary,
  refModRoot,
  refModRoots,
  resolveRefMod,
  inspectRefMod,
  inside,
  refModDataDir,
} from '@/lib/refmods/files'
import { receiveRefModFile, refModError, serveRefModFile } from '@/lib/refmods/http'
import { COMFY_URL } from '@/lib/comfy/minimax-h3-client'
import { exportRefModMembers } from '@/lib/refmods/export'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('export') || req.nextUrl.searchParams.get('cover')
    if (id) {
      const file = resolveRefMod(id)
      inspectRefMod(file, id)
      const selected = req.nextUrl.searchParams.get('members')
      if (selected !== null && req.nextUrl.searchParams.has('export')) {
        const indices = selected.split(',').map(Number)
        const dir = path.join(refModDataDir(), 'exports', crypto.randomUUID())
        fs.mkdirSync(dir, { recursive: true })
        const output = path.join(dir, path.basename(file))
        exportRefModMembers(file, output, indices)
        const response = serveRefModFile(req, output, true)
        // Export cache is bounded on subsequent requests; downloaded files remain valid while streaming.
        setTimeout(() => {
          try {
            fs.unlinkSync(output)
            fs.rmdirSync(dir)
          } catch {}
        }, 600000)
        return response
      }
      return serveRefModFile(
        req,
        req.nextUrl.searchParams.has('cover') ? file.replace(/\.safetensors$/, '.png') : file,
        req.nextUrl.searchParams.has('export'),
      )
    }
    let available = false
    try {
      const r = await fetch(`${COMFY_URL}/object_info/StudioH3RefModLoad`, {
        signal: AbortSignal.timeout(2000),
      })
      available = !!(await r.json()).StudioH3RefModLoad
    } catch {}
    return NextResponse.json({ ...refModLibrary(), roots: refModRoots(), available })
  } catch (e) {
    return refModError(e)
  }
}
export async function POST(req: NextRequest) {
  let temp = ''
  try {
    const received = await receiveRefModFile(req, path.join(refModDataDir(), 'uploads'))
    temp = received.file
    const requested = req.nextUrl.searchParams.get('folder') || 'imported'
    const folder = requested.split(/[\\/]/).filter(Boolean)
    if (folder.some((p) => p === '.' || p === '..' || !/^[-\p{L}\p{N}_. ]{1,100}$/u.test(p)))
      throw new Error('Некорректная папка импорта')
    const dir = inside(refModRoot(), folder.join('/'))
    fs.mkdirSync(dir, { recursive: true })
    const dest = inside(refModRoot(), path.join(...folder, received.name))
    if (fs.existsSync(dest))
      return refModError(new Error('Файл уже существует. Выберите другую папку или имя.'), 409)
    const ext = path.extname(received.name).toLowerCase()
    if (ext === '.safetensors') {
      // Legacy sidecars are imported first; validate against a same-name temporary file.
      const sidecar = dest.replace(/\.safetensors$/, '.json')
      const tempSidecar = temp.replace(/\.safetensors$/, '.json')
      try {
        if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, tempSidecar)
        inspectRefMod(temp)
      } finally {
        if (fs.existsSync(tempSidecar)) fs.unlinkSync(tempSidecar)
      }
    } else if (ext === '.json') {
      if (fs.statSync(temp).size > 1024 * 1024) throw new Error('Слишком большой sidecar')
      const j = JSON.parse(fs.readFileSync(temp, 'utf8'))
      if (
        !['image', 'video', 'audio', 'bundle'].includes(j.kind) ||
        (j.kind === 'bundle' &&
          (j._format_version !== 5 ||
            !Array.isArray(j.members) ||
            !j.members.length ||
            j.members.length > 256))
      )
        throw new Error('Некорректный sidecar RefMod')
    } else if (ext === '.png') {
      const sharp = (await import('sharp')).default
      const safe = await sharp(temp)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      fs.writeFileSync(temp, safe)
    } else throw new Error('Импорт поддерживает .safetensors, старый .json sidecar и .png обложки')
    fs.copyFileSync(temp, dest, fs.constants.COPYFILE_EXCL)
    return NextResponse.json({
      ok: true,
      entry:
        ext === '.safetensors'
          ? inspectRefMod(
              dest,
              `0:${path.relative(refModRoot(), dest).replace(/\\/g, '/')}`,
              refModRoot(),
            )
          : null,
    })
  } catch (e) {
    return refModError(e)
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp)
  }
}
