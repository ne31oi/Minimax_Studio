'use client'

import { ImageIcon, VideoIcon, Volume2Icon, SlidersHorizontalIcon } from 'lucide-react'
import { useRefMods } from '@/lib/refmods/store'
import { useGenStore } from '@/lib/gen-store'
import { activeSetMembers, allowsRefModAudio, emptyRefModSet, type RefModTarget } from '@/lib/refmods/types'
import { studioReferenceLabels } from '@/lib/refmods/reference-map'
import { openRefMods } from './refmod-picker-button'

export function RefModReferenceCards({ target = 'generate', rawImageCount, showLabels = true }: { target?: RefModTarget; rawImageCount?: number; showLabels?: boolean } = {}) {
  const selected = useRefMods((s) => s.sets[target])
  useGenStore((s) => s.video)
  const set = selected || emptyRefModSet()
  const labels = studioReferenceLabels(target, set, rawImageCount === undefined ? undefined : Array.from({length:rawImageCount}, (_,i) => ({id:`native-${i}`,kind:'image' as const})))
  const cards = set.items.flatMap((item) =>
    activeSetMembers(set, item, allowsRefModAudio(target)).flatMap((member) =>
      Array.from({ length: item.copies }, (_, copy) => ({
        item,
        member,
        copy,
        label: labels.find((l) => l.id === `${item.id}:${member.index}:${copy}`),
      })),
    ),
  )
  if (!cards.length) return null
  return (
    <div className="space-y-2" aria-label="Референсы из RefMods">
      <p className="text-[10px] text-muted-foreground">Из RefMods</p>
      {cards.map(({ item, member, copy, label }) => {
        const Icon =
          member.kind === 'image' ? ImageIcon : member.kind === 'video' ? VideoIcon : Volume2Icon
        const cover =
          member.kind !== 'audio' && item.members.filter((m) => m.kind !== 'audio').length === 1
            ? item.previewUrl
            : undefined
        return (
          <button
            key={`${item.id}:${member.index}:${copy}`}
            type="button"
            data-refmod-card
            aria-label={`Настроить RefMod ${item.name}: ${member.name}${copy ? ` · копия ${copy + 1}` : ''}`}
            className="w-full flex items-center gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-left hover:bg-amber-500/10"
            onClick={() => openRefMods(target, 'selected')}
          >
            <div className="h-12 w-12 shrink-0 rounded overflow-hidden bg-[var(--surface-2)] flex items-center justify-center">
              {cover ? (
                <img src={cover} alt="Обложка RefMod" className="h-full w-full object-contain" />
              ) : (
                <Icon className="h-5 w-5 text-amber-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs truncate">{item.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {member.name}
                {item.copies > 1 ? ` · копия ${copy + 1}` : ''}
              </p>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-amber-300">RefMod</span>
                {showLabels && <code className="text-amber-300">{label?.trigger}</code>}
                <span className="text-muted-foreground">
                  Сила{' '}
                  {Math.round(
                    item.strength *
                      (member.kind === 'audio' ? item.audioStrength : item.visualStrength) *
                      100,
                  )}
                  %
                </span>
              </div>
            </div>
            <SlidersHorizontalIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )
      })}
    </div>
  )
}
