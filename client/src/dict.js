/**
 * dict.js —— 词库的加载、索引与查询。
 *
 * 三块，边界清楚：
 *   1. `loadDictionary` 把两个文件拉进来、解析、建索引 —— 只跑一次；
 *   2. `lookup`         纯查询，不抛、不阻塞；
 *   3. `describeEntry`  把紧凑布局的 Entry 摊开成渲染层好用的形状。
 *
 * 为什么 Entry 是定长数组而不是对象：2 万词条 × 每个键名重复一次，
 * 光键名就是十几万字符。数组把这笔开销抹掉，代价是渲染前要摊一次
 * （见 docs/架构.md §4.2）。
 */

import { fetchAsset } from './net.js'
import { normalizeKey, stemCandidates } from './word.js'

/**
 * 词性 → 中文标签。数据里存的是 ECDICT 原文（带点），渲染时换成这个。
 * 查不到的（生僻词性）直接显示原文，不要显示空白。
 */
const POS_LABELS = {
  'n.': '名词', 'v.': '动词', 'vi.': '不及物', 'vt.': '及物',
  'a.': '形容词', 'adj.': '形容词', 'ad.': '副词', 'adv.': '副词',
  'prep.': '介词', 'conj.': '连词', 'pron.': '代词', 'num.': '数词',
  'art.': '冠词', 'int.': '感叹词', 'interj.': '感叹词', 'aux.': '助动词',
  'abbr.': '缩写', 'pl.': '复数', 'suff.': '后缀', 'pref.': '前缀',
}

/** 变位短键 → 中文标签。数据里存 `p:ran/i:running`，标签在这里补。 */
const FORM_LABELS = {
  p: '过去式', d: '过去分词', i: '现在分词',
  3: '第三人称单数', s: '复数', r: '比较级', t: '最高级',
}

/** 考纲标签 → 显示名。 */
const TAG_LABELS = {
  zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
  ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE',
}

/**
 * 一份加载好的词库。
 *
 * @typedef {object} Dictionary
 * @property {Record<string, any[]>} entries  词头 → 槽位数组
 * @property {Map<string, string>} formIndex  变位词形 → 词头
 * @property {{ schema: number, entries: number, examples: number, licenses: object }} meta
 */

/**
 * 把一个词性原文转成中文短标签。
 * @param {string} pos - 如 `n.`
 * @returns {string}
 */
export function posLabel(pos) {
  if (typeof pos !== 'string') return ''
  return POS_LABELS[pos] ?? POS_LABELS[pos.trim()] ?? pos.replace(/\.$/, '')
}

/**
 * 把考纲标签转成中文。未知标签原样返回。
 * @param {string} tag
 * @returns {string}
 */
function tagLabelLocal(tag) {
  return TAG_LABELS[tag] ?? tag
}

/**
 * 解析变位串 `p:ran/i:running` 成 `[['ran','过去式'],…]`。
 *
 * @param {string} raw
 * @returns {Array<[string, string]>}
 */
export function parseForms(raw) {
  if (typeof raw !== 'string' || raw === '') return []
  const out = []
  for (const part of raw.split('/')) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const form = part.slice(colon + 1).trim()
    const label = FORM_LABELS[part.slice(0, colon)] ?? '变位'
    if (form) out.push([form, label])
  }
  return out
}

/**
 * 造索引并返回 Dictionary。
 *
 * 索引两条：
 *   - entries：词头本身直接可查（对象键查找，O(1)）；
 *   - formIndex：遍历每个词条的变位串，把 `ran → run` 这类映射摊平。
 *     2 万个词条约 4 万次 Map.set，实测 5 毫秒级，一次性成本。
 *
 * @param {Record<string, any[]>} entries
 * @param {object} meta
 * @returns {Dictionary}
 */
export function buildIndex(entries, meta) {
  const formIndex = new Map()
  for (const head of Object.keys(entries)) {
    const entry = entries[head]
    if (!Array.isArray(entry)) continue
    // forms 永远在 senses/tags/frq/collins/oxford 之后、examples 之前，
    // 但有没有 examples 是不确定的，所以按类型找那个字符串槽。
    for (let i = 5; i < entry.length; i += 1) {
      const slot = entry[i]
      if (typeof slot !== 'string') continue
      for (const part of slot.split('/')) {
        const colon = part.indexOf(':')
        if (colon <= 0) continue
        const form = normalizeKey(part.slice(colon + 1))
        // 词头优先：`lay` 既是 lie 的过去式也是独立动词，查它应该出 lay 本身。
        // 所以变位映射**不覆盖**已在 entries 里的键。
        if (form && !Object.prototype.hasOwnProperty.call(entries, form) && !formIndex.has(form)) {
          formIndex.set(form, head)
        }
      }
    }
  }
  return { entries, formIndex, meta: meta ?? {} }
}

/**
 * 加载整个词库。只调用一次，结果缓存。
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<Dictionary>}
 */
export async function loadDictionary(signal) {
  const meta = await fetchAsset('meta.json', signal)
  if (meta?.schema !== 1) {
    const error = new Error('词库格式版本不受支持，请更新插件')
    error.code = 'E_BAD_JSON'
    throw error
  }
  const entries = await fetchAsset('dict.dat', signal)
  if (!entries || typeof entries !== 'object') {
    const error = new Error('词库文件损坏，请重新构建数据')
    error.code = 'E_BAD_JSON'
    throw error
  }
  const dict = buildIndex(entries, meta)
  if (typeof meta.entries === 'number' && Object.keys(entries).length !== meta.entries) {
    // 不一致不要抛：用户可能正在重跑数据脚本，半新半旧能查就先查
    if (typeof console !== 'undefined') {
      console.warn(`[dsh-hover-dict] 词库条数与 meta 不符：${Object.keys(entries).length} vs ${meta.entries}`)
    }
  }
  return dict
}

/**
 * 查一个词。
 *
 * 顺序：词头 → 变位索引 → 兜底词形还原。三次都查不到就是未收录。
 * 全程同步、不抛、不阻塞。
 *
 * @param {Dictionary} dict
 * @param {string} rawWord - 用户看到的原样词
 * @returns {{ head: string, entry: any[], matchedBy: 'head'|'form'|'stem' } | null}
 */
export function lookup(dict, rawWord) {
  if (!dict || typeof rawWord !== 'string') return null
  const key = normalizeKey(rawWord)
  if (!key) return null

  const entries = dict.entries
  if (Object.prototype.hasOwnProperty.call(entries, key)) {
    return { head: key, entry: entries[key], matchedBy: 'head' }
  }

  const viaForm = dict.formIndex.get(key)
  if (viaForm !== undefined && Object.prototype.hasOwnProperty.call(entries, viaForm)) {
    return { head: viaForm, entry: entries[viaForm], matchedBy: 'form' }
  }

  for (const candidate of stemCandidates(key)) {
    if (Object.prototype.hasOwnProperty.call(entries, candidate)) {
      return { head: candidate, entry: entries[candidate], matchedBy: 'stem' }
    }
    const stemmed = dict.formIndex.get(candidate)
    if (stemmed !== undefined && Object.prototype.hasOwnProperty.call(entries, stemmed)) {
      return { head: stemmed, entry: entries[stemmed], matchedBy: 'stem' }
    }
  }

  return null
}

/**
 * 把紧凑的 Entry 摊开成渲染层好用的形状。
 *
 * 只在**打开大卡片时**调用一次；悬停路径上不摊。
 *
 * @param {any[]} entry - 槽位数组
 * @returns {{
 *   senses: Array<{ pos: string, posLabel: string, zh: string[], en: string[] }>,
 *   tags: string[],
 *   tagsLabel: string[],
 *   frq: number,
 *   collins: number,
 *   oxford: boolean,
 *   forms: Array<[string, string]>,
 *   examples: Array<{ en: string, zh: string }>
 * }}
 */
export function describeEntry(entry) {
  const empty = { senses: [], tags: [], tagsLabel: [], frq: 0, collins: 0, oxford: false, forms: [], examples: [] }
  if (!Array.isArray(entry)) return empty

  const senses = []
  const rawSenses = Array.isArray(entry[0]) ? entry[0] : []
  for (const group of rawSenses) {
    if (!Array.isArray(group)) continue
    const pos = typeof group[0] === 'string' ? group[0] : ''
    const zh = Array.isArray(group[1]) ? group[1].filter((x) => typeof x === 'string') : []
    const en = Array.isArray(group[2]) ? group[2].filter((x) => typeof x === 'string') : []
    if (zh.length === 0 && en.length === 0) continue
    senses.push({ pos, posLabel: posLabel(pos), zh, en })
  }

  const tags = typeof entry[1] === 'string' ? entry[1].split(/\s+/).filter(Boolean) : []

  // 槽位 5 起是变位串与例句，两者都在但不是固定的谁先
  let forms = []
  let examples = []
  for (let i = 5; i < entry.length; i += 1) {
    const slot = entry[i]
    if (typeof slot === 'string') forms = parseForms(slot)
    else if (Array.isArray(slot)) {
      examples = slot
        .filter((pair) => Array.isArray(pair) && typeof pair[0] === 'string')
        .map((pair) => ({ en: pair[0], zh: typeof pair[1] === 'string' ? pair[1] : '' }))
    }
  }

  return {
    senses,
    tags,
    tagsLabel: tags.map(tagLabelLocal),
    frq: typeof entry[2] === 'number' ? entry[2] : 0,
    collins: typeof entry[3] === 'number' ? entry[3] : 0,
    oxford: entry[4] === 1,
    forms,
    examples,
  }
}

/**
 * 小浮层要显示的最小信息：第一条中文释义 + 词性 + 标签。
 *
 * @param {any[]} entry
 * @returns {{ pos: string, zh: string, tags: string[] }}
 */
export function briefOf(entry) {
  const described = describeEntry(entry)
  const first = described.senses.find((sense) => sense.zh.length > 0) ?? described.senses[0]
  return {
    pos: first?.posLabel ?? '',
    zh: first?.zh.slice(0, 2).join('；') ?? '',
    tags: described.tagsLabel,
  }
}
