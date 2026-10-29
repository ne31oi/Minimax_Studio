'use client'
import { useEffect, useMemo, useRef } from 'react'
import { useRefMods } from '@/lib/refmods/store'
import { useGenStore } from '@/lib/gen-store'
import { referenceRestoreState } from '@/lib/refmods/remapping'
import {
  allowsRefModAudio,
  emptyRefModSet,
  referenceLabels,
  remapReferenceTags,
  type RefModKind,
  type RefModTarget,
  type ReferenceLabel,
} from '@/lib/refmods/types'
export function useRefModMentions(
  target: RefModTarget,
  raw: Array<{
    id?: string
    name?: string
    kind: RefModKind
    includeAudio?: boolean
    previewUrl?: string
    path?: string
    hasAudio?: boolean
  }>,
  prompt?: string,
  onChange?: (p: string) => void,
) {
  const saved = useRefMods((s) => s.sets[target])
  const key = JSON.stringify(raw)
  useEffect(() => {
    if (target !== 'generate') return
    const references = raw.filter((r) => r.kind === 'video' && r.path && r.includeAudio && r.hasAudio === undefined)
    if (!references.length) return
    let disposed = false
    void fetch('/api/refmods/references', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({references}) })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (disposed || !data) return
        for (const ref of data.references) {
          const current=useGenStore.getState().video.refs.find((r)=>r.id===ref.id)
          if (current?.path===ref.path) useGenStore.getState().updateVideoRef(ref.id,{hasAudio:ref.hasAudio})
        }
      }).catch(()=>{})
    return () => { disposed=true }
  }, [key, target])
  const set = saved || emptyRefModSet()
  // Stable identities, not numeric positions, drive tag remapping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labels = useMemo(
    () => referenceLabels(raw, set, allowsRefModAudio(target)),
    [key, saved, target],
  )
  const previous = useRef<ReferenceLabel[] | null>(null)
  const restoreEpoch = useRef(referenceRestoreState().epoch)
  useEffect(() => {
    const restore = referenceRestoreState()
    if (
      previous.current &&
      prompt !== undefined &&
      onChange &&
      !restore.restoring &&
      restoreEpoch.current === restore.epoch
    ) {
      const next = remapReferenceTags(prompt, previous.current, labels)
      if (next !== prompt) onChange(next)
    }
    previous.current = labels
    restoreEpoch.current = restore.epoch
  }, [labels]) // prompt typing must not trigger a second remapping
  return labels.map((l) => ({
    ...l,
    color:
      l.kind === 'image'
        ? 'bg-purple-500/15 text-purple-400'
        : l.kind === 'video'
          ? 'bg-cyan-500/15 text-cyan-400'
          : 'bg-emerald-500/15 text-emerald-400',
  }))
}
