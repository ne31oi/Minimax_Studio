/* Request races and recovery use an isolated journal and a fake ComfyUI transport. */
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  Module = require('module')
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  )
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refmod-journal-test-'))
const project = {
  id: 'project',
  name: 'Test',
  sources: [{ file: 'source.png', kind: 'image' }],
  builds: [],
  updatedAt: 'original',
}
fs.writeFileSync(path.join(dir, 'source.png'), 'fixture')
let submit,
  transport,
  submits = 0,
  deletes = 0
const atomicJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(v))
}
const original = Module._load
Module._load = function (name, parent, ...rest) {
  if (parent?.filename.endsWith(path.join('refmods', 'jobs.ts'))) {
    if (name === './files')
      return { atomicJson, refModDataDir: () => dir, refModLibrary: () => ({ entries: [] }) }
    if (name === './projects')
      return { projectDir: () => dir, readProject: () => project, validateProject: () => {} }
    if (name === '../comfy/minimax-h3-client')
      return {
        COMFY_URL: 'http://fake-comfy',
        submitWorkflowJson: async (...a) => {
          submits++
          return submit(...a)
        },
      }
    if (name === '../vram-arbiter')
      return {
        runGeneration: async (fn) => {
          try {
            return { ok: true, result: await fn() }
          } catch (e) {
            return { ok: false, error: e.message }
          }
        },
      }
    if (name === './resolve')
      return { resolveRefModSet: async (s) => ({ ...s, files: {}, versions: {} }) }
  }
  return original.call(this, name, parent, ...rest)
}
global.fetch = async (url, init) => {
  const value = await transport(url, init)
  return { json: async () => value }
}
const jobs = require('../src/lib/refmods/jobs.ts')
const deferred = () => {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}
const request = (id) => ({ kind: 'build', projectId: 'project', clientToken: id })
const read = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'jobs', id + '.json'), 'utf8'))
let passed = 0
async function test(name, fn) {
  await fn()
  console.log('PASS', name)
  passed++
}
;(async () => {
  try {
    await test('pending submission is idempotent and does not expire while POST is in flight', async () => {
      let gate = deferred(),
        started = deferred()
      submit = async (g, s, t, o) => {
        started.resolve()
        await gate.promise
        return { prompt_id: o.promptId }
      }
      transport = (url, init) =>
        url.includes('object_info')
          ? { StudioH3RefModBuild: {} }
          : url.endsWith('/queue')
            ? init?.method === 'POST'
              ? (deletes++, {})
              : { queue_running: [], queue_pending: [] }
            : {}
      const pending = jobs.submitRefModJob(request('pending'))
      await started.promise
      let j = read('pending')
      j.createdAt = new Date(Date.now() - 30000).toISOString()
      atomicJson(path.join(dir, 'jobs', 'pending.json'), j)
      assert.equal((await jobs.refreshRefModJob('pending')).status, 'submitting')
      assert.equal((await jobs.submitRefModJob(request('pending'))).promptId, j.promptId)
      assert.equal(submits, 1)
      await jobs.cancelRefModJob('pending')
      gate.resolve()
      await pending
      assert.equal(read('pending').status, 'cancelled')
      assert.equal(deletes, 2)
    })
    await test('history completion cannot resurrect a concurrently cancelled job', async () => {
      const history = deferred()
      let fetching = deferred()
      const j = { ...read('pending'), id: 'race', status: 'running' }
      atomicJson(path.join(dir, 'jobs', 'race.json'), j)
      transport = async (url, init) => {
        if (url.includes('/history/')) {
          fetching.resolve()
          await history.promise
          return {
            [j.promptId]: {
              status: { completed: true },
              outputs: { build: { studio_refmod: [{ name: 'test' }] } },
            },
          }
        }
        return init ? {} : { queue_running: [], queue_pending: [] }
      }
      const refresh = jobs.refreshRefModJob('race')
      await fetching.promise
      await jobs.cancelRefModJob('race')
      history.resolve()
      assert.equal((await refresh).status, 'cancelled')
      assert.equal(project.builds.length, 0)
    })
    await test('lost POST response preserves preassigned ID without a duplicate submission', async () => {
      transport = (url) => (url.includes('object_info') ? { StudioH3RefModBuild: {} } : {})
      submit = async () => {
        throw Error('ComfyUI не отвечает на http://fake-comfy')
      }
      const first = await jobs.submitRefModJob(request('ambiguous'))
      const count = submits
      assert.equal(first.status, 'submitting')
      assert.ok(first.promptId)
      const retry = await jobs.submitRefModJob(request('ambiguous'))
      assert.equal(retry.promptId, first.promptId)
      assert.equal(submits, count)
    })
    await test('completed build survives restart and is registered only once', async () => {
      const j = read('ambiguous')
      transport = () => ({
        [j.promptId]: {
          status: { completed: true },
          outputs: { build: { studio_refmod: [{ name: 'test.safetensors', tokens: 20 }] } },
        },
      })
      assert.equal((await jobs.refreshRefModJob('ambiguous')).status, 'done')
      await jobs.refreshRefModJob('ambiguous')
      assert.equal(project.builds.length, 1)
    })
    await test('missing prompt after backend restart becomes an explicit error', async () => {
      const j = {
        ...read('pending'),
        id: 'missing',
        status: 'queued',
        createdAt: new Date(Date.now() - 60000).toISOString(),
      }
      atomicJson(path.join(dir, 'jobs', 'missing.json'), j)
      transport = (url) => (url.includes('/queue') ? { queue_running: [], queue_pending: [] } : {})
      assert.equal((await jobs.refreshRefModJob('missing')).status, 'error')
    })
    console.log(passed + ' journal checks passed')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
