'use client'
import { useEffect, useState } from 'react'
import { useGenStore } from '@/lib/gen-store'
import { useControlNetTarget } from '@/lib/controlnet-target-store'
import { refModRequest } from '@/lib/refmods/client-jobs'
import type { RefModTarget } from '@/lib/refmods/types'
export function RefModReferenceBudget({
  target,
  refModTokenCount,
}: {
  target: RefModTarget
  refModTokenCount: number
}) {
  const video = useGenStore((s) => s.video)
  const control = useControlNetTarget((s) => s.refImages)
  const raw =
    target === 'extend'
      ? video.extendImageRefs
      : target === 'controlnet'
        ? control.map((r) => ({ ...r, kind: 'image' as const }))
        : target === 'generate' && video.mode === 'ref'
          ? video.refs
          : []
  const key = JSON.stringify({
    references: raw.map((r) => ({
      id: r.id,
      path: r.path,
      kind: r.kind,
      ...('includeAudio' in r ? { includeAudio: r.includeAudio } : {}),
      ...('trimStart' in r ? { trimStart: r.trimStart, trimEnd: r.trimEnd } : {}),
    })),
    width: Math.round(Math.sqrt(((video.lowResMP || 0.2) * 1e6 * 16) / 9)),
    height: Math.round(Math.sqrt(((video.lowResMP || 0.2) * 1e6 * 9) / 16)),
    frames: 5 + 17 * Math.ceil(Math.max(0, video.videoLength - 5) / 17),
    detail: video.referenceDetail,
    audioGuide: video.audioGuide,
  })
  const [estimate, setEstimate] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    setEstimate(null)
    const timer = setTimeout(() => {
      void refModRequest<{ tokens: number; references: Array<{ id: string; hasAudio: boolean }> }>(
        '/api/refmods/references',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key },
      )
        .then((data) => {
          if (cancelled) return
          setEstimate(data.tokens)
          if (target === 'generate')
            for (const r of data.references) {
              const current = useGenStore.getState().video.refs.find((i) => i.id === r.id)
              if (current?.kind === 'video' && current.hasAudio !== r.hasAudio)
                useGenStore.getState().updateVideoRef(r.id, { hasAudio: r.hasAudio })
            }
        })
        .catch(() => {
          if (!cancelled) setEstimate(null)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, target])
  if (['refine', 'face-refine', 'tile-upscale'].includes(target))
    return (
      <p className="text-[11px] text-muted-foreground">
        Референсы исходного ролика учитываются при подготовке задачи; точный состав сохраняется в
        метаданных.
      </p>
    )
  return (
    <p className="text-[11px] text-muted-foreground">
      Обычные референсы:{' '}
      {estimate === null ? 'оценка недоступна' : `≈ ${estimate.toLocaleString()} токенов`}. RefMods:{' '}
      {refModTokenCount.toLocaleString()}.
      {estimate !== null && ` Всего: ≈ ${(estimate + refModTokenCount).toLocaleString()}.`} Оценка
      обычных референсов не включает кадры-якоря и токены промпта.
    </p>
  )
}
