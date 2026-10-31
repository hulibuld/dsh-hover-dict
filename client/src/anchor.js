/**
 * anchor.js —— 把「文本节点里的字符区间」变成「视口里的矩形」。
 *
 * 这是「不改正文 DOM」那条红线的第二半。第一半是 hit.js 的坐标反查；
 * 这一半负责**只读**地量出单词在屏幕上的位置，供覆盖层画高亮框和定位浮层。
 *
 * 用 `Range.getClientRects()` 而不是逐字量：浏览器自己知道断行、连字、字距，
 * 我们自己算一定会漂。一个词跨行时 getClientRects 会给出多个矩形 —— 这是正确行为，
 * 高亮要逐段画，不能硬合成一个大框。
 *
 * 本模块不创建 DOM 节点、不修改任何东西，只读布局。
 */

/**
 * 一个矩形，单位 CSS 像素，**视口坐标系**（与 getBoundingClientRect 一致）。
 *
 * @typedef {object} Rect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * 一个已锚定的词：命中信息 + 它的屏幕矩形 + 一个稳定的身份串。
 *
 * `key` 用于判断「还是不是同一个词」，避免鼠标在同一行内移动时反复重建浮层。
 * 生成规则：`${节点身份}:${start}:${end}`。节点身份用 WeakMap 发号，
 * **不要**用节点路径或 textContent —— 流式输出时正文一直在变，路径会失效。
 *
 * @typedef {object} WordAnchor
 * @property {import('./word.js').WordHit} hit
 * @property {Rect[]} rects       可能是多段（词跨行）
 * @property {Rect} bounds        所有 rects 的外接矩形，用于定位浮层
 * @property {string} key         身份串，用于去重
 * @property {Element} owner      hit.node 的父元素，用于判断是否被移除
 */

/** 文本节点 → 自增 id 的映射。WeakMap 让节点被回收时自动释放。 */
const NODE_IDS = new WeakMap()
let nextNodeId = 0

/** 位置漂移容差：超过这个像素数就认为锚点过期了。 */
const DEFAULT_TOLERANCE_PX = 2

/**
 * 把一组矩形并成外接矩形。全零或空数组返回 null。
 * @param {ReadonlyArray<Rect>} rects
 * @returns {Rect | null}
 */
function unionRects(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    if (rect.left < left) left = rect.left
    if (rect.top < top) top = rect.top
    if (rect.right > right) right = rect.right
    if (rect.bottom > bottom) bottom = rect.bottom
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * 给文本节点发一个稳定 id。内部用 WeakMap，节点被回收时自然释放。
 *
 * @param {Text} node
 * @returns {string}
 */
export function nodeIdentity(node) {
  if (node === null || node === undefined) return 'n0'
  let id = NODE_IDS.get(node)
  if (id === undefined) {
    id = (nextNodeId += 1)
    NODE_IDS.set(node, id)
  }
  return `n${id}`
}

/**
 * 量出一个词在视口里的矩形。
 *
 * 契约：
 *   - 返回的 rects 已过滤掉宽或高为 0 的项（换行处的空 Range 会给出 0 宽矩形）；
 *   - 词跨行时 rects.length > 1，`bounds` 是它们的并集；
 *   - 全部过滤掉后为空 → 返回 null（说明这个词当前不可见，不该弹）；
 *   - `owner` 取 `node.parentElement`，可能为 null（节点已脱离文档）。
 *
 * 别做的事：
 *   - 不要 `window.getSelection()` 去选区 —— 会打断用户自己的选择；
 *   - 不要 `range.surroundContents` 包 span —— 那是改正文 DOM，红线；
 *   - 不要在滚动容器里用 offsetTop 累加 —— 宿主的滚动容器不是唯一一层。
 *
 * @param {import('./word.js').WordHit} hit
 * @param {{ doc?: Document, win?: Window }} [options]
 * @returns {WordAnchor | null}
 */
export function anchorOf(hit, options) {
  if (!hit || !hit.node || typeof hit.node.nodeType !== 'number') return null
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc) return null

  let range
  try {
    range = doc.createRange()
    range.setStart(hit.node, hit.start)
    range.setEnd(hit.node, hit.end)
  } catch {
    // 节点已脱离文档，或偏移越界
    return null
  }

  let rawRects
  try {
    rawRects = range.getClientRects()
  } catch {
    return null
  }

  const rects = []
  for (let i = 0; i < rawRects.length; i += 1) {
    const rect = rawRects[i]
    // 换行处会给出 0 宽 0 高的空矩形，过滤掉
    if (!(rect.width > 0) || !(rect.height > 0)) continue
    rects.push({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
  }
  if (rects.length === 0) return null

  const bounds = unionRects(rects)
  if (bounds === null) return null

  return {
    hit,
    rects,
    bounds,
    key: `${nodeIdentity(hit.node)}:${hit.start}:${hit.end}`,
    owner: hit.node.parentElement ?? null,
  }
}

/**
 * 判断锚点是否还有效：节点仍在文档里，且矩形与缓存值没差太多。
 *
 * 为什么要比矩形：流式输出会不断往正文追加内容，同一个 Text 节点可能在文档里
 * 但已经换了位置。只判 isConnected 会让高亮框停在旧位置。
 *
 * @param {WordAnchor | null} anchor
 * @param {{ tolerancePx?: number }} [options]
 * @returns {boolean}
 */
export function isAnchorStale(anchor, options) {
  if (!anchor || !anchor.hit || !anchor.hit.node) return true
  const node = anchor.hit.node
  // isConnected 在现代浏览器都有；老环境退化成 owner 检查
  if (typeof node.isConnected === 'boolean') {
    if (!node.isConnected) return true
  } else if (anchor.owner && anchor.owner.ownerDocument
    && !anchor.owner.ownerDocument.contains(anchor.owner)) {
    return true
  }

  const tolerance = Number.isFinite(options?.tolerancePx) ? options.tolerancePx : DEFAULT_TOLERANCE_PX
  let fresh
  try {
    fresh = anchorOf(anchor.hit)
  } catch {
    return true
  }
  if (fresh === null) return true

  const a = anchor.bounds
  const b = fresh.bounds
  return Math.abs(a.left - b.left) > tolerance
    || Math.abs(a.top - b.top) > tolerance
    || Math.abs(a.width - b.width) > tolerance
    || Math.abs(a.height - b.height) > tolerance
}

/**
 * 判断两次命中是不是「同一个词」，用于决定「复用浮层」还是「换词重弹」。
 *
 * 同名但位置不同（同一个词在同一段出现两次）算不同锚点 —— 靠 key 里的偏移区分。
 *
 * @param {WordAnchor | null} a
 * @param {WordAnchor | null} b
 * @returns {boolean}
 */
export function sameWord(a, b) {
  if (!a || !b) return false
  return a.key === b.key
}
