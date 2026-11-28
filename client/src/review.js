/**
 * review.js —— 复习卡片（设计-v2 §B3）。
 *
 * 词海口径的刷词卡：从 `wordbook.dueQueue()` 出题，翻面看释义，三键评分。
 *
 * 分工：
 *   - 纯函数（出题队列、进度、成绩）留在本文件导出的普通函数里，node 可测；
 *   - React 部分只拿这些函数的结果画界面，不自己算。
 *
 * 键盘：空格/回车翻面，1/2/3 评分，Esc 退出本轮。
 * 焦点在输入框里时不抢键 —— 复习页没有输入框，但仍然照规矩判一遍。
 */

import { briefOf, describeEntry } from './dict.js'
import { normalizeKey } from './word.js'

/** 三个评分按钮的显示文案，与设计 §B3 一致。 */
export const GRADE_BUTTONS = Object.freeze([
  { grade: 'again', key: '1', label: '✗ 不认识', tone: 'danger', state: 'unknown' },
  { grade: 'hard', key: '2', label: '↻ 记错', tone: 'warn', state: 'fuzzy' },
  { grade: 'good', key: '3', label: '✓ 认识', tone: 'success', state: 'known' },
])

/** 筛选芯片：全部到期 / 只刷不认识 / 只刷记错 / 指定词书（词书由下拉另选）。 */
export const REVIEW_FILTERS = Object.freeze([
  { id: 'all', label: '全部到期' },
  { id: 'unknown', label: '只刷不认识' },
  { id: 'fuzzy', label: '只刷记错' },
])

/** 队列空时的「提前复习」取多少个。 */
export const AHEAD_COUNT = 20

/** 方向：英→中 / 中→英。 */
export const DIRECTIONS = Object.freeze([
  { id: 'en-zh', label: '英 → 中' },
  { id: 'zh-en', label: '中 → 英' },
])

/**
 * 词条属于哪几本词书。
 *
 * @param {object} entry
 * @returns {string[]}
 */
export function booksOfEntry(entry) {
  if (!entry || typeof entry !== 'object') return []
  const out = []
  if (typeof entry.bookId === 'string' && entry.bookId !== '') out.push(entry.bookId)
  if (Array.isArray(entry.alsoIn)) {
    for (const id of entry.alsoIn) {
      if (typeof id === 'string' && id !== '' && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/** 「全部」哨兵：state 与 bookId 两个下拉都用它表示「不筛」。 */
const ALL = 'all'

/**
 * 按筛选条件从词条数组里取复习队列。
 *
 * **`bookId === 'all'` 必须当「不筛」**，不能当真词书 id 去匹配。
 * 这是 1.3.2 修掉的真 bug：设置页那个词书下拉的默认值是 `'all'`（「全部词书」），
 * 它被原样传进来当 bookId，而没有任何词的 `bookId` 是 `'all'`（都是 `'default'`），
 * 于是 `booksOfEntry(entry).includes('all')` 恒假 —— **全部词被过滤光**，
 * 复习队列恒空，界面永远显示「今天没有到期的词」，点「开始复习/提前复习」也毫无反应。
 * 实测（3 个 due=0 的词）：`dueQueue()=3`，`bookId:'all'` → 0，`bookId:''` → 3。
 *
 * state 那边一直是这么处理的（`state !== 'all'` 才过滤），bookId 现在对齐。
 *
 * @param {object[]} entries 通常来自 `wordbook.dueQueue(now)`
 * @param {{ state?: 'all'|'unknown'|'fuzzy', bookId?: string }} [filter]
 * @returns {object[]}
 */
export function filterQueue(entries, filter) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.head === 'string' && e.head !== '') : []
  const state = filter?.state ?? ALL
  const rawBook = typeof filter?.bookId === 'string' ? filter.bookId : ''
  const bookId = rawBook !== '' && rawBook !== ALL ? rawBook : ''
  return list.filter((entry) => {
    if (state !== ALL && entry.state !== state) return false
    if (bookId !== '') {
      const books = booksOfEntry(entry)
      if (!books.includes(bookId)) return false
    }
    return true
  })
}

/**
 * 中→英方向可用性：没有释义的词不进这个队列（设计 §B3）。
 *
 * @param {object} entry
 * @param {object|null} dict 词库对象（可能还没加载）
 * @returns {string} 可用于出题的释义；空串表示这个词不能从前向后问
 */
export function briefTextFor(entry, dict) {
  if (!entry || typeof entry !== 'object') return ''
  if (typeof entry.gloss === 'string' && entry.gloss.trim() !== '') return entry.gloss.trim()
  const head = normalizeKey(entry.head)
  const raw = dict?.entries?.[head]
  if (!raw) return ''
  try {
    const brief = briefOf(raw)
    return typeof brief?.zh === 'string' ? brief.zh.trim() : ''
  } catch {
    return ''
  }
}

/**
 * 为某个方向准备队列：中→英会剔掉没有释义的词。
 *
 * @param {object[]} queue
 * @param {'en-zh'|'zh-en'} direction
 * @param {object|null} dict
 * @returns {object[]}
 */
export function queueForDirection(queue, direction, dict) {
  const list = Array.isArray(queue) ? queue : []
  if (direction !== 'zh-en') return list.slice()
  return list.filter((entry) => briefTextFor(entry, dict) !== '')
}

/**
 * 取一个词的卡片背面内容（词性 + 中文义项 ≤3 + 例句 1 条）。
 *
 * 例句形状跟 describeEntry 一致，是 `{ en, zh }` 对象（架构 §4.5 的渲染契约），
 * 不是 `[en, zh]` 数组 —— 这里不再二次转换，免得两处形状打架。
 *
 * @param {string} head
 * @param {object|null} dict
 * @returns {{ senses: Array<{pos:string,posLabel:string,zh:string[]}>, example: {en:string,zh:string}|null, gloss: string }}
 */
export function cardBackFor(head, dict) {
  const empty = { senses: [], example: null, gloss: '' }
  const key = normalizeKey(head)
  if (key === '') return empty
  const raw = dict?.entries?.[key]
  if (!raw) return empty
  try {
    const described = describeEntry(raw)
    const senses = described.senses.slice(0, 3).map((sense) => ({
      pos: sense.pos,
      posLabel: sense.posLabel,
      zh: Array.isArray(sense.zh) ? sense.zh.slice(0, 2) : [],
    }))
    const example = described.examples.length > 0 ? described.examples[0] : null
    return { senses, example, gloss: '' }
  } catch {
    return empty
  }
}

/**
 * 本轮成绩：正确率 + 三态变化。
 *
 * @param {Array<{grade:string}>} answered 本轮已评分的记录
 * @returns {{ total:number, correct:number, again:number, hard:number, good:number, accuracy:number }}
 */
export function roundSummary(answered) {
  const list = Array.isArray(answered) ? answered : []
  let again = 0
  let hard = 0
  let good = 0
  for (const row of list) {
    if (row?.grade === 'again') again += 1
    else if (row?.grade === 'hard') hard += 1
    else if (row?.grade === 'good') good += 1
  }
  const total = again + hard + good
  return {
    total,
    correct: good,
    again,
    hard,
    good,
    accuracy: total === 0 ? 0 : Math.round((good / total) * 100),
  }
}

/** 相对时间：今天 / 明天 / N 天后 / 已到期。 */
export function dueLabel(due, now = Date.now()) {
  const at = Number.isFinite(due) ? due : 0
  if (at <= now) return '已到期'
  const days = Math.ceil((at - now) / 86400000)
  if (days <= 1) return '今天或明天'
  return `${days} 天后`
}

/**
 * 从「最早到期」里取前 N 个，用于空队列时的「提前复习」。
 *
 * @param {object[]} entries 全部词条（不是 dueQueue 的结果）
 * @param {number} [count]
 * @param {number} [now]
 * @returns {object[]}
 */
export function aheadQueue(entries, count = AHEAD_COUNT, now = Date.now()) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.head === 'string' && e.head !== '') : []
  return list
    .slice()
    .sort((a, b) => {
      const da = Number.isFinite(a.srs?.due) ? a.srs.due : 0
      const db = Number.isFinite(b.srs?.due) ? b.srs.due : 0
      if (da !== db) return da - db
      return (a.addedAt ?? 0) - (b.addedAt ?? 0)
    })
    .slice(0, Math.max(1, Number.isFinite(count) ? count : AHEAD_COUNT))
}

/**
 * 判断键盘事件该不该被复习卡接管。
 *
 * 焦点在输入框/文本域/可编辑区里时不抢键（设计 §B3）。
 *
 * @param {object} event 键盘事件
 * @returns {boolean}
 */
export function shouldHandleKey(event) {
  if (!event || typeof event !== 'object') return false
  if (event.defaultPrevented === true) return false
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return false
  const target = event.target
  if (target && typeof target === 'object') {
    const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : ''
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false
    if (target.isContentEditable === true) return false
  }
  const key = typeof event.key === 'string' ? event.key : ''
  if (key === ' ' || key === 'Spacebar' || key === 'Enter' || key === 'Escape') return true
  return key === '1' || key === '2' || key === '3'
}

/** 键盘键 → 动作。 */
export function actionForKey(key) {
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') return 'flip'
  if (key === 'Escape') return 'exit'
  if (key === '1') return 'again'
  if (key === '2') return 'hard'
  if (key === '3') return 'good'
  return ''
}

/* ═══════════════════════════════════════════════════════════════════════
   发音（设计 §E1）
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 这个环境能不能发音。
 *
 * 一律先判空再渲染按钮：不支持的浏览器上留一个点了没反应的 🔊，
 * 比不显示更糟 —— 用户会以为插件坏了。
 *
 * @returns {boolean}
 */
export function canSpeak() {
  if (typeof speechSynthesis === 'undefined') return false
  if (typeof SpeechSynthesisUtterance === 'undefined') return false
  return typeof speechSynthesis.speak === 'function'
}

/**
 * 当前正在念的那个词。null = 没在念（或念完了）。
 *
 * 为什么需要它：句柄只有「有没有在念」，没有「在念哪个词」。只判
 * `speaking===true` 就把「换一个词接着念」误当成「再点一次=停止」，
 * 于是念 A 时点 B 的喇叭 → cancel 掉 A 却不念 B —— 用户听到的是静音。
 * 实测就是这个现象，也是用户说的「有些词有声音、有些没有」（停下来后
 * 再点同一个词才出声）。
 */
let currentWord = null

/**
 * 念一个词；已经在念**同一个词**就停下（再点一次 = 停止）。
 *
 * 三种情况要分清（这就是这条修的核心）：
 *   1. 正在念 A，点 A  → cancel，返回 'stop'（设计 §E1 的再点即停）
 *   2. 正在念 A，点 B  → cancel 掉 A，然后**接着念 B**（返回 'speak'）
 *   3. 没在念，点 X    → 清残留后念 X
 *
 * 只走浏览器内置的 speechSynthesis，不引在线发音接口（离线红线）。
 * 任何异常都吃掉并返回 'failed'，卡片渲染路径上不能抛。
 *
 * @param {string} word
 * @param {() => void} [onDone] 念完/出错/被停时回调（按钮用它复位 speaking 状态）
 * @returns {'speak' | 'stop' | 'unsupported' | 'failed'}
 */
export function speakWord(word, onDone) {
  if (!canSpeak()) return 'unsupported'
  const text = String(word ?? '').trim()
  if (text === '') return 'failed'
  const done = typeof onDone === 'function' ? onDone : null
  try {
    const busy = speechSynthesis.speaking === true || speechSynthesis.pending === true

    // 情况 1：正在念的就是这个词 → 停
    if (busy && currentWord === text) {
      speechSynthesis.cancel()
      currentWord = null
      if (done) done()
      return 'stop'
    }

    // 情况 2 / 3：换词接着念，或本来就没在念。
    // 都要先 cancel 清掉残留（换词时就是停掉旧词，之后**不返回**，继续往下念新词）。
    speechSynthesis.cancel()
    currentWord = text
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 0.9
    // 念完/出错要复位：既清 currentWord（下次点同一个词能重新念），
    // 也让按钮把那颗高亮状态收回去 —— 否则按钮会一直显示「正在念」。
    const settle = () => {
      if (currentWord === text) currentWord = null
      if (done) done()
    }
    utterance.onend = settle
    utterance.onerror = settle
    speechSynthesis.speak(utterance)
    return 'speak'
  } catch {
    return 'failed'
  }
}

/**
 * 🔊 发音按钮。
 *
 * 不支持 speechSynthesis 时**返回 null**，不留死按钮（设计 §E1）。
 * 样式写死在这里而不是 overlay.js 的 CSS 表：card.js 与 review 卡都在
 * 各自的容器里，一处内联比两处类名更好维护，也不用改动范围外的文件。
 *
 * @param {object} props
 * @param {string} props.word
 * @param {'sm'|'md'} [props.size]
 * @returns {import('react').ReactElement | null}
 */
export function PronounceButton(props) {
  if (!canSpeak()) return null
  const word = String(props?.word ?? '').trim()
  if (word === '') return null
  const small = props?.size === 'sm'
  const [speaking, setSpeaking] = useState(false)
  return h('button', {
    type: 'button',
    className: 'hd-speak',
    title: speaking ? '停止发音' : `朗读 ${word}`,
    'aria-label': speaking ? '停止发音' : `朗读 ${word}`,
    'data-speaking': speaking ? 'true' : undefined,
    style: {
      flex: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: small ? 22 : 26,
      height: small ? 22 : 26,
      padding: 0,
      border: 'none',
      borderRadius: 6,
      background: 'transparent',
      color: speaking
        ? 'var(--dsw-alias-brand-primary, #4d6bfe)'
        : 'var(--dsw-alias-label-secondary, #999)',
      fontSize: small ? 12 : 14,
      lineHeight: 1,
      cursor: 'pointer',
      transition: 'color .18s ease, background .18s ease',
    },
    onPointerDown: (event) => event.stopPropagation(),
    onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      // 把「念完了」的复位接到按钮上：不接的话 data-speaking 会一直是 true，
      // 用户看到喇叭一直亮着像还在念，而且下一次点击的语义也会错乱。
      const result = speakWord(word, () => setSpeaking(false))
      setSpeaking(result === 'speak')
    },
  }, '🔊')
}

/**
 * 复习卡背面的内容块（设计 §B3 背面 + §E1 发音）。
 *
 * 为什么放在 review.js 而不是设置页里：这是「复习卡的卡片」本身的形状，
 * 和出题/评分同属一层；设置页只负责把它塞进自己的容器里。
 * 背面 = 词头（带 🔊）+ 词性义项（≤3）+ 例句（有则 1 条）。
 *
 * @param {object} props
 * @param {string} props.word 词头
 * @param {{ senses: Array<{posLabel:string, zh:string[]}>, example: {en:string,zh:string}|null }} props.back
 * @param {string} [props.gloss] 词库未收录时的释义快照
 * @param {'sm'|'md'} [props.size] 词头字号档位
 * @param {object} [props.P] makePrimitives 的返回（取 GAP/C/FS）
 * @returns {import('react').ReactElement}
 */
export function ReviewCardBack(props) {
  const back = props?.back ?? { senses: [], example: null }
  const senses = Array.isArray(back.senses) ? back.senses.slice(0, 3) : []
  const example = back.example && typeof back.example === 'object' ? back.example : null
  const gloss = typeof props?.gloss === 'string' ? props.gloss.trim() : ''
  const P = props?.P ?? {}
  const FS = P.FS ?? { title: 15, body: 13, small: 11.5 }
  const C = P.C ?? {
    text: 'var(--dsw-alias-label-primary, #1a1a1a)',
    textDim: 'var(--dsw-alias-label-secondary, #5c5c5c)',
    border2: 'var(--dsw-alias-border-l2, rgba(0,0,0,.18))',
  }

  // 词头 + 发音按钮：词头单独一行，按钮紧贴其后（设计 §E1 的「词头旁」）
  const head = h('div', {
    key: 'head',
    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  }, [
    h('span', {
      key: 'w',
      style: {
        fontSize: props?.size === 'sm' ? FS.title : FS.title + 5,
        fontWeight: 680,
        letterSpacing: '-.5px',
        lineHeight: 1.3,
        fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
        overflowWrap: 'anywhere',
      },
    }, String(props?.word ?? '')),
    h(PronounceButton, { key: 'speak', word: props?.word ?? '' }),
  ])

  const body = []
  if (senses.length > 0) {
    for (let i = 0; i < senses.length; i += 1) {
      const sense = senses[i]
      body.push(h('div', {
        key: `s${i}`,
        style: { display: 'flex', gap: 7, alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap' },
      }, [
        sense?.posLabel ? h('span', {
          key: 'p',
          style: {
            fontSize: 10.5,
            lineHeight: 1.7,
            padding: '0 6px',
            borderRadius: 999,
            border: `1px solid ${C.border2}`,
            color: C.textDim,
          },
        }, sense.posLabel) : null,
        h('span', { key: 'z' }, (sense?.zh ?? []).join('；')),
      ]))
    }
  } else {
    body.push(h('div', {
      key: 'g',
      style: { display: 'flex', gap: 7, justifyContent: 'center', flexWrap: 'wrap' },
    }, h('span', { key: 'z', style: { color: C.textDim } }, gloss || '词库未收录，暂无释义')))
  }

  if (example && example.en) {
    body.push(h('div', {
      key: 'ex',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontSize: FS.small + 0.5,
        lineHeight: 1.9,
        color: C.textDim,
        maxWidth: '52ch',
        borderTop: `1px dashed ${C.border2}`,
        paddingTop: 8,
        textAlign: 'center',
      },
    }, [
      h('div', { key: 'en' }, example.en),
      example.zh ? h('div', { key: 'zh', style: { opacity: 0.82 } }, example.zh) : null,
    ]))
  }

  return h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: '100%' },
  }, [head, ...body])
}

