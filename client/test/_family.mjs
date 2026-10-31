import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex } from '../src/dict.js'
import { familyOf, stemVariants } from '../src/family.js'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const entries = JSON.parse(readFileSync(join(ROOT,'data/dict.dat'),'utf8'))
const dict = buildIndex(entries, {})

let pass=0,fail=0
const t=(n,cond,detail)=>{cond?pass++:fail++;console.log(`${cond?'PASS':'FAIL'}  ${n}${detail?`  —— ${detail}`:''}`)}

for (const w of ['cute','care','run','happy','beauty']) {
  const f = familyOf(dict, w)
  console.log(`\n${w}: 变位=[${f.inflections.join(', ')}]`)
  console.log(`  同根=[${f.derived.map(d=>d.word+'('+d.reason+')').join(', ')}]`)
}

// 关键：不能把 care 和 career 扯上关系
const careFam = familyOf(dict,'care').derived.map(d=>d.word)
t('care 不含 career', !careFam.includes('career'), careFam.join(','))
t('care 不含 careen', !careFam.includes('careen'))
t('care 含 careful', careFam.includes('careful'))
t('care 含 careless', careFam.includes('careless'))

// cute 系列
const cuteFam = familyOf(dict,'cute').derived.map(d=>d.word)
// 注：cuteness 在词库里没有单独词条，所以不该出现；cuter/cutest 是变位不是同根
t('cute 有变位 cuter/cutest', familyOf(dict,'cute').inflections.length > 0,
  familyOf(dict,'cute').inflections.join(','))

// run 变位
const runF = familyOf(dict,'run')
t('run 含 ran', runF.inflections.includes('ran'))
t('run 含 running', runF.inflections.includes('running'))

// 不该拆的词
t('uncle 不被拆成 un+cle', !stemVariants('uncle').some(v=>v.stem==='cle'), JSON.stringify(stemVariants('uncle')))
console.log(`\n${pass}/${pass+fail} passed`)
