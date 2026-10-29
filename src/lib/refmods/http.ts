import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextResponse } from 'next/server'
import { readFirstMultipartPart } from '../multipart-stream'
import { pipeline } from 'stream/promises'

export function refModError(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  )
}
/** One streamed upload at a time, with a hard bound; never buffers source videos in RAM. */
export async function receiveRefModFile(
  request: Request,
  dir: string,
): Promise<{ file: string; name: string }> {
  if (!request.body) throw new Error('Пустая загрузка')
  const part = await readFirstMultipartPart(request.body, request.headers.get('content-type'))
  const name = path.basename(part.filename || '').replace(/[\\/:*?"<>|]/g, '_')
  if (!name) {
    part.cancel()
    throw new Error('Не выбрано имя файла')
  }
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${crypto.randomUUID()}-${name}`)
  let bytes = 0
  part.stream.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > 512 * 1024 * 1024)
      part.stream.destroy(new Error('Максимальный размер файла — 512 МБ'))
  })
  try {
    await pipeline(part.stream, fs.createWriteStream(file, { flags: 'wx' }))
    return { file, name }
  } catch (e) {
    try {
      part.cancel()
    } catch {}
    if (fs.existsSync(file)) fs.unlinkSync(file)
    throw e
  }
}
export function serveRefModFile(request: Request, file: string, download = false): Response {
  const size = fs.statSync(file).size
  const ext = path.extname(file).toLowerCase()
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
  }
  const headers = new Headers({
    'Content-Type': types[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  })
  if (download)
    headers.set(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
    )
  let start = 0,
    end = size - 1
  const range = request.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!m)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    if (!m[1]) {
      start = Math.max(0, size - Number(m[2]))
    } else {
      start = Number(m[1])
      if (m[2]) end = Math.min(end, Number(m[2]))
    }
    if (start > end || start >= size)
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('Content-Length', String(end - start + 1))
  const stream = fs.createReadStream(file, { start, end })
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers,
  })
}
