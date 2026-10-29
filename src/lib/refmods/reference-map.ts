'use client'
import { useGenStore } from '../gen-store'
import { useControlNetTarget } from '../controlnet-target-store'
import { referenceLabels, type RefModSet, type RefModTarget } from './types'
type RawReferences = Parameters<typeof referenceLabels>[0]

/** Includes the ordinary references inserted by native workflow builders. */
export function studioReferenceLabels(target: RefModTarget, set: RefModSet, override?: RawReferences) {
  const video = useGenStore.getState().video
  const control = useControlNetTarget.getState()
  let raw: RawReferences = override ? [...override] : target === 'extend'
    ? [...video.extendImageRefs]
    : target === 'controlnet'
      ? control.refImages.map(r => ({...r,kind:'image' as const}))
      : target === 'generate' && video.mode === 'ref'
        ? video.refs.filter(r=>!(video.audioGuide && r.kind==='audio'))
        : target === 'generate' && video.mode === 'flf'
          ? [video.startFrame,video.endFrame].flatMap((r,i)=>r?[{id:`frame-${i}`,name:r.name,kind:'image' as const,previewUrl:r.previewUrl}]:[])
          : []
  if (target === 'extend' && video.extendSourceVideoPath)
    raw.push({id:'native-extension-anchor',name:'Якорь стыка',kind:'image'})
  if (target === 'controlnet' && control.source)
    raw.push({id:'native-control-video',name:'Управляющее видео',kind:'video',includeAudio:control.params.controlType==='direct',hasAudio:control.source.hasAudio})
  return referenceLabels(raw,set,['generate','extend','controlnet'].includes(target))
}
