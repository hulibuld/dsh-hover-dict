/**
 * drag.js —— 让完整词条卡片能拖动。
 *
 * 为什么需要：卡片是就地弹在词旁边的，位置由算法算（优先下方、放不下翻上方）。
 * 用户读到一半想对照正文时，这个位置往往正好挡住要看的地方。
 * 能拖就意味着「我自己决定它停在哪」。
 *
 * 三条约束：
 *   1. **拖动只改位置，不改尺寸**。用户拖它是为了挪开视线，不是拉伸。
 *   2. **拖过的位置要记住**。同一个会话里再点开别的词，卡片还停在原处——
 *      反复拖同一个位置很烦。
 *   3. **不能拖出视口**。顶部留 8px，底部留 8px，左右同理；
 *      拖到边上就贴住，不要让它消失。
 *
 * 本模块是纯函数 + 一个事件绑定，不碰 React。
 */

/** 视口内边距：卡片任何一边都不许越过这个距离。 */
export const VIEWPORT_PAD = 8

/** 拖动把手的判定：手指/鼠标移动超过这个距离才算拖，否则当点击。 */
export const DRAG_THRESHOLD_PX = 3

/**
 * 把位置夹进视口。
 *
 * @param {{ top: number, left: number }} pos
 * @param {{ width: number, height: number }} size 卡片尺寸
 * @param {{ width: number, height: number }} viewport
 * @returns {{ top: number, left: number }}
 */
export function clampToViewport(pos, size, viewport) {
  const maxTop = Math.max(VIEWPORT_PAD, viewport.height - size.height - VIEWPORT_PAD)
  const maxLeft = Math.max(VIEWPORT_PAD, viewport.width - size.width - VIEWPORT_PAD)
  return {
    top: Math.min(Math.max(pos.top, VIEWPORT_PAD), maxTop),
    left: Math.min(Math.max(pos.left, VIEWPORT_PAD), maxLeft),
  }
}

/**
 * 由「按下点」与「当前点」算出新位置。
 *
 * 用「起点位置 + 位移」而不是「指针位置 - 半宽」：
 * 后者会在开始拖的瞬间让卡片跳到指针中心，手感很怪。
 *
 * @param {{ top: number, left: number }} origin 按下时卡片的位置
 * @param {{ x: number, y: number }} start 按下时的指针坐标
 * @param {{ x: number, y: number }} current 当前指针坐标
 * @param {{ width: number, height: number }} size
 * @param {{ width: number, height: number }} viewport
 * @returns {{ top: number, left: number }}
 */
export function dragPosition(origin, start, current, size, viewport) {
  const moved = {
    top: origin.top + (current.y - start.y),
    left: origin.left + (current.x - start.x),
  }
  return clampToViewport(moved, size, viewport)
}

/**
 * 把拖动行为绑到一个元素上。
 *
 * 只在把手元素上按下才启动拖动 —— 卡片内容里要能正常选文字、点链接。
 *
 * @param {object} options
 * @param {HTMLElement} options.handle 拖动把手（通常是卡片顶部那条）
 * @param {HTMLElement} options.panel 被拖动的卡片
 * @param {Document} options.doc
 * @param {{ width: number, height: number }} options.viewport
 * @param {(pos: { top: number, left: number }) => void} [options.onEnd] 拖动结束回调
 * @param {() => void} [options.onClick] 没拖动时当成点击（比如双击复位）
 * @returns {() => void} 解绑函数
 */
export function attachDrag(options) {
  const { handle, panel, doc } = options
  if (!handle || !panel || !doc) return () => {}

  let origin = null
  let start = null
  let moved = false

  const onPointerDown = (event) => {
    // 只响应主键；右键留给上下文菜单
    if (event.button !== 0) return
    const rect = panel.getBoundingClientRect()
    origin = { top: rect.top, left: rect.left }
    start = { x: event.clientX, y: event.clientY }
    moved = false
    handle.setPointerCapture?.(event.pointerId)
    // 阻止拖动时选中文字
    event.preventDefault()
  }

  const onPointerMove = (event) => {
    if (origin === null || start === null) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    moved = true

    const rect = panel.getBoundingClientRect()
    const next = dragPosition(origin, start, { x: event.clientX, y: event.clientY },
      { width: rect.width, height: rect.height }, options.viewport)
    panel.style.top = `${next.top}px`
    panel.style.left = `${next.left}px`
  }

  const onPointerUp = (event) => {
    if (origin === null) return
    const wasMoved = moved
    origin = null
    start = null
    moved = false
    handle.releasePointerCapture?.(event.pointerId)

    if (!wasMoved) {
      options.onClick?.()
      return
    }
    const rect = panel.getBoundingClientRect()
    options.onEnd?.({ top: rect.top, left: rect.left })
  }

  handle.addEventListener('pointerdown', onPointerDown)
  doc.addEventListener('pointermove', onPointerMove)
  doc.addEventListener('pointerup', onPointerUp)
  doc.addEventListener('pointercancel', onPointerUp)

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown)
    doc.removeEventListener('pointermove', onPointerMove)
    doc.removeEventListener('pointerup', onPointerUp)
    doc.removeEventListener('pointercancel', onPointerUp)
  }
}
