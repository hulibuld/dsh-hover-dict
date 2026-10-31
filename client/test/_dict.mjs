import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, lookup, describeEntry, briefOf } from '../src/dict.js'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const entries = JSON.parse(readFileSync(join(ROOT,'data/dict.dat'),'utf8'))
const meta = JSON.parse(readFileSync(join(ROOT,'data/meta.json'),'utf8'))
const t0 = performance.now()
const dict = buildIndex(entries, meta)
const t1 = performance.now()
console.log(`buildIndex: ${Object.keys(entries).length} entries, ${dict.formIndex.size} form keys, ${(t1-t0).toFixed(1)}ms`)
const checks = [
  ['hello','head'], ['ran','form'], ['running','form'], ['comprehensive','head'],
  ['algorithm','head'], ['zzzznotaword',null], ['Hello','head'],
]
let pass=0, fail=0
for (const [w, want] of checks) {
  const r = lookup(dict, w)
  const ok = want===null ? r===null : (r!==null)
  if(ok) pass++; else fail++
  console.log(`${ok?'PASS':'FAIL'}  lookup(${w}) -> ${r? `${r.head} (${r.matchedBy})`:'null'}`)
}
console.log('\nbriefOf(hello):', JSON.stringify(briefOf(entries.hello)))
const d = describeEntry(entries.run)
console.log('describeEntry(run): senses=', d.senses.length, 'forms=', d.forms.length, 'examples=', d.examples.length, 'tags=', d.tagsLabel)
console.log('  first sense:', JSON.stringify(d.senses[0]).slice(0,140))
console.log(`\n${pass}/${pass+fail} passed`)
