/**
 * importer.js —— 粘贴导入的解析层，全部纯函数。
 *
 * 为什么单独一个文件：解析规则（格式识别、词头抽取、释义/音标切分、跳过原因）
 * 是**能在 node 里直测**的逻辑，和 React 无关。设置页只负责把结果画成预览表，
 * 不负责猜文本长什么样。
 *
 * 支持五种来源（设计-v2 §B2）：
 *   plain   一行一词，或「词 音标 释义」单空格分隔
 *   csv     逗号分隔，首行可能是表头
 *   tsv     Tab 分隔（从 Excel/词书工具直接复制）
 *   json    合法 JSON 数组：字符串，或 {head|word, gloss|translation} 对象；
 *           也兼容本插件 exportAll 的备份（带 state/srs/bookId，恢复时原样保留）
 *   youdao  有道导出的整段：词 + /音标/ 或 [音标] + 释义，双空格分隔
 *
 * 输出形状固定为 `{ words, skipped, format }`：
 *   words[]   { head, gloss, phonetic, line, status, record? }
 *   skipped[] { line, raw, reason }
 *   status    'new'（将新增） | 'dup'（已在生词本） | 'nodict'（词库查不到）
 *
 * 「不静默丢行」：每一行没进入 words 都要在 skipped 里留一条原因。
 */

import { normalizeKey } from './word.js'

/** 认识的格式。 */
export const IMPORT_FORMATS = ['plain', 'csv', 'tsv', 'json', 'youdao']

/** 释义快照上限，与 wordbook 的 GLOSS_MAX 对齐。 */
const MAX_GLOSS = 120

/** 词头只认「字母开头 + 字母/撇号/连字符」，与 wordbook.importMany 同一条规则。 */
const HEAD_RE = /^[a-z][a-z'-]{0,63}$/

/** 汉字（含扩展 A 与常用标点区不参与判断）。 */
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/

/** 音标：/…/ 或 […] 。有道与 ECDICT 导出都用这两种写法。 */
const PHONETIC = /(\/[^/\n\r]{1,40}\/|\[[^\]\n\r]{1,40}\])/

/** 裸音标（列式导出里常见，没有斜杠外壳）：IPA 字符 + 重音符 + 字母数字，无汉字。 */
const BARE_PHONETIC = /^[a-zæɑɒɔəɜɪʊʌʃʒθðŋːˈˌˑ.,\s'-]{1,40}$/i

/**
 * 表头首字段。只在「这一行确实有多列」时才算表头 ——
 * 否则用户想导入单词 `word` 本身就会被吃掉。
 */
const HEADER_FIRST = new Set([
  'word', 'words', 'head', 'term', 'terms', 'spelling', 'english', 'no', 'index',
  '单词', '英文', '词汇', '词头', '序号',
  'phonetic', 'pron', '音标', 'pronunciation',
  'meaning', 'translation', 'gloss', '释义', '翻译', '中文', '词义',
])

/** 取第一行有内容的行（跳过空行与 # 注释）。 */
function firstContentLine(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    return line
  }
  return ''
}

/**
 * 识别文本格式。识别不出来一律当 plain（plain 是最宽松的，不会漏词）。
 *
 * @param {string} text
 * @returns {'plain'|'csv'|'tsv'|'json'|'youdao'}
 */
export function detectImportFormat(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'plain'
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return 'json'
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.words)) return 'json'
    } catch { /* 不是合法 JSON，继续按文本猜 */ }
  }
  const line = firstContentLine(text)
  if (line === '') return 'plain'
  if (line.includes('\t') && line.split('\t').filter((part) => part.trim() !== '').length >= 2) return 'tsv'
  if (line.includes(',') && line.split(',').filter((part) => part.trim() !== '').length >= 2) return 'csv'
  if (/\s{2,}/.test(line) && PHONETIC.test(line)) return 'youdao'
  return 'plain'
}

/** 把一行按格式切成若干字段。 */
function splitFields(line, format) {
  if (format === 'csv') return line.split(',').map((part) => part.trim())
  if (format === 'tsv') return line.split('\t').map((part) => part.trim())
  // plain / youdao：双空格或 Tab 分隔；单空格的分隔交给「首词 + 剩余」处理
  if (/\s{2,}|\t/.test(line)) return line.split(/\s{2,}|\t/).map((part) => part.trim())
  return null
}

/** 去掉包裹的引号与首尾空白。 */
const unquote = (value) => String(value ?? '').trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim()

/**
 * 造一行预览数据。
 *
 * @param {string} head 已 normalize 的词头
 * @param {string} gloss 中文释义（可能为空）
 * @param {string} phonetic 音标（带 /…/ 或 […] 外壳，可能为空）
 * @param {number} line 原始行号（JSON 用元素序号）
 * @param {{ isDup: Function, isKnown: Function }} probes
 */
function makeRow(head, gloss, phonetic, line, probes, extra) {
  const status = probes.isDup(head) ? 'dup' : probes.isKnown(head) ? 'new' : 'nodict'
  const row = { head, gloss, phonetic, line, status }
  if (extra && typeof extra === 'object') row.record = extra
  return row
}

/**
 * 从「首字段之外的剩余文本」里切出音标与释义。
 *
 * 音标只当识别标记：设计规定不单独建字段，写库时拼在 gloss 前缀。
 * 两种写法都认：带外壳的 `/…/`、`[…]`，以及 CSV/TSV 里单独一列的裸 IPA
 * （列式导出经常这样，如 `apple,ˈæpl,n. 苹果`）。
 */
function splitGlossAndPhonetic(rest) {
  const text = String(rest ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return { gloss: '', phonetic: '' }

  const match = PHONETIC.exec(text)
  if (match) {
    const phonetic = match[0]
    const without = `${text.slice(0, match.index)} ${text.slice(match.index + phonetic.length)}`
      .replace(/\s+/g, ' ').trim()
    return { gloss: HAN.test(without) ? without.slice(0, MAX_GLOSS) : '', phonetic }
  }

  // 裸 IPA：首段没有汉字、且带 IPA 专用字符，就当作音标摘掉
  const first = text.split(' ')[0]
  if (BARE_PHONETIC.test(first) && !HAN.test(first) && /[ˈˌːəɪʊʃʒθðŋæɑɒɔɜʌ]/.test(first)) {
    const without = text.slice(first.length).trim()
    return { gloss: HAN.test(without) ? without.slice(0, MAX_GLOSS) : '', phonetic: first }
  }

  return { gloss: HAN.test(text) ? text.slice(0, MAX_GLOSS) : '', phonetic: '' }
}

/** 文本行模式（plain / csv / tsv / youdao）。 */
function parseLines(text, format, opts) {
  const words = []
  const skipped = []
  const seen = new Set()
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.trim()
    const lineNo = i + 1
    if (line === '') {
      skipped.push({ line: lineNo, raw: '', reason: '空行' })
      continue
    }
    if (line.startsWith('#')) {
      skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '注释行' })
      continue
    }

    const fields = splitFields(line, format)
    // plain 模式下「单空格分隔」不算分隔符：首词就是词头，剩下的是释义
    const firstField = fields ? fields[0] : (line.split(/\s+/)[0] ?? '')
    const rest = fields
      ? fields.slice(1).join(' ')
      : line.split(/\s+/).slice(1).join(' ')

    // 表头：只有多列时才算，且只在还没收到任何词之前
    if (opts.skipHeader && words.length === 0 && fields && fields.length >= 2
      && HEADER_FIRST.has(unquote(firstField).toLowerCase())) {
      skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '表头行' })
      continue
    }

    // 首字段可能带引号或序号前缀；plain 模式首字段就是第一个非空白片段
    const head = normalizeKey(unquote(firstField))
    if (!HEAD_RE.test(head)) {
      skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '不是英文单词' })
      continue
    }
    if (seen.has(head)) {
      skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '重复行' })
      continue
    }
    seen.add(head)
    const { gloss, phonetic } = splitGlossAndPhonetic(rest)
    words.push(makeRow(head, gloss, phonetic, lineNo, opts))
  }

  return { words, skipped, format }
}

/** JSON 数组模式。 */
function parseJson(text, opts) {
  const words = []
  const skipped = []
  const seen = new Set()
  let parsed = null
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return {
      words,
      skipped: [{ line: 1, raw: text.trim().slice(0, 80), reason: 'JSON 解析失败' }],
      format: 'json',
    }
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.words) ? parsed.words : [])
  if (list.length === 0) {
    return { words, skipped: [{ line: 1, raw: '', reason: 'JSON 里没有词条' }], format: 'json' }
  }

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const lineNo = i + 1
    const isObject = item && typeof item === 'object' && !Array.isArray(item)
    const rawHead = isObject ? (item.head ?? item.word ?? '') : item
    const head = normalizeKey(unquote(rawHead))
    if (!HEAD_RE.test(head)) {
      skipped.push({ line: lineNo, raw: JSON.stringify(item).slice(0, 80), reason: '不是英文单词' })
      continue
    }
    if (seen.has(head)) {
      skipped.push({ line: lineNo, raw: JSON.stringify(item).slice(0, 80), reason: '重复行' })
      continue
    }
    seen.add(head)
    const gloss = isObject
      ? String(item.gloss ?? item.translation ?? item.meaning ?? '').trim().slice(0, MAX_GLOSS)
      : ''
    const phonetic = isObject && typeof item.phonetic === 'string' ? item.phonetic.trim() : ''
    // 备份恢复：整条记录原样带下去，importMany 会保住 state/srs/bookId
    words.push(makeRow(head, gloss, phonetic, lineNo, opts, isObject ? item : undefined))
  }

  return { words, skipped, format: 'json' }
}

/**
 * 解析用户粘贴/导入的内容，给出逐行预览。
 *
 * @param {string} text
 * @param {{
 *   isDup?: (head: string) => boolean,
 *   isKnown?: (head: string) => boolean,
 *   skipHeader?: boolean,
 * }} [opts]
 *   isDup：这个词是否已在生词本（决定 dup 徽章）
 *   isKnown：词库能否查到（决定 nodict 徽章）；不给就一律当查得到
 *   skipHeader：是否跳过表头行，默认 true
 * @returns {{
 *   words: Array<{head:string, gloss:string, phonetic:string, line:number, status:'new'|'dup'|'nodict', record?:object}>,
 *   skipped: Array<{line:number, raw:string, reason:string}>,
 *   format: 'plain'|'csv'|'tsv'|'json'|'youdao',
 * }}
 */
export function parseImportDetailed(text, opts) {
  const options = opts && typeof opts === 'object' ? opts : {}
  const probes = {
    isDup: typeof options.isDup === 'function' ? options.isDup : () => false,
    isKnown: typeof options.isKnown === 'function' ? options.isKnown : () => true,
  }
  if (typeof text !== 'string' || text.trim() === '') {
    return { words: [], skipped: [], format: 'plain' }
  }
  const format = detectImportFormat(text)
  const parsed = format === 'json'
    ? parseJson(text, probes)
    : parseLines(text, format, { ...probes, skipHeader: options.skipHeader !== false })
  return parsed
}

/**
 * 一行预览数据在写库时应该用的释义字符串。
 *
 * 音标不单独建字段（设计 §B2），拼在释义前缀里。
 *
 * @param {{ gloss?: string, phonetic?: string }} row
 * @returns {string}
 */
export function glossText(row) {
  if (!row || typeof row !== 'object') return ''
  const phonetic = typeof row.phonetic === 'string' ? row.phonetic.trim() : ''
  const gloss = typeof row.gloss === 'string' ? row.gloss.trim() : ''
  return `${phonetic} ${gloss}`.trim().slice(0, MAX_GLOSS)
}

/**
 * 预览汇总：识别多少词、新增/已存在/未收录各多少。
 *
 * @param {{ words: Array<{status:string}>, skipped: Array<object> }} parsed
 * @returns {{ total:number, fresh:number, dup:number, nodict:number, skipped:number }}
 */
export function summarizeImport(parsed) {
  const words = Array.isArray(parsed?.words) ? parsed.words : []
  const out = { total: words.length, fresh: 0, dup: 0, nodict: 0, skipped: Array.isArray(parsed?.skipped) ? parsed.skipped.length : 0 }
  for (const row of words) {
    if (row.status === 'dup') out.dup += 1
    else if (row.status === 'nodict') out.nodict += 1
    else out.fresh += 1
  }
  return out
}