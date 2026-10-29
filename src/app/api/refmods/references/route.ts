import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { getAppConfig } from '@/lib/app-config'
import { inside } from '@/lib/refmods/files'
import { refModError } from '@/lib/refmods/http'
import { resolveFfprobe } from '@/lib/video-probe'
const run = promisify(execFile)
const cache = new Map<
  string,
  { width: number; height: number; frames: number; duration: number; hasAudio: boolean }
>()
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!Array.isArray(body.references) || body.references.length > 15)
      throw new Error('Некорректные референсы')
    const cfg = getAppConfig()
    const width = Number(body.width) || 640,
      height = Number(body.height) || 360
    let tokens = 0
    const references: Array<{ id: string; path: string; hasAudio: boolean; tokens: number }> = []
    for (const ref of body.references) {
      if (!ref || typeof ref.path !== 'string' || !['image', 'video', 'audio'].includes(ref.kind))
        throw new Error('Некорректный референс')
      const file = inside(cfg.inputDir, ref.path)
      const stat = fs.statSync(file)
      const key = `${file}:${stat.size}:${stat.mtimeMs}`
      let info = cache.get(key)
      if (!info) {
        if (ref.kind === 'image') {
          const meta = await sharp(file).metadata()
          info = {
            width: meta.width || 0,
            height: meta.height || 0,
            frames: 1,
            duration: 0,
            hasAudio: false,
          }
        } else {
          const probe = await resolveFfprobe()
          const { stdout } = await run(
            probe,
            [
              '-v',
              'error',
              '-show_entries',
              'stream=codec_type,width,height,nb_frames,duration,r_frame_rate:format=duration',
              '-of',
              'json',
              file,
            ],
            { timeout: 10000, maxBuffer: 1024 * 1024 },
          )
          const data = JSON.parse(stdout)
          const video = data.streams?.find((s: { codec_type: string }) => s.codec_type === 'video')
          const duration = Number(video?.duration || data.format?.duration) || 0
          const [num, den] = (video?.r_frame_rate || '24/1').split('/').map(Number)
          info = {
            width: video?.width || 0,
            height: video?.height || 0,
            frames: Number(video?.nb_frames) || Math.round((duration * num) / (den || 1)),
            duration,
            hasAudio: !!data.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio'),
          }
        }
        if (cache.size > 100) cache.clear()
        cache.set(key, info)
      }
      let cost = 0
      if (ref.kind === 'image') {
        const scale = Math.min(
          1,
          body.detail === 'max'
            ? 2048 / Math.min(info.width, info.height)
            : Math.sqrt((width * height) / (info.width * info.height)),
        )
        const short = Math.max(
          32,
          Math.round((Math.min(info.width, info.height) * scale) / 32) * 32,
        )
        const long = Math.max(
          32,
          Math.round(
            (short * Math.max(info.width, info.height)) / Math.min(info.width, info.height) / 32,
          ) * 32,
        )
        cost = (short * long) / 1024
      } else if (ref.kind === 'video') {
        const scale = Math.min(
          1,
          768 / Math.min(info.width, info.height),
          Math.sqrt((768 * 1344) / (info.width * info.height)),
        )
        const w = Math.max(32, Math.round((info.width * scale) / 32) * 32),
          h = Math.max(32, Math.round((info.height * scale) / 32) * 32)
        let frames = Math.min(info.frames, Number(body.frames) || info.frames)
        frames = Math.max(5, frames - ((frames - 5) % 17))
        const temporal = 2 + Math.max(0, (frames - 5) / 17) * 5
        cost = (temporal * w * h) / 1024
        if (ref.includeAudio && info.hasAudio) cost += Math.round((frames / 24) * 40) * 2
      } else if (!body.audioGuide) {
        const duration = Math.max(
          0,
          Math.min(info.duration, ref.trimEnd ?? info.duration) - (ref.trimStart || 0),
        )
        cost = Math.round(duration * 40) * 2
      }
      tokens += cost
      references.push({ id: ref.id, path: ref.path, hasAudio: info.hasAudio, tokens: cost })
    }
    return NextResponse.json({ references, tokens, estimated: true })
  } catch (e) {
    return refModError(e)
  }
}
