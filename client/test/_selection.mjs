import { classifySelection } from '../src/selection.js'
const cases = [
  ['hello','word'],['Hello','word'],["don't",'word'],['well-known','word'],
  ['utf8','word'],['hello world','phrase'],
  ['The quick brown fox jumps over the lazy dog.','phrase'],
  ['a','word'],['中文内容',null],['123',null],['',null],['   ',null],['你好 hello',null],
]
let pass=0,fail=0
for (const [input,want] of cases) {
  const got=classifySelection(input); const kind=got?got.kind:null
  const ok=kind===want; ok?pass++:fail++
  console.log(`${ok?'PASS':'FAIL'}  ${JSON.stringify(input).padEnd(46)} -> ${String(kind).padEnd(7)} want ${String(want)}`)
}
console.log(`\n${pass}/${pass+fail} passed`)
