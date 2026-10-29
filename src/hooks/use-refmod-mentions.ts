'use client'
import { useEffect, useMemo, useRef } from 'react'
import { useRefMods } from '@/lib/refmods/store'
import { useGenStore } from '@/lib/gen-store'
import { useControlNetTarget } from '@/lib/controlnet-target-store'
import { studioReferenceLabels } from '@/lib/refmods/reference-map'
import { referenceRestoreState } from '@/lib/refmods/remapping'
import {
  emptyRefModSet,
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
  const nativeExtension = useGenStore(s=>s.video.extendSourceVideoPath)
  const control = useControlNetTarget()
  const key = JSON.stringify(raw)
  useEffect(()=>{
    const source=control.source
    if(target!=='controlnet'||!source||control.params.controlType!=='direct'||source.hasAudio!==undefined)return
    let disposed=false
    const path=source.inputSource || [source.subfolder,source.filename].filter(Boolean).join('/')
    void fetch('/api/refmods/references',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({references:[{id:'native-control-video',path,kind:'video',type:source.inputSource?'input':'output'}]})})
      .then(r=>r.ok?r.json():null).then(data=>{
        const current=useControlNetTarget.getState().source
        if(!disposed&&data&&current?.filename===source.filename&&current?.inputSource===source.inputSource)
          useControlNetTarget.getState().setSource({...current,hasAudio:data.references[0].hasAudio})
      }).catch(()=>{})
    return ()=>{disposed=true}
  },[target,control.source,control.params.controlType])
  useEffect(() => {
    if (target !== 'generate') return
    const references = raw.filter(
      (r) => r.kind === 'video' && r.path && r.includeAudio && r.hasAudio === undefined,
    )
    if (!references.length) return
    let disposed = false
    void fetch('/api/refmods/references', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ references }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (disposed || !data) return
        for (const ref of data.references) {
          const current = useGenStore.getState().video.refs.find((r) => r.id === ref.id)
          if (current?.path === ref.path)
            useGenStore.getState().updateVideoRef(ref.id, { hasAudio: ref.hasAudio })
        }
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [key, target])
  const set = saved || emptyRefModSet()
  // Stable identities, not numeric positions, drive tag remapping.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labels = useMemo(
    () => studioReferenceLabels(target, set, raw),
    [key, saved, target, nativeExtension, control],
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
