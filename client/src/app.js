/**
 * app.js —— 状态机与 slot 注册。整个浏览器半唯一的 apply / inject 出口。
 *
 * 交互：点击 / 划选触发，结果不自动消失。
 *
 * 为什么不用悬停：悬停要靠时间判断「用户是扫过去还是停下来」，鼠标在词上
 * 轻微抖动就得重新计时，于是表现为「卡」与「有些词不出结果」。
 * 点击与划选是明确的动作，不需要猜。
 */

import { loadUx, tagLabel } from './config.js'
import { briefOf, describeEntry, loadDictionary, lookup } from './dict.js'
import { fetchAsset, humanizeError } from './net.js'
import { computeOverlayRect } from './position.js'
import { ensureStyle, PopoverBody, PhraseBody, UI_ATTR } from './overlay.js'
import { CardRoot } from './card.js'
import { caretAtPoint, rangeRects, readSelection, unionOf } from './selection.js'
import { SELECTORS } from './hit.js'
import { wordAt, normalizeKey } from './word.js'
import { createWordbook } from './wordbook.js'
import { familyOf } from './family.js'
import { ensureSettingsStyle, readTranslator, SettingsPanel, translatorChain } from './settings.js'

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
 * 刻意**不**做「未收录」提示：变量名与专有名词太多，逐个提示比沉默更吵。
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

    let disposeStyle = () => {}
    try {
      disposeStyle = ensureStyle(doc)
    } catch (error) {
      warn('样式注入失败', error)
    }

    if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') {
      warn('宿主没有提供 slots 服务，查词功能不挂载')
      try { disposeStyle() } catch { /* ignore */ }
      return
    }

    const storage = safeStorage()
    const ux = loadUx(storage)

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
      placement: null,
      listeners: new Set(),
      /** 生词本实例与它的版本号（用来触发重渲染） */
      wordbook: null,
      bookVersion: 0,
      /** 词根数据：{ word: [ {part,type,meaning,origin} ] } */
      roots: null,
      rootsStatus: 'not-ready',
    }

    const notify = () => {
      for (const listener of runtime.listeners) {
        try { listener() } catch { /* ignore */ }
      }
    }

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

    /** 翻译一句话。取不到翻译服务时给出可读提示，不影响查词。 */
    const translatePhrase = async (text) => {
      if (translateAbort) { try { translateAbort.abort() } catch { /* ignore */ } }
      const controller = new AbortController()
      translateAbort = controller
      runtime.translating = true
      runtime.translateError = ''
      runtime.translation = null
      notify()

      try {
        let translator = ctx?.translator
        if (translator === undefined && typeof ctx?.get === 'function') {
          try { translator = ctx.get('translator') } catch { translator = undefined }
        }
        const translate = translator && typeof translator.translate === 'function'
          ? translator.translate.bind(translator)
          : undefined
        if (typeof translate !== 'function') {
          throw new Error('这个版本的宿主没有提供翻译服务')
        }

        const chain = translatorChain(readTranslator(storage))
        if (chain.length === 0) throw new Error('句子翻译已在设置里关闭')

        let outcome = null
        let lastError = null
        for (const provider of chain) {
          try {
            outcome = await translate({
              provider,
              text,
              sourceLanguage: 'en',
              targetLanguage: 'zh-CN',
              recipe: 'sentence',
            }, controller.signal)
            if (outcome !== null && outcome !== undefined) break
          } catch (error) {
            lastError = error
            if (controller.signal.aborted) throw error
          }
        }
        if (outcome === null || outcome === undefined) {
          throw lastError ?? new Error('翻译没有返回结果')
        }
        if (controller.signal.aborted) return
        runtime.translation = typeof outcome === 'string'
          ? outcome
          : String(outcome?.text ?? outcome?.translation ?? '')
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

      if (selection.kind === 'word') {
        const hit = lookupWord(selection.key)
        if (hit === null) {
          runtime.mode = 'none'
          runtime.placement = null
          notify()
          return
        }
        runtime.result = hit
        runtime.entryRaw = hit.entry
        runtime.mode = 'popover'
        runtime.placement = placeFor('popover', bounds)
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
      runtime.placement = null
      machine.feed({ kind: 'dismiss' })
      notify()
    }

    const dispose = []
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
      const selection = readSelection(doc)
      if (selection === null || selection.collapsed) return false
      // 选区必须落在对话正文里。输入框里选中文字是想复制或替换，不是查词。
      const anchorNode = currentSelectionNode(doc)
      if (anchorNode === null) return false
      if (!inChatRegion(anchorNode)) return false
      if (inComposer(anchorNode)) return false
      if (selection.text === lastText && runtime.mode !== 'none') return true
      lastText = selection.text
      applySelection(selection)
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
      const out = new Set()
      if (!rt.wordbook || rt.status !== 'ready' || !rt.dict) {
        for (const entry of rt.wordbook?.list() ?? []) out.add(entry.head)
        return out
      }
      for (const entry of rt.wordbook.list()) {
        out.add(entry.head)
        const node = rt.dict.entries[entry.head]
        if (!node) continue
        for (let i = 5; i < node.length; i += 1) {
          const slot = node[i]
          if (typeof slot !== 'string') continue
          for (const part of slot.split('/')) {
            const colon = part.indexOf(':')
            if (colon <= 0) continue
            const form = part.slice(colon + 1).trim().toLowerCase()
            if (form) out.add(form)
          }
        }
      }
      return out
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
        status: runtime.status,
        errorMessage: runtime.errorMessage,
        ux: runtime.ux,
        bookVersion: runtime.bookVersion,
        inBook: runtime.selection ? runtime.wordbook?.has(runtime.selection.key) === true : false,
        inBookSet: collectBookSet(runtime),
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

    const register = () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-hover-dict',
      order: 80,
    }, (props) => OverlayHost({
      store,
      tagLabel: (tag) => tagLabel(tag, 'zh'),
      actions: store.actions,
      ...props,
    }))

    dispose.push(ctx.slots.inject('shell.overlay', register))

    // 设置面板：注册到插件详情页（key 必须是包名）
    try {
      const disposeSettingsStyle = ensureSettingsStyle(doc)
      dispose.push(disposeSettingsStyle)
      dispose.push(ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-hover-dict',
        inject: () => ({ wordbook: runtime.wordbook, apiPrefix: '/api/dsh-hover-dict' }),
      }, SettingsPanel)))
    } catch (error) {
      // 这个版本的宿主可能没有插件详情页，不是错误
      warn('设置面板挂载失败（不影响查词）', error)
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
        notify()
      })
      await runtime.wordbook.ready()
      runtime.bookVersion += 1
      notify()
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
      placement, ux, status, errorMessage, inBook, inBookSet, family, roots,
    } = snapshot
    const actions = props.actions ?? {}
    const children = []

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
