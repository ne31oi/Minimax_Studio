import fs from 'fs'
import { inspectRefMod } from './files'
/** Repackages selected latent byte ranges without decoding or converting BF16. */
export function exportRefModMembers(source: string, destination: string, indices: number[]): void {
  const entry = inspectRefMod(source)
  if (
    !indices.length ||
    new Set(indices).size !== indices.length ||
    indices.some((i) => !entry.members.some((m) => m.index === i))
  )
    throw new Error('Выберите существующие компоненты для экспорта')
  const input = fs.openSync(source, 'r')
  let output: number | undefined
  try {
    const length = Buffer.alloc(8)
    fs.readSync(input, length, 0, 8, 0)
    const size = Number(length.readBigUInt64LE())
    const bytes = Buffer.alloc(size)
    fs.readSync(input, bytes, 0, size, 8)
    const old = JSON.parse(bytes.toString('utf8'))
    let meta = JSON.parse(
      old.__metadata__?.refmod_meta || old.__metadata__?.audio_refmod_meta || 'null',
    )
    if (!meta) meta = JSON.parse(fs.readFileSync(source.replace(/\.safetensors$/, '.json'), 'utf8'))
    const members = meta.kind === 'bundle' ? meta.members : [meta]
    const next: Record<string, unknown> = {}
    const ranges: Array<[number, number]> = []
    let offset = 0
    indices.forEach((index, n) => {
      const tensor = old[entry.kind === 'bundle' ? `ref_${index}` : 'latent']
      const [a, b] = tensor.data_offsets
      ranges.push([a, b])
      next[`ref_${n}`] = {
        dtype: tensor.dtype,
        shape: tensor.shape,
        data_offsets: [offset, offset + b - a],
      }
      offset += b - a
    })
    next.__metadata__ = {
      refmod_meta: JSON.stringify({
        _format_version: 5,
        kind: 'bundle',
        name: entry.name,
        members: indices.map((i) => members[i]),
      }),
    }
    let text = JSON.stringify(next)
    text += ' '.repeat((8 - (Buffer.byteLength(text) % 8)) % 8)
    const header = Buffer.from(text)
    const prefix = Buffer.alloc(8)
    prefix.writeBigUInt64LE(BigInt(header.length))
    output = fs.openSync(destination, 'wx')
    fs.writeSync(output, prefix)
    fs.writeSync(output, header)
    const buffer = Buffer.alloc(1024 * 1024)
    for (const [a, b] of ranges) {
      let position = a
      while (position < b) {
        const count = fs.readSync(
          input,
          buffer,
          0,
          Math.min(buffer.length, b - position),
          8 + size + position,
        )
        if (!count) throw new Error('Обрезанный тензор')
        fs.writeSync(output, buffer, 0, count)
        position += count
      }
    }
  } finally {
    fs.closeSync(input)
    if (output !== undefined) fs.closeSync(output)
  }
}
