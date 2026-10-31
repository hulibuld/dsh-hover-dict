/**
 * selection.js —— 「用户选中了哪段文字」的读取层。
 *
 * 这是交互的入口：不靠悬停猜用户想查哪个词，而是等用户明确选中。
 *
 * 支持三种粒度，靠**选中内容自己**判断，不需要用户切换模式：
 *   - 一个词（`hello`）→ 查词典；
 *   - 一个短语或句子 → 走翻译；
 *   - 空白 / 中文 / 纯数字 → 不处理。
 *
 * 只**读** `window.getSelection()`，一个字节都不写正文。
 */

import { normalizeKey } from './word.js'

/** 选中内容的最长字符数。超过这个长度不再处理（多半是误选整篇）。 */
export const MAX_SELECTION_CHARS = 600

/** 单个词的最长长度。 */
const MAX_WORD_CHARS = 64

/** 一个英文词：字母开头，可含内部撇号/连字符。 */
const SINGLE_WORD = /^[A-Za-z][A-Za-z'\u2019-]{0,63}$/

/** 含至少两个英文词的短语/句子。 */
const HAS_MULTIPLE_WORDS = /[A-Za-z][^\s]*\s+[^\s]*[A-Za-z]/

/** 至少有一个拉丁字母。 */
const HAS_LATIN = /[A-Za-z]/

/** 汉字（含扩展区）。 */
const HAS_HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/

/**
 * 选中内容里汉字占「汉字 + 拉丁字母」的比例上限。
 *
 * 超过这个比例就不翻译。用户要的是「全英文才翻译」，
 * 但留一点余量：正文里偶尔夹一个中文词（人名、术语）不该让整段失效。
 *
 * 实测几种典型内容：
 *   纯英文句子        0%
 *   英文带个别中文词   8%
 *   中英混排          50%
 *   中文为主偶有英文   64%
 * 取 10% 能把后两种挡掉，又不误伤「This is a test 测试」这种顺带夹一个词的。
 */
const MAX_HAN_RATIO = 0.10

/**
 * 数一下汉字相对拉丁字母的占比。
 *
 * @param {string} text
 * @returns {number} 0–1；没有字母也没有汉字时返回 1（当作不该翻译）
 */
export function hanRatio(text) {
  if (typeof text !== 'string' || text === '') return 1
  const han = (text.match(new RegExp(HAS_HAN.source, 'g')) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  const total = han + latin
  if (total === 0) return 1
  return han / total
}

/**
 * 判断一段文本是不是「够纯的英文」，可以走翻译。
 *
 * 单词查询不走这条判断 —— 单个词本来就不会含中文。
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isTranslatable(text) {
  if (!HAS_LATIN.test(text)) return false
  return hanRatio(text) <= MAX_HAN_RATIO
}

/**
 * 选中内容的处理结果。
 *
 * @typedef {object} SelectionResult
 * @property {'word' | 'phrase'} kind
 * @property {string} text
 * @property {string} key
 * @property {Rect[]} rects
 * @property {boolean} collapsed
 */

/**
 * 把一段选中文本分类。
 *
 * 判据刻意简单：一个词就查词典，其余含英文的当句子翻译。
 *
 * @param {string} raw
 * @returns {{ kind: 'word', key: string } | { kind: 'phrase', text: string } | null}
 */
export function classifySelection(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length === 0 || text.length > MAX_SELECTION_CHARS) return null
  if (!HAS_LATIN.test(text)) return null

  if (!/\s/.test(text) && SINGLE_WORD.test(text)) {
    const key = normalizeKey(text)
    if (key.length === 0 || key.length > MAX_WORD_CHARS) return null
    return { kind: 'word', key }
  }

  // 中英混排：先判这一条，再判「是不是多词短语」。
  //
  // 顺序很重要：像「这个 tokenizers 的分词」这种，两个英文词之间夹着中文，
  // 用「词与词只隔空白」的正则根本匹配不上，会一路掉到最后的 null，
  // 界面就完全没反应。先按汉字占比拦下来，才能给出「跳过」的明确结果。
  if (HAS_HAN.test(text) && !isTranslatable(text)) {
    return { kind: 'skip', reason: 'mixed-language', text }
  }

  if (HAS_MULTIPLE_WORDS.test(text)) {
    return { kind: 'phrase', text }
  }

  // 单个「看起来像词但含数字」的东西（如 utf8）
  if (!/\s/.test(text) && /^[A-Za-z][A-Za-z0-9'-]{0,63}$/.test(text)) {
    const key = normalizeKey(text)
    if (key.length > 0) return { kind: 'word', key }
  }

  return null
}

/**
 * 读当前选区。
 *
 * @param {Document} doc
 * @returns {SelectionResult | null}
 */
export function readSelection(doc) {
  if (!doc || typeof doc.getSelection !== 'function') return null
  let selection = null
  try {
    selection = doc.getSelection()
  } catch {
    return null
  }
  if (selection === null || selection === undefined) return null
  if (typeof selection.rangeCount !== 'number' || selection.rangeCount === 0) return null

  const raw = selection.toString()
  const classified = classifySelection(raw)
  if (classified === null) return null

  const range = selection.getRangeAt(0)
  const rects = rectsOf(range)
  if (rects.length === 0) return null

  const text = raw.replace(/\s+/g, ' ').trim()
  return {
    kind: classified.kind,
    text: classified.kind === 'phrase' ? classified.text : text,
    key: classified.kind === 'word' ? classified.key : text,
    rects,
    collapsed: selection.isCollapsed === true,
  }
}

/**
 * 取一个 Range 覆盖的所有矩形，过滤掉 0 宽 0 高的空盒子。
 *
 * @param {Range} range
 * @returns {Rect[]}
 */
export function rectsOf(range) {
  if (!range || typeof range.getClientRects !== 'function') return []
  let raw
  try {
    raw = range.getClientRects()
  } catch {
    return []
  }
  const out = []
  for (let i = 0; i < raw.length; i += 1) {
    const rect = raw[i]
    if (!(rect.width > 0) || !(rect.height > 0)) continue
    out.push({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
  }
  return out
}

/**
 * 从屏幕坐标反查「点在哪个文本节点、哪个字符上」。
 *
 * 单击取词用这个：用户点一下，问浏览器这个坐标落在哪个字符。
 *
 * @param {Document} doc
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ node: Text, offset: number } | null}
 */
export function caretAtPoint(doc, clientX, clientY) {
  if (!doc || typeof clientX !== 'number' || typeof clientY !== 'number') return null

  if (typeof doc.caretRangeFromPoint === 'function') {
    let range = null
    try {
      range = doc.caretRangeFromPoint(clientX, clientY)
    } catch {
      return null
    }
    if (range === null) return null
    const node = range.startContainer
    if (node === null || node.nodeType !== 3) return null
    return { node, offset: range.startOffset }
  }

  if (typeof doc.caretPositionFromPoint === 'function') {
    let position = null
    try {
      position = doc.caretPositionFromPoint(clientX, clientY)
    } catch {
      return null
    }
    if (position === null || position.offsetNode === null) return null
    const node = position.offsetNode
    if (node.nodeType !== 3) return null
    return { node, offset: position.offset }
  }

  return null
}

/**
 * 量一个文本节点的某个字符区间在屏幕上的矩形。
 *
 * @param {Document} doc
 * @param {Text} node
 * @param {number} start
 * @param {number} end
 * @returns {Rect[]}
 */
export function rangeRects(doc, node, start, end) {
  if (!doc || !node) return []
  try {
    const range = doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return rectsOf(range)
  } catch {
    return []
  }
}

/**
 * 把一组矩形并成外接矩形。空数组返回 null。
 *
 * @param {ReadonlyArray<Rect>} rects
 * @returns {Rect | null}
 */
export function unionOf(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    if (!rect) continue
    if (rect.left < left) left = rect.left
    if (rect.top < top) top = rect.top
    if (rect.right > right) right = rect.right
    if (rect.bottom > bottom) bottom = rect.bottom
  }
  if (!Number.isFinite(left)) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * 判断一个坐标是否落在这些矩形（外扩 pad）内。
 *
 * @param {number} x
 * @param {number} y
 * @param {ReadonlyArray<Rect>} rects
 * @param {number} [pad]
 * @returns {boolean}
 */
export function hitsAny(x, y, rects, pad) {
  if (!Array.isArray(rects)) return false
  const grow = Number.isFinite(pad) ? pad : 0
  for (const rect of rects) {
    if (!rect) continue
    if (x >= rect.left - grow && x <= rect.right + grow
      && y >= rect.top - grow && y <= rect.bottom + grow) {
      return true
    }
  }
  return false
}
