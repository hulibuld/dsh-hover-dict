/**
 * app.js —— 状态机与 slot 注册。整个浏览器半唯一的 apply / inject 出口。
 *
 * 交互：点击 / 划选触发，结果不自动消失。
 *
 * 为什么不用悬停：悬停要靠时间判断「用户是扫过去还是停下来」，鼠标在词上
 * 轻微抖动就得重新计时，于是表现为「卡」与「有些词不出结果」。
 * 点击与划选是明确的动作，不需要猜。
 */

import { loadUx, STORAGE_KEY, tagLabel } from './config.js'
import { briefOf, buildIndex, describeEntry, loadDictionary, lookup } from './dict.js'
import { fetchAsset, humanizeError } from './net.js'
import { computeOverlayRect } from './position.js'
import { ensureStyle, MarkerLayerHost, PopoverBody, PhraseBody, UI_ATTR } from './overlay.js'
import {
  buildMarks, buildHighlightRanges, applyHighlights, clearHighlights, highlightCss,
  supportsHighlight, bindRecalcEvents, createRecalcScheduler,
  expandWordSet, MARK_MAX,
} from './marker.js'
import { CardRoot } from './card.js'
import { caretAtPoint, DEFAULT_MAX_HAN_RATIO, rangeRects, readSelection, unionOf } from './selection.js'
import { SELECTORS } from './hit.js'
import { wordAt, normalizeKey } from './word.js'
import { createWordbook } from './wordbook.js'
import { familyOf } from './family.js'
import { ensureSettingsStyle, readTranslator, SettingsPanel } from './settings.js'

/** 设置页里那个导航项的稳定键。改它等于让用户已记住的入口位置失效。 */
const SETTINGS_SECTION_ID = 'hover-dict'

/** 覆盖层根节点的属性名，供「点自己身上不算点外面」用。 */
const SELF_SELECTOR = `[${UI_ATTR}]`

/**
 * 一句话要点：
 *   - 点一个词 → 词典浮层
 *   - 划选一个词 → 同一个浮层
 *   - 划选短语/句子 → 翻译卡片
 *   - 点浮层 → 展开完整词条
 *   - 点浮层外面 / Esc → 关闭
 *
 * 关于「未收录」提示（v1.3 起改口径）：
 *   v1 是**一律静默**，理由是变量名与专有名词太多，逐个提示比沉默更吵。
 *   设计-v2 §E2 改成：**用户主动点开**一个词而词库查不到时，弹一句
 *   「词库未收录，已加入查词记录」并给「仍要收藏」出口 —— 用户主动去点它，
 *   往往正是因为想记住它，这时沉默等于丢掉了他的意图。
 *   被动扫描（marker 着色）依旧完全静默，不产生任何提示。
 */

/**
 * 造状态机。
 *
 * 状态只有两个：
 *   idle  没有展示任何东西
 *   shown 正在展示（浮层 / 卡片 / 翻译）
 *
 * 具体是哪种形态由 runtime.mode 决定，状态机只负责「有没有东西要展示」。
 *
 * @param {object} options
 * @param {(state: string) => void} options.onChange
 * @returns {{ feed: Function, getState: Function, dispose: Function }}
 */
export function createHoverMachine(options) {
  const onChange = typeof options?.onChange === 'function' ? options.onChange : () => {}
  let state = 'idle'
  let disposed = false

  const feed = (event) => {
    if (disposed) return
    const kind = event?.kind
    if (kind !== 'select' && kind !== 'dismiss') return
    if (kind === 'select') {
      if (state !== 'shown') {
        state = 'shown'
        try { onChange(state) } catch { /* ignore */ }
      }
      return
    }
    if (state !== 'idle') {
      state = 'idle'
      try { onChange(state) } catch { /* ignore */ }
    }
  }

  return {
    feed,
    getState: () => state,
    dispose: () => { disposed = true },
  }
}

/**
 * 浏览器半的入口。
 *
 * @param {object} ctx
 */
export function apply(ctx) {
  try {
    const doc = typeof document !== 'undefined' ? document : undefined
    if (!doc) return

    /** 注入/刷新样式。::highlight 的 color 依赖用户配置，改色后要重刷（即时生效）。 */
    let disposeStyle = () => {}
    const refreshStyle = (appearance) => {
      try {
        // 幂等：内容没变就不动节点（ensureStyle 内部比对），变了才替换 textContent
        disposeStyle = ensureStyle(doc, appearance)
      } catch (error) {
        warn('样式注入失败', error)
      }
    }
    refreshStyle(undefined)

    // 取 slots 优先用 ctx.get（安全探测），取不到再退回属性访问。
    //
    // 两条都要留：ctx.get 是 Cordis 的安全探测方式，但测试桩、某些老版本
    // 或极简 ctx 上可能只有属性、没有 get 方法；反过来，直接读 ctx.slots
    // 在没 inject 声明时会抛错。所以 get 在先、属性兜底，各自 try/catch。
    let slots
    if (typeof ctx?.get === 'function') {
      try { slots = ctx.get('slots') } catch { slots = undefined }
    }
    if (slots === undefined) {
      try { slots = ctx.slots } catch { slots = undefined }
    }
    if (!ctx || !slots || typeof slots.inject !== 'function') {
      warn('宿主没有提供 slots 服务，查词功能不挂载')
      try { disposeStyle() } catch { /* ignore */ }
      return
    }

    const storage = safeStorage()
    const ux = loadUx(storage)
    // 拿到用户配置后再刷一次：首次调用时 appearance 还是 undefined，::highlight
    // 只能是默认色，这里补上用户实际选的颜色/是否显示已掌握。
    refreshStyle(ux.appearance)

    const runtime = {
      ux,
      dict: null,
      status: 'not-ready',
      errorMessage: '',
      /** none | popover | card | phrase */
      mode: 'none',
      selection: null,
      result: null,
      entryRaw: null,
      translation: null,
      translating: false,
      translateError: '',
      /** skip 时的提示文字 */
      notice: '',
      /** 词库未收录时用户主动点开的那个词头（notice 形态的「仍要收藏」要用） */
      missKey: '',
      placement: null,
      listeners: new Set(),
      /** 生词本实例与它的版本号（用来触发重渲染） */
      wordbook: null,
      bookVersion: 0,
      /** 词根数据：{ word: [ {part,type,meaning,origin} ] } */
      roots: null,
      rootsStatus: 'not-ready',
      /** 额外词库包是否已经合并过（只做一次） */
      packsMerged: false,
      /** 词库包目录的真实路径，由宿主 health 接口告知 */
      packsDir: '',
      /** 生词着色：这一帧要画的色块（marker.js buildMarks 的结果，几何已算好） */
      marks: [],
      /** 着色用的词集（expandWordSet 结果：键 → 是否已掌握） */
      markKeys: new Map(),
      /** 当前着色命中的词数（Highlight 路径下没有色块，只有这个计数） */
      markCount: 0,
      /** 上一次看到的 localStorage 原文，用来发现设置页改了外观而不必轮询 */
      uxRaw: '',
      /** 着色诊断：单帧耗时、色块数、时间戳（性能预算 <16ms 的观测点） */
      markStats: { lastMs: 0, count: 0, at: 0 },
    }

    /** 卸载时的清理函数栈。着色接线那一段已经要往里 push，所以放在最前面。 */
    const dispose = []

    const notify = () => {
      for (const listener of runtime.listeners) {
        try { listener() } catch { /* ignore */ }
      }
    }

    /* ── 生词着色（设计-v2 §C2） ─────────────────────────────────────────
     *
     * 这里只做**接线**：词集展开、扫描、量矩形、裁剪、截断全在 marker.js 的纯函数里，
     * 本段负责「什么时候算」与「把结果放进 runtime 让 React 画」。
     *
     * 三条硬约束：
     *   1. 绝不改正文 DOM —— 这里只有读：createTreeWalker 遍历文本节点、
     *      Range.getClientRects 量矩形。写只写本插件覆盖层里的 div。
     *   2. 不许每帧扫全文 —— 滚动节流 120ms、正文变化防抖 250ms（§G 硬要求）、
     *      resize 立即重算，三个入口都由 createRecalcScheduler 合并。
     *   3. 色块上限 400，超了按距视口中心距离取最近的（capMarks 内部做）。
     */

    /** 重读 localStorage 里的界面参数（设置页改完要立刻生效，不等重启）。 */
    const reloadUx = () => {
      const next = loadUx(storage)
      runtime.ux = next
      runtime.uxRaw = rawUx()
      // 改色/开关 → 重刷 ::highlight 规则（这是「即时生效」的落点，不等重启）
      refreshStyle(next.appearance)
      return next
    }

    const rawUx = () => {
      try {
        const raw = storage?.getItem?.(STORAGE_KEY)
        return typeof raw === 'string' ? raw : ''
      } catch {
        return ''
      }
    }

    /**
     * 重算词集。生词本或词库或「已掌握也淡色」开关变化时都要重来。
     *
     * @returns {Map<string, boolean>} 键 → 是否已掌握
     */
    const rebuildMarkKeys = () => {
      const keys = expandWordSet({
        entries: runtime.wordbook?.list() ?? [],
        dict: runtime.dict,
        markKnown: runtime.ux.appearance.markKnown === true,
      })
      runtime.markKeys = keys
      return keys
    }

    /** 一次重算：算出色块放进 runtime，然后通知 React 重绘。 */
    const recalcMarks = () => {
      const started = Date.now()
      // 兜底：有些环境给 localStorage 的属性加了只读描述符，setItem 拦不住，
      // 那时靠这里比对原文发现「用户刚在设置页改了颜色」（改色/关闭即时生效）。
      try {
        const raw = rawUx()
        if (raw !== runtime.uxRaw) reloadUx()
      } catch { /* ignore */ }
      const appearance = runtime.ux.appearance
      const keys = runtime.markKeys instanceof Map && runtime.markKeys.size > 0
        ? runtime.markKeys
        : rebuildMarkKeys()

      // markWords 关掉 / 词集空 / 词库没就绪 → 清干净返回，什么节点都不碰（§C2.5）
      const off = appearance.markWords === false || keys.size === 0 || runtime.dict === null
      if (off) {
        try { clearHighlights(typeof window !== 'undefined' ? window : undefined) } catch { /* ignore */ }
        const had = runtime.marks.length > 0 || runtime.markCount > 0
        runtime.marks = []
        runtime.markCount = 0
        runtime.markStats = { lastMs: 0, count: 0, at: started, mode: highlightOn ? 'highlight' : 'overlay' }
        if (had) notify()
        return
      }

      // ── 主路径：Highlight API（只要字色，滚动天然跟字） ──
      if (highlightOn) {
        let built = null
        try {
          built = buildHighlightRanges({ doc, keys })
        } catch {
          built = null
        }
        if (built) {
          const applied = applyHighlights({
            scope: typeof window !== 'undefined' ? window : undefined,
            ranges: built.ranges,
            knownRanges: appearance.markKnown === true ? built.knownRanges : [],
          })
          if (applied.ok) {
            runtime.marks = []
            runtime.markCount = built.stats.words + built.stats.known
            runtime.markStats = {
              lastMs: Date.now() - started,
              count: runtime.markCount,
              at: started,
              mode: 'highlight',
            }
            notify()
            return
          }
        }
        // Highlight 注册失败（半支持的环境）→ 落到下面走色块回退
      }

      // ── 回退路径：overlay 色块（老浏览器；行为与 v2 早期一致） ──
      let marks = []
      try {
        marks = buildMarks({ doc, keys, max: MARK_MAX })
      } catch {
        // 流式输出期间节点可能刚好被宿主换掉，量矩形炸了不该带走整个插件
        marks = []
      }
      runtime.marks = marks
      runtime.markCount = marks.length
      runtime.markStats = { lastMs: Date.now() - started, count: marks.length, at: started, mode: 'overlay' }
      notify()
    }

    const markScheduler = createRecalcScheduler({ run: recalcMarks })

    /**
     * 着色主路径的开关：环境支持 CSS Custom Highlight API 就用它（用户裁定只要字色）。
     *
     * Highlight 的颜色是浏览器渲染时跟着文字走的，**滚动不需要任何重算** ——
     * 之前那套 rAF 逐帧重测 / 双速架构就是为色块偏移打的补丁，换成 Highlight 后
     * 那套整体删掉了（纯滚动不改文字内容时 ranges 仍有效）。
     *
     * 不支持的环境回退到色块方案（buildMarks + MarkerLayer），行为不变。
     */
    const highlightOn = supportsHighlight(typeof window !== 'undefined' ? window : undefined)

    /**
     * 发现设置页改了外观就重载 + 重算。
     *
     * 为什么要这一层：settings.js 写的是 localStorage，而同一个 document 里
     * `storage` 事件**不会**触发（那个事件只发到别的窗口/标签页）。所以要么
     * 拦 setItem，要么轮询原文。两个都做：拦得到就是即时的，拦不到（有些环境
     * 把 localStorage 的方法做成只读）就靠下一次渲染或重算时比对原文兜住。
     */
    const onUxMaybeChanged = () => {
      const raw = rawUx()
      if (raw === runtime.uxRaw) return
      reloadUx()
      notify()
      markScheduler.request()
    }

    const patchStorageWatch = () => {
      if (!storage || typeof storage.setItem !== 'function') return () => {}
      const original = storage.setItem
      let ok = false
      try {
        storage.setItem = function patchedSetItem(key, value) {
          const result = original.call(this, key, value)
          try { if (key === STORAGE_KEY) onUxMaybeChanged() } catch { /* ignore */ }
          return result
        }
        ok = true
      } catch {
        ok = false
      }
      return () => {
        if (!ok) return
        try { storage.setItem = original } catch { /* ignore */ }
      }
    }

    runtime.uxRaw = rawUx()
    if (storage !== undefined && typeof storage.getItem === 'function' && runtime.uxRaw === '') {
      // 首帧没有存档：把当前默认值记成基准，避免第一次比对就误判成「变了」
      runtime.uxRaw = rawUx()
    }
    dispose.push(patchStorageWatch())

    /**
     * 首扫：词库 ready 且生词本 ready 之后，在空闲帧跑一次。
     *
     * 不放在 apply 里同步跑：词库要 30ms 解析、生词本要读 KV，
     * 抢首帧会白屏一瞬（§C2.4「初次」）。
     */
    const scheduleMarkScan = () => {
      const run = () => {
        try {
          rebuildMarkKeys()
          recalcMarks()
        } catch (error) {
          warn('着色首扫失败', error)
        }
      }
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(run, { timeout: 3000 })
        dispose.push(() => { try { cancelIdleCallback(handle) } catch { /* ignore */ } })
      } else {
        const handle = setTimeout(run, 300)
        dispose.push(() => clearTimeout(handle))
      }
    }

    // 滚动（含流式程序滚动）/ 正文变化 / resize 三个入口。
    //
    // 走 Highlight 时纯滚动不需要重算（颜色跟文字走），但滚动仍要触发一次节流重算：
    // 滚动会带来「新一批文本节点进入 DOM」的可能（虚拟列表），且成本只有一次
    // ranges 重建（不量矩形，比色块路径更便宜）。resize 会改变换行，必须重算。
    dispose.push(bindRecalcEvents({ doc, scheduler: markScheduler }))

    let machine = null
    let translateAbort = null

    const viewportOf = () => ({
      width: typeof window !== 'undefined' ? window.innerWidth : doc.documentElement.clientWidth,
      height: typeof window !== 'undefined' ? window.innerHeight : doc.documentElement.clientHeight,
    })

    const measure = (selector, fallback) => {
      const node = doc.querySelector(selector)
      if (node === null) return fallback
      const rect = node.getBoundingClientRect()
      if (!(rect.width > 0) || !(rect.height > 0)) return fallback
      return { width: rect.width, height: rect.height }
    }

    const placeFor = (kind, bounds) => {
      const viewport = viewportOf()
      const size = kind === 'card'
        ? measure(`${SELF_SELECTOR} .hd-card`, {
          width: Math.min(ux.appearance.cardMaxWidthPx, viewport.width - 16),
          height: Math.round(viewport.height * ux.appearance.cardMaxHeightRatio),
        })
        : measure(`${SELF_SELECTOR} .hd-pop`, { width: 300, height: 96 })
      return computeOverlayRect(kind, {
        anchor: bounds,
        size,
        viewport,
        offsetPx: kind === 'card' ? 10 : ux.appearance.offsetPx,
        marginPx: ux.appearance.viewportMarginPx,
      })
    }

    const ensureDictionary = async () => {
      if (runtime.status === 'loading' || runtime.status === 'ready') return
      runtime.status = 'loading'
      notify()
      try {
        runtime.dict = await loadDictionary()
        runtime.status = 'ready'
        runtime.errorMessage = ''
        // 词库到手才能展开变位 → 词集重算 + 首扫（生词本可能已经 ready 了）
        try {
          rebuildMarkKeys()
          markScheduler.request()
        } catch { /* ignore */ }
        void mergePacks()
      } catch (error) {
        runtime.status = 'error'
        runtime.errorMessage = humanizeError(error)
      }
      notify()
    }

    const lookupWord = (key) => {
      if (runtime.status !== 'ready' || runtime.dict === null) {
        if (runtime.status === 'not-ready' || runtime.status === 'error') void ensureDictionary()
        return null
      }
      const found = lookup(runtime.dict, key)
      if (found === null) return null
      const described = describeEntry(found.entry)
      if (described.senses.length === 0) return null
      return {
        status: 'ok',
        head: found.head,
        matchedBy: found.matchedBy,
        entry: found.entry,
        senses: described.senses,
        brief: briefOf(found.entry),
        hasDetail: described.senses.length > 1 || described.forms.length > 0
          || described.examples.length > 0,
      }
    }

    /**
     * 翻译一句话。
     *
     * 走宿主自己的 `/api/dsh-hover-dict/translate` 路由，由宿主用 llm 服务调模型。
     * 不用 @deepseek-ai/dsh-experimental-translator 是因为那个 bundle 默认关闭，
     * 用户没开会一直报错。
     */
    const translatePhrase = async (text) => {
      if (translateAbort) { try { translateAbort.abort() } catch { /* ignore */ } }
      const controller = new AbortController()
      translateAbort = controller
      runtime.translating = true
      runtime.translateError = ''
      runtime.translation = null
      notify()

      const preference = readTranslator(storage)
      if (preference === 'off') {
        runtime.translating = false
        runtime.translateError = '句子翻译已在设置里关闭'
        notify()
        return
      }

      try {
        const response = await fetch('/api/dsh-hover-dict/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        if (!response.ok || payload?.ok !== true) {
          throw new Error(payload?.error?.message ?? `翻译失败（HTTP ${response.status}）`)
        }
        runtime.translation = String(payload.text ?? '')
      } catch (error) {
        if (controller.signal.aborted) return
        runtime.translateError = humanizeError(error)
      } finally {
        if (translateAbort === controller) translateAbort = null
        runtime.translating = false
        notify()
      }
    }

    /** 一次选择 → 界面。 */
    const applySelection = (selection) => {
      if (!selection) return
      const view = viewportOf()
      const bounds = unionOf(selection.rects) ?? {
        left: view.width / 2, top: view.height / 2,
        right: view.width / 2, bottom: view.height / 2, width: 0, height: 0,
      }
      runtime.selection = selection
      runtime.entryRaw = null
      runtime.result = null
      runtime.translation = null
      runtime.translateError = ''
      runtime.translating = false
      runtime.notice = ''
      runtime.missKey = ''

      if (selection.kind === 'word') {
        const hit = lookupWord(selection.key)
        if (hit === null) {
          // 词库未收录。设计-v2 §E2 分两种情况：
          //   - 用户**主动点**这个词（单击取词 / 双击选词）→ 弹一句说明，
          //     并记录这次查词（touch 对不在生词本里的词是 no-op，所以这里
          //     先记进 runtime 里，等用户真收藏了才会落库）；
          //   - 不是主动点的（理论上不会走到这）→ 保持 v1 的静默。
          if (selection.byPick === true) {
            runtime.result = null
            runtime.entryRaw = null
            runtime.missKey = selection.key
            runtime.notice = '词库未收录，已加入查词记录'
            runtime.mode = 'notice'
            runtime.placement = placeFor('popover', bounds)
            // 主动点开的词先记一次「查过」：已在生词本里就 seen+1
            void runtime.wordbook?.touch?.(selection.key)
            notify()
            return
          }
          runtime.mode = 'none'
          runtime.placement = null
          notify()
          return
        }
        runtime.result = hit
        runtime.entryRaw = hit.entry
        runtime.missKey = ''
        runtime.mode = 'popover'
        runtime.placement = placeFor('popover', bounds)
        // 设计 §E2：浮层一弹出来就算「查过一次」（seen+1，lastSeenAt 更新）。
        // touch 对不在生词本里的词是 no-op —— 只记录已收藏词的查词次数，
        // 不会因为随手点一个词就往生词本里塞记录。
        void runtime.wordbook?.touch?.(selection.key)
        notify()
        return
      }

      runtime.mode = 'phrase'
      runtime.placement = placeFor('popover', bounds)
      notify()
      void translatePhrase(selection.text)
    }

    /**
     * 单击取词。
     *
     * 这条路径不依赖浏览器有没有产生选区 —— 单击通常不产生选区，
     * 这正是「单击失灵、划选可用」的根因。
     *
     * @param {number} x
     * @param {number} y
     * @returns {boolean} 是否命中并展示了一个词
     */
    const pickWordAt = (x, y) => {
      const caret = caretAtPoint(doc, x, y)
      if (caret === null) return false
      // 只处理对话正文里的字
      if (!inChatRegion(caret.node.parentElement)) return false
      if (inComposer(caret.node.parentElement)) return false
      // preferLeft：点在词的最后一个字母右半边时 offset 会等于词尾，
      // 不向左借一格就取不到词。
      const hit = wordAt(caret.node.data, caret.offset, { preferLeft: true })
      if (hit === null) return false

      const rects = rangeRects(doc, caret.node, hit.start, hit.end)
      if (rects.length === 0) return false

      applySelection({
        kind: 'word',
        text: hit.text,
        key: hit.text.replace(/[\u2018\u2019]/g, "'").toLowerCase(),
        rects,
        collapsed: true,
        // 用户明确点了一个词：miss 时可以弹提示（设计 §E2）
        byPick: true,
      })
      machine.feed({ kind: 'select' })
      return runtime.mode === 'popover'
    }

    const clearAll = () => {
      runtime.mode = 'none'
      runtime.selection = null
      runtime.result = null
      runtime.entryRaw = null
      runtime.translation = null
      runtime.notice = ''
      runtime.missKey = ''
      runtime.placement = null
      machine.feed({ kind: 'dismiss' })
      notify()
    }

    let downAt = null
    let downSelectionText = ''
    let lastText = ''

    /**
     * 判断一个元素是否在「对话正文」区域内。
     *
     * 只有这里才查词。输入框、右下角的模型选择器、侧栏、设置页
     * 都属于各自的 `data-conversation-region`，一律不处理 ——
     * 在输入框里点一下想定位光标，不该弹出词典。
     *
     * 判定用祖先链查找：从事件目标往上找 `[data-conversation-region="chat"]`。
     * 找不到就不在正文里。
     */
    /**
     * 读「中文占比上限」设置。
     *
     * 存在 localStorage，键 `dsh-hover-dict:maxHanRatio`，取值 0–1。
     * 读不到就用默认 10%。
     */
    const readMaxHanRatio = (store) => {
      try {
        const raw = store?.getItem?.('dsh-hover-dict:maxHanRatio')
        if (raw !== null && raw !== undefined && raw !== '') {
          const value = Number(raw)
          if (Number.isFinite(value) && value >= 0 && value <= 1) return value
        }
      } catch { /* 读失败用默认 */ }
      return DEFAULT_MAX_HAN_RATIO
    }

    /** 取当前选区的起始节点（用来判断选区在哪个区域里）。 */
    const currentSelectionNode = (d) => {
      try {
        const sel = d.getSelection?.()
        if (!sel || sel.rangeCount === 0) return null
        const range = sel.getRangeAt(0)
        const node = range.startContainer
        if (node === null) return null
        return node.nodeType === 1 ? node : node.parentElement
      } catch {
        return null
      }
    }

    const inChatRegion = (node) => {
      if (!node || typeof node.closest !== 'function') return false
      try {
        return node.closest(SELECTORS.chatRegion) !== null
      } catch {
        return false
      }
    }

    /**
     * 输入框与它周围那一排控件（含右下角的模型选择器）一律排除。
     *
     * 逐个选择器单独判，不写成一个带逗号的大选择器：
     * 一是失败时好定位是哪一条命中，二是 `closest` 对复杂选择器的支持
     * 各浏览器不完全一致，拆开更稳。
     */
    const COMPOSER_MARKERS = [
      SELECTORS.composerRegion,
      '[data-composer-seat]',
      '[data-composer-stat]',
      '[data-composer-height]',
      'form',
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[contenteditable=""]',
      '[role="textbox"]',
    ]

    const inComposer = (node) => {
      if (!node || typeof node.closest !== 'function') return false
      for (const selector of COMPOSER_MARKERS) {
        try {
          if (node.closest(selector) !== null) return true
        } catch {
          // 选择器不合法就跳过，不要让一条坏规则带走整个判定
        }
      }
      return false
    }

    const insideSelf = (target) => Boolean(
      target && typeof target.closest === 'function' && target.closest(SELF_SELECTOR) !== null,
    )

    /** 划选完成后尝试处理选区。 */
    const trySelection = () => {
      const selection = readSelection(doc, { maxHanRatio: readMaxHanRatio(storage) })
      if (selection === null || selection.collapsed) return false
      // 选区必须落在对话正文里。输入框里选中文字是想复制或替换，不是查词。
      const anchorNode = currentSelectionNode(doc)
      if (anchorNode === null) return false
      if (!inChatRegion(anchorNode)) return false
      if (inComposer(anchorNode)) return false
      if (selection.text === lastText && runtime.mode !== 'none') return true
      lastText = selection.text
      // 划选/双击也是用户主动指向某个词，miss 时同样该给提示（短语另走翻译分支）
      applySelection({ ...selection, byPick: selection.kind === 'word' })
      machine.feed({ kind: 'select' })
      return true
    }

    const onPointerDown = (event) => {
      try {
        if (event.button !== 0) return
        downAt = { x: event.clientX, y: event.clientY }
        downSelectionText = doc.getSelection?.()?.toString() ?? ''
      } catch (error) {
        warn('pointerdown 处理失败', error)
      }
    }

    const onPointerUp = (event) => {
      try {
        if (event.button !== 0) return
        if (insideSelf(event.target)) return

        const start = downAt
        downAt = null
        const moved = start !== null
          && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4

        // 一、拖动过 → 划选。等浏览器把选区定好再读
        if (moved) {
          setTimeout(() => {
            try {
              const done = trySelection()
              if (!done && runtime.mode !== 'none') clearAll()
            } catch (error) { warn('划选处理失败', error) }
          }, 0)
          return
        }

        // 二、没拖动但出现了新选区 → 双击选词走到了这里
        const nowText = doc.getSelection?.()?.toString() ?? ''
        if (nowText.length > 0 && nowText !== downSelectionText) {
          setTimeout(() => {
            try {
              if (!trySelection() && runtime.mode !== 'none') clearAll()
            } catch (error) { warn('选区处理失败', error) }
          }, 0)
          return
        }

        // 三、单击取词
        if (pickWordAt(event.clientX, event.clientY)) return

        // 四、点在浮层外面且没命中任何词 → 关闭
        if (runtime.mode !== 'none') clearAll()
      } catch (error) {
        warn('pointerup 处理失败', error)
      }
    }

    const onKeyDown = (event) => {
      try {
        if (event.key !== 'Escape') return
        if (runtime.mode === 'none') return
        clearAll()
      } catch (error) {
        warn('keydown 处理失败', error)
      }
    }

    const onResize = () => {
      try {
        if (runtime.mode === 'none' || runtime.selection === null) return
        const bounds = unionOf(runtime.selection.rects)
        if (!bounds) return
        runtime.placement = placeFor(runtime.mode === 'card' ? 'card' : 'popover', bounds)
        notify()
      } catch { /* ignore */ }
    }

    const listen = (target, type, handler, options) => {
      if (!target || typeof target.addEventListener !== 'function') return
      target.addEventListener(type, handler, options)
      dispose.push(() => target.removeEventListener(type, handler, options))
    }

    listen(doc, 'pointerdown', onPointerDown, { capture: true, passive: true })
    listen(doc, 'pointerup', onPointerUp, { capture: true })
    listen(doc, 'keydown', onKeyDown, { capture: true })
    listen(typeof window !== 'undefined' ? window : undefined, 'resize', onResize, { passive: true })

    machine = createHoverMachine({
      onChange: (state) => {
        if (state === 'idle' && runtime.mode !== 'none') {
          runtime.mode = 'none'
          runtime.selection = null
          runtime.result = null
          runtime.entryRaw = null
          runtime.translation = null
          runtime.placement = null
          notify()
        }
      },
    })

    /**
     * 造一个集合：生词本里的每个词，加上它在词库里的所有变位。
     *
     * 这样用户收藏了 run，界面上 ran / running / runs 也会标红 ——
     * 用户要的是「这个词我背过」，而不是「这个字符串我背过」。
     */
    const collectBookSet = (rt) => {
      // 词集展开的规则（槽 5 起、`p:ran/i:running`、词头优先）只在 marker.js 里写一份，
      // 这里复用同一份实现，避免「卡片上标红的变位」和「正文着色的变位」两套口径漂移。
      //
      // 与着色词集的唯一差别：卡片里 known 的词也要参与（用户的词条上要看得出
      // 「这个词我背过」，只是着色的默认口径不含 known）。所以这里 markKnown 恒为 true。
      const keys = expandWordSet({
        entries: rt.wordbook?.list() ?? [],
        dict: rt.status === 'ready' ? rt.dict : null,
        markKnown: true,
      })
      return new Set(keys.keys())
    }

    /**
     * 取一个词的词根分析并展开成人能读的形状。
     *
     * 数据文件是压缩过的：{ meanings: [...], words: { word: [[part,type,mi,origin?,weak?]] } }。
     */
    const lookupRoots = (rt) => {
      if (!rt.roots || !rt.selection) return null
      const table = rt.roots.meanings
      const rows = rt.roots.words?.[rt.selection.key]
      if (!Array.isArray(rows) || rows.length === 0) return null
      return rows.map((row) => ({
        part: Array.isArray(row) ? row[0] : '',
        type: Array.isArray(row) ? row[1] : '',
        meaning: Array.isArray(row) && Number.isInteger(row[2]) && Array.isArray(table)
          ? (table[row[2]] ?? '')
          : '',
        origin: Array.isArray(row) && typeof row[3] === 'string' ? row[3] : '',
        weak: Array.isArray(row) && row[4] === true,
      }))
    }

    const store = {
      getSnapshot: () => ({
        mode: runtime.mode,
        selection: runtime.selection,
        result: runtime.result,
        entryRaw: runtime.entryRaw,
        translation: runtime.translation,
        translating: runtime.translating,
        translateError: runtime.translateError,
        placement: runtime.placement,
        notice: runtime.notice,
        missKey: runtime.missKey,
        status: runtime.status,
        errorMessage: runtime.errorMessage,
        ux: runtime.ux,
        bookVersion: runtime.bookVersion,
        inBook: runtime.selection ? runtime.wordbook?.has(runtime.selection.key) === true : false,
        /** 当前词的词条（浮层要显示「已在生词本 · 状态」，见设计 §C3） */
        inBookEntry: runtime.selection && runtime.wordbook
          ? (runtime.wordbook.get(runtime.selection.key) ?? null)
          : null,
        inBookSet: collectBookSet(runtime),
        /** 着色要画的色块（几何已由 marker.js 算好） */
        marks: runtime.marks,
        /** 着色诊断：单帧耗时与色块数，设置页与单测可读 */
        markStats: runtime.markStats ?? { lastMs: 0, count: 0, at: 0, mode: highlightOn ? 'highlight' : 'overlay' },
        /** 当前着色词数（Highlight 路径用；overlay 路径等于色块数） */
        markCount: runtime.markCount ?? 0,
        /** 当前着色走哪条路径：'highlight' 主路径 / 'overlay' 回退 */
        markMode: highlightOn ? 'highlight' : 'overlay',
        family: runtime.selection && runtime.dict
          ? familyOf(runtime.dict, runtime.selection.key)
          : { inflections: [], derived: [] },
        roots: lookupRoots(runtime),
      }),
      subscribe: (listener) => {
        runtime.listeners.add(listener)
        return () => { runtime.listeners.delete(listener) }
      },
      actions: {
        onRetry: () => { void ensureDictionary() },
        onClose: () => clearAll(),
        onExpand: () => {
          if (runtime.mode !== 'popover' || runtime.selection === null) return
          const bounds = unionOf(runtime.selection.rects)
          if (!bounds) return
          runtime.mode = 'card'
          runtime.placement = placeFor('card', bounds)
          notify()
        },
        onRetryTranslate: () => {
          if (runtime.selection?.kind === 'phrase') void translatePhrase(runtime.selection.text)
        },
        onToggleStar: () => {
          if (!runtime.wordbook || !runtime.selection) return
          void runtime.wordbook.toggle(runtime.selection.key)
        },
        /**
         * 词库未收录的词「仍要收藏」（设计 §E2）。
         *
         * 用 add(key,'manual') 而不是 toggle：notice 形态下用户点的是
         * 「要收下它」，不是「切换状态」。gloss 留空 —— 我们确实没有释义，
         * 不编一个出来（CETgo 口径）。管理台会给它「未收录」徽章。
         */
        onSaveMiss: () => {
          const key = runtime.missKey
          if (!key || !runtime.wordbook) return
          void Promise.resolve(runtime.wordbook.add(key, 'manual')).then(() => {
            runtime.missKey = ''
            runtime.notice = '词库未收录，已加入生词本（释义留空，可在设置里写备注）'
            notify()
            markScheduler?.request?.()
          }).catch(() => { /* 写盘失败：notice 保持原样 */ })
        },
        onSelectWord: (word) => {
          if (typeof word !== 'string' || word === '') return
          const key = normalizeKey(word)
          const hit = lookupWord(key)
          if (!hit) return
          const bounds = runtime.selection ? unionOf(runtime.selection.rects) : null
          applySelection({
            kind: 'word',
            text: word,
            key,
            rects: runtime.selection?.rects ?? [],
            collapsed: true,
          })
          if (bounds && runtime.mode !== 'none') {
            runtime.placement = placeFor('card', bounds)
            runtime.mode = 'card'
            notify()
          }
        },
      },
    }

    const register = () => slots.register({
      name: 'shell.overlay',
      id: 'dsh-hover-dict',
      order: 80,
    }, (props) => OverlayHost({
      store,
      tagLabel: (tag) => tagLabel(tag, 'zh'),
      actions: store.actions,
      ...props,
    }))

    dispose.push(slots.inject('shell.overlay', register))

    // 设置页：注册到设置面板左侧导航（和你看到的「通用设置 / 模型 / 费用」并列）。
    //
    // 只做**一个**入口。之前同时挂了插件详情页和左侧边栏图标，等于三个地方都能进，
    // 反而找不到。现在只留设置里这一处。
    //
    // `settings.section` 是 list 插槽：id 是导航项的稳定键，label 是显示文字，
    // order 决定排在哪儿。只登记这三个字段 —— 严格校验的宿主会因多余字段抛错，
    // 而 apply 一抛错整条 slot 就静默退役（导航项直接不出现）。
    try {
      dispose.push(ensureSettingsStyle(doc))

      // wordbook 与 dict 都要懒取：注册发生时它们可能还没建好
      // （setupWordbook 是异步的，dict 要等词库加载完）。
      // 直接写 `wordbook: runtime.wordbook` 会把那一次的 null 固化下来。
      const settingsProps = () => ({
        get wordbook() { return runtime.wordbook },
        get dict() { return runtime.dict },
        apiPrefix: '/api/dsh-hover-dict',
        get packsDir() { return runtime.packsDir },
      })

      dispose.push(slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: SETTINGS_SECTION_ID,
        order: 26,
        label: () => '英语翻译',
        inject: settingsProps,
      }, SettingsPanel)))
    } catch (error) {
      warn('设置页挂载失败（不影响查词）', error)
    }

    /**
     * 载入用户下载的额外词库包，合并进主词库。
     *
     * 每个包是 `data/packs/<id>.dat`，内容和 dict.dat 同构（词头 → 槽位数组）。
     * 合并规则：主词库已有的词不覆盖 —— 主词库的义项更完整（带了例句与变位）。
     *
     * 失败一律静默：某个包下载了一半或格式坏了，不该让整个查词挂掉。
     */
    const mergePacks = async () => {
      if (runtime.packsMerged) return
      runtime.packsMerged = true
      if (runtime.status !== 'ready' || runtime.dict === null) return

      let enabled = {}
      try {
        const raw = storage?.getItem?.('dsh-hover-dict:packs')
        if (typeof raw === 'string' && raw !== '') {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') enabled = parsed
        }
      } catch { /* 读不到就当没装 */ }

      const ids = Object.keys(enabled)
      if (ids.length === 0) return

      let added = 0
      for (const id of ids) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue
        try {
          const data = await fetchAsset(`${id}.dat`)
          if (!data || typeof data !== 'object') continue
          for (const [head, entry] of Object.entries(data)) {
            if (Object.prototype.hasOwnProperty.call(runtime.dict.entries, head)) continue
            runtime.dict.entries[head] = entry
            added += 1
          }
        } catch {
          // 包不存在或格式坏了：跳过这一个，不影响其他
        }
      }
      if (added > 0) {
        // 重建变位索引，让新词也能按变位查到
        try {
          const rebuilt = buildIndex(runtime.dict.entries, runtime.dict.meta)
          runtime.dict = rebuilt
        } catch { /* 索引重建失败就保留旧的 */ }
        notify()
      }
    }

    /** 载入词根数据。拿不到就不显示这一块，不影响查词。 */
    const ensureRoots = async () => {
      if (runtime.rootsStatus === 'loading' || runtime.rootsStatus === 'ready') return
      runtime.rootsStatus = 'loading'
      try {
        const data = await fetchAsset('wordroot.dat')
        runtime.roots = data && typeof data === 'object' ? data : null
        runtime.rootsStatus = runtime.roots ? 'ready' : 'error'
      } catch {
        runtime.rootsStatus = 'error'
      }
    }

    /** 生词本：优先用宿主 storage，退到 localStorage。 */
    const setupWordbook = async () => {
      let hostStorage
      if (typeof ctx?.get === 'function') {
        try { hostStorage = ctx.get('storage') } catch { hostStorage = undefined }
      }
      runtime.wordbook = createWordbook({ storage: hostStorage, local: storage })
      runtime.wordbook.subscribe(() => {
        runtime.bookVersion += 1
        // 生词本一变：词集要重算，色块也要重扫（收藏/移出/改状态的即时反馈，§C2.4）
        try {
          rebuildMarkKeys()
          markScheduler.request()
        } catch (error) {
          warn('生词本变化后重算着色失败', error)
        }
        notify()
      })
      await runtime.wordbook.ready()
      runtime.bookVersion += 1
      notify()
      // 词库与生词本都就绪 → 空闲帧首扫（§C2.4「初次」）
      scheduleMarkScan()
    }

    const scheduleLoad = () => {
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(() => { void ensureDictionary() }, { timeout: 2000 })
        dispose.push(() => cancelIdleCallback(handle))
      } else {
        const handle = setTimeout(() => { void ensureDictionary() }, 300)
        dispose.push(() => clearTimeout(handle))
      }
    }
    scheduleLoad()
    // 问一次宿主：词库包目录在哪。拿不到就留空，前端会显示一句提示。
    try {
      fetch('/api/dsh-hover-dict/health')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && typeof data.packsDir === 'string' && data.packsDir !== '') {
            runtime.packsDir = data.packsDir
            notify()
          }
        })
        .catch(() => { /* 拿不到就算了 */ })
    } catch { /* ignore */ }
    void ensureRoots()
    void setupWordbook()

    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const fn of dispose.slice().reverse()) {
          try { fn() } catch { /* ignore */ }
        }
        try { translateAbort?.abort() } catch { /* ignore */ }
        try { machine.dispose() } catch { /* ignore */ }
        try { disposeStyle() } catch { /* ignore */ }
        // 关键：卸载后必须清掉 CSS.highlights 注册，否则正文会一直挂着我们的字色
        try { clearHighlights(typeof window !== 'undefined' ? window : undefined) } catch { /* ignore */ }
      }, 'dsh-hover-dict: 监听与 slot 清理')
    }
  } catch (error) {
    warn('挂载失败', error)
  }
}

/** 静态数组，不能是函数或变量 —— client-modules 在扫描期就要读到它。 */
export const inject = ['slots']

/**
 * 覆盖层宿主组件。
 *
 * @param {object} props
 * @returns {import('react').ReactElement | null}
 */
export function OverlayHost(props) {
  try {
    const store = props?.store
    if (!store || typeof store.getSnapshot !== 'function') return null

    const [snapshot, setSnapshot] = useState(store.getSnapshot())
    useEffect(() => {
      let alive = true
      const unsubscribe = store.subscribe(() => {
        if (!alive) return
        try { setSnapshot(store.getSnapshot()) } catch { /* ignore */ }
      })
      try { setSnapshot(store.getSnapshot()) } catch { /* ignore */ }
      return () => { alive = false; unsubscribe?.() }
    }, [store])

    if (!snapshot) return null
    const {
      mode, selection, result, entryRaw, translation, translating, translateError,
      placement, ux, status, errorMessage, inBook, inBookEntry, inBookSet, family, roots,
      marks, notice, missKey,
    } = snapshot
    const actions = props.actions ?? {}
    const children = []

    // ── 生词着色层（设计 §C2.2）：**第一个** child ──
    // 放第一个是为了让它画在浮层/卡片之下（DOM 顺序 + CSS z-index:0 双保险）。
    // 它 pointer-events:none，点击穿透到正文，现有单击取词不受影响（§C3）。
    // markWords=false 时 MarkerLayerHost 直接返回 null，等于完全不变色。
    children.push(h(MarkerLayerHost, {
      key: 'markers',
      marks,
      appearance: ux?.appearance,
    }))

    if (mode === 'popover' && placement && result) {
      children.push(h('div', {
        key: 'pop',
        className: 'hd-pop',
        style: { top: `${placement.top}px`, left: `${placement.left}px` },
        onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          actions.onExpand?.()
        },
      }, h(PopoverBody, {
        result,
        word: selection?.text ?? '',
        appearance: ux.appearance,
        tagLabel: props.tagLabel,
        inBook,
        // 「已在生词本 · 状态」小字行的数据源（§C3）
        entry: inBookEntry,
        onToggleStar: () => actions.onToggleStar?.(),
      })))
    }

    if (mode === 'card' && placement && entryRaw) {
      children.push(h(CardRoot, {
        key: 'card',
        word: selection?.text ?? '',
        entry: describeEntry(entryRaw),
        placement,
        appearance: ux.appearance,
        pinned: true,
        onTogglePin: () => {},
        onClose: () => actions.onClose?.(),
        onPointerEnter: () => {},
        onPointerLeave: () => {},
        inBook,
        inBookSet,
        family,
        roots,
        onToggleStar: () => actions.onToggleStar?.(),
        onSelectWord: (word) => actions.onSelectWord?.(word),
      }))
    }

    if (mode === 'notice' && placement && notice) {
      // 设计 §E2：词库未收录时给一句说明 + 「仍要收藏」。
      // 已经收下了（inBook 且 missKey 已清空）就不再显示按钮，避免重复点。
      const canSave = missKey !== '' && inBook !== true
      children.push(h('div', {
        key: 'notice',
        className: 'hd-pop',
        style: {
          top: `${placement.top}px`,
          left: `${placement.left}px`,
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          color: 'var(--dsw-alias-label-secondary, #666)',
        },
        onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
      }, [
        h('div', { key: 'text', className: 'hd-more' }, notice),
        canSave
          ? h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
            h('button', {
              key: 'save',
              type: 'button',
              className: 'hd-star',
              title: '把这个词加入生词本（释义留空）',
              onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                actions.onSaveMiss?.()
              },
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 11px',
                borderRadius: 7,
                border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.4))',
                background: 'transparent',
                color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
                font: 'inherit',
                fontSize: '12px',
                cursor: 'pointer',
              },
            }, '仍要收藏'),
            h('span', {
              key: 'hint',
              style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #999)' },
            }, '释义留空，可在生词本里自己写备注'),
          ])
          : null,
      ]))
    }

    if (mode === 'phrase' && placement) {
      children.push(h(PhraseBody, {
        key: 'phrase',
        text: selection?.text ?? '',
        translation,
        translating,
        error: translateError,
        placement,
        appearance: ux.appearance,
        onClose: () => actions.onClose?.(),
        onRetry: () => actions.onRetryTranslate?.(),
      }))
    }

    if (mode === 'popover' && status === 'error') {
      children.push(h('div', {
        key: 'err',
        className: 'hd-note',
        style: {
          position: 'fixed', left: '50%', bottom: '96px',
          transform: 'translateX(-50%)', pointerEvents: 'auto',
        },
        onMouseDown: (event) => { event.preventDefault(); actions.onRetry?.() },
      }, errorMessage || '词库未就绪，点此重试'))
    }

    return h('div', { [UI_ATTR]: '' }, children)
  } catch (error) {
    warn('覆盖层渲染失败', error)
    return null
  }
}

/** 一行日志，带包名前缀。日志本身也不许抛。 */
function warn(message, error) {
  try {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(`[dsh-hover-dict] ${message}`, error?.message ?? error ?? '')
    }
  } catch { /* ignore */ }
}

/** 取 localStorage，取不到就返回 undefined（隐私模式下会抛）。 */
function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch { /* ignore */ }
  return undefined
}
