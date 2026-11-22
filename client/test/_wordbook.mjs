import { createWordbook, parseImportText } from '../src/wordbook.js'
import { DAY_MS, defaultSrs } from '../src/srs.js'
let pass = 0
let fail = 0
const t = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}

/** 造一个假的宿主 KV，够 wordbook 用的那几个方法就够。 */
function makeKv(seed = {}) {
  const tables = { words: {}, books: {}, log: {} }
  for (const [table, rows] of Object.entries(seed)) tables[table] = { ...(rows ?? {}) }
  const writes = []
  return {
    opened: null,
    async open(config) {
      this.opened = config
      return {
        putRecord: async (table, key, value) => {
          tables[table] = tables[table] ?? {}
          tables[table][key] = JSON.parse(JSON.stringify(value))
          writes.push(`${table}/${key}`)
        },
        deleteRecord: async (table, key) => {
          if (tables[table]) delete tables[table][key]
          writes.push(`-${table}/${key}`)
        },
        loadAll: async () => ({ tables }),
      }
    },
    __tables: tables,
    __writes: writes,
  }
}

// ═══ 1. 内存模式（没有 storage / localStorage）═══
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

// 新词条形状 v2
const fresh = wb.get('cute')
t('新词条 v=2', fresh.v, 2)
t('新词条 state=new', fresh.state, 'new')
t('新词条 bookId=default', fresh.bookId, 'default')
t('新词条 gloss 空', fresh.gloss, '')
t('新词条 note 空', fresh.note, '')
t('新词条 srs 默认', fresh.srs, defaultSrs())
t('新词条 review 保留', fresh.review, { seen: 0, lastSeenAt: 0 })
t('新词条没有 alsoIn', 'alsoIn' in fresh, false)

// ═══ 2. 批量导入 ═══
const added = await wb.importMany(['hello', 'world', 'hello', '123', '中文'], 'youdao')
t('导入去重与非法过滤', added, 2)
t('导入后总数', wb.size(), 4)
t('导入词来源正确', wb.get('hello').source, 'youdao')

// importMany 带 glosses
const gwb = createWordbook({})
await gwb.ready()
await gwb.importMany(['abandon', 'cute'], 'import', {
  glosses: new Map([['abandon', 'v. 放弃'], ['cute', 'adj. 可爱的']]),
})
t('importMany glosses 用 Map', [gwb.get('abandon').gloss, gwb.get('cute').gloss], ['v. 放弃', 'adj. 可爱的'])
const gw2 = createWordbook({})
await gw2.ready()
await gw2.importMany(['apple'], 'import', { glosses: { apple: 'n. 苹果' } })
t('importMany glosses 用普通对象', gw2.get('apple').gloss, 'n. 苹果')

// importMany 兼容旧调用（opts 省略）
const legacy = createWordbook({})
await legacy.ready()
t('importMany 省略 opts 仍可用', await legacy.importMany(['run'], 'import'), 1)
t('省略 opts 时 bookId=default', legacy.get('run').bookId, 'default')

// ═══ 3. v1 记录迁移（老数据不丢）═══
const kv = makeKv({
  words: {
    // 纯 v1 记录：没有 v/state/srs/bookId/gloss
    cute: { head: 'cute', addedAt: 1000, source: 'dsh', note: '', review: { seen: 3, lastSeenAt: 5000 } },
    // 更老：连 review 都没有
    run: { head: 'run', addedAt: 2000, source: 'dsh' },
  },
})
const migrated = createWordbook({ storage: { backend: { get: () => kv } } })
await migrated.ready()
t('迁移：v1 记录条数不丢', migrated.size(), 2)
const mc = migrated.get('cute')
t('迁移：state 补 new', mc.state, 'new')
t('迁移：srs 补默认值', mc.srs, defaultSrs())
t('迁移：bookId 补 default', mc.bookId, 'default')
t('迁移：gloss 补空', mc.gloss, '')
t('迁移：v 变 2', mc.v, 2)
t('迁移：review.seen 原样保留', mc.review.seen, 3)
t('迁移：review.lastSeenAt 原样保留', mc.review.lastSeenAt, 5000)
t('迁移：addedAt 原样保留', mc.addedAt, 1000)
t('迁移：缺 review 也补零', migrated.get('run').review, { seen: 0, lastSeenAt: 0 })
t('迁移：KV 单元 version=2', kv.opened.version, 2)
t('迁移：KV 三张表都建', kv.opened.tables, ['words', 'books', 'log'])
t('迁移：单元名没改', kv.opened.name, 'dsh-hover-dict')
t('迁移：内置书自动建好', migrated.listBooks().map((b) => b.id), ['default'])

// localStorage 兜底的 v1 数据也要能读
const localStore = {
  data: {
    'dsh-hover-dict:wordbook': JSON.stringify([
      { head: 'cute', addedAt: 1, source: 'dsh', note: '', review: { seen: 2, lastSeenAt: 3 } },
    ]),
  },
  getItem(key) { return this.data[key] ?? null },
  setItem(key, value) { this.data[key] = value },
}
const localBook = createWordbook({ local: localStore })
await localBook.ready()
t('localStorage v1 也能读', localBook.size(), 1)
t('localStorage 迁移补 srs', localBook.get('cute').srs, defaultSrs())
t('localStorage 兜底键没改', Object.keys(localStore.data).includes('dsh-hover-dict:wordbook'), true)

// ═══ 4. 多词书 ═══
const bw = createWordbook({})
await bw.ready()
t('默认只有内置书', bw.listBooks().map((b) => b.id), ['default'])
t('内置书不可删', await bw.removeBook('default'), false)
t('内置书不可改名', await bw.renameBook('default', 'x'), false)
const book = await bw.createBook('四级词表')
t('新建词书有 id', typeof book.id === 'string' && book.id !== 'default', true)
t('新建词书 builtin=false', book.builtin, false)
t('同名再造返回同一本', (await bw.createBook('四级词表')).id, book.id)
t('空名不建书', await bw.createBook('   '), null)
t('列表含两本', bw.listBooks().length, 2)
t('改名成功', await bw.renameBook(book.id, '四级核心词'), true)
t('改名生效', bw.listBooks().find((b) => b.id === book.id).name, '四级核心词')

// 导入到指定书
await bw.importMany(['apple', 'banana'], 'import', { bookId: book.id })
t('导入到指定书 bookId', bw.get('apple').bookId, book.id)

// 同一词头导到另一本书：不新建记录，只加 alsoIn
const before = bw.size()
const addedAgain = await bw.importMany(['apple'], 'import', { bookId: 'default' })
t('重复导入到别的书不新增', addedAgain, 0)
t('记录数没变', bw.size(), before)
t('alsoIn 记下另一本', bw.get('apple').alsoIn, ['default'])
t('bookId 保持首次归属', bw.get('apple').bookId, book.id)
// 再导一次同一本书：不重复追加
await bw.importMany(['apple'], 'import', { bookId: 'default' })
t('alsoIn 不重复追加', bw.get('apple').alsoIn, ['default'])

// 删书：词回 default，不删词
const totalBefore = bw.size()
t('删书成功', await bw.removeBook(book.id), true)
t('删书不删词', bw.size(), totalBefore)
t('独占词回 default', bw.get('banana').bookId, 'default')
t('有 alsoIn 的词改挂到下一本书', bw.get('apple').bookId, 'default')
t('alsoIn 清空后字段消失', 'alsoIn' in bw.get('apple'), false)
t('书只剩内置', bw.listBooks().map((b) => b.id), ['default'])

// ═══ 5. grade / setState / setNote ═══
const NOW = 1_700_000_000_000
const rwb = createWordbook({})
await rwb.ready()
await rwb.add('run')
t('grade 不存在的词返回 null', await rwb.grade('nope', 'good'), null)
const graded = await rwb.grade('run', 'good')
t('grade good 后 state=fuzzy（new→fuzzy）', graded.state, 'fuzzy')
t('grade good 后 interval=1', graded.srs.interval, 1)
t('grade good 后 reps=1', graded.srs.reps, 1)
t('grade 记 log（reviewedToday 生效）', rwb.stats(Date.now()).reviewedToday >= 1, true)

const againEntry = await rwb.grade('run', 'again')
t('grade again 后 state=unknown', againEntry.state, 'unknown')
t('grade again 后 interval=0', againEntry.srs.interval, 0)
t('grade again 后 lapses=1', againEntry.srs.lapses, 1)

// setState
t('setState 非法值返回 null', await rwb.setState('run', 'bogus'), null)
t('setState 不存在的词返回 null', await rwb.setState('nope', 'known'), null)
const known = await rwb.setState('run', 'known')
t('手动转 known', known.state, 'known')
t('手动 known：due 推到 30 天后', known.srs.due > NOW + 29 * DAY_MS, true)
const unknown = await rwb.setState('run', 'unknown')
t('手动转 unknown', unknown.state, 'unknown')
t('手动 unknown：due=0 立即回队列', unknown.srs.due, 0)

// setNote
t('setNote 写入', (await rwb.setNote('run', '  跑步，常考  ')).note, '  跑步，常考  ')
t('setNote 超长截断到 500', (await rwb.setNote('run', 'x'.repeat(900))).note.length, 500)
t('setNote 非字符串清空', (await rwb.setNote('run', undefined)).note, '')
t('setNote 不存在的词返回 null', await rwb.setNote('nope', 'x'), null)

// ═══ 6. dueQueue 排序 ═══
const qwb = createWordbook({})
await qwb.ready()
await qwb.importMany(['alpha', 'beta', 'gamma', 'delta'], 'manual')
// 全部 due=0 → 立即到期；手工造出不认识与不同 due
qwb.get('alpha').srs.due = 0
qwb.get('beta').srs.due = 0
qwb.get('gamma').srs.due = 0
qwb.get('delta').srs.due = NOW + 5 * DAY_MS
await qwb.setState('alpha', 'unknown')
await qwb.setState('gamma', 'fuzzy')
qwb.get('beta').addedAt = 0
qwb.get('alpha').addedAt = 5000
qwb.get('gamma').addedAt = 1000
const queue = qwb.dueQueue(NOW)
t('dueQueue 只排到期的', queue.map((e) => e.head), ['alpha', 'beta', 'gamma'])
t('dueQueue 不认识优先', queue[0].head, 'alpha')
t('dueQueue 其余按 addedAt 升序', queue.slice(1).map((e) => e.head), ['beta', 'gamma'])
t('dueQueue 未来到期的不在队里', queue.some((e) => e.head === 'delta'), false)

// due 升序优先于 addedAt
const q2 = createWordbook({})
await q2.ready()
await q2.importMany(['aa', 'bb'], 'manual')
q2.get('aa').srs.due = 100
q2.get('bb').srs.due = 50
q2.get('aa').addedAt = 0
q2.get('bb').addedAt = 9999
t('dueQueue 按 due 升序（不是 addedAt）', q2.dueQueue(NOW).map((e) => e.head), ['bb', 'aa'])

// ═══ 7. stats ═══
const swb = createWordbook({})
await swb.ready()
await swb.importMany(['one', 'two', 'three'], 'manual')
await swb.add('four')
const s0 = swb.stats()
t('stats.total', s0.total, 4)
t('stats.byState 四键齐全', Object.keys(s0.byState), ['new', 'unknown', 'fuzzy', 'known'])
t('stats.byState.new=4', s0.byState.new, 4)
t('stats.dueToday=4（due 全 0）', s0.dueToday, 4)
t('stats.addedToday=4', s0.addedToday, 4)
t('stats.reviewedToday=0', s0.reviewedToday, 0)
t('stats.days 30 天', s0.days.length, 30)
const todayKey = (() => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})()
t('stats.days 最后一天是今天（本地时区）', s0.days[29].date, todayKey)
t('stats.days 今天 added 计数', s0.days[29].added, 4)
t('stats.streak 没记录=0', s0.streak, 0)

await swb.grade('one', 'good')
await swb.setState('two', 'known')
const s1 = swb.stats()
t('stats 评分后 reviewedToday=1', s1.reviewedToday, 1)
t('stats today.reviewed=1', s1.days[29].reviewed, 1)
t('stats 转 known 后 byState.known=1', s1.byState.known, 1)
t('stats 有复习记录 streak=1', s1.streak, 1)

// ═══ 8. streak 跨天（用注入的 log 数据模拟历史）═══
const today0 = new Date()
today0.setHours(0, 0, 0, 0)
const todayStart = today0.getTime()
const logRows = [
  { at: todayStart - 2 * DAY_MS + 1000, head: 'one', grade: 'good' },
  { at: todayStart - 1 * DAY_MS + 1000, head: 'one', grade: 'good' },
]
const kv2 = makeKv({
  words: { one: { head: 'one', addedAt: todayStart - 5 * DAY_MS, source: 'dsh' } },
  log: { recent: logRows },
})
const stwb = createWordbook({ storage: { backend: { get: () => kv2 } } })
await stwb.ready()
const s2 = stwb.stats()
t('streak：前天+昨天有记录、今天没有 → 2', s2.streak, 2)
t('streak 不影响 reviewedToday', s2.reviewedToday, 0)
t('stats.days 有历史 reviewed', s2.days.slice(-3).map((d) => d.reviewed), [1, 1, 0])

// 今天也复习 → streak 变 3
await stwb.grade('one', 'good')
t('今天补上复习 → streak=3', stwb.stats().streak, 3)

// 断签：跳过两天
const kv3 = makeKv({
  words: { one: { head: 'one', addedAt: todayStart - 10 * DAY_MS, source: 'dsh' } },
  log: { recent: [{ at: todayStart - 5 * DAY_MS, head: 'one', grade: 'good' }] },
})
const stwb3 = createWordbook({ storage: { backend: { get: () => kv3 } } })
await stwb3.ready()
t('断签后 streak=0', stwb3.stats().streak, 0)

// ═══ 9. exportAll ═══
const ew = createWordbook({})
await ew.ready()
await ew.add('exportme')
await ew.grade('exportme', 'good')
await ew.setNote('exportme', '备注')
const exported = ew.exportAll()
t('exportAll 返回数组', Array.isArray(exported), true)
t('exportAll 带 v=2', exported[0].v, 2)
t('exportAll 带 srs', typeof exported[0].srs, 'object')
t('exportAll 带 state', exported[0].state, 'fuzzy')
t('exportAll 带 note', exported[0].note, '备注')
t('exportAll 是深拷贝 srs', exported[0].srs === ew.get('exportme').srs, false)

// 备份恢复：exportAll → importMany 到新本
const rwb2 = createWordbook({})
await rwb2.ready()
const restored = await rwb2.importMany(exported, 'import')
t('备份恢复新增 1 条', restored, 1)
const r = rwb2.get('exportme')
t('恢复保留 state', r.state, 'fuzzy')
t('恢复保留 note', r.note, '备注')
t('恢复保留 srs.reps', r.srs.reps, 1)
t('恢复保留 addedAt', r.addedAt, ew.get('exportme').addedAt)

// 备份恢复：bookId 不在新本里时补一本占位书，词不丢也不挂空
const kvm = makeKv({})
const mwb = createWordbook({ storage: { backend: { get: () => kvm } } })
await mwb.ready()
const backup = [{
  v: 2, head: 'migrated', addedAt: 123, source: 'import', bookId: 'cet4-20261121',
  note: 'n', gloss: 'g', state: 'known', srs: { due: 9, interval: 30, ease: 2.7, reps: 4, lapses: 1, lastReviewAt: 8 },
  review: { seen: 2, lastSeenAt: 7 },
}]
t('备份恢复带 bookId', await mwb.importMany(backup, 'import'), 1)
t('恢复保留 bookId', mwb.get('migrated').bookId, 'cet4-20261121')
t('恢复补了占位词书', mwb.listBooks().some((b) => b.id === 'cet4-20261121'), true)
t('恢复保留 known', mwb.get('migrated').state, 'known')
t('恢复保留 srs.ease', mwb.get('migrated').srs.ease, 2.7)
t('恢复保留 gloss', mwb.get('migrated').gloss, 'g')

// ═══ 10. touch / 订阅 ═══
let hits = 0
const off = ew.subscribe(() => { hits += 1 })
await ew.add('test')
t('订阅被通知', hits > 0, true)
off()
const hitsBefore = hits
await ew.add('test2')
t('取消订阅后不再通知', hits, hitsBefore)

const tw = createWordbook({})
await tw.ready()
await tw.add('touchme')
await tw.touch('touchme')
await tw.touch('touchme')
t('touch 累加 seen', tw.get('touchme').review.seen, 2)
t('touch 记 lastSeenAt', tw.get('touchme').review.lastSeenAt > 0, true)
t('touch 不存在的词无副作用', await tw.touch('nope'), undefined)

// ═══ 11. 解析导入文本（旧契约保持不变）═══
const txt = `hello  həˈloʊ  int. 喂
world  wɜːrld  n. 世界
# 注释行跳过
abandon  əˈbændən  v. 放弃`
t('解析有道格式', parseImportText(txt), ['hello', 'world', 'abandon'])
t('解析 CSV', parseImportText('word,phonetic\napple,ˈæpl\nbanana,bəˈnænə'), ['word', 'apple', 'banana'])
t('解析空', parseImportText(''), [])

// ═══ 12. KV 落盘 + 重开读回 ═══
const kv4 = makeKv({})
const pwb = createWordbook({ storage: { backend: { get: () => kv4 } } })
await pwb.ready()
await pwb.add('persisted')
await pwb.grade('persisted', 'good')
await pwb.createBook('我的书')
t('KV 落了词条', typeof kv4.__tables.words.persisted, 'object')
t('KV 里的词是 v2', kv4.__tables.words.persisted.v, 2)
t('KV 落了词书', typeof kv4.__tables.books, 'object')
t('KV 落了 log', Array.isArray(kv4.__tables.log.recent), true)
const reopened = createWordbook({ storage: { backend: { get: () => kv4 } } })
await reopened.ready()
t('重开后词还在', reopened.has('persisted'), true)
t('重开后状态还在', reopened.get('persisted').state, 'fuzzy')
t('重开后词书还在', reopened.listBooks().some((b) => b.name === '我的书'), true)
t('重开后 reviewedToday 还在', reopened.stats().reviewedToday, 1)

// 写入失败不抛（KV 坏掉时界面不该报错）
const badKv = { async open() { return { putRecord: async () => { throw new Error('disk full') }, loadAll: async () => ({ tables: {} }) } } }
const bwb = createWordbook({ storage: { backend: { get: () => badKv } } })
await bwb.ready()
t('写盘失败不抛', await bwb.add('brave'), true)
t('写盘失败内存仍在', bwb.has('brave'), true)

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)