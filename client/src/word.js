/**
 * word.js —— 「鼠标底下是哪个英文单词」的纯函数层。
 *
 * 本模块**不碰 DOM 事件、不碰词库、不碰 React**。输入是文本与节点内偏移，
 * 输出是一个边界清楚的区间描述。所有函数要么返回值，要么返回 null，绝不抛。
 *
 * 单词边界规则（比正则 `\b` 严格，因为 `\b` 认 `don't` 的撇号是边界）：
 *   - 词字符：`A-Z a-z` 与连字符（`-`）与撇号（`'`、`’`）；
 *   - 连字符和撇号**只有在两侧都是字母时**才算词内字符，
 *     所以 `well-known` 是一个词，而 `-well` 与 `well-` 不是；
 *   - 长度上限 64 字符：超了说明这不是一个词（可能是 base64 或 URL 残段）；
 *   - 纯数字、纯符号、含非拉丁字母（中文/日文/俄文…）一律不算英文单词。
 */

/**
 * 一个单词在某个文本节点内的位置。
 *
 * @typedef {object} WordHit
 * @property {Text} node
 * @property {number} start
 * @property {number} end
 * @property {string} text
 */

/** 拉丁字母（含带变音符的西欧字母）。 */
const LATIN = /[A-Za-z\u00C0-\u024F]/
const DIGIT = /[0-9]/

/**
 * 判断一个字符能否出现在英文单词**内部**。
 *
 * 数字也算：技术文本里 `utf8`、`sha256` 是真词，悬停它们应该能查
 * （查不到就显示未收录，但不能连命中都不给）。纯数字串由 wordAt 单独排除。
 *
 * @param {string} ch
 * @returns {boolean}
 */
export function isWordChar(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return false
  return LATIN.test(ch) || DIGIT.test(ch)
}

/**
 * 判断一个字符是不是「词的连接符」（连字符或撇号）。
 *
 * 撇号两种都认：直角 `'`（U+0027）与弯的 `’`（U+2019）。
 * 正文里渲染器有时会把直撇号换成弯的，不认就查不到 `don’t`。
 *
 * @param {string} ch
 * @returns {boolean}
 */
export function isJoiner(ch) {
  return ch === '-' || ch === "'" || ch === '\u2019' || ch === '\u2018'
}

/** 单词最大长度。超过就当它不是单词。 */
export const MAX_WORD_LEN = 64

/** 纯数字串不是要查的词（年份、编号、版本号）。 */
const ALL_DIGITS = /^[0-9]+$/

/**
 * 从文本里取「包含 offset 的那个英文单词」。
 *
 * @param {string} text - 通常是 `node.data`
 * @param {number} offset - 字符偏移（不是字节）
 * @param {{ preferLeft?: boolean }} [options]
 *   preferLeft：光标正好落在词尾右侧（offset === end）时是否向左借这个词。
 *   鼠标停在最后一个字母右半边时 caretRangeFromPoint 会给出 end。
 * @returns {{ start: number, end: number, text: string } | null}
 */
export function wordAt(text, offset, options) {
  if (typeof text !== 'string' || text.length === 0) return null
  const preferLeft = options?.preferLeft === true

  let index = Number(offset)
  if (!Number.isInteger(index)) return null
  if (index < 0 || index > text.length) return null

  const at = (i) => (i >= 0 && i < text.length ? text[i] : '')

  // 连接符判定：左右两侧都必须是字母
  const joinerInside = (i) => isJoiner(at(i)) && LATIN.test(at(i - 1)) && LATIN.test(at(i + 1))

  // 光标落在词外：只有明确要求时才向左借一格
  if (index === text.length || !isWordChar(at(index))) {
    if (preferLeft && index > 0 && isWordChar(at(index - 1))) index -= 1
    else return null
  }

  // 向左扩
  let start = index
  while (start > 0) {
    if (isWordChar(at(start - 1))) { start -= 1; continue }
    if (LATIN.test(at(start)) && joinerInside(start - 1)) { start -= 1; continue }
    break
  }

  // 向右扩
  let end = index + 1
  while (end < text.length) {
    if (isWordChar(at(end))) { end += 1; continue }
    if (LATIN.test(at(end - 1)) && joinerInside(end)) { end += 1; continue }
    break
  }

  // 连接符不能出现在词首或词尾
  while (start < end && isJoiner(at(start))) start += 1
  while (end > start && isJoiner(at(end - 1))) end -= 1

  const word = text.slice(start, end)
  if (word.length === 0 || word.length > MAX_WORD_LEN) return null
  if (ALL_DIGITS.test(word)) return null
  if (!LATIN.test(word)) return null

  return { start, end, text: word }
}

/**
 * 把用户看到的词形还原成查词用的规范键。
 *
 * 只做两件纯字符串的事：统一撇号、转小写。
 * 不做词形还原 —— 变位由词条自带的 forms 字段承担（见 dict.js）。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeKey(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/[\u2018\u2019]/g, "'").toLowerCase().trim()
}

/**
 * 兜底词形还原：只在 forms 索引查不到时用一次。
 *
 * @param {string} key - 已 normalize 过的小写词
 * @returns {string[]} 去重后的候选，长度 ≤ 8；原词**不**包含在内
 */
export function stemCandidates(key) {
  if (typeof key !== 'string' || key.length < 3) return []
  const out = []
  const push = (value) => {
    if (value && value.length >= 2 && value !== key && !out.includes(value)) out.push(value)
  }
  const doubled = (stem) => stem.length >= 2
    && stem[stem.length - 1] === stem[stem.length - 2]
    && !/[aeiou]/.test(stem[stem.length - 1])

  if (key.endsWith('ies')) push(key.slice(0, -3) + 'y')
  if (key.endsWith('ves')) { push(key.slice(0, -3) + 'f'); push(key.slice(0, -3) + 'fe') }
  if (key.endsWith('es')) push(key.slice(0, -2))
  if (key.endsWith('s') && !key.endsWith('ss')) push(key.slice(0, -1))

  if (key.endsWith('ied')) push(key.slice(0, -3) + 'y')
  if (key.endsWith('ed')) {
    const stem = key.slice(0, -2)
    push(stem)
    push(key.slice(0, -1))
    if (doubled(stem)) push(stem.slice(0, -1))
  }

  if (key.endsWith('ing')) {
    const stem = key.slice(0, -3)
    push(stem)
    push(stem + 'e')
    if (doubled(stem)) push(stem.slice(0, -1))
  }

  if (key.endsWith('est')) push(key.slice(0, -3))
  if (key.endsWith('er')) push(key.slice(0, -2))
  if (key.endsWith('ly')) { push(key.slice(0, -2)); push(key.slice(0, -2) + 'e') }

  return out.slice(0, 8)
}
