/**
 * marker.js —— 正文/思考区生词着色（设计-v2 §C）。
 *
 * 用户需求原话：不会的单词在思考过程中是红色（可改颜色也可选择直接不变颜色），
 * 一眼看见自己之前不会的词。
 *
 * 本文件分三层，边界刻意分开：
 *   1. **纯函数层**（本任务主体）：词集展开、文本词匹配、视口裁剪、上限截断、
 *      扫描器、重算调度器 —— 全部不碰 React，可以 `node client/test/_marker.mjs` 直测；
 *   2. **量矩形**：只读 `Range.getClientRects()`，与 anchor.js 同一思路；
 *   3. **MarkerLayer**：把已经算好的色块画成 `position:fixed` 的 div，
 *      渲染进 `shell.overlay`（唯一 `h`/React 依赖点，由构建前导注入）。
 *
 * 红线（设计 §0 / 架构 §2）：**绝不改正文 DOM**。这里不建 span、不改正文节点属性、
 * 不写 textContent。着色只画在覆盖层里，垫在文字底下。
 *
 * 思考区判定用 `[data-variant="think"]`（设计 §G 已从宿主产物核实）。
 */

import { SELECTORS, HIT_BLOCKERS } from './hit.js'
import { normalizeKey } from './word.js'
import { DEFAULT_MARK_COLOR, MARK_STYLES, THEME_ERROR_COLOR } from './config.js'

/** 主路径：CSS Custom Highlight API 的注册名（正文/思考生词）。 */
export const HIGHLIGHT_WORDS = 'dsh-hover-dict-words'

/** 已掌握词单独一个 highlight（淡色；用户开了「已掌握也显示」才用）。 */
export const HIGHLIGHT_KNOWN = 'dsh-hover-dict-known'

/** 单帧色块上限。超出按距视口中心距离取最近的（设计 §C2.3，**仅回退路径**）。 */
export const MARK_MAX = 400

/** 视口裁剪余量：上下左右各留这么多像素，滚动手感不会缺一块。 */
export const VIEWPORT_PAD_PX = 200

/** 滚动重算节流间隔（设计 §C2.4）。 */
export const SCROLL_THROTTLE_MS = 120

/** 正文变化的防抖间隔。流式输出期间靠它把重渲染合并成低频重算（§G 硬要求）。 */
export const MUTATION_DEBOUNCE_MS = 250

/** 思考区根节点的特征属性。折叠时正文不在 DOM，TreeWalker 天然扫不到。 */
export const THINK_SELECTOR = '[data-variant="think"]'

/**
 * 词匹配用的正则：字母开头，后可跟字母、撇号（直/弯）、连字符，总长 ≤ 64。
 * 与 word.js 的 MAX_WORD_LEN 口径一致。
 */
export const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]{0,63}/g

/** 一个矩形，视口坐标系（与 getBoundingClientRect 一致）。 */
/**
 * @typedef {object} MarkerRect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * 一次词命中：文本节点内的字符区间 + 归一化后的词键。
 *
 * @typedef {object} MarkerHit
 * @property {Text} node
 * @property {number} start
 * @property {number} end
 * @property {string} text   原文片段（保留大小写，仅用于调试与日志）
 * @property {string} key    normalizeKey 之后的键，查词集用
 * @property {boolean} think 是否落在思考区
 */

/**
 * 一个待画的色块组：一个命中的全部矩形（跨行会有多段）。
 *
 * @typedef {object} MarkerMark
 * @property {string} key
 * @property {string} text
 * @property {boolean} think
 * @property {boolean} known  词集里带「已掌握」标记的词（淡色显示）
 * @property {MarkerRect[]} rects
 * @property {MarkerRect | null} bounds
 */

/* ── 小工具 ─────────────────────────────────────────────────────────── */

const isNum = (value) => typeof value === 'number' && Number.isFinite(value)

const rectOf = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const left = isNum(raw.left) ? raw.left : NaN
  const top = isNum(raw.top) ? raw.top : NaN
  const right = isNum(raw.right) ? raw.right : (isNum(raw.width) && isNum(left) ? left + raw.width : NaN)
  const bottom = isNum(raw.bottom) ? raw.bottom : (isNum(raw.height) && isNum(top) ? top + raw.height : NaN)
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** 一组矩形取并集；空数组返回 null。 */
export function unionRectsOf(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const raw of rects) {
    const rect = rectOf(raw)
    if (!rect) continue
    if (rect.left < left) left = rect.left
    if (rect.top < top) top = rect.top
    if (rect.right > right) right = rect.right
    if (rect.bottom > bottom) bottom = rect.bottom
  }
  if (left === Infinity) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/* ── C1.1 词集展开 ─────────────────────────────────────────────────── */

/**
 * 把生词本展开成「要着色的词键集合」。
 *
 * 口径（设计 §C1）：
 *   - 只取 `state !== 'known'` 的词；`known` 默认不着色（已掌握就不该再刺眼），
 *     设置里开 `markKnown` 才收进来（渲染时给淡色）；
 *   - 每个词头连同它的**变位**一起收：变位串在词条槽 5 起、格式 `p:ran/i:running`，
 *     与 dict.js `parseForms` / app.js `collectBookSet` 同一条规则
 *     （架构.md 旧文档写的槽 3 已作废，别按那个写）。
 *
 * 词集为空是常态（新用户），调用方据此直接清空色块、跳过整轮扫描。
 *
 * @param {object} input
 * @param {Iterable<{ head: string, state?: string }>} [input.entries] 生词本 list()
 * @param {{ entries?: Record<string, any[]> } | null} [input.dict]     词库（可选）
 * @param {boolean} [input.markKnown] 是否连已掌握的词一起收
 * @returns {Map<string, boolean>} 键 → 是否「已掌握」（true 时渲染淡色）
 */
export function expandWordSet(input) {
  const out = new Map()
  const entries = input?.entries
  if (!entries) return out
  const dict = input?.dict ?? null
  const markKnown = input?.markKnown === true

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const head = normalizeKey(entry.head)
    if (!head) continue
    const known = entry.state === 'known'
    if (known && !markKnown) continue
    out.set(head, known)

    const node = dict?.entries?.[head]
    if (!Array.isArray(node)) continue
    for (let i = 5; i < node.length; i += 1) {
      const slot = node[i]
      if (typeof slot !== 'string') continue
      for (const part of slot.split('/')) {
        const colon = part.indexOf(':')
        if (colon <= 0) continue
        const form = normalizeKey(part.slice(colon + 1))
        // 变位表单里可能自带句尾标点，normalizeKey 只处理撇号与大小写，这里再裁一次
        const trimmed = form.replace(/^[^a-z]+|[^a-z'-]+$/g, '')
        if (!trimmed) continue
        // 词头比变位优先：已知的词头不要被变位的淡色标记覆盖
        if (out.has(trimmed) && !out.get(trimmed)) continue
        out.set(trimmed, known)
      }
    }
  }
  return out
}

/* ── C1.2 文本节点词匹配 ───────────────────────────────────────────── */

/**
 * 在一个文本节点的字符串里找出所有「在词集里」的词。
 *
 * 正则 `/[A-Za-z][A-Za-z'’-]{0,63}/g`，normalizeKey 后查 Set —— 大小写不敏感。
 * 不处理词组、不做词形还原（变位已经在词集里了）。
 *
 * @param {string} text
 * @param {Map<string, boolean> | Set<string>} keys
 * @returns {Array<{ start: number, end: number, text: string, key: string, known: boolean }>}
 */
export function matchWordsInText(text, keys) {
  const out = []
  if (typeof text !== 'string' || text === '' || !keys) return out
  const isMap = typeof keys.get === 'function'
  const has = typeof keys.has === 'function'
    ? (key) => keys.has(key)
    : (key) => typeof keys[key] === 'boolean'

  WORD_PATTERN.lastIndex = 0
  let match = WORD_PATTERN.exec(text)
  while (match !== null) {
    const raw = match[0]
    // 正则允许词尾是撇号/连字符（`don't` 的撇号在中间，`well-` 在词尾是断词），裁掉
    const trimmed = raw.replace(/['’-]+$/, '')
    if (trimmed.length >= 2) {
      const key = normalizeKey(trimmed)
      if (key && has(key)) {
        out.push({
          start: match.index,
          end: match.index + trimmed.length,
          text: trimmed,
          key,
          known: isMap ? keys.get(key) === true : false,
        })
      }
    }
    match = WORD_PATTERN.exec(text)
  }
  return out
}

/* ── C1.3 视口裁剪与上限截断 ───────────────────────────────────────── */

/**
 * 只留与「视口 + 余量」相交的矩形。
 *
 * @param {MarkerRect[] | Array<{ rects?: MarkerRect[] }>} input
 * @param {{ left: number, top: number, right: number, bottom: number } | { width: number, height: number }} viewport
 * @param {number} [pad] 默认 ±200px
 * @returns {MarkerRect[]}
 */
export function cullToViewport(input, viewport, pad) {
  const list = Array.isArray(input) ? input : []
  if (list.length === 0) return []
  const margin = isNum(pad) ? pad : VIEWPORT_PAD_PX
  const box = normalizeViewport(viewport, margin)
  if (!box) return list.map(rectOf).filter(Boolean)
  const out = []
  for (const item of list) {
    const rect = rectOf(item)
    if (!rect) continue
    if (rect.right < box.left || rect.left > box.right) continue
    if (rect.bottom < box.top || rect.top > box.bottom) continue
    out.push(rect)
  }
  return out
}

/**
 * 把视口形状统一成带余量的包围盒。接受 `{left,top,right,bottom}` 或 `{width,height}`。
 *
 * @param {object} viewport
 * @param {number} pad
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
export function normalizeViewport(viewport, pad) {
  const margin = isNum(pad) ? pad : VIEWPORT_PAD_PX
  if (!viewport || typeof viewport !== 'object') return null
  if ([viewport.left, viewport.top, viewport.right, viewport.bottom].every(isNum)) {
    return {
      left: viewport.left - margin,
      top: viewport.top - margin,
      right: viewport.right + margin,
      bottom: viewport.bottom + margin,
    }
  }
  if (isNum(viewport.width) && isNum(viewport.height)) {
    return {
      left: (isNum(viewport.scrollX) ? -viewport.scrollX : 0) - margin,
      top: (isNum(viewport.scrollY) ? -viewport.scrollY : 0) - margin,
      right: viewport.width - (isNum(viewport.scrollX) ? viewport.scrollX : 0) + margin,
      bottom: viewport.height - (isNum(viewport.scrollY) ? viewport.scrollY : 0) + margin,
    }
  }
  return null
}

/**
 * 从 document/window 读当前视口（真实运行环境用；测试里可直接传 viewport 对象）。
 *
 * @param {Document | null} doc
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
export function viewportOf(doc) {
  const win = doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
  if (!win || !isNum(win.innerWidth) || !isNum(win.innerHeight)) return null
  return { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }
}

/**
 * 上限截断：色块数超过 `max` 时，按「距视口中心距离」从近到远取前 max 个。
 *
 * 为什么按中心距离而不是 DOM 顺序：用户眼睛盯着屏幕中间，先保中间的可读性；
 * 一屏 400 个色块已经是失控状态（正常一屏几十个），保近处比保「文档前面」有用。
 *
 * @template {{ rects?: MarkerRect[], bounds?: MarkerRect | null }} T
 * @param {T[]} marks
 * @param {{ max?: number, viewport?: object | null }} [options]
 * @returns {T[]}
 */
export function capMarks(marks, options) {
  const list = Array.isArray(marks) ? marks : []
  const max = isNum(options?.max) && options.max > 0 ? Math.floor(options.max) : MARK_MAX
  if (list.length <= max) return list

  const box = normalizeViewport(options?.viewport, 0)
  const cx = box ? (box.left + box.right) / 2 : 0
  const cy = box ? (box.top + box.bottom) / 2 : 0

  const ranked = list.map((mark, index) => {
    const bounds = rectOf(mark?.bounds) ?? unionRectsOf(mark?.rects ?? [])
    if (!bounds) return { mark, index, distance: Infinity }
    const dx = (bounds.left + bounds.right) / 2 - cx
    const dy = (bounds.top + bounds.bottom) / 2 - cy
    return { mark, index, distance: dx * dx + dy * dy }
  })

  // 同距离保持原顺序（稳定排序），否则滚动时色块会无规律跳动
  ranked.sort((a, b) => (a.distance - b.distance) || (a.index - b.index))
  return ranked.slice(0, max).sort((a, b) => a.index - b.index).map((row) => row.mark)
}

/* ── C1.4 扫描器（TreeWalker） ─────────────────────────────────────── */

/**
 * 判定一个元素是不是「不许着色」的区域（复用 hit.js 的 HIT_BLOCKERS，不重写判定）。
 *
 * @param {Element | null} el
 * @returns {{ blocked: boolean, reason: string }}
 */
export function blockerOf(el) {
  if (!el || typeof el.closest !== 'function') return { blocked: false, reason: 'unknown' }
  for (const blocker of HIT_BLOCKERS) {
    let hit = false
    try { hit = blocker.matches(el) === true } catch { hit = false }
    if (hit) return { blocked: true, reason: blocker.reason }
  }
  return { blocked: false, reason: 'ok' }
}

/**
 * 收集一个根节点下的全部文本节点（文档顺序）。
 *
 * 优先用 `doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)`；环境/测试桩没有它时
 * 退化成递归遍历，结果顺序一致。**退化路径是给 node 单测用的**，真实浏览器永远走 TreeWalker。
 *
 * @param {Document | null} doc
 * @param {Node | null} root
 * @returns {Text[]}
 */
export function collectTextNodes(doc, root) {
  if (!root) return []
  const nodes = []
  if (doc && typeof doc.createTreeWalker === 'function') {
    let walker = null
    try {
      walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
    } catch {
      walker = null
    }
    if (walker && typeof walker.nextNode === 'function') {
      let node = walker.nextNode()
      while (node) {
        if (node.nodeType === 3) nodes.push(node)
        node = walker.nextNode()
      }
      return nodes
    }
  }
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const kids = current?.childNodes
    if (!kids) continue
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i]
      if (!kid) continue
      if (kid.nodeType === 3) nodes.push(kid)
      else if (kid.childNodes) stack.push(kid)
    }
  }
  return nodes
}

/**
 * 把 root 参数解析成根节点数组：选择器串 → 全部匹配；元素 → 单元素。
 *
 * @param {Document | null} doc
 * @param {Node | Node[] | string | null} [root]
 * @returns {Node[]}
 */
export function resolveRoots(doc, root) {
  if (Array.isArray(root)) return root.filter(Boolean)
  if (root === null || root === undefined) {
    return collectBySelector(doc, SELECTORS.allowedRoot)
  }
  if (typeof root === 'string') return collectBySelector(doc, root)
  if (typeof root === 'object') return [root]
  return []
}

function collectBySelector(doc, selector) {
  if (!doc || typeof doc.querySelectorAll !== 'function' || typeof selector !== 'string' || selector === '') return []
  try {
    return [...doc.querySelectorAll(selector)]
  } catch {
    return []
  }
}

/** 取文本节点的字符串内容（老环境与测试桩可能只有 data）。 */
export function textOfNode(node) {
  if (!node) return ''
  if (typeof node.nodeValue === 'string') return node.nodeValue
  if (typeof node.data === 'string') return node.data
  return ''
}

/**
 * 扫描一遍：输入 doc + 根选择器 + 词集，输出命中区间列表。
 *
 * 排除（沿用 hit.js，不重写）：代码块、行内代码、公式、链接、用户消息、
 * 工具调用卡片、输入框、本插件自己的覆盖层 —— 最后的 `[data-hover-dict-ui]`
 * 顺带保证色块自己不会被再扫一遍（否则会无限套娃）。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root] 省略时用 SELECTORS.allowedRoot
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @param {boolean} [input.think] 是否把 `think: true` 标在命中上（思考区判定）
 * @returns {MarkerHit[]}
 */
export function scanTextNodes(input) {
  const doc = input?.doc ?? null
  const keys = input?.keys
  const out = []
  if (!keys || typeof keys.has !== 'function') return out
  if (typeof keys.size === 'number' && keys.size === 0) return out

  const roots = resolveRoots(doc, input?.root)
  if (roots.length === 0) return out

  for (const root of roots) {
    for (const node of collectTextNodes(doc, root)) {
      const text = textOfNode(node)
      if (text === '') continue
      const parent = node.parentElement ?? node.parentNode ?? null
      if (parent && blockerOf(parent).blocked) continue
      const matches = matchWordsInText(text, keys)
      if (matches.length === 0) continue
      const inThink = typeof parent?.closest === 'function' && parent.closest(THINK_SELECTOR) !== null
      for (const match of matches) {
        out.push({
          node,
          start: match.start,
          end: match.end,
          text: match.text,
          key: match.key,
          // known 来自词集的值（matchWordsInText 已经从 Map 取出来了）。
          // 之前这里漏传，导致 Highlight 主路径没法把「已掌握」单独分桶。
          known: match.known === true,
          think: inThink,
        })
      }
    }
  }
  return out
}

/* ── 量矩形（只读，不改 DOM） ──────────────────────────────────────── */

/**
 * 把命中区间量成视口矩形。跨行时一个命中会有多段，**逐段保留**。
 *
 * @param {MarkerHit[]} hits
 * @param {{ doc?: Document | null }} [options]
 * @returns {MarkerMark[]}
 */
export function measureHits(hits, options) {
  const list = Array.isArray(hits) ? hits : []
  const out = []
  if (list.length === 0) return out
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : null)
  if (!doc || typeof doc.createRange !== 'function') return out

  for (const hit of list) {
    const node = hit?.node
    if (!node || typeof node.nodeType !== 'number') continue
    let range = null
    try {
      range = doc.createRange()
      range.setStart(node, hit.start)
      range.setEnd(node, hit.end)
    } catch {
      // 节点已脱离文档 / 偏移越界：跳过，不抛
      continue
    }
    let raw = []
    try {
      raw = range.getClientRects ? [...range.getClientRects()] : []
    } catch {
      raw = []
    }
    const rects = []
    for (const item of raw) {
      const rect = rectOf(item)
      // 换行处的空 Range 会给出 0 宽/0 高矩形，画出来是脏点
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      rects.push(rect)
    }
    if (rects.length === 0) continue
    // rangeRefs 与 rects **等长**：跨行时一个命中对应 N 段矩形，而它们全部来自
    // 同一个 Range。所以 refs 里是同一条 {node,start,end} 重复 N 次 —— 形状上
    // 满足「一一对应」（快路径按下标取 div 时不用再算映射），语义上快路径必须
    // **按 mark 去重**只量一次，否则 224 块会变成 224 次重复 layout。
    const rangeRef = { node, start: hit.start, end: hit.end }
    const rangeRefs = new Array(rects.length)
    for (let i = 0; i < rects.length; i += 1) rangeRefs[i] = rangeRef
    out.push({
      key: hit.key,
      text: hit.text,
      think: hit.think === true,
      known: hit.known === true,
      rects,
      rangeRefs,
      bounds: unionRectsOf(rects),
    })
  }
  return out
}

/**
 * 一次完整重算的纯函数流水线：扫描 → 量矩形 → 视口裁剪 → 上限截断。
 *
 * 生词本变化、滚动、resize、DOM 变化最终都调这一个函数；它不做渲染，
 * 只交出「这一帧该画哪些色块」。色块为空数组时调用方应直接清空覆盖层并返回。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root]
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @param {object} [input.viewport] 省略时从 doc.defaultView 读
 * @param {number} [input.pad] 视口余量
 * @param {number} [input.max] 上限
 * @returns {MarkerMark[]}
 */
export function buildMarks(input) {
  const doc = input?.doc ?? null
  const keys = input?.keys
  if (!keys || typeof keys.has !== 'function') return []
  if (typeof keys.size === 'number' && keys.size === 0) return []

  const hits = scanTextNodes({ doc, root: input?.root, keys })
  if (hits.length === 0) return []

  const marks = measureHits(hits, { doc })
  if (marks.length === 0) return []

  const viewport = input?.viewport ?? viewportOf(doc)
  const pad = isNum(input?.pad) ? input.pad : VIEWPORT_PAD_PX
  const marksWithPad = viewport
    ? marks
      .map((mark) => {
        // 裁剪要同时保留「留下来的段」对应的 rangeRefs 下标，否则快路径
        // 按下标写样式会写到别的段上（§C2.3 裁剪 + 快路径必须共用同一套下标）。
        const kept = []
        const keptRefs = []
        const source = Array.isArray(mark.rects) ? mark.rects : []
        const refs = Array.isArray(mark.rangeRefs) ? mark.rangeRefs : []
        const box = normalizeViewport(viewport, pad)
        for (let i = 0; i < source.length; i += 1) {
          const rect = rectOf(source[i])
          if (!rect) continue
          if (box && (rect.right < box.left || rect.left > box.right
            || rect.bottom < box.top || rect.top > box.bottom)) continue
          kept.push(rect)
          keptRefs.push(refs[i] ?? refs[0] ?? { node: null, start: 0, end: 0 })
        }
        if (kept.length === 0) return null
        return { ...mark, rects: kept, rangeRefs: keptRefs, bounds: unionRectsOf(kept) }
      })
      .filter(Boolean)
    : marks

  return capMarks(marksWithPad, { max: input?.max, viewport })
}

/* ── C1.5 重算调度器（纯逻辑，时钟可注入） ─────────────────────────── */

/**
 * 重算调度器：把三类触发源（滚动 / DOM 变化 / resize）合并成低频重算。
 *
 * 规则（设计 §C2.4）：
 *   - 滚动：节流 120ms —— 首次立即重算，窗口内后续只挂一个尾随调用；
 *   - 正文变化：防抖 250ms —— 每次调用都把计时器往后推，静默满 250ms 才跑
 *     （流式输出期间自然合并成低频重算）；
 *   - resize：立即重算，并取消挂起的尾随/防抖（尺寸变了，之前算的都作废）。
 *
 * 时钟与计时器可注入，所以 `_marker.mjs` 用假时钟就能把节流/防抖的时序断言干净。
 *
 * @param {object} options
 * @param {() => void} options.run 重算动作
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimeout]
 * @param {(handle: any) => void} [options.clearTimeout]
 * @param {number} [options.scrollThrottleMs]
 * @param {number} [options.mutationDebounceMs]
 * @returns {{
 *   scroll: () => void, mutate: () => void, resize: () => void,
 *   request: () => void, cancel: () => void, dispose: () => void,
 *   pending: () => { throttle: boolean, debounce: boolean },
 *   runs: () => number, lastRunAt: () => number
 * }}
 */
export function createRecalcScheduler(options) {
  const run = typeof options?.run === 'function' ? options.run : () => {}
  const now = typeof options?.now === 'function' ? options.now : Date.now
  const setT = typeof options?.setTimeout === 'function' ? options.setTimeout : (fn, ms) => setTimeout(fn, ms)
  const clearT = typeof options?.clearTimeout === 'function' ? options.clearTimeout : (handle) => clearTimeout(handle)
  const throttleMs = isNum(options?.scrollThrottleMs) ? options.scrollThrottleMs : SCROLL_THROTTLE_MS
  const debounceMs = isNum(options?.mutationDebounceMs) ? options.mutationDebounceMs : MUTATION_DEBOUNCE_MS

  let lastRunAt = -Infinity
  let throttleTimer = null
  let debounceTimer = null
  let disposed = false
  let runs = 0

  const fire = () => {
    if (disposed) return
    lastRunAt = now()
    runs += 1
    try { run() } catch { /* 重算失败不该让监听器连锁崩溃 */ }
  }

  const clearThrottle = () => {
    if (throttleTimer === null) return
    try { clearT(throttleTimer) } catch { /* ignore */ }
    throttleTimer = null
  }

  const clearDebounce = () => {
    if (debounceTimer === null) return
    try { clearT(debounceTimer) } catch { /* ignore */ }
    debounceTimer = null
  }

  const scroll = () => {
    if (disposed) return
    const elapsed = now() - lastRunAt
    if (elapsed >= throttleMs) {
      clearThrottle()
      fire()
      return
    }
    // 窗口内：只挂一个尾随调用，后续 scroll 不再叠加
    if (throttleTimer !== null) return
    throttleTimer = setT(() => {
      throttleTimer = null
      fire()
    }, Math.max(0, throttleMs - elapsed))
  }

  const mutate = () => {
    if (disposed) return
    clearDebounce()
    debounceTimer = setT(() => {
      debounceTimer = null
      fire()
    }, debounceMs)
  }

  const resize = () => {
    if (disposed) return
    // 尺寸变了，挂起的滚动尾随与防抖都已过期
    clearThrottle()
    clearDebounce()
    fire()
  }

  const cancel = () => {
    clearThrottle()
    clearDebounce()
  }

  return {
    scroll,
    mutate,
    resize,
    request: fire,
    cancel,
    dispose: () => { disposed = true; cancel() },
    pending: () => ({ throttle: throttleTimer !== null, debounce: debounceTimer !== null }),
    runs: () => runs,
    lastRunAt: () => lastRunAt,
  }
}

/**
 * 把调度器接到真实 DOM 事件上。**只挂监听，不写 DOM**。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {ReturnType<typeof createRecalcScheduler>} input.scheduler
 * @param {{ addEventListener?: Function, removeEventListener?: Function } | null} [input.win]
 * @returns {() => void} disposer
 */
export function bindRecalcEvents(input) {
  const doc = input?.doc ?? null
  const scheduler = input?.scheduler
  const win = input?.win ?? doc?.defaultView ?? null
  if (!scheduler) return () => {}
  const pairs = []
  const on = (target, type, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return
    try { target.addEventListener(type, handler, opts) } catch { return }
    pairs.push([target, type, handler, opts])
  }

  // 滚动用 capture：程序滚动（流式输出跟随）也要能触发重算。
  //
  // 走 Highlight 主路径时纯滚动**不需要**重算（字色跟文字走），这里保留节流重算
  // 只是为了兜住「滚动推出新一批文本节点」（虚拟列表）与 resize 后的换行变化。
  on(win, 'scroll', () => scheduler.scroll(), { capture: true, passive: true })
  on(win, 'resize', () => scheduler.resize(), { passive: true })

  // MutationObserver：流式输出期间靠 250ms 防抖合并（§G：不许更激进）。
  //
  // 观察目标先取 chatRegion。**拿不到就退到 documentElement 整棵观察** ——
  // apply 跑的时候会话区往往还没渲染出来（用户还没发第一句话），
  // 只挂 chatRegion 会让 observer 永久挂空，流式输出反而不会触发重算。
  // 整棵观察的成本由 250ms 防抖吸收：一帧内再多的变动也只排一次重算。
  let observer = null
  const observe = (target) => {
    if (!target || typeof MutationObserver !== 'function') return false
    const next = new MutationObserver(() => scheduler.mutate())
    try {
      next.observe(target, { childList: true, subtree: true, characterData: true })
    } catch {
      return false
    }
    observer = next
    return true
  }
  if (doc && typeof doc.querySelector === 'function') {
    const region = doc.querySelector(SELECTORS.chatRegion)
    const target = region ?? doc.documentElement ?? doc.body ?? null
    observe(target)
  }

  return () => {
    for (const [target, type, handler, opts] of pairs) {
      try { target.removeEventListener(type, handler, opts) } catch { /* ignore */ }
    }
    pairs.length = 0
    try { observer?.disconnect() } catch { /* ignore */ }
    observer = null
  }
}

/* ── C2 画法：色块样式与渲染组件 ───────────────────────────────────── */

/**
 * 用户色 → `color-mix()` 表达式。亮/暗主题都不发黑（设计 §C2.2 否掉了 multiply）。
 *
 * @param {string} color hex
 * @param {number} percent 底色浓度
 * @param {number} alpha 额外透明度（已掌握词用 0.5）
 * @returns {string}
 */
export function colorMix(color, percent, alpha) {
  // 走 markColorToCss：它把 theme-error 哨兵翻成 var(...) 并带 hex 兜底，
  // 坏值也回落同一个 token —— 所以这里永远拿到一个合法的 CSS 颜色分量
  // （color-mix 支持 var() 参与求值）。
  const css = markColorToCss(color)
  const ratio = isNum(percent) ? Math.min(Math.max(percent, 0), 100) : 18
  const fade = isNum(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1
  const value = fade >= 1
    ? `color-mix(in srgb, ${css} ${ratio}%, transparent)`
    : `color-mix(in srgb, ${css} ${Math.round(ratio * fade)}%, transparent)`
  return value
}

/**
 * 一个色块的内联样式。三种 markStyle（设计 §C4）：
 *   underline  半透明底色 + 1.5px 下划线（默认）
 *   background 仅底色
 *   text       仅下划线
 *
 * 文字颜色不动 —— 改不了正文，垫底 + 下划线足够醒目。
 *
 * @param {MarkerRect} rect
 * @param {{ known?: boolean }} [mark]
 * @param {{ markColor?: string, markStyle?: string, markKnown?: boolean }} [appearance]
 * @returns {object}
 */
export function styleOfMark(rect, mark, appearance) {
  const box = rectOf(rect)
  if (!box) return { display: 'none' }
  const color = typeof appearance?.markColor === 'string' ? appearance.markColor : DEFAULT_MARK_COLOR
  const style = MARK_STYLES.includes(appearance?.markStyle) ? appearance.markStyle : 'underline'
  const known = mark?.known === true
  const base = {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    pointerEvents: 'none',
    borderRadius: '2px',
    // 色块本身不许被选中、不许被查词扫描到（覆盖层带 data-hover-dict-ui）
    userSelect: 'none',
  }
  if (known) base.opacity = 0.5
  if (style === 'background') {
    base.background = colorMix(color, 26, known ? 0.6 : 1)
    return base
  }
  if (style === 'text') {
    base.borderBottom = `1.5px solid ${color}`
    return base
  }
  base.background = colorMix(color, 18, known ? 0.6 : 1)
  base.borderBottom = `1.5px solid ${color}`
  return base
}

/**
 * 色块层组件：渲染进 `shell.overlay`，与浮层/大卡片是兄弟，key 用 'markers'。
 *
 * 组件只画**已经算好**的色块（几何由 buildMarks 给），自身不扫描、不监听事件 ——
 * 监听与重算在 app.js 的接线里（t8），这样渲染路径永远没有重活，不会拖帧。
 *
 * `h` 由构建前导注入；本组件在 node 单测里不会被调用。
 *
 * @param {object} props
 * @param {MarkerMark[]} props.marks
 * @param {{ markColor?: string, markStyle?: string, markKnown?: boolean, markWords?: boolean }} [props.appearance]
 * @returns {import('react').ReactElement | null}
 */
export function MarkerLayer(props) {
  const appearance = props?.appearance
  if (appearance?.markWords === false) return null
  const marks = Array.isArray(props?.marks) ? props.marks : []
  if (marks.length === 0) return null

  const children = []
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]
    const rects = Array.isArray(mark?.rects) ? mark.rects : []
    for (let j = 0; j < rects.length; j += 1) {
      children.push(h('div', {
        key: `${i}:${j}`,
        className: 'hd-mark',
        // 快路径靠它按 id 找到 div 直接改 style（不走 React）。格式 `${markIndex}:${rectIndex}`
        // 与 buildMarks 输出的 marks[i].rects[j] 一一对应。
        'data-mark-id': `${i}:${j}`,
        style: styleOfMark(rects[j], mark, appearance),
      }))
    }
  }
  if (children.length === 0) return null
  return h('div', { className: 'hd-marks', 'aria-hidden': 'true' }, children)
}

/**
 * MarkerLayer 用到的 CSS 片段。由 overlay.js 的 ensureStyle 一并注入
 * （t3b 接线时追加，或调用这里的 markCss() 拼进去）。
 *
 * @returns {string}
 */
export function markCss() {
  return `
[data-hover-dict-ui] .hd-marks {
  position: fixed;
  inset: 0;
  pointer-events: none;
  contain: layout style;
  z-index: 0;
}
[data-hover-dict-ui] .hd-mark {
  position: fixed;
  pointer-events: none;
}
`
}
/* ── C2 主路径：CSS Custom Highlight API（用户裁定：只要改字的颜色） ─────────
 *
 * 用户原话：「我们不需要下划线和色块啊，只要改字的颜色即可。」
 *
 * Highlight API 是浏览器原生能力：`CSS.highlights.set(name, new Highlight(...ranges))`
 * 就能给指定文字区间上**文字颜色**，**完全不改正文 DOM**（不包 span、不加属性），
 * 所以「不改正文 DOM」那条红线天然守住。
 *
 * 它的另一个决定性好处：颜色是浏览器渲染时跟着文字走的，文字滚到哪颜色就到哪 ——
 * 之前「滚动时色块不跟字」的偏移问题**从根上不存在**，不需要 rAF 逐帧重测。
 *
 * 下面这套函数只在环境支持时启用；不支持（老浏览器/测试桩）就回退到色块方案
 * （buildMarks + MarkerLayer，仍在文件后半部分保留）。
 */

/**
 * 判断当前环境能不能用 Highlight API。
 *
 * 两条都要：`Highlight` 构造函数存在，且 `CSS.highlights`（HighlightRegistry）可用。
 * 缺一就回退 —— 只判其中一个会在某些实现里抛 TypeError。
 *
 * @param {object} [scope] 通常传 window/globalThis，单测可注入假对象
 * @returns {boolean}
 */
export function supportsHighlight(scope) {
  const host = scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
  if (!host) return false
  if (typeof host.Highlight !== 'function') return false
  const css = host.CSS
  if (!css || typeof css !== 'object') return false
  const registry = css.highlights
  if (!registry || typeof registry.set !== 'function') return false
  return true
}

/**
 * 用户配置的 markColor → CSS 颜色值。
 *
 * - `theme-error` 哨兵 → `var(--dsw-alias-state-error-primary, #e5484d)`
 *   （带 hex 兜底：token 缺失时仍是可见的红，不会变成继承色）
 * - 合法 hex → 原样（小写归一）
 * - 其它 → 回落 theme-error 的 token
 *
 * @param {string} [color]
 * @returns {string}
 */
export function markColorToCss(color) {
  const raw = typeof color === 'string' ? color.trim() : ''
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase()
  return 'var(--dsw-alias-state-error-primary, #e5484d)'
}

/**
 * 把命中区间变成 Range 列表。**不量矩形、不裁剪视口** ——
 * Highlight 不需要坐标，浏览器自己知道这些 range 在屏幕上的位置。
 *
 * 每个命中一个 Range（setStart/setEnd 到文本节点的字符偏移）。
 * 已经脱离文档的节点跳过（量不出也没意义）。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root] 省略时用 SELECTORS.allowedRoot
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @returns {{
 *   ranges: Range[],
 *   knownRanges: Range[],
 *   rangeRefs: Array<{ node: Text, start: number, end: number, key: string, known: boolean, think: boolean }>,
 *   stats: { hits: number, words: number, known: number, skipped: number }
 * }}
 */
export function buildHighlightRanges(input) {
  const doc = input?.doc ?? null
  const keys = input?.keys
  const empty = { ranges: [], knownRanges: [], rangeRefs: [], stats: { hits: 0, words: 0, known: 0, skipped: 0 } }
  if (!doc || !keys || typeof keys.has !== 'function') return empty
  if (typeof keys.size === 'number' && keys.size === 0) return empty

  const hits = scanTextNodes({ doc, root: input?.root, keys })
  if (hits.length === 0) return empty

  const ranges = []
  const knownRanges = []
  const rangeRefs = []
  let skipped = 0

  for (const hit of hits) {
    const node = hit?.node
    if (!node || typeof node.nodeType !== 'number') { skipped += 1; continue }
    // 已脱离文档的节点建 Range 会抛；直接跳过（下一轮慢路径会重扫）
    if (typeof node.isConnected === 'boolean' && node.isConnected === false) { skipped += 1; continue }
    let range = null
    try {
      range = doc.createRange()
      range.setStart(node, hit.start)
      range.setEnd(node, hit.end)
    } catch {
      skipped += 1
      continue
    }
    const known = hit.known === true
    if (known) knownRanges.push(range)
    else ranges.push(range)
    rangeRefs.push({
      node, start: hit.start, end: hit.end, key: hit.key, known, think: hit.think === true,
    })
  }

  return {
    ranges,
    knownRanges,
    rangeRefs,
    stats: {
      hits: hits.length,
      words: ranges.length,
      known: knownRanges.length,
      skipped,
    },
  }
}

/**
 * 把 ranges 注册进 CSS.highlights。
 *
 * 空数组时**删除**对应注册（否则上一轮的旧高亮会留在正文上）。
 * 注册失败（环境半支持、Highlight 构造抛错）返回 false，调用方据此回退色块路径。
 *
 * @param {object} input
 * @param {object} [input.scope] window/globalThis，单测可注入
 * @param {Range[]} [input.ranges]
 * @param {Range[]} [input.knownRanges]
 * @returns {{ ok: boolean, words: number, known: number, error?: string }}
 */
export function applyHighlights(input) {
  const scope = input?.scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
  const ranges = Array.isArray(input?.ranges) ? input.ranges : []
  const knownRanges = Array.isArray(input?.knownRanges) ? input.knownRanges : []
  if (!supportsHighlight(scope)) return { ok: false, words: 0, known: 0, error: 'unsupported' }

  const registry = scope.CSS.highlights
  const HighlightCtor = scope.Highlight
  try {
    if (ranges.length === 0) registry.delete(HIGHLIGHT_WORDS)
    else registry.set(HIGHLIGHT_WORDS, new HighlightCtor(...ranges))

    if (knownRanges.length === 0) registry.delete(HIGHLIGHT_KNOWN)
    else registry.set(HIGHLIGHT_KNOWN, new HighlightCtor(...knownRanges))

    return { ok: true, words: ranges.length, known: knownRanges.length }
  } catch (error) {
    return { ok: false, words: 0, known: 0, error: error?.message ?? 'failed' }
  }
}

/**
 * 清掉本插件注册的两个 highlight（关闭着色 / 卸载时调）。
 *
 * @param {object} [scope]
 * @returns {void}
 */
export function clearHighlights(scope) {
  const host = scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
  const registry = host?.CSS?.highlights
  if (!registry || typeof registry.delete !== 'function') return
  try { registry.delete(HIGHLIGHT_WORDS) } catch { /* ignore */ }
  try { registry.delete(HIGHLIGHT_KNOWN) } catch { /* ignore */ }
}

/**
 * 生成 `::highlight(...)` 规则。
 *
 * **只写 color**：用户要的是「改字的颜色」，不要 background / border / text-decoration。
 * 已掌握词用淡化（`color-mix` 把同色掺到 transparent）而不是换色 —— 保持同源。
 *
 * 注意 ::highlight 是伪元素，可用的属性很少（color、background-color、
 * text-decoration、text-shadow 等），正因为少，这里只给 color 最稳。
 *
 * @param {object} [appearance]
 * @param {{ markColor?: string, markKnown?: boolean }} [appearance]
 * @returns {string}
 */
export function highlightCss(appearance) {
  const color = markColorToCss(appearance?.markColor)
  const knownOn = appearance?.markKnown === true
  const parts = [
    `::highlight(${HIGHLIGHT_WORDS}) { color: ${color}; }`,
  ]
  if (knownOn) {
    // 已掌握：同色但对半掺透明，淡一档。theme-error 是 var() 时同样成立
    // （color-mix 支持把 var() 当颜色分量求值）。
    parts.push(`::highlight(${HIGHLIGHT_KNOWN}) { color: color-mix(in srgb, ${color} 50%, transparent); }`)
  } else {
    // 没开「已掌握也显示」就不注册规则（清掉残留）
    parts.push(`::highlight(${HIGHLIGHT_KNOWN}) { }`)
  }
  return parts.join('\n')
}
