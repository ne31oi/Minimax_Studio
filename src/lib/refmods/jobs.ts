import fs from 'fs'
import path from 'path'
import { atomicJson, refModDataDir, refModLibrary } from './files'
import { projectDir, readProject, validateProject } from './projects'
import { COMFY_URL, submitWorkflowJson } from '../comfy/minimax-h3-client'
import { runGeneration } from '../vram-arbiter'
import { resolveRefModSet } from './resolve'
import { activeSetMembers, emptyRefModSet, type RefModJob, type RefModSet, type RefModProject } from './types'
function jobsDir() {
  const dir = path.join(refModDataDir(), 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
function jobFile(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Некорректный ID задачи')
  return path.join(jobsDir(), `${id}.json`)
}
export function readRefModJob(id: string): RefModJob {
  return JSON.parse(fs.readFileSync(jobFile(id), 'utf8'))
}
export function listRefModJobs(): RefModJob[] {
  return fs
    .readdirSync(jobsDir())
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      try {
        return [readRefModJob(f.slice(0, -5))]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
}
export async function refreshRefModJob(id: string): Promise<RefModJob> {
  const job = readRefModJob(id)
  if (['done', 'error', 'cancelled'].includes(job.status)) return job
  const hist = await fetch(`${COMFY_URL}/history/${job.promptId}`, {
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json())
  const entry = hist[job.promptId]
  if (entry) {
    if (entry.status?.status_str === 'error') {
      job.status = 'error'
      job.error = JSON.stringify(
        entry.status.messages?.find((m: unknown[]) => m[0] === 'execution_error')?.[1] ||
          'ComfyUI: ошибка RefMod',
      ).slice(0, 1500)
    } else if (entry.status?.completed) {
      const output = Object.values(entry.outputs || {}).find(
        (o) => !!(o as { studio_refmod?: unknown }).studio_refmod,
      ) as { studio_refmod?: Record<string, unknown>[] } | undefined
      if (!output?.studio_refmod?.[0]) {
        job.status = 'error'
        job.error = 'ComfyUI завершил задачу без результата RefMod'
      } else {
        job.status = 'done'
        job.result = output.studio_refmod[0]
      }
    }
  } else {
    const q = await fetch(`${COMFY_URL}/queue`, { signal: AbortSignal.timeout(8000) }).then((r) =>
      r.json(),
    )
    const running = q.queue_running?.some((r: unknown[]) => r[1] === job.promptId)
    const queued = q.queue_pending?.some((r: unknown[]) => r[1] === job.promptId)
    if (running) job.status = 'running'
    else if (queued) job.status = 'queued'
    else if (Date.now() - Date.parse(job.createdAt) > (job.status === 'submitting' ? 120000 : 15000)) {
      job.status = 'error'
      job.error = 'Задача RefMod отсутствует в ComfyUI после перезапуска или отмены'
    }
  }
  const latest = readRefModJob(id)
  if (['done', 'error', 'cancelled'].includes(latest.status)) return latest
  if (job.status === 'done' && job.kind === 'build' && job.projectId) {
    const project = readProject(job.projectId)
    if (!project.builds.some((b) => b.promptId === job.promptId)) {
      const name = String(job.result?.name || '')
      const entry = refModLibrary().entries.find((e) => e.id === `0:${name}`)
      project.builds.push({
        name,
        entryId: entry?.id,
        createdAt: new Date().toISOString(),
        promptId: job.promptId,
        tokens: Number(job.result?.tokens) || undefined,
      })
      project.updatedAt = new Date().toISOString()
      atomicJson(path.join(projectDir(project.id), 'project.json'), project)
    }
  }
  atomicJson(jobFile(id), job)
  return job
}
// A client token names the journal before submission. A pending record prevents duplicate GPU work on retries.
export async function submitRefModJob(body: {
  kind: 'build' | 'preview'
  projectId?: string
  project?: RefModProject
  set?: RefModSet
  fullVideo?: boolean
  clientToken: string
}): Promise<RefModJob> {
  if (
    !body ||
    !['build', 'preview'].includes(body.kind) ||
    !/^[-a-zA-Z0-9_]{1,100}$/.test(body.clientToken)
  )
    throw new Error('Некорректная задача RefMod')
  const id = body.clientToken
  const file = jobFile(id)
  if (fs.existsSync(file)) {
    const existing = readRefModJob(id)
    if (existing.promptId) return existing
    throw new Error('Отправка этой задачи уже началась. Проверьте очередь перед повтором.')
  }
  const job: RefModJob = {
    id,
    kind: body.kind,
    projectId: body.projectId,
    promptId: crypto.randomUUID(),
    clientToken: id,
    status: 'submitting',
    createdAt: new Date().toISOString(),
    snapshot: { project: body.project, set: body.set, fullVideo: body.fullVideo },
  }
  // wx makes concurrent submissions with the same token mutually exclusive.
  fs.writeFileSync(file, JSON.stringify(job), { flag: 'wx' })
  try {
    const graph: Record<string, unknown> = {}
    const info = await fetch(`${COMFY_URL}/object_info/StudioH3RefModBuild`, {
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.json())
    if (!info.StudioH3RefModBuild)
      throw new Error('RefMod-ноды не загружены. Перезапустите ComfyUI после установки пакета.')
    if (body.kind === 'build') {
      if (!body.projectId) throw new Error('Не выбран проект')
      const stored = readProject(body.projectId)
      const project = body.project || stored
      if (project.id !== stored.id) throw new Error('Проект не совпадает со снимком задачи')
      validateProject(project)
      if (!project.sources.length) throw new Error('Добавьте исходники')
      job.snapshot = { project }
      for (const source of project.sources) {
        if (!fs.existsSync(path.join(projectDir(project.id), source.file)))
          throw new Error(`Исходник «${source.name}» отсутствует`)
      }
      const output = `studio/${project.id}/${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(-8)}`
      job.outputName = output
      graph.build = {
        class_type: 'StudioH3RefModBuild',
        inputs: {
          project: JSON.stringify({ ...project, directory: projectDir(project.id) }),
          output_name: output,
        },
      }
      const inputs = (graph.build as { inputs: Record<string, unknown> }).inputs
      if (project.sources.some((s) => s.kind !== 'audio')) {
        graph.vae = {
          class_type: 'VAELoader',
          inputs: { vae_name: 'minimax_h3_video_vae_int8_convrot.safetensors' },
        }
        inputs.vae = ['vae', 0]
      }
      if (project.sources.some((s) => s.kind === 'audio' || s.includeAudio)) {
        graph.audio_vae = {
          class_type: 'VAELoader',
          inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' },
        }
        inputs.audio_vae = ['audio_vae', 0]
      }
    } else {
      const set = await resolveRefModSet(body.set || emptyRefModSet(), 'generate')
      if (!set.items.some((item) => activeSetMembers(set, item).length))
        throw new Error('Выберите активные компоненты для предпросмотра')
      job.entryId = set.items[0]?.entryId
      graph.preview = {
        class_type: 'StudioH3RefModPreview',
        inputs: { settings: JSON.stringify(set), full_video: body.fullVideo === true },
      }
      const input = (graph.preview as { inputs: Record<string, unknown> }).inputs
      if (set.items.some((i) => activeSetMembers(set, i).some((m) => m.kind !== 'audio'))) {
        graph.vae = {
          class_type: 'VAELoader',
          inputs: { vae_name: 'minimax_h3_video_vae_int8_convrot.safetensors' },
        }
        input.vae = ['vae', 0]
      }
      if (set.items.some((i) => activeSetMembers(set, i).some((m) => m.kind === 'audio'))) {
        graph.audio_vae = {
          class_type: 'VAELoader',
          inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' },
        }
        input.audio_vae = ['audio_vae', 0]
      }
    }
    const run = await runGeneration(async () => {
      if (readRefModJob(id).status === 'cancelled') throw new Error('Задача отменена')
      return submitWorkflowJson(graph, undefined, undefined, { promptId: job.promptId })
    })
    if (!run.ok) throw new Error(run.error)
    job.promptId = run.result.prompt_id
    if (readRefModJob(id).status === 'cancelled') {
      await cancelPrompt(job.promptId)
      return readRefModJob(id)
    }
    job.status = 'queued'
    atomicJson(file, job)
    return job
  } catch (e) {
    if (readRefModJob(id).status === 'cancelled') return readRefModJob(id)
    // A lost POST response is ambiguous. Keep the preassigned ID for recovery;
    // retries reuse this journal rather than sending a second GPU task.
    if (e instanceof Error && e.message.includes('ComfyUI не отвечает на')) {
      job.error = 'Нет подтверждения отправки. Проверяем очередь ComfyUI по сохранённому ID.'
      atomicJson(file, job)
      return job
    }
    job.status = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    atomicJson(file, job)
    throw e
  }
}
export async function cancelRefModJob(id: string): Promise<RefModJob> {
  const job = readRefModJob(id)
  if (['done', 'error', 'cancelled'].includes(job.status)) return job
  job.status = 'cancelled'
  atomicJson(jobFile(id), job)
  await cancelPrompt(job.promptId)
  return job
}
async function cancelPrompt(promptId: string): Promise<void> {
  const q = await fetch(`${COMFY_URL}/queue`, { signal: AbortSignal.timeout(8000) }).then((r) =>
    r.json(),
  )
  if (q.queue_running?.some((r: unknown[]) => r[1] === promptId))
    await fetch(`${COMFY_URL}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    })
  else
    await fetch(`${COMFY_URL}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    })
}
