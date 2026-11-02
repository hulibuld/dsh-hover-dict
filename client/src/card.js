/**
 * card.js —— 点击单词后就地摊开的「大卡片」。
 *
 * 与浮层的分工：浮层只说「这是什么意思」，卡片给全 —— 按词性分组的全部义项、
 * 英英释义、词形变化、双语例句。
 *
 * 卡片是**就地**弹的（不是右侧栏）：用户点一个词，眼睛就在那个词上，
 * 把他拽到别处会丢上下文。代价是卡片会压住正文，所以它可关闭、可固定、有高度上限。
 */
import { attachDrag } from './drag.js'

/** 词根类型 → 中文。 */
const TYPE_LABELS = {
  root: '词根',
  prefix: '前缀',
  suffix: '后缀',
  noun: '名词后缀',
  adj: '形容词后缀',
  adv: '副词后缀',
  verb: '动词后缀',
  inflection: '屈折',
}

/**
 * 判断一次点击该不该把浮层升级成卡片。
 *
 * 只在点中锚点词本身时才升级：
 *   - 用户在浮层里选文字复制，不该变成开卡片；
 *   - 带修饰键（Cmd/Ctrl）的点击是「开链接」的手势，不要抢；
 *   - 有文本选区说明用户刚拖选过，这时点击是取消选区，不是查词。
 *
 * @param {object} input
 * @param {{ x: number, y: number }} input.point
 * @param {import('./anchor.js').WordAnchor | null} input.anchor
 * @param {boolean} [input.modified]
 * @param {boolean} [input.hasSelection]
 * @returns {'open' | 'toggle' | 'ignore'}
 */
export function pickUpgradeTarget(input) {
  if (!input || !input.anchor) return 'ignore'
  if (input.modified === true) return 'ignore'
  if (input.hasSelection === true) return 'ignore'
  const point = input.point
  const bounds = input.anchor.bounds
  if (!point || !bounds) return 'ignore'
  // 外扩 3px：点在词的边缘上也算点中
  const inside = point.x >= bounds.left - 3 && point.x <= bounds.right + 3
    && point.y >= bounds.top - 3 && point.y <= bounds.bottom + 3
  return inside ? 'open' : 'ignore'
}

/**
 * 把例句里的目标词标出来。
 *
 * 按词边界匹配、忽略大小写，同时匹配词汇的原形与变位 —— 例句里出现的是
 * `running` 而词头是 `run` 时，也要能标亮。
 *
 * @param {string} sentence
 * @param {string} word
 * @param {ReadonlyArray<string>} [forms]
 * @returns {Array<{ text: string, hit: boolean }>}
 */
export function splitExample(sentence, word, forms) {
  if (typeof sentence !== 'string' || sentence === '') return []
  const targets = new Set()
  if (typeof word === 'string' && word.length > 0) targets.add(word.toLowerCase())
  if (Array.isArray(forms)) {
    for (const form of forms) {
      if (typeof form === 'string' && form.length > 0) targets.add(form.toLowerCase())
    }
  }
  if (targets.size === 0) return [{ text: sentence, hit: false }]

  const out = []
  const pattern = /[A-Za-z][A-Za-z'’-]*/g
  let last = 0
  let match
  while ((match = pattern.exec(sentence)) !== null) {
    const isHit = targets.has(match[0].toLowerCase())
    if (!isHit) continue
    if (match.index > last) out.push({ text: sentence.slice(last, match.index), hit: false })
    out.push({ text: match[0], hit: true })
    last = match.index + match[0].length
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last), hit: false })
  return out.length > 0 ? out : [{ text: sentence, hit: false }]
}

/**
 * 大卡片组件。
 *
 * @param {object} props
 * @param {string} props.word
 * @param {ReturnType<typeof import('./dict.js').describeEntry>} props.entry
 * @param {import('./position.js').Placement} props.placement
 * @param {{ cardMaxWidthPx: number, cardMaxHeightRatio: number }} props.appearance
 * @param {boolean} props.pinned
 * @param {() => void} props.onTogglePin
 * @param {() => void} props.onClose
 * @param {() => void} props.onPointerEnter
 * @param {() => void} props.onPointerLeave
 * @returns {import('react').ReactElement}
 */
export function CardRoot(props) {
  const entry = props.entry ?? { senses: [], tags: [], tagsLabel: [], forms: [], examples: [] }
  const placement = props.placement ?? { top: 0, left: 0 }
  const appearance = props.appearance ?? {}
  const maxHeight = Math.round((typeof window !== 'undefined' ? window.innerHeight : 800)
    * (appearance.cardMaxHeightRatio ?? 0.7))

  // 拖动状态：用户拖过之后，卡片位置由他决定，不再走自动摆放。
  const [dragPos, setDragPos] = useState(null)
  const panelRef = useRef(null)
  const handleRef = useRef(null)

  // 绑定拖动。位置变了就记住，下次开卡片沿用。
  useEffect(() => {
    const panel = panelRef.current
    const handle = handleRef.current
    if (!panel || !handle) return undefined
    const viewport = {
      width: typeof window !== 'undefined' ? window.innerWidth : 1200,
      height: typeof window !== 'undefined' ? window.innerHeight : 800,
    }
    return attachDrag({
      handle,
      panel,
      doc: panel.ownerDocument ?? document,
      viewport,
      onEnd: (pos) => {
        setDragPos(pos)
        props.onMoved?.(pos)
      },
      onClick: () => {
        // 拖动把手上没移动就点击 → 回到自动位置
        setDragPos(null)
        props.onMoved?.(null)
      },
    })
  }, [props])

  const top = dragPos !== null ? dragPos.top : placement.top
  const left = dragPos !== null ? dragPos.left : placement.left

  const children = []

  // 头部：词 + 星标。星标点亮表示这个词已在生词本里。
  // 这一条同时是拖动把手 —— 顶部是自然的抓取位置。
  const inBook = props.inBook === true
  // 头部拆成两块：左边是拖动把手，右边是星标。
  // 之前星标嵌在把手内部，把手的 pointerdown 会 preventDefault 并抢指针捕获，
  // 星标的点击因此收不到 —— 用户点了没反应。
  children.push(h('div', {
    key: 'head',
    className: 'hd-word-row',
    style: { display: 'flex', alignItems: 'center', gap: 8 },
  }, [
    h('div', {
      key: 'grab',
      className: 'hd-drag-handle',
      ref: handleRef,
      title: '拖动可移动位置，单击回到原位',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flex: 1,
        minWidth: 0,
        cursor: 'grab',
        userSelect: 'none',
      },
    },
    h('span', {
      className: 'hd-word',
      // 当前词在生词本里 → 标题标红
      style: inBook ? { color: 'var(--dsw-alias-state-error-primary, #e5484d)' } : undefined,
    }, props.word ?? '')),
    h('button', {
      key: 'star',
      className: `hd-star${inBook ? ' hd-star-on' : ''}`,
      type: 'button',
      title: inBook ? '已在生词本，点击移出' : '加入生词本',
      'aria-pressed': inBook ? 'true' : 'false',
      onPointerDown: (event) => event.stopPropagation(),
      onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onToggleStar?.()
      },
    }, inBook ? '★' : '☆'),
  ]))
  children.push(h('button', {
    key: 'close',
    className: 'hd-close',
    type: 'button',
    title: props.pinned ? '取消固定' : '固定',
    onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      props.onClose?.()
    },
  }, '×'))

  if (entry.senses.length > 0) {
    children.push(h(SenseGroups, { key: 'senses', groups: entry.senses }))
  }
  // 词形变化：这些形式若在生词本里同样标红
  if (entry.forms.length > 0) {
    const inBookSet = props.inBookSet ?? new Set()
    children.push(h('div', { key: 'forms-head', className: 'hd-section' }, '词形变化'))
    children.push(h('div', { key: 'forms', className: 'hd-forms' },
      entry.forms.map(([form, label], index) => h('span', {
        key: index,
        style: inBookSet.has(form) ? { color: 'var(--dsw-alias-state-error-primary, #e5484d)' } : undefined,
      }, `${label} ${form}`))))
  }

  // 同根词：标蓝。点一下会切到那个词。
  const family = props.family
  if (family && family.derived && family.derived.length > 0) {
    const inBookSet = props.inBookSet ?? new Set()
    children.push(h('div', { key: 'family-head', className: 'hd-section' }, '同根词'))
    children.push(h('div', {
      key: 'family',
      className: 'hd-family',
    }, family.derived.map((item, index) => h('span', {
      key: index,
      className: 'hd-family-item',
      style: {
        // 已在生词本里的同根词仍标红（红优先于蓝），否则标蓝
        color: inBookSet.has(item.word)
          ? 'var(--dsw-alias-state-error-primary, #e5484d)'
          : 'var(--dsw-alias-brand-primary, #3b82f6)',
        cursor: 'pointer',
      },
      onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        props.onSelectWord?.(item.word)
      },
      title: item.reason,
    }, item.word))))
  }

  // 词根词缀分析
  const roots = props.roots
  if (Array.isArray(roots) && roots.length > 0) {
    children.push(h('div', { key: 'roots-head', className: 'hd-section' }, '词根词缀'))
    children.push(h('div', { key: 'roots', className: 'hd-roots' },
      roots.map((item, index) => h('div', {
        key: index,
        className: 'hd-root-row',
        style: item.weak ? { opacity: 0.6 } : undefined,
      },
      h('span', { className: 'hd-root-part' }, item.part ?? ''),
      h('span', { className: 'hd-pos' }, TYPE_LABELS[item.type] ?? item.type ?? ''),
      h('span', { className: 'hd-zh' }, item.meaning ?? ''),
      item.origin ? h('span', { className: 'hd-root-origin' }, item.origin) : null,
      ))))
  }
  if (entry.examples.length > 0) {
    children.push(h('div', { key: 'ex-head', className: 'hd-section' }, '例句'))
    children.push(h(Examples, {
      key: 'examples',
      examples: entry.examples,
      word: props.word,
      forms: entry.forms.map(([form]) => form),
    }))
  }
  if (entry.tagsLabel.length > 0) {
    children.push(h('div', { key: 'tags', className: 'hd-tags' },
      entry.tagsLabel.map((tag) => h('span', { key: tag, className: 'hd-tag' }, tag))))
  }

  return h('div', {
    className: 'hd-card',
    ref: panelRef,
    style: {
      top: `${top}px`,
      left: `${left}px`,
      width: `${appearance.cardMaxWidthPx ?? 420}px`,
      maxHeight: `${maxHeight}px`,
    },
    onMouseEnter: () => props.onPointerEnter?.(),
    onMouseLeave: () => props.onPointerLeave?.(),
    onMouseDown: (event) => event.stopPropagation(),
  }, children)
}

/**
 * 按词性分组的义项。
 *
 * @param {object} props
 * @param {Array<{ posLabel: string, zh: string[], en: string[] }>} props.groups
 * @returns {import('react').ReactElement}
 */
export function SenseGroups(props) {
  const groups = Array.isArray(props?.groups) ? props.groups : []
  return h('div', null, groups.map((group, index) => h('div', {
    key: index,
    className: 'hd-row',
    style: { marginBottom: '4px' },
  },
  h('span', { className: 'hd-pos' }, group.posLabel ?? ''),
  h('div', null,
    h('div', { className: 'hd-zh' }, (group.zh ?? []).join('；')),
    (group.en ?? []).length > 0
      ? h('div', { className: 'hd-ex-zh', style: { fontStyle: 'italic' } }, (group.en ?? []).join('; '))
      : null,
  ))))
}

/**
 * 例句列表。目标词加粗标出。
 *
 * @param {object} props
 * @param {Array<{ en: string, zh: string }>} props.examples
 * @param {string} props.word
 * @param {ReadonlyArray<string>} [props.forms]
 * @returns {import('react').ReactElement}
 */
export function Examples(props) {
  const examples = Array.isArray(props?.examples) ? props.examples : []
  return h('div', null, examples.map((example, index) => {
    const parts = splitExample(example.en, props.word, props.forms)
    return h('div', { key: index, className: 'hd-ex' },
      h('div', { className: 'hd-ex-en' }, parts.map((part, i) => (
        part.hit ? h('span', { key: i, className: 'hd-hit' }, part.text) : h('span', { key: i }, part.text)
      ))),
      example.zh ? h('div', { className: 'hd-ex-zh' }, example.zh) : null,
    )
  }))
}
