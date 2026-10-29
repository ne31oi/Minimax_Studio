'use client'
import { validateRefModSet } from '@/lib/refmods/workflow'
import { refModTokens } from '@/lib/refmods/types'
export function RefModMetadata({
  value,
  maps,
  rawTokens,
}: {
  value: unknown
  maps?: unknown
  rawTokens?: unknown
}) {
  if (!value) return null
  try {
    const set = validateRefModSet(value)
    if (!set.items.length) return null
    const versions = (value as { versions?: Record<string, string> }).versions
    return (
      <section className="border border-amber-500/20 rounded-lg p-3 space-y-2">
        <h3 className="text-xs font-medium text-amber-300">
          RefMods · {refModTokens(set).toLocaleString()} / {set.maxTokens.toLocaleString()} токенов
        </h3>
        {set.items.map((i) => (
          <div key={i.id} className="text-xs">
            <p>
              {i.enabled ? '●' : '○'} {i.name} · сила {i.strength} · визуал {i.visualStrength} ·
              аудио {i.audioStrength} · копии {i.copies}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {i.components} · {i.memberIndices?.length ?? i.members.length} компонентов
              {versions?.[i.entryId] ? ` · SHA ${versions[i.entryId].slice(0, 12)}` : ''}
            </p>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">
          Общая сила: {set.retention ?? 1}. Кадры референса: {set.frameCurve.direction},{' '}
          {set.frameCurve.shape}, {set.frameCurve.value}. Шаги прохода: {set.stepCurve.direction},{' '}
          {set.stepCurve.shape}, {set.stepCurve.value}.
        </p>
        {maps != null && (
          <details className="text-xs">
            <summary>Фактические метки референсов</summary>
            <pre className="whitespace-pre-wrap text-[10px] max-h-52 overflow-auto">
              {JSON.stringify(maps, null, 2)}
            </pre>
          </details>
        )}
        {rawTokens != null && (
          <p className="text-[10px] text-muted-foreground">
            Токены обычных референсов по узлам: {JSON.stringify(rawTokens)}
          </p>
        )}
      </section>
    )
  } catch {
    return (
      <p className="text-xs text-amber-300">Метаданные RefMods имеют неподдерживаемый формат.</p>
    )
  }
}
