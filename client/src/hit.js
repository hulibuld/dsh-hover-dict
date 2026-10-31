/**
 * hit.js —— 「这个鼠标位置该不该查」的放行判定。
 *
 * 这是整个插件最容易出事的地方：判定松了会在代码块里弹词，判定紧了在正文里不弹。
 * 所以它被单独隔离成一个**纯函数**，输入是一个 element 与坐标，输出是放行/拒绝 + 理由。
 * 理由串（`reason`）不是给人看的文案，是给测试断言与日志用的稳定标识。
 *
 * 本模块不碰词库、不碰 React、不发网络请求。它可以只看 DOM。
 */

/**
 * 选择器常量。**全部集中在这里**，因为它们是宿主 UI 的私有实现细节，
 * 随版本变化的概率最高。宿主升级后只改这一个对象即可（见 docs/架构.md §7 风险一）。
 *
 * 这三条已在本机 0.2.x 宿主产物里核实存在：
 *   - `[data-chat-flow-kind="assistant-step"]`：助手回复与思考内容的公共容器
 *   - `[data-conversation-region="chat"]`：消息区根节点
 *   - `[data-conversation-scroll]`：滚动容器
 *
 * 其余（代码块、行内代码、公式、链接）用**语义标签**判，不依赖类名：
 * 类名带哈希（如 `AkCqbG_`）每次构建都变，标签不会。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SELECTORS = Object.freeze({
  /** 允许查词的最外层容器 */
  allowedRoot: '[data-chat-flow-kind="assistant-step"]',
  /** 消息区（用于确认确实在对话里） */
  chatRegion: '[data-conversation-region="chat"]',
  /** 滚动容器（挂滚动监听用） */
  scrollPort: '[data-conversation-scroll]',
  /** 输入框区域（必须排除） */
  composerRegion: '[data-conversation-region="composer"]',
})

/** 程序滚动的判定窗口：距上次用户指针动作超过这么久，才可能是宿主自己滚的。 */
const PROGRAMMATIC_SCROLL_WINDOW_MS = 600

/**
 * 一进入就算「不许查」的标签与属性。按**语义**判，不按类名判。
 *
 * 命中任意一条即拒绝，理由串见各条注释。
 *
 * @type {ReadonlyArray<{ reason: string, matches: (el: Element) => boolean }>}
 */
export const HIT_BLOCKERS = Object.freeze([
  // 代码块与行内代码：`pre` / `code` 覆盖了绝大多数情况。
  // 宿主的代码块会带 data-code-block-content，作为补强。
  { reason: 'code', matches: (el) => el.closest('pre, code, [data-code-block-content]') !== null },

  // 数学公式：KaTeX / MathML 都会留下 katex / math 类名或 <math> 标签。
  // 只查标签与 aria-label，不查具体类名（类名不稳）。
  {
    reason: 'math',
    matches: (el) => el.closest('math, .katex, .katex-display, [data-math], mjx-container') !== null,
  },

  // 链接：链接有原生交互（跳转），抢它的点击会让用户回不了原页面。
  { reason: 'link', matches: (el) => el.closest('a[href]') !== null },

  // 用户消息与工具调用卡片：产品要求覆盖范围只有助手正文与思考。
  {
    reason: 'not-assistant',
    matches: (el) =>
      el.closest('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"], [data-chat-flow-kind="tool-call"], [data-chat-flow-kind="command"], [data-chat-flow-kind="command-input"]') !==
      null,
  },

  // 输入框与可编辑区：用户在这里打字，弹浮层会挡住内容且干扰输入法。
  {
    reason: 'editable',
    matches: (el) => el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null,
  },
  { reason: 'composer', matches: (el) => el.closest(SELECTORS.composerRegion) !== null },

  // 宿主明确标记为不可交互或隐藏的东西。
  { reason: 'inert', matches: (el) => el.closest('[inert], [hidden], [aria-hidden="true"]') !== null },

  // iframe / 终端：鼠标事件不会传进来，但留着这条防止坐标反查越界时误判。
  { reason: 'foreign', matches: (el) => el.closest('iframe, .xterm') !== null },

  // 本插件自己的覆盖层：浮层里的字不该再触发一次查词（会无限套娃）。
  { reason: 'self', matches: (el) => el.closest('[data-hover-dict-ui]') !== null },
])

/**
 * 判定一次鼠标位置是否应当进入「候选」状态。
 *
 * 契约（每条都要有单测）：
 *   - `el` 为 null 或不是 Element → 拒绝，reason 'no-target'；
 *   - 不在 `allowedRoot` 内 → 拒绝，reason 'outside';
 *   - 命中任一 HIT_BLOCKERS → 拒绝，reason 取该条的值（按数组顺序，先命中先返回）；
 *   - 插件被禁用 → 拒绝，reason 'disabled'；
 *   - 全部通过 → 放行，reason 'ok'。
 *
 * **不要在这里判「有没有查到词」**：那是 dict.js 的事，而且查不到词不该阻止命中
 * 判定（否则拿不到矩形，也就无法给用户任何反馈）。
 *
 * @param {Element | null} el - 通常来自 `document.caretRangeFromPoint(x, y)` 之后的 startContainer.parentElement
 * @param {{ enabled?: boolean, doc?: Document }} [options]
 * @returns {{ ok: boolean, reason: string }}
 */
export function isEligibleTarget(el, options) {
  if (options?.enabled === false) return { ok: false, reason: 'disabled' }
  if (el === null || el === undefined) return { ok: false, reason: 'no-target' }
  // 用 duck typing 而不是 instanceof：跨 iframe 拿到的 Element 构造函数不同，
  // instanceof 会假阴性。有 closest 就按元素用。
  if (typeof el.closest !== 'function') return { ok: false, reason: 'no-target' }

  if (el.closest(SELECTORS.allowedRoot) === null) return { ok: false, reason: 'outside' }

  for (const blocker of HIT_BLOCKERS) {
    let hit = false
    try {
      hit = blocker.matches(el) === true
    } catch {
      // 某个判定在选择器上炸了，不要让它带走整个命中流程
      hit = false
    }
    if (hit) return { ok: false, reason: blocker.reason }
  }

  return { ok: true, reason: 'ok' }
}

/**
 * 从坐标反查「点在哪个文本节点、哪个字符上」。
 *
 * 这是**不改正文 DOM** 那条红线得以成立的关键：不预先给单词包 span，
 * 而是在鼠标停下的瞬间问浏览器「这个坐标落在哪个字符上」。
 *
 * 用 `caretRangeFromPoint`（Chromium/WebKit），退化到 `caretPositionFromPoint`（Firefox）。
 * 两者都不可用（老环境/测试桩）时返回 null，插件表现为「不弹」——降级但不报错。
 *
 * 坐标必须是**视口坐标**（clientX/clientY），不是 pageX。
 *
 * @param {Document} doc
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ node: Text, offset: number } | null}
 *   - node 不是 Text（比如落在元素空隙上）→ 返回 null，不要强行造一个
 */
export function caretAt(doc, clientX, clientY) {
  if (!doc || typeof clientX !== 'number' || typeof clientY !== 'number') return null

  // Chromium / WebKit
  if (typeof doc.caretRangeFromPoint === 'function') {
    let range = null
    try {
      range = doc.caretRangeFromPoint(clientX, clientY)
    } catch {
      return null
    }
    if (range === null) return null
    const node = range.startContainer
    // 落在元素上（不在文本里）不算命中：那是段落间隙或图片位置
    if (node === null || node.nodeType !== 3) return null
    return { node, offset: range.startOffset }
  }

  // Firefox
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
 * 判断某次滚动是不是「宿主在流式输出时自动把视图往下带」。
 *
 * 流式输出期间宿主会反复 scrollTop，如果把这当成用户滚动去关闭浮层，
 * 浮层会在回答生成时不停闪。判据：scrollTop 变化的方向与幅度在
 * `streamSettleMs` 内连续单向增加，且用户没有 pointerdown 记录。
 *
 * @param {{ lastScrollTop: number, nextScrollTop: number, sinceUserPointerMs: number }} input
 * @returns {boolean}
 */
export function isProgrammaticScroll(input) {
  if (input === null || input === undefined) return false
  const { lastScrollTop, nextScrollTop, sinceUserPointerMs } = input
  if (typeof lastScrollTop !== 'number' || typeof nextScrollTop !== 'number') return false
  // 用户刚动过鼠标（含滚轮拖动），那就是真滚动
  if (typeof sinceUserPointerMs === 'number' && sinceUserPointerMs < PROGRAMMATIC_SCROLL_WINDOW_MS) {
    return false
  }
  // 宿主跟随流式输出只会**向下**加 scrollTop（内容在长高）
  return nextScrollTop > lastScrollTop
}
