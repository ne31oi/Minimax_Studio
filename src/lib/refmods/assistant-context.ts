'use client'
import { selectedRefMods } from './store'
import { refModTokens, type RefModTarget } from './types'
import { studioReferenceLabels } from './reference-map'
export function refModAssistantContext(mode: string): string {
  const target: RefModTarget =
    mode === 'extend' ? 'extend' : mode === 'controlnet' ? 'controlnet' : 'generate'
  const set = selectedRefMods(target)
  if (!refModTokens(set)) return ''
  const labels = studioReferenceLabels(target, set)
  return (
    '\n\nACTIVE REFMODS — authoritative reference map for this request:\n' +
    labels.map((l) => `${l.trigger} = ${l.label}`).join('\n') +
    '\nUse these exact labels when referring to saved references. A bundle may have several independent labels. Filenames are not trigger words. Full/compressed describes retained latent information, not guaranteed identity or voice cloning. Saved references have no original media attachment unless explicitly supplied. Never claim to have seen or heard them. For frame/text generation, these active reference labels are supported alongside the existing keyframes.\n'
  )
}
