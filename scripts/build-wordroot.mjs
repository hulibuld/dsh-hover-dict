#!/usr/bin/env node
/**
 * build-wordroot.mjs —— 从 ECDICT 的词根库生成「词根词缀分析」数据。
 *
 * 输入：/tmp/wordroot.txt（ECDICT，MIT 许可，14,486 条词根/词缀条目）
 * 输出：data/wordroot.dat
 *
 * 输出形状：{ "<单词>": [ { part, type, meaning, origin?, weak? }, ... ] }
 *
 * 匹配分三档可靠度，weak 标记的档位界面上会淡显：
 *   1. 词根条目自带的 example 列表 —— 最可靠
 *   2. 前缀/后缀匹配 —— 中等可靠，加了一串防误判约束
 *   3. 词根包含匹配 —— 最弱，只对长度 ≥ 4 的词根做
 *
 * 用法：node scripts/build-wordroot.mjs [--src PATH] [--out PATH]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const args = { src: '/tmp/wordroot.txt', out: join(ROOT, 'data/wordroot.dat') }
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i] === '--src') args.src = process.argv[i + 1]
  if (process.argv[i] === '--out') args.out = process.argv[i + 1]
}

const log = (msg) => console.log(msg)
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`

/**
 * 清理词根条目的键。
 *
 * 原始键有几种形态：`hom`、`-less`、`un-`、`a-1`（末尾数字是同名区分，不是词的一部分）。
 */
function cleanPart(key) {
  // 原始键可能有：`-less`、`un-`、`a-1`、`-ly2`、`lys, lyt, -lyze`（复合条目）
  // 只取第一个逗号前的部分，再去掉末尾的同名数字与首尾横线。
  const first = String(key ?? '').split(',')[0].trim()
  // 末尾数字是同名区分（`-ly1` / `-ly2` / `a-1`），去掉后再去横线
  return first.replace(/\d+$/, '').replace(/^-+|-+$/g, '').trim()
}

/**
 * 判断一条词根记录的类别。
 *
 * ECDICT 的 `class` 字段写法很杂（`root` / `prefix` / `adjective-forming suffix`…），
 * 这里归成有限的几个值，方便界面显示中文。
 */
function classify(record, rawKey) {
  const cls = String(record?.class ?? '').toLowerCase()
  if (cls.includes('prefix') || (rawKey.endsWith('-') && !rawKey.startsWith('-'))) return 'prefix'
  if (cls.includes('suffix') || rawKey.startsWith('-')) {
    // 顺序要紧：`adverb-forming suffix` 里也含 "verb"，先判 adverb
    if (cls.includes('adverb')) return 'adv'
    if (cls.includes('adjective') && cls.includes('noun')) return 'suffix'
    if (cls.includes('adjective')) return 'adj'
    if (cls.includes('noun')) return 'noun'
    if (cls.includes('verb')) return 'verb'
    return 'suffix'
  }
  return 'root'
}

/** 判断是不是一条「词根」（区别于词缀）。 */
const isRoot = (type) => type === 'root'

async function main() {
  if (!existsSync(args.src)) throw new Error(`找不到词根源文件：${args.src}`)
  const dictPath = join(ROOT, 'data/dict.dat')
  if (!existsSync(dictPath)) throw new Error(`找不到词库：${dictPath}`)

  log('[1/4] 读词根库 ...')
  const roots = JSON.parse(readFileSync(args.src, 'utf8'))
  log(`      词根条目 ${Object.keys(roots).length.toLocaleString()} 条`)

  log('[2/4] 读词库（决定给哪些词做分析）...')
  const dict = JSON.parse(readFileSync(dictPath, 'utf8'))
  const words = new Set(Object.keys(dict))
  log(`      词库 ${words.size.toLocaleString()} 个词`)

  /** @type {Record<string, Array<object>>} */
  const out = Object.create(null)

  /** 给一个词追加一条分析。同一个 part 不重复加。 */
  /**
   * 判断一个词干在词库里是不是「真的存在」。
   *
   * 允许几种常见变形：补 e（cuteness→cute）、y 还原（happily→happy）、
   * 去双写辅音（running→run）。不做更激进的还原，宁可漏也不误判。
   */
  const stemExists = (stem) => {
    if (!stem || stem.length < 3) return false
    if (words.has(stem)) return true
    if (words.has(stem + 'e')) return true
    if (stem.endsWith('i') && words.has(stem.slice(0, -1) + 'y')) return true
    if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]
      && words.has(stem.slice(0, -1))) return true
    return false
  }

  /**
   * 取一个词的全部中文义项。
   *
   * 词条槽 0 是义项组，每组第二项是中文释义数组。
   */
  const zhOf = (word) => {
    const entry = dict[word]
    if (!Array.isArray(entry)) return []
    const out = []
    const groups = Array.isArray(entry[0]) ? entry[0] : []
    for (const group of groups) {
      const zh = Array.isArray(group?.[1]) ? group[1] : []
      for (const line of zh) {
        if (typeof line === 'string') out.push(line)
      }
    }
    return out
  }

  /** 汉字集合。 */
  const hanziOf = (lines) => {
    const set = new Set()
    for (const line of lines) {
      for (const ch of line) {
        if (/[\u4e00-\u9fff]/.test(ch)) set.add(ch)
      }
    }
    return set
  }

  /**
   * 判断「词干 + 词缀」的组合在语义上成立。
   *
   * 判据：派生词的中文释义里，至少要出现一个词干释义里的汉字。
   * understand(理解) 与 stand(站) 没有共同汉字 → 判为不成立；
   * unhappy(不快乐) 与 happy(快乐) 共享「快」「乐」 → 成立。
   *
   * 后缀/前缀本身也参与：像 -less 的「无」、un- 的「不」本来就不会出现在词干里，
   * 所以只比较**词干与派生词**，不看词缀含义。
   *
   * @param {string} word 派生词
   * @param {string} stem 词干
   * @returns {boolean}
   */
  /**
   * 纯语法后缀：只改变词性或时态，不改变词义。
   *
   * 这类后缀不需要语义校验 —— quickly 与 quick 的中文释义本来就可能只共享一个字，
   * 但它们的派生关系是确定的。
   */
  const GRAMMATICAL_SUFFIXES = new Set(['ly', 'ally', 'er', 'est', 'ier', 'iest', 'ing', 'ed'])

  /**
   * 明确不能拆的词。
   *
   * 这几个的共同点：形式上像「前缀+词干」，但词源上毫无关系，
   * 而词干又恰好在词库里存在、释义也沾边，前面几道闸门都拦不住。
   * 与其把规则调得越来越紧（会误伤 colourful 这类正确拆分），不如直接列出来。
   *
   * 只列经过人工确认的，不要往里堆没核实过的词。
   */
  const NO_SPLIT = new Set([
    'understand',   // under + stand，实际来自古英语 understandan「站在中间→领会」
    'beside',       // be + side，实际是古英语 be sīdan「在…旁边」的固定短语
    'underneath',   // 同上，under + neath 不是构词关系
    'withstand',    // 不是 with + stand 的派生
    'behold',       // 不是 be + hold 的派生
    'belong',       // 不是 be + long
    'become',       // 不是 be + come
    'before',       // 不是 be + fore
    'beneath',      // 不是 be + neath
    'between',      // 不是 be + tween
    'beyond',       // 不是 be + yond
    'underestimate',// under + estimate 是真前缀，但释义常对不上，先不拆
  ])

  const sharesMeaning = (word, stem) => {
    const wordChars = hanziOf(zhOf(word))
    const stemChars = hanziOf(zhOf(stem))
    if (wordChars.size === 0 || stemChars.size === 0) return false
    let shared = 0
    for (const ch of wordChars) {
      if (stemChars.has(ch)) shared += 1
    }
    // 只共享一个汉字不够：understand(理解/了解) 与 stand(站/立) 会因为
    // 「解」这种跨义项偶然出现的字被判成相关。
    // 要求共享的汉字占比不低于较小一方的 34%，也就是至少三分之一的语义重叠。
    const smaller = Math.min(wordChars.size, stemChars.size)
    return shared > 0 && shared / smaller >= 0.34
  }

  /**
   * 判断一个词是不是「独立基础词」——有自己的原形标记，说明它不是谁的派生词。
   *
   * ECDICT 的 exchange 字段里 `0:xxx` 表示「这个词的原形是 xxx」。
   * 如果原形就是它自己，它很可能是个独立词（begin / understand / beside），
   * 不该被硬套前缀。
   */
  const isStandaloneBase = (word) => {
    const entry = dict[word]
    if (!Array.isArray(entry)) return false
    for (let i = 5; i < entry.length; i += 1) {
      const slot = entry[i]
      if (typeof slot !== 'string') continue
      for (const part of slot.split('/')) {
        if (!part.startsWith('0:')) continue
        const lemma = part.slice(2).trim().toLowerCase()
        // 原形就是它自己 → 独立词，不是派生
        if (lemma === word) return true
      }
    }
    return false
  }

  const attach = (word, item) => {
    // 明确不拆的词，一律不加分析
    if (NO_SPLIT.has(word)) return
    const lower = String(word ?? '').toLowerCase().trim()
    if (lower === '' || !words.has(lower)) return
    const list = out[lower] ?? (out[lower] = [])
    if (list.some((existing) => existing.part === item.part)) return
    // 单个词最多记 3 条，多了反而看不清
    if (list.length >= 3) return
    list.push(item)
  }

  log('[3/4] 第一档：词根自带的例词 ...')
  let tier1 = 0
  for (const [rawKey, record] of Object.entries(roots)) {
    const part = cleanPart(rawKey)
    const type = classify(record, rawKey)
    const meaning = String(record?.meaning ?? '').trim()
    const origin = String(record?.origin ?? '').trim()
    const examples = Array.isArray(record?.example) ? record.example : []
    for (const example of examples) {
      // 例词可能是短语（"Homo sapiens"），只取第一个词
      const head = String(example ?? '').toLowerCase().split(/\s+/)[0]
      if (!head || !words.has(head)) continue
      const before = out[head]?.length ?? 0
      attach(head, { part: displayPart(rawKey, part, type), type, meaning, ...(origin ? { origin } : {}) })
      if ((out[head]?.length ?? 0) > before) tier1 += 1
    }
  }
  log(`      首档命中 ${Object.keys(out).length.toLocaleString()} 个词`)

  log('[4/4] 第二、三档：前后缀与词根匹配 ...')
  // 把词缀按长度降序，先匹配长的（-ness 优先于 -s）
  const affixes = []
  for (const [rawKey, record] of Object.entries(roots)) {
    const type = classify(record, rawKey)
    if (type === 'root') continue
    for (const part of variantsOf(rawKey)) {
      affixes.push({
        rawKey,
        part,
        type,
        meaning: String(record?.meaning ?? '').trim(),
        origin: String(record?.origin ?? '').trim(),
      })
    }
  }
  // 排序决定同名条目谁胜出：`-ly1`（副词）与 `-ly2`（形容词）清理后都是 `ly`，
  // 词库里 -ly 绝大多数是副词，所以副词后缀必须排在前面优先匹配。
  const TYPE_PRIORITY = { adv: 0, adj: 1, noun: 2, verb: 3, suffix: 4, prefix: 5 }
  affixes.sort((a, b) => {
    const byType = (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9)
    if (byType !== 0) return byType
    return b.part.length - a.part.length
  })

  const prefixes = affixes.filter((item) => item.type === 'prefix')
  const suffixes = affixes.filter((item) => item.type !== 'prefix')

  const rootEntries = []
  for (const [rawKey, record] of Object.entries(roots)) {
    const type = classify(record, rawKey)
    if (!isRoot(type)) continue
    for (const part of variantsOf(rawKey)) {
      if (part.length < 4 || !/^[a-z]+$/.test(part)) continue
      rootEntries.push({
        rawKey,
        part,
        type,
        meaning: String(record?.meaning ?? '').trim(),
        origin: String(record?.origin ?? '').trim(),
      })
    }
  }
  rootEntries.sort((a, b) => b.part.length - a.part.length)

  for (const word of words) {
    if (word.length < 3) continue

    // 前缀
    //
    // 必须验证「去掉前缀后剩下的部分真的是个词」。
    // 只按前缀匹配会造出 uncle→un-、understand→under-、beside→be- 这类假拆分：
    // 这些词历史上并不来自那个前缀。要求词干在词库里有独立词条，能挡掉绝大部分。
    for (const item of prefixes) {
      if (!word.startsWith(item.part)) continue
      const rest = word.slice(item.part.length)
      if (rest.length < 3) continue
      if (!stemExists(rest)) continue
      if (!sharesMeaning(word, rest)) continue
      // 最后一道：这个词若本身是独立基础词（有自己的原形标记），不要硬拆
      if (isStandaloneBase(word)) continue
      attach(word, { part: `${item.part}-`, type: 'prefix', meaning: item.meaning, ...(item.origin ? { origin: item.origin } : {}) })
      break
    }

    // 后缀
    for (const item of suffixes) {
      if (!word.endsWith(item.part)) continue
      const stem = word.slice(0, -item.part.length)
      if (stem.length < 3) continue
      // 短后缀（3 字母及以下）误判率高：-ite / -ate / -al / -ic 这类
      // 会从 rewrite 里抠出不存在的 -ite。
      // 长后缀也要验词干，否则 recently→re-、specifically→spec- 这种照样漏过去。
      if (!stemExists(stem)) continue
      // 纯语法后缀免检，其余后缀要过语义闸门
      if (!GRAMMATICAL_SUFFIXES.has(item.part) && !sharesMeaning(word, stem)) continue
      attach(word, { part: `-${item.part}`, type: item.type, meaning: item.meaning, ...(item.origin ? { origin: item.origin } : {}) })
      break
    }

    // 词根（弱匹配，只在还没有分析结果或结果不足时补）
    if ((out[word]?.length ?? 0) < 2 && word.length >= 6) {
      for (const item of rootEntries) {
        if (!word.includes(item.part)) continue
        // 词根不能是词的首尾之外独立的短串，会大量误判。
        // 只接受词根出现在开头或中间，且词根占词长的比例不超过 60%。
        const at = word.indexOf(item.part)
        if (at < 0 || item.part.length / word.length > 0.6) continue
        attach(word, { part: item.part, type: 'root', meaning: item.meaning, weak: true, ...(item.origin ? { origin: item.origin } : {}) })
        break
      }
    }
  }

  // 排序：按 part 在词里出现的位置，让「前缀 → 词根 → 后缀」顺序自然
  for (const word of Object.keys(out)) {
    out[word].sort((a, b) => {
      const indexOf = (item) => {
        const bare = item.part.replace(/^-|-$/g, '')
        const at = word.indexOf(bare)
        return at < 0 ? 999 : at
      }
      return indexOf(a) - indexOf(b)
    })
  }

  // 压缩：含义与来源在几万条里高度重复（「man, human」可能出现几百次），
  // 把含义收进一张表，条目里只存下标。实测能把体积压掉一半以上。
  const meaningTable = []
  const meaningIndex = new Map()
  const internMeaning = (text) => {
    const key = String(text ?? '')
    if (key === '') return -1
    let at = meaningIndex.get(key)
    if (at === undefined) {
      at = meaningTable.length
      meaningTable.push(key)
      meaningIndex.set(key, at)
    }
    return at
  }

  /** @type {Record<string, Array<Array<any>>>} */
  const compact = Object.create(null)
  for (const [word, items] of Object.entries(out)) {
    compact[word] = items.map((item) => {
      // 数组槽位：[part, type, 含义下标, origin, weak]
      const row = [item.part, item.type, internMeaning(item.meaning)]
      if (item.origin) row.push(item.origin)
      if (item.weak) row.push(true)
      return row
    })
  }

  const payload = { meanings: meaningTable, words: compact }
  const json = JSON.stringify(payload)
  writeFileSync(args.out, json)

  const covered = Object.keys(compact).length
  log('')
  log('════════ 产出 ════════')
  log(`  ${args.out}`)
  log(`  体积           ${mb(Buffer.byteLength(json))}`)
  log(`  有分析的词     ${covered.toLocaleString()} / ${words.size.toLocaleString()} = ${(100 * covered / words.size).toFixed(1)}%`)
  log('')

  // 自查：几个必须正确的词
  const checks = ['careless', 'homicide', 'unhappy', 'rewrite', 'biography', 'telephone', 'quickly', 'homeless']
  log('  抽查：')
  for (const word of checks) {
    const rows = compact[word]
    if (!rows) { log(`    ${word.padEnd(12)} （无）`); continue }
    log(`    ${word.padEnd(12)} ${rows.map((row) => `${row[0]}[${row[1]}]${row[4] ? '(弱)' : ''}`).join(' + ')}`)
  }
}

/** 展示用的 part：前缀补 `-`，后缀补 `-`，词根原样。 */
function displayPart(rawKey, part, type) {
  if (type === 'prefix') return `${part}-`
  if (type !== 'root') return `-${part}`
  return part
}

/** 复合条目（如 `lys, lyt, -lyze`）会拆出多个变体，全部都要参与匹配。 */
function variantsOf(rawKey) {
  return String(rawKey ?? '')
    .split(',')
    .map((part) => part.trim().replace(/\d+$/, '').replace(/^-+|-+$/g, '').trim())
    .filter((part) => part.length >= 2)
}

main().catch((error) => {
  console.error('构建失败：', error?.message ?? error)
  process.exit(1)
})
