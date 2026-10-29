'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  DownloadIcon,
  LibraryIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { RefModComparisons } from './refmods-comparisons'
import { useGenStore } from '@/lib/gen-store'
import { useRefMods } from '@/lib/refmods/store'
import { enqueueRefModJob, refModRequest } from '@/lib/refmods/client-jobs'
import {
  emptyRefModSet,
  REF_MOD_TARGETS,
  type RefModEntry,
  type RefModJob,
  type RefModProject,
  type RefModSource,
  type RefModTarget,
} from '@/lib/refmods/types'
import { refModButton as button, refModInput as input } from './refmods-panel'
const kindOf = (name: string): RefModSource['kind'] =>
  /\.(png|jpe?g|webp|bmp)$/i.test(name)
    ? 'image'
    : /\.(mp4|mov|webm|mkv)$/i.test(name)
      ? 'video'
      : 'audio'
const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
const sourceUrl = (p: RefModProject, s: RefModSource) =>
  `/api/refmods/projects?id=${p.id}&source=${encodeURIComponent(s.file)}`
type GallerySource = { filename: string; subfolder: string; type: 'image' | 'video'; url: string }

function MaskEditor({
  url,
  existing,
  onSave,
  onClose,
}: {
  url: string
  existing?: string
  onSave: (blob: Blob) => Promise<void>
  onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [brush, setBrush] = useState(30)
  const [include, setInclude] = useState(false)
  const [busy, setBusy] = useState(false)
  const drawing = useRef(false)
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current
    if (!c || !drawing.current) return
    const r = c.getBoundingClientRect()
    const ctx = c.getContext('2d')!
    ctx.fillStyle = include ? 'white' : 'black'
    ctx.beginPath()
    ctx.arc(
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height,
      (brush * c.width) / r.width / 2,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  const initialize = () => {
    const c = canvas.current,
      im = image.current
    if (!c || !im) return
    c.width = Math.min(1024, im.naturalWidth)
    c.height = Math.round((im.naturalHeight * c.width) / im.naturalWidth)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, c.width, c.height)
    if (existing) {
      const mask = new Image()
      mask.onload = () => ctx.drawImage(mask, 0, 0, c.width, c.height)
      mask.src = existing
    }
  }
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Маска референса"
    >
      <div className="bg-background border border-border rounded-xl p-4 max-w-4xl w-full space-y-3">
        <div className="flex flex-wrap gap-3 items-center text-xs">
          <strong>Маска: белое сохраняется, чёрное скрывается</strong>
          <label>
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />{' '}
            Восстанавливать
          </label>
          <label>
            Кисть{' '}
            <input
              aria-label="Размер кисти маски"
              type="range"
              min={4}
              max={150}
              value={brush}
              onChange={(e) => setBrush(Number(e.target.value))}
            />
          </label>
          <button
            className={button}
            onClick={() => {
              const c = canvas.current!
              const ctx = c.getContext('2d')!
              ctx.fillStyle = 'black'
              ctx.fillRect(0, 0, c.width, c.height)
            }}
          >
            Скрыть всё
          </button>
          <button className={button} onClick={initialize}>
            Сбросить
          </button>
        </div>
        <div className="relative max-h-[65vh] overflow-auto w-fit mx-auto">
          <img
            ref={image}
            src={url}
            onLoad={initialize}
            alt="Исходник маски"
            className="max-h-[65vh] max-w-full object-contain"
          />
          <canvas
            ref={canvas}
            className="absolute inset-0 w-full h-full opacity-45 touch-none cursor-crosshair"
            onPointerDown={(e) => {
              drawing.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              paint(e)
            }}
            onPointerMove={paint}
            onPointerUp={() => {
              drawing.current = false
            }}
            onPointerCancel={() => {
              drawing.current = false
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className={button} onClick={onClose}>
            Закрыть
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              canvas.current?.toBlob((blob) => {
                if (blob) {
                  setBusy(true)
                  void onSave(blob)
                    .then(onClose)
                    .catch((e) => toast.error(e.message))
                    .finally(() => setBusy(false))
                }
              }, 'image/png')
            }
          >
            Сохранить маску
          </button>
        </div>
      </div>
    </div>
  )
}

export function RefModsView() {
  const [tab, setTab] = useState<'library' | 'editor' | 'compare'>('library')
  const [entries, setEntries] = useState<RefModEntry[]>([])
  const [errors, setErrors] = useState<Array<{ file: string; error: string }>>([])
  const [available, setAvailable] = useState(false)
  const [projects, setProjects] = useState<RefModProject[]>([])
  const [project, setProject] = useState<RefModProject | null>(null)
  const [jobs, setJobs] = useState<RefModJob[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [folder, setFolder] = useState('all')
  const [selected, setSelected] = useState<RefModEntry | null>(null)
  const [indices, setIndices] = useState<number[]>([])
  const [target, setTarget] = useState<RefModTarget>('generate')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [maskOpen, setMaskOpen] = useState(false)
  const [gallery, setGallery] = useState<GallerySource[]>([])
  const [showStudioSources, setShowStudioSources] = useState(false)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const sourcesInput = useRef<HTMLInputElement>(null)
  const maskInput = useRef<HTMLInputElement>(null)
  const store = useRefMods()
  const video = useGenStore((s) => s.video)
  const refresh = useCallback(async () => {
    try {
      const [lib, ps, js] = await Promise.all([
        refModRequest<{
          entries: RefModEntry[]
          errors: Array<{ file: string; error: string }>
          available: boolean
        }>('/api/refmods'),
        refModRequest<{ projects: RefModProject[] }>('/api/refmods/projects'),
        refModRequest<{ jobs: RefModJob[] }>('/api/refmods/jobs'),
      ])
      setEntries(lib.entries)
      setErrors(lib.errors)
      setAvailable(lib.available)
      setProjects(ps.projects)
      setJobs(js.jobs)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    void refresh()
    const change = () => void refresh()
    window.addEventListener('h3:refmods-changed', change)
    return () => window.removeEventListener('h3:refmods-changed', change)
  }, [refresh])
  useEffect(() => {
    if (!jobs.some((j) => ['queued', 'running'].includes(j.status))) return
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [jobs, refresh])
  const upload = async (file: File | Blob, name: string, p: RefModProject) => {
    const data = new FormData()
    data.append('file', file, name)
    return refModRequest<{ file: string; name: string }>(`/api/refmods/projects?id=${p.id}`, {
      method: 'POST',
      body: data,
    })
  }
  const save = async (p = project) => {
    if (!p) throw new Error('Выберите проект')
    const result = await refModRequest<{ project: RefModProject }>('/api/refmods/projects', {
      ...json({ project: p }),
      method: 'PUT',
    })
    setProject(result.project)
    setDirty(false)
    return result.project
  }
  const edit = (patch: Partial<RefModProject>) => {
    if (project) {
      setProject({ ...project, ...patch })
      setDirty(true)
    }
  }
  const editSource = (patch: Partial<RefModSource>) => {
    if (project)
      edit({ sources: project.sources.map((s, i) => (i === sourceIndex ? { ...s, ...patch } : s)) })
  }
  const importFiles = async (files: File[]) => {
    setBusy(true)
    try {
      const sorted = [...files]
        .filter((f) => /\.(safetensors|json|png)$/i.test(f.name))
        .sort((a, b) => (a.name.endsWith('.json') ? -1 : 1) - (b.name.endsWith('.json') ? -1 : 1))
      const errors: string[] = []
      let imported = 0
      for (const file of sorted) {
        try {
          const data = new FormData()
          data.append('file', file)
          const rel = file.webkitRelativePath
          const dir = rel ? rel.split('/').slice(0, -1).join('/') : 'imported'
          await refModRequest(`/api/refmods?folder=${encodeURIComponent(dir)}`, {
            method: 'POST',
            body: data,
          })
          imported++
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (imported) toast.success(`Импортировано файлов: ${imported}`)
      if (errors.length)
        toast.error(`Не импортировано: ${errors.length}. ${errors.slice(0, 3).join('; ')}`, {
          duration: 12000,
        })
      if (!sorted.length) toast.error('В папке нет файлов RefMod')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const addFiles = async (files: File[]) => {
    if (!project) return
    setBusy(true)
    try {
      let p = dirty ? await save() : project
      const sources = [...p.sources]
      for (const file of files) {
        const result = await upload(file, file.name, p)
        sources.push({
          id: crypto.randomUUID(),
          kind: kindOf(file.name),
          name: file.name,
          file: result.file,
          start: 0,
          end: null,
          includeAudio: false,
        })
      }
      p = { ...p, sources }
      await save(p)
      setSourceIndex(Math.max(0, sources.length - 1))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const addStudioSource = async (source: {
    filename: string
    subfolder: string
    type: 'input' | 'output'
  }) => {
    if (!project) return
    setBusy(true)
    try {
      const p = dirty ? await save() : project
      const result = await refModRequest<{ file: string; name: string }>(
        '/api/refmods/projects',
        json({ id: p.id, source }),
      )
      await save({
        ...p,
        sources: [
          ...p.sources,
          {
            id: crypto.randomUUID(),
            kind: kindOf(result.name),
            name: result.name,
            file: result.file,
            start: 0,
            end: null,
            includeAudio: false,
          },
        ],
      })
      setShowStudioSources(false)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    setBusy(true)
    try {
      if (dirty && project) await save()
      const result = await refModRequest<{ project: RefModProject }>(
        '/api/refmods/projects',
        json({ name: 'Новый RefMod' }),
      )
      setProject(result.project)
      setDirty(false)
      setTab('editor')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const preview = () => {
    if (!selected) return
    const set = emptyRefModSet()
    set.maxTokens = Math.max(5120, selected.tokens)
    set.items = [
      {
        id: crypto.randomUUID(),
        entryId: selected.id,
        name: selected.name,
        fingerprint: selected.fingerprint,
        members: selected.members,
        enabled: true,
        strength: 1,
        visualStrength: 1,
        audioStrength: 1,
        copies: 1,
        components: 'All',
        memberIndices: indices,
      },
    ]
    enqueueRefModJob({ kind: 'preview', set, fullVideo: true }, `Просмотр: ${selected.name}`)
    toast.success('Предпросмотр добавлен в общую очередь')
    setTimeout(() => void refresh(), 1000)
  }
  const source = project?.sources[sourceIndex]
  const previews = jobs
    .filter((j) => j.kind === 'preview' && j.entryId === selected?.id && j.status === 'done')
    .flatMap(
      (j) =>
        (j.result?.previews || []) as Array<{
          filename: string
          subfolder: string
          kind: string
          name: string
        }>,
    )
    .slice(0, 20)
  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border px-6 py-4 flex items-center gap-3">
        <LibraryIcon className="w-6 h-6 text-amber-400" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">RefMods</h1>
          <p className="text-xs text-muted-foreground">
            Библиотека референсов · создание и сравнение · полностью локально
          </p>
        </div>
        <button className={button} onClick={() => void refresh()}>
          <RefreshCwIcon className="w-4 h-4" />
        </button>
        <button className={button} disabled={busy} onClick={() => void create()}>
          <PlusIcon className="inline w-3 h-3 mr-1" />
          Создать RefMod
        </button>
      </header>
      {!available && (
        <div className="px-6 py-2 bg-amber-500/10 text-amber-300 text-xs">
          Ноды RefMods пока не загружены. После установки пакета перезапустите ComfyUI, когда его
          текущие задачи завершатся. Библиотека и редактор доступны.
        </div>
      )}
      <nav className="flex gap-1 px-6 pt-3 border-b border-border">
        {(
          [
            ['library', 'Библиотека'],
            ['editor', 'Мастерская'],
            ['compare', 'Сравнение'],
          ] as const
        ).map(([id, label]) => (
          <button
            className={`px-4 py-2 text-sm border-b-2 ${tab === id ? 'border-amber-400 text-amber-300' : 'border-transparent text-muted-foreground'}`}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {tab === 'library' && (
          <div
            className="space-y-5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void importFiles(Array.from(e.dataTransfer.files))
            }}
          >
            <div className="flex flex-wrap gap-2">
              <input
                className={`${input} flex-1 min-w-48`}
                placeholder="Найти по имени или описанию…"
                aria-label="Поиск RefMods"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Тип RefMod"
                className={input}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {[
                  ['all', 'Все типы'],
                  ['image', 'Изображения'],
                  ['video', 'Видео'],
                  ['audio', 'Аудио'],
                  ['bundle', 'Комплекты'],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <select
                aria-label="Папка RefMods"
                className={input}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                <option value="all">Все папки</option>
                {Array.from(new Set(entries.map((e) => e.folder))).map((f) => (
                  <option key={f} value={f}>
                    {f || 'Корневая папка'}
                  </option>
                ))}
              </select>
              <button
                className={button}
                disabled={busy}
                onClick={() => filesInput.current?.click()}
              >
                <UploadIcon className="w-3 h-3 inline mr-1" />
                Импорт файлов
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => folderInput.current?.click()}
              >
                Импорт папки
              </button>
            </div>
            <input
              ref={filesInput}
              className="hidden"
              type="file"
              accept=".safetensors,.json,.png"
              multiple
              onChange={(e) => {
                void importFiles(Array.from(e.target.files || []))
                e.target.value = ''
              }}
            />
            <input
              ref={folderInput}
              className="hidden"
              type="file"
              multiple
              {...{ webkitdirectory: '' }}
              onChange={(e) => {
                void importFiles(Array.from(e.target.files || []))
                e.target.value = ''
              }}
            />
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {entries
                .filter(
                  (e) =>
                    (kind === 'all' || e.kind === kind) &&
                    (folder === 'all' || e.folder === folder) &&
                    `${e.name} ${e.members.map((m) => m.description).join(' ')}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => {
                      setSelected(entry)
                      setIndices(entry.members.map((m) => m.index))
                    }}
                    className={`text-left rounded-xl border overflow-hidden hover:border-amber-400/70 ${selected?.id === entry.id ? 'border-amber-400' : 'border-border'}`}
                  >
                    <div className="h-32 bg-[var(--surface-2)] flex items-center justify-center">
                      {entry.previewUrl ? (
                        <img
                          src={entry.previewUrl}
                          className="w-full h-full object-contain"
                          alt={entry.name}
                        />
                      ) : (
                        <LibraryIcon className="w-10 h-10 text-amber-500/30" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-sm truncate">{entry.name}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {[...new Set(entry.members.map((m) => m.description).filter(Boolean))].join(
                          ' · ',
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {entry.kind} · {entry.members.length} комп. ·{' '}
                        {entry.tokens.toLocaleString()} токенов
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.members.every((m) => m.mode === 'encode')
                          ? 'Full Reference'
                          : 'Содержит сжатые референсы'}
                      </p>
                    </div>
                  </button>
                ))}
            </div>
            {!entries.length && (
              <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
                <LibraryIcon className="mx-auto w-10 h-10 mb-3" />
                <p>Создайте свой RefMod или перетащите готовые файлы сюда.</p>
                <p className="text-xs mt-2">
                  Импорт проверяет формат, геометрию тензоров и комплектность файла.
                </p>
              </div>
            )}
            {selected && (
              <section className="border border-border rounded-xl p-4 space-y-3">
                <h2 className="font-medium">{selected.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {selected.folder} · {(selected.size / 1024 / 1024).toFixed(2)} МБ ·{' '}
                  {selected.root}
                </p>
                {selected.members.map((m) => (
                  <label key={m.index} className="flex gap-2 text-xs items-start">
                    <input
                      type="checkbox"
                      checked={indices.includes(m.index)}
                      onChange={(e) =>
                        setIndices(
                          e.target.checked
                            ? [...indices, m.index]
                            : indices.filter((i) => i !== m.index),
                        )
                      }
                    />
                    <span>
                      {m.name} · {m.kind} · {m.shape.join(' × ')} · {m.tokens} токенов
                      <br />
                      <span className="text-muted-foreground">{m.description}</span>
                    </span>
                  </label>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className={input}
                    aria-label="Применить в раздел"
                    value={target}
                    onChange={(e) => setTarget(e.target.value as RefModTarget)}
                  >
                    {REF_MOD_TARGETS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    className={button}
                    disabled={indices.length === 0}
                    onClick={() => {
                      try {
                        store.add(target, selected)
                        const set = useRefMods.getState().sets[target]!
                        store.set(target, {
                          ...set,
                          items: set.items.map((i, n) =>
                            n === set.items.length - 1 ? { ...i, memberIndices: indices } : i,
                          ),
                        })
                        toast.success(`RefMod добавлен: ${target}`)
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e))
                      }
                    }}
                  >
                    Применить
                  </button>
                  <button
                    className={button}
                    disabled={!available || !indices.length}
                    onClick={preview}
                  >
                    Просмотреть сохранённое
                  </button>
                  <a
                    className={button}
                    href={`/api/refmods?export=${encodeURIComponent(selected.id)}`}
                  >
                    <DownloadIcon className="inline w-3 h-3 mr-1" />
                    Экспорт файла
                  </a>
                  <a
                    className={button}
                    href={`/api/refmods?export=${encodeURIComponent(selected.id)}&members=${indices.join(',')}`}
                    aria-disabled={!indices.length}
                  >
                    Экспорт компонентов
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  Предпросмотр декодирует сохранённое содержимое. Перенос в генерацию проверяется
                  отдельным сравнением.
                </p>
                <div className="flex flex-wrap gap-3">
                  {previews.map((p) => {
                    const url = `/api/comfy/file?type=output&subfolder=${encodeURIComponent(p.subfolder)}&filename=${encodeURIComponent(p.filename)}`
                    return (
                      <figure key={p.filename} className="max-w-64">
                        {p.kind === 'audio' ? (
                          <audio controls src={url} className="max-w-full" />
                        ) : p.filename.endsWith('.mp4') ? (
                          <video controls src={url} className="max-h-52" />
                        ) : (
                          <img src={url} alt={p.name} className="max-h-52" />
                        )}
                        <figcaption className="text-xs text-muted-foreground">{p.name}</figcaption>
                      </figure>
                    )
                  })}
                </div>
              </section>
            )}
            {!!errors.length && (
              <details className="text-xs text-amber-300">
                <summary>Пропущенные файлы: {errors.length}</summary>
                {errors.map((e) => (
                  <p key={e.file} className="mt-1">
                    {e.file}: {e.error}
                  </p>
                ))}
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Готовые RefMods:{' '}
              <a
                href="https://huggingface.co/malcolmrey/minimaxh3/tree/main"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                коллекция malcolmrey
              </a>
              . Выбирайте файлы RefMod; ReFLora использует другой механизм.
            </p>
          </div>
        )}
        {tab === 'editor' && (
          <div className="grid lg:grid-cols-[220px_1fr] gap-5">
            <aside className="space-y-2">
              <button className={`${button} w-full`} disabled={busy} onClick={() => void create()}>
                Новый проект
              </button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`${button} w-full text-left ${project?.id === p.id ? 'border-amber-400' : ''}`}
                  onClick={() => {
                    void (async () => {
                      if (dirty) await save()
                      const current = await refModRequest<{ project: RefModProject }>(
                        `/api/refmods/projects?id=${p.id}`,
                      )
                      setProject(current.project)
                      setSourceIndex(0)
                      setDirty(false)
                    })().catch((e) => toast.error(e.message))
                  }}
                >
                  {p.name}
                  <span className="block text-[10px] text-muted-foreground">
                    {p.sources.length} исходников · {p.builds.length} сборок
                  </span>
                </button>
              ))}
            </aside>
            {!project ? (
              <p className="text-sm text-muted-foreground">
                Создайте проект или откройте сохранённый.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`${input} flex-1`}
                    aria-label="Название проекта"
                    value={project.name}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                  <button
                    className={button}
                    disabled={busy || !dirty}
                    onClick={() => {
                      void save()
                        .then(() => toast.success('Проект сохранён'))
                        .catch((e) => toast.error(e.message))
                    }}
                  >
                    {dirty ? 'Сохранить изменения' : 'Сохранено'}
                  </button>
                </div>
                <textarea
                  className={`${input} w-full`}
                  aria-label="Описание RefMod"
                  placeholder="Что сохраняет этот референс…"
                  value={project.description}
                  onChange={(e) => edit({ description: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => sourcesInput.current?.click()}
                  >
                    Добавить исходники
                  </button>
                  <button
                    className={button}
                    onClick={() => {
                      setShowStudioSources(!showStudioSources)
                      void refModRequest<{ files: GallerySource[] }>('/api/comfy/files')
                        .then((d) => setGallery(d.files))
                        .catch((e) => toast.error(e.message))
                    }}
                  >
                    Из референсов / галереи
                  </button>
                  <input
                    ref={sourcesInput}
                    type="file"
                    accept="image/*,video/*,audio/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      void addFiles(Array.from(e.target.files || []))
                      e.target.value = ''
                    }}
                  />
                </div>
                {showStudioSources && (
                  <div className="border border-border rounded-lg p-3 max-h-64 overflow-auto space-y-1">
                    <p className="text-xs text-muted-foreground">Текущие референсы</p>
                    {video.refs.map((r) => (
                      <button
                        key={r.id}
                        className={`${button} mr-1 mb-1`}
                        disabled={busy}
                        onClick={() =>
                          void addStudioSource({ filename: r.path, subfolder: '', type: 'input' })
                        }
                      >
                        {r.name}
                      </button>
                    ))}
                    <p className="text-xs text-muted-foreground pt-2">Галерея</p>
                    {gallery.map((g) => (
                      <button
                        key={`${g.subfolder}/${g.filename}`}
                        className={`${button} mr-1 mb-1`}
                        disabled={busy}
                        onClick={() => void addStudioSource({ ...g, type: 'output' })}
                      >
                        {g.subfolder}/{g.filename}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 overflow-x-auto">
                  {project.sources.map((s, i) => (
                    <button
                      key={s.id}
                      className={`${button} whitespace-nowrap ${sourceIndex === i ? 'border-amber-400' : ''}`}
                      onClick={() => setSourceIndex(i)}
                    >
                      {i + 1}. {s.name}
                    </button>
                  ))}
                </div>
                {source && (
                  <section className="border border-border rounded-xl p-4 space-y-3">
                    <div className="flex gap-3 items-start">
                      <div className="w-1/2 max-w-96">
                        {source.kind === 'image' ? (
                          <div className="relative w-fit mx-auto overflow-hidden">
                            <img
                              src={sourceUrl(project, source)}
                              alt={source.name}
                              className="max-h-64"
                            />
                            {source.crop && (
                              <div
                                className="absolute border-2 border-amber-400 pointer-events-none shadow-[0_0_0_999px_#0006]"
                                style={{
                                  left: `${source.crop.x * 100}%`,
                                  top: `${source.crop.y * 100}%`,
                                  width: `${source.crop.width * 100}%`,
                                  height: `${source.crop.height * 100}%`,
                                }}
                              />
                            )}
                          </div>
                        ) : source.kind === 'video' ? (
                          <video
                            src={sourceUrl(project, source)}
                            controls
                            className="max-h-64 w-full"
                          />
                        ) : (
                          <audio controls src={sourceUrl(project, source)} className="w-full" />
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          aria-label="Имя исходника"
                          className={`${input} w-full`}
                          value={source.name}
                          onChange={(e) => editSource({ name: e.target.value })}
                        />
                        <div className="flex gap-1">
                          <button
                            className={button}
                            disabled={!sourceIndex}
                            onClick={() => {
                              const next = [...project.sources]
                              next.splice(sourceIndex - 1, 0, next.splice(sourceIndex, 1)[0])
                              edit({ sources: next })
                              setSourceIndex(sourceIndex - 1)
                            }}
                          >
                            Выше
                          </button>
                          <button
                            className={button}
                            disabled={sourceIndex === project.sources.length - 1}
                            onClick={() => {
                              const next = [...project.sources]
                              next.splice(sourceIndex + 1, 0, next.splice(sourceIndex, 1)[0])
                              edit({ sources: next })
                              setSourceIndex(sourceIndex + 1)
                            }}
                          >
                            Ниже
                          </button>
                          <button
                            className={button}
                            aria-label="Убрать исходник"
                            onClick={() => {
                              edit({ sources: project.sources.filter((s) => s.id !== source.id) })
                              setSourceIndex(Math.max(0, sourceIndex - 1))
                            }}
                          >
                            <Trash2Icon className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Копия оригинала сохраняется в проекте после удаления из списка.
                        </p>
                      </div>
                    </div>
                    {source.kind !== 'image' && (
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <label>
                          Начало, с{' '}
                          <input
                            className={`${input} w-24`}
                            type="number"
                            min={0}
                            step={0.1}
                            value={source.start}
                            onChange={(e) =>
                              editSource({ start: Math.max(0, Number(e.target.value)) })
                            }
                          />
                        </label>
                        <label>
                          Конец, с{' '}
                          <input
                            className={`${input} w-24`}
                            type="number"
                            min={source.start}
                            step={0.1}
                            placeholder="До конца"
                            value={source.end ?? ''}
                            onChange={(e) =>
                              editSource({ end: e.target.value ? Number(e.target.value) : null })
                            }
                          />
                        </label>
                        {source.kind === 'video' && (
                          <label>
                            <input
                              type="checkbox"
                              checked={source.includeAudio}
                              onChange={(e) => editSource({ includeAudio: e.target.checked })}
                            />{' '}
                            Сохранить звук видео отдельным компонентом
                          </label>
                        )}
                      </div>
                    )}
                    {source.kind === 'image' && (
                      <div className="flex flex-wrap gap-2 text-xs items-center">
                        <span>Обрезка, % изображения:</span>
                        {(['x', 'y', 'width', 'height'] as const).map((key) => (
                          <label key={key}>
                            {{ x: 'Слева', y: 'Сверху', width: 'Ширина', height: 'Высота' }[key]}{' '}
                            <input
                              className={`${input} w-20`}
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(
                                (source.crop || { x: 0, y: 0, width: 1, height: 1 })[key] * 100,
                              )}
                              onChange={(e) =>
                                editSource({
                                  crop: {
                                    ...(source.crop || { x: 0, y: 0, width: 1, height: 1 }),
                                    [key]: Number(e.target.value) / 100,
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                        <button className={button} onClick={() => editSource({ crop: undefined })}>
                          Сбросить обрезку
                        </button>
                      </div>
                    )}
                    {source.kind !== 'audio' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={button}
                          onClick={() =>
                            source.kind === 'image' ? setMaskOpen(true) : maskInput.current?.click()
                          }
                        >
                          {source.kind === 'image'
                            ? 'Нарисовать маску'
                            : 'Загрузить статическую маску'}
                        </button>
                        <button className={button} onClick={() => maskInput.current?.click()}>
                          Загрузить PNG маску
                        </button>
                        {source.mask && (
                          <>
                            <span className="text-xs text-emerald-400 self-center">
                              Маска подключена
                            </span>
                            <button
                              className={button}
                              onClick={() => editSource({ mask: undefined })}
                            >
                              Убрать маску
                            </button>
                          </>
                        )}
                        <input
                          ref={maskInput}
                          type="file"
                          accept="image/png"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file)
                              void upload(file, file.name, project)
                                .then((r) => editSource({ mask: r.file }))
                                .catch((e) => toast.error(e.message))
                            e.target.value = ''
                          }}
                        />
                      </div>
                    )}
                  </section>
                )}
                <section className="border border-border rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap gap-3 items-center text-xs">
                    <select
                      aria-label="Режим сохранения"
                      className={input}
                      value={project.mode}
                      onChange={(e) => edit({ mode: e.target.value as RefModProject['mode'] })}
                    >
                      <option value="encode">Full Reference · сохранить детали</option>
                      <option value="training">Compressed Reference · сжатие</option>
                    </select>
                    {(
                      [
                        ['resolution', 'Короткая сторона', 128, 2048],
                        ['frameLimit', 'Лимит кадров', 5, 1024],
                        ['maxTokens', 'Бюджет токенов', 1, 1048576],
                        ...(project.mode === 'training'
                          ? [
                              ['poolSize', 'Сетка сжатия', 2, 128],
                              ['refinementSteps', 'Шаги доработки', 0, 2000],
                            ]
                          : []),
                      ] as Array<[keyof RefModProject, string, number, number]>
                    ).map(([key, label, min, max]) => (
                      <label key={key}>
                        {label}{' '}
                        <input
                          className={`${input} w-24`}
                          aria-label={label}
                          type="number"
                          min={min}
                          max={max}
                          value={Number(project[key])}
                          onChange={(e) => edit({ [key]: Number(e.target.value) })}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Каждый исходник кодируется отдельно. Превышение бюджета остановит сборку;
                    автоматическое усечение выключено. Сжатие может потерять детали лица, одежды и
                    движения.
                  </p>
                  <button
                    className={button}
                    disabled={busy || !available || !project.sources.length}
                    onClick={() => {
                      setBusy(true)
                      void save()
                        .then((p) => {
                          enqueueRefModJob(
                            { kind: 'build', projectId: p.id, project: p },
                            `RefMod: ${p.name}`,
                          )
                          toast.success('Сборка добавлена в общую очередь')
                          setTimeout(() => void refresh(), 1000)
                        })
                        .catch((e) => toast.error(e.message))
                        .finally(() => setBusy(false))
                    }}
                  >
                    Собрать новую версию RefMod
                  </button>
                </section>
                {!!project.builds.length && (
                  <section className="space-y-2">
                    <h3 className="text-sm">Сохранённые сборки</h3>
                    {project.builds.map((b) => (
                      <div key={b.promptId} className="text-xs flex flex-wrap gap-2 items-center">
                        <span className="text-muted-foreground">
                          {b.createdAt.slice(0, 19).replace('T', ' ')} · {b.tokens} токенов
                        </span>
                        <span>{b.name}</span>
                        {b.entryId && (
                          <a
                            className={button}
                            href={`/api/refmods?export=${encodeURIComponent(b.entryId)}`}
                          >
                            Скачать
                          </a>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
        {tab === 'compare' && (
          <section className="max-w-3xl space-y-4">
            <h2 className="text-base font-medium">Проверка переноса в генерацию</h2>
            <p className="text-sm text-muted-foreground">
              Выберите RefMods в разделе «Генерация», задайте промпт и параметры. Кнопка «A/B: без
              RefMods / с RefMods» поставит два ролика в очередь с одним seed. Сравнивайте лицо,
              одежду, фон, движение и звук в галерее.
            </p>
            <button
              className={button}
              onClick={() => window.dispatchEvent(new Event('h3:goto-generate'))}
            >
              Открыть генерацию
            </button>
            <p className="text-xs text-amber-300">
              Аудио экспериментальное. Сохранённый голос не означает подтверждённое клонирование
              голоса; общий комплект не гарантирует синхронизацию персонажа и речи.
            </p>
            <RefModComparisons />
            <h3 className="text-sm pt-3">Журнал сборок и предпросмотров</h3>
            {jobs.map((j) => (
              <div key={j.id} className="border border-border rounded-lg p-3 text-xs">
                <p>
                  {j.kind === 'build' ? 'Сборка' : 'Предпросмотр'} · {j.status} ·{' '}
                  {j.createdAt.slice(0, 19).replace('T', ' ')}
                </p>
                {j.error && <p className="text-red-400 whitespace-pre-wrap mt-1">{j.error}</p>}
                {j.result?.tokens != null && <p>Токены: {String(j.result.tokens)}</p>}
              </div>
            ))}
          </section>
        )}
      </div>
      {maskOpen && project && source && (
        <MaskEditor
          url={sourceUrl(project, source)}
          existing={
            source.mask
              ? `/api/refmods/projects?id=${project.id}&source=${encodeURIComponent(source.mask)}`
              : undefined
          }
          onClose={() => setMaskOpen(false)}
          onSave={async (blob) => {
            const result = await upload(blob, 'mask.png', project)
            editSource({ mask: result.file })
          }}
        />
      )}
    </div>
  )
}
