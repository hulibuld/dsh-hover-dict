#!/usr/bin/env node
/**
 * build-packs.mjs —— 从现有词库切出可下载的词库包。
 *
 * 不需要任何外部下载：`data/dict.dat` 里每个词条已经带着考纲标签、
 * 词频、柯林斯星级与牛津标记，按这些字段切分就够了。
 *
 * 产出 `data/packs/<id>.dat`，格式与 dict.dat 同构（词头 → 槽位数组），
 * 客户端合并时直接 `entries[head] = entry` 即可。
 *
 * 用法：
 *   node scripts/build-packs.mjs            # 生成全部能做的包
 *   node scripts/build-packs.mjs --list     # 只看能生成哪些、各多少词
 *   node scripts/build-packs.mjs --only cet,kaoyan
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA_DIR = join(ROOT, 'data')
const PACKS_DIR = join(DATA_DIR, 'packs')

const log = (msg) => console.log(msg)
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

/**
 * 词库包定义。
 *
 * `select` 收到的是词条数组 `[senses, tags, frq, collins, oxford, ...]`。
 * 每个包只挑自己需要的词，输出时**原样保留整个词条**——
 * 义项、例句、变位都在里面，不要裁剪，否则切出来的词查不到细节。
 */
const PACK_DEFS = [
  {
    id: 'cet',
    name: '四六级专项',
    desc: 'CET-4 与 CET-6 考纲词汇，按词频排序。',
    select: (entry) => hasTag(entry, 'cet4') || hasTag(entry, 'cet6'),
  },
  {
    id: 'kaoyan',
    name: '考研英语专项',
    desc: '考研英语大纲词汇（ECDICT 的 ky 标签）。',
    select: (entry) => hasTag(entry, 'ky'),
  },
  {
    id: 'ielts',
    name: '雅思专项',
    desc: 'IELTS 高频词（ECDICT 的 ielts 标签）。',
    select: (entry) => hasTag(entry, 'ielts'),
  },
  {
    id: 'toefl',
    name: '托福专项',
    desc: 'TOEFL 学科词汇（ECDICT 的 toefl 标签）。',
    select: (entry) => hasTag(entry, 'toefl'),
  },
  {
    id: 'gre',
    name: 'GRE 专项',
    desc: 'GRE 高阶词汇（ECDICT 的 gre 标签），适合冲刺阶段。',
    select: (entry) => hasTag(entry, 'gre'),
  },
  {
    id: 'gaokao',
    name: '中高考基础',
    desc: '中考与高考考纲词汇，打底用。',
    select: (entry) => hasTag(entry, 'zk') || hasTag(entry, 'gk'),
  },
  {
    id: 'collins',
    name: '柯林斯星级词',
    desc: '柯林斯词典 1–5 星词汇，按使用频率分级。',
    select: (entry) => asNumber(entry[3]) > 0,
  },
  {
    id: 'collins5',
    name: '柯林斯 5 星核心',
    desc: '最常用的 5 星词汇，几百个，适合每天过一遍。',
    select: (entry) => asNumber(entry[3]) >= 5,
  },
  {
    id: 'oxford',
    name: '牛津 3000 核心',
    desc: '牛津核心词表收录的基础词汇。',
    select: (entry) => asNumber(entry[4]) === 1,
  },
  {
    id: 'top2000',
    name: '最高频 2000 词',
    desc: '按当代语料库词频排的前 2000 个词，覆盖日常阅读的大头。',
    select: (entry) => {
      const frq = asNumber(entry[2])
      return frq > 0 && frq <= 2000
    },
  },
]

/** 词条标签是空格分隔串或 null。 */
function hasTag(entry, tag) {
  const tags = entry?.[1]
  if (typeof tags !== 'string') return false
  return tags.split(/\s+/).includes(tag)
}

/** 槽位里的数字可能是 number 或 null。 */
function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 解析命令行参数。 */
function parseArgs(argv) {
  const out = { only: null, list: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--list') out.list = true
    if (argv[i] === '--only' && argv[i + 1]) {
      out.only = argv[i + 1].split(',').map((x) => x.trim()).filter(Boolean)
      i += 1
    }
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dictPath = join(DATA_DIR, 'dict.dat')
  if (!existsSync(dictPath)) {
    console.error(`找不到词库：${dictPath}`)
    process.exit(1)
  }

  log(`读词库 ${dictPath} ...`)
  const dict = JSON.parse(readFileSync(dictPath, 'utf8'))
  const words = Object.entries(dict)
  log(`      共 ${words.length.toLocaleString()} 个词条`)
  log('')

  const defs = args.only === null
    ? PACK_DEFS
    : PACK_DEFS.filter((def) => args.only.includes(def.id))
  if (defs.length === 0) {
    console.error(`没有匹配的包。可用：${PACK_DEFS.map((d) => d.id).join(', ')}`)
    process.exit(1)
  }

  // --list 只报数，不写盘
  if (args.list) {
    log('可生成的词库包：')
    for (const def of defs) {
      const count = words.filter(([, entry]) => safeSelect(def, entry)).length
      log(`  ${def.id.padEnd(12)} ${String(count).padStart(6)} 词   ${def.name}`)
    }
    return
  }

  if (!existsSync(PACKS_DIR)) mkdirSync(PACKS_DIR, { recursive: true })

  log('切分并写入 ...')
  const summary = []
  for (const def of defs) {
    const pack = {}
    for (const [head, entry] of words) {
      if (safeSelect(def, entry)) pack[head] = entry
    }
    const count = Object.keys(pack).length
    if (count === 0) {
      log(`  ${def.id.padEnd(12)} 跳过（0 词）`)
      continue
    }
    const json = JSON.stringify(pack)
    const bytes = Buffer.byteLength(json)
    const gz = gzipSync(json).length
    const outPath = join(PACKS_DIR, `${def.id}.dat`)
    writeFileSync(outPath, json)
    summary.push({ id: def.id, name: def.name, count, bytes, gz })
    log(`  ${def.id.padEnd(12)} ${String(count).padStart(6)} 词  ${kb(bytes).padStart(8)}  gzip ${kb(gz)}`)
  }

  log('')
  log('════════ 完成 ════════')
  log(`  输出目录 ${PACKS_DIR}`)
  log(`  共 ${summary.length} 个包`)
  const total = summary.reduce((sum, item) => sum + item.bytes, 0)
  log(`  展开后合计 ${mb(total)}（gzip 后 ${mb(summary.reduce((s, i) => s + i.gz, 0))}）`)
  log('')
  log('  这些包不需要下载：文件已经在本地，设置页开关只是决定查词时要不要合并。')
}

/** select 抛错不该带走整个构建。 */
function safeSelect(def, entry) {
  try {
    return def.select(entry) === true
  } catch {
    return false
  }
}

main()
