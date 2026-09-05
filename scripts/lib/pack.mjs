import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export function packRoads (lines) {
  let segmentCount = 0
  for (const l of lines) segmentCount += Math.max(0, l.enu.length - 1)

  const positions = new Float32Array(segmentCount * 6)
  const segIds = new Float32Array(segmentCount)
  const index = new Uint32Array(lines.length + 1)

  let s = 0
  for (let i = 0; i < lines.length; i++) {
    index[i] = s
    const pts = lines[i].enu
    for (let k = 1; k < pts.length; k++) {
      const [e1, n1, u1] = pts[k - 1]
      const [e2, n2, u2] = pts[k]
      const o = s * 6
      positions[o]     = e1; positions[o + 1] = u1; positions[o + 2] = -n1
      positions[o + 3] = e2; positions[o + 4] = u2; positions[o + 5] = -n2
      segIds[s] = i
      s++
    }
  }
  index[lines.length] = s
  return { positions, segIds, index, segmentCount }
}

export async function writeBin (path, typedArray) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(
    typedArray.buffer, typedArray.byteOffset, typedArray.byteLength,
  ))
}
