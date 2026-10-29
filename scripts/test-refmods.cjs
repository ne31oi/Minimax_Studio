/* Isolated source tests: no app server, model weights or GPU required. */
const fs = require('fs'),
  path = require('path'),
  os = require('os'),
  assert = require('node:assert/strict'),
  ts = require('typescript'),
  Module = require('module')
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  )
const original = Module._resolveFilename
Module._resolveFilename = function (name, ...args) {
  return original.call(
    this,
    name.startsWith('@/') ? path.join(process.cwd(), 'src', name.slice(2)) : name,
    ...args,
  )
}
const { inspectRefMod, inside } = require('../src/lib/refmods/files.ts')
const { exportRefModMembers } = require('../src/lib/refmods/export.ts')
const {
  emptyRefModSet,
  refModTokens,
  referenceLabels,
  remapReferenceTags,
} = require('../src/lib/refmods/types.ts')
const { validateRefModSet, attachRefMods } = require('../src/lib/refmods/workflow.ts')
const { buildMiniMaxH3Workflow } = require('../src/lib/comfy/minimax-h3-template.ts')
const {
  buildRefineWorkflow,
  buildChunkedRefineWorkflow,
} = require('../src/lib/comfy/refine-template.ts')
const { buildFaceRefineWorkflow } = require('../src/lib/comfy/face-refine-template.ts')
const { buildTileUpscaleWorkflow } = require('../src/lib/comfy/tile-upscale-template.ts')
const { buildControlNetWorkflow } = require('../src/lib/comfy/controlnet-template.ts')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-refmods-test-'))
let passed = 0
function test(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.error('FAIL', name)
    throw e
  }
}
function safe(name, meta, defs = [{ key: 'latent', shape: [1, 24, 1, 4, 4] }]) {
  let size = 0
  const h = { __metadata__: { refmod_meta: JSON.stringify(meta) } }
  for (const d of defs) {
    const bytes = d.shape.reduce((a, b) => a * b, 1) * 2
    h[d.key] = { dtype: 'BF16', shape: d.shape, data_offsets: [size, size + bytes] }
    size += bytes
  }
  const raw = Buffer.from(JSON.stringify(h))
  const prefix = Buffer.alloc(8)
  prefix.writeBigUInt64LE(BigInt(raw.length))
  const file = path.join(dir, name + '.safetensors')
  fs.writeFileSync(file, Buffer.concat([prefix, raw, Buffer.alloc(size, 42)]))
  return file
}
const visual = {
  _format_version: 4,
  kind: 'image',
  name: 'Hero',
  mode: 'encode',
  latent_t: 1,
  latent_h: 4,
  latent_w: 4,
}
try {
  let standalone, bundle, entry
  test('standalone BF16 header and exact token count', () => {
    standalone = safe('hero', visual)
    entry = inspectRefMod(standalone, '0:hero.safetensors')
    assert.equal(entry.tokens, 4)
    assert.equal(entry.kind, 'image')
  })
  test('mixed v5 bundle and independent modalities', () => {
    bundle = safe(
      'bundle',
      {
        _format_version: 5,
        kind: 'bundle',
        members: [visual, { _format_version: 4, kind: 'audio', name: 'Music', latent_t: 20 }],
      },
      [
        { key: 'ref_0', shape: [1, 24, 1, 4, 4] },
        { key: 'ref_1', shape: [1, 32, 2, 20] },
      ],
    )
    assert.equal(inspectRefMod(bundle).tokens, 44)
  })
  test('export chosen BF16 member without float conversion', () => {
    const output = path.join(dir, 'export.safetensors')
    exportRefModMembers(bundle, output, [1])
    const e = inspectRefMod(output)
    assert.equal(e.members.length, 1)
    assert.equal(e.members[0].kind, 'audio')
    assert.equal(e.tokens, 40)
    const b = fs.readFileSync(output)
    const offset = 8 + Number(b.readBigUInt64LE())
    assert.ok(b.subarray(offset).every((x) => x === 42))
  })
  test('reject LoRA/ReFLora by contents', () => {
    const file = safe('lora', visual)
    const bytes = fs.readFileSync(file)
    const n = Number(bytes.readBigUInt64LE())
    const h = JSON.parse(bytes.subarray(8, 8 + n))
    delete h.__metadata__
    const raw = Buffer.from(JSON.stringify(h))
    const p = Buffer.alloc(8)
    p.writeBigUInt64LE(BigInt(raw.length))
    fs.writeFileSync(file, Buffer.concat([p, raw, bytes.subarray(n + 8)]))
    assert.throws(() => inspectRefMod(file), /не RefMod/)
  })
  test('reject truncated header and tensor payload', () => {
    const file = safe('truncated', visual)
    fs.truncateSync(file, fs.statSync(file).size - 1)
    assert.throws(() => inspectRefMod(file), /Размер тензора/)
    fs.writeFileSync(file, Buffer.alloc(3))
    assert.throws(() => inspectRefMod(file), /Обрезанный/)
  })
  test('reject malformed image shape', () => {
    const file = safe('shape', visual, [{ key: 'latent', shape: [1, 24, 2, 4, 4] }])
    assert.throws(() => inspectRefMod(file), /геометрия/)
  })
  test('reject unsupported future version', () =>
    assert.throws(() => inspectRefMod(safe('future', { ...visual, _format_version: 6 })), /версия/))
  test('legacy metadata sidecar', () => {
    const file = safe('legacy', visual)
    const bytes = fs.readFileSync(file)
    const length = Number(bytes.readBigUInt64LE())
    const h = JSON.parse(bytes.subarray(8, 8 + length))
    delete h.__metadata__
    const raw = Buffer.from(JSON.stringify(h))
    const prefix = Buffer.alloc(8)
    prefix.writeBigUInt64LE(BigInt(raw.length))
    fs.writeFileSync(file, Buffer.concat([prefix, raw, bytes.subarray(length + 8)]))
    fs.writeFileSync(file.replace('.safetensors', '.json'), JSON.stringify(visual))
    assert.equal(inspectRefMod(file).tokens, 4)
  })
  test('path traversal rejected', () => assert.throws(() => inside(dir, '../outside'), /пределы/))
  const set = emptyRefModSet()
  set.items = [
    {
      id: 'hero',
      entryId: '0:hero.safetensors',
      name: 'Hero',
      fingerprint: entry.fingerprint,
      members: inspectRefMod(bundle).members,
      enabled: true,
      strength: 1,
      visualStrength: 1,
      audioStrength: 1,
      copies: 2,
      components: 'All',
    },
  ]
  test('copies and modality budget', () => {
    assert.equal(refModTokens(set), 88)
    assert.equal(refModTokens(set, false), 8)
    assert.equal(refModTokens({ ...set, items: [{ ...set.items[0], strength: 0 }] }), 0)
  })
  test('zero master retention and zero single-frame cap remove labels and budget', () => {
    const off={...set,retention:0}
    assert.equal(refModTokens(off),0)
    assert.equal(referenceLabels([],off).length,0)
    const capped={...set,frameCurve:{direction:'concept_at_end',shape:'linear',value:0}}
    assert.deepEqual(referenceLabels([],capped).map(l=>l.kind),['audio','audio'])
    assert.equal(refModTokens(capped),80)
  })
  test('reject NaN, invalid copies, duplicate IDs and curves', () => {
    for (const patch of [{ strength: NaN }, { copies: 1.5 }, { copies: 9 }, { enabled: 'false' }])
      assert.throws(() => validateRefModSet({ ...set, items: [{ ...set.items[0], ...patch }] }))
    assert.throws(() => validateRefModSet({ ...set, items: [set.items[0], set.items[0]] }))
    assert.throws(() =>
      validateRefModSet({ ...set, stepCurve: { direction: 'bad', shape: 'linear', value: 1 } }),
    )
  })
  const raw = [
    { id: 'pic', name: 'Scene', kind: 'image' },
    { id: 'video', name: 'Clip', kind: 'video', includeAudio: true },
    { id: 'audio', name: 'Sound', kind: 'audio' },
  ]
  test('authoritative raw/saved labels including video soundtrack', () => {
    const m = referenceLabels(raw, set)
    assert.deepEqual(
      m.map((x) => x.trigger),
      [
        '<Picture 1>',
        '<Audio 1>',
        '<Video 1>',
        '<Audio 2>',
        '<Picture 2>',
        '<Picture 3>',
        '<Audio 3>',
        '<Audio 4>',
      ],
    )
    assert.equal(new Set(m.map((x) => x.id)).size, m.length)
  })
  test('atomic tag remapping preserves identity on reorder/removal', () => {
    const a = referenceLabels(raw, set)
    const b = referenceLabels(
      raw.filter((r) => r.id !== 'pic'),
      set,
    )
    assert.equal(
      remapReferenceTags('<Picture 2> next to <Picture 1>', a, b),
      '<Picture 1> next to ',
    )
    assert.equal(
      remapReferenceTags(
        '<Picture 1> <Picture 2>',
        [
          { id: 'a', trigger: '<Picture 1>' },
          { id: 'b', trigger: '<Picture 2>' },
        ],
        [
          { id: 'b', trigger: '<Picture 1>' },
          { id: 'a', trigger: '<Picture 2>' },
        ],
      ),
      '<Picture 2> <Picture 1>',
    )
  })
  const resolved = { ...set, files: {}, versions: {} }
  const base = {
    prompt: 'A quiet room',
    refImages: [],
    aspectRatio: '16:9',
    duration: 2.5,
    seed: 42,
    sparseAttention: false,
  }
  test('empty/disabled set preserves graph identity', () => {
    const g = buildMiniMaxH3Workflow(base)
    assert.equal(attachRefMods(g), g)
    assert.equal(attachRefMods(g, { ...resolved, items: [] }), g)
  })
  for (const mode of ['ref', 't2v', 'flf', 'extend'])
    for (const pipeline of ['draft', 'full'])
      test(`${mode}/${pipeline}: connect every H3 branch once`, () => {
        const g = buildMiniMaxH3Workflow({
          ...base,
          mode,
          pipeline,
          firstFrame: 'start.png',
          lastFrame: 'end.png',
          extendClips: [{ prompt: 'Continue', duration: 2.5, seed: 42 }],
          extendRefs: [],
        })
        const copy = JSON.stringify(g)
        const out = attachRefMods(g, resolved)
        assert.equal(JSON.stringify(g), copy)
        const before = Object.values(g).filter((n) =>
          /MiniMaxH3(Reference|Image)ToVideo/.test(n.class_type),
        ).length
        assert.ok(before > 0)
        assert.equal(
          Object.values(out).filter((n) =>
            /StudioH3RefMod(Reference|Image)ToVideo/.test(n.class_type),
          ).length,
          before,
        )
        assert.equal(
          Object.values(out).filter((n) => n.class_type === 'StudioH3RefModLoad').length,
          1,
        )
        assert.throws(() => attachRefMods(out, resolved), /Повторное/)
      })
  for (const [name, builder, params] of [
    ['controlnet',buildControlNetWorkflow,{sourceVideo:'test.mp4',sourceWidth:512,sourceHeight:512,sourceFrames:124,controlType:'direct'}],
    [
      'refine',
      buildRefineWorkflow,
      { sourceVideo: 'test.mp4', sourceWidth: 512, sourceHeight: 512, sourceFrames: 124 },
    ],
    ['face-refine', buildFaceRefineWorkflow, { sourceVideo: 'test.mp4' }],
    [
      'tile-upscale',
      buildTileUpscaleWorkflow,
      { sourceVideo: 'test.mp4', sourceWidth: 512, sourceHeight: 512, sourceFrames: 124 },
    ],
  ])
    test(name + ': conditioning transformed', () => {
      const graph = builder(params)
      const out = attachRefMods(graph, resolved)
      assert.ok(Object.values(out).some((n) => n.class_type.startsWith('StudioH3RefMod')))
    })
  test('chunked refine transforms every window and retains native window anchors',()=>{
    const graph=buildChunkedRefineWorkflow({sourceVideo:'test.mp4',sourceWidth:512,sourceHeight:512,sourceFrames:260,targetShortSide:'same',chunkSeconds:3})
    const before=Object.values(graph).filter(n=>n.class_type==='MiniMaxH3ReferenceToVideo')
    assert.ok(before.length>1)
    const out=attachRefMods(graph,resolved)
    const after=Object.values(out).filter(n=>n.class_type==='StudioH3RefModReferenceToVideo')
    assert.equal(after.length,before.length)
    assert.deepEqual(after.map(n=>n.inputs.ref_images),before.map(n=>n.inputs.ref_images))
  })
  test('tile sampler receives the shared step curve',()=>{
    const graph=buildTileUpscaleWorkflow({sourceVideo:'test.mp4',sourceWidth:512,sourceHeight:512,sourceFrames:124})
    const out=attachRefMods(graph,{...resolved,stepCurve:{direction:'concept_at_start',shape:'ease',value:0.7}})
    const sampler=Object.values(out).find(n=>n.class_type==='MMH3UltimateUpscale'||n.class_type==='MMH3UltimateUpscaleSync')
    assert.ok(sampler)
    assert.equal(out[sampler.inputs.model[0]].class_type,'MiniMaxH3RefModStepCurve')
  })
  test('step curve on each guider and original graph untouched', () => {
    const graph = buildMiniMaxH3Workflow({ ...base, mode: 'ref' })
    const out = attachRefMods(graph, {
      ...resolved,
      stepCurve: { direction: 'concept_at_start', shape: 'ease', value: 0.7 },
    })
    const guiders = Object.values(out).filter((n) => n.class_type === 'BasicGuider')
    assert.equal(guiders.length, 2)
    for (const g of guiders)
      assert.equal(out[g.inputs.model[0]].class_type, 'MiniMaxH3RefModStepCurve')
    assert.ok(!Object.keys(graph).some((k) => k.startsWith('studio_refmods')))
  })
  console.log(`${passed} RefMod checks passed`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
