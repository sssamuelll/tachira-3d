import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { makeEnuFrame } from './lib/enu.mjs'
import { auditBridgeJoins, compareBridgeBakes } from './lib/bridge-join-audit.mjs'

// Antes de regenerar: copiar roads-{pos,index,segid,nrm}.bin,
// roads-{meta,structures}.json y terrain.json a un directorio inmutable.
// node scripts/audit-bridge-joins.mjs --data .cache/bridge-joins/before --output docs/empalmes-puentes-baseline.json
// node scripts/audit-bridge-joins.mjs --before .cache/bridge-joins/before --output docs/empalmes-puentes-after.json
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
async function load (directory) {
  const [meta, report, terrain, positionsBuffer, indexBuffer] = await Promise.all([
    readJson(join(directory, 'roads-meta.json')), readJson(join(directory, 'roads-structures.json')),
    readJson(join(directory, 'terrain.json')), readFile(join(directory, 'roads-pos.bin')),
    readFile(join(directory, 'roads-index.bin')),
  ])
  const origin = terrain.origin
  return { meta, report, frame: makeEnuFrame(origin.lat, origin.lon, origin.h),
    positions: new Float32Array(positionsBuffer.buffer, positionsBuffer.byteOffset, positionsBuffer.byteLength / 4),
    index: new Uint32Array(indexBuffer.buffer, indexBuffer.byteOffset, indexBuffer.byteLength / 4) }
}
const directory = option('--data', 'public/data')
const [data, raw] = await Promise.all([load(directory), readJson(option('--osm', '.cache/vias.json'))])
const result = { source: directory, ...auditBridgeJoins(data, raw) }
if (args.includes('--before')) {
  const before = await load(option('--before'))
  result.comparison = compareBridgeBakes(before, data)
  const baseline = auditBridgeJoins(before, raw)
  result.before = { slopeBreakPp: baseline.slopeBreakPp, heightStepM: baseline.heightStepM,
    measuredAbutments: baseline.measuredAbutments, missingAbutments: baseline.missingAbutments }
}
const output = option('--output')
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n') }
const { endpoints, comparison, ...summary } = result
console.log(JSON.stringify({ ...summary, ...(comparison ? { comparison: {
  ...comparison, changedWays: comparison.changedWays.length,
} } : {}), missing: endpoints.filter(e => e.breakPp === null) }, null, 2))
