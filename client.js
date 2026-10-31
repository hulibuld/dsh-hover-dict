/**
 * dsh-hover-dict · 浏览器半 —— **构建产物，不要手改**。
 *
 * 由 `node client/build.mjs` 从下列源文件拼成（顺序即依赖顺序）：
 *   client/src/config.js
 *   client/src/word.js
 *   client/src/hit.js
 *   client/src/selection.js
 *   client/src/net.js
 *   client/src/dict.js
 *   client/src/family.js
 *   client/src/wordbook.js
 *   client/src/anchor.js
 *   client/src/position.js
 *   client/src/overlay.js
 *   client/src/drag.js
 *   client/src/ui.js
 *   client/src/settings.js
 *   client/src/card.js
 *   client/src/app.js
 *
 * 要改行为请改 client/src/ 下对应文件，然后重新构建；
 * `node client/build.mjs --check` 会在产物与源码不同步时失败。
 *
 * 四条硬约束（违反会白屏或崩掉整个 slot）：
 *   1. 不 require 任何 @deepseek-ai/dsh-client-* 包，只用宿主给的 react；
 *   2. 界面全是 slot 里的 React 组件，不托管 iframe；
 *   3. 不在组件外写 DOM、不往 document.body 追加节点；
 *   4. 组件抛错会让这条 entry 退役（浮层静默消失），渲染路径上不许有会抛的表达式。
 *
 * 本插件专属红线：**绝不改正文 DOM**。不包 span、不加 class、不改 textContent。
 * 单词定位靠 caretRangeFromPoint + Range.getRects，高亮与浮层都在本插件的覆盖层里。
 */
window.__ModuleLoader__.load({
  id: 'dsh-hover-dict',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ── 构建期前导（源码里不要重复声明这些名字） ──
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useLayoutEffect = React.useLayoutEffect || React.useEffect
    var useRef = React.useRef
    var useMemo = React.useMemo
    var useCallback = React.useCallback

    // ═══ config.js ═══
    var __mod_config = (function () {
/**
 * config.js —— 界面参数、localStorage 持久化、主题常量。
 *
 * 为什么界面参数不进宿主 Config：它们属于浏览器半，改完要立刻生效；
 * 塞进 Config 会逼用户为调 50ms 去改 profile 的 cordis.patch.yml 并重启。
 * 分工的判据是「改了需不需要重启」：需要 → Config，不需要 → localStorage。
 *
 * 本模块不碰 DOM、不碰网络，可以单独在 node 里 import 测试。
 */

/**
 * 一套完整的交互时间参数。**每个数字都是契约的一部分**，实现者不许在别处硬编码。
 *
 * 时序的来龙去脉（为什么是这些数，而不是更好看的整数）见 docs/架构.md §5。
 *
 * @typedef {object} UxTiming
 * @property {number} hoverDelayMs      鼠标停稳多久才弹小浮层。太快会跟着横扫变成闪烁
 * @property {number} stableRadiusPx    判「没在移动」的容差半径；与 hoverDelayMs 联合判定
 * @property {number} leaveGraceMs      移出单词到收起浮层之间的宽限，留给用户把鼠标移进浮层
 * @property {number} popinGraceMs      浮层自己悬停时的额外宽限，比 leaveGraceMs 宽
 * @property {number} upgradeDelayMs    点击到展开大卡片之间的最短间隔，防误触双击
 * @property {number} cardLeaveGraceMs  大卡片移出后的消失宽限
 * @property {number} scrollDismissMs   滚动停止多久后才允许重新弹，防滚动时闪一片
 * @property {number} streamSettleMs    流式输出停止多久后恢复悬停响应
 * @property {number} repositionThrottleMs 滚动/resize 时重算位置的节流间隔
 * @property {number} maxHoverPerMinute 每分钟最多弹几次，防病态触发
 */

/**
 * 默认时序。改这里就要同步改 docs/架构.md 的表格。
 * @type {UxTiming}
 */
    const DEFAULT_TIMING = {
      hoverDelayMs: 120,
      stableRadiusPx: 3,
      leaveGraceMs: 180,
      popinGraceMs: 420,
      upgradeDelayMs: 0,
      cardLeaveGraceMs: 220,
      scrollDismissMs: 260,
      streamSettleMs: 400,
      repositionThrottleMs: 80,
      maxHoverPerMinute: 60,
    }

/**
 * 外观参数。与主题 token 无关的纯尺寸进这里；颜色一律走 `--dsw-alias-*`。
 *
 * @typedef {object} UxAppearance
 * @property {number} maxSensesInPopover  小浮层最多显示几条中文释义。产品要求 ≤2
 * @property {number} cardMaxWidthPx      大卡片最大宽度
 * @property {number} cardMaxHeightRatio  大卡片高度上限占视口比例
 * @property {number} offsetPx            浮层与单词之间的垂直间距
 * @property {number} viewportMarginPx    贴边时的最小留白
 * @property {boolean} showTags           是否显示考纲标签
 * @property {string[]} tagOrder          标签展示顺序，靠前的优先
 */

/** @type {UxAppearance} */
    const DEFAULT_APPEARANCE = {
      maxSensesInPopover: 2,
      cardMaxWidthPx: 420,
      cardMaxHeightRatio: 0.7,
      offsetPx: 6,
      viewportMarginPx: 8,
      showTags: true,
      tagOrder: ['cet4', 'cet6', 'ky', 'ielts'],
    }

/**
 * 合并后的默认值。app.js 用它对 Config 与 localStorage 做兜底。
 * @type {{ timing: UxTiming, appearance: UxAppearance }}
 */
    const DEFAULT_UX = {
      timing: DEFAULT_TIMING,
      appearance: DEFAULT_APPEARANCE,
    }

/** 时序参数的夹取边界，键与 DEFAULT_TIMING 一一对应。 */
    const TIMING_BOUNDS = {
      hoverDelayMs: [40, 2000],
      stableRadiusPx: [0, 24],
      leaveGraceMs: [0, 2000],
      popinGraceMs: [0, 4000],
      upgradeDelayMs: [0, 1000],
      cardLeaveGraceMs: [0, 2000],
      scrollDismissMs: [0, 2000],
      streamSettleMs: [0, 5000],
      repositionThrottleMs: [16, 500],
      maxHoverPerMinute: [1, 600],
    }

/** 外观参数的夹取边界。 */
    const APPEARANCE_BOUNDS = {
      maxSensesInPopover: [1, 5],
      cardMaxWidthPx: [240, 720],
      cardMaxHeightRatio: [0.3, 0.95],
      offsetPx: [0, 32],
      viewportMarginPx: [0, 48],
    }

/** 认识的考纲标签。未知标签不展示，避免把考试名写错。 */
    const KNOWN_TAGS = new Set(['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'])

    const TAG_LABELS_ZH = {
      zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
      ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE',
    }
    const TAG_LABELS_EN = {
      zk: 'Zhongkao', gk: 'Gaokao', cet4: 'CET-4', cet6: 'CET-6',
      ky: 'Kaoyan', toefl: 'TOEFL', ielts: 'IELTS', gre: 'GRE',
    }

/** localStorage 的键名。前缀带包名，避免与宿主或别的插件撞。 */
    const STORAGE_KEY = 'dsh-hover-dict:ux'

/**
 * 从 localStorage 读用户覆盖值。
 *
 * 契约：
 *   - 读不到 / JSON 坏 / 类型不对 → 返回 `DEFAULT_UX` 的**深拷贝**，绝不抛；
 *   - 只认识的键合并，未知键丢弃（防止旧版本残留字段污染）；
 *   - 数值字段必须过 `clampTiming` / `clampAppearance` 的边界；
 *   - 传入的 `storage` 可为 undefined（node 测试环境），此时直接返回默认值。
 *
 * @param {{ getItem: (key: string) => string | null } | undefined} [storage]
 * @returns {{ timing: UxTiming, appearance: UxAppearance }}
 */
    function loadUx(storage) {
      const fallback = {
        timing: { ...DEFAULT_TIMING },
        appearance: { ...DEFAULT_APPEARANCE, tagOrder: [...DEFAULT_APPEARANCE.tagOrder] },
      }
      if (!storage || typeof storage.getItem !== 'function') return fallback

      let raw = null
      try {
        raw = storage.getItem(STORAGE_KEY)
      } catch {
        return fallback
      }
      if (typeof raw !== 'string' || raw === '') return fallback

      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        return fallback
      }
      if (!parsed || typeof parsed !== 'object') return fallback

      return {
        timing: clampTiming(parsed.timing && typeof parsed.timing === 'object' ? parsed.timing : {}),
        appearance: clampAppearance(parsed.appearance && typeof parsed.appearance === 'object' ? parsed.appearance : {}),
      }
    }

/**
 * 写用户覆盖值。失败（配额满、隐私模式）时静默忽略 —— 界面不该因为存不了偏好而报错。
 *
 * @param {{ setItem: (key: string, value: string) => void } | undefined} storage
 * @param {{ timing?: Partial<UxTiming>, appearance?: Partial<UxAppearance> }} patch
 * @returns {boolean} 是否真的写成功
 */
    function saveUx(storage, patch) {
      if (!storage || typeof storage.setItem !== 'function') return false
      const current = loadUx(storage)
      const next = {
        timing: clampTiming({ ...current.timing, ...(patch?.timing ?? {}) }),
        appearance: clampAppearance({ ...current.appearance, ...(patch?.appearance ?? {}) }),
      }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(next))
        return true
      } catch {
    // 配额满 / 隐私模式：偏好存不下来不该让界面报错
        return false
      }
    }

/**
 * 把时序参数夹到安全区间。越界不报错，直接夹 —— 用户改坏了自己的 localStorage
 * 不该让插件失效，但也不能让 `hoverDelayMs: 0` 把界面打成频闪。
 *
 * 边界（每个值的下限/上限都要写进 docs/架构.md 的配置表）：
 *   hoverDelayMs        40  – 2000
 *   stableRadiusPx       0  – 24
 *   leaveGraceMs         0  – 2000
 *   popinGraceMs         0  – 4000
 *   upgradeDelayMs       0  – 1000
 *   cardLeaveGraceMs     0  – 2000
 *   scrollDismissMs      0  – 2000
 *   streamSettleMs       0  – 5000
 *   repositionThrottleMs 16 – 500
 *   maxHoverPerMinute    1  – 600
 *
 * @param {Partial<UxTiming>} input
 * @returns {UxTiming}
 */
    function clampTiming(input) {
      const source = input && typeof input === 'object' ? input : {}
      const out = {}
      for (const [key, fallback] of Object.entries(DEFAULT_TIMING)) {
        const [min, max] = TIMING_BOUNDS[key] ?? [fallback, fallback]
        const value = source[key]
        out[key] = Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
      }
      return out
    }

/**
 * 把外观参数夹到安全区间。
 *
 * 边界：
 *   maxSensesInPopover   1 – 5
 *   cardMaxWidthPx       240 – 720
 *   cardMaxHeightRatio   0.3 – 0.95
 *   offsetPx             0 – 32
 *   viewportMarginPx     0 – 48
 *   tagOrder             只保留已知标签，去重，最多 8 个
 *
 * @param {Partial<UxAppearance>} input
 * @returns {UxAppearance}
 */
    function clampAppearance(input) {
      const source = input && typeof input === 'object' ? input : {}

      const pick = (key) => {
        const [min, max] = APPEARANCE_BOUNDS[key] ?? [0, 0]
        const value = source[key]
        return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : DEFAULT_APPEARANCE[key]
      }

      const out = {
        maxSensesInPopover: pick('maxSensesInPopover'),
        cardMaxWidthPx: pick('cardMaxWidthPx'),
        cardMaxHeightRatio: pick('cardMaxHeightRatio'),
        offsetPx: pick('offsetPx'),
        viewportMarginPx: pick('viewportMarginPx'),
        showTags: typeof source.showTags === 'boolean' ? source.showTags : DEFAULT_APPEARANCE.showTags,
        tagOrder: DEFAULT_APPEARANCE.tagOrder.slice(),
      }

      if (Array.isArray(source.tagOrder)) {
        const known = []
        for (const tag of source.tagOrder) {
          if (typeof tag === 'string' && KNOWN_TAGS.has(tag) && !known.includes(tag)) known.push(tag)
          if (known.length >= 8) break
        }
        if (known.length > 0) out.tagOrder = known
      }
      return out
    }

/**
 * 把考纲标签码翻成给人看的中文/英文短名。
 *
 * 为什么放在 config 而不是 dict：这是**展示层**映射，跟词库数据无关。
 * 词库里只有 `cet4` 这种码，翻不翻、翻成什么都由界面决定。
 *
 * @param {string} tag - 'cet4' | 'cet6' | 'ky' | 'ielts' | 未知值
 * @param {'zh' | 'en'} [locale]
 * @returns {string} 未知标签回原样（不丢信息，方便排查数据）
 */
    function tagLabel(tag, locale) {
      if (typeof tag !== 'string' || tag === '') return ''
      const table = locale === 'en' ? TAG_LABELS_EN : TAG_LABELS_ZH
      return table[tag] ?? tag
    }

      return { DEFAULT_TIMING, DEFAULT_APPEARANCE, DEFAULT_UX, STORAGE_KEY, loadUx, saveUx, clampTiming, clampAppearance, tagLabel }
    })()

    // ═══ word.js ═══
    var __mod_word = (function () {
/**
 * word.js —— 「鼠标底下是哪个英文单词」的纯函数层。
 *
 * 本模块**不碰 DOM 事件、不碰词库、不碰 React**。输入是文本与节点内偏移，
 * 输出是一个边界清楚的区间描述。所有函数要么返回值，要么返回 null，绝不抛。
 *
 * 单词边界规则（比正则 `\b` 严格，因为 `\b` 认 `don't` 的撇号是边界）：
 *   - 词字符：`A-Z a-z` 与连字符（`-`）与撇号（`'`、`’`）；
 *   - 连字符和撇号**只有在两侧都是字母时**才算词内字符，
 *     所以 `well-known` 是一个词，而 `-well` 与 `well-` 不是；
 *   - 长度上限 64 字符：超了说明这不是一个词（可能是 base64 或 URL 残段）；
 *   - 纯数字、纯符号、含非拉丁字母（中文/日文/俄文…）一律不算英文单词。
 */

/**
 * 一个单词在某个文本节点内的位置。
 *
 * @typedef {object} WordHit
 * @property {Text} node
 * @property {number} start
 * @property {number} end
 * @property {string} text
 */

/** 拉丁字母（含带变音符的西欧字母）。 */
    const LATIN = /[A-Za-z\u00C0-\u024F]/
    const DIGIT = /[0-9]/

/**
 * 判断一个字符能否出现在英文单词**内部**。
 *
 * 数字也算：技术文本里 `utf8`、`sha256` 是真词，悬停它们应该能查
 * （查不到就显示未收录，但不能连命中都不给）。纯数字串由 wordAt 单独排除。
 *
 * @param {string} ch
 * @returns {boolean}
 */
    function isWordChar(ch) {
      if (typeof ch !== 'string' || ch.length === 0) return false
      return LATIN.test(ch) || DIGIT.test(ch)
    }

/**
 * 判断一个字符是不是「词的连接符」（连字符或撇号）。
 *
 * 撇号两种都认：直角 `'`（U+0027）与弯的 `’`（U+2019）。
 * 正文里渲染器有时会把直撇号换成弯的，不认就查不到 `don’t`。
 *
 * @param {string} ch
 * @returns {boolean}
 */
    function isJoiner(ch) {
      return ch === '-' || ch === "'" || ch === '\u2019' || ch === '\u2018'
    }

/** 单词最大长度。超过就当它不是单词。 */
    const MAX_WORD_LEN = 64

/** 纯数字串不是要查的词（年份、编号、版本号）。 */
    const ALL_DIGITS = /^[0-9]+$/

/**
 * 从文本里取「包含 offset 的那个英文单词」。
 *
 * @param {string} text - 通常是 `node.data`
 * @param {number} offset - 字符偏移（不是字节）
 * @param {{ preferLeft?: boolean }} [options]
 *   preferLeft：光标正好落在词尾右侧（offset === end）时是否向左借这个词。
 *   鼠标停在最后一个字母右半边时 caretRangeFromPoint 会给出 end。
 * @returns {{ start: number, end: number, text: string } | null}
 */
    function wordAt(text, offset, options) {
      if (typeof text !== 'string' || text.length === 0) return null
      const preferLeft = options?.preferLeft === true

      let index = Number(offset)
      if (!Number.isInteger(index)) return null
      if (index < 0 || index > text.length) return null

      const at = (i) => (i >= 0 && i < text.length ? text[i] : '')

  // 连接符判定：左右两侧都必须是字母
      const joinerInside = (i) => isJoiner(at(i)) && LATIN.test(at(i - 1)) && LATIN.test(at(i + 1))

  // 光标落在词外：只有明确要求时才向左借一格
      if (index === text.length || !isWordChar(at(index))) {
        if (preferLeft && index > 0 && isWordChar(at(index - 1))) index -= 1
        else return null
      }

  // 向左扩
      let start = index
      while (start > 0) {
        if (isWordChar(at(start - 1))) { start -= 1; continue }
        if (LATIN.test(at(start)) && joinerInside(start - 1)) { start -= 1; continue }
        break
      }

  // 向右扩
      let end = index + 1
      while (end < text.length) {
        if (isWordChar(at(end))) { end += 1; continue }
        if (LATIN.test(at(end - 1)) && joinerInside(end)) { end += 1; continue }
        break
      }

  // 连接符不能出现在词首或词尾
      while (start < end && isJoiner(at(start))) start += 1
      while (end > start && isJoiner(at(end - 1))) end -= 1

      const word = text.slice(start, end)
      if (word.length === 0 || word.length > MAX_WORD_LEN) return null
      if (ALL_DIGITS.test(word)) return null
      if (!LATIN.test(word)) return null

      return { start, end, text: word }
    }

/**
 * 把用户看到的词形还原成查词用的规范键。
 *
 * 只做两件纯字符串的事：统一撇号、转小写。
 * 不做词形还原 —— 变位由词条自带的 forms 字段承担（见 dict.js）。
 *
 * @param {string} text
 * @returns {string}
 */
    function normalizeKey(text) {
      if (typeof text !== 'string') return ''
      return text.replace(/[\u2018\u2019]/g, "'").toLowerCase().trim()
    }

/**
 * 兜底词形还原：只在 forms 索引查不到时用一次。
 *
 * @param {string} key - 已 normalize 过的小写词
 * @returns {string[]} 去重后的候选，长度 ≤ 8；原词**不**包含在内
 */
    function stemCandidates(key) {
      if (typeof key !== 'string' || key.length < 3) return []
      const out = []
      const push = (value) => {
        if (value && value.length >= 2 && value !== key && !out.includes(value)) out.push(value)
      }
      const doubled = (stem) => stem.length >= 2
        && stem[stem.length - 1] === stem[stem.length - 2]
        && !/[aeiou]/.test(stem[stem.length - 1])

      if (key.endsWith('ies')) push(key.slice(0, -3) + 'y')
      if (key.endsWith('ves')) { push(key.slice(0, -3) + 'f'); push(key.slice(0, -3) + 'fe') }
      if (key.endsWith('es')) push(key.slice(0, -2))
      if (key.endsWith('s') && !key.endsWith('ss')) push(key.slice(0, -1))

      if (key.endsWith('ied')) push(key.slice(0, -3) + 'y')
      if (key.endsWith('ed')) {
        const stem = key.slice(0, -2)
        push(stem)
        push(key.slice(0, -1))
        if (doubled(stem)) push(stem.slice(0, -1))
      }

      if (key.endsWith('ing')) {
        const stem = key.slice(0, -3)
        push(stem)
        push(stem + 'e')
        if (doubled(stem)) push(stem.slice(0, -1))
      }

      if (key.endsWith('est')) push(key.slice(0, -3))
      if (key.endsWith('er')) push(key.slice(0, -2))
      if (key.endsWith('ly')) { push(key.slice(0, -2)); push(key.slice(0, -2) + 'e') }

      return out.slice(0, 8)
    }

      return { isWordChar, isJoiner, MAX_WORD_LEN, wordAt, normalizeKey, stemCandidates }
    })()

    // ═══ hit.js ═══
    var __mod_hit = (function () {
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
    const SELECTORS = Object.freeze({
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
    const HIT_BLOCKERS = Object.freeze([
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
    function isEligibleTarget(el, options) {
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
    function caretAt(doc, clientX, clientY) {
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
    function isProgrammaticScroll(input) {
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

      return { SELECTORS, HIT_BLOCKERS, isEligibleTarget, caretAt, isProgrammaticScroll }
    })()

    // ═══ selection.js ═══
    var __mod_selection = (function () {
      var { normalizeKey } = __mod_word
/**
 * selection.js —— 「用户选中了哪段文字」的读取层。
 *
 * 这是交互的入口：不靠悬停猜用户想查哪个词，而是等用户明确选中。
 *
 * 支持三种粒度，靠**选中内容自己**判断，不需要用户切换模式：
 *   - 一个词（`hello`）→ 查词典；
 *   - 一个短语或句子 → 走翻译；
 *   - 空白 / 中文 / 纯数字 → 不处理。
 *
 * 只**读** `window.getSelection()`，一个字节都不写正文。
 */


/** 选中内容的最长字符数。超过这个长度不再处理（多半是误选整篇）。 */
    const MAX_SELECTION_CHARS = 600

/** 单个词的最长长度。 */
    const MAX_WORD_CHARS = 64

/** 一个英文词：字母开头，可含内部撇号/连字符。 */
    const SINGLE_WORD = /^[A-Za-z][A-Za-z'\u2019-]{0,63}$/

/** 含至少两个英文词的短语/句子。 */
    const HAS_MULTIPLE_WORDS = /[A-Za-z][^\s]*\s+[^\s]*[A-Za-z]/

/** 至少有一个拉丁字母。 */
    const HAS_LATIN = /[A-Za-z]/

/** 汉字（含扩展区）。 */
    const HAS_HAN = /[\u4e00-\u9fff\u3400-\u4dbf]/

/**
 * 选中内容里汉字占「汉字 + 拉丁字母」的比例上限。
 *
 * 超过这个比例就不翻译。用户要的是「全英文才翻译」，
 * 但留一点余量：正文里偶尔夹一个中文词（人名、术语）不该让整段失效。
 *
 * 实测几种典型内容：
 *   纯英文句子        0%
 *   英文带个别中文词   8%
 *   中英混排          50%
 *   中文为主偶有英文   64%
 * 取 10% 能把后两种挡掉，又不误伤「This is a test 测试」这种顺带夹一个词的。
 */
    const MAX_HAN_RATIO = 0.10

/**
 * 数一下汉字相对拉丁字母的占比。
 *
 * @param {string} text
 * @returns {number} 0–1；没有字母也没有汉字时返回 1（当作不该翻译）
 */
    function hanRatio(text) {
      if (typeof text !== 'string' || text === '') return 1
      const han = (text.match(new RegExp(HAS_HAN.source, 'g')) ?? []).length
      const latin = (text.match(/[A-Za-z]/g) ?? []).length
      const total = han + latin
      if (total === 0) return 1
      return han / total
    }

/**
 * 判断一段文本是不是「够纯的英文」，可以走翻译。
 *
 * 单词查询不走这条判断 —— 单个词本来就不会含中文。
 *
 * @param {string} text
 * @returns {boolean}
 */
    function isTranslatable(text) {
      if (!HAS_LATIN.test(text)) return false
      return hanRatio(text) <= MAX_HAN_RATIO
    }

/**
 * 选中内容的处理结果。
 *
 * @typedef {object} SelectionResult
 * @property {'word' | 'phrase'} kind
 * @property {string} text
 * @property {string} key
 * @property {Rect[]} rects
 * @property {boolean} collapsed
 */

/**
 * 把一段选中文本分类。
 *
 * 判据刻意简单：一个词就查词典，其余含英文的当句子翻译。
 *
 * @param {string} raw
 * @returns {{ kind: 'word', key: string } | { kind: 'phrase', text: string } | null}
 */
    function classifySelection(raw) {
      if (typeof raw !== 'string') return null
      const text = raw.replace(/\s+/g, ' ').trim()
      if (text.length === 0 || text.length > MAX_SELECTION_CHARS) return null
      if (!HAS_LATIN.test(text)) return null

      if (!/\s/.test(text) && SINGLE_WORD.test(text)) {
        const key = normalizeKey(text)
        if (key.length === 0 || key.length > MAX_WORD_CHARS) return null
        return { kind: 'word', key }
      }

  // 中英混排：先判这一条，再判「是不是多词短语」。
  //
  // 顺序很重要：像「这个 tokenizers 的分词」这种，两个英文词之间夹着中文，
  // 用「词与词只隔空白」的正则根本匹配不上，会一路掉到最后的 null，
  // 界面就完全没反应。先按汉字占比拦下来，才能给出「跳过」的明确结果。
      if (HAS_HAN.test(text) && !isTranslatable(text)) {
        return { kind: 'skip', reason: 'mixed-language', text }
      }

      if (HAS_MULTIPLE_WORDS.test(text)) {
        return { kind: 'phrase', text }
      }

  // 单个「看起来像词但含数字」的东西（如 utf8）
      if (!/\s/.test(text) && /^[A-Za-z][A-Za-z0-9'-]{0,63}$/.test(text)) {
        const key = normalizeKey(text)
        if (key.length > 0) return { kind: 'word', key }
      }

      return null
    }

/**
 * 读当前选区。
 *
 * @param {Document} doc
 * @returns {SelectionResult | null}
 */
    function readSelection(doc) {
      if (!doc || typeof doc.getSelection !== 'function') return null
      let selection = null
      try {
        selection = doc.getSelection()
      } catch {
        return null
      }
      if (selection === null || selection === undefined) return null
      if (typeof selection.rangeCount !== 'number' || selection.rangeCount === 0) return null

      const raw = selection.toString()
      const classified = classifySelection(raw)
      if (classified === null) return null

      const range = selection.getRangeAt(0)
      const rects = rectsOf(range)
      if (rects.length === 0) return null

      const text = raw.replace(/\s+/g, ' ').trim()
      return {
        kind: classified.kind,
        text: classified.kind === 'phrase' ? classified.text : text,
        key: classified.kind === 'word' ? classified.key : text,
        rects,
        collapsed: selection.isCollapsed === true,
      }
    }

/**
 * 取一个 Range 覆盖的所有矩形，过滤掉 0 宽 0 高的空盒子。
 *
 * @param {Range} range
 * @returns {Rect[]}
 */
    function rectsOf(range) {
      if (!range || typeof range.getClientRects !== 'function') return []
      let raw
      try {
        raw = range.getClientRects()
      } catch {
        return []
      }
      const out = []
      for (let i = 0; i < raw.length; i += 1) {
        const rect = raw[i]
        if (!(rect.width > 0) || !(rect.height > 0)) continue
        out.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        })
      }
      return out
    }

/**
 * 从屏幕坐标反查「点在哪个文本节点、哪个字符上」。
 *
 * 单击取词用这个：用户点一下，问浏览器这个坐标落在哪个字符。
 *
 * @param {Document} doc
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ node: Text, offset: number } | null}
 */
    function caretAtPoint(doc, clientX, clientY) {
      if (!doc || typeof clientX !== 'number' || typeof clientY !== 'number') return null

      if (typeof doc.caretRangeFromPoint === 'function') {
        let range = null
        try {
          range = doc.caretRangeFromPoint(clientX, clientY)
        } catch {
          return null
        }
        if (range === null) return null
        const node = range.startContainer
        if (node === null || node.nodeType !== 3) return null
        return { node, offset: range.startOffset }
      }

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
 * 量一个文本节点的某个字符区间在屏幕上的矩形。
 *
 * @param {Document} doc
 * @param {Text} node
 * @param {number} start
 * @param {number} end
 * @returns {Rect[]}
 */
    function rangeRects(doc, node, start, end) {
      if (!doc || !node) return []
      try {
        const range = doc.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        return rectsOf(range)
      } catch {
        return []
      }
    }

/**
 * 把一组矩形并成外接矩形。空数组返回 null。
 *
 * @param {ReadonlyArray<Rect>} rects
 * @returns {Rect | null}
 */
    function unionOf(rects) {
      if (!Array.isArray(rects) || rects.length === 0) return null
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const rect of rects) {
        if (!rect) continue
        if (rect.left < left) left = rect.left
        if (rect.top < top) top = rect.top
        if (rect.right > right) right = rect.right
        if (rect.bottom > bottom) bottom = rect.bottom
      }
      if (!Number.isFinite(left)) return null
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }

/**
 * 判断一个坐标是否落在这些矩形（外扩 pad）内。
 *
 * @param {number} x
 * @param {number} y
 * @param {ReadonlyArray<Rect>} rects
 * @param {number} [pad]
 * @returns {boolean}
 */
    function hitsAny(x, y, rects, pad) {
      if (!Array.isArray(rects)) return false
      const grow = Number.isFinite(pad) ? pad : 0
      for (const rect of rects) {
        if (!rect) continue
        if (x >= rect.left - grow && x <= rect.right + grow
          && y >= rect.top - grow && y <= rect.bottom + grow) {
          return true
        }
      }
      return false
    }

      return { MAX_SELECTION_CHARS, hanRatio, isTranslatable, classifySelection, readSelection, rectsOf, caretAtPoint, rangeRects, unionOf, hitsAny }
    })()

    // ═══ net.js ═══
    var __mod_net = (function () {
/**
 * net.js —— 浏览器半访问宿主的唯一出口。
 *
 * 只做一件事：从 `/api/dsh-hover-dict/` 拉词库，把失败翻译成人话。
 *
 * 为什么不在浏览器里直接打包词库：3 MB 的 JSON 塞进 client.js 会让这个文件
 * 变成每次会话都要解析的负担，而且宿主已经有 HTTP 服务，走它更顺。
 * 宿主那边带 ETag 与 gzip，第二次启动基本是 304。
 */

/** 路由前缀。改这里必须同步改 index.js 里的 API_PREFIX。 */
    const API_PREFIX = '/api/dsh-hover-dict'

/** 单次请求超时。词库 3 MB，本机取毫秒级；超过 15 秒说明宿主出问题了。 */
    const TIMEOUT_MS = 15000

/**
 * 错误码 → 给用户看的中文。
 *
 * 界面只显示这里的话术，绝不把原始 JSON 或字段名透到屏幕上。
 * 未列入的码走通用兜底。
 */
    const ERROR_TEXT = {
      E_NOT_FOUND: '插件没有提供这个词库文件',
      E_DICT_MISSING: '词库未就绪，请先运行数据构建脚本',
      E_TOO_LARGE: '词库文件太大，宿主拒绝了',
      E_DISABLED: '悬停查词已关闭',
      E_INTERNAL: '插件内部出错了，稍后再试',
      E_NETWORK: '连不上宿主，请确认插件已启用',
      E_TIMEOUT: '读取词库超时',
      E_BAD_JSON: '词库文件损坏，请重新构建数据',
    }

/**
 * 从任意异常里抽出一句人话。
 *
 * @param {unknown} error
 * @returns {string}
 */
    function humanizeError(error) {
      if (typeof error === 'string') return error
      const code = error?.code
      if (typeof code === 'string' && ERROR_TEXT[code]) return ERROR_TEXT[code]
      if (error?.name === 'AbortError') return ERROR_TEXT.E_TIMEOUT
      const message = error?.message
      if (typeof message === 'string' && message.length > 0) return message
      return '查词暂时不可用'
    }

/**
 * 造一个带错误码的 Error。界面靠 code 再翻译一次，不靠 message 匹配。
 */
    function fail(code, detail) {
      const error = new Error(ERROR_TEXT[code] ?? '查词暂时不可用')
      error.code = code
      if (detail !== undefined) error.detail = detail
      return error
    }

/**
 * 拉一个词库文件并解析成 JSON。
 *
 * @param {string} name - 只能是 'meta.json' 或 'dict.dat'
 * @param {AbortSignal} [signal] - 外部取消信号（插件卸载时用）
 * @returns {Promise<any>}
 * @throws 失败一律抛带 code 的 Error；调用方用 humanizeError 转成话术
 */
    async function fetchAsset(name, signal) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  // 外部信号与内部超时合并：任一先到都取消
      const onAbort = () => controller.abort()
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); throw fail('E_TIMEOUT') }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      let response
      try {
        response = await fetch(`${API_PREFIX}/${name}`, {
          signal: controller.signal,
      // 词库带 ETag，让浏览器自己缓存；不要加 cache: 'no-store'
          credentials: 'same-origin',
        })
      } catch (error) {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        if (error?.name === 'AbortError') {
          throw signal?.aborted ? fail('E_DISABLED') : fail('E_TIMEOUT')
        }
        throw fail('E_NETWORK', error?.message)
      }

      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)

      if (!response.ok) {
    // 宿主失败时回的是 { ok:false, error:{ code, message } }
        let code = 'E_INTERNAL'
        try {
          const body = await response.json()
          if (typeof body?.error?.code === 'string') code = body.error.code
        } catch { /* 响应不是 JSON，用兜底码 */ }
        throw fail(code, response.status)
      }

      try {
        return await response.json()
      } catch {
        throw fail('E_BAD_JSON')
      }
    }

      return { API_PREFIX, humanizeError, fetchAsset }
    })()

    // ═══ dict.js ═══
    var __mod_dict = (function () {
      var { fetchAsset } = __mod_net
      var { normalizeKey, stemCandidates } = __mod_word
/**
 * dict.js —— 词库的加载、索引与查询。
 *
 * 三块，边界清楚：
 *   1. `loadDictionary` 把两个文件拉进来、解析、建索引 —— 只跑一次；
 *   2. `lookup`         纯查询，不抛、不阻塞；
 *   3. `describeEntry`  把紧凑布局的 Entry 摊开成渲染层好用的形状。
 *
 * 为什么 Entry 是定长数组而不是对象：2 万词条 × 每个键名重复一次，
 * 光键名就是十几万字符。数组把这笔开销抹掉，代价是渲染前要摊一次
 * （见 docs/架构.md §4.2）。
 */


/**
 * 词性 → 中文标签。数据里存的是 ECDICT 原文（带点），渲染时换成这个。
 * 查不到的（生僻词性）直接显示原文，不要显示空白。
 */
    const POS_LABELS = {
      'n.': '名词', 'v.': '动词', 'vi.': '不及物', 'vt.': '及物',
      'a.': '形容词', 'adj.': '形容词', 'ad.': '副词', 'adv.': '副词',
      'prep.': '介词', 'conj.': '连词', 'pron.': '代词', 'num.': '数词',
      'art.': '冠词', 'int.': '感叹词', 'interj.': '感叹词', 'aux.': '助动词',
      'abbr.': '缩写', 'pl.': '复数', 'suff.': '后缀', 'pref.': '前缀',
    }

/** 变位短键 → 中文标签。数据里存 `p:ran/i:running`，标签在这里补。 */
    const FORM_LABELS = {
      p: '过去式', d: '过去分词', i: '现在分词',
      3: '第三人称单数', s: '复数', r: '比较级', t: '最高级',
    }

/** 考纲标签 → 显示名。 */
    const TAG_LABELS = {
      zk: '中考', gk: '高考', cet4: '四级', cet6: '六级',
      ky: '考研', toefl: '托福', ielts: '雅思', gre: 'GRE',
    }

/**
 * 一份加载好的词库。
 *
 * @typedef {object} Dictionary
 * @property {Record<string, any[]>} entries  词头 → 槽位数组
 * @property {Map<string, string>} formIndex  变位词形 → 词头
 * @property {{ schema: number, entries: number, examples: number, licenses: object }} meta
 */

/**
 * 把一个词性原文转成中文短标签。
 * @param {string} pos - 如 `n.`
 * @returns {string}
 */
    function posLabel(pos) {
      if (typeof pos !== 'string') return ''
      return POS_LABELS[pos] ?? POS_LABELS[pos.trim()] ?? pos.replace(/\.$/, '')
    }

/**
 * 把考纲标签转成中文。未知标签原样返回。
 * @param {string} tag
 * @returns {string}
 */
    function tagLabelLocal(tag) {
      return TAG_LABELS[tag] ?? tag
    }

/**
 * 解析变位串 `p:ran/i:running` 成 `[['ran','过去式'],…]`。
 *
 * @param {string} raw
 * @returns {Array<[string, string]>}
 */
    function parseForms(raw) {
      if (typeof raw !== 'string' || raw === '') return []
      const out = []
      for (const part of raw.split('/')) {
        const colon = part.indexOf(':')
        if (colon <= 0) continue
        const form = part.slice(colon + 1).trim()
        const label = FORM_LABELS[part.slice(0, colon)] ?? '变位'
        if (form) out.push([form, label])
      }
      return out
    }

/**
 * 造索引并返回 Dictionary。
 *
 * 索引两条：
 *   - entries：词头本身直接可查（对象键查找，O(1)）；
 *   - formIndex：遍历每个词条的变位串，把 `ran → run` 这类映射摊平。
 *     2 万个词条约 4 万次 Map.set，实测 5 毫秒级，一次性成本。
 *
 * @param {Record<string, any[]>} entries
 * @param {object} meta
 * @returns {Dictionary}
 */
    function buildIndex(entries, meta) {
      const formIndex = new Map()
      for (const head of Object.keys(entries)) {
        const entry = entries[head]
        if (!Array.isArray(entry)) continue
    // forms 永远在 senses/tags/frq/collins/oxford 之后、examples 之前，
    // 但有没有 examples 是不确定的，所以按类型找那个字符串槽。
        for (let i = 5; i < entry.length; i += 1) {
          const slot = entry[i]
          if (typeof slot !== 'string') continue
          for (const part of slot.split('/')) {
            const colon = part.indexOf(':')
            if (colon <= 0) continue
            const form = normalizeKey(part.slice(colon + 1))
        // 词头优先：`lay` 既是 lie 的过去式也是独立动词，查它应该出 lay 本身。
        // 所以变位映射**不覆盖**已在 entries 里的键。
            if (form && !Object.prototype.hasOwnProperty.call(entries, form) && !formIndex.has(form)) {
              formIndex.set(form, head)
            }
          }
        }
      }
      return { entries, formIndex, meta: meta ?? {} }
    }

/**
 * 加载整个词库。只调用一次，结果缓存。
 *
 * @param {AbortSignal} [signal]
 * @returns {Promise<Dictionary>}
 */
    async function loadDictionary(signal) {
      const meta = await fetchAsset('meta.json', signal)
      if (meta?.schema !== 1) {
        const error = new Error('词库格式版本不受支持，请更新插件')
        error.code = 'E_BAD_JSON'
        throw error
      }
      const entries = await fetchAsset('dict.dat', signal)
      if (!entries || typeof entries !== 'object') {
        const error = new Error('词库文件损坏，请重新构建数据')
        error.code = 'E_BAD_JSON'
        throw error
      }
      const dict = buildIndex(entries, meta)
      if (typeof meta.entries === 'number' && Object.keys(entries).length !== meta.entries) {
    // 不一致不要抛：用户可能正在重跑数据脚本，半新半旧能查就先查
        if (typeof console !== 'undefined') {
          console.warn(`[dsh-hover-dict] 词库条数与 meta 不符：${Object.keys(entries).length} vs ${meta.entries}`)
        }
      }
      return dict
    }

/**
 * 查一个词。
 *
 * 顺序：词头 → 变位索引 → 兜底词形还原。三次都查不到就是未收录。
 * 全程同步、不抛、不阻塞。
 *
 * @param {Dictionary} dict
 * @param {string} rawWord - 用户看到的原样词
 * @returns {{ head: string, entry: any[], matchedBy: 'head'|'form'|'stem' } | null}
 */
    function lookup(dict, rawWord) {
      if (!dict || typeof rawWord !== 'string') return null
      const key = normalizeKey(rawWord)
      if (!key) return null

      const entries = dict.entries
      if (Object.prototype.hasOwnProperty.call(entries, key)) {
        return { head: key, entry: entries[key], matchedBy: 'head' }
      }

      const viaForm = dict.formIndex.get(key)
      if (viaForm !== undefined && Object.prototype.hasOwnProperty.call(entries, viaForm)) {
        return { head: viaForm, entry: entries[viaForm], matchedBy: 'form' }
      }

      for (const candidate of stemCandidates(key)) {
        if (Object.prototype.hasOwnProperty.call(entries, candidate)) {
          return { head: candidate, entry: entries[candidate], matchedBy: 'stem' }
        }
        const stemmed = dict.formIndex.get(candidate)
        if (stemmed !== undefined && Object.prototype.hasOwnProperty.call(entries, stemmed)) {
          return { head: stemmed, entry: entries[stemmed], matchedBy: 'stem' }
        }
      }

      return null
    }

/**
 * 把紧凑的 Entry 摊开成渲染层好用的形状。
 *
 * 只在**打开大卡片时**调用一次；悬停路径上不摊。
 *
 * @param {any[]} entry - 槽位数组
 * @returns {{
 *   senses: Array<{ pos: string, posLabel: string, zh: string[], en: string[] }>,
 *   tags: string[],
 *   tagsLabel: string[],
 *   frq: number,
 *   collins: number,
 *   oxford: boolean,
 *   forms: Array<[string, string]>,
 *   examples: Array<{ en: string, zh: string }>
 * }}
 */
    function describeEntry(entry) {
      const empty = { senses: [], tags: [], tagsLabel: [], frq: 0, collins: 0, oxford: false, forms: [], examples: [] }
      if (!Array.isArray(entry)) return empty

      const senses = []
      const rawSenses = Array.isArray(entry[0]) ? entry[0] : []
      for (const group of rawSenses) {
        if (!Array.isArray(group)) continue
        const pos = typeof group[0] === 'string' ? group[0] : ''
        const zh = Array.isArray(group[1]) ? group[1].filter((x) => typeof x === 'string') : []
        const en = Array.isArray(group[2]) ? group[2].filter((x) => typeof x === 'string') : []
        if (zh.length === 0 && en.length === 0) continue
        senses.push({ pos, posLabel: posLabel(pos), zh, en })
      }

      const tags = typeof entry[1] === 'string' ? entry[1].split(/\s+/).filter(Boolean) : []

  // 槽位 5 起是变位串与例句，两者都在但不是固定的谁先
      let forms = []
      let examples = []
      for (let i = 5; i < entry.length; i += 1) {
        const slot = entry[i]
        if (typeof slot === 'string') forms = parseForms(slot)
        else if (Array.isArray(slot)) {
          examples = slot
            .filter((pair) => Array.isArray(pair) && typeof pair[0] === 'string')
            .map((pair) => ({ en: pair[0], zh: typeof pair[1] === 'string' ? pair[1] : '' }))
        }
      }

      return {
        senses,
        tags,
        tagsLabel: tags.map(tagLabelLocal),
        frq: typeof entry[2] === 'number' ? entry[2] : 0,
        collins: typeof entry[3] === 'number' ? entry[3] : 0,
        oxford: entry[4] === 1,
        forms,
        examples,
      }
    }

/**
 * 小浮层要显示的最小信息：第一条中文释义 + 词性 + 标签。
 *
 * @param {any[]} entry
 * @returns {{ pos: string, zh: string, tags: string[] }}
 */
    function briefOf(entry) {
      const described = describeEntry(entry)
      const first = described.senses.find((sense) => sense.zh.length > 0) ?? described.senses[0]
      return {
        pos: first?.posLabel ?? '',
        zh: first?.zh.slice(0, 2).join('；') ?? '',
        tags: described.tagsLabel,
      }
    }

      return { posLabel, parseForms, buildIndex, loadDictionary, lookup, describeEntry, briefOf }
    })()

    // ═══ family.js ═══
    var __mod_family = (function () {
/**
 * family.js —— 词族：一个词的原形、变位、同根派生词。
 *
 * 三种关系，界面上用三种颜色区分：
 *   1. **原形/变位**（正在看的词与它的 ran/running/runs）→ 标红
 *   2. **同根派生**（cute 与 cuteness / cuter / cutest / cutely）→ 标蓝
 *   3. 其他词 → 正常色
 *
 * 为什么不按「词头前缀相似」判断同根：`care` 与 `career`、`careen` 前缀一样，
 * 但一个是「关心」，另两个是「职业」「倾斜」，毫无词源关系。
 * 所以这里只认**派生成分**（后缀/前缀/屈折），不认字符相似度。
 */

/** 能构成「同根」的后缀。按长度降序排，先匹配长的。 */
    const SUFFIX_RULES = [
  // 名词化
      { suffix: 'ness', kind: 'noun' }, { suffix: 'ment', kind: 'noun' },
      { suffix: 'tion', kind: 'noun' }, { suffix: 'sion', kind: 'noun' },
      { suffix: 'ance', kind: 'noun' }, { suffix: 'ence', kind: 'noun' },
      { suffix: 'ity', kind: 'noun' }, { suffix: 'ism', kind: 'noun' },
      { suffix: 'ist', kind: 'noun' }, { suffix: 'er', kind: 'noun' },
      { suffix: 'or', kind: 'noun' }, { suffix: 'ee', kind: 'noun' },
      { suffix: 'age', kind: 'noun' }, { suffix: 'hood', kind: 'noun' },
      { suffix: 'ship', kind: 'noun' }, { suffix: 'dom', kind: 'noun' },
  // 形容词化
      { suffix: 'able', kind: 'adj' }, { suffix: 'ible', kind: 'adj' },
      { suffix: 'al', kind: 'adj' }, { suffix: 'ial', kind: 'adj' },
      { suffix: 'ous', kind: 'adj' }, { suffix: 'ious', kind: 'adj' },
      { suffix: 'ive', kind: 'adj' }, { suffix: 'ful', kind: 'adj' },
      { suffix: 'less', kind: 'adj' }, { suffix: 'ish', kind: 'adj' },
      { suffix: 'ary', kind: 'adj' }, { suffix: 'ory', kind: 'adj' },
      { suffix: 'ic', kind: 'adj' }, { suffix: 'ant', kind: 'adj' },
      { suffix: 'ent', kind: 'adj' }, { suffix: 'y', kind: 'adj' },
  // 副词化
      { suffix: 'ally', kind: 'adv' }, { suffix: 'ly', kind: 'adv' },
  // 动词化
      { suffix: 'ize', kind: 'verb' }, { suffix: 'ise', kind: 'verb' },
      { suffix: 'ify', kind: 'verb' }, { suffix: 'ate', kind: 'verb' },
      { suffix: 'en', kind: 'verb' },
  // 屈折：比较级/最高级
      { suffix: 'iest', kind: 'inflection' }, { suffix: 'ier', kind: 'inflection' },
      { suffix: 'est', kind: 'inflection' },
    ]

/** 能构成同根的前缀。用得比较保守，只收语义明确、不易误伤的。 */
    const PREFIX_RULES = [
      { prefix: 'un', kind: 'prefix' }, { prefix: 'in', kind: 'prefix' },
      { prefix: 'im', kind: 'prefix' }, { prefix: 'il', kind: 'prefix' },
      { prefix: 'ir', kind: 'prefix' }, { prefix: 'dis', kind: 'prefix' },
      { prefix: 'non', kind: 'prefix' }, { prefix: 'mis', kind: 'prefix' },
      { prefix: 'over', kind: 'prefix' }, { prefix: 'under', kind: 'prefix' },
      { prefix: 're', kind: 'prefix' }, { prefix: 'pre', kind: 'prefix' },
      { prefix: 'anti', kind: 'prefix' }, { prefix: 'semi', kind: 'prefix' },
      { prefix: 'super', kind: 'prefix' }, { prefix: 'sub', kind: 'prefix' },
    ]

/**
 * 从词条里读出它有哪些词性。
 *
 * 词条的槽 0 是义项组，每组第一项是词性前缀（如 `n.` `v.` `a.`）。
 *
 * @param {any[]} entry
 * @returns {Set<string>} 归一化后的词性集合：n / v / a / ad / …
 */
    function posOf(entry) {
      const out = new Set()
      const groups = Array.isArray(entry?.[0]) ? entry[0] : []
      for (const group of groups) {
        const raw = typeof group?.[0] === 'string' ? group[0].replace(/\.$/, '').toLowerCase() : ''
        if (raw === '') continue
        if (raw === 'adj' || raw === 'a') out.add('a')
        else if (raw === 'adv' || raw === 'ad') out.add('ad')
        else if (raw === 'vi' || raw === 'vt' || raw === 'v') out.add('v')
        else out.add(raw)
      }
      return out
    }

/**
 * 取一个词条全部中文释义里的汉字集合。
 *
 * 用于「造出来的词与原词有没有语义关联」这道判断。
 *
 * @param {any[]} entry
 * @returns {Set<string>}
 */
    function zhChars(entry) {
      const out = new Set()
      const groups = Array.isArray(entry?.[0]) ? entry[0] : []
      for (const group of groups) {
        const zh = Array.isArray(group?.[1]) ? group[1] : []
        for (const line of zh) {
          if (typeof line !== 'string') continue
          for (const ch of line) {
        // 只收汉字，标点与拉丁字母不参与比较
            if (/[\u4e00-\u9fff]/.test(ch)) out.add(ch)
          }
        }
      }
      return out
    }

/**
 * 候选词与词干有没有语义交集。
 *
 * 判据：候选词的中文释义里出现任何一个词干的汉字。
 * 这个判据宽松，但足够挡掉 care→career（「职业」里没有「关/心/介/意/小/照/料」）、
 * care→careen（「倾斜」同样不含）这类假同根。
 *
 * @param {string} candidate
 * @param {Set<string>} stemChars
 * @param {Record<string, any[]>} entries
 * @returns {boolean}
 */
    function sharesMeaning(candidate, stemChars, entries) {
      if (stemChars.size === 0) return false
      if (!Object.prototype.hasOwnProperty.call(entries, candidate)) return false
      const chars = zhChars(entries[candidate])
      if (chars.size === 0) return false
      for (const ch of chars) {
        if (stemChars.has(ch)) return true
      }
      return false
    }

/**
 * 某个词性能不能带某个后缀。
 *
 * 规则偏保守：宁可少认一个派生词，也不要造出「career」这种假同根。
 *
 * @param {Set<string>} posSet
 * @param {{ suffix: string, kind: string }} rule
 * @returns {boolean}
 */
    function canTakeSuffix(posSet, rule) {
      const has = (...names) => names.some((name) => posSet.has(name))
      switch (rule.kind) {
    // 名词化后缀：名词与动词都能带（teach → teacher / kind → kindness）
        case 'noun':
          return has('n', 'v', 'a')
    // 形容词化：名词与动词能带（care → careful / beauty → beautiful）
        case 'adj':
          return has('n', 'v')
    // 副词化：形容词能带（quick → quickly）
        case 'adv':
          return has('a')
    // 动词化：名词与形容词能带（modern → modernize / soft → soften）
        case 'verb':
          return has('n', 'a')
    // 屈折（比较级/最高级）：只有形容词能带
        case 'inflection':
          return has('a', 'ad')
        default:
          return false
      }
    }

/**
 * 从词条里取变位形式。
 *
 * 词条槽位里那个字符串形如 `p:ran/i:running/s:runs`。这里只取词形本身。
 *
 * @param {any[]} entry - dict.dat 里的槽位数组
 * @returns {string[]}
 */
    function inflectionsOf(entry) {
      if (!Array.isArray(entry)) return []
      const out = []
      for (let i = 5; i < entry.length; i += 1) {
        const slot = entry[i]
        if (typeof slot !== 'string') continue
        for (const part of slot.split('/')) {
          const colon = part.indexOf(':')
          if (colon <= 0) continue
          const form = part.slice(colon + 1).trim().toLowerCase()
          if (form) out.push(form)
        }
      }
      return out
    }

/**
 * 把一个词拆成「可能的词干」候选。
 *
 * 返回的是**去掉某个词缀后剩下的部分**，用于去词库里找同族。
 * 例如 `cuteness` → `cute`（去 -ness）。拼写变体（去 e、双写辅音）也生成。
 *
 * @param {string} word
 * @returns {Array<{ stem: string, suffix?: string, prefix?: string, kind: string }>}
 */
    function stemVariants(word) {
      const w = String(word ?? '').toLowerCase()
      if (w.length < 3) return []
      const out = []
      const push = (stem, extra) => {
    // 剩下少于 3 个字母的，多半是误拆（uncle → cle 就不该收）
        if (stem.length < 3 || stem === w) return
        if (out.some((item) => item.stem === stem && item.suffix === extra.suffix
          && item.prefix === extra.prefix)) return
        out.push({ stem, kind: 'derived', ...extra })
      }

      for (const rule of SUFFIX_RULES) {
        if (!w.endsWith(rule.suffix)) continue
        const raw = w.slice(0, -rule.suffix.length)
        push(raw, { suffix: rule.suffix, kind: rule.kind })
    // 去双写辅音：running → runn → run
        if (raw.length >= 2 && raw[raw.length - 1] === raw[raw.length - 2]) {
          push(raw.slice(0, -1), { suffix: rule.suffix, kind: rule.kind })
        }
    // y→i 的变形：happy → happi(ness) 要还原成 happy
        if (raw.endsWith('i')) push(raw.slice(0, -1) + 'y', { suffix: rule.suffix, kind: rule.kind })
    // 补 e：cuteness → cut + ness，实际词干是 cute
        push(raw + 'e', { suffix: rule.suffix, kind: rule.kind })
      }

      for (const rule of PREFIX_RULES) {
        if (!w.startsWith(rule.prefix)) continue
        const rest = w.slice(rule.prefix.length)
    // 前缀后面至少还要 3 个字母，否则像 uncle 会被拆成 un + cle
        if (rest.length < 3) continue
    // 词干必须能独立成词的样子：以元音开头，或以常见辅音簇开头。
    //
    // 还要挡掉「辅音簇 + le」这种形态：cle / ple / tle / dle 都不是能独立成词的词干，
    // 它们出现在 uncle / apple / little / candle 里。判据：以 le 结尾且去掉 le 后
    // 只剩辅音的，一律不收。
        const consonantOnlyStem = /^[bcdfghjklmnpqrstvwxz]+le$/.test(rest)
        if (consonantOnlyStem) continue
        if (!/^[aeiou]|^(bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tr|tw|th|ch|sh|wh|ph|qu)/.test(rest)) continue
        push(rest, { prefix: rule.prefix, kind: 'prefix' })
      }

      return out
    }

/**
 * 在词库里找一个词的同根词。
 *
 * @param {object} dict - loadDictionary 的产物（含 entries）
 * @param {string} head - 当前词头
 * @returns {{
 *   inflections: string[],
 *   derived: Array<{ word: string, reason: string }>
 * }}
 */
    function familyOf(dict, head) {
      const entries = dict?.entries ?? {}
      const key = String(head ?? '').toLowerCase()
      const result = { inflections: [], derived: [] }
      if (key === '' || !Object.prototype.hasOwnProperty.call(entries, key)) return result

  // 一、变位：词条自带的
      const own = inflectionsOf(entries[key])
      for (const form of own) {
        if (form !== key) result.inflections.push(form)
      }

  // 二、同根派生：向两个方向找
      const seen = new Set([key, ...result.inflections])
      const addDerived = (word, reason) => {
        if (!word || word === key || seen.has(word)) return
        if (!Object.prototype.hasOwnProperty.call(entries, word)) return
        seen.add(word)
        result.derived.push({ word, reason })
      }

  // 方向 A：当前词去掉词缀 → 得到词干，词干也是同族
      for (const variant of stemVariants(key)) {
        addDerived(variant.stem, variant.suffix ? `-${variant.suffix}` : `${variant.prefix}-`)
      }

  // 方向 B：给当前词加词缀 → 看词库里有没有
  //
  // 这一方向最容易造假词：care + -en = careen（实际是「倾斜」），
  // care + -er = career（实际是「职业」）。所以只允许**语义上真能派生**的组合，
  // 判断依据是当前词在词库里有哪些词性（从义项组的词性前缀读）。
      const posSet = posOf(entries[key])
      const stemChars = zhChars(entries[key])
      for (const rule of SUFFIX_RULES) {
        if (!canTakeSuffix(posSet, rule)) continue
        const bases = [key]
    // cute → cuteness 要补 e；run → running 要双写
        if (key.endsWith('e')) bases.push(key.slice(0, -1))
        if (key.length >= 3 && !/[aeiou]$/.test(key)) bases.push(key + key[key.length - 1])
    // happy → happiness 要 y→i
        if (key.endsWith('y')) bases.push(key.slice(0, -1) + 'i')
        for (const base of bases) {
          const candidate = base + rule.suffix
      // 语义闸门：候选词的中文释义里必须至少出现一个词干的字。
      // care + -er = career，「职业」与「关心」毫无关系，会被这道闸门挡掉；
      // care + -ful = careful，「仔细的」含「心」的近义，能通过。
          if (!sharesMeaning(candidate, stemChars, entries)) continue
          addDerived(candidate, `-${rule.suffix}`)
        }
      }
  // 前缀方向：只给动词与形容词加（unhappy / rewrite 这类），名词加前缀误判率高
      if (posSet.has('a') || posSet.has('v') || posSet.has('ad')) {
        for (const rule of PREFIX_RULES) {
          const candidate = rule.prefix + key
          if (!sharesMeaning(candidate, stemChars, entries)) continue
          addDerived(candidate, `${rule.prefix}-`)
        }
      }

  // 三、排序：短的在前（更可能是核心派生词），最多 12 个
      result.derived.sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word))
      result.derived = result.derived.slice(0, 12)
      return result
    }

      return { inflectionsOf, stemVariants, familyOf }
    })()

    // ═══ wordbook.js ═══
    var __mod_wordbook = (function () {
      var { normalizeKey } = __mod_word
/**
 * wordbook.js —— 生词本的数据层。
 *
 * 两种存储，按优先级：
 *   1. 宿主 `storage` 服务的 KV（落磁盘，换浏览器/清缓存都不丢）；
 *   2. localStorage（没有 storage 服务时兜底）。
 *
 * 为什么先试宿主：生词本是用户长期积累的东西，丢了比不能存更糟。
 *
 * 词条形状（存进 KV 的就是这个）：
 *   {
 *     head: 'cute',         词头（小写）
 *     addedAt: 1698800000000,
 *     source: 'dsh' | 'youdao' | 'manual',
 *     note: '',
 *     review: { seen: 3, lastSeenAt: 1698800000000 }
 *   }
 *
 * 只存词头不存释义 —— 释义在离线词库里，存两份会不一致。
 */


/** KV 表名与单元名。改这两个值等于让老用户丢生词，别动。 */
    const UNIT_NAME = 'dsh-hover-dict'
    const UNIT_VERSION = 1
    const TABLE = 'words'

/** localStorage 的兜底键。 */
    const FALLBACK_KEY = 'dsh-hover-dict:wordbook'

/**
 * 生词本的内存镜像 + 落盘。
 *
 * @typedef {object} WordbookEntry
 * @property {string} head
 * @property {number} addedAt
 * @property {string} source
 * @property {string} note
 * @property {{ seen: number, lastSeenAt: number }} review
 */

/**
 * 造一个生词本。
 *
 * @param {object} options
 * @param {object} [options.storage] 宿主的 storage 服务（可选）
 * @param {Storage} [options.local] localStorage（可选，两者都没有就只在内存里）
 * @returns {{
 *   ready: () => Promise<void>,
 *   has: (word: string) => boolean,
 *   get: (word: string) => WordbookEntry | undefined,
 *   add: (word: string, source?: string) => Promise<boolean>,
 *   remove: (word: string) => Promise<boolean>,
 *   toggle: (word: string) => Promise<boolean>,
 *   touch: (word: string) => Promise<void>,
 *   list: () => WordbookEntry[],
 *   importMany: (words: string[], source: string) => Promise<number>,
 *   size: () => number,
 *   subscribe: (fn: () => void) => () => void,
 * }}
 */
    function createWordbook(options) {
      const local = options?.local
      const hostStorage = options?.storage

  /** @type {Map<string, WordbookEntry>} */
      const words = new Map()
      const listeners = new Set()
      let unit = null
      let readyPromise = null

      const emit = () => {
        for (const listener of listeners) {
          try { listener() } catch { /* ignore */ }
        }
      }

  /** 把一条记录写进内存镜像。KV 里可能有多余字段，按形状挑。 */
      const adopt = (key, value) => {
        const head = normalizeKey(key)
        if (!head) return
        const record = value && typeof value === 'object' ? value : {}
        const review = record.review && typeof record.review === 'object' ? record.review : {}
        words.set(head, {
          head,
          addedAt: Number.isFinite(record.addedAt) ? record.addedAt : Date.now(),
          source: typeof record.source === 'string' ? record.source : 'dsh',
          note: typeof record.note === 'string' ? record.note : '',
          review: {
            seen: Number.isFinite(review.seen) ? review.seen : 0,
            lastSeenAt: Number.isFinite(review.lastSeenAt) ? review.lastSeenAt : 0,
          },
        })
      }

  /** 打开宿主 KV。拿不到就返回 null，让上层走 localStorage。 */
      const openUnit = async () => {
        if (!hostStorage) return null
        try {
          const kv = hostStorage.backend?.get?.('kv') ?? hostStorage.backend?.get?.('local')
          if (!kv || typeof kv.open !== 'function') return null
          return await kv.open({
            name: UNIT_NAME,
            version: UNIT_VERSION,
            tables: [TABLE],
            hasGlobal: false,
            layout: 'per-record',
          })
        } catch {
          return null
        }
      }

  /** 从 localStorage 读。读坏了当作空，不要让整本生词本打不开。 */
      const loadLocal = () => {
        if (!local || typeof local.getItem !== 'function') return
        let raw = null
        try {
          raw = local.getItem(FALLBACK_KEY)
        } catch {
          return
        }
        if (typeof raw !== 'string' || raw === '') return
        try {
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return
          for (const item of parsed) {
            if (item && typeof item.head === 'string') adopt(item.head, item)
          }
        } catch { /* 坏数据当作空 */ }
      }

      const saveLocal = () => {
        if (!local || typeof local.setItem !== 'function') return
        try {
          local.setItem(FALLBACK_KEY, JSON.stringify([...words.values()]))
        } catch { /* 配额满就放弃，内存里还有 */ }
      }

  /** 写一条到 KV。失败不抛 —— 内存镜像已经更新，界面不该因为写盘失败而报错。 */
      const persist = async (head) => {
        const entry = words.get(head)
        if (!unit || !entry) return
        try {
          await unit.putRecord(TABLE, head, entry)
        } catch { /* 写盘失败，内存里仍在 */ }
      }

      const dropPersist = async (head) => {
        if (!unit) return
        try {
          await unit.deleteRecord(TABLE, head)
        } catch { /* ignore */ }
      }

      return {
        async ready() {
          if (readyPromise) return readyPromise
          readyPromise = (async () => {
            unit = await openUnit()
            if (unit) {
              try {
                const loaded = await unit.loadAll()
                const rows = loaded?.tables?.[TABLE]
                if (rows && typeof rows === 'object') {
                  for (const [key, value] of Object.entries(rows)) adopt(key, value)
                }
              } catch {
            // KV 读失败：退到 localStorage，至少还有一份
                loadLocal()
              }
            } else {
              loadLocal()
            }
            emit()
          })()
          return readyPromise
        },

        has(word) {
          const head = normalizeKey(word)
          return head !== '' && words.has(head)
        },

        get(word) {
          const head = normalizeKey(word)
          return head === '' ? undefined : words.get(head)
        },

        async add(word, source = 'dsh') {
          const head = normalizeKey(word)
          if (!head) return false
          if (words.has(head)) return false
          words.set(head, {
            head,
            addedAt: Date.now(),
            source,
            note: '',
            review: { seen: 0, lastSeenAt: 0 },
          })
          await persist(head)
          saveLocal()
          emit()
          return true
        },

        async remove(word) {
          const head = normalizeKey(word)
          if (!head || !words.has(head)) return false
          words.delete(head)
          await dropPersist(head)
          saveLocal()
          emit()
          return true
        },

        async toggle(word) {
          const head = normalizeKey(word)
          if (!head) return false
          if (words.has(head)) {
            await this.remove(head)
            return false
          }
          await this.add(head)
          return true
        },

    /** 记录「这个词又被用户查了一次」。用于将来的复习排序。 */
        async touch(word) {
          const head = normalizeKey(word)
          const entry = head === '' ? undefined : words.get(head)
          if (!entry) return
          entry.review.seen += 1
          entry.review.lastSeenAt = Date.now()
          await persist(head)
          saveLocal()
        },

        list() {
          return [...words.values()].sort((a, b) => b.addedAt - a.addedAt)
        },

        size() {
          return words.size
        },

    /**
     * 批量导入。用于从有道等平台导入生词表。
     *
     * @param {string[]} list 单词数组
     * @param {string} source 来源标识
     * @returns {Promise<number>} 真正新增的条数（已存在的跳过）
     */
        async importMany(list, source) {
          if (!Array.isArray(list)) return 0
          let added = 0
          for (const raw of list) {
            const head = normalizeKey(String(raw ?? ''))
            if (!head || head.length < 1 || head.length > 64) continue
        // 只收像英文单词的：字母开头，允许撇号与连字符
            if (!/^[a-z][a-z'-]*$/.test(head)) continue
            if (words.has(head)) continue
            words.set(head, {
              head,
              addedAt: Date.now(),
              source: typeof source === 'string' ? source : 'import',
              note: '',
              review: { seen: 0, lastSeenAt: 0 },
            })
            await persist(head)
            added += 1
          }
          if (added > 0) {
            saveLocal()
            emit()
          }
          return added
        },

        subscribe(listener) {
          if (typeof listener !== 'function') return () => {}
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

/**
 * 解析用户粘贴的导入文本。
 *
 * 有道、欧路、百词斩导出的格式各不相同，但共同点是：一行一个词，
 * 后面可能跟音标、释义、标签，用空格/Tab/逗号隔开。
 * 所以只取每行**第一个形如英文单词的片段**，其余丢掉。
 *
 * 也能处理 CSV（取第一列）和纯词表（一行一词）。
 *
 * @param {string} text
 * @returns {string[]} 去重后的单词数组
 */
    function parseImportText(text) {
      if (typeof text !== 'string' || text.trim() === '') return []
      const out = []
      const seen = new Set()
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed === '') continue
    // 跳过表头（如 "单词,音标,释义"）与注释
        if (/^#/.test(trimmed)) continue
    // 取第一段分隔出来的内容
        const first = trimmed.split(/[\t,;]|\s{2,}/)[0]?.trim() ?? ''
        const candidate = (first || trimmed).split(/\s+/)[0]?.replace(/^["']|["']$/g, '') ?? ''
        const head = normalizeKey(candidate)
        if (!/^[a-z][a-z'-]{0,63}$/.test(head)) continue
        if (seen.has(head)) continue
        seen.add(head)
        out.push(head)
      }
      return out
    }

      return { createWordbook, parseImportText }
    })()

    // ═══ anchor.js ═══
    var __mod_anchor = (function () {
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
    function nodeIdentity(node) {
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
    function anchorOf(hit, options) {
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
    function isAnchorStale(anchor, options) {
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
    function sameWord(a, b) {
      if (!a || !b) return false
      return a.key === b.key
    }

      return { nodeIdentity, anchorOf, isAnchorStale, sameWord }
    })()

    // ═══ position.js ═══
    var __mod_position = (function () {
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
    function computePopoverPlacement(input) {
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
    function computeCardPlacement(input) {
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
    function unionRect(rects) {
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
    function containsPoint(x, y, rect, pad) {
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
    function computeOverlayRect(kind, input) {
      return kind === 'card' ? computeCardPlacement(input) : computePopoverPlacement(input)
    }

      return { computePopoverPlacement, computeCardPlacement, unionRect, containsPoint, computeOverlayRect }
    })()

    // ═══ overlay.js ═══
    var __mod_overlay = (function () {
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
    const UI_ATTR = 'data-hover-dict-ui'

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
    function ensureStyle(doc) {
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
    function PopoverBody(props) {
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
    function StatusNote(props) {
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
    function PhraseBody(props) {
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

      return { UI_ATTR, ensureStyle, PopoverBody, StatusNote, PhraseBody }
    })()

    // ═══ drag.js ═══
    var __mod_drag = (function () {
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
    const VIEWPORT_PAD = 8

/** 拖动把手的判定：手指/鼠标移动超过这个距离才算拖，否则当点击。 */
    const DRAG_THRESHOLD_PX = 3

/**
 * 把位置夹进视口。
 *
 * @param {{ top: number, left: number }} pos
 * @param {{ width: number, height: number }} size 卡片尺寸
 * @param {{ width: number, height: number }} viewport
 * @returns {{ top: number, left: number }}
 */
    function clampToViewport(pos, size, viewport) {
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
    function dragPosition(origin, start, current, size, viewport) {
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
    function attachDrag(options) {
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

      return { VIEWPORT_PAD, DRAG_THRESHOLD_PX, clampToViewport, dragPosition, attachDrag }
    })()

    // ═══ ui.js ═══
    var __mod_ui = (function () {
/**
 * ui.js —— 一套共用的设计原语。
 *
 * 为什么要有这个文件：设置页 `settings.section` 的宿主容器是**裸壳子**
 * （没底色、没内边距、没圆角），所以层级只能在自己这一层造出来。
 * 之前我把颜色、间距、字号散在各处手搓，结果：
 *   1. 用了四个宿主根本没提供的 token（吸了 `bg-layer-3`、`label-tertiary` 等），
 *      而 CSS 的 var() 取不到值又不给备用值时，**整条声明作废**，
 *      按钮和输入框于是变成「没有边框的一行字」——这就是「简陋」的真正原因；
 *   2. 字号散成 13.5 / 13 / 12.5 / 12 / 11.5 五档，没有标度。
 *
 * 现在的约定：
 *   - 颜色一律走宿主给的 14 个 `--dsw-alias-*`，**每条都给备用值**；
 *   - 字号只有三档（TITLE / BODY / SMALL）；
 *   - 间距只有四档（GAP_XS / GAP_SM / GAP_MD / GAP_LG）；
 *   - 所有可交互件都带 `aria-*`，键盘可达。
 *
 * 同一宿主槽里别的插件（例如「大肥鱼的后台」）也在手搓自己的样式。
 * 这份原语本来就打算给两家共用：谁要用，把这个文件复制过去，
 * 在插件入口调一次 `makePrimitives(React.createElement)` 即可。
 *
 * 为什么用工厂而不是直接导出组件：这份代码跑在宿主的模块表里，
 * 拿不到顶层 import 的 React。`h` 必须由调用方在运行期注入，
 * 所以组件在工厂里闭包生成。
 */

/* ── 字号标度：三档，不再散 ─────────────────────────────────────────── */
    const FS = Object.freeze({
      title: 15,
      body: 13,
      small: 11.5,
    })

/* ── 间距标度：四档 ─────────────────────────────────────────────────── */
    const GAP = Object.freeze({
      xs: 6,
      sm: 10,
      md: 16,
      lg: 24,
    })

/* ── 圆角 ───────────────────────────────────────────────────────────── */
    const RADIUS = Object.freeze({
      sm: 7,
      md: 10,
      lg: 14,
      pill: 999,
    })

/**
 * 主题色。
 *
 * 键名与宿主 token 一一对应，**值里已经带好备用值**——调用方直接拿去当
 * style 用，不要再自己写一遍 var()。备用值取的是深色主题下能看的半透明白，
 * 宿主 token 在就优先用 token。
 */
    const C = Object.freeze({
      text: 'var(--dsw-alias-label-primary, #e8e8e8)',
      textDim: 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.66))',
      textFaint: 'var(--dsw-alias-label-secondary, rgba(255,255,255,0.48))',
      bgBase: 'var(--dsw-alias-bg-base, rgba(255,255,255,0.03))',
      bg1: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.06))',
      bg2: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.09))',
      overlay: 'var(--dsw-alias-bg-overlay, rgba(255,255,255,0.10))',
      border1: 'var(--dsw-alias-border-l1, rgba(255,255,255,0.12))',
      border2: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.20))',
      accent: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      danger: 'var(--dsw-alias-state-error-primary, #e5484d)',
      success: 'var(--dsw-alias-state-success-primary, #2f9e44)',
      warn: 'var(--dsw-alias-state-warn-primary, #f0a441)',
      idle: 'var(--dsw-alias-state-idle-primary, rgba(255,255,255,0.4))',
    })

/* ── 动效曲线 ───────────────────────────────────────────────────────── */
    const EASE = Object.freeze({
  /** 快出缓停：适合位移与展开 */
      out: 'cubic-bezier(.16,1,.3,1)',
  /** 轻微过冲：适合开关与按下回弹 */
      settle: 'cubic-bezier(.34,1.4,.4,1)',
    })

/**
 * 把若干 style 对象合成一个，过滤掉假值。
 *
 * 不用 Object.assign 是因为调用点常常是 `[base, cond && extra]` 这种，
 * 里面会有 false / null / undefined。
 *
 * @param {...(object|false|null|undefined)} parts
 * @returns {object}
 */
    function sx(...parts) {
      const out = {}
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue
        for (const [key, value] of Object.entries(part)) {
          if (value !== undefined && value !== null && value !== false) out[key] = value
        }
      }
      return out
    }

/** 一段说明文字。 */
    function hintStyle() {
      return {
        margin: 0,
        fontSize: FS.small,
        lineHeight: 1.85,
        color: C.textDim,
      }
    }

/**
 * 分区卡。
 *
 * 宿主给的容器是裸的，所以每块内容自己带一张卡片：
 * 细边框 + 分层底色 + 顶部内高光 + 圆角。
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.hint]
 * @param {import('react').ReactNode} [props.action] 标题右侧的操作区
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
      function Card(props) {
      return h('section', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          borderRadius: RADIUS.lg,
          border: `1px solid ${C.border1}`,
          background: C.bg2,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
          overflow: 'hidden',
        },
        'aria-label': typeof props.title === 'string' ? props.title : undefined,
      }, [
        h('div', {
          key: 'head',
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: GAP.sm,
            padding: `${GAP.md - 1}px ${GAP.md + 2}px ${GAP.sm + 3}px`,
            borderBottom: `1px solid ${C.border1}`,
            background: C.bg1,
          },
        }, [
          h('div', { key: 'tw', style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 } }, [
            h('h3', {
              key: 't',
              style: { margin: 0, fontSize: FS.title, fontWeight: 680, lineHeight: 1.5, color: C.text },
            }, props.title),
            props.hint ? h('p', { key: 'h', style: hintStyle() }, props.hint) : null,
          ]),
          props.action ? h('div', { key: 'a', style: { flex: 'none' } }, props.action) : null,
        ]),
        h('div', {
          key: 'body',
          style: { display: 'flex', flexDirection: 'column', gap: GAP.md, padding: `${GAP.md}px ${GAP.md + 2}px` },
        }, props.children),
      ])
    }

/**
 * 按钮。
 *
 * 视觉：细边 + 顶高光 + 悬停时一条斜向高光扫过 + 按下缩到 .985 并加内阴影。
 * 立体感来自「按下去看得见」这一下的反馈，不是靠堆渐变。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {'default'|'primary'|'ghost'|'danger'} [props.variant]
 * @param {'sm'|'md'} [props.size]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.busy] 进行中：显示转圈并禁用
 * @param {() => void} props.onClick
 * @returns {import('react').ReactElement}
 */
      function Button(props) {
      const variant = props.variant ?? 'default'
      const small = props.size === 'sm'
      const disabled = props.disabled === true || props.busy === true

      const paint = {
        default: { background: C.bg1, color: C.text, border: C.border2 },
        primary: { background: C.accent, color: '#fff', border: 'transparent' },
        ghost: { background: 'transparent', color: C.textDim, border: 'transparent' },
        danger: { background: 'transparent', color: C.danger, border: `color-mix(in srgb, ${C.danger} 55%, transparent)` },
      }[variant]

      return h('button', {
        type: 'button',
        disabled,
        'aria-busy': props.busy === true ? 'true' : undefined,
        onClick: disabled ? undefined : props.onClick,
        style: {
          position: 'relative',
          overflow: 'hidden',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: GAP.xs,
          minHeight: small ? 28 : 32,
          padding: small ? '4px 12px' : '6px 16px',
          borderRadius: small ? RADIUS.sm : 9,
          border: `1px solid ${paint.border}`,
          background: paint.background,
          boxShadow: variant === 'ghost' ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
          color: disabled ? C.textFaint : paint.color,
          font: 'inherit',
          fontSize: small ? FS.small : 12.5,
          fontWeight: 580,
          lineHeight: 1.4,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          whiteSpace: 'nowrap',
          transition: 'transform .16s cubic-bezier(.34,1.4,.4,1), border-color .2s, background .2s, box-shadow .2s',
          WebkitTapHighlightColor: 'transparent',
        },
      }, props.busy
        ? h('span', { key: 's', 'aria-hidden': 'true', style: { fontSize: FS.small, opacity: 0.8 } }, '处理中…')
        : props.label)
    }

/**
 * 开关。
 *
 * 结构是 track + 滑块两层，滑块用 spring 曲线回弹。
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} [props.label]
 * @returns {import('react').ReactElement}
 */
      function Switch(props) {
      const on = props.checked === true
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': props.label,
        onClick: () => props.onChange(!on),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          padding: 0,
          border: 0,
          background: 'transparent',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        },
      }, [
        h('span', {
          key: 'track',
          'aria-hidden': 'true',
          style: {
            position: 'relative',
            width: 38,
            height: 21,
            flex: 'none',
            borderRadius: RADIUS.pill,
            border: `1px solid ${on ? 'transparent' : C.border2}`,
            background: on ? C.accent : C.bg1,
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.18)',
            transition: `background .22s ${EASE.out}, border-color .22s ${EASE.out}`,
          },
        }, h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: 2,
            width: 15,
            height: 15,
            borderRadius: '50%',
            background: on ? '#fff' : C.textFaint,
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transform: on ? 'translateX(17px)' : 'translateX(0)',
            transition: `transform .28s ${EASE.settle}, background .2s ${EASE.out}`,
          },
        })),
        props.label
          ? h('span', { key: 'l', style: { fontSize: FS.body, lineHeight: 1.7, color: C.text } }, props.label)
          : null,
      ])
    }

/**
 * 文本框 / 多行框。
 *
 * 常态是「凹槽」手感（内阴影），focus 只换边色 + 外发光，凹槽不动。
 *
 * @param {object} props
 * @param {string} [props.value]
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {boolean} [props.multiline]
 * @param {'text'|'number'|'search'} [props.type]
 * @param {object} [props.style]
 * @returns {import('react').ReactElement}
 */
      function Input(props) {
      const base = {
        font: 'inherit',
        fontSize: FS.body,
        padding: '8px 12px',
        borderRadius: 9,
        border: `1px solid ${C.border2}`,
        background: C.bgBase,
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.16)',
        color: C.text,
        minWidth: 0,
        width: '100%',
        outline: 'none',
        transition: `border-color .18s ${EASE.out}, box-shadow .2s ${EASE.out}`,
      }
      const shared = {
        value: props.value ?? '',
        placeholder: props.placeholder,
        onChange: (event) => props.onChange(event.target.value),
        onFocus: (event) => {
          event.currentTarget.style.borderColor = C.accent
          event.currentTarget.style.boxShadow = `inset 0 1px 2px rgba(0,0,0,0.12), 0 0 0 3px color-mix(in srgb, ${C.accent} 18%, transparent)`
        },
        onBlur: (event) => {
          event.currentTarget.style.borderColor = C.border2
          event.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.16)'
        },
      }

      if (props.multiline === true) {
        return h('textarea', {
          ...shared,
          style: sx(base, {
            minHeight: 128,
            lineHeight: 1.85,
            resize: 'vertical',
            fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
            fontSize: FS.small,
          }, props.style),
        })
      }
      return h('input', {
        ...shared,
        type: props.type ?? 'text',
        style: sx(base, props.style),
      })
    }

/**
 * 下拉选择。
 *
 * @param {object} props
 * @param {string} props.value
 * @param {Array<{ value: string, label: string }>} props.options
 * @param {(value: string) => void} props.onChange
 * @returns {import('react').ReactElement}
 */
      function Select(props) {
      return h('select', {
        value: props.value,
        onChange: (event) => props.onChange(event.target.value),
        style: {
          font: 'inherit',
          fontSize: FS.body,
          padding: '8px 12px',
          borderRadius: 9,
          border: `1px solid ${C.border2}`,
          background: C.bgBase,
          color: C.text,
          cursor: 'pointer',
          outline: 'none',
        },
      }, (props.options ?? []).map((option) => h('option', {
        key: option.value,
        value: option.value,
      }, option.label)))
    }

/**
 * 标签。用于状态徽章。
 *
 * @param {object} props
 * @param {string} props.text
 * @param {'neutral'|'accent'|'success'|'danger'|'warn'} [props.tone]
 * @returns {import('react').ReactElement}
 */
      function Badge(props) {
      const tone = props.tone ?? 'neutral'
      const paint = {
        neutral: { color: C.textFaint, border: C.border2 },
        accent: { color: C.accent, border: `color-mix(in srgb, ${C.accent} 45%, transparent)` },
        success: { color: C.success, border: `color-mix(in srgb, ${C.success} 45%, transparent)` },
        danger: { color: C.danger, border: `color-mix(in srgb, ${C.danger} 45%, transparent)` },
        warn: { color: C.warn, border: `color-mix(in srgb, ${C.warn} 45%, transparent)` },
      }[tone]

      return h('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          padding: '1px 8px',
          borderRadius: RADIUS.pill,
          border: `1px solid ${paint.border}`,
          fontSize: 10.5,
          fontWeight: 500,
          lineHeight: 1.7,
          color: paint.color,
          whiteSpace: 'nowrap',
        },
      }, props.text)
    }

/**
 * 提示条。四种语气。
 *
 * @param {object} props
 * @param {string} props.text
 * @param {'info'|'ok'|'err'|'warn'} [props.tone]
 * @param {import('react').ReactNode} [props.action]
 * @returns {import('react').ReactElement}
 */
      function Note(props) {
      const tone = props.tone ?? 'info'
      const paint = {
        info: { color: C.textDim, border: C.border1, bg: 'transparent' },
        ok: { color: C.success, border: `color-mix(in srgb, ${C.success} 45%, transparent)`, bg: `color-mix(in srgb, ${C.success} 9%, transparent)` },
        err: { color: C.danger, border: `color-mix(in srgb, ${C.danger} 45%, transparent)`, bg: `color-mix(in srgb, ${C.danger} 9%, transparent)` },
        warn: { color: C.warn, border: `color-mix(in srgb, ${C.warn} 45%, transparent)`, bg: `color-mix(in srgb, ${C.warn} 9%, transparent)` },
      }[tone]

      return h('div', {
        role: tone === 'err' ? 'alert' : undefined,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: GAP.sm,
          padding: '10px 13px',
          borderRadius: RADIUS.md,
          border: `1px solid ${paint.border}`,
          background: paint.bg,
          fontSize: FS.small,
          lineHeight: 1.8,
          color: paint.color,
        },
      }, [
        h('span', { key: 't', style: { flex: 1, minWidth: 0 } }, props.text),
        props.action ? h('span', { key: 'a', style: { flex: 'none' } }, props.action) : null,
      ])
    }

/**
 * 设置行：标签在上，控件在下。
 *
 * 上下排列而不是左右两列，是因为设置页的容器宽度不确定；
 * 左右两列在窄容器里会把标签挤断行。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
      function Field(props) {
      return h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: GAP.xs + 2 },
      }, [
        h('div', { key: 'l', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
          h('span', { key: 't', style: { fontSize: 12.5, lineHeight: 1.7, color: C.textDim } }, props.label),
          props.hint ? h('span', { key: 'h', style: hintStyle() }, props.hint) : null,
        ]),
        h('div', { key: 'c', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, props.children),
      ])
    }

/**
 * 页面头：标题 + 一句话说明 + 可选的状态徽章/数字。
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.desc]
 * @param {import('react').ReactNode} [props.extra]
 * @returns {import('react').ReactElement}
 */
      function PageHeader(props) {
      return h('header', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: GAP.sm,
          padding: `2px 2px ${GAP.md + 4}px`,
          borderBottom: `1px solid ${C.border1}`,
        },
      }, [
        h('div', { key: 'line', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h('h2', {
            key: 't',
            style: { margin: 0, fontSize: 20, fontWeight: 680, letterSpacing: '-.3px', lineHeight: 1.4, color: C.text },
          }, props.title),
          props.extra ? h('span', { key: 'x', style: { display: 'inline-flex', gap: GAP.xs, flexWrap: 'wrap' } }, props.extra) : null,
        ]),
        props.desc ? h('p', { key: 'd', style: sx(hintStyle(), { maxWidth: '58ch' }) }, props.desc) : null,
      ])
    }

/**
 * 页面根容器：居中、限宽、统一的纵向节奏。
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.children
 * @returns {import('react').ReactElement}
 */
      function Page(props) {
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: GAP.md + 2,
          maxWidth: 820,
          marginInline: 'auto',
          width: '100%',
          padding: '4px 0 32px',
          fontSize: FS.body,
          lineHeight: 1.8,
          color: C.text,
          WebkitFontSmoothing: 'antialiased',
        },
      }, props.children)
    }

/**
 * 造一套原语。
 *
 * @param {Function} h React.createElement（由插件入口从 `require('react')` 拿到）
 * @returns {{
 *   Card: Function, Button: Function, Switch: Function, Input: Function,
 *   Select: Function, Badge: Function, Note: Function, Field: Function,
 *   PageHeader: Function, Page: Function,
 *   FS: object, GAP: object, RADIUS: object, C: object, EASE: object, sx: Function, hintStyle: Function,
 * }}
 */
    function makePrimitives(h) {
      if (typeof h !== 'function') {
        throw new TypeError('makePrimitives 需要 React.createElement')
      }
      return {
        Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page,
        FS, GAP, RADIUS, C, EASE, sx, hintStyle,
      }
    }

      return { FS, GAP, RADIUS, C, EASE, sx, hintStyle, makePrimitives }
    })()

    // ═══ settings.js ═══
    var __mod_settings = (function () {
      var { loadUx, saveUx, DEFAULT_TIMING } = __mod_config
      var { makePrimitives } = __mod_ui
      var { parseImportText } = __mod_wordbook
/**
 * settings.js —— 插件设置面板（挂在 Plugins 页的插件详情里）。
 *
 * 四块：
 *   1. 翻译接口：选 google / bing / 关闭
 *   2. 离线词库：显示当前版本与体积，可重新下载
 *   3. 生词本：显示数量、导入、导出、清空
 *   4. 交互参数：悬停释义条数、卡片宽度这些
 *
 * 所有设置存在 localStorage，不走宿主 Config —— 这些是界面偏好，
 * 为了让用户改一个数字去重启宿主是不合理的。
 */


/** 设置面板的样式。 */
    const CSS = `
/* ═══════════════════════════════════════════════════════════════════════
   英语翻译设置 · 视觉系统
   参照 dsh-get-it-for-free 的 ofm 设计语言：
   分层用 --dsw-alias-bg-layer-1/2/3，按钮用细边 + 内高光 + 悬停扫光，
   卡片带拉丝细纹底与外投影。昼夜由宿主切换，这里不写死颜色。
   ═══════════════════════════════════════════════════════════════════════ */

/** 字号标度：三档，不再散成五档 */
    .hds-page {
      --ease-instrument: cubic-bezier(.16,1,.3,1);
      --ease-settle: cubic-bezier(.34,1.4,.4,1);
      --fs-title: 15px;
      --fs-body: 13px;
      --fs-small: 11.5px;
      display: flex;
      flex-direction: column;
      gap: 22px;
      max-width: 820px;
  /* 不通栏贴左：宽屏下居中，两侧留白 */
      margin-inline: auto;
      width: 100%;
      padding: 4px 0 32px;
      font-size: var(--fs-body);
      line-height: 1.8;
      color: var(--dsw-alias-label-primary, #1a1a1a);
      -webkit-font-smoothing: antialiased;
    }
    .hds-page * { box-sizing: border-box; }

/* ── 页面头 ──────────────────────────────────────────────────────────── */
    .hds-header {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 2px 2px 20px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
    }
    .hds-header-line {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .hds-header-icon { font-size: 20px; line-height: 1; }
    .hds-header-title {
      margin: 0;
      font-size: 20px;
      font-weight: 680;
      letter-spacing: -.3px;
      line-height: 1.4;
    }
    .hds-header-desc {
      margin: 0;
      max-width: 58ch;
      font-size: var(--fs-body);
      line-height: 1.85;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-header-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
    .hds-stat-chip {
      display: inline-flex;
      align-items: baseline;
      gap: 3px;
      padding: 4px 11px;
      border-radius: 999px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      font-size: var(--fs-small);
      line-height: 1.7;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-stat-chip b {
      font-size: 12.5px;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }

    .hds-root {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

/* ── 分区：一张卡片 ──────────────────────────────────────────────────── */
    .hds-section {
      display: flex;
      flex-direction: column;
      border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background:
        repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
        var(--dsw-alias-bg-layer-2, #ffffff);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
      overflow: hidden;
    }

    .hds-head {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 15px 18px 13px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
    }

    .hds-title {
      margin: 0;
      font-size: var(--fs-title);
      font-weight: 680;
      letter-spacing: -.15px;
      line-height: 1.5;
    }

    .hds-subtitle {
      margin: 0;
      font-size: var(--fs-body);
      font-weight: 650;
      line-height: 1.6;
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }

    .hds-hint {
      margin: 0;
      font-size: var(--fs-small);
      line-height: 1.9;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

    .hds-stack { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 18px; }
    .hds-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* 一行设置：标签在上、控件在下，留足垂直空间 */
    .hds-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 0;
    }
    .hds-field > .hds-label {
      font-size: 12.5px;
      line-height: 1.7;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

/* ── 按钮 ────────────────────────────────────────────────────────────── */
    .hds-btn {
      position: relative;
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 32px;
      padding: 6px 16px;
      border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
      color: var(--dsw-alias-label-primary, #1a1a1a);
      font: inherit;
      font-size: 12.5px;
      font-weight: 580;
      line-height: 1.4;
      cursor: pointer;
      white-space: nowrap;
      transition:
        transform .16s var(--ease-settle),
        border-color .2s var(--ease-instrument),
        background .2s var(--ease-instrument),
        box-shadow .2s var(--ease-instrument),
        opacity .16s ease;
      -webkit-tap-highlight-color: transparent;
    }

/* 悬停扫光：一条斜向高光从左侧滑过 */
    .hds-btn::after {
      content: "";
      position: absolute;
      top: 0; bottom: 0;
      left: -60%;
      width: 42%;
      background: linear-gradient(100deg, transparent, rgb(255 255 255 / 14%), transparent);
      transform: skewX(-18deg);
      transition: left .5s var(--ease-instrument);
      pointer-events: none;
    }
    .hds-btn:hover:not(:disabled)::after { left: 118%; }

    .hds-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 7%, var(--dsw-alias-bg-layer-2, #ffffff));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
    }

/* 按下：快速陷落 + 内阴影加深 */
    .hds-btn:active:not(:disabled) {
      transform: scale(.985);
      transition-duration: .09s;
      box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%);
    }

    .hds-btn:focus-visible {
      outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
      outline-offset: 2px;
    }

    .hds-btn:disabled { opacity: .45; cursor: default; box-shadow: none; transform: none; }
    .hds-btn:disabled::after { content: none; }

    .hds-btn-primary {
      background: linear-gradient(180deg,
        color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #fff),
        var(--dsw-alias-brand-primary, #4d6bfe));
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 82%, #000);
      color: var(--dsw-alias-label-primary, #fff);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%),
                  inset 0 -10px 18px -12px rgb(0 0 0 / 24%);
    }
    .hds-btn-primary:hover:not(:disabled) {
      background: linear-gradient(180deg,
        var(--dsw-alias-brand-primary, #4d6bfe),
        color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #000));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 26%),
                  inset 0 -10px 18px -12px rgb(0 0 0 / 18%);
    }

    .hds-btn-ghost {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-btn-ghost:hover:not(:disabled) {
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 80%, transparent);
      border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }
    .hds-btn-ghost::after { content: none; }

    .hds-btn-danger {
      border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 55%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      color: var(--dsw-alias-state-error-primary, #e5484d);
    }
    .hds-btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 8%, var(--dsw-alias-bg-layer-2, #ffffff));
      border-color: var(--dsw-alias-state-error-primary, #e5484d);
    }

    .hds-btn-sm { min-height: 28px; padding: 4px 12px; font-size: 11.5px; border-radius: 7px; }

/* ── 输入 ────────────────────────────────────────────────────────────── */
    .hds-input, .hds-select {
      font: inherit;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
                  inset 0 2px 6px -2px rgb(0 0 0 / 10%);
      color: var(--dsw-alias-label-primary, #1a1a1a);
      min-width: 0;
      transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
    }
    .hds-input:hover, .hds-select:hover {
      border-color: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, var(--dsw-alias-brand-primary, #4d6bfe));
    }
    .hds-input:focus, .hds-select:focus {
      outline: none;
      border-color: var(--dsw-alias-brand-primary, #4d6bfe);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
                  inset 0 2px 6px -2px rgb(0 0 0 / 8%),
                  0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
    }
    .hds-input[type="number"] { max-width: 110px; }

    .hds-textarea {
      width: 100%;
      min-height: 128px;
      font-family: var(--ds-font-family-code, ui-monospace, monospace);
      font-size: 12.5px;
      line-height: 1.85;
      padding: 12px 14px;
      border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
                  inset 0 2px 6px -2px rgb(0 0 0 / 10%);
      color: var(--dsw-alias-label-primary, #1a1a1a);
      resize: vertical;
      transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
    }
    .hds-textarea:focus {
      outline: none;
      border-color: var(--dsw-alias-brand-primary, #4d6bfe);
      box-shadow: inset 0 2px 6px -2px rgb(0 0 0 / 8%),
                  0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
    }

/* ── 开关：spring 滑块 ───────────────────────────────────────────────── */
    .hds-switch {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      cursor: pointer;
      user-select: none;
      appearance: none;
      background: transparent;
      border: 0;
      padding: 0;
      font: inherit;
      color: inherit;
      -webkit-tap-highlight-color: transparent;
    }

    .hds-switch-track {
      width: 38px;
      height: 21px;
      border-radius: 999px;
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%), inset 0 -1px 0 rgb(255 255 255 / 4%);
      position: relative;
      flex: none;
      transition: background .22s var(--ease-instrument),
                  border-color .22s var(--ease-instrument),
                  box-shadow .22s var(--ease-instrument);
    }

    .hds-switch-track::after {
      content: "";
      position: absolute;
      top: 2px; left: 2px;
      width: 15px; height: 15px;
      border-radius: 50%;
      background: var(--dsw-alias-label-primary, #1a1a1a);
      box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%);
      transition: transform .28s var(--ease-settle),
                  background .2s var(--ease-instrument),
                  width .14s var(--ease-instrument);
    }

    .hds-switch:active .hds-switch-track::after { width: 18px; }

    .hds-switch[aria-checked="true"] .hds-switch-track {
      background: var(--dsw-alias-brand-primary, #4d6bfe);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 85%, #000);
      box-shadow: inset 0 1px 3px rgb(0 0 0 / 14%), inset 0 -1px 0 rgb(255 255 255 / 8%);
    }
    .hds-switch[aria-checked="true"] .hds-switch-track::after {
      transform: translateX(17px);
      background: var(--dsw-alias-label-primary, #fff);
    }
    .hds-switch[aria-checked="true"]:active .hds-switch-track::after {
      transform: translateX(14px);
    }
    .hds-switch:focus-visible .hds-switch-track {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 22%, transparent);
    }

    .hds-switch-text { font-size: 13px; line-height: 1.7; }

/* ── 卡片 ────────────────────────────────────────────────────────────── */
    .hds-cards { display: flex; flex-direction: column; gap: 10px; }

    .hds-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 13px 15px;
      border-radius: 13px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  /* 拉丝细纹垫底：从边缘隐约透出，不做成显眼图案 */
      background:
        repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
        color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%),
                  inset 0 -12px 24px -16px rgb(0 0 0 / 14%);
      transition: transform .22s var(--ease-instrument),
                  box-shadow .26s var(--ease-instrument),
                  border-color .2s var(--ease-instrument);
    }

    .hds-card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 58%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 11%),
                  inset 0 -12px 24px -16px rgb(0 0 0 / 10%);
    }

    .hds-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

    .hds-card-name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 650;
      letter-spacing: -.1px;
      line-height: 1.55;
    }

    .hds-card-meta {
      font-size: 12px;
      line-height: 1.85;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

    .hds-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 500;
      line-height: 1.7;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .hds-badge-builtin {
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18));
    }
    .hds-badge-on {
      color: var(--dsw-alias-state-success-primary, #2f9e44);
      border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
    }

/* ── 生词本 chips ────────────────────────────────────────────────────── */
    .hds-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-height: 190px;
      overflow: auto;
      padding: 4px 2px 4px 0;
    }
    .hds-chips::-webkit-scrollbar { width: 10px; height: 10px; }
    .hds-chips::-webkit-scrollbar-track { background: transparent; }
    .hds-chips::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c5c5c) 32%, transparent);
      border-radius: 5px;
    }

    .hds-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      font-size: 12.5px;
      line-height: 1.7;
      transition: border-color .18s var(--ease-instrument), background .18s var(--ease-instrument);
    }
    .hds-chip:hover {
      border-color: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, var(--dsw-alias-brand-primary, #4d6bfe));
    }

    .hds-chip-x {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 19px; height: 19px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
      transition: background .16s ease, color .16s ease;
    }
    .hds-chip-x:hover {
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
      color: var(--dsw-alias-state-error-primary, #e5484d);
    }

/* ── 提示条 ──────────────────────────────────────────────────────────── */
    .hds-note {
      display: flex;
      gap: 9px;
      padding: 10px 13px;
      border-radius: 11px;
      border: 1px solid;
      font-size: 12px;
      line-height: 1.8;
    }
    .hds-note-ok {
      border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 9%, transparent);
    }
    .hds-note-err {
      border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 9%, transparent);
    }
    .hds-note-info {
      border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 70%, transparent);
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

    .hds-stat { font-variant-numeric: tabular-nums; font-weight: 600; }

    .hds-path {
      font-family: var(--ds-font-family-code, ui-monospace, monospace);
      font-size: 11.5px;
      line-height: 1.9;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      user-select: all;
    }

/* 减弱动效偏好：只留颜色反馈 */
    @media (prefers-reduced-motion: reduce) {
      .hds-root .hds-card:hover,
      .hds-root .hds-btn:hover:not(:disabled),
      .hds-root .hds-btn:active:not(:disabled) { transform: none; }
      .hds-root .hds-btn::after { content: none; }
    }
    `

/**
 * 设置面板组件。
 *
 * @param {object} props 宿主注入的 PropsRuntime，含 view 与 form
 * @returns {import('react').ReactElement | null}
 */
/** 生词本一次最多渲染多少个 chip。超出的用一句「还有 N 个」交代，不静默截断。 */
    const CHIP_LIMIT = 120

    function SettingsPanel(props) {
  // 只有当宿主**明确**说这是 summary 视图时才走摘要分支。
  // 不能写成 `view !== 'page'`：宿主在某些版本里可能根本不传 view，
  // 那样整个面板会一直显示成一行的摘要，用户以为没装。
      if (props?.view === 'summary') {
        return h('div', { className: 'hds-hint' }, '点选查词 · 生词本 · 离线词库')
      }

      const storage = safeLocal()
      const [ux, setUx] = useState(() => loadUx(storage))
      const [translator, setTranslator] = useState(() => readTranslator(storage))
      const [importText, setImportText] = useState('')
      const [message, setMessage] = useState(null)
      const [busy, setBusy] = useState('')
      const [dictInfo, setDictInfo] = useState(null)
      const [packs, setPacks] = useState(() => readPacks(storage))
      const [clearPending, setClearPending] = useState(false)

      const book = props?.wordbook
      const apiPrefix = props?.apiPrefix ?? '/api/dsh-hover-dict'
  // 词库包目录。宿主侧 dataDir 默认是包内 data/，这里写成用户能直接打开的绝对路径。
      const packsDir = props?.packsDir ?? '~/.dsh/profiles/desktop/node_modules/dsh-hover-dict/data/packs'

  // 首次挂载读词库元信息
      useEffect(() => {
        let alive = true
        fetch(`${apiPrefix}/meta.json`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { if (alive && data) setDictInfo(data) })
          .catch(() => { /* 拿不到就不显示 */ })
        return () => { alive = false }
      }, [apiPrefix])

      const patchAppearance = (key, value) => {
        saveUx(storage, { appearance: { ...ux.appearance, [key]: value } })
        setUx(loadUx(storage))
      }

      const say = (text, tone = 'ok') => setMessage({ text, tone })

      const onImport = () => {
        const words = parseImportText(importText)
        if (words.length === 0) { say('没有解析出任何单词', 'err'); return }
        if (!book) { say('生词本还没就绪', 'err'); return }
        setBusy('import')
        book.importMany(words, 'import').then((added) => {
          setBusy('')
          setImportText('')
          say(`导入完成：识别 ${words.length} 个，新增 ${added} 个（其余已存在）`)
        }).catch(() => { setBusy(''); say('导入失败', 'err') })
      }

      const onExport = () => {
        if (!book) return
        const text = book.list().map((item) => item.head).join('\n')
        try {
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `生词本-${new Date().toISOString().slice(0, 10)}.txt`
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
          say(`已导出 ${book.list().length} 个词`)
        } catch { say('导出失败', 'err') }
      }

  /**
   * 清空生词本。
   *
   * 用内联二次确认，不用原生对话框 —— 系统弹窗会打断页面观感，
   * 而且在设置页里弹一个原生弹窗像出错了。
   */
      const onClear = () => {
        if (!book) return
        const total = book.size()
        if (total === 0) { say('生词本已经是空的', 'info'); return }
        if (!clearPending) {
          setClearPending(true)
          say(`再点一次「确认清空」会删掉 ${total} 个生词，这个操作不能撤销。`, 'info')
          return
        }
        setClearPending(false)
        setBusy('clear')
        Promise.all(book.list().map((item) => book.remove(item.head))).then(() => {
          setBusy('')
          say('已清空')
        })
      }

  /** 下载/卸载一个词库包。数据来自宿主，按包名请求。 */
      const onTogglePack = (pack) => {
        if (pack.builtin) return
        setBusy(pack.id)
        const next = { ...packs }
        if (next[pack.id]) delete next[pack.id]
        else next[pack.id] = { installedAt: Date.now() }
        writePacks(storage, next)
        setPacks(next)
        setBusy('')
        say(next[pack.id] ? `已启用「${pack.name}」` : `已停用「${pack.name}」`)
      }

      const bookSize = book?.size?.() ?? 0
      const bookWords = book?.list?.() ?? []

  /* ── 用共用原语组装 ── */
      const P = makePrimitives(h)
      const { Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page, GAP, C, FS } = P

      const section = (key, title, hint, children, action) => h(Card, {
        key,
        title,
        hint,
        action,
      }, children)

      const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

      return h(Page, null, [
        h(PageHeader, {
          key: 'hdr',
          title: '英语翻译',
          desc: '在对话里点击或划选英文单词看释义，划选纯英文句子翻成中文。生词本会自动高亮你已经背过的词。',
          extra: [
            h(Badge, { key: 'b', text: '离线', tone: 'success' }),
            h(Badge, { key: 'c', text: `${(dictInfo?.entries ?? 20499).toLocaleString()} 词条`, tone: 'neutral' }),
          ],
        }),

    /* 翻译接口 */
        section('tr', '翻译接口',
          '划选纯英文句子时用哪个服务。三项都不需要额外密钥。',
          [
            field('f1', '翻译服务', h(Select, {
              value: translator,
              options: [
                { value: 'auto', label: '自动（先用 Google，失败换 Bing）' },
                { value: 'google', label: 'Google 翻译' },
                { value: 'bing', label: 'Bing 翻译' },
                { value: 'off', label: '关闭句子翻译' },
              ],
              onChange: (value) => { setTranslator(value); writeTranslator(storage, value) },
            })),
          ]),

    /* 词库 */
        section('packs', '词库与句子库',
          '系统自带三个，随插件分发，完全离线。其余词库可以自己加。',
          [
            h('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } },
              WORD_PACKS.map((pack) => h('div', {
                key: pack.id,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: GAP.md,
                  padding: '13px 15px',
                  borderRadius: 13,
                  border: `1px solid ${C.border2}`,
                  background: C.bg1,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
                },
              }, [
                h('div', { key: 'm', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 } }, [
                  h('div', { key: 'n', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
                    h('span', { key: 't', style: { fontSize: FS.body, fontWeight: 650, color: C.text } }, pack.name),
                    h(Badge, { key: 'b', text: '系统自带', tone: 'neutral' }),
                  ]),
                  h('div', { key: 'd', style: { fontSize: FS.small, lineHeight: 1.85, color: C.textFaint } }, pack.desc),
                ]),
              ])),
            ),
            h('div', { key: 'custom', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } }, [
              h('h4', { key: 't', style: { margin: 0, fontSize: FS.body, fontWeight: 650, color: C.text } }, '自己加词库'),
              h('p', { key: 'h', style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textDim } },
                '把词库文件放进下面这个目录，重启 DSH 后自动加载。支持 ECDICT 的 CSV（只要有 word 与 translation 两列），或者与 dict.dat 同构的 JSON。'),
              h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, [
                h('code', {
                  key: 'p',
                  style: {
                    flex: 1, minWidth: 200,
                    fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
                    fontSize: FS.small, lineHeight: 1.9,
                    padding: '8px 12px', borderRadius: 8,
                    border: `1px dashed ${C.border2}`,
                    background: C.bgBase, color: C.textFaint,
                    userSelect: 'all',
                    overflowWrap: 'anywhere',
                  },
                }, packsDir),
                h(Button, {
                  key: 'copy', label: '复制路径', size: 'sm',
                  onClick: (event) => {
                    const btn = event?.currentTarget
                    const done = () => {
                      if (btn) btn.textContent = '已复制'
                      setTimeout(() => { if (btn) btn.textContent = '复制路径' }, 1400)
                    }
                    try { navigator.clipboard?.writeText(packsDir).then(done, () => {}) } catch { /* ignore */ }
                  },
                }),
              ]),
            ]),
            h(Note, {
              key: 'note',
              tone: 'info',
              text: `当前 ${(dictInfo?.entries ?? 20499).toLocaleString()} 个词条 · `
                + `${(dictInfo?.examples ?? 8960).toLocaleString()} 个带双语例句 · `
                + `${(dictInfo?.roots ?? 6374).toLocaleString()} 个带词根分析`,
            }),
          ]),

    /* 生词本 */
        section('book', '生词本',
          `已收藏 ${bookSize} 个词。支持从有道、欧路、百词斩导出的内容直接粘贴，一行一个。`,
          [
            bookSize > 0
              ? h('div', { key: 'chips', className: 'hds-chips' },
                bookWords.slice(0, CHIP_LIMIT).map((item) => h('span', { key: item.head, className: 'hds-chip' }, [
                  h('span', { key: 'w' }, item.head),
                  h('button', {
                    key: 'x', className: 'hds-chip-x', type: 'button', title: '移出',
                    onClick: () => book.remove(item.head),
                  }, '×'),
                ])),
              )
              : h('p', { key: 'empty', style: { margin: 0, fontSize: FS.small, lineHeight: 1.85, color: C.textFaint } },
                '还没有生词。在对话里点开一个词，点标题旁边的 ☆ 就能收进来。'),

            bookSize > CHIP_LIMIT
              ? h('p', { key: 'more', style: { margin: 0, fontSize: FS.small, color: C.textFaint } },
                `只显示了前 ${CHIP_LIMIT} 个，还有 ${bookSize - CHIP_LIMIT} 个。用搜索或导出来看全部。`)
              : null,

            h(Input, {
              key: 'ta',
              multiline: true,
              value: importText,
              placeholder: '粘贴单词表，一行一个。有道的导出内容可以直接贴（每行第一个词会被识别）。',
              onChange: setImportText,
            }),

            h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
              h(Button, {
                key: 'import', label: '导入', variant: 'primary',
                disabled: importText.trim() === '', busy: busy === 'import',
                onClick: onImport,
              }),
              h(Button, {
                key: 'export', label: '导出为 txt',
                disabled: bookSize === 0, onClick: onExport,
              }),
              h(Button, {
                key: 'clear',
                label: clearPending ? '确认清空' : '清空',
                variant: clearPending ? 'primary' : 'danger',
                disabled: busy === 'clear' || bookSize === 0,
                onClick: onClear,
              }),
              clearPending
                ? h(Button, {
                  key: 'cancel', label: '取消', variant: 'ghost',
                  onClick: () => { setClearPending(false); setMessage(null) },
                })
                : null,
            ]),
          ]),

    /* 显示 */
        section('ui', '显示', null, [
          field('s1', '浮层释义条数',
            h(Input, {
              type: 'number', value: String(ux.appearance.maxSensesInPopover),
              onChange: (v) => patchAppearance('maxSensesInPopover', Number(v)),
              style: { maxWidth: 110 },
            })),
          field('s2', '卡片宽度',
            h(Input, {
              type: 'number', value: String(ux.appearance.cardMaxWidthPx),
              onChange: (v) => patchAppearance('cardMaxWidthPx', Number(v)),
              style: { maxWidth: 130 },
            })),
          field('s3', '显示考纲标签',
            h(Switch, {
              checked: ux.appearance.showTags !== false,
              onChange: (next) => patchAppearance('showTags', next),
              label: ux.appearance.showTags !== false ? '显示' : '隐藏',
            })),
        ]),

        message !== null
          ? h(Note, {
            key: 'msg',
            tone: message.tone === 'err' ? 'err' : message.tone === 'info' ? 'info' : 'ok',
            text: message.text,
          })
          : null,
      ])
    }

    const WORD_PACKS = [
      { id: 'core', name: '核心词库', builtin: true, desc: '20,499 个考纲核心词：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE，每个词带词性、中文释义、英文释义与变音标注。' },
      { id: 'roots', name: '词根词缀库', builtin: true, desc: '6,374 个词的词根词缀拆解，来自 ECDICT 词根库（MIT）。' },
      { id: 'examples', name: '双语例句库', builtin: true, desc: '8,960 个词的中英对照例句，来自 Tatoeba（CC BY 2.0 FR）。' },
    ]

/** 读已启用的词库包。 */
    function readPacks(storage) {
      try {
        const raw = storage?.getItem?.('dsh-hover-dict:packs')
        if (typeof raw === 'string' && raw !== '') {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') return parsed
        }
      } catch { /* ignore */ }
      return {}
    }

/** 写已启用的词库包。 */
    function writePacks(storage, packs) {
      try {
        storage?.setItem?.('dsh-hover-dict:packs', JSON.stringify(packs))
      } catch { /* ignore */ }
    }

/** 读 localStorage，失败返回 undefined。 */
    function safeLocal() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
      } catch { /* ignore */ }
      return undefined
    }

/** 读翻译接口偏好。 */
    function readTranslator(storage) {
      try {
        const raw = storage?.getItem?.('dsh-hover-dict:translator')
        if (raw === 'google' || raw === 'bing' || raw === 'auto' || raw === 'off') return raw
      } catch { /* ignore */ }
      return 'auto'
    }

/** 写翻译接口偏好。 */
    function writeTranslator(storage, value) {
      try {
        storage?.setItem?.('dsh-hover-dict:translator', String(value))
      } catch { /* ignore */ }
    }

/** 把偏好翻成实际要试的 provider 列表。 */
    function translatorChain(preference) {
      if (preference === 'off') return []
      if (preference === 'google') return ['google']
      if (preference === 'bing') return ['bing']
      return ['google', 'bing']
    }

/** 把设置面板的样式插进文档。 */
    function ensureSettingsStyle(doc) {
      if (!doc || typeof doc.createElement !== 'function') return () => {}
      const id = 'dsh-hover-dict/settings.css'
      const selector = `style[data-plugin-css=${JSON.stringify(id)}]`
      let node = doc.querySelector(selector)
      if (node === null) {
        node = doc.createElement('style')
        node.dataset.pluginCss = id
        node.textContent = CSS
        const head = doc.head ?? doc.documentElement
        if (!head) return () => {}
        head.appendChild(node)
      } else if (node.textContent !== CSS) {
        node.textContent = CSS
      }
      return () => { try { node.remove() } catch { /* ignore */ } }
    }

      return { SettingsPanel, WORD_PACKS, readPacks, writePacks, readTranslator, writeTranslator, translatorChain, ensureSettingsStyle }
    })()

    // ═══ card.js ═══
    var __mod_card = (function () {
      var { attachDrag } = __mod_drag
/**
 * card.js —— 点击单词后就地摊开的「大卡片」。
 *
 * 与浮层的分工：浮层只说「这是什么意思」，卡片给全 —— 按词性分组的全部义项、
 * 英英释义、词形变化、双语例句。
 *
 * 卡片是**就地**弹的（不是右侧栏）：用户点一个词，眼睛就在那个词上，
 * 把他拽到别处会丢上下文。代价是卡片会压住正文，所以它可关闭、可固定、有高度上限。
 */

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
    function pickUpgradeTarget(input) {
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
    function splitExample(sentence, word, forms) {
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
    function CardRoot(props) {
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
      children.push(h('div', {
        key: 'head',
        className: 'hd-word-row hd-drag-handle',
        ref: handleRef,
        title: '拖动可移动位置，单击回到原位',
        style: { cursor: dragPos === null ? 'grab' : 'grab', userSelect: 'none' },
      },
        h('span', {
          className: 'hd-word',
      // 当前词在生词本里 → 标题标红
          style: inBook ? { color: 'var(--dsw-alias-state-error-primary, #e5484d)' } : undefined,
        }, props.word ?? ''),
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
    function SenseGroups(props) {
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
    function Examples(props) {
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

      return { pickUpgradeTarget, splitExample, CardRoot, SenseGroups, Examples }
    })()

    // ═══ app.js ═══
    var __mod_app = (function () {
      var { loadUx, tagLabel } = __mod_config
      var { briefOf, buildIndex, describeEntry, loadDictionary, lookup } = __mod_dict
      var { fetchAsset, humanizeError } = __mod_net
      var { computeOverlayRect } = __mod_position
      var { ensureStyle, PopoverBody, PhraseBody, UI_ATTR } = __mod_overlay
      var { CardRoot } = __mod_card
      var { caretAtPoint, rangeRects, readSelection, unionOf } = __mod_selection
      var { SELECTORS } = __mod_hit
      var { wordAt, normalizeKey } = __mod_word
      var { createWordbook } = __mod_wordbook
      var { familyOf } = __mod_family
      var { ensureSettingsStyle, readTranslator, SettingsPanel } = __mod_settings
/**
 * app.js —— 状态机与 slot 注册。整个浏览器半唯一的 apply / inject 出口。
 *
 * 交互：点击 / 划选触发，结果不自动消失。
 *
 * 为什么不用悬停：悬停要靠时间判断「用户是扫过去还是停下来」，鼠标在词上
 * 轻微抖动就得重新计时，于是表现为「卡」与「有些词不出结果」。
 * 点击与划选是明确的动作，不需要猜。
 */


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
    function createHoverMachine(options) {
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
    function apply(ctx) {
      try {
        const doc = typeof document !== 'undefined' ? document : undefined
        if (!doc) return

        let disposeStyle = () => {}
        try {
          disposeStyle = ensureStyle(doc)
        } catch (error) {
          warn('样式注入失败', error)
        }

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

      // 中英混排：不翻译，但给一句提示。
      // 完全静默会让用户以为插件坏了——他们明明选中了东西。
          if (selection.kind === 'skip') {
            runtime.mode = 'notice'
            runtime.notice = '选中的内容中英混排，只翻译纯英文'
            runtime.placement = placeFor('popover', bounds)
            notify()
            return
          }

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
          runtime.notice = ''
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
            notice: runtime.notice,
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
          }, 'dsh-hover-dict: 监听与 slot 清理')
        }
      } catch (error) {
        warn('挂载失败', error)
      }
    }

/** 静态数组，不能是函数或变量 —— client-modules 在扫描期就要读到它。 */
    const inject = ['slots']

/**
 * 覆盖层宿主组件。
 *
 * @param {object} props
 * @returns {import('react').ReactElement | null}
 */
    function OverlayHost(props) {
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
          placement, ux, status, errorMessage, inBook, inBookSet, family, roots, notice,
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

        if (mode === 'notice' && placement && notice) {
          children.push(h('div', {
            key: 'notice',
            className: 'hd-pop',
            style: {
              top: `${placement.top}px`,
              left: `${placement.left}px`,
              pointerEvents: 'auto',
              color: 'var(--dsw-alias-label-secondary, #666)',
            },
            onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
          }, h('div', { className: 'hd-more' }, notice)))
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

      return { createHoverMachine, apply, inject, OverlayHost }
    })()

    // ── 宿主加载契约只读这两个名字 ──
    exports.apply = __mod_app.apply
    exports.inject = __mod_app.inject

    // ── 纯函数透出给测试（不影响宿主） ──
    exports.API_PREFIX = __mod_net.API_PREFIX
    exports.C = __mod_ui.C
    exports.CardRoot = __mod_card.CardRoot
    exports.DEFAULT_APPEARANCE = __mod_config.DEFAULT_APPEARANCE
    exports.DEFAULT_TIMING = __mod_config.DEFAULT_TIMING
    exports.DEFAULT_UX = __mod_config.DEFAULT_UX
    exports.DRAG_THRESHOLD_PX = __mod_drag.DRAG_THRESHOLD_PX
    exports.EASE = __mod_ui.EASE
    exports.Examples = __mod_card.Examples
    exports.FS = __mod_ui.FS
    exports.GAP = __mod_ui.GAP
    exports.HIT_BLOCKERS = __mod_hit.HIT_BLOCKERS
    exports.MAX_SELECTION_CHARS = __mod_selection.MAX_SELECTION_CHARS
    exports.MAX_WORD_LEN = __mod_word.MAX_WORD_LEN
    exports.OverlayHost = __mod_app.OverlayHost
    exports.PhraseBody = __mod_overlay.PhraseBody
    exports.PopoverBody = __mod_overlay.PopoverBody
    exports.RADIUS = __mod_ui.RADIUS
    exports.SELECTORS = __mod_hit.SELECTORS
    exports.STORAGE_KEY = __mod_config.STORAGE_KEY
    exports.SenseGroups = __mod_card.SenseGroups
    exports.SettingsPanel = __mod_settings.SettingsPanel
    exports.StatusNote = __mod_overlay.StatusNote
    exports.UI_ATTR = __mod_overlay.UI_ATTR
    exports.VIEWPORT_PAD = __mod_drag.VIEWPORT_PAD
    exports.WORD_PACKS = __mod_settings.WORD_PACKS
    exports.anchorOf = __mod_anchor.anchorOf
    exports.attachDrag = __mod_drag.attachDrag
    exports.briefOf = __mod_dict.briefOf
    exports.buildIndex = __mod_dict.buildIndex
    exports.caretAt = __mod_hit.caretAt
    exports.caretAtPoint = __mod_selection.caretAtPoint
    exports.clampAppearance = __mod_config.clampAppearance
    exports.clampTiming = __mod_config.clampTiming
    exports.clampToViewport = __mod_drag.clampToViewport
    exports.classifySelection = __mod_selection.classifySelection
    exports.computeCardPlacement = __mod_position.computeCardPlacement
    exports.computeOverlayRect = __mod_position.computeOverlayRect
    exports.computePopoverPlacement = __mod_position.computePopoverPlacement
    exports.containsPoint = __mod_position.containsPoint
    exports.createHoverMachine = __mod_app.createHoverMachine
    exports.createWordbook = __mod_wordbook.createWordbook
    exports.describeEntry = __mod_dict.describeEntry
    exports.dragPosition = __mod_drag.dragPosition
    exports.ensureSettingsStyle = __mod_settings.ensureSettingsStyle
    exports.ensureStyle = __mod_overlay.ensureStyle
    exports.familyOf = __mod_family.familyOf
    exports.fetchAsset = __mod_net.fetchAsset
    exports.hanRatio = __mod_selection.hanRatio
    exports.hintStyle = __mod_ui.hintStyle
    exports.hitsAny = __mod_selection.hitsAny
    exports.humanizeError = __mod_net.humanizeError
    exports.inflectionsOf = __mod_family.inflectionsOf
    exports.isAnchorStale = __mod_anchor.isAnchorStale
    exports.isEligibleTarget = __mod_hit.isEligibleTarget
    exports.isJoiner = __mod_word.isJoiner
    exports.isProgrammaticScroll = __mod_hit.isProgrammaticScroll
    exports.isTranslatable = __mod_selection.isTranslatable
    exports.isWordChar = __mod_word.isWordChar
    exports.loadDictionary = __mod_dict.loadDictionary
    exports.loadUx = __mod_config.loadUx
    exports.lookup = __mod_dict.lookup
    exports.makePrimitives = __mod_ui.makePrimitives
    exports.nodeIdentity = __mod_anchor.nodeIdentity
    exports.normalizeKey = __mod_word.normalizeKey
    exports.parseForms = __mod_dict.parseForms
    exports.parseImportText = __mod_wordbook.parseImportText
    exports.pickUpgradeTarget = __mod_card.pickUpgradeTarget
    exports.posLabel = __mod_dict.posLabel
    exports.rangeRects = __mod_selection.rangeRects
    exports.readPacks = __mod_settings.readPacks
    exports.readSelection = __mod_selection.readSelection
    exports.readTranslator = __mod_settings.readTranslator
    exports.rectsOf = __mod_selection.rectsOf
    exports.sameWord = __mod_anchor.sameWord
    exports.saveUx = __mod_config.saveUx
    exports.splitExample = __mod_card.splitExample
    exports.stemCandidates = __mod_word.stemCandidates
    exports.stemVariants = __mod_family.stemVariants
    exports.sx = __mod_ui.sx
    exports.tagLabel = __mod_config.tagLabel
    exports.translatorChain = __mod_settings.translatorChain
    exports.unionOf = __mod_selection.unionOf
    exports.unionRect = __mod_position.unionRect
    exports.wordAt = __mod_word.wordAt
    exports.writePacks = __mod_settings.writePacks
    exports.writeTranslator = __mod_settings.writeTranslator

    return module.exports
  },
})
