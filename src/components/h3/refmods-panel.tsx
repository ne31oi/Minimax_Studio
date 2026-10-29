'use client'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDownIcon, ChevronUpIcon, LibraryIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useRefMods } from '@/lib/refmods/store'
import { useGenStore } from '@/lib/gen-store'
import { useControlNetTarget } from '@/lib/controlnet-target-store'
import { studioReferenceLabels } from '@/lib/refmods/reference-map'
import {
  activeSetMembers,
  allowsRefModAudio,
  CURVE_DIRECTIONS,
  CURVE_SHAPES,
  emptyRefModSet,
  refModTokens,
  type RefModCurve,
  type RefModEntry,
  type RefModSet,
  type RefModTarget,
} from '@/lib/refmods/types'
import { refModRequest } from '@/lib/refmods/client-jobs'
import { RefModReferenceBudget } from './refmods-reference-budget'
import { refModCurveValue } from '@/lib/refmods/curves'
export const refModInput =
  'rounded-md border border-border bg-background px-2 py-1.5 text-xs min-w-0'
export const refModButton =
  'rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40'
const targetNames: Record<RefModTarget, string> = {
  generate: 'Генерация',
  extend: 'Продление',
  controlnet: 'ControlNet',
  refine: 'Refine',
  'face-refine': 'Face Refine',
  'tile-upscale': 'Tile Upscale',
}
const directionLabels: Record<string, string> = {
  constant: 'Постоянная',
  concept_at_start: 'Сильнее в начале',
  concept_at_middle: 'Сильнее в середине',
  concept_at_end: 'Сильнее в конце',
  concept_at_ends: 'Сильнее по краям',
}
export function RefModCurveEditor({
  value,
  onChange,
  label,
}: {
  value: RefModCurve
  onChange: (v: RefModCurve) => void
  label: string
}) {
  return (
    <div className="space-y-1">
      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="w-44 text-muted-foreground">{label}</span>
        <select
          aria-label={label}
          className={refModInput}
          value={value.direction}
          onChange={(e) =>
            onChange({ ...value, direction: e.target.value as RefModCurve['direction'] })
          }
        >
          {CURVE_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {directionLabels[d]}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label}: форма`}
          className={refModInput}
          value={value.shape}
          onChange={(e) => onChange({ ...value, shape: e.target.value as RefModCurve['shape'] })}
        >
          {CURVE_SHAPES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          aria-label={`${label}: значение`}
          type="number"
          className={`${refModInput} w-20`}
          min={0}
          max={1}
          step={0.05}
          value={value.value}
          onChange={(e) =>
            onChange({ ...value, value: Math.max(0, Math.min(1, Number(e.target.value))) })
          }
        />
      </label>
      <svg
        role="img"
        aria-label={label + ': график силы'}
        viewBox="0 0 300 62"
        className="w-72 h-16 ml-44 text-muted-foreground"
      >
        <path d="M20 3V43H295" fill="none" stroke="currentColor" opacity=".4" />
        <polyline
          points={Array.from(
            { length: 65 },
            (_, i) => `${20 + (i / 64) * 270},${43 - refModCurveValue(value, i / 64) * 38}`,
          ).join(' ')}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.5"
        />
        <text x="2" y="10" fontSize="8" fill="currentColor">
          1
        </text>
        <text x="2" y="43" fontSize="8" fill="currentColor">
          0
        </text>
        <text x="20" y="57" fontSize="8" fill="currentColor">
          0%
        </text>
        <text x="269" y="57" fontSize="8" fill="currentColor">
          100%
        </text>
        <text x="100" y="57" fontSize="8" fill="currentColor">
          {label}
        </text>
      </svg>
    </div>
  )
}
export function RefModsPanel({ target }: { target: RefModTarget }) {
  useGenStore(s=>s.video)
  useControlNetTarget()
  const store = useRefMods()
  const set = store.sets[target] || emptyRefModSet()
  const labels=['generate','extend','controlnet'].includes(target) ? studioReferenceLabels(target,set) : []
  const audio = allowsRefModAudio(target)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<RefModEntry[]>([])
  const [pick, setPick] = useState('')
  const [presetName, setPresetName] = useState('')
  useEffect(() => {
    if (!open) return
    void refModRequest<{ entries: RefModEntry[] }>('/api/refmods')
      .then((d) => setEntries(d.entries))
      .catch((e) => toast.error(e.message))
  }, [open])
  const tokens = refModTokens(set, audio)
  const active = set.items.reduce((n, i) => n + activeSetMembers(set, i, audio).length, 0)
  const update = (value: RefModSet) => {
    store.set(target, value)
    window.dispatchEvent(
      new CustomEvent('h3:refmod-set-changed', { detail: { target, before: set, after: value } }),
    )
  }
  const choices = useMemo(
    () => entries.filter((e) => audio || e.members.some((m) => m.kind !== 'audio')),
    [entries, audio],
  )
  return (
    <section className="shrink-0 border-b border-border bg-[var(--surface-1)] text-foreground">
      <button
        className="w-full flex items-center gap-2 px-5 py-2 text-xs text-left"
        onClick={() => setOpen(!open)}
      >
        <LibraryIcon className="w-4 h-4 text-amber-400" />
        <span>Используемые RefMods</span>
        <span className="text-muted-foreground">
          {targetNames[target]} · {active} компонентов · {tokens.toLocaleString()} /{' '}
          {set.maxTokens.toLocaleString()} токенов
        </span>
        {tokens > set.maxTokens && <span className="text-red-400">Бюджет превышен</span>}
        <ChevronDownIcon className="ml-auto w-4 h-4" />
      </button>
      {open && (
        <div className="px-5 pb-3 space-y-3 max-h-[45vh] overflow-y-auto">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Добавить RefMod"
              className={`${refModInput} flex-1`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Выберите из библиотеки…</option>
              {choices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.tokens} токенов
                </option>
              ))}
            </select>
            <button
              className={refModButton}
              disabled={!pick || set.items.length >= 8}
              onClick={() => {
                const e = entries.find((e) => e.id === pick)
                if (e) {
                  const before = set
                  store.add(target, e)
                  const after = useRefMods.getState().sets[target]!
                  window.dispatchEvent(
                    new CustomEvent('h3:refmod-set-changed', { detail: { target, before, after } }),
                  )
                  setPick('')
                }
              }}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
            <button
              className={refModButton}
              onClick={() => window.dispatchEvent(new Event('h3:goto-refmods'))}
            >
              Мастерская
            </button>
          </div>
          {!audio && (
            <p className="text-xs text-muted-foreground">
              Исходный звук сохраняется. Аудиокомпоненты RefMods в этом разделе неактивны.
            </p>
          )}
          {set.items.map((item, index) => (
            <div key={item.id} className="border border-border rounded-lg p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Использовать ${item.name}`}
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) =>
                    update({
                      ...set,
                      items: set.items.map((i) =>
                        i.id === item.id ? { ...i, enabled: e.target.checked } : i,
                      ),
                    })
                  }
                />
                <span className="text-xs flex-1 truncate">{item.name}</span>
                <button
                  title="Обновить файл и состав"
                  className={refModButton}
                  onClick={() => {
                    const fresh = entries.find((e) => e.id === item.entryId)
                    if (!fresh) return toast.error('Файл отсутствует в библиотеке')
                    update({
                      ...set,
                      items: set.items.map((i) =>
                        i.id === item.id
                          ? { ...i, fingerprint: fresh.fingerprint, members: fresh.members }
                          : i,
                      ),
                    })
                  }}
                >
                  Обновить
                </button>
                {[index - 1, index + 1].map((to, n) => (
                  <button
                    key={n}
                    aria-label={n ? 'Переместить вниз' : 'Переместить вверх'}
                    disabled={to < 0 || to >= set.items.length}
                    className={refModButton}
                    onClick={() => {
                      const items = [...set.items]
                      items.splice(to, 0, items.splice(index, 1)[0])
                      update({ ...set, items })
                    }}
                  >
                    {n ? (
                      <ChevronDownIcon className="w-3 h-3" />
                    ) : (
                      <ChevronUpIcon className="w-3 h-3" />
                    )}
                  </button>
                ))}
                <button
                  aria-label={`Убрать ${item.name}`}
                  className={refModButton}
                  onClick={() =>
                    update({ ...set, items: set.items.filter((i) => i.id !== item.id) })
                  }
                >
                  <Trash2Icon className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {(['strength', 'visualStrength', 'audioStrength'] as const).map((key, k) => (
                  <label key={key} className="flex items-center gap-1 text-muted-foreground">
                    {['Сила', 'Визуал', 'Аудио'][k]}
                    <input
                      type="number"
                      aria-label={`${item.name}: ${key}`}
                      className={`${refModInput} w-16`}
                      disabled={key === 'audioStrength' && !audio}
                      min={0}
                      max={1}
                      step={0.05}
                      value={item[key]}
                      onChange={(e) =>
                        update({
                          ...set,
                          items: set.items.map((i) =>
                            i.id === item.id
                              ? { ...i, [key]: Math.min(1, Math.max(0, Number(e.target.value))) }
                              : i,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Копии{' '}
                  <input
                    aria-label={`${item.name}: копии`}
                    className={`${refModInput} w-14`}
                    type="number"
                    min={1}
                    max={8}
                    value={item.copies}
                    onChange={(e) =>
                      update({
                        ...set,
                        items: set.items.map((i) =>
                          i.id === item.id
                            ? {
                                ...i,
                                copies: Math.max(
                                  1,
                                  Math.min(8, Math.round(Number(e.target.value))),
                                ),
                              }
                            : i,
                        ),
                      })
                    }
                  />
                </label>
                <select
                  aria-label={`${item.name}: состав`}
                  className={refModInput}
                  value={item.components}
                  onChange={(e) =>
                    update({
                      ...set,
                      items: set.items.map((i) =>
                        i.id === item.id
                          ? { ...i, components: e.target.value as typeof i.components }
                          : i,
                      ),
                    })
                  }
                >
                  <option value="All">Все компоненты</option>
                  <option value="Visual">Визуальные</option>
                  <option value="Audio" disabled={!audio}>
                    Аудио
                  </option>
                </select>
              </div>
              <details className="text-xs text-muted-foreground">
                <summary>Компоненты ({item.members.length})</summary>
                <div className="flex flex-wrap gap-3 pt-2">
                  {item.members.map((m) => (
                    <label key={m.index} className="flex gap-1 items-center">
                      <input
                        type="checkbox"
                        disabled={m.kind === 'audio' && !audio}
                        checked={!item.memberIndices || item.memberIndices.includes(m.index)}
                        onChange={(e) => {
                          const indices = item.memberIndices || item.members.map((x) => x.index)
                          update({
                            ...set,
                            items: set.items.map((i) =>
                              i.id === item.id
                                ? {
                                    ...i,
                                    memberIndices: e.target.checked
                                      ? [...indices, m.index]
                                      : indices.filter((n) => n !== m.index),
                                  }
                                : i,
                            ),
                          })
                        }}
                      />
                      {m.name} · {m.kind} · {m.tokens}
                      {labels.filter(l=>l.id.startsWith(`${item.id}:${m.index}:`)).map(l=><code key={l.id} className="text-amber-400 ml-1">{l.trigger}</code>)}
                    </label>
                  ))}
                </div>
              </details>
              {item.members.some((m) => m.config) && (
                <button
                  className={refModButton}
                  onClick={() => {
                    const config = item.members.find((m) => m.config)?.config
                    const toCurve = (v: unknown, fallback: RefModCurve): RefModCurve =>
                      Array.isArray(v) &&
                      CURVE_DIRECTIONS.includes(v[0]) &&
                      CURVE_SHAPES.includes(v[1]) &&
                      Number.isFinite(v[2])
                        ? { direction: v[0], shape: v[1], value: v[2] }
                        : fallback
                    update({
                      ...set,
                      retention:
                        typeof config?.retention === 'number'
                          ? Math.min(1, Math.max(0, config.retention))
                          : set.retention,
                      frameCurve: toCurve(config?.curve, set.frameCurve),
                      stepCurve: toCurve(config?.step_curve, set.stepCurve),
                    })
                    toast.success('Настройки файла загружены в поля кривых')
                  }}
                >
                  Загрузить настройки из файла
                </button>
              )}
            </div>
          ))}
          {target === 'generate' && (
            <button
              className={refModButton}
              disabled={!active}
              onClick={() => window.dispatchEvent(new Event('h3:refmod-compare'))}
            >
              A/B: без RefMods / с RefMods
            </button>
          )}
          <label className="flex items-center gap-2 text-xs">
            Общая сила набора{' '}
            <input
              aria-label="Общая сила RefMods"
              type="number"
              className={`${refModInput} w-20`}
              min={0}
              max={1}
              step={0.05}
              value={set.retention ?? 1}
              onChange={(e) =>
                update({ ...set, retention: Math.max(0, Math.min(1, Number(e.target.value))) })
              }
            />
          </label>
          <RefModReferenceBudget target={target} refModTokenCount={tokens} />
          <RefModCurveEditor
            value={set.frameCurve}
            label="Кадры референса"
            onChange={(frameCurve) => update({ ...set, frameCurve })}
          />
          <RefModCurveEditor
            value={set.stepCurve}
            label="Шаги каждого прохода"
            onChange={(stepCurve) => update({ ...set, stepCurve })}
          />
          <div className="flex flex-wrap gap-2 items-center text-xs">
            <label>
              Бюджет RefMods{' '}
              <input
                aria-label="Бюджет RefMods"
                type="number"
                className={`${refModInput} w-24`}
                min={1}
                max={1048576}
                value={set.maxTokens}
                onChange={(e) =>
                  update({ ...set, maxTokens: Math.max(1, Math.round(Number(e.target.value))) })
                }
              />
            </label>
            <input
              aria-label="Имя набора"
              className={refModInput}
              placeholder="Имя набора"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              className={refModButton}
              disabled={!presetName.trim()}
              onClick={() => {
                store.savePreset(presetName.trim(), set)
                toast.success('Набор сохранён')
              }}
            >
              Сохранить набор
            </button>
            <select
              aria-label="Сохранённые наборы"
              className={refModInput}
              value=""
              onChange={(e) => {
                if (store.presets[e.target.value])
                  update(structuredClone(store.presets[e.target.value]))
              }}
            >
              <option value="">Применить набор…</option>
              {Object.keys(store.presets).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <button className={refModButton} onClick={() => update(emptyRefModSet())}>
              Отключить всё
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Кривые относятся к исходному референсу и вычислению модели. Аудио экспериментальное;
            комплект не гарантирует привязку голоса к персонажу.
          </p>
        </div>
      )}
    </section>
  )
}
