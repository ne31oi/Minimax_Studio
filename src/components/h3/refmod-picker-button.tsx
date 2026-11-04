'use client'

import { useEffect, useState } from 'react'
import { LibraryIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useRefMods } from '@/lib/refmods/store'
import { allowsRefModAudio, type RefModEntry, type RefModTarget } from '@/lib/refmods/types'
import { refModRequest } from '@/lib/refmods/client-jobs'
import { cn } from '@/lib/utils'

export function openRefMods(target: RefModTarget, view: 'selected' | 'library' = 'selected') {
  window.dispatchEvent(new CustomEvent('h3:open-refmods', { detail: { target, view } }))
}

export function RefModPickerButton({
  target,
  className,
}: {
  target: RefModTarget
  className?: string
}) {
  const selected = useRefMods((s) => s.sets[target])
  const count = selected?.items.length || 0
  return (
    <button
      type="button"
      aria-label="Открыть RefMods"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/20',
        className,
      )}
      onClick={() => openRefMods(target, count ? 'selected' : 'library')}
    >
      <LibraryIcon className="h-4 w-4" /> RefMods{' '}
      <span className="rounded bg-amber-500/15 px-1.5">{count}</span>
    </button>
  )
}

/** The library is embedded in the same dialog as the selected references. */
export function RefModLibrary({ target, onAdded }: { target: RefModTarget; onAdded: () => void }) {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<RefModEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const selected = useRefMods((s) => s.sets[target])
  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await refModRequest<{ entries: RefModEntry[] }>('/api/refmods')
      setEntries(result.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  const choices = entries.filter(
    (entry) =>
      (allowsRefModAudio(target) || entry.members.some((m) => m.kind !== 'audio')) &&
      `${entry.name} ${entry.members.map((m) => `${m.name} ${m.description}`).join(' ')}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  )
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          aria-label="Поиск готовых RefMods"
          placeholder="Найти по названию или описанию…"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          aria-label="Обновить готовые RefMods"
          className="rounded-md border border-border p-2 hover:bg-accent disabled:opacity-40"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCwIcon className="h-4 w-4" />
        </button>
      </div>
      {loading && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Загрузка библиотеки…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {!loading && !error && !choices.length && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {entries.length
            ? 'Ничего не найдено.'
            : 'Готовых RefMods пока нет. Создайте или импортируйте комплект в мастерской.'}
        </p>
      )}
      {(selected?.items.length || 0) >= 8 && (
        <p className="text-xs text-amber-300">
          В наборе уже 8 комплектов. Уберите один из выбранных, чтобы добавить другой.
        </p>
      )}
      {!loading &&
        !error &&
        choices.map((entry) => {
          const added = selected?.items.some((item) => item.entryId === entry.id)
          return (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="h-16 w-16 shrink-0 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                {entry.previewUrl ? (
                  <img src={entry.previewUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <LibraryIcon className="h-6 w-6 text-amber-400/50" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words">{entry.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.members.length} комп. · {entry.tokens.toLocaleString()} токенов
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {[...new Set(entry.members.map((m) => m.description).filter(Boolean))].join(
                    ' · ',
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label={`${added ? 'Уже добавлен' : 'Добавить'} ${entry.name}`}
                disabled={added || (selected?.items.length || 0) >= 8}
                className="rounded-md border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
                onClick={() => {
                  try {
                    useRefMods.getState().add(target, entry)
                    toast.success(`RefMod «${entry.name}» добавлен`)
                    onAdded()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                {added ? 'Добавлен' : 'Добавить'}
              </button>
            </div>
          )
        })}
    </div>
  )
}
