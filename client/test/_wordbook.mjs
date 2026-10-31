import { createWordbook, parseImportText } from '../src/wordbook.js'
let pass=0,fail=0
const t=(n,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok?'':` want ${JSON.stringify(want)}`}`)}

// 内存模式（没有 storage / localStorage）
const wb = createWordbook({})
await wb.ready()
t('初始为空', wb.size(), 0)
t('加一个词', await wb.add('Run'), true)
t('已存在', wb.has('run'), true)
t('大小写不敏感', wb.has('RUN'), true)
t('重复加返回 false', await wb.add('run'), false)
t('toggle 移除', await wb.toggle('run'), false)
t('移除后不存在', wb.has('run'), false)
await wb.add('cute')
await wb.add('cuteness')
t('两个词', wb.size(), 2)

// 批量导入
const added = await wb.importMany(['hello','world','hello','123','中文'], 'youdao')
t('导入去重与非法过滤', added, 2)
t('导入后总数', wb.size(), 4)

// 解析导入文本（有道格式：单词 音标 释义）
const txt = `hello  həˈloʊ  int. 喂
world  wɜːrld  n. 世界
# 注释行跳过
abandon  əˈbændən  v. 放弃`
t('解析有道格式', parseImportText(txt), ['hello','world','abandon'])
t('解析 CSV', parseImportText('word,phonetic\napple,ˈæpl\nbanana,bəˈnænə'), ['word','apple','banana'])
t('解析空', parseImportText(''), [])

// 订阅
let hits = 0
const off = wb.subscribe(() => { hits += 1 })
await wb.add('test')
t('订阅被通知', hits > 0, true)
off()
const before = hits
await wb.add('test2')
t('取消订阅后不再通知', hits, before)

console.log(`\n${pass}/${pass+fail} passed`)
