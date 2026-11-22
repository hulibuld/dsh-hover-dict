/**
 * _importer.mjs —— importer.js 纯函数单测（设计-v2 §B2）。
 *
 * 解析层决定「用户粘进来的东西会不会被吃掉一行」，所以每种格式都要钉住：
 * 格式识别、词头抽取、释义/音标切分、跳过原因、JSON 备份恢复。
 */

import {
  parseImportDetailed, detectImportFormat, glossText, summarizeImport,
} from '../src/importer.js'

let pass = 0
let fail = 0
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}
const heads = (parsed) => parsed.words.map((row) => row.head)
const reasons = (parsed) => parsed.skipped.map((row) => row.reason)

// ═══ 1. 格式识别 ═══
t('空文本 → plain', detectImportFormat(''), 'plain')
t('一行一词 → plain', detectImportFormat('apple\nbanana'), 'plain')
t('CSV → csv', detectImportFormat('word,phonetic\napple,ˈæpl'), 'csv')
t('TSV → tsv', detectImportFormat('apple\tˈæpl\tn. 苹果'), 'tsv')
t('JSON 数组 → json', detectImportFormat('[{"head":"apple"}]'), 'json')
t('JSON 对象带 words → json', detectImportFormat('{"words":["apple"]}'), 'json')
t('坏 JSON → 按文本猜 plain', detectImportFormat('[not json'), 'plain')
t('有道整段（双空格 + 音标）→ youdao', detectImportFormat('hello  /həˈloʊ/  int. 喂'), 'youdao')
t('单空格无音标 → plain', detectImportFormat('hello int. 喂'), 'plain')

// ═══ 2. plain ═══
const p1 = parseImportDetailed('apple\nbanana\ncherry')
t('plain 三行', heads(p1), ['apple', 'banana', 'cherry'])
t('plain 格式', p1.format, 'plain')
t('plain 行号从 1 起', p1.words.map((w) => w.line), [1, 2, 3])
t('plain 无释义', p1.words[0].gloss, '')
t('plain 无跳过', p1.skipped.length, 0)

const p2 = parseImportDetailed('apple  n. 苹果\nrun\tv. 跑')
t('plain 带释义（双空格）', p2.words[0].gloss, 'n. 苹果')
t('plain 带释义（Tab）', p2.words[1].gloss, 'v. 跑')

// 音标识别
const p3 = parseImportDetailed('hello  /həˈloʊ/  int. 喂\nworld  [wɜːrld]  n. 世界')
t('音标 /…/ 被识别', p3.words[0].phonetic, '/həˈloʊ/')
t('音标 […] 被识别', p3.words[1].phonetic, '[wɜːrld]')
t('音标不进 gloss', p3.words[0].gloss, 'int. 喂')
t('glossText 把音标拼回前缀', glossText(p3.words[0]), '/həˈloʊ/ int. 喂')

// ═══ 3. 跳过原因（不静默丢行）═══
const p4 = parseImportDetailed('apple\n\n# 注释\n中文词\n123abc\napple')
t('跳过的行都留原因（含末尾重复行）', p4.skipped.length, 5)
t('空行原因', p4.skipped[0].reason, '空行')
t('注释行原因', p4.skipped[1].reason, '注释行')
t('中文行原因', p4.skipped[2].reason, '不是英文单词')
t('数字开头原因', p4.skipped[3].reason, '不是英文单词')
t('重复行也进 skipped', reasons(p4).includes('重复行'), true)
t('重复行行号是最后一行', p4.skipped[4].line, 6)
const p4b = parseImportDetailed('apple\nbanana\napple')
t('重复行原因', p4b.skipped.map((s) => s.reason), ['重复行'])
t('重复行不重复进 words', heads(p4b), ['apple', 'banana'])
t('skipped 带行号', p4.skipped[0].line, 2)
t('skipped 带原始内容', p4.skipped[2].raw.length > 0, true)

// ═══ 4. CSV / TSV ═══
const c1 = parseImportDetailed('word,phonetic,meaning\napple,ˈæpl,n. 苹果\nbanana,bəˈnɑːnə,n. 香蕉')
t('CSV 跳过表头', heads(c1), ['apple', 'banana'])
t('CSV 表头进 skipped', reasons(c1), ['表头行'])
t('CSV 格式', c1.format, 'csv')
t('CSV 切释义', c1.words[0].gloss, 'n. 苹果')

// 表头只有在有多列时才跳过：单词本身就是 word 时不能被吃
const c2 = parseImportDetailed('word\napple')
t('单列表头不当表头', heads(c2), ['word', 'apple'])
t('单列不产 skipped', c2.skipped.length, 0)

const c3 = parseImportDetailed('单词,释义\nabandon,v. 放弃')
t('中文表头也跳过', heads(c3), ['abandon'])
t('中文表头进 skipped', reasons(c3), ['表头行'])

const tsv1 = parseImportDetailed('apple\tˈæpl\tn. 苹果\nabandon\təˈbændən\tv. 放弃')
t('TSV 解析', heads(tsv1), ['apple', 'abandon'])
t('TSV 格式', tsv1.format, 'tsv')
t('TSV 切释义', tsv1.words[1].gloss, 'v. 放弃')

// 表头在整个首列是 "word,phonetic" 的旧测试里（既有单测）也要保持箭头一致
const c4 = parseImportDetailed('word,phonetic\napple,ˈæpl\nbanana,bəˈnænə')
t('旧 CSV 用例：表头被跳过，取到两词', heads(c4), ['apple', 'banana'])

// ═══ 5. youdao ═══
const y1 = parseImportDetailed('hello  /həˈloʊ/  int. 喂\nabandon  /əˈbændən/  v. 放弃')
t('有道整段格式', y1.format, 'youdao')
t('有道取词头', heads(y1), ['hello', 'abandon'])
t('有道取音标', y1.words[1].phonetic, '/əˈbændən/')
t('有道取释义', y1.words[1].gloss, 'v. 放弃')

// ═══ 6. JSON ═══
const j1 = parseImportDetailed('["apple","banana"]')
t('JSON 字符串数组', heads(j1), ['apple', 'banana'])
t('JSON 格式', j1.format, 'json')
t('JSON 行号是元素序号', j1.words.map((w) => w.line), [1, 2])

const j2 = parseImportDetailed('[{"head":"apple","gloss":"n. 苹果"},{"word":"run","translation":"v. 跑"}]')
t('JSON 对象 head/gloss', heads(j2), ['apple', 'run'])
t('JSON 对象 word/translation', j2.words[1].gloss, 'v. 跑')

const j3 = parseImportDetailed('[{"head":"cute","state":"known","srs":{"reps":3},"bookId":"cet4","addedAt":123}]')
t('JSON 备份带 record', typeof j3.words[0].record, 'object')
t('record 保留 state', j3.words[0].record.state, 'known')
t('record 保留 bookId', j3.words[0].record.bookId, 'cet4')
t('JSON 备份无 gloss 也认', j3.words[0].status, 'new')

const j4 = parseImportDetailed('[{"head":"apple"},{"head":"apple"},{"head":"123"}]')
t('JSON 重复与非法都进 skipped', j4.skipped.map((s) => s.reason), ['重复行', '不是英文单词'])

const j5 = parseImportDetailed('[]')
t('空 JSON 数组', [j5.words.length, j5.skipped.length], [0, 1])
t('空 JSON 数组原因', j5.skipped[0].reason, 'JSON 里没有词条')

const j6 = parseImportDetailed('{"words":["apple"]}')
t('对象包 words', heads(j6), ['apple'])

// ═══ 7. 状态判定（isDup / isKnown 注入）═══
const book = new Set(['apple'])
const dict = new Set(['apple', 'banana'])
const probes = { isDup: (h) => book.has(h), isKnown: (h) => dict.has(h) }
const s1 = parseImportDetailed('apple\nbanana\ncherry', probes)
t('已在生词本 → dup', s1.words[0].status, 'dup')
t('词库查得到且不在本 → new', s1.words[1].status, 'new')
t('词库查不到 → nodict', s1.words[2].status, 'nodict')

const s2 = summarizeImport(s1)
t('summarize total', s2.total, 3)
t('summarize fresh', s2.fresh, 1)
t('summarize dup', s2.dup, 1)
t('summarize nodict', s2.nodict, 1)
t('summarize skipped', s2.skipped, 0)

// 不给 probes：默认不重复、词库都算查得到
const s3 = parseImportDetailed('apple')
t('默认 probe：状态 new', s3.words[0].status, 'new')

// ═══ 8. 词头大小写与 normalize ═══
const n1 = parseImportDetailed('Apple\nRUN\nDon\'t')
t('词头统一小写', heads(n1), ['apple', 'run', "don't"])
t('撇号词头保留', heads(parseImportDetailed("o'clock"))[0], "o'clock")

// ═══ 9. 边界输入不抛 ═══
const e1 = parseImportDetailed(undefined)
t('undefined 不抛', [e1.words.length, e1.skipped.length, e1.format], [0, 0, 'plain'])
const e2 = parseImportDetailed('   \n\n  ')
t('全空白不产词', e2.words.length, 0)
const e3 = parseImportDetailed('a'.repeat(200))
t('超长串当非法跳过', [e3.words.length, e3.skipped[0].reason], [0, '不是英文单词'])
t('glossText 空输入', glossText(undefined), '')
t('glossText 只有音标', glossText({ phonetic: '/x/' }), '/x/')
t('summarizeImport 空', summarizeImport({}), { total: 0, fresh: 0, dup: 0, nodict: 0, skipped: 0 })

// ═══ 10. 释义长度与中文判定 ═══
const longGloss = 'n. ' + '很长的释义'.repeat(60)
const lg = parseImportDetailed(`apple  ${longGloss}`)
t('释义截断到 120', lg.words[0].gloss.length <= 120, true)
const noHan = parseImportDetailed('apple  something in english only')
t('无中文不取释义', noHan.words[0].gloss, '')

// skipHeader=false 时表头当普通词
const nh = parseImportDetailed('word,phonetic\napple,ˈæpl', { skipHeader: false })
t('skipHeader=false 保留表头行', heads(nh), ['word', 'apple'])

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)