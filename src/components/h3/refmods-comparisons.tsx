'use client'
import { useEffect, useState } from 'react'
import { refModRequest } from '@/lib/refmods/client-jobs'
type Clip = {
  filename: string
  subfolder: string
  url: string
  seed?: number
  variant: 'baseline' | 'refmods'
  names: string[]
}
export function RefModComparisons() {
  const [pairs, setPairs] = useState<Record<string, Clip[]>>({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    void (async () => {
      const data = await refModRequest<{
        files: Array<{ filename: string; subfolder: string; url: string; type: string }>
      }>('/api/comfy/files')
      const videos = data.files.filter((f) => f.type === 'video').slice(0, 60)
      const groups: Record<string, Clip[]> = {}
      let next = 0
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < videos.length) {
            const clip = videos[next++]
            try {
              const meta = await refModRequest<Record<string, unknown>>(
                `/api/comfy/meta?path=${encodeURIComponent((clip.subfolder ? clip.subfolder + '/' : '') + clip.filename)}`,
              )
              const p = (meta.params || meta) as {
                refModComparison?: { id: string; variant: 'baseline' | 'refmods' }
                seed?: number
                refMods?: { items?: Array<{ name: string; enabled: boolean }> }
              }
              if (p.refModComparison) {
                const { id, variant } = p.refModComparison
                groups[id] ??= []
                groups[id].push({
                  ...clip,
                  seed: p.seed,
                  variant,
                  names: p.refMods?.items?.filter((i) => i.enabled).map((i) => i.name) || [],
                })
              }
            } catch {}
          }
        }),
      )
      if (alive) setPairs(groups)
    })()
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="space-y-4">
      {loading && <p className="text-xs text-muted-foreground">Загрузка A/B-результатов…</p>}
      {Object.entries(pairs).map(([id, clips]) => (
        <section key={id} className="border border-border rounded-xl p-3">
          <p className="text-xs text-muted-foreground mb-2">A/B · seed {clips[0].seed}</p>
          <div className="grid md:grid-cols-2 gap-3">
            {(['baseline', 'refmods'] as const).map((variant) => {
              const clip = clips.find((c) => c.variant === variant)
              return (
                <div key={variant}>
                  <p className="text-xs mb-2">
                    {variant === 'baseline' ? 'Без RefMods' : 'С RefMods'}
                  </p>
                  {clip ? (
                    <>
                      <video
                        controls
                        preload="metadata"
                        src={clip.url}
                        className="w-full rounded-lg"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {clip.names.join(', ') || clip.filename}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">Результат ещё не готов</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
