'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  emptyRefModSet,
  type RefModSet,
  type RefModTarget,
  type RefModEntry,
  type RefModSelection,
} from './types'
interface RefModStore {
  sets: Partial<Record<RefModTarget, RefModSet>>
  presets: Record<string, RefModSet>
  set: (target: RefModTarget, set: RefModSet) => void
  add: (target: RefModTarget, entry: RefModEntry) => void
  savePreset: (name: string, set: RefModSet) => void
  removePreset: (name: string) => void
}
export const useRefMods = create<RefModStore>()(
  persist(
    (set) => ({
      sets: {},
      presets: {},
      set: (target, value) => set((s) => ({ sets: { ...s.sets, [target]: value } })),
      add: (target, entry) =>
        set((s) => {
          const current = s.sets[target] || emptyRefModSet()
          if (current.items.length >= 8) throw new Error('В наборе уже 8 RefMods')
          const item: RefModSelection = {
            id: crypto.randomUUID(),
            entryId: entry.id,
            name: entry.name,
            fingerprint: entry.fingerprint,
            previewUrl: entry.previewUrl,
            enabled: true,
            strength: 1,
            visualStrength: 1,
            audioStrength: 1,
            copies: 1,
            components: 'All',
            members: entry.members,
          }
          return { sets: { ...s.sets, [target]: { ...current, items: [...current.items, item] } } }
        }),
      savePreset: (name, value) =>
        set((s) => ({ presets: { ...s.presets, [name]: structuredClone(value) } })),
      removePreset: (name) =>
        set((s) => ({
          presets: Object.fromEntries(Object.entries(s.presets).filter(([k]) => k !== name)),
        })),
    }),
    { name: 'h3-refmods-v1', version: 1 },
  ),
)
export function selectedRefMods(target: RefModTarget): RefModSet {
  return structuredClone(useRefMods.getState().sets[target] || emptyRefModSet())
}
