/* Assistant context and reference identity checks; no server, LLM or GPU. */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const ts = require('typescript')
const path = require('node:path')
const Module = require('node:module')
const resolve = Module._resolveFilename
Module._resolveFilename = function(name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(process.cwd(), 'src', name.slice(2)) : name, ...args)
}
require.extensions['.ts'] = (module, file) => {
  let source = fs.readFileSync(file, 'utf8')
  if (file.endsWith('assistant-stream.ts')) source += '\nexport { buildSystemMessage, getReferences }'
  module._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, file)
}
require.extensions['.md'] = (module, file) => { module.exports = fs.readFileSync(file, 'utf8') }
// Persist middleware uses this isolated in-memory storage, never Studio user data.
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const { useGenStore } = require('../src/lib/gen-store.ts')
const { useRefMods } = require('../src/lib/refmods/store.ts')
const { useControlNetTarget } = require('../src/lib/controlnet-target-store.ts')
const { emptyRefModSet, referenceLabels } = require('../src/lib/refmods/types.ts')
const { refModAssistantState } = require('../src/lib/refmods/assistant-context.ts')
const { remapAssistantReferences, MISSING_ASSISTANT_REFERENCE } = require('../src/lib/refmods/assistant-references.ts')
const { buildSystemMessage, getReferences } = require('../src/lib/assistant-stream.ts')
const fixture = () => ({ ...emptyRefModSet(), items: [{
  id: 'saved', entryId: 'test', name: 'Hero kit', fingerprint: 'v1', enabled: true,
  strength: 0.7, visualStrength: 0.8, audioStrength: 0.6, copies: 2, components: 'All',
  members: [
    { index: 0, name: 'Hero', kind: 'image', tokens: 100, shape: [1,24,1,4,4], mode: 'encode', description: 'red coat' },
    { index: 1, name: 'Voice', kind: 'audio', tokens: 50, shape: [1,8,4], mode: 'training', description: 'spoken reference' },
  ],
}] })
;(async () => {
  for (const target of ['generate','extend','controlnet']) useRefMods.getState().set(target, fixture())
  useGenStore.getState().patchVideo({ mode: 'ref', refs: [], audioGuide: false })
  let state = refModAssistantState('generate')
  let system = await buildSystemMessage(true, 'generate', undefined, state)
  assert(system.includes('FORMAT B: шесть полей'))
  assert(!system.includes('Прикреплённых референсов НЕТ'))
  assert(system.includes('red coat') && system.includes('strength'))
  assert.equal(getReferences('generate', state).length, 0, 'latent files must not be vision attachments')
  for (const mode of ['t2v', 'flf']) {
    useGenStore.getState().patchVideo({ mode })
    system = await buildSystemMessage(true, 'generate')
    assert(system.includes('реальные метки RefMods разрешены'))
    assert(!system.includes('Метки <Picture N>/<Video N>/<Subject N> ЗАПРЕЩЕНЫ'))
  }
  const raw = [
    { id: 'vid', kind: 'video', path: 'motion.mp4', name: 'motion', includeAudio: true, hasAudio: true },
    { id: 'aud', kind: 'audio', path: 'sound.wav', name: 'sound' },
  ]
  useGenStore.getState().patchVideo({ mode: 'ref', refs: raw })
  state = refModAssistantState('generate')
  assert.equal(getReferences('generate', state).find(r => r.kind === 'audio').trigger, 'Audio 2')
  assert.equal(state.labels.find(l => l.id === 'saved:1:0').trigger, '<Audio 3>')
  const before = referenceLabels([], fixture())
  const after = referenceLabels([{ id: 'new', kind: 'image', name: 'new' }], fixture())
  assert.equal(remapAssistantReferences('<Picture 1> and <Audio 1>', before, after), '<Picture 2> and <Audio 1>')
  assert(remapAssistantReferences('<Picture 1>', before, []).includes(MISSING_ASSISTANT_REFERENCE))
  useGenStore.getState().patchVideo({ extendSourceVideoPath: 'source.mp4', extendSourceName: '', extendImageRefs: [], extendClips: [{ prompt: '', duration: 3 }, { prompt: '', duration: 3 }] })
  const ext = refModAssistantState('extend')
  system = await buildSystemMessage(true, 'extend', undefined, ext)
  assert(!system.includes('РЕФЕРЕНСОВ ПРОДЛЕНИЯ НЕТ'))
  assert(system.includes('Карта RefMods для clip: 2'))
  assert(system.includes('<Picture 3> = "Hero kit · Hero"'))
  const extAfter = referenceLabels([{id:'native-extension-anchor',kind:'image'},{id:'extra',kind:'image'}],fixture())
  assert.equal(remapAssistantReferences('clip: 2\n<Picture 3>', ext.labels, extAfter), 'clip: 2\n<Picture 4>')
  useControlNetTarget.setState({ source: null, refImages: [] })
  system = await buildSystemMessage(false, 'controlnet')
  assert(!system.includes('Изображений-референсов НЕТ'))
  assert(!system.includes('аудио-рефов здесь НЕТ'))
  assert(!system.includes('Другие метки <Video N> ЗАПРЕЩЕНЫ'))
  useRefMods.getState().set('generate', emptyRefModSet())
  useGenStore.getState().patchVideo({ mode: 't2v', refs: [] })
  system = await buildSystemMessage(false, 'generate')
  assert(system.includes('Прикреплённых референсов НЕТ'))
  const { sourceRefModLabels, refineRefModPrompt } = require('../src/lib/refmods/refine.ts')
  const { sanitizeDraftPrompt } = require('../src/lib/refine-meta.ts')
  const { buildRefineWorkflow, buildChunkedRefineWorkflow } = require('../src/lib/comfy/refine-template.ts')
  const visualSet = fixture()
  visualSet.items[0].copies = 1
  visualSet.items[0].members.push({ index: 2, name: 'Motion', kind: 'video', tokens: 100, shape: [1,24,7,4,4], mode: 'encode', description: 'movement' })
  const sourceMap = referenceLabels([{kind:'image'},{kind:'image'},{kind:'video'}], visualSet)
  const sourceLabels = sourceRefModLabels({refmod_reference_maps:{conditioning:[sourceMap]}},visualSet)
  assert.equal(sourceLabels.find(l => l.kind === 'image').trigger, '<Picture 3>')
  assert.equal(sourceLabels.find(l => l.kind === 'video').trigger, '<Video 2>')
  const bindings = { source: sourceLabels, set: visualSet }
  const caption = sanitizeDraftPrompt('detailed_description: <Picture 3> walks like <Video 2>, not <Video 1>.\noverall_soundscape: <Audio 1>', ['<Video 2>'])
  assert(caption.includes('<Video 2>') && !caption.includes('<Video 1>') && !caption.includes('<Audio'))
  assert(refineRefModPrompt(caption, bindings, 1).includes('<Picture 2>'))
  assert(refineRefModPrompt(caption, bindings, 0).includes('<Picture 1>'))
  const base = {sourceVideo:'sample.mp4',sourceWidth:512,sourceHeight:512,sourceFrames:124,targetShortSide:'same',prompt:caption,refModBindings:bindings,seed:7}
  for (const sourceLatent of [undefined, 'sample.latent']) {
    const whole = buildRefineWorkflow({...base,sourceLatent})
    const cond = Object.values(whole).find(n=>n.class_type==='MiniMaxH3ReferenceToVideo')
    const expected = sourceLatent ? '<Picture 1>' : '<Picture 2>'
    assert(cond.inputs.prompt.includes(expected+' walks like <Video 1>'))
    if (sourceLatent) assert(!cond.inputs.prompt.includes('is the first frame'))
    const chunks = buildChunkedRefineWorkflow({...base,sourceLatent,sourceFrames:260,chunkSeconds:3})
    const conditions = Object.values(chunks).filter(n=>n.class_type==='MiniMaxH3ReferenceToVideo')
    assert(conditions.length > 1)
    assert(conditions.every(n=>n.inputs.prompt.includes(expected+' is a saved visual reference')))
    assert(conditions.every(n=>n.inputs.prompt.includes('<Video 1> is a saved visual reference')))
  }
  console.log('PASS: assistant formats, metadata, audio numbering, clip maps, identity remapping, missing references and empty sets')
  console.log('PASS: Refine source maps, visual video tags, native anchors, lossless path and all chunk windows')
})().catch(error => { console.error(error); process.exitCode = 1 })
