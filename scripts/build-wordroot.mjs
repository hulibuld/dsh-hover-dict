#!/usr/bin/env node
/**
 * build-wordroot.mjs —— 生成词根词缀分析数据 data/wordroot.dat
 *
 * 输入
 *   --src   词根库（/tmp/wordroot.txt，ECDICT，MIT）。键是词根本身，
 *           值是 { meaning, class, example[], origin }。
 *   --dict  词库（data/dict.dat）。只给词库里真有的词建分析 —— 词根库
 *           一共 6795 个不重复例词，全塞进去大半用不上，还会把文件撑大。
 *
 * 输出
 *   --format compact（默认）
 *     { "meanings": ["man, human", ...],
 *       "words": { "homicide": [["hom","root",0,"Latin"],["-cide","root",2,"Latin"]] } }
 *     含义串去重成表，行里只存下标。客户端 client/src/app.js 的 lookupRoots()
 *     读的就是这个形状：row = [part, type, meaningIndex, origin?, weak?]。
 *     同样内容如果按扁平对象写要 1.7 MB，压缩后 0.6 MB —— 这是 800 KB 硬指标
 *     下唯一可行的形状。
 *   --format flat
 *     { "homicide": [{ "part":"hom","type":"root","meaning":"man, human","origin":"Latin" }, ...] }
 *     便于人眼检查，体积约 1.7 MB，不要拿去发版。
 *
 * 三档匹配，按可靠度从高到低
 *   1. example —— 词根条目自己列的例词，且要求该变体真的字面出现在词里
 *                 （前缀在词首、后缀在词尾）。最可靠。
 *   2. 前后缀 —— 词以某前缀开头 / 以某后缀结尾，且剩余部分是真词。
 *   3. 词根包含 —— 长度 ≥ 4 的词根，出现在词首或词中，词长 ≥ 词根 + 2。
 *                 误判率高，结果标 weak，界面上淡显。
 *
 * 防误判（误判比漏判伤害大，宁可漏）
 *   - 拆完剩下的连续碎片 < 2 字母就放弃这条拆分。唯一的例外是两个部件之间的
 *     单个连接元音（homicide 的 hom|i|cide），这是真实构词现象。
 *   - 2 字母前缀要求剩余 ≥ 3 字母 —— 否则 unit 会被拆成 un- + it。
 *   - 前缀/后缀后面剩下的必须在词库里是真词，且得是实词（名/动/形/副）。
 *     uncle 剩 cle（不是词）、unit 剩 it（代词）都会被挡掉。
 *   - 词干允许极保守的拼写还原：happi→happy、creat→create、runn→run。
 *   - 后缀的词性类型要和词条自身词性对得上：pretty 是形容词，就不接受
 *     名词后缀 -ty 拆出来的 cruel+ty。
 *   - 语义闸门：派生词与词干的汉字释义至少共享 1/3，否则不认。
 *     纯语法后缀（-ly -ness -ment 这类只变词性的）免检。
 *
 * 用法
 *   node scripts/build-wordroot.mjs
 *   node scripts/build-wordroot.mjs --src /tmp/wordroot.txt --out data/wordroot.dat
 *   node scripts/build-wordroot.mjs --dry-run --report --format flat
 */

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* ─────────────────────────── 参数 ─────────────────────────── */

const USAGE = `用法: node scripts/build-wordroot.mjs [选项]

  --src PATH        词根库，默认 /tmp/wordroot.txt
  --dict PATH       词库，默认 data/dict.dat
  --out PATH        输出，默认 data/wordroot.dat
  --format FMT      compact（默认，客户端格式）| flat（人眼检查用）
  --spot LIST       抽查词，逗号分隔
  --samples N       随机抽样条数，默认 20
  --dry-run         只算不写盘
  --report          打印抽查与随机抽样
  -h, --help        显示本说明`

function parseArgs(argv) {
  const opts = {
    src: '/tmp/wordroot.txt',
    dict: join(ROOT, 'data/dict.dat'),
    out: join(ROOT, 'data/wordroot.dat'),
    format: 'compact',
    spot: 'careless,homicide,unhappy,rewrite,biography,telephone,quickly,homeless',
    samples: 20,
    dryRun: false,
    report: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) die(`${arg} 缺参数值`)
      return v
    }
    switch (arg) {
      case '--src': opts.src = resolve(value()); break
      case '--dict': opts.dict = resolve(value()); break
      case '--out': opts.out = resolve(value()); break
      case '--format': opts.format = value(); break
      case '--spot': opts.spot = value(); break
      case '--samples': opts.samples = Number(value()); break
      case '--dry-run': opts.dryRun = true; break
      case '--report': opts.report = true; break
      case '-h': case '--help': console.log(USAGE); process.exit(0); break
      default: die(`不认识的参数 ${arg}\n\n${USAGE}`)
    }
  }
  if (!['compact', 'flat'].includes(opts.format)) die(`--format 只支持 compact / flat，收到 ${opts.format}`)
  if (!Number.isInteger(opts.samples) || opts.samples < 0) die('--samples 要是非负整数')
  return opts
}

function die(message) {
  console.error(`构建失败：${message}`)
  process.exit(1)
}

const log = (...args) => console.log(...args)
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

/* ────────────────────── 词根库 → 部件池 ────────────────────── */

const SUFFIX_CLASSES = new Set([
  'noun-forming suffix',
  'adjective-forming suffix',
  'verb-forming suffix',
  'adverb-forming suffix',
  'adjective- and noun-forming suffix',
])

function typeOf(cls) {
  if (cls === 'root') return 'root'
  if (cls === 'prefix') return 'prefix'
  if (SUFFIX_CLASSES.has(cls)) return 'suffix'
  return null
}

/** 后缀要求的词性。词条词性对不上就不认这条拆分。 */
function requiredPos(cls) {
  switch (cls) {
    case 'adjective-forming suffix': return ['adj.']
    case 'noun-forming suffix': return ['n.']
    case 'verb-forming suffix': return ['v.']
    case 'adverb-forming suffix': return ['adv.']
    case 'adjective- and noun-forming suffix': return ['adj.', 'n.']
    default: return null
  }
}

/**
 * 把词根键拆成多个变体。
 *
 * 键里可能塞了好几种写法：
 *   "cis, cid1, -cide"     逗号分隔的多个变体
 *   "a-1" / "-ly2"         末尾数字是区分同名条目的编号，不是词的一部分
 *   "arche (archae)"       括号是补充写法
 *   "-ably, -ibly"         两个后缀
 *
 * 每个变体都要单独参与匹配 —— 只取第一个的话，homicide 会被安上根本不在
 * 词里的 cis（旧脚本就是这么错的）。
 */
function parseVariants(key) {
  const out = []
  for (const raw of String(key ?? '').split(',')) {
    let s = raw.trim()
    if (!s) continue
    if (/^\(.*\)$/.test(s)) continue // "(archaeo)" 这类纯补充写法
    s = s.replace(/\(.*?\)/g, '').trim() // "arche (archae)" → "arche"
    s = s.replace(/\d+$/, '').trim() // "cid1" → "cid"
    if (!/^-?[A-Za-z]+-?$/.test(s)) continue
    const core = s.replace(/-/g, '')
    if (!core) continue
    out.push({
      surface: s,
      core,
      isSuffixForm: s.startsWith('-'),
      isPrefixForm: s.endsWith('-'),
    })
  }
  return out
}

function loadParts(srcPath) {
  const raw = JSON.parse(readFileSync(srcPath, 'utf8'))
  const parts = []
  const stats = { entries: 0, skippedClass: 0 }

  for (const [key, record] of Object.entries(raw)) {
    stats.entries++
    const type = typeOf(record?.class)
    if (!type) { stats.skippedClass++; continue }
    const meaning = String(record?.meaning ?? '').replace(/\s+/g, ' ').trim()
    const origin = String(record?.origin ?? '').trim()
    const examples = Array.isArray(record?.example) ? record.example : []
    const req = requiredPos(record?.class)

    for (const v of parseVariants(key)) {
      // 前后缀得靠连字符说明位置，否则 "-less" 会被当成能出现在词首的词根
      if (type === 'prefix' && !v.isPrefixForm) continue
      if (type === 'suffix' && !v.isSuffixForm) continue
      // 单字母前缀（a- / e- / o- / i-）整体不用。它们在例词档里也能钻空子
      // （ignorant 会被拆成 i- + gnor + -ant），而真正非它不可的词极少。
      if (type === 'prefix' && v.core.length < 2) continue
      parts.push({
        key,
        ...v,
        type,
        cls: record?.class ?? '',
        meaning: meaning || '(无释义)',
        origin,
        examples,
        requiredPos: req,
      })
    }
  }
  return { parts, stats }
}

/* ───────────────────────────── 词库 ───────────────────────────── */

const CONTENT_POS = new Set(['n.', 'v.', 'adj.', 'adv.'])

function loadDict(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  /** word → { pos:Set<string>, gloss:Set<string>, rank:number|null } */
  const words = new Map()

  for (const [head, entry] of Object.entries(raw)) {
    const w = String(head).toLowerCase()
    if (!/^[a-z]+$/.test(w)) continue // 只分析纯字母词；短语、连字符词跳过
    if (words.has(w)) continue

    const pos = new Set()
    const gloss = new Set()
    const senses = Array.isArray(entry) ? entry[0] : null
    if (Array.isArray(senses)) {
      for (const sense of senses) {
        if (!Array.isArray(sense)) continue
        if (typeof sense[0] === 'string' && sense[0]) pos.add(sense[0].trim().toLowerCase())
        if (Array.isArray(sense[1])) {
          for (const line of sense[1]) {
            if (typeof line !== 'string') continue
            for (const ch of line) if (/[\u4e00-\u9fff]/.test(ch)) gloss.add(ch)
          }
        }
      }
    }
    const rank = typeof entry?.[2] === 'number' ? entry[2] : null
    words.set(w, { pos, gloss, rank })
  }
  return words
}

/* ───────────────────────── 词干合法性 ───────────────────────── */

/**
 * 剩下的部分能不能当自由词素。
 *
 * 只认词库里真有的词，外加几条极保守的拼写还原：
 *   happiness → happi → happy      y 变 i
 *   creation  → creat → create     补 e
 *   running   → runn  → run        去双写辅音
 * uncle → cle 不在词库、unit → it 是代词，都过不去。
 *
 * 补 e 这条要收紧：只有词干自身不是词、补完才是词的时候才算还原。
 * immoral 剩下来的 mor 补成 more（副词「更」）就闹笑话了 —— mor 本身不是词，
 * 但 more 是，照着补会把「不道德」拆成 im- + more。所以只有当原词干的
 * 结尾辅音跟补出来的 e 之间确实存在「去 e 加缀」关系时才认。
 */
function resolveStem(stem, words, options = {}) {
  if (stem.length < 2) return null

  const tries = [stem]
  // strict 用于「没被任何部件覆盖的残段」：那里必须字面就是一个词。
  // 允许还原的话，literary 剩下的 ry 会补成 rye（黑麦），荒唐。
  if (!options.strict) {
    if (stem.endsWith('i')) tries.push(stem.slice(0, -1) + 'y')
    // 去双写辅音（running → runn → run）
    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) tries.push(stem.slice(0, -1))
    // 补 e（creation → creat → create）。只在词干本身不是词时才走这条，
    // 而且补出来的必须是个实词（create 是动词，more 也确实是副词 —— 所以
    // 还要靠下面的语义闸门兜底）。
    if (!words.has(stem)) tries.push(stem + 'e')
    // 去 -ation/-ion 之后剩下的词干补 "ate"（abbreviation → abbreviat → abbreviate）。
    // 这跟补 e 是同一类还原，只是多补两个字母；同样只在前几条都落空时才试。
    if (!words.has(stem) && /[iu]$/.test(stem)) {
      tries.push(stem + 'ate', stem + 'e')
    }
  }

  for (const t of tries) {
    const entry = words.get(t)
    if (!entry) continue
    // 剩下的必须是实词：代词、介词、连词、冠词、感叹词撑不起一个词根
    for (const p of entry.pos) {
      if (CONTENT_POS.has(p)) return { word: t, entry, restored: t !== stem }
    }
  }
  return null
}

function posAgrees(wordEntry, required) {
  if (!required?.length) return true
  if (!wordEntry || wordEntry.pos.size === 0) return true // 没词性信息就不因缺数据误杀
  for (const p of wordEntry.pos) if (required.includes(p)) return true
  return false
}

/**
 * 语义闸门：派生词和词干的中文释义至少共享 1/3 汉字。
 *
 * 只用来拦「形式像、语义无关」的拆分，比如 insect ≠ in- + sect、
 * witty ≠ wit + -ty。两侧任一没有中文释义时放行（不因缺数据误杀）。
 */
const GRAMMATICAL_SUFFIXES = new Set([
  'ly', 'ally', 'ness', 'ment', 'er', 'or', 'est', 'ing', 'ed',
  'ist', 'ism', 'ize', 'ise', 'ity', 'ty', 'ify', 'fy',
])

/** -ly 类后缀只接在形容词后。come 是动词，comely ≠ come + -ly。 */
const ADVERBIAL_SUFFIXES = new Set(['ly', 'ally', 'wise', 'ward', 'wards'])

function semanticRatio(wordEntry, stemEntry) {
  if (!wordEntry?.gloss.size || !stemEntry?.gloss.size) return null
  let shared = 0
  for (const ch of wordEntry.gloss) if (stemEntry.gloss.has(ch)) shared++
  return shared / Math.min(wordEntry.gloss.size, stemEntry.gloss.size)
}

function suffixSemanticsOk(wordEntry, stemEntry, suffixCore, stem) {
  // -ly 必须接在形容词后面才是副词。comely 自己是形容词、come 是动词，
  // 光看形式会拆成 come + -ly，这就是典型误判。
  if (ADVERBIAL_SUFFIXES.has(suffixCore) && !stem.entry.pos.has('adj.')) return false

  const ratio = semanticRatio(wordEntry, stemEntry)
  if (ratio === null) return true

  // 纯语法后缀只变词性，本不该要求语义重合 —— 但 tower ≠ tow + -er、
  // reader ≠ read + -er 这类「形式像施事名词、其实无关」的拆分会混进来。
  // 所以豁免是有条件的：至少共享一点语义，或者派生词比词干长得多
  // （-ness / -ation 这类长后缀，词干关系本来就牢）。
  if (GRAMMATICAL_SUFFIXES.has(suffixCore)) {
    if (ratio > 0) return true
    return suffixCore.length >= 4
  }

  return ratio >= 0.34
}

function prefixSemanticsOk(wordEntry, stemEntry) {
  const ratio = semanticRatio(wordEntry, stemEntry)
  return ratio === null ? true : ratio >= 0.25
}

/* ──────────────────────── 规则 1：例词 ──────────────────────── */

/**
 * 例词直接认作派生词，但必须字面成立：
 *   这个变体真的出现在词里，前缀在词首、后缀在词尾。
 * 没有这一步校验，homicide 会从 "cis, cid1, -cide" 里拿到根本不在词里的 cis，
 * biography 会被安上 bio, bi 里的 bi。
 */
function ruleExamples(parts, words) {
  const hits = new Map()
  for (const part of parts) {
    for (const example of part.examples) {
      if (typeof example !== 'string') continue
      const word = example.trim().toLowerCase()
      if (!/^[a-z]+$/.test(word)) continue
      const entry = words.get(word)
      if (!entry) continue // 词库里没有这个例词，跳过

      const at = word.indexOf(part.core)
      if (at < 0) continue
      if (part.type === 'prefix' && at !== 0) continue
      if (part.type === 'suffix' && at + part.core.length !== word.length) continue
      if (!posAgrees(entry, part.requiredPos)) continue

      let list = hits.get(word)
      if (!list) hits.set(word, (list = []))
      list.push({ start: at, end: at + part.core.length, part, source: 1 })
    }
  }
  return hits
}

/* ────────────────────── 规则 2：前后缀匹配 ────────────────────── */

function ruleAffixes(pools, words) {
  const hits = new Map()
  const push = (word, record) => {
    let list = hits.get(word)
    if (!list) hits.set(word, (list = []))
    list.push(record)
  }

  for (const word of words.keys()) {
    const entry = words.get(word)
    const len = word.length

    for (const part of pools.prefixes) {
      const cl = part.core.length
      // 单字母前缀（a- / e- / o- / i-）一律不用。它们能拼出 aback = a- + back、
      // ebony = e- + bony、aglow = ag- + low 这类看着像、其实无关的拆分，
      // 而真正需要它们的词（alone = a- + lone）少之又少 —— 不值这个误判率。
      if (cl < 2) continue
      if (len - cl < 2) continue // 兜底：剩余不足 2 字母，放弃
      if (cl <= 2 && len - cl < 3) continue // 2 字母前缀要剩余 ≥ 3，拦 unit → un- + it
      if (!word.startsWith(part.core)) continue
      const stem = resolveStem(word.slice(cl), words)
      if (!stem) continue
      if (!prefixSemanticsOk(entry, stem.entry)) continue
      push(word, { start: 0, end: cl, part, source: 2, stem: stem.word })
    }

    for (const part of pools.suffixes) {
      const cl = part.core.length
      if (cl < 2 && !(cl === 1 && len >= 5)) continue
      if (len - cl < 2) continue
      if (!word.endsWith(part.core)) continue
      if (!posAgrees(entry, part.requiredPos)) continue
      const stem = resolveStem(word.slice(0, len - cl), words)
      if (!stem) continue
      if (!suffixSemanticsOk(entry, stem.entry, part.core, stem)) continue
      push(word, { start: len - cl, end: len, part, source: 2, stem: stem.word })
    }
  }
  return hits
}

/* ───────────────────── 规则 3：词根包含匹配 ───────────────────── */

const ROOT_MIN_LENGTH = 4

/**
 * 词根出现在词首或词中，词根 ≥ 4 字母，词长 ≥ 词根 + 2。
 * 这一档误判率高，结果一律标 weak。词尾交给后缀规则，这里不重复认。
 */
function ruleRootContains(pools, words) {
  const hits = new Map()
  for (const word of words.keys()) {
    const len = word.length
    for (const part of pools.roots) {
      const cl = part.core.length
      if (cl < ROOT_MIN_LENGTH) continue
      if (len < cl + 2) continue
      const at = word.indexOf(part.core)
      if (at < 0) continue
      if (at !== 0 && at + cl >= len) continue
      let list = hits.get(word)
      if (!list) hits.set(word, (list = []))
      list.push({ start: at, end: at + cl, part, source: 3 })
    }
  }
  return hits
}

/* ──────────────────────── 合并与裁决 ──────────────────────── */

const MAX_PARTS = 4
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u'])

/**
 * 同一个词可能被多条规则命中，按可靠度裁决：
 *   1. 来源（例词 > 前后缀 > 弱词根）；
 *   2. 同来源里长的优先；
 *   3. 位置靠前的优先。
 * 选中后丢弃区间重叠的候选。
 */
function pickParts(candidates) {
  const sorted = candidates.slice().sort((a, b) => {
    if (a.source !== b.source) return a.source - b.source
    const la = a.end - a.start
    const lb = b.end - b.start
    if (la !== lb) return lb - la
    return a.start - b.start
  })
  const chosen = []
  for (const cand of sorted) {
    if (chosen.length >= MAX_PARTS) break
    if (chosen.some((old) => cand.start < old.end && old.start < cand.end)) continue
    chosen.push(cand)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

/**
 * 兜底纪律：拆完剩下的连续碎片少于 2 个字母，就整条放弃。
 *
 * 唯一例外是两个部件之间夹一个连接元音 —— homicide 的 hom|i|cide、
 * biography 的 bio|graphy 里没有这情况，但 -cide / -graphy 这类拉丁词根的
 * 连接元音是真实构词现象，不该因为这一个字母把整条分析丢掉。
 */
function residueOk(word, chosen) {
  if (chosen.length === 0) return false
  const covered = new Set()
  for (const c of chosen) for (let i = c.start; i < c.end; i++) covered.add(i)

  const gaps = []
  let run = null
  for (let i = 0; i <= word.length; i++) {
    const uncovered = i < word.length && !covered.has(i)
    if (uncovered) {
      if (!run) run = { start: i, length: 0 }
      run.length++
      continue
    }
    if (run) { gaps.push(run); run = null }
  }

  for (const gap of gaps) {
    if (gap.length >= 2) continue
    const between = gap.start > 0 && gap.start + 1 < word.length
    if (gap.length === 1 && between && VOWELS.has(word[gap.start])) continue
    return false
  }
  return true
}

/* ─────────────────────── 拼出最终分析 ─────────────────────── */

const FREE_BASE_MEANING = '(词根缺失，标注为自由词素)'

/**
 * 把选中的部件排成一条分析，并把没被任何部件覆盖的片段交代清楚。
 *
 * 空白片段按三种情况处理，从上到下：
 *   1. 正好是一个没被选中的前缀（词首）或后缀（词尾）→ 按词缀标。
 *      desecrate 拆出 secr + -ate 之后剩下的 "de" 是 de- 前缀，不是自由词素。
 *   2. 是个真词 → 如实标成自由词素。careless 剩下的 care 走这一条。
 *   3. 既不是词缀也不是词 → 这条分析留下了无法解释的字母，整条作废。
 *      accidentally 被硬套 -cide 之后剩下的 "ntal" 就属于这种，宁可不要。
 *
 * 不足 2 字母的空白不单独成条（连接元音、被拆剩的单个字母）。
 */
function buildRows(word, chosen, pools, words) {
  const covered = new Set()
  for (const c of chosen) for (let i = c.start; i < c.end; i++) covered.add(i)

  const gaps = []
  let run = null
  for (let i = 0; i <= word.length; i++) {
    const uncovered = i < word.length && !covered.has(i)
    if (uncovered) {
      if (!run) run = { start: i, end: i + 1 }
      else run.end = i + 1
      continue
    }
    if (run) { gaps.push(run); run = null }
  }

  const rows = chosen.map((c) => {
    const part = c.part
    const row = { part: part.surface, type: part.type, meaning: part.meaning, at: c.start }
    if (part.origin) row.origin = part.origin
    if (c.source === 3) row.weak = true
    return row
  })

  for (const gap of gaps) {
    if (gap.end - gap.start < 2) continue
    const text = word.slice(gap.start, gap.end)

    if (gap.start === 0) {
      const prefix = pools.prefixes.find((p) => p.core === text)
      if (prefix) {
        const row = { part: prefix.surface, type: prefix.type, meaning: prefix.meaning, at: gap.start }
        if (prefix.origin) row.origin = prefix.origin
        rows.push(row)
        continue
      }
    }
    if (gap.end === word.length) {
      const suffix = pools.suffixes.find((p) => p.core === text)
      if (suffix) {
        const row = { part: suffix.surface, type: suffix.type, meaning: suffix.meaning, at: gap.start }
        if (suffix.origin) row.origin = suffix.origin
        rows.push(row)
        continue
      }
    }

    // 残段先按字面查（literary 的 ry 不能补成 rye）。
    // 字面查不到，再给一次还原的机会 —— 但只在残段确实是个「派生词干」时：
    // abbreviation 去掉 -ation 剩下 abbrevi，要还原成 abbreviate 才讲得通；
    // 还要求还原出来的词跟整词语义对得上，否则又退回字面那条死路。
    const literal = resolveStem(text, words, { strict: true })
    const restored = literal ? null : resolveStem(text, words)
    const stem = literal ?? (
      restored && semanticRatio(words.get(word), restored.entry) !== null && semanticRatio(words.get(word), restored.entry) >= 0.34
        ? restored
        : null
    )
    // 残段跟整词一把酸菜都沾不上的，说明这条分析本来就拆错了：
    // veneer 被拆成 -vene + -er、剩下 veneer 的 vene 是个假词干；
    // phoney 被拆成 phon + -ey。宁可整条不要。
    if (stem) {
      const wholeEntry = words.get(word)
      const segRatio = stem.restored ? semanticRatio(wholeEntry, stem.entry) : null
      const unrelated = segRatio !== null && segRatio === 0 && text.length >= 4
      if (unrelated) return null
      // 中间那片如果是「词缀本身」（visionary 里 -vis 和 -ary 之间剩下的 ion
      // 正好是后缀 -ion），它不是自由词素，说明这条分析中间漏了连接成分。
      // 这种交给别的候选去争，本条作废。
      const isBareAffix = pools.suffixes.some((p) => p.core === text && p.core.length >= 2)
        || pools.prefixes.some((p) => p.core === text && p.core.length >= 2)
      // 2 字母残段（id / ad / ax）不单独当自由词素：rigid 会被拆成 rig + id。
      const tooShort = text.length < 3
      if (!isBareAffix && !tooShort) {
        rows.push({ part: text, type: 'root', meaning: FREE_BASE_MEANING, at: gap.start })
        continue
      }
    }

    return null // 交代不了的碎片，整条作废
  }
  rows.sort((a, b) => a.at - b.at)
  for (const row of rows) delete row.at
  return rows
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

function build(opts) {
  if (!existsSync(opts.src)) die(`找不到词根库 ${opts.src}`)
  if (!existsSync(opts.dict)) die(`找不到词库 ${opts.dict}`)

  log(`词根库  ${opts.src}`)
  log(`词库    ${opts.dict}`)
  log('')

  const words = loadDict(opts.dict)
  log(`词库可分析词条（纯字母）  ${words.size.toLocaleString()}`)

  const { parts, stats } = loadParts(opts.src)
  log(`词根条目                  ${stats.entries.toLocaleString()}（class 不可识别跳过 ${stats.skippedClass}）`)

  const byLength = (a, b) => b.core.length - a.core.length
  const pools = {
    prefixes: parts.filter((p) => p.type === 'prefix').sort(byLength),
    roots: parts.filter((p) => p.type === 'root').sort(byLength),
    suffixes: parts.filter((p) => p.type === 'suffix').sort(byLength),
  }
  log(`部件变体                  ${parts.length}（前缀 ${pools.prefixes.length} / 词根 ${pools.roots.length} / 后缀 ${pools.suffixes.length}）`)
  log('')

  const rule1 = ruleExamples(parts, words)
  const rule2 = ruleAffixes(pools, words)
  const rule3 = ruleRootContains(pools, words)

  log(`规则 1  例词            命中 ${rule1.size.toLocaleString()} 词`)
  log(`规则 2  前后缀          命中 ${rule2.size.toLocaleString()} 词`)
  log(`规则 3  弱词根包含      命中 ${rule3.size.toLocaleString()} 词`)

  // 人工确认过「形式像前缀+词干、但词源上毫无关系」的词。
  //
  // 这些词前面的几道闸门都拦不住：词干恰好在词库里存在、释义也沾边，
  // 但它们的真实来源跟那个前缀无关。与其把规则调得越来越紧（会误伤
  // colourful 这类正确拆分），不如把它们列出来。
  //
  // 只收经过人工核实的，不要往里堆没查过的词。
  const NO_SPLIT = new Set([
    'understand',    // under + stand，古英语 understandan，不是构词关系
    'understanding',
    'understood',
    'beside',        // 古英语 be sīdan「在…旁边」的固定短语，不是 be + side
    'besides',
    'beneath',       // be + neath 不是构词关系
    'between',       // 同上
    'betwixt',
    'beyond',        // 同上
    'before',        // 同上
    'beforehand',
    'behind',        // 同上
    'below',         // 同上
    'belong',        // 不是 be + long
    'belongings',
    'become',        // 不是 be + come
    'behold',        // 不是 be + hold
    'behave',        // 不是 be + have
    'behaviour',
    'behavior',
    'beware',
    'because',
    'underneath',    // 同上
    'withstand',     // 不是 with + stand
    'notwithstanding',
  ])

  const candidates = new Set(
    [...rule1.keys(), ...rule2.keys(), ...rule3.keys()].filter((word) => !NO_SPLIT.has(word)),
  )
  const result = new Map()
  const tally = { source1: 0, source2: 0, source3: 0, dropped: 0, weakRows: 0 }

  for (const word of candidates) {
    const pooled = [
      ...(rule1.get(word) ?? []),
      ...(rule2.get(word) ?? []),
      ...(rule3.get(word) ?? []),
    ]

    // 弱词根这一档误判率最高：flatly 里的 flat 被当成「吹」的词根，
    // 其实它就是 flat 这个词本身。凡是弱词根本身就是词库里一个词、
    // 而且词义对得上的，一律丢掉 —— 让它作为自由词素出场，
    // 比安一个风马牛不相及的古词根强。
    // 弱词根两处收紧：
    //   1. 它本身就是词库里的词、还跟整词语义对得上时丢掉 ——
    //      flatly 里的 flat 被当成「吹」的词根，其实它就是 flat 本身；
    //   2. 占了整词六成以上的长度就丢掉 —— veneer 的 -vene（来）、
    //      phoney 的 phon（声音）都是这种「几乎吃下整个词」的假词根，
    //      配上一条后缀就凑出个看着很像的分析。
    const filtered = pooled.filter((c) => {
      if (c.source !== 3) return true
      if (c.part.core.length / word.length > 0.6) return false
      const entry = words.get(c.part.core)
      if (!entry) return true
      const ratio = semanticRatio(words.get(word), entry)
      return ratio === null || ratio < 0.34
    })

    // 逐个丢掉最不可靠的成分再试。
    // 例词给的拆分偶尔会在词里留下解释不了的字母：abbreviation 被 ab- 那条
    // 例词认领之后只剩 ab-，后面的 breviation 交代不了。这时不该把整条分析
    // 废掉，而是把这一条剔出去，让后面的候选（-ation 之类）补上来重试。
    let pool = filtered.slice()
    let chosen = null
    let rows = null
    while (pool.length > 0) {
      const attempt = pickParts(pool)
      if (residueOk(word, attempt)) {
        const built = buildRows(word, attempt, pools, words)
        if (built && built.length > 0) { chosen = attempt; rows = built; break }
      }
      // 剔掉当前尝试里最不可靠的那一条，再试
      const weakest = attempt.length > 0
        ? attempt.reduce((a, b) => (b.source > a.source ? b : a))
        : pool.reduce((a, b) => (b.source > a.source ? b : a))
      pool = pool.filter((c) => c !== weakest)
    }

    if (!rows || rows.length === 0) { tally.dropped++; continue }

    for (const c of chosen) tally[`source${c.source}`]++
    for (const row of rows) if (row.weak) tally.weakRows++
    result.set(word, rows)
  }

  log(`残余校验丢弃             ${tally.dropped.toLocaleString()} 词`)
  log(`成分来源                 例词 ${tally.source1.toLocaleString()} / 前后缀 ${tally.source2.toLocaleString()} / 弱词根 ${tally.source3.toLocaleString()}`)
  log('')

  return { result, words, tally, pools }
}

/* ────────────────────────── 序列化 ────────────────────────── */

function serialize(result, format) {
  if (format === 'flat') {
    const out = {}
    for (const word of [...result.keys()].sort()) {
      out[word] = result.get(word).map((row) => {
        const item = { part: row.part, type: row.type, meaning: row.meaning }
        if (row.origin) item.origin = row.origin
        if (row.weak) item.weak = true
        return item
      })
    }
    return out
  }

  // compact：含义串去重成表，行里只存下标
  const meanings = []
  const index = new Map()
  const intern = (text) => {
    if (!text) return -1
    let at = index.get(text)
    if (at === undefined) {
      at = meanings.length
      meanings.push(text)
      index.set(text, at)
    }
    return at
  }

  const compact = {}
  for (const word of [...result.keys()].sort()) {
    compact[word] = result.get(word).map((row) => {
      // 槽位：[part, type, 含义下标, origin, weak]
      const slot = [row.part, row.type, intern(row.meaning)]
      if (row.origin) slot.push(row.origin)
      if (row.weak) slot.push(true)
      return slot
    })
  }
  return { meanings, words: compact }
}

/* ─────────────────────────── 报告 ─────────────────────────── */

const SPOT_EXPECT = {
  careless: ['-less'],
  homicide: ['hom', '-cide'],
  unhappy: ['un-'],
  rewrite: ['re-'],
  biography: ['bio', '-graphy'],
  telephone: ['tele', '-phone'],
  quickly: ['-ly'],
  homeless: ['-less'],
}

function judgeSpot(word, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  const found = rows.map((r) => r.part)
  const need = SPOT_EXPECT[word]
  if (need) return need.every((part) => found.includes(part))
  // biography / telephone 的 -graphy / -phone 允许写成 graph / phon 或带连字符的变体
  if (word === 'biography') return found.includes('bio') && found.some((p) => p.replace(/^-/, '').startsWith('graph'))
  if (word === 'telephone') return found.includes('tele') && found.some((p) => p.replace(/^-/, '').startsWith('phon'))
  return true
}

/** 固定种子的洗牌，重跑抽样一致，便于对照。 */
function shuffle(list, seed = 20261031) {
  const out = list.slice()
  let state = seed
  const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function printReport(result, words, opts, bytes) {
  const covered = result.size
  const total = opts.totalEntries
  log('════════════ 产出 ════════════')
  log(`  文件        ${relative(ROOT, opts.out) || opts.out}`)
  log(`  格式        ${opts.format}`)
  log(`  体积        ${bytes.toLocaleString()} 字节 = ${kb(bytes)}`)
  log(`  有分析的词  ${covered.toLocaleString()} / ${total.toLocaleString()} = ${((covered / total) * 100).toFixed(1)}%`)
  log('')

  log('抽查（8 个必须正确）')
  let pass = 0
  for (const word of opts.spot.split(',').map((s) => s.trim()).filter(Boolean)) {
    const rows = result.get(word)
    const ok = judgeSpot(word, rows)
    if (ok) pass++
    log(`  ${ok ? '✓' : '✗'} ${word.padEnd(12)} ${JSON.stringify(rows ?? null)}`)
  }
  log(`  通过 ${pass}/${opts.spot.split(',').filter(Boolean).length}`)
  log('')

  // 零件字面校验：每个 part 去掉连字符后必须真的出现在词里
  let rows = 0
  let absent = 0
  const absentExamples = []
  for (const [word, list] of result) {
    for (const row of list) {
      rows++
      const bare = row.part.replace(/^-|-$/g, '')
      if (!word.includes(bare)) {
        absent++
        if (absentExamples.length < 10) absentExamples.push(`${word} → ${row.part}`)
      }
    }
  }
  log(`零件字面校验  ${rows.toLocaleString()} 行中 ${absent} 行对不上${absent ? `：${absentExamples.join('，')}` : '（全部在词里真实存在）'}`)
  log('')

  const sampleWords = shuffle([...result.keys()], 20261031).slice(0, opts.samples)
  log(`随机抽样 ${sampleWords.length} 条（seed 20261031）`)
  for (const word of sampleWords) {
    log(`  ${word.padEnd(16)} ${JSON.stringify(result.get(word))}`)
  }
}

/* ─────────────────────────── 入口 ─────────────────────────── */

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const started = Date.now()

  const { result, words, tally } = build(opts)

  const payload = serialize(result, opts.format)
  const json = JSON.stringify(payload)
  const bytes = Buffer.byteLength(json, 'utf8')

  // 覆盖率的分母用词库全部词条（20,499），不是纯字母词数
  opts.totalEntries = countDictEntries(opts.dict)

  if (opts.dryRun) {
    log(`--dry-run：算出 ${bytes.toLocaleString()} 字节（${kb(bytes)}），未写盘`)
  } else {
    writeFileSync(opts.out, json)
    const onDisk = statSync(opts.out).size
    log(`已写入 ${relative(ROOT, opts.out) || opts.out}：${onDisk.toLocaleString()} 字节（${kb(onDisk)}）`)
  }
  log('')

  if (opts.report) {
    printReport(result, words, opts, bytes)
    log('')
  }

  log(`耗时 ${((Date.now() - started) / 1000).toFixed(2)}s`)
}

function countDictEntries(path) {
  return Object.keys(JSON.parse(readFileSync(path, 'utf8'))).length
}

main()
