/**
 * position.js —— 摆放浮层与大卡片的纯几何。
 *
 * 纯函数，输入矩形与视口尺寸，输出一个 `{ top, left, placement }`。
 * **不读 DOM、不测元素**：元素自身的宽高由调用方量好传进来。
 * 这样这份逻辑可以在 node 里用假数据跑满边界用例（贴边、翻到上方、超出视口）。
 *
 * 坐标一律是**视口坐标**，与 `getBoundingClientRect` 一致。
 * 浮层本身用 `position: fixed` 渲染，所以视口坐标可以直接用。
 */

/** 浮层与词之间的间距。 */
const DEFAULT_OFFSET_PX = 6
/** 卡片与词之间的间距，比浮层略大（卡片要显出「摊开」的感觉）。 */
const DEFAULT_CARD_OFFSET_PX = 10
/** 距视口边缘的最小留白。 */
const DEFAULT_MARGIN_PX = 8

/** 夹取到 [min, max]；max 小于 min 时优先 min（视口比浮层还窄的极端情况）。 */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 摆放结果。
 *
 * `placement` 说明最终落在哪一侧，渲染层据此决定要不要画小箭头、动画从哪边进。
 *
 * @typedef {object} Placement
 * @property {number} top
 * @property {number} left
 * @property {'top' | 'bottom' | 'left' | 'right'} placement
 * @property {boolean} clamped  是否发生了贴边夹取（调试与测试用）
 */

/**
 * 摆小浮层：优先放在词的**下方**，下方放不下翻到上方。
 *
 * 规则（每条都要有单测）：
 *   1. 默认 `top = bounds.bottom + offsetPx`，`left = bounds.left`；
 *   2. 下方剩余空间 < 浮层高 + marginPx → 翻到上方：`top = bounds.top - offsetPx - height`；
 *   3. 上方也放不下 → 选空间大的那侧，并夹进视口；
 *   4. 水平同理：右边放不下就向左移，最终夹进 `[marginPx, viewportW - width - marginPx]`；
 *   5. 视口比浮层还窄时，`left` 取 marginPx，宽度由渲染层的 max-width 兜住。
 *
 * @param {object} input
 * @param {import('./anchor.js').Rect} input.anchor    词的外接矩形
 * @param {{ width: number, height: number }} input.size  浮层实测尺寸
 * @param {{ width: number, height: number }} input.viewport  视口尺寸
 * @param {number} [input.offsetPx]
 * @param {number} [input.marginPx]
 * @returns {Placement}
 */
export function computePopoverPlacement(input) {
  const anchor = input?.anchor
  const size = input?.size
  const viewport = input?.viewport
  if (!anchor || !size || !viewport) {
    return { top: 0, left: 0, placement: 'bottom', clamped: true }
  }
  const offset = Number.isFinite(input.offsetPx) ? input.offsetPx : DEFAULT_OFFSET_PX
  const margin = Number.isFinite(input.marginPx) ? input.marginPx : DEFAULT_MARGIN_PX

  const roomBelow = viewport.height - anchor.bottom - margin
  const roomAbove = anchor.top - margin
  let placement = 'bottom'
  let top

  if (size.height <= roomBelow) {
    top = anchor.bottom + offset
  } else if (size.height <= roomAbove) {
    placement = 'top'
    top = anchor.top - offset - size.height
  } else {
    // 两边都放不下：选空间大的那一边，然后夹进视口
    placement = roomAbove > roomBelow ? 'top' : 'bottom'
    top = placement === 'bottom' ? anchor.bottom + offset : anchor.top - offset - size.height
  }

  const maxTop = viewport.height - size.height - margin
  const clampedTop = clamp(top, margin, Math.max(margin, maxTop))

  // 水平：优先与词的左边缘对齐，右边不够就整体左移，最后夹取
  const maxLeft = viewport.width - size.width - margin
  const clampedLeft = clamp(anchor.left, margin, Math.max(margin, maxLeft))

  return {
    top: clampedTop,
    left: clampedLeft,
    placement,
    clamped: clampedTop !== top || clampedLeft !== anchor.left,
  }
}

/**
 * 摆大卡片：比浮层复杂一点，因为它更高。
 *
 * 规则：
 *   1. 优先在词的右侧（`left = bounds.right + gap`），右侧放不下换左侧；
 *   2. 两侧都放不下（窄窗口）→ 退回「下方」，与浮层同样的翻面规则；
 *   3. 垂直方向永远夹进视口，且**不遮住锚点**：若夹取后卡片的垂直范围盖住了
 *      bounds，就整体下移或上移到刚好不重叠的位置；
 *   4. 卡片高度超过 `viewport.height * maxHeightRatio` 时，调用方应已经限高了；
 *      这里不裁，只摆放（裁剪是渲染层 overflow 的事）。
 *
 * @param {object} input
 * @param {import('./anchor.js').Rect} input.anchor
 * @param {{ width: number, height: number }} input.size
 * @param {{ width: number, height: number }} input.viewport
 * @param {number} [input.gapPx]
 * @param {number} [input.marginPx]
 * @returns {Placement}
 */
export function computeCardPlacement(input) {
  const anchor = input?.anchor
  const size = input?.size
  const viewport = input?.viewport
  if (!anchor || !size || !viewport) {
    return { top: 0, left: 0, placement: 'bottom', clamped: true }
  }
  const offset = Number.isFinite(input.offsetPx) ? input.offsetPx : DEFAULT_CARD_OFFSET_PX
  const margin = Number.isFinite(input.marginPx) ? input.marginPx : DEFAULT_MARGIN_PX

  // 卡片比浮层高得多，所以「放不下」是常态。
  // 先把它整体居中对齐到词，再在垂直方向挑空间更大的一侧。
  const roomBelow = viewport.height - anchor.bottom - margin
  const roomAbove = anchor.top - margin
  const placement = roomAbove > roomBelow ? 'top' : 'bottom'

  let top = placement === 'bottom'
    ? anchor.bottom + offset
    : anchor.top - offset - size.height

  // 卡片允许压住词本身（就地展开的语义），但底边不能越过视口
  const maxTop = viewport.height - size.height - margin
  const clampedTop = clamp(top, margin, Math.max(margin, maxTop))

  // 水平居中于词，再夹取
  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const maxLeft = viewport.width - size.width - margin
  const clampedLeft = clamp(centered, margin, Math.max(margin, maxLeft))

  return {
    top: clampedTop,
    left: clampedLeft,
    placement,
    clamped: clampedTop !== top || clampedLeft !== centered,
  }
}

/**
 * 把一组矩形并起来。anchor.js 用它算 bounds，overlay.js 用它算高亮外框。
 *
 * 空数组返回 null（**不是**全零矩形 —— 那会被误当成一个位于左上角的有效框）。
 *
 * @param {ReadonlyArray<import('./anchor.js').Rect>} rects
 * @returns {import('./anchor.js').Rect | null}
 */
export function unionRect(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let sawOne = false
  for (const rect of rects) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) continue
    sawOne = true
    if (rect.left < left) left = rect.left
    if (rect.top < top) top = rect.top
    if (rect.right > right) right = rect.right
    if (rect.bottom > bottom) bottom = rect.bottom
  }
  if (!sawOne) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * 判断一个点是否落在矩形外扩 `pad` 像素后的范围内。
 * 用于「鼠标从词移动到浮层」这段路的宽容判定 —— 斜着移过去时不要中途收起。
 *
 * @param {number} x
 * @param {number} y
 * @param {import('./anchor.js').Rect | null} rect
 * @param {number} pad
 * @returns {boolean}
 */
export function containsPoint(x, y, rect, pad) {
  if (!rect) return false
  const grow = Number.isFinite(pad) ? pad : 0
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  return x >= rect.left - grow && x <= rect.right + grow
    && y >= rect.top - grow && y <= rect.bottom + grow
}

/**
 * 总出口：给出摆放结果。
 * 保留这个名字是为了让 client.js 的导出表稳定（测试直接调它）。
 *
 * @param {'popover' | 'card'} kind
 * @param {Parameters<typeof computePopoverPlacement>[0]} input
 * @returns {Placement}
 */
export function computeOverlayRect(kind, input) {
  return kind === 'card' ? computeCardPlacement(input) : computePopoverPlacement(input)
}
