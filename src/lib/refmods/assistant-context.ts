'use client'
import { useGenStore } from '../gen-store'
import { useControlNetTarget } from '../controlnet-target-store'
import { selectedRefMods } from './store'
import { referenceLabels, refModTokens, type RefModTarget } from './types'
export function refModAssistantContext(mode: string): string {
  const target: RefModTarget =
    mode === 'extend' ? 'extend' : mode === 'controlnet' ? 'controlnet' : 'generate'
  const set = selectedRefMods(target)
  if (!refModTokens(set)) return ''
  const video = useGenStore.getState().video
  const raw =
    target === 'extend'
      ? video.extendImageRefs
      : target === 'controlnet'
        ? useControlNetTarget.getState().refImages.map((r) => ({ ...r, kind: 'image' as const }))
        : video.mode === 'ref'
          ? video.refs.filter((r) => !(video.audioGuide && r.kind === 'audio'))
          : video.mode === 'flf'
            ? [video.startFrame, video.endFrame].flatMap((r, i) =>
                r ? [{ id: `frame-${i}`, name: r.name, kind: 'image' as const }] : [],
              )
            : []
  const labels = referenceLabels(raw, set)
  return (
    '\n\nACTIVE REFMODS — authoritative reference map for this request:\n' +
    labels.map((l) => `${l.trigger} = ${l.label}`).join('\n') +
    '\nUse these exact labels when referring to saved references. A bundle may have several independent labels. Filenames are not trigger words. Full/compressed describes retained latent information, not guaranteed identity or voice cloning. Saved references have no original media attachment unless explicitly supplied. Never claim to have seen or heard them. For frame/text generation, these active reference labels are supported alongside the existing keyframes.\n'
  )
}
