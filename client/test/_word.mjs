import { wordAt, normalizeKey, stemCandidates, isWordChar, isJoiner } from '../src/word.js'
const cases = [
  ['Hello world', 1, undefined, 'Hello'],
  ["I don't know", 4, undefined, "don't"],
  ['a well-known fact', 5, undefined, 'well-known'],
  ['version -5 here', 8, undefined, null],
  ['year 2026 ok', 6, undefined, null],
  ['使用use一下', 3, undefined, 'use'],
  ['hello', 5, { preferLeft: true }, 'hello'],
  ['hello', 5, undefined, null],
  ['utf8 encoding', 1, undefined, 'utf8'],
  ['a', 0, undefined, 'a'],
]
let pass=0, fail=0
for (const [text, off, opts, want] of cases) {
  const got = wordAt(text, off, opts)
  const gotText = got ? got.text : null
  const ok = gotText === want
  if (ok) pass++; else fail++
  console.log(`${ok?'PASS':'FAIL'}  wordAt(${JSON.stringify(text)}, ${off}, ${JSON.stringify(opts)}) -> ${JSON.stringify(gotText)}  want ${JSON.stringify(want)}`)
}
console.log('\nnormalizeKey:', JSON.stringify(normalizeKey("Don\u2019t")))
console.log('stemCandidates(running):', stemCandidates('running'))
console.log('stemCandidates(studies):', stemCandidates('studies'))
console.log('isWordChar(a)=', isWordChar('a'), 'isWordChar(中)=', isWordChar('中'), 'isJoiner(-)=', isJoiner('-'))
console.log(`\n${pass}/${pass+fail} passed`)
