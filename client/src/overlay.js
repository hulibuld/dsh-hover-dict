/**
 * overlay.js —— 覆盖层：单词高亮框 + 小浮层。
 *
 * 这个文件里全是 React 组件，渲染进 `shell.overlay` slot。
 *
 * 为什么挂 `shell.overlay` 而不塞进消息节点里：
 *   1. 塞进消息节点就等于在宿主的渲染树里插东西，宿主重渲染时会把它挪走或丢掉
 *      （流式输出时每秒都在重渲染）；
 *   2. 覆盖层是 frame-wide 的，坐标就是视口坐标，不用在两层滚动容器之间换算；
 *   3. 它是 click-through 的，我们自己的条目 opt-in pointer-events。
 *
 * 样式全部走 `--dsw-alias-*` 语义 token，不写死颜色，不自己判断暗色主题。
 */

/** 覆盖层根节点的标记属性。hit.js 靠它排除「自己身上的字」。 */
export const UI_ATTR = 'data-hover-dict-ui'

/** 样式节点的稳定 id。改样式内容不需要改它。 */
const STYLE_ID = 'dsh-hover-dict/styles'

/** 卡片与浮层的基础样式。全部用宿主主题 token。 */
const CSS = `
[${UI_ATTR}] {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  contain: layout style;
}
[${UI_ATTR}] .hd-pop {
  position: fixed;
  pointer-events: auto;
  max-width: 320px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-lg, 10px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #fff));
  box-shadow: 0 8px 28px rgba(0,0,0,.14);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 1.55;
  cursor: pointer;
}
[${UI_ATTR}] .hd-card {
  position: fixed;
  pointer-events: auto;
  padding: 16px 18px;
  border-radius: var(--dsw-radius-lg, 12px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28));
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #fff));
  box-shadow: 0 14px 48px rgba(0,0,0,.2);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size, 14px);
  line-height: 1.6;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
[${UI_ATTR}] .hd-drag-handle {
  cursor: grab;
  user-select: none;
  margin: -6px -8px 0;
  padding: 6px 8px 0;
  border-radius: 8px 8px 0 0;
  transition: background-color .14s ease;
}
[${UI_ATTR}] .hd-drag-handle:hover {
  background: rgba(127,127,127,.08);
}
[${UI_ATTR}] .hd-drag-handle:active {
  cursor: grabbing;
  background: rgba(127,127,127,.14);
}
/* 把手上的小提示：六点抓取纹，让人一眼看出这条能拖 */
[${UI_ATTR}] .hd-drag-handle::before {
  content: "";
  display: block;
  width: 26px;
  height: 3px;
  margin: 0 auto 6px;
  border-radius: 2px;
  background: rgba(127,127,127,.36);
}
[${UI_ATTR}] .hd-word-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
[${UI_ATTR}] .hd-star {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 17px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--dsw-alias-label-secondary, #999);
}
[${UI_ATTR}] .hd-star:hover {
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.14));
}
[${UI_ATTR}] .hd-star-on {
  color: var(--dsw-alias-state-warn-primary, #f5a623);
}
[${UI_ATTR}] .hd-family {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: .94em;
}
[${UI_ATTR}] .hd-family-item:hover {
  text-decoration: underline;
}
[${UI_ATTR}] .hd-roots {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: .94em;
}
[${UI_ATTR}] .hd-root-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
[${UI_ATTR}] .hd-root-part {
  font-weight: 600;
  min-width: 3.6em;
  font-family: var(--ds-font-family-code, monospace);
}
[${UI_ATTR}] .hd-root-origin {
  color: var(--dsw-alias-label-secondary, #999);
  font-size: .86em;
}
[${UI_ATTR}] .hd-word {
  font-weight: 600;
  font-size: 1.06em;
  letter-spacing: .01em;
}
[${UI_ATTR}] .hd-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
}
[${UI_ATTR}] .hd-pos {
  flex: none;
  color: var(--dsw-alias-label-secondary, #888);
  font-size: .88em;
  font-style: italic;
  min-width: 2.6em;
}
[${UI_ATTR}] .hd-zh {
  color: var(--dsw-alias-label-primary, inherit);
}
[${UI_ATTR}] .hd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
[${UI_ATTR}] .hd-tag {
  font-size: .78em;
  line-height: 1.5;
  padding: 0 6px;
  border-radius: 999px;
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  color: var(--dsw-alias-label-secondary, #666);
  white-space: nowrap;
}
[${UI_ATTR}] .hd-more {
  color: var(--dsw-alias-label-secondary, #888);
  font-size: .85em;
}
[${UI_ATTR}] .hd-note {
  color: var(--dsw-alias-label-secondary, #888);
  font-size: .88em;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
[${UI_ATTR}] .hd-close {
  position: absolute;
  top: 8px;
  right: 10px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #888);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
[${UI_ATTR}] .hd-close:hover {
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.12));
}
[${UI_ATTR}] .hd-section {
  color: var(--dsw-alias-label-secondary, #888);
  font-size: .84em;
  margin-bottom: -4px;
}
[${UI_ATTR}] .hd-ex-en {
  color: var(--dsw-alias-label-primary, inherit);
}
[${UI_ATTR}] .hd-ex-zh {
  color: var(--dsw-alias-label-secondary, #666);
  font-size: .92em;
}
[${UI_ATTR}] .hd-ex {
  margin-bottom: 6px;
}
[${UI_ATTR}] .hd-forms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--dsw-alias-label-secondary, #666);
  font-size: .9em;
}
[${UI_ATTR}] .hd-hit {
  font-weight: 600;
  color: var(--dsw-alias-brand-primary, inherit);
}
`

/**
 * 把组件样式插进 document。
 *
 * 幂等：同一个 id 已存在就复用；内容变了才替换 textContent。
 * 追加到 head，**不往 body 追加**（那是宿主规范里明确禁止的）。
 *
 * @param {Document} doc
 * @returns {() => void} disposer，卸载时移除这个 style 节点
 */
export function ensureStyle(doc) {
  if (!doc || typeof doc.createElement !== 'function') return () => {}
  const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`
  let node = doc.querySelector(selector)
  if (node === null) {
    node = doc.createElement('style')
    node.dataset.pluginCss = STYLE_ID
    node.textContent = CSS
    const head = doc.head ?? doc.documentElement
    if (head) head.appendChild(node)
    else return () => {}
  } else if (node.textContent !== CSS) {
    node.textContent = CSS
  }
  return () => {
    try {
      node.remove()
    } catch {
      // 节点已经被宿主清掉了，无事可做
    }
  }
}

/**
 * 小浮层的内容区：词性 + 中文释义（≤2 条）+ 考纲标签。
 *
 * @param {object} props
 * @param {import('./dict.js').LookupResult} props.result
 * @param {string} props.word - 用户悬停的原词（可能与词头不同，如 ran → run）
 * @param {import('./config.js').UxAppearance} props.appearance
 * @param {(tag: string) => string} props.tagLabel
 * @returns {import('react').ReactElement}
 */
export function PopoverBody(props) {
  const { result, word, appearance, tagLabel } = props
  const brief = result?.brief ?? { pos: '', zh: '', tags: [] }
  const limit = appearance?.maxSensesInPopover ?? 2
  const senses = Array.isArray(result?.senses) ? result.senses : []
  const shown = senses.slice(0, limit)
  const hasMore = senses.length > limit || (result?.hasDetail === true)

  const inBook = props.inBook === true
  const children = []
  // 头部：词 + 星标（点亮表示已在生词本）
  children.push(h('div', { key: 'head', className: 'hd-word-row' },
    h('span', {
      className: 'hd-word',
      style: inBook ? { color: 'var(--dsw-alias-state-error-primary, #e5484d)' } : undefined,
    }, word ?? ''),
    h('button', {
      key: 'star',
      className: `hd-star${inBook ? ' hd-star-on' : ''}`,
      type: 'button',
      title: inBook ? '已在生词本，点击移出' : '加入生词本',
      'aria-pressed': inBook ? 'true' : 'false',
      onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onToggleStar?.()
      },
    }, inBook ? '★' : '☆'),
  ))
  for (let i = 0; i < shown.length; i += 1) {
    const sense = shown[i]
    children.push(h('div', { key: `s${i}`, className: 'hd-row' },
      sense.posLabel ? h('span', { className: 'hd-pos' }, sense.posLabel) : null,
      h('span', { className: 'hd-zh' }, sense.zh.join('；')),
    ))
  }
  if (hasMore) children.push(h('div', { key: 'more', className: 'hd-more' }, '点击查看完整词条'))

  const tags = Array.isArray(brief.tags) && appearance?.showTags !== false
    ? brief.tags.map((tag) => h('span', { key: tag, className: 'hd-tag' }, tagLabel ? tagLabel(tag) : tag))
    : []
  if (tags.length > 0) children.push(h('div', { key: 'tags', className: 'hd-tags' }, tags))

  return h('div', null, children)
}

/**
 * 「查不到 / 加载中 / 出错」三态提示。
 *
 * 查不到词**不弹空白浮层**：专有名词、变量名太常见，每个都弹「未收录」比不弹更吵。
 *
 * @param {object} props
 * @param {{ status?: string, message?: string }} props.result
 * @param {() => void} props.onRetry
 * @returns {import('react').ReactElement | null}
 */
export function StatusNote(props) {
  const status = props?.result?.status
  if (status === 'miss') return null
  if (status === 'error') {
    return h('div', {
      className: 'hd-note',
      onMouseDown: (event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onRetry?.()
      },
    }, props.result?.message ?? '词库未就绪，点此重试')
  }
  if (status === 'loading' || status === 'not-ready') {
    return h('div', { className: 'hd-note' }, '词库加载中…')
  }
  return null
}

/**
 * 句子/短语的翻译卡片。
 *
 * 与单词浮层的区别：这类内容是「一段话」，可能很长，所以卡片有最大高度、
 * 内部滚动，并且不随鼠标离开消失（由 app.js 的「点外面才关」保证）。
 *
 * @param {object} props
 * @param {string} props.text
 * @param {string} props.translation
 * @param {boolean} props.translating
 * @param {string} props.error
 * @param {import('./position.js').Placement} props.placement
 * @param {import('./config.js').UxAppearance} props.appearance
 * @param {() => void} props.onClose
 * @param {() => void} props.onRetry
 * @returns {import('react').ReactElement}
 */
export function PhraseBody(props) {
  const placement = props.placement ?? { top: 0, left: 0 }
  const appearance = props.appearance ?? {}
  const maxWidth = appearance.cardMaxWidthPx ?? 420
  const maxHeight = Math.round(
    (typeof window !== 'undefined' ? window.innerHeight : 800)
    * (appearance.cardMaxHeightRatio ?? 0.7),
  )

  const children = []
  children.push(h('button', {
    key: 'close',
    className: 'hd-close',
    type: 'button',
    title: '关闭',
    onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      props.onClose?.()
    },
  }, '×'))

  children.push(h('div', {
    key: 'src',
    className: 'hd-ex-zh',
    style: { marginBottom: '6px' },
  }, props.text ?? ''))

  if (props.translating) {
    children.push(h('div', { key: 'loading', className: 'hd-more' }, '翻译中…'))
  } else if (props.error) {
    children.push(h('div', {
      key: 'err',
      className: 'hd-note',
      onMouseDown: (event) => { event.preventDefault(); props.onRetry?.() },
    }, props.error))
  } else if (props.translation) {
    children.push(h('div', { key: 'dst', className: 'hd-zh' }, props.translation))
  } else {
    children.push(h('div', { key: 'empty', className: 'hd-more' }, '没有译文'))
  }

  return h('div', {
    className: 'hd-card',
    style: {
      top: `${placement.top}px`,
      left: `${placement.left}px`,
      width: `${maxWidth}px`,
      maxHeight: `${maxHeight}px`,
    },
    onMouseDown: (event) => event.stopPropagation(),
  }, children)
}
