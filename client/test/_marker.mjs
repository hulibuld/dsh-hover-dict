// _marker.mjs —— 着色纯函数层单测（设计-v2 §C5）。
//
// 这里只测**不碰 React**的部分：词匹配、词集展开、视口裁剪、上限截断、
// 扫描器、调度器、色块样式。DOM 渲染与红线回归在 smoke.mjs 的假宿主里测。
//
// 假 DOM 刻意做得很薄：一个小小的元素/文本节点桩 + 一个能返回预设矩形的 Range 桩。
// 真实浏览器里走的是 TreeWalker + getClientRects，这里两条路径都要覆盖到。
import {
  MARK_MAX, VIEWPORT_PAD_PX, SCROLL_THROTTLE_MS, MUTATION_DEBOUNCE_MS,
  WORD_PATTERN, THINK_SELECTOR,
  expandWordSet, matchWordsInText, cullToViewport, normalizeViewport, viewportOf,
  capMarks, unionRectsOf, scanTextNodes, measureHits, buildMarks,
  createRecalcScheduler, bindRecalcEvents, blockerOf, collectTextNodes, resolveRoots, textOfNode,
  colorMix, styleOfMark,
  HIGHLIGHT_WORDS, HIGHLIGHT_KNOWN, supportsHighlight, markColorToCss, highlightCss,
  buildHighlightRanges, applyHighlights, clearHighlights,
} from '../src/marker.js'
import {
  DEFAULT_MARK_COLOR, DEFAULT_APPEARANCE, clampAppearance, normalizeMarkColor,
  MARK_STYLES, MARK_COLOR_PRESETS, THEME_ERROR_COLOR,
} from '../src/config.js'

let pass = 0
let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> ${JSON.stringify(got)}${ok ? '' : ` want ${JSON.stringify(want)}`}`)
}
const ok = (name, cond, detail) => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  —— ${detail}`}`)
}

/* ── 假 DOM ─────────────────────────────────────────────────────────── */

/** 元素桩：closest 按选择器表返回祖先或自己。 */
function fakeEl(map, children = []) {
  const node = {
    nodeType: 1,
    childNodes: children,
    closest: (sel) => (map && map[sel] !== undefined ? map[sel] : null),
    querySelector: (sel) => (map && map[sel] !== undefined ? map[sel] : null),
  }
  for (const kid of children) {
    kid.parentNode = node
    kid.parentElement = node
  }
  return node
}

/** 文本节点桩。 */
function fakeText(value) {
  return { nodeType: 3, nodeValue: value, data: value, parentNode: null, parentElement: null }
}

/** Range 桩：把 setStart/setEnd 记下来，getClientRects 返回节点预设的矩形。 */
function rangeStub() {
  const state = { node: null, start: 0, end: 0 }
  return {
    setStart(node, offset) { state.node = node; state.start = offset },
    setEnd(node, offset) { state.end = offset },
    getClientRects() {
      const table = state.node?.__rects
      if (!table) return []
      // 允许按字符偏移切成两段，模拟跨行
      const slice = table(state.start, state.end)
      return Array.isArray(slice) ? slice : []
    },
  }
}

/** 假 document：不带 createTreeWalker（走递归退化路径）。 */
function fakeDoc(roots = {}) {
  return {
    createRange: () => rangeStub(),
    querySelectorAll: (sel) => roots[sel] ?? [],
    querySelector: (sel) => (roots[sel] ?? [])[0] ?? null,
  }
}

const rect = (left, top, width = 30, height = 16) => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

/* ── 1. 词匹配 ─────────────────────────────────────────────────────── */

const keys = new Map([['cute', false], ['run', false], ['know', true], ['well-known', false]])

t('基本命中', matchWordsInText('a cute cat', keys).map((m) => m.key), ['cute'])
t('大小写不敏感', matchWordsInText('CUTE Cat', keys).map((m) => m.key), ['cute'])
t('未收录的词不命中', matchWordsInText('a cute dog', keys).map((m) => m.text), ['cute'])
t('已知词带 known 标记', matchWordsInText('i know', keys).map((m) => m.known), [true])
t('非 known 词 known=false', matchWordsInText('i run', keys).map((m) => m.known), [false])
t('多个命中按出现顺序', matchWordsInText('run and cute', keys).map((m) => m.key), ['run', 'cute'])
t('同词多次命中', matchWordsInText('run run', keys).length, 2)
t('起始偏移正确', matchWordsInText('xx run', keys)[0], { start: 3, end: 6, text: 'run', key: 'run', known: false })
t('连字符词命中', matchWordsInText('a well-known fact', keys).map((m) => m.key), ['well-known'])
t('纯数字不命中', matchWordsInText('42 3.14', keys), [])
t('中文不命中', matchWordsInText('这是一句 cute 的中文', keys).map((m) => m.key), ['cute'])
t('空文本', matchWordsInText('', keys), [])
t('空词集', matchWordsInText('cute', new Map()), [])
t('Set 词集也能用', matchWordsInText('cute', new Set(['cute'])).map((m) => m.key), ['cute'])

// 撇号：直撇号与弯撇号都要能命中（宿主渲染器有时会换成弯的）
const apos = new Map([["don't", false]])
t('直撇号', matchWordsInText("don't", apos).map((m) => m.key), ["don't"])
t('弯撇号也归一', matchWordsInText('don’t', apos).map((m) => m.key), ["don't"])

// 所有格是另一个 key（`cute's` ≠ `cute`），按设计「normalizeKey 后查 Set」不命中
t('所有格不命中', matchWordsInText("cute's", keys).map((m) => m.text), [])
t('词尾连字符裁掉', matchWordsInText('run-', keys).map((m) => m.text), ['run'])

// 超长片段不命中（base64 残段）
t('超长片段不命中', matchWordsInText('a'.repeat(70), keys), [])
t('64 字符上限内可命中', (() => {
  const long = 'a'.repeat(64)
  return matchWordsInText(long, new Map([[long, false]])).length
})(), 1)

// 正则全局状态不能跨调用污染（lastIndex 复位）
t('连续两次调用结果一致', [matchWordsInText('cute cute', keys).length, matchWordsInText('cute cute', keys).length], [2, 2])
ok('WORD_PATTERN 是全局正则', WORD_PATTERN.flags.includes('g'), WORD_PATTERN.source)

/* ── 2. 词集展开（含变位，槽 5 起） ─────────────────────────────────── */

const dict = {
  entries: {
    run: [[['v.', ['跑']]], null, null, null, null, 'p:ran/i:running/3:runs'],
    cute: [[['a.', ['可爱']]], null, null, null, null, 'r:cuter/t:cutest'],
    // 槽 4 里的字符串是历史包袱，不该被当变位读（parseForms 槽 5 起口径）
    odd: [[['n.', ['怪']]], null, null, null, 'p:wrong'],
  },
}

const bookEntries = [
  { head: 'run', state: 'unknown' },
  { head: 'cute', state: 'fuzzy' },
  { head: 'know', state: 'known' },
  { head: 'Zebra', state: 'new' },
  { head: '', state: 'new' },
]

const set1 = expandWordSet({ entries: bookEntries, dict })
t('known 的词默认不进词集', set1.has('know'), false)
t('词头进词集', [set1.has('run'), set1.has('cute'), set1.has('zebra')], [true, true, true])
t('变位进词集', [set1.has('ran'), set1.has('running'), set1.has('runs')], [true, true, true])
t('比较级/最高级进词集', [set1.has('cuter'), set1.has('cutest')], [true, true])
t('槽 4 的字符串不当变位', set1.has('wrong'), false)
t('空词头被丢掉', set1.has(''), false)
t('non-known 标记为 false', set1.get('run'), false)

const set2 = expandWordSet({ entries: bookEntries, dict, markKnown: true })
t('markKnown 时 known 进词集', set2.get('know'), true)
t('markKnown 时 known 标 true', set2.get('run'), false)
t('markKnown 不影响其它词', set2.get('ran'), false)

// 没有词库时只有词头（词库还没加载完的第一帧就是这样）
const set3 = expandWordSet({ entries: bookEntries })
t('无词库只有词头', [set3.has('run'), set3.has('ran')], [true, false])
t('无条目返回空', expandWordSet({}).size, 0)
t('空参不抛', expandWordSet(undefined).size, 0)

// 词头优先：变位不该把已知词头覆盖成别的标记
const set4 = expandWordSet({
  entries: [{ head: 'run', state: 'known' }, { head: 'back', state: 'new' }],
  dict: { entries: { back: [null, null, null, null, null, 'p:ran'] } },
  markKnown: true,
})
t('变位若与已收录词头同名，保持已有标记', [set4.get('run'), set4.get('back')], [true, false])

/* ── 3. 视口裁剪 ───────────────────────────────────────────────────── */

const viewport = { left: 0, top: 0, right: 800, bottom: 600 }
const inPad = rect(0, 0)
const outFar = rect(0, 1200)
const justInsidePad = rect(0, 600 + VIEWPORT_PAD_PX - 1)
const justOutsidePad = rect(0, 600 + VIEWPORT_PAD_PX + 1)

t('视口内保留', cullToViewport([inPad], viewport).length, 1)
t('远在视口外剔除', cullToViewport([outFar], viewport).length, 0)
t('余量内保留', cullToViewport([justInsidePad], viewport).length, 1)
t('余量外剔除', cullToViewport([justOutsidePad], viewport).length, 0)
t('水平方向同理', cullToViewport([rect(800 + VIEWPORT_PAD_PX + 5, 10)], viewport).length, 0)
t('零余量时边界外剔除', cullToViewport([rect(0, 601)], viewport, 0).length, 0)
t('空输入', cullToViewport([], viewport), [])
t('坏矩形被丢掉', cullToViewport([null, { left: 'x' }], viewport), [])
t('裁剪只留视口内且开区间不过界', cullToViewport([rect(0, 100, 30, 900)], viewport).length, 1)

t('normalizeViewport 加余量', normalizeViewport(viewport, 200), { left: -200, top: -200, right: 1000, bottom: 800 })
t('normalizeViewport 接受 width/height', normalizeViewport({ width: 800, height: 600 }, 0), { left: 0, top: 0, right: 800, bottom: 600 })
t('normalizeViewport 坏输入', normalizeViewport(null, 0), null)
t('viewportOf 无 window', viewportOf({}), null)
t('viewportOf 有 window', viewportOf({ defaultView: { innerWidth: 1024, innerHeight: 768 } }), { left: 0, top: 0, right: 1024, bottom: 768 })

/* ── 4. 上限截断 ───────────────────────────────────────────────────── */

const markAt = (left, top) => ({ key: 'x', rects: [rect(left, top)], bounds: rect(left, top) })

const many = []
for (let i = 0; i < 10; i += 1) many.push(markAt(0, i * 100))

const capped = capMarks(many, { max: 4, viewport: { width: 800, height: 1000 } })
t('上限生效', capped.length, 4)
// 视口中心 (400,500)：i=5 (top 500) 最近，i=4/6 次之
t('保留离中心最近的', capped.map((m) => m.bounds.top), [300, 400, 500, 600])
t('不足上限原样返回', capMarks(many, { max: 20, viewport }).length, 10)
t('默认上限是 400', capMarks(new Array(500).fill(0).map((_, i) => markAt(0, i)), {}).length, MARK_MAX)
t('空数组', capMarks([], {}), [])
t('max<=0 回默认', capMarks(new Array(500).fill(0).map((_, i) => markAt(0, i)), { max: 0 }).length, MARK_MAX)
t('同距离保持原顺序', (() => {
  const same = [markAt(0, 0), markAt(0, 0), markAt(0, 0)]
  return capMarks(same, { max: 2, viewport: { width: 0, height: 0 } }).length
})(), 2)
t('unionRectsOf 空数组', unionRectsOf([]), null)
t('unionRectsOf 并集', unionRectsOf([rect(10, 10), rect(30, 40)]), { left: 10, top: 10, right: 60, bottom: 56, width: 50, height: 46 })

/* ── 5. 扫描器 ─────────────────────────────────────────────────────── */

// 一棵小正文树：一段普通正文 + 一个代码块 + 一个思考区
const bodyText = fakeText('a cute cat runs fast')
const codeText = fakeText('cute runs')
const thinkText = fakeText('this cute thing')
const bodyPara = fakeEl({}, [bodyText])
const codePara = fakeEl({ 'pre, code, [data-code-block-content]': {} }, [codeText])
const thinkRoot = fakeEl({ [THINK_SELECTOR]: {} }, [thinkText])
const article = fakeEl({ '[data-chat-flow-kind="assistant-step"]': {} }, [bodyPara, codePara, thinkRoot])
const doc = fakeDoc({ '[data-chat-flow-kind="assistant-step"]': [article] })

const scanKeys = new Map([['cute', false], ['run', false], ['runs', false], ['this', false]])
const hits = scanTextNodes({ doc, keys: scanKeys })
t('扫到正文命中', hits.map((x) => x.key), ['cute', 'runs', 'this', 'cute'])
t('代码块被排除', hits.some((x) => x.node === codeText), false)
t('命中带区间', hits[0].start, 2)
t('思考区命中标 think', hits.filter((x) => x.think).map((x) => x.key), ['this', 'cute'])
t('正文命中 think=false', hits.filter((x) => !x.think).map((x) => x.key), ['cute', 'runs'])
t('空词集直接返回', scanTextNodes({ doc, keys: new Map() }), [])
t('无 doc', scanTextNodes({ keys: scanKeys }), [])
t('选择器无匹配', scanTextNodes({ doc: fakeDoc({}), keys: scanKeys }), [])
t('显式 root 元素', scanTextNodes({ doc, root: bodyPara, keys: scanKeys }).map((x) => x.key), ['cute', 'runs'])
t('显式 root 数组', scanTextNodes({ doc, root: [bodyPara, thinkRoot], keys: scanKeys }).map((x) => x.key), ['cute', 'runs', 'this', 'cute'])
t('显式 root 选择器', scanTextNodes({ doc, root: '[data-chat-flow-kind="assistant-step"]', keys: scanKeys }).length, 4)

// TreeWalker 路径：桩一个只能被调用一次的 walker，确认优先级
let walkerCalls = 0
const walkerDoc = {
  createRange: () => rangeStub(),
  createTreeWalker(root, what) {
    walkerCalls += 1
    const list = []
    const stack = [root]
    while (stack.length > 0) {
      const current = stack.shift()
      if (!current.childNodes) continue
      for (const kid of current.childNodes) {
        if (kid.nodeType === 3) list.push(kid)
        else stack.push(kid)
      }
    }
    let index = 0
    return { nextNode: () => list[index++] ?? null }
  },
  querySelectorAll: () => [article],
}
const walkerHits = scanTextNodes({ doc: walkerDoc, keys: scanKeys })
ok('TreeWalker 路径被走到', walkerCalls === 1, `${walkerCalls} 次`)
t('TreeWalker 结果与退化路径一致', walkerHits.map((x) => x.key), hits.map((x) => x.key))

t('collectTextNodes 文档顺序', collectTextNodes(doc, article).map((n) => n.nodeValue?.slice(0, 4)), ['a cu', 'cute', 'this'])
t('collectTextNodes 空根', collectTextNodes(doc, null), [])
t('resolveRoots 省略用 allowedRoot', resolveRoots(doc, null).length, 1)
ok('resolveRoots 元素', (() => { const r = resolveRoots(doc, article); return r.length === 1 && r[0] === article })())
t('textOfNode 用 nodeValue', textOfNode(bodyText), 'a cute cat runs fast')
t('textOfNode 用 data', textOfNode({ data: 'x' }), 'x')
t('textOfNode null', textOfNode(null), '')

// blockerOf 复用 hit.js 的判定，理由串要能对上
t('blockerOf 代码块', blockerOf(fakeEl({ 'pre, code, [data-code-block-content]': {} })), { blocked: true, reason: 'code' })
t('blockerOf 链接', blockerOf(fakeEl({ 'a[href]': {} })), { blocked: true, reason: 'link' })
t('blockerOf 自家覆盖层', blockerOf(fakeEl({ '[data-hover-dict-ui]': {} })), { blocked: true, reason: 'self' })
t('blockerOf 干净元素', blockerOf(fakeEl({})), { blocked: false, reason: 'ok' })
t('blockerOf 非元素不拦', blockerOf(null).blocked, false)

/* ── 6. 量矩形 + 端到端 buildMarks ──────────────────────────────────── */

bodyText.__rects = (start, end) => {
  // `cute` 在 2..6：跨行切成两段；其它按单段返回
  if (start === 2 && end === 6) return [rect(10, 100), rect(700, 100)]
  return [rect(100, 100)]
}

const measured = measureHits(scanTextNodes({ doc, root: bodyPara, keys: scanKeys }), { doc })
t('量出两个命中', measured.length, 2)
t('跨行保留两段矩形', measured[0].rects.length, 2)
t('bounds 是并集', measured[0].bounds, { left: 10, top: 100, right: 730, bottom: 116, width: 720, height: 16 })
t('无 createRange 的 doc 返回空', measureHits([{ node: bodyText, start: 0, end: 4 }], { doc: {} }), [])
t('坏节点跳过', measureHits([{ node: null, start: 0, end: 1 }], { doc }).length, 0)
t('空命中', measureHits([], { doc }), [])

// 0 宽矩形（换行处的空 Range）必须过滤掉
const zeroNode = fakeText('cute')
zeroNode.parentNode = bodyPara
zeroNode.parentElement = bodyPara
zeroNode.__rects = () => [rect(0, 0, 0, 0), rect(10, 10)]
t('0 宽矩形被过滤', measureHits([{ node: zeroNode, start: 0, end: 4, key: 'cute' }], { doc })[0].rects.length, 1)

bodyText.__rects = (start, end) => (start === 2 && end === 6 ? [rect(10, 100), rect(700, 100)] : [rect(100, 100)])
const built = buildMarks({ doc, keys: scanKeys, viewport: { left: 0, top: 0, right: 200, bottom: 600 } })
ok('buildMarks 端到端有结果', built.length > 0, `${built.length} 块`)
t('buildMarks 裁掉了视口外的段', (() => {
  const cute = built.find((m) => m.key === 'cute')
  return cute ? cute.rects.length : -1
})(), 1)
t('buildMarks 空词集返回空', buildMarks({ doc, keys: new Map(), viewport }), [])
t('buildMarks 无 doc 返回空', buildMarks({ doc: null, keys: scanKeys }), [])

/* ── 7. 调度器（假时钟） ───────────────────────────────────────────── */

function fakeClock() {
  let now = 0
  let seq = 1
  const timers = new Map()
  return {
    now: () => now,
    advance(ms) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.fn()
        }
      }
    },
    setTimeout: (fn, ms) => {
      const id = seq++
      timers.set(id, { at: now + Math.max(0, ms | 0), fn })
      return id
    },
    clearTimeout: (id) => { timers.delete(id) },
    count: () => timers.size,
  }
}

const clock = fakeClock()
let runs = 0
const sched = createRecalcScheduler({
  run: () => { runs += 1 },
  now: clock.now,
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
})

t('初始未跑', sched.runs(), 0)
t('常量口径', [SCROLL_THROTTLE_MS, MUTATION_DEBOUNCE_MS], [120, 250])

sched.scroll()
t('首次滚动立即重算', sched.runs(), 1)
sched.scroll()
t('窗口内第二次滚动只挂尾随', [sched.runs(), sched.pending().throttle], [1, true])
sched.scroll()
sched.scroll()
t('窗口内多次滚动只挂一个尾随', clock.count(), 1)
clock.advance(SCROLL_THROTTLE_MS)
t('尾随到点补跑一次', sched.runs(), 2)
t('尾随跑完清空', sched.pending().throttle, false)

sched.scroll()
t('窗口内再次滚动仍只挂尾随', sched.pending().throttle, true)
clock.advance(SCROLL_THROTTLE_MS + 10)
t('尾随补跑一次后 runs=3', sched.runs(), 3)
// 尾随刚跑完，此刻仍在窗口内，再滚一次只会挂尾随（不是立即跑）
t('尾随刚跑完仍在窗口内', (() => { sched.scroll(); return [sched.runs(), sched.pending().throttle] })(), [3, true])
clock.advance(SCROLL_THROTTLE_MS + 10)
sched.scroll()
t('间隔够时立即重算', sched.runs(), 4)

// 防抖：连续 mutate 只跑一次，且永远是最后一次之后 250ms
sched.cancel()
clock.advance(1000)
const before = sched.runs()
sched.mutate()
clock.advance(100)
sched.mutate()
clock.advance(100)
sched.mutate()
t('防抖期间没跑', sched.runs(), before)
t('防抖挂起中', sched.pending().debounce, true)
clock.advance(MUTATION_DEBOUNCE_MS - 1)
t('防抖未到点不跑', sched.runs(), before)
clock.advance(2)
t('静默满 250ms 才跑', sched.runs(), before + 1)

// resize：立即跑，并取消挂起的尾随与防抖
sched.scroll()
clock.advance(0)
const runsBeforeResize = sched.runs()
sched.mutate()
sched.resize()
t('resize 立即重算', sched.runs(), runsBeforeResize + 1)
t('resize 清掉挂起', sched.pending(), { throttle: false, debounce: false })
t('resize 后没有残留计时器', clock.count(), 0)

// request 无条件跑一次
const beforeReq = sched.runs()
sched.request()
t('request 无条件重算', sched.runs(), beforeReq + 1)

// dispose 之后所有触发都失效
sched.dispose()
const afterDispose = sched.runs()
sched.scroll()
sched.mutate()
sched.request()
clock.advance(1000)
t('dispose 后不再重算', sched.runs(), afterDispose)

// run 抛错不该让调度器失效
let boom = 0
const sched2 = createRecalcScheduler({
  run: () => { boom += 1; throw new Error('boom') },
  now: clock.now,
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
})
sched2.scroll()
sched2.scroll()
t('run 抛错计入次数且吞掉', boom, 1)

// 无参数调用不能炸
const sched3 = createRecalcScheduler({})
sched3.scroll()
sched3.mutate()
sched3.cancel()
sched3.dispose()
ok('空配置调度器可用', true)

// bindRecalcEvents：chatRegion 缺失时要退到 documentElement 观察。
// 这条是接线时踩出来的真问题：apply 跑在「会话区还没渲染」的时刻，
// 只挂 chatRegion 会让 observer 永久挂空，流式输出反而不会触发重算。
{
  const observed = []
  const savedMO = globalThis.MutationObserver
  globalThis.MutationObserver = class {
    observe(target) { observed.push(target) }
    disconnect() {}
  }
  const rootEl = { nodeType: 1, tagName: 'HTML' }
  const docNoRegion = {
    defaultView: { addEventListener: () => {}, removeEventListener: () => {} },
    documentElement: rootEl,
    querySelector: () => null,
  }
  const dis = bindRecalcEvents({ doc: docNoRegion, scheduler: createRecalcScheduler({ run: () => {} }) })
  ok('chatRegion 缺失时观察 documentElement', observed.length === 1 && observed[0] === rootEl)
  dis()

  const region = { nodeType: 1, tagName: 'DIV' }
  observed.length = 0
  const docWithRegion = {
    defaultView: { addEventListener: () => {}, removeEventListener: () => {} },
    documentElement: rootEl,
    querySelector: (sel) => (sel === '[data-conversation-region="chat"]' ? region : null),
  }
  const dis2 = bindRecalcEvents({ doc: docWithRegion, scheduler: createRecalcScheduler({ run: () => {} }) })
  ok('有 chatRegion 时优先观察它', observed.length === 1 && observed[0] === region)
  dis2()
  globalThis.MutationObserver = savedMO
}

/* ── 8. 色块样式 ───────────────────────────────────────────────────── */

t('colorMix 具体 hex 18%', colorMix('#e5484d', 18, 1), 'color-mix(in srgb, #e5484d 18%, transparent)')
t('colorMix 已知词减半', colorMix('#e5484d', 18, 0.6), 'color-mix(in srgb, #e5484d 11%, transparent)')
t('colorMix 坏色回落默认红 hex', colorMix('red', 18, 1).includes('#e5484d'), true)
t('colorMix 百分比夹取', colorMix('#123456', 999, 1).includes('100%'), true)

const underline = styleOfMark(rect(10, 20), { known: false }, { markColor: '#4d6bfe', markStyle: 'underline' })
t('underline 有底色', underline.background, colorMix('#4d6bfe', 18, 1))
t('underline 有下划线', underline.borderBottom, '1.5px solid #4d6bfe')
t('色块 precise 定位', [underline.position, underline.left, underline.top, underline.width, underline.height], ['fixed', '10px', '20px', '30px', '16px'])
t('色块不吃事件', underline.pointerEvents, 'none')

const bg = styleOfMark(rect(0, 0), { known: false }, { markColor: '#2f9e44', markStyle: 'background' })
t('background 无下划线', bg.borderBottom, undefined)
t('background 只底色', bg.background, colorMix('#2f9e44', 26, 1))

const textOnly = styleOfMark(rect(0, 0), { known: false }, { markColor: '#d4b106', markStyle: 'text' })
t('text 无底色', textOnly.background, undefined)
t('text 只有下划线', textOnly.borderBottom, '1.5px solid #d4b106')

t('枚举外样式回落 underline', styleOfMark(rect(0, 0), {}, { markStyle: 'rainbow' }).borderBottom?.includes(DEFAULT_MARK_COLOR), true)
t('已知词淡色', styleOfMark(rect(0, 0), { known: true }, {}).opacity, 0.5)
t('非已知词不淡', styleOfMark(rect(0, 0), { known: false }, {}).opacity, undefined)
t('坏矩形隐藏', styleOfMark(null, {}, {}), { display: 'none' })

/* ── 9. config 四键 ────────────────────────────────────────────────── */

t('默认开着色', DEFAULT_APPEARANCE.markWords, true)
t('默认跟随宿主错误红（哨兵）', DEFAULT_APPEARANCE.markColor, 'theme-error')
t('默认不含 known', DEFAULT_APPEARANCE.markKnown, false)
t('默认下划线样式', DEFAULT_APPEARANCE.markStyle, 'underline')
t('MARK_STYLES 三档', MARK_STYLES, ['underline', 'background', 'text'])

const clamped = clampAppearance({})
t('clamp 补默认四键', [clamped.markWords, clamped.markColor, clamped.markKnown, clamped.markStyle],
  [true, 'theme-error', false, 'underline'])
t('clamp 保留合法值', clampAppearance({ markWords: false, markColor: '#4D6BFE', markKnown: true, markStyle: 'background' }),
  { ...clampAppearance({}), markWords: false, markColor: '#4d6bfe', markKnown: true, markStyle: 'background' })
t('非法 hex 回落主题错误红哨兵', clampAppearance({ markColor: 'red' }).markColor, 'theme-error')
t('三位简写 hex 不认（回落哨兵）', clampAppearance({ markColor: '#fff' }).markColor, 'theme-error')
t('带 alpha 的 hex 不认（回落哨兵）', clampAppearance({ markColor: '#e5484dff' }).markColor, 'theme-error')
t('带空白的合法 hex 认', clampAppearance({ markColor: ' #e5484d ' }).markColor, '#e5484d')
t('枚举外样式回落 underline', clampAppearance({ markStyle: 'glow' }).markStyle, 'underline')
t('非布尔的 markWords 回落 true', clampAppearance({ markWords: 'yes' }).markWords, true)
t('非布尔的 markKnown 回落 false', clampAppearance({ markKnown: 1 }).markKnown, false)
t('normalizeMarkColor 大写转小写', normalizeMarkColor('#E5484D'), '#e5484d')
t('normalizeMarkColor null 回落哨兵', normalizeMarkColor(null), 'theme-error')
t('clamp 不动原有键', clampAppearance({ markColor: '#000000' }).maxSensesInPopover, 2)


/* ── 10. rangeRefs（回退路径的量矩形引用） ───────────────────────────── */

// 10.1 rangeRefs 与 rects 等长，且跨行时指向同一个 {node,start,end}
const refNode = fakeText('a cute cat')
refNode.parentNode = bodyPara
refNode.parentElement = bodyPara
refNode.__rects = (start, end) => (start === 2 && end === 6 ? [rect(10, 100), rect(700, 100)] : [rect(100, 100)])
const refHit = { node: refNode, start: 2, end: 6, text: 'cute', key: 'cute', think: false }
const refMarks = measureHits([refHit], { doc })
t('rangeRefs 与 rects 等长', refMarks[0].rangeRefs.length, refMarks[0].rects.length)
ok('跨行两段共用一个 range', refMarks[0].rangeRefs[0] === refMarks[0].rangeRefs[1])
t('rangeRef 记了 node/start/end', [refMarks[0].rangeRefs[0].node === refNode, refMarks[0].rangeRefs[0].start, refMarks[0].rangeRefs[0].end], [true, 2, 6])
ok('单段命中 rangeRefs 长度 1', (() => {
  const one = measureHits([{ node: refNode, start: 0, end: 1, key: 'a', text: 'a' }], { doc })
  return one[0].rangeRefs.length === one[0].rects.length
})())

// 10.2 buildMarks 裁剪后 rangeRefs 仍与新 rects 对齐
const cullKeys = new Map([['cute', false]])
refNode.__rects = () => [rect(10, 100), rect(700, 100)]
const culled = buildMarks({
  doc: fakeDoc({ '[data-chat-flow-kind="assistant-step"]': [bodyPara] }),
  keys: cullKeys,
  viewport: { left: 0, top: 0, right: 200, bottom: 600 },
})
t('裁剪后 rangeRefs 与新 rects 等长', culled[0].rangeRefs.length, culled[0].rects.length)
t('裁剪掉的那段没有残留 ref', culled[0].rects.length, 1)

/* ── 11. theme-error 哨兵 + Highlight API 主路径 ──────────────────────── */

t('THEME_ERROR_COLOR 常量', THEME_ERROR_COLOR, 'theme-error')
t('normalizeMarkColor 认 theme-error 哨兵', normalizeMarkColor('theme-error'), 'theme-error')
t('normalizeMarkColor 大小写不敏感认哨兵', normalizeMarkColor('THEME-ERROR'), 'theme-error')
t('normalizeMarkColor 带空格也认', normalizeMarkColor(' theme-error '), 'theme-error')
t('normalizeMarkColor 认合法 hex', normalizeMarkColor('#4D6BFE'), '#4d6bfe')
t('六预设第一项是固定红', MARK_COLOR_PRESETS[0], '#e5484d')
t('六预设共 6 个', MARK_COLOR_PRESETS.length, 6)

// markColorToCss：哨兵 → token，hex → 原样
t('theme-error → 错误红 token（带 hex 兜底）', markColorToCss('theme-error'),
  'var(--dsw-alias-state-error-primary, #e5484d)')
t('hex → 原样小写', markColorToCss('#4D6BFE'), '#4d6bfe')
t('未配置 → 回落 token', markColorToCss(undefined), 'var(--dsw-alias-state-error-primary, #e5484d)')
t('坏值 → 回落 token', markColorToCss('rainbow'), 'var(--dsw-alias-state-error-primary, #e5484d)')
ok('token 里有 hex 兜底', markColorToCss('theme-error').includes('#e5484d'))

// highlightCss：只含 color，不含 background/border/text-decoration
const hlCss = highlightCss({ markColor: 'theme-error' })
t('highlight 规则用 words 注册名', hlCss.includes('::highlight(dsh-hover-dict-words)'), true)
t('highlight 规则用错误红 token', hlCss.includes('color: var(--dsw-alias-state-error-primary, #e5484d)'), true)
t('highlight 规则不含 background', hlCss.includes('background'), false)
t('highlight 规则不含 border', hlCss.includes('border'), false)
t('highlight 规则不含 text-decoration', hlCss.includes('text-decoration'), false)
t('hex 配置走 hex 路径', highlightCss({ markColor: '#4d6bfe' }).includes('color: #4d6bfe'), true)
t('没开 markKnown 时不产生淡化规则', highlightCss({ markColor: '#4d6bfe' }).includes('color-mix'), false)
t('开了 markKnown 才产生淡化规则', highlightCss({ markColor: '#4d6bfe', markKnown: true }).includes('color-mix'), true)

// supportsHighlight：两条都要（构造器 + registry）
const fakeScope = (withCtor, withRegistry) => ({
  Highlight: withCtor ? function Highlight(...r) { this.ranges = r } : undefined,
  CSS: withRegistry ? { highlights: { set() {}, delete() {} } } : {},
})
t('两条都满足才支持', supportsHighlight(fakeScope(true, true)), true)
t('缺 Highlight 构造器 → 不支持', supportsHighlight(fakeScope(false, true)), false)
t('缺 CSS.highlights → 不支持', supportsHighlight(fakeScope(true, false)), false)
t('空 scope → 不支持', supportsHighlight({}), false)

// buildHighlightRanges：每个命中一个 Range，known 分桶
const hlKeys = new Map([['cute', false], ['know', true]])
const hlDoc = fakeDoc({ '[data-chat-flow-kind="assistant-step"]': [bodyPara] })
const hlNode = fakeText('a cute cat know')
const hlPara = fakeEl({}, [hlNode])
const hlDoc2 = fakeDoc({ '[data-chat-flow-kind="assistant-step"]': [hlPara] })
const hlBuilt = buildHighlightRanges({ doc: hlDoc2, keys: hlKeys })
t('buildHighlightRanges 分出非已知词', hlBuilt.ranges.length, 1)
t('buildHighlightRanges 分出已知词', hlBuilt.knownRanges.length, 1)
ok('rangeRefs 记录 node/start/end/key', (() => {
  const ref = hlBuilt.rangeRefs.find((r) => r.key === 'cute')
  return ref && ref.node === hlNode && ref.start === 2 && ref.end === 6
})())
t('stats 计数正确', [hlBuilt.stats.words, hlBuilt.stats.known], [1, 1])
ok('空词集返回空', (() => { const b = buildHighlightRanges({ doc: hlDoc2, keys: new Map() }); return b.ranges.length === 0 && b.stats.hits === 0 })())
t('无 doc 返回空且不抛', buildHighlightRanges({ keys: hlKeys }).ranges.length, 0)

// applyHighlights：注册与清空
{
  const registry = new Map()
  const scope = {
    Highlight: function Highlight(...rs) { this.ranges = rs },
    CSS: { highlights: { set: (k, v) => registry.set(k, v), delete: (k) => registry.delete(k), get: (k) => registry.get(k) } },
  }
  const applied = applyHighlights({ scope, ranges: [{}], knownRanges: [{}] })
  t('applyHighlights 成功', applied.ok, true)
  t('注册了 words', registry.has('dsh-hover-dict-words'), true)
  t('注册了 known', registry.has('dsh-hover-dict-known'), true)
  t('注册内容是 Highlight 实例', registry.get('dsh-hover-dict-words') instanceof scope.Highlight, true)
  applyHighlights({ scope, ranges: [], knownRanges: [] })
  t('空数组时删除注册（不留旧高亮）', [registry.has('dsh-hover-dict-words'), registry.has('dsh-hover-dict-known')], [false, false])
  t('不支持的环境返回 ok:false', applyHighlights({ scope: {}, ranges: [{}] }).ok, false)
  t('不支持时带 error 说明', applyHighlights({ scope: {}, ranges: [{}] }).error, 'unsupported')
  applyHighlights({ scope, ranges: [{}], knownRanges: [] })
  clearHighlights(scope)
  t('clearHighlights 清掉两个注册', registry.size, 0)
  ok('clearHighlights 对不支持环境不抛', (() => { clearHighlights({}); return true })())
}

console.log(`\n${pass}/${pass + fail} passed`)
if (fail > 0) process.exit(1)