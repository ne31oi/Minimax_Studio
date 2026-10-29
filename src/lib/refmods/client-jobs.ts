'use client'
import { useGenQueue } from '../gen-queue-store'
import { acquireComfyTurn, isComfyTurnActive } from '../comfy-turn'
import type { RefModJob, RefModSet, RefModProject } from './types'
type RequestBody = {
  kind: 'build' | 'preview'
  projectId?: string
  project?: RefModProject
  set?: RefModSet
  fullVideo?: boolean
  clientToken: string
}
const running = new Set<string>()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
export async function refModRequest<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`)
  return data as T
}
export function enqueueRefModJob(body: Omit<RequestBody, 'clientToken'>, label: string): string {
  const q = useGenQueue.getState()
  const id = q.enqueue(body.kind === 'build' ? 'refmod-build' : 'refmod-preview', label)
  const clientToken = crypto.randomUUID()
  q.setClientToken(id, clientToken)
  localStorage.setItem(`h3-refmod-request:${clientToken}`, JSON.stringify({ ...body, clientToken }))
  void run(id)
  return id
}
export function resumeRefModJobs() {
  for (const item of useGenQueue.getState().items)
    if (
      ['refmod-build', 'refmod-preview'].includes(item.type) &&
      ['submitting', 'queued', 'running'].includes(item.status)
    )
      void run(item.id)
}
export async function cancelRefModQueueItem(id: string) {
  const q = useGenQueue.getState()
  const item = q.items.find((i) => i.id === id)
  if (!item) return
  q.setStatus(id, 'cancelled')
  if (item.clientToken) {
    localStorage.removeItem(`h3-refmod-request:${item.clientToken}`)
    if (item.promptId)
      await refModRequest('/api/refmods/jobs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.clientToken }),
      })
  }
}
async function run(id: string) {
  if (running.has(id)) return
  running.add(id)
  const q = () => useGenQueue.getState()
  let job: RefModJob | undefined
  try {
    const item = q().items.find((i) => i.id === id)
    if (!item?.clientToken) throw new Error('Не найден журнал задачи RefMod')
    if (item.promptId) {
      job = (
        await refModRequest<{ job: RefModJob }>(
          `/api/refmods/jobs?id=${encodeURIComponent(item.clientToken)}`,
        )
      ).job
    } else {
      if (!(await acquireComfyTurn(id)) || !isComfyTurnActive(id)) return
      const raw = localStorage.getItem(`h3-refmod-request:${item.clientToken}`)
      if (!raw) throw new Error('Не найдены параметры задачи RefMod')
      const body = JSON.parse(raw) as RequestBody
      job = (
        await refModRequest<{ job: RefModJob }>('/api/refmods/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).job
      q().setPromptId(id, job.promptId)
    }
    let failures = 0
    while (job) {
      const current = q().items.find((i) => i.id === id)
      if (!current || current.status === 'cancelled') {
        await refModRequest('/api/refmods/jobs', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id }),
        })
        break
      }
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
        q().setStatus(id, job.status, job.error)
        localStorage.removeItem(`h3-refmod-request:${job.clientToken}`)
        window.dispatchEvent(new Event('h3:refmods-changed'))
        break
      }
      q().setStatus(id, job.status)
      q().setMessage(
        id,
        job.kind === 'build' ? 'Кодирование референсов' : 'Декодирование сохранённого содержимого',
      )
      await wait(2500)
      try {
        job = (
          await refModRequest<{ job: RefModJob }>(
            `/api/refmods/jobs?id=${encodeURIComponent(job.id)}`,
          )
        ).job
        failures = 0
      } catch (e) {
        if (++failures >= 12) throw e
      }
    }
  } catch (e) {
    q().setStatus(id, 'error', e instanceof Error ? e.message : String(e))
  } finally {
    running.delete(id)
  }
}
