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
 *   client/src/srs.js
 *   client/src/wordbook.js
 *   client/src/importer.js
 *   client/src/review.js
 *   client/src/marker.js
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
 * @property {boolean} markWords          生词着色总开关：false = 完全不变色（设计-v2 §C4）
 * @property {string} markColor           高亮色，hex。唯一的非 token 颜色例外
 * @property {boolean} markKnown          已掌握的词是否淡色显示
 * @property {string} markStyle           'underline' | 'background' | 'text'
 */

/**
 * 「跟随宿主错误红」的哨兵值。
 *
 * 用户要求生词着色默认用 DSH 自带的错误红（就是工具调用报错那种红），
 * 这样亮/暗主题各自取对应的错误红，不必我们挑一个 hex 然后两个主题都不像。
 * 用哨兵而不是把 token 表达式存进配置：配置里存语义标记，具体 CSS 由渲染层
 * 拼出来（见 marker.js 的 markColorToCss，那里带 hex 兜底），换主题不用改存档。
 */
    const THEME_ERROR_COLOR = 'theme-error'

/**
 * 默认高亮色（红）。
 *
 * v2 起默认「跟随宿主错误红」而不是固定 hex —— 用户原话是「和宿主报错红字一样的红」。
 * 用户仍可改成固定 hex（六预设或自定义）。
 */
    const DEFAULT_MARK_COLOR = THEME_ERROR_COLOR

/**
 * 合法的着色样式。
 *
 * @deprecated 用户裁定「只要改字的颜色即可」——不着色块、不下划线，
 * 所以这三档（underline/background/text）已废弃，渲染层不再使用。
 * 保留导出只为不让旧存档/旧调用点直接炸；正式清理留给后续版本。
 */
    const MARK_STYLES = ['underline', 'background', 'text']

/** 设置面板给的六个预设色块（红/橙/黄/绿/蓝/紫），第一项是固定红。 */
    const MARK_COLOR_PRESETS = ['#e5484d', '#f0a441', '#d4b106', '#2f9e44', '#4d6bfe', '#8b5cf6']

/** 默认的着色配置。 */
    const DEFAULT_MARK = {
      markWords: true,
      markColor: DEFAULT_MARK_COLOR,
      markKnown: false,
      markStyle: 'underline',
    }

/** @type {UxAppearance} */
    const DEFAULT_APPEARANCE = {
      maxSensesInPopover: 2,
      cardMaxWidthPx: 420,
      cardMaxHeightRatio: 0.7,
      offsetPx: 6,
      viewportMarginPx: 8,
      showTags: true,
      tagOrder: ['cet4', 'cet6', 'ky', 'ielts'],
      ...DEFAULT_MARK,
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
 * 校验一个高亮色。只认 6 位 hex（`<input type=color>` 的输出形状）。
 *
 * 为什么要校验：这个值会被拼进 CSS 的 `color-mix()`，坏值会让整条声明作废
 * （参见 _tokens.mjs 那次的教训），所以宁可回落到默认红，也不要把垃圾传下去。
 *
 * @param {unknown} value
 * @returns {string} 合法 hex 或默认红
 */
    function normalizeMarkColor(value) {
      if (typeof value !== 'string') return DEFAULT_MARK_COLOR
      const trimmed = value.trim()
  // 合法输入 = 六位 hex 或 theme-error 哨兵；其余一律回落默认（=哨兵）
      if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
      if (trimmed.toLowerCase() === THEME_ERROR_COLOR) return THEME_ERROR_COLOR
      return DEFAULT_MARK_COLOR
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
 *   markWords            布尔，非布尔回落 true
 *   markColor            `/^#[0-9a-f]{6}$/i`，非法回落默认红 `#e5484d`
 *   markKnown            布尔，非布尔回落 false
 *   markStyle            MARK_STYLES 之一，枚举外回落 'underline'
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
        markWords: typeof source.markWords === 'boolean' ? source.markWords : DEFAULT_APPEARANCE.markWords,
        markColor: normalizeMarkColor(source.markColor),
        markKnown: typeof source.markKnown === 'boolean' ? source.markKnown : DEFAULT_APPEARANCE.markKnown,
        markStyle: MARK_STYLES.includes(source.markStyle) ? source.markStyle : DEFAULT_APPEARANCE.markStyle,
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

      return { DEFAULT_TIMING, THEME_ERROR_COLOR, DEFAULT_MARK_COLOR, MARK_STYLES, MARK_COLOR_PRESETS, DEFAULT_APPEARANCE, DEFAULT_UX, STORAGE_KEY, loadUx, saveUx, clampTiming, normalizeMarkColor, clampAppearance, tagLabel }
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
    const DEFAULT_MAX_HAN_RATIO = 0.10

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
 * @param {number} [maxHanRatio] 汉字占比上限，默认 10%；由设置页传入
 * @returns {boolean}
 */
    function isTranslatable(text, maxHanRatio) {
      if (!HAS_LATIN.test(text)) return false
      const limit = Number.isFinite(maxHanRatio) ? maxHanRatio : DEFAULT_MAX_HAN_RATIO
      return hanRatio(text) <= limit
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
    function classifySelection(raw, options) {
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
  // 中英混排：直接不处理，界面上什么都不弹。
  //
  // 之前会返回 skip 并弹一句「选中的内容中英混排，只翻译纯英文」，
  // 但用户要的是「不翻译就别弹窗」—— 选一段话本来就是为了复制或引用，
  // 弹一个框反而碍事。
      if (HAS_HAN.test(text) && !isTranslatable(text, options?.maxHanRatio)) {
        return null
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
    function readSelection(doc, options) {
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
      const classified = classifySelection(raw, options)
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

      return { MAX_SELECTION_CHARS, DEFAULT_MAX_HAN_RATIO, hanRatio, isTranslatable, classifySelection, readSelection, rectsOf, caretAtPoint, rangeRects, unionOf, hitsAny }
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

    // ═══ srs.js ═══
    var __mod_srs = (function () {
/**
 * srs.js —— 生词本的间隔重复（SRS）纯函数层。
 *
 * 只做数学：不碰存储、不碰 DOM、不碰 React。给定输入必有输出，node 可以直测。
 * 算法是简化 SM-2，单位天（设计-v2 §A3）：
 *
 *   again（不认识）→ 10 分钟后再来，ease -0.2，连对清零，状态转 unknown
 *   hard （记错）  → 间隔减半（至少 1 天），ease -0.15，状态转 fuzzy
 *   good （认识）  → 1 / 3 / interval*ease 天，ease +0.02
 *
 * 夹取：ease ∈ [1.3, 3.0]，interval ≤ 365 天。
 * 「已掌握」的判据是间隔跨过 21 天（known），不是答对次数 —— 因为答对一次就
 * 叫「掌握」会让 known 这个词失去意义。
 */

/** 一天多少毫秒。复习间隔与 stats 的日界都按它算。 */
    const DAY_MS = 86400000

/** ease 的下限与上限。 */
    const EASE_MIN = 1.3
    const EASE_MAX = 3.0

/** 单次间隔的天数上限。 */
    const INTERVAL_MAX = 365

/** 「不认识」之后多少毫秒重来。 */
    const AGAIN_DELAY_MS = 10 * 60000

/** 间隔跨过这个天数才算「已掌握」。 */
    const KNOWN_INTERVAL = 21

/** 合法的评分。 */
    const SRS_GRADES = ['again', 'hard', 'good']

/** 合法的词条状态：new 未学、unknown 不认识、fuzzy 记错、known 已掌握。 */
    const WORD_STATES = ['new', 'unknown', 'fuzzy', 'known']

/**
 * 一份全新的 srs 记录。
 *
 * @returns {{ due: number, interval: number, ease: number, reps: number, lapses: number, lastReviewAt: number }}
 */
    function defaultSrs() {
      return { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReviewAt: 0 }
    }

/** 把任意值读成有限数字，坏值给兜底。 */
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback)

/**
 * 把磁盘上读到的 srs 记录夹进合法范围。
 *
 * 老数据可能缺字段、也可能被人手改过（ease 写成 0 会让间隔永远为 1），
 * 所以读入时一律过一遍这里，而不是在算法里到处判空。
 *
 * @param {object} [raw]
 * @returns {{ due: number, interval: number, ease: number, reps: number, lapses: number, lastReviewAt: number }}
 */
    function normalizeSrs(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      return {
        due: Math.max(0, num(src.due, 0)),
        interval: Math.min(INTERVAL_MAX, Math.max(0, num(src.interval, 0))),
        ease: Math.min(EASE_MAX, Math.max(EASE_MIN, num(src.ease, 2.5))),
        reps: Math.max(0, num(src.reps, 0)),
        lapses: Math.max(0, num(src.lapses, 0)),
        lastReviewAt: Math.max(0, num(src.lastReviewAt, 0)),
      }
    }

/**
 * 评分一次，算出新的 srs 记录。
 *
 * 不改传入对象（纯函数），返回全新的记录。
 *
 * @param {object} srs 旧记录，缺字段按默认值算
 * @param {'again'|'hard'|'good'} grade 评分
 * @param {number} [now] 当前时间戳（测试用；默认 now）
 * @returns {{ due: number, interval: number, ease: number, reps: number, lapses: number, lastReviewAt: number }}
 */
    function nextSrs(srs, grade, now = Date.now()) {
      const base = normalizeSrs(srs)
      const at = Number.isFinite(now) ? now : Date.now()
      let { interval, ease, reps, lapses } = base

      if (grade === 'again') {
        reps = 0
        lapses += 1
        interval = 0
        ease = Math.max(EASE_MIN, ease - 0.2)
        return { due: at + AGAIN_DELAY_MS, interval, ease, reps, lapses, lastReviewAt: at }
      }

      if (grade === 'hard') {
        reps = 0
        lapses += 1
        interval = Math.max(1, Math.round(interval * 0.5))
        ease = Math.max(EASE_MIN, ease - 0.15)
        return { due: at + interval * DAY_MS, interval, ease, reps, lapses, lastReviewAt: at }
      }

  // good（未知评分按 good 处理：宁可多给一次机会，也不要卡死队列）
      reps += 1
      interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease)
      interval = Math.min(interval, INTERVAL_MAX)
      ease = Math.min(EASE_MAX, ease + 0.02)
      return { due: at + interval * DAY_MS, interval, ease, reps, lapses, lastReviewAt: at }
    }

/**
 * 评分之后词条该显示成什么状态。
 *
 * @param {'new'|'unknown'|'fuzzy'|'known'} prevState
 * @param {'again'|'hard'|'good'} grade
 * @param {number} newInterval 评分后的间隔（天）
 * @returns {'new'|'unknown'|'fuzzy'|'known'}
 */
    function stateAfterGrade(prevState, grade, newInterval) {
      const prev = WORD_STATES.includes(prevState) ? prevState : 'new'
      if (grade === 'again') return 'unknown'
      if (grade === 'hard') return 'fuzzy'
      const interval = Number.isFinite(newInterval) ? newInterval : 0
      if (interval >= KNOWN_INTERVAL) return 'known'
      return prev === 'new' ? 'fuzzy' : prev
    }
      return { DAY_MS, EASE_MIN, EASE_MAX, INTERVAL_MAX, AGAIN_DELAY_MS, KNOWN_INTERVAL, SRS_GRADES, WORD_STATES, defaultSrs, normalizeSrs, nextSrs, stateAfterGrade }
    })()

    // ═══ wordbook.js ═══
    var __mod_wordbook = (function () {
      var { normalizeKey } = __mod_word
      var { defaultSrs, normalizeSrs, nextSrs, stateAfterGrade, WORD_STATES, DAY_MS } = __mod_srs
/**
 * wordbook.js —— 生词本的数据层。
 *
 * 两种存储，按优先级：
 *   1. 宿主 `storage` 服务的 KV（落磁盘，换浏览器/清缓存都不丢）；
 *   2. localStorage（没有 storage 服务时兜底）。
 *
 * 为什么先试宿主：生词本是用户长期积累的东西，丢了比不能存更糟。
 *
 * 存储单元（KV）：`name:'dsh-hover-dict'`，version 2，三张表：
 *   words —— 词条，以词头为主键；
 *   books —— 词书，以词书 id 为主键；
 *   log   —— 复习记录环形缓冲（一条记录，键 `recent`）。
 * 表名与单元名一个都不能改：改了等于让老用户丢生词（设计-v2 §A1）。
 *
 * 词条形状 v2：
 *   {
 *     v: 2,
 *     head: 'cute',           词头（normalizeKey 之后，小写）
 *     addedAt: 1698800000000,
 *     source: 'dsh' | 'youdao' | 'manual' | 'import',
 *     bookId: 'default',      首次归属的词书
 *     alsoIn: ['cet4'],       被重复导入到别的书时追加（可选字段）
 *     note: '',               用户备注，≤500 字符
 *     gloss: '',              释义快照（导入行自带 / 有道抓回）；词库能查到的词留空
 *     state: 'new'|'unknown'|'fuzzy'|'known',
 *     srs: { due, interval, ease, reps, lapses, lastReviewAt },
 *     review: { seen, lastSeenAt }   保留 v1 字段：查词次数
 *   }
 *
 * 只存词头不存完整释义 —— 释义在离线词库里，存两份会不一致。
 */


/** KV 表名与单元名。改这几个值等于让老用户丢生词，别动。 */
    const UNIT_NAME = 'dsh-hover-dict'
    const UNIT_VERSION = 2
    const LEGACY_VERSION = 1
    const TABLE = 'words'
    const BOOK_TABLE = 'books'
    const LOG_TABLE = 'log'
    const LOG_KEY = 'recent'

/** localStorage 的兜底键。词表那个键必须保持原样。 */
    const FALLBACK_KEY = 'dsh-hover-dict:wordbook'
    const BOOKS_KEY = 'dsh-hover-dict:books'
    const LOG_KEY_LOCAL = 'dsh-hover-dict:log'

/** 内置词书：不可删、不可改名，划词收藏一律进它。 */
    const DEFAULT_BOOK_ID = 'default'
    const DEFAULT_BOOK_NAME = '默认生词本'

/** 复习日志环形缓冲上限。 */
    const LOG_CAP = 500

/** 备注上限。 */
    const NOTE_MAX = 500
/** 释义快照上限。 */
    const GLOSS_MAX = 200
/** 词书名字上限。 */
    const BOOK_NAME_MAX = 40

/** 造一条全新的词条。 */
    const makeEntry = (head, source, bookId) => ({
      v: 2,
      head,
      addedAt: Date.now(),
      source: typeof source === 'string' && source !== '' ? source : 'dsh',
      bookId: typeof bookId === 'string' && bookId !== '' ? bookId : DEFAULT_BOOK_ID,
      note: '',
      gloss: '',
      state: 'new',
      srs: defaultSrs(),
      review: { seen: 0, lastSeenAt: 0 },
    })

/** 造内置词书。 */
    const makeDefaultBook = () => ({
      id: DEFAULT_BOOK_ID,
      name: DEFAULT_BOOK_NAME,
      createdAt: 0,
      builtin: true,
    })

/**
 * 生词本的内存镜像 + 落盘。
 *
 * @typedef {object} WordbookEntry
 * @property {number} v
 * @property {string} head
 * @property {number} addedAt
 * @property {string} source
 * @property {string} bookId
 * @property {string[]} [alsoIn]
 * @property {string} note
 * @property {string} gloss
 * @property {string} state
 * @property {object} srs
 * @property {{ seen: number, lastSeenAt: number }} review
 */

/** 本地日界：把时间戳压到当天 00:00。 */
    const startOfDay = (ts) => {
      const d = new Date(Number.isFinite(ts) ? ts : Date.now())
      d.setHours(0, 0, 0, 0)
      return d.getTime()
    }

/** 本地日期键 `YYYY-MM-DD`（按用户时区，不按 UTC）。 */
    const dayKey = (ts) => {
      const d = new Date(Number.isFinite(ts) ? ts : Date.now())
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

/**
 * 造一个生词本。
 *
 * @param {object} options
 * @param {object} [options.storage] 宿主的 storage 服务（可选）
 * @param {Storage} [options.local] localStorage（可选，两者都没有就只在内存里）
 */
    function createWordbook(options) {
      const local = options?.local
      const hostStorage = options?.storage

  /** @type {Map<string, WordbookEntry>} */
      const words = new Map()
  /** @type {Map<string, object>} */
      const books = new Map()
  /** @type {Array<{at:number, head:string, grade:string}>} */
      const log = []
      const listeners = new Set()
      let unit = null
      let readyPromise = null

      const emit = () => {
        for (const listener of listeners) {
          try { listener() } catch { /* ignore */ }
        }
      }

      const ensureDefaultBook = () => {
        if (!books.has(DEFAULT_BOOK_ID)) books.set(DEFAULT_BOOK_ID, makeDefaultBook())
      }

  /**
   * 把一条 KV 记录读进内存镜像。**老记录就地升级成 v2**（缺字段补默认）。
   *
   * KV 里可能有多余字段，按形状挑，不整条信任。
   */
      const adopt = (key, value) => {
        const head = normalizeKey(key)
        if (!head) return
        const record = value && typeof value === 'object' ? value : {}
        const review = record.review && typeof record.review === 'object' ? record.review : {}
        const bookId = typeof record.bookId === 'string' && record.bookId !== '' ? record.bookId : DEFAULT_BOOK_ID
        const alsoIn = Array.isArray(record.alsoIn)
          ? [...new Set(record.alsoIn.filter((id) => typeof id === 'string' && id !== '' && id !== bookId))]
          : []
        const entry = {
          v: 2,
          head,
          addedAt: Number.isFinite(record.addedAt) ? record.addedAt : Date.now(),
          source: typeof record.source === 'string' && record.source !== '' ? record.source : 'dsh',
          bookId,
          note: typeof record.note === 'string' ? record.note.slice(0, NOTE_MAX) : '',
          gloss: typeof record.gloss === 'string' ? record.gloss.slice(0, GLOSS_MAX) : '',
          state: WORD_STATES.includes(record.state) ? record.state : 'new',
          srs: normalizeSrs(record.srs),
          review: {
            seen: Number.isFinite(review.seen) ? review.seen : 0,
            lastSeenAt: Number.isFinite(review.lastSeenAt) ? review.lastSeenAt : 0,
          },
        }
        if (alsoIn.length > 0) entry.alsoIn = alsoIn
        words.set(head, entry)
      }

  /** 把一条词书记录读进内存镜像。 */
      const adoptBook = (key, value) => {
        const record = value && typeof value === 'object' ? value : {}
        const id = typeof key === 'string' && key !== '' ? key : (typeof record.id === 'string' ? record.id : '')
        if (id === '') return
        if (id === DEFAULT_BOOK_ID) {
          books.set(DEFAULT_BOOK_ID, makeDefaultBook())
          return
        }
        books.set(id, {
          id,
          name: typeof record.name === 'string' && record.name !== '' ? record.name.slice(0, BOOK_NAME_MAX) : id,
          createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
          builtin: false,
        })
      }

      const adoptLog = (value) => {
        const rows = Array.isArray(value) ? value : (Array.isArray(value?.rows) ? value.rows : [])
        log.length = 0
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue
          log.push({
            at: Number.isFinite(row.at) ? row.at : 0,
            head: typeof row.head === 'string' ? row.head : '',
            grade: typeof row.grade === 'string' ? row.grade : 'good',
          })
        }
      }

  /** 打开宿主 KV。拿不到就返回 null，让上层走 localStorage。 */
      const openUnit = async (version) => {
        try {
          const kv = hostStorage.backend?.get?.('kv') ?? hostStorage.backend?.get?.('local')
          if (!kv || typeof kv.open !== 'function') return null
          return await kv.open({
            name: UNIT_NAME,
            version,
            tables: [TABLE, BOOK_TABLE, LOG_TABLE],
            hasGlobal: false,
            layout: 'per-record',
          })
        } catch {
          return null
        }
      }

  /** 优先 v2；v2 打不开就退回 v1 的老单元（读出来照样就地升级，写回还在老单元）。 */
      const openAnyUnit = async () => {
        if (!hostStorage) return null
        const v2 = await openUnit(UNIT_VERSION)
        if (v2) return v2
        return openUnit(LEGACY_VERSION)
      }

  /** 从 localStorage 读词表。读坏了当作空，不要让整本生词本打不开。 */
      const loadLocalWords = () => {
        if (!local || typeof local.getItem !== 'function') return
        let raw = null
        try { raw = local.getItem(FALLBACK_KEY) } catch { return }
        if (typeof raw !== 'string' || raw === '') return
        try {
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return
          for (const item of parsed) {
            if (item && typeof item.head === 'string') adopt(item.head, item)
          }
        } catch { /* 坏数据当作空 */ }
      }

      const loadLocalBooks = () => {
        if (!local || typeof local.getItem !== 'function') return
        let raw = null
        try { raw = local.getItem(BOOKS_KEY) } catch { return }
        if (typeof raw !== 'string' || raw === '') return
        try {
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return
          for (const item of parsed) {
            if (item && typeof item.id === 'string') adoptBook(item.id, item)
          }
        } catch { /* 坏数据当作空 */ }
      }

      const loadLocalLog = () => {
        if (!local || typeof local.getItem !== 'function') return
        let raw = null
        try { raw = local.getItem(LOG_KEY_LOCAL) } catch { return }
        if (typeof raw !== 'string' || raw === '') return
        try { adoptLog(JSON.parse(raw)) } catch { /* 坏数据当作空 */ }
      }

      const saveLocal = () => {
        if (!local || typeof local.setItem !== 'function') return
        try {
          local.setItem(FALLBACK_KEY, JSON.stringify([...words.values()]))
        } catch { /* 配额满就放弃，内存里还有 */ }
      }

      const saveLocalBooks = () => {
        if (!local || typeof local.setItem !== 'function') return
        try {
          local.setItem(BOOKS_KEY, JSON.stringify([...books.values()]))
        } catch { /* ignore */ }
      }

      const saveLocalLog = () => {
        if (!local || typeof local.setItem !== 'function') return
        try {
          local.setItem(LOG_KEY_LOCAL, JSON.stringify(log))
        } catch { /* ignore */ }
      }

  /** 写一条词到 KV。失败不抛 —— 内存镜像已经更新，界面不该因为写盘失败而报错。 */
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

      const persistBook = async (id) => {
        const book = books.get(id)
        if (!unit || !book) return
        try {
          await unit.putRecord(BOOK_TABLE, id, book)
        } catch { /* ignore */ }
      }

      const dropPersistBook = async (id) => {
        if (!unit) return
        try {
          await unit.deleteRecord(BOOK_TABLE, id)
        } catch { /* ignore */ }
      }

  /** 追加一条复习记录（环形，超上限丢最老的）。 */
      const appendLog = (row) => {
        log.push(row)
        while (log.length > LOG_CAP) log.shift()
        if (!unit) return
        try {
          const written = unit.putRecord(LOG_TABLE, LOG_KEY, log)
          if (written && typeof written.catch === 'function') written.catch(() => {})
        } catch { /* ignore */ }
      }

  /** 词书里取一个合法的书 id。 */
      const resolveBookId = (id) => {
        if (typeof id === 'string' && id !== '' && books.has(id)) return id
        return DEFAULT_BOOK_ID
      }

  /** 从 Map / 普通对象里取释义快照。 */
      const glossOf = (glosses, head) => {
        if (!glosses) return ''
        const raw = typeof glosses.get === 'function' ? glosses.get(head) : glosses[head]
        return typeof raw === 'string' ? raw.slice(0, GLOSS_MAX) : ''
      }

      return {
        async ready() {
          if (readyPromise) return readyPromise
          readyPromise = (async () => {
            unit = await openAnyUnit()
            if (unit) {
              try {
                const loaded = await unit.loadAll()
                const rows = loaded?.tables?.[TABLE]
                if (rows && typeof rows === 'object') {
                  for (const [key, value] of Object.entries(rows)) adopt(key, value)
                }
                const bookRows = loaded?.tables?.[BOOK_TABLE]
                if (bookRows && typeof bookRows === 'object') {
                  for (const [key, value] of Object.entries(bookRows)) adoptBook(key, value)
                }
                const logRows = loaded?.tables?.[LOG_TABLE]
                if (logRows && typeof logRows === 'object') adoptLog(logRows[LOG_KEY])
              } catch {
            // KV 读失败：退到 localStorage，至少还有一份
                loadLocalWords()
                loadLocalBooks()
                loadLocalLog()
              }
            } else {
              loadLocalWords()
              loadLocalBooks()
              loadLocalLog()
            }

            ensureDefaultBook()
        // 词条引用了不存在的书（用户删过 / 手工改过备份）：补一本占位书，别让词消失
            for (const entry of words.values()) {
              const refs = [entry.bookId, ...(entry.alsoIn ?? [])]
              for (const id of refs) {
                if (id === '' || books.has(id)) continue
                books.set(id, { id, name: id, createdAt: Date.now(), builtin: false })
              }
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

        async add(word, source = 'dsh', bookId = DEFAULT_BOOK_ID) {
          const head = normalizeKey(word)
          if (!head) return false
          if (words.has(head)) return false
          const target = resolveBookId(bookId)
          words.set(head, makeEntry(head, source, target))
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

    /** 记录「这个词又被用户查了一次」。用于 E 块的查词记录与排序。 */
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
     * 评分一个词（走 srs.js），更新 state + srs，落盘并 emit。
     *
     * 词不在生词本里就返回 null —— 不静默建档，写操作必须来自用户明确动作。
     *
     * @param {string} word
     * @param {'again'|'hard'|'good'} grade
     * @returns {Promise<WordbookEntry|null>}
     */
        async grade(word, grade) {
          const head = normalizeKey(word)
          const entry = head === '' ? undefined : words.get(head)
          if (!entry) return null
          const at = Date.now()
          entry.srs = nextSrs(entry.srs, grade, at)
          entry.state = stateAfterGrade(entry.state, grade, entry.srs.interval)
          await persist(head)
          appendLog({ at, head, grade: typeof grade === 'string' ? grade : 'good' })
          saveLocal()
          saveLocalLog()
          emit()
          return entry
        },

    /**
     * 手动转态（管理台用）。
     *
     * 转 known：due 推到 30 天后（间隔也提到至少 30 天，免得下次评分把它拉回 1 天）；
     * 其余状态：due=0，立即回队列。
     *
     * @param {string} word
     * @param {'new'|'unknown'|'fuzzy'|'known'} state
     * @returns {Promise<WordbookEntry|null>}
     */
        async setState(word, state) {
          const head = normalizeKey(word)
          const entry = head === '' ? undefined : words.get(head)
          if (!entry || !WORD_STATES.includes(state)) return null
          entry.state = state
          if (state === 'known') {
            entry.srs.due = Date.now() + 30 * DAY_MS
            entry.srs.interval = Math.max(entry.srs.interval, 30)
          } else {
            entry.srs.due = 0
          }
          await persist(head)
          saveLocal()
          emit()
          return entry
        },

    /**
     * 写备注。
     *
     * @param {string} word
     * @param {string} note
     * @returns {Promise<WordbookEntry|null>}
     */
        async setNote(word, note) {
          const head = normalizeKey(word)
          const entry = head === '' ? undefined : words.get(head)
          if (!entry) return null
          entry.note = typeof note === 'string' ? note.slice(0, NOTE_MAX) : ''
          await persist(head)
          saveLocal()
          emit()
          return entry
        },

    /** 全部词书，内置书永远排第一。 */
        listBooks() {
          ensureDefaultBook()
          const rest = [...books.values()]
            .filter((book) => book.id !== DEFAULT_BOOK_ID)
            .sort((a, b) => a.createdAt - b.createdAt)
          return [{ ...books.get(DEFAULT_BOOK_ID) }, ...rest.map((book) => ({ ...book }))]
        },

    /**
     * 新建词书。同名书已存在时直接返回那本（不重复造）。
     *
     * @param {string} name
     * @returns {Promise<object|null>}
     */
        async createBook(name) {
          const clean = typeof name === 'string' ? name.trim().slice(0, BOOK_NAME_MAX) : ''
          if (clean === '') return null
          ensureDefaultBook()
          for (const book of books.values()) {
            if (book.name === clean) return { ...book }
          }
          let id = `book-${Date.now().toString(36)}`
          let n = 1
          while (books.has(id)) {
            n += 1
            id = `book-${Date.now().toString(36)}-${n}`
          }
          const book = { id, name: clean, createdAt: Date.now(), builtin: false }
          books.set(id, book)
          await persistBook(id)
          saveLocalBooks()
          emit()
          return { ...book }
        },

    /**
     * 改名。内置书不可改名。
     *
     * @param {string} id
     * @param {string} name
     * @returns {Promise<boolean>}
     */
        async renameBook(id, name) {
          const book = typeof id === 'string' ? books.get(id) : undefined
          if (!book || book.builtin) return false
          const clean = typeof name === 'string' ? name.trim().slice(0, BOOK_NAME_MAX) : ''
          if (clean === '') return false
          book.name = clean
          await persistBook(id)
          saveLocalBooks()
          emit()
          return true
        },

    /**
     * 删书。书里的词不删：`bookId` 指向这本书的词改挂到它还属于的下一本书
     * （没有就回 default），`alsoIn` 里的引用一并摘掉。内置书不可删。
     *
     * @param {string} id
     * @returns {Promise<boolean>}
     */
        async removeBook(id) {
          if (typeof id !== 'string' || id === DEFAULT_BOOK_ID) return false
          const book = books.get(id)
          if (!book) return false
          books.delete(id)
          const touched = []
          for (const entry of words.values()) {
            const refs = Array.isArray(entry.alsoIn) ? entry.alsoIn.filter((ref) => ref !== id) : []
            const ownedHere = entry.bookId === id
            if (!ownedHere && refs.length === (entry.alsoIn?.length ?? 0)) continue
        // 词原来挂在被删的书上：改挂它还剩的第一本书（这本书从 alsoIn 里拿走当主归属）；
        // 一本都不剩就回 default。
            let rest = refs
            if (ownedHere) {
              const next = refs.find((ref) => books.has(ref))
              entry.bookId = next ?? DEFAULT_BOOK_ID
              rest = next ? refs.filter((ref) => ref !== next) : refs
            }
            if (rest.length > 0) entry.alsoIn = rest
            else delete entry.alsoIn
            touched.push(entry.head)
          }
          await dropPersistBook(id)
          for (const head of touched) await persist(head)
          saveLocal()
          saveLocalBooks()
          emit()
          return true
        },

    /**
     * 到期队列：`due <= now` 的词。
     *
     * 排序：state==='unknown' 优先 → due 升序 → addedAt 升序（设计-v2 §A3）。
     *
     * @param {number} [now]
     * @returns {WordbookEntry[]}
     */
        dueQueue(now) {
          const at = Number.isFinite(now) ? now : Date.now()
          const rank = (entry) => (entry.state === 'unknown' ? 0 : 1)
          return [...words.values()]
            .filter((entry) => entry.srs.due <= at)
            .sort((a, b) => {
              const ra = rank(a)
              const rb = rank(b)
              if (ra !== rb) return ra - rb
              if (a.srs.due !== b.srs.due) return a.srs.due - b.srs.due
              return a.addedAt - b.addedAt
            })
        },

    /**
     * 统计聚合（B4 用）。
     *
     * @param {number} [now]
     * @returns {{ total:number, byState:{new:number,unknown:number,fuzzy:number,known:number},
     *   dueToday:number, addedToday:number, reviewedToday:number, streak:number,
     *   days: Array<{date:string, added:number, reviewed:number}> }}
     */
        stats(now) {
          const at = Number.isFinite(now) ? now : Date.now()
          const todayStart = startOfDay(at)
          const todayEnd = todayStart + DAY_MS
          const byState = { new: 0, unknown: 0, fuzzy: 0, known: 0 }
          let dueToday = 0
          let addedToday = 0
          for (const entry of words.values()) {
            byState[entry.state] = (byState[entry.state] ?? 0) + 1
            if (entry.srs.due < todayEnd) dueToday += 1
            if (entry.addedAt >= todayStart) addedToday += 1
          }
          let reviewedToday = 0
      /** date -> {added, reviewed} */
          const byDay = new Map()
          for (let i = 29; i >= 0; i -= 1) {
            const key = dayKey(todayStart - i * DAY_MS)
            byDay.set(key, { date: key, added: 0, reviewed: 0 })
          }
          for (const entry of words.values()) {
            const bucket = byDay.get(dayKey(entry.addedAt))
            if (bucket) bucket.added += 1
          }
          for (const row of log) {
            const key = dayKey(row.at)
            const bucket = byDay.get(key)
            if (bucket) bucket.reviewed += 1
            if (row.at >= todayStart) reviewedToday += 1
          }
      // streak：从今天往回数连续有复习记录的天数。
      // 今天还没复习不算断 —— 那只是今天还没开始，不是断签。
          const reviewedDays = new Set(log.map((row) => dayKey(row.at)))
          let streak = 0
          for (let i = 0; i < 366; i += 1) {
            if (reviewedDays.has(dayKey(todayStart - i * DAY_MS))) {
              streak += 1
              continue
            }
            if (i === 0) continue
            break
          }
          return {
            total: words.size,
            byState,
            dueToday,
            addedToday,
            reviewedToday,
            streak,
            days: [...byDay.values()],
          }
        },

    /**
     * 批量导入。用于从有道等平台导入生词表，或导入本插件的 JSON 备份。
     *
     * 同一词头在不同书里是**同一条记录**（head 是主键）：已存在的词只把目标书
     * 追加进 `alsoIn`，不新建记录。这就是「多本词书共用一套复习队列」的落法。
     *
     * @param {Array<string|object>} list 单词数组，或完整记录数组（备份恢复）
     * @param {string} source 来源标识
     * @param {{ bookId?: string, glosses?: Map<string,string>|Record<string,string> }} [opts]
     * @returns {Promise<number>} 真正新增的条数
     */
        async importMany(list, source, opts) {
          if (!Array.isArray(list)) return 0
          const target = resolveBookId(opts?.bookId)
          const glosses = opts?.glosses
          const src = typeof source === 'string' && source !== '' ? source : 'import'
          let added = 0
          let touched = 0
          for (const raw of list) {
            const asObject = raw && typeof raw === 'object' && !Array.isArray(raw)
            const headText = asObject ? (raw.head ?? raw.word ?? '') : raw
            const head = normalizeKey(String(headText ?? ''))
            if (!head || head.length > 64) continue
        // 只收像英文单词的：字母开头，允许撇号与连字符
            if (!/^[a-z][a-z'-]*$/.test(head)) continue

            const gloss = asObject && typeof raw.gloss === 'string' && raw.gloss !== ''
              ? raw.gloss.slice(0, GLOSS_MAX)
              : glossOf(glosses, head)

            const existing = words.get(head)
            if (existing) {
              let changed = false
              if (gloss !== '' && existing.gloss === '') {
                existing.gloss = gloss
                changed = true
              }
              if (target !== existing.bookId && !(Array.isArray(existing.alsoIn) && existing.alsoIn.includes(target))) {
                existing.alsoIn = [...(existing.alsoIn ?? []), target]
                changed = true
              }
              if (changed) {
                await persist(head)
                touched += 1
              }
              continue
            }

            const entry = makeEntry(head, src, target)
            entry.gloss = gloss
        // 备份恢复：保留原来的状态、SRS、备注、时间、归属书
            if (asObject) {
              if (typeof raw.note === 'string') entry.note = raw.note.slice(0, NOTE_MAX)
              if (WORD_STATES.includes(raw.state)) entry.state = raw.state
              if (raw.srs && typeof raw.srs === 'object') entry.srs = normalizeSrs(raw.srs)
              if (Number.isFinite(raw.addedAt)) entry.addedAt = raw.addedAt
              if (typeof raw.source === 'string' && raw.source !== '') entry.source = raw.source
              if (typeof raw.bookId === 'string' && raw.bookId !== '') entry.bookId = raw.bookId
              const extra = Array.isArray(raw.alsoIn)
                ? [...new Set(raw.alsoIn.filter((id) => typeof id === 'string' && id !== '' && id !== entry.bookId))]
                : []
              if (extra.length > 0) entry.alsoIn = extra
            }
            words.set(head, entry)
        // 备份里的书可能不存在，补一本占位书，别让词归到不存在的书上
            if (!books.has(entry.bookId)) {
              books.set(entry.bookId, {
                id: entry.bookId, name: entry.bookId, createdAt: Date.now(), builtin: false,
              })
              await persistBook(entry.bookId)
            }
            await persist(head)
            added += 1
          }
          if (added > 0 || touched > 0) {
            saveLocal()
            saveLocalBooks()
            emit()
          }
          return added
        },

    /**
     * 导出完整 v2 记录数组（JSON 备份用，可被 importMany 还原）。
     *
     * @returns {WordbookEntry[]}
     */
        exportAll() {
          return [...words.values()].map((entry) => ({
            ...entry,
            srs: { ...entry.srs },
            review: { ...entry.review },
            ...(Array.isArray(entry.alsoIn) ? { alsoIn: [...entry.alsoIn] } : {}),
          }))
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
 * 只返回词头是旧契约；带释义/跳过原因的详细版在 importer.js（B 块）。
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

    // ═══ importer.js ═══
    var __mod_importer = (function () {
      var { normalizeKey } = __mod_word
/**
 * importer.js —— 粘贴导入的解析层，全部纯函数。
 *
 * 为什么单独一个文件：解析规则（格式识别、词头抽取、释义/音标切分、跳过原因）
 * 是**能在 node 里直测**的逻辑，和 React 无关。设置页只负责把结果画成预览表，
 * 不负责猜文本长什么样。
 *
 * 支持五种来源（设计-v2 §B2）：
 *   plain   一行一词，或「词 音标 释义」单空格分隔
 *   csv     逗号分隔，首行可能是表头
 *   tsv     Tab 分隔（从 Excel/词书工具直接复制）
 *   json    合法 JSON 数组：字符串，或 {head|word, gloss|translation} 对象；
 *           也兼容本插件 exportAll 的备份（带 state/srs/bookId，恢复时原样保留）
 *   youdao  有道导出的整段：词 + /音标/ 或 [音标] + 释义，双空格分隔
 *
 * 输出形状固定为 `{ words, skipped, format }`：
 *   words[]   { head, gloss, phonetic, line, status, record? }
 *   skipped[] { line, raw, reason }
 *   status    'new'（将新增） | 'dup'（已在生词本） | 'nodict'（词库查不到）
 *
 * 「不静默丢行」：每一行没进入 words 都要在 skipped 里留一条原因。
 */


/** 认识的格式。 */
    const IMPORT_FORMATS = ['plain', 'csv', 'tsv', 'json', 'youdao']

/** 释义快照上限，与 wordbook 的 GLOSS_MAX 对齐。 */
    const MAX_GLOSS = 120

/** 词头只认「字母开头 + 字母/撇号/连字符」，与 wordbook.importMany 同一条规则。 */
    const HEAD_RE = /^[a-z][a-z'-]{0,63}$/

/** 汉字（含扩展 A 与常用标点区不参与判断）。 */
    const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/

/** 音标：/…/ 或 […] 。有道与 ECDICT 导出都用这两种写法。 */
    const PHONETIC = /(\/[^/\n\r]{1,40}\/|\[[^\]\n\r]{1,40}\])/

/** 裸音标（列式导出里常见，没有斜杠外壳）：IPA 字符 + 重音符 + 字母数字，无汉字。 */
    const BARE_PHONETIC = /^[a-zæɑɒɔəɜɪʊʌʃʒθðŋːˈˌˑ.,\s'-]{1,40}$/i

/**
 * 表头首字段。只在「这一行确实有多列」时才算表头 ——
 * 否则用户想导入单词 `word` 本身就会被吃掉。
 */
    const HEADER_FIRST = new Set([
      'word', 'words', 'head', 'term', 'terms', 'spelling', 'english', 'no', 'index',
      '单词', '英文', '词汇', '词头', '序号',
      'phonetic', 'pron', '音标', 'pronunciation',
      'meaning', 'translation', 'gloss', '释义', '翻译', '中文', '词义',
    ])

/** 取第一行有内容的行（跳过空行与 # 注释）。 */
    function firstContentLine(text) {
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (line === '' || line.startsWith('#')) continue
        return line
      }
      return ''
    }

/**
 * 识别文本格式。识别不出来一律当 plain（plain 是最宽松的，不会漏词）。
 *
 * @param {string} text
 * @returns {'plain'|'csv'|'tsv'|'json'|'youdao'}
 */
    function detectImportFormat(text) {
      if (typeof text !== 'string' || text.trim() === '') return 'plain'
      const trimmed = text.trim()
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) return 'json'
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.words)) return 'json'
        } catch { /* 不是合法 JSON，继续按文本猜 */ }
      }
      const line = firstContentLine(text)
      if (line === '') return 'plain'
      if (line.includes('\t') && line.split('\t').filter((part) => part.trim() !== '').length >= 2) return 'tsv'
      if (line.includes(',') && line.split(',').filter((part) => part.trim() !== '').length >= 2) return 'csv'
      if (/\s{2,}/.test(line) && PHONETIC.test(line)) return 'youdao'
      return 'plain'
    }

/** 把一行按格式切成若干字段。 */
    function splitFields(line, format) {
      if (format === 'csv') return line.split(',').map((part) => part.trim())
      if (format === 'tsv') return line.split('\t').map((part) => part.trim())
  // plain / youdao：双空格或 Tab 分隔；单空格的分隔交给「首词 + 剩余」处理
      if (/\s{2,}|\t/.test(line)) return line.split(/\s{2,}|\t/).map((part) => part.trim())
      return null
    }

/** 去掉包裹的引号与首尾空白。 */
    const unquote = (value) => String(value ?? '').trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim()

/**
 * 造一行预览数据。
 *
 * @param {string} head 已 normalize 的词头
 * @param {string} gloss 中文释义（可能为空）
 * @param {string} phonetic 音标（带 /…/ 或 […] 外壳，可能为空）
 * @param {number} line 原始行号（JSON 用元素序号）
 * @param {{ isDup: Function, isKnown: Function }} probes
 */
    function makeRow(head, gloss, phonetic, line, probes, extra) {
      const status = probes.isDup(head) ? 'dup' : probes.isKnown(head) ? 'new' : 'nodict'
      const row = { head, gloss, phonetic, line, status }
      if (extra && typeof extra === 'object') row.record = extra
      return row
    }

/**
 * 从「首字段之外的剩余文本」里切出音标与释义。
 *
 * 音标只当识别标记：设计规定不单独建字段，写库时拼在 gloss 前缀。
 * 两种写法都认：带外壳的 `/…/`、`[…]`，以及 CSV/TSV 里单独一列的裸 IPA
 * （列式导出经常这样，如 `apple,ˈæpl,n. 苹果`）。
 */
    function splitGlossAndPhonetic(rest) {
      const text = String(rest ?? '').replace(/\s+/g, ' ').trim()
      if (text === '') return { gloss: '', phonetic: '' }

      const match = PHONETIC.exec(text)
      if (match) {
        const phonetic = match[0]
        const without = `${text.slice(0, match.index)} ${text.slice(match.index + phonetic.length)}`
          .replace(/\s+/g, ' ').trim()
        return { gloss: HAN.test(without) ? without.slice(0, MAX_GLOSS) : '', phonetic }
      }

  // 裸 IPA：首段没有汉字、且带 IPA 专用字符，就当作音标摘掉
      const first = text.split(' ')[0]
      if (BARE_PHONETIC.test(first) && !HAN.test(first) && /[ˈˌːəɪʊʃʒθðŋæɑɒɔɜʌ]/.test(first)) {
        const without = text.slice(first.length).trim()
        return { gloss: HAN.test(without) ? without.slice(0, MAX_GLOSS) : '', phonetic: first }
      }

      return { gloss: HAN.test(text) ? text.slice(0, MAX_GLOSS) : '', phonetic: '' }
    }

/** 文本行模式（plain / csv / tsv / youdao）。 */
    function parseLines(text, format, opts) {
      const words = []
      const skipped = []
      const seen = new Set()
      const lines = text.split(/\r?\n/)

      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i]
        const line = raw.trim()
        const lineNo = i + 1
        if (line === '') {
          skipped.push({ line: lineNo, raw: '', reason: '空行' })
          continue
        }
        if (line.startsWith('#')) {
          skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '注释行' })
          continue
        }

        const fields = splitFields(line, format)
    // plain 模式下「单空格分隔」不算分隔符：首词就是词头，剩下的是释义
        const firstField = fields ? fields[0] : (line.split(/\s+/)[0] ?? '')
        const rest = fields
          ? fields.slice(1).join(' ')
          : line.split(/\s+/).slice(1).join(' ')

    // 表头：只有多列时才算，且只在还没收到任何词之前
        if (opts.skipHeader && words.length === 0 && fields && fields.length >= 2
          && HEADER_FIRST.has(unquote(firstField).toLowerCase())) {
          skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '表头行' })
          continue
        }

    // 首字段可能带引号或序号前缀；plain 模式首字段就是第一个非空白片段
        const head = normalizeKey(unquote(firstField))
        if (!HEAD_RE.test(head)) {
          skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '不是英文单词' })
          continue
        }
        if (seen.has(head)) {
          skipped.push({ line: lineNo, raw: line.slice(0, 80), reason: '重复行' })
          continue
        }
        seen.add(head)
        const { gloss, phonetic } = splitGlossAndPhonetic(rest)
        words.push(makeRow(head, gloss, phonetic, lineNo, opts))
      }

      return { words, skipped, format }
    }

/** JSON 数组模式。 */
    function parseJson(text, opts) {
      const words = []
      const skipped = []
      const seen = new Set()
      let parsed = null
      try {
        parsed = JSON.parse(text.trim())
      } catch {
        return {
          words,
          skipped: [{ line: 1, raw: text.trim().slice(0, 80), reason: 'JSON 解析失败' }],
          format: 'json',
        }
      }
      const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.words) ? parsed.words : [])
      if (list.length === 0) {
        return { words, skipped: [{ line: 1, raw: '', reason: 'JSON 里没有词条' }], format: 'json' }
      }

      for (let i = 0; i < list.length; i += 1) {
        const item = list[i]
        const lineNo = i + 1
        const isObject = item && typeof item === 'object' && !Array.isArray(item)
        const rawHead = isObject ? (item.head ?? item.word ?? '') : item
        const head = normalizeKey(unquote(rawHead))
        if (!HEAD_RE.test(head)) {
          skipped.push({ line: lineNo, raw: JSON.stringify(item).slice(0, 80), reason: '不是英文单词' })
          continue
        }
        if (seen.has(head)) {
          skipped.push({ line: lineNo, raw: JSON.stringify(item).slice(0, 80), reason: '重复行' })
          continue
        }
        seen.add(head)
        const gloss = isObject
          ? String(item.gloss ?? item.translation ?? item.meaning ?? '').trim().slice(0, MAX_GLOSS)
          : ''
        const phonetic = isObject && typeof item.phonetic === 'string' ? item.phonetic.trim() : ''
    // 备份恢复：整条记录原样带下去，importMany 会保住 state/srs/bookId
        words.push(makeRow(head, gloss, phonetic, lineNo, opts, isObject ? item : undefined))
      }

      return { words, skipped, format: 'json' }
    }

/**
 * 解析用户粘贴/导入的内容，给出逐行预览。
 *
 * @param {string} text
 * @param {{
 *   isDup?: (head: string) => boolean,
 *   isKnown?: (head: string) => boolean,
 *   skipHeader?: boolean,
 * }} [opts]
 *   isDup：这个词是否已在生词本（决定 dup 徽章）
 *   isKnown：词库能否查到（决定 nodict 徽章）；不给就一律当查得到
 *   skipHeader：是否跳过表头行，默认 true
 * @returns {{
 *   words: Array<{head:string, gloss:string, phonetic:string, line:number, status:'new'|'dup'|'nodict', record?:object}>,
 *   skipped: Array<{line:number, raw:string, reason:string}>,
 *   format: 'plain'|'csv'|'tsv'|'json'|'youdao',
 * }}
 */
    function parseImportDetailed(text, opts) {
      const options = opts && typeof opts === 'object' ? opts : {}
      const probes = {
        isDup: typeof options.isDup === 'function' ? options.isDup : () => false,
        isKnown: typeof options.isKnown === 'function' ? options.isKnown : () => true,
      }
      if (typeof text !== 'string' || text.trim() === '') {
        return { words: [], skipped: [], format: 'plain' }
      }
      const format = detectImportFormat(text)
      const parsed = format === 'json'
        ? parseJson(text, probes)
        : parseLines(text, format, { ...probes, skipHeader: options.skipHeader !== false })
      return parsed
    }

/**
 * 一行预览数据在写库时应该用的释义字符串。
 *
 * 音标不单独建字段（设计 §B2），拼在释义前缀里。
 *
 * @param {{ gloss?: string, phonetic?: string }} row
 * @returns {string}
 */
    function glossText(row) {
      if (!row || typeof row !== 'object') return ''
      const phonetic = typeof row.phonetic === 'string' ? row.phonetic.trim() : ''
      const gloss = typeof row.gloss === 'string' ? row.gloss.trim() : ''
      return `${phonetic} ${gloss}`.trim().slice(0, MAX_GLOSS)
    }

/**
 * 预览汇总：识别多少词、新增/已存在/未收录各多少。
 *
 * @param {{ words: Array<{status:string}>, skipped: Array<object> }} parsed
 * @returns {{ total:number, fresh:number, dup:number, nodict:number, skipped:number }}
 */
    function summarizeImport(parsed) {
      const words = Array.isArray(parsed?.words) ? parsed.words : []
      const out = { total: words.length, fresh: 0, dup: 0, nodict: 0, skipped: Array.isArray(parsed?.skipped) ? parsed.skipped.length : 0 }
      for (const row of words) {
        if (row.status === 'dup') out.dup += 1
        else if (row.status === 'nodict') out.nodict += 1
        else out.fresh += 1
      }
      return out
    }
      return { IMPORT_FORMATS, detectImportFormat, parseImportDetailed, glossText, summarizeImport }
    })()

    // ═══ review.js ═══
    var __mod_review = (function () {
      var { briefOf, describeEntry } = __mod_dict
      var { normalizeKey } = __mod_word
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


/** 三个评分按钮的显示文案，与设计 §B3 一致。 */
    const GRADE_BUTTONS = Object.freeze([
      { grade: 'again', key: '1', label: '✗ 不认识', tone: 'danger', state: 'unknown' },
      { grade: 'hard', key: '2', label: '↻ 记错', tone: 'warn', state: 'fuzzy' },
      { grade: 'good', key: '3', label: '✓ 认识', tone: 'success', state: 'known' },
    ])

/** 筛选芯片：全部到期 / 只刷不认识 / 只刷记错 / 指定词书（词书由下拉另选）。 */
    const REVIEW_FILTERS = Object.freeze([
      { id: 'all', label: '全部到期' },
      { id: 'unknown', label: '只刷不认识' },
      { id: 'fuzzy', label: '只刷记错' },
    ])

/** 队列空时的「提前复习」取多少个。 */
    const AHEAD_COUNT = 20

/** 方向：英→中 / 中→英。 */
    const DIRECTIONS = Object.freeze([
      { id: 'en-zh', label: '英 → 中' },
      { id: 'zh-en', label: '中 → 英' },
    ])

/**
 * 词条属于哪几本词书。
 *
 * @param {object} entry
 * @returns {string[]}
 */
    function booksOfEntry(entry) {
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

/**
 * 按筛选条件从词条数组里取复习队列。
 *
 * @param {object[]} entries 通常来自 `wordbook.dueQueue(now)`
 * @param {{ state?: 'all'|'unknown'|'fuzzy', bookId?: string }} [filter]
 * @returns {object[]}
 */
    function filterQueue(entries, filter) {
      const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.head === 'string' && e.head !== '') : []
      const state = filter?.state ?? 'all'
      const bookId = typeof filter?.bookId === 'string' && filter.bookId !== '' ? filter.bookId : ''
      return list.filter((entry) => {
        if (state !== 'all' && entry.state !== state) return false
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
    function briefTextFor(entry, dict) {
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
    function queueForDirection(queue, direction, dict) {
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
    function cardBackFor(head, dict) {
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
    function roundSummary(answered) {
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
    function dueLabel(due, now = Date.now()) {
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
    function aheadQueue(entries, count = AHEAD_COUNT, now = Date.now()) {
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
    function shouldHandleKey(event) {
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
    function actionForKey(key) {
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
    function canSpeak() {
      if (typeof speechSynthesis === 'undefined') return false
      if (typeof SpeechSynthesisUtterance === 'undefined') return false
      return typeof speechSynthesis.speak === 'function'
    }

/**
 * 念一个词；已经在念同一个词就停下（再点一次 = 停止）。
 *
 * 只走浏览器内置的 speechSynthesis，不引在线发音接口（离线红线）。
 * 任何异常都吃掉并返回 'failed'，卡片渲染路径上不能抛。
 *
 * @param {string} word
 * @returns {'speak' | 'stop' | 'unsupported' | 'failed'}
 */
    function speakWord(word) {
      if (!canSpeak()) return 'unsupported'
      const text = String(word ?? '').trim()
      if (text === '') return 'failed'
      try {
    // 再点一次 = 停止（设计 §E1）。先判有没有在念，有就 cancel 并返回 stop。
        if (speechSynthesis.speaking === true || speechSynthesis.pending === true) {
          speechSynthesis.cancel()
          return 'stop'
        }
    // 上一次的残留先清掉，避免队列里堆着旧词
        speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'en-US'
        utterance.rate = 0.9
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
    function PronounceButton(props) {
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
          const result = speakWord(word)
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
    function ReviewCardBack(props) {
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


      return { GRADE_BUTTONS, REVIEW_FILTERS, AHEAD_COUNT, DIRECTIONS, booksOfEntry, filterQueue, briefTextFor, queueForDirection, cardBackFor, roundSummary, dueLabel, aheadQueue, shouldHandleKey, actionForKey, canSpeak, speakWord, PronounceButton, ReviewCardBack }
    })()

    // ═══ marker.js ═══
    var __mod_marker = (function () {
      var { SELECTORS, HIT_BLOCKERS } = __mod_hit
      var { normalizeKey } = __mod_word
      var { DEFAULT_MARK_COLOR, MARK_STYLES, THEME_ERROR_COLOR } = __mod_config
/**
 * marker.js —— 正文/思考区生词着色（设计-v2 §C）。
 *
 * 用户需求原话：不会的单词在思考过程中是红色（可改颜色也可选择直接不变颜色），
 * 一眼看见自己之前不会的词。
 *
 * 本文件分三层，边界刻意分开：
 *   1. **纯函数层**（本任务主体）：词集展开、文本词匹配、视口裁剪、上限截断、
 *      扫描器、重算调度器 —— 全部不碰 React，可以 `node client/test/_marker.mjs` 直测；
 *   2. **量矩形**：只读 `Range.getClientRects()`，与 anchor.js 同一思路；
 *   3. **MarkerLayer**：把已经算好的色块画成 `position:fixed` 的 div，
 *      渲染进 `shell.overlay`（唯一 `h`/React 依赖点，由构建前导注入）。
 *
 * 红线（设计 §0 / 架构 §2）：**绝不改正文 DOM**。这里不建 span、不改正文节点属性、
 * 不写 textContent。着色只画在覆盖层里，垫在文字底下。
 *
 * 思考区判定用 `[data-variant="think"]`（设计 §G 已从宿主产物核实）。
 */


/** 主路径：CSS Custom Highlight API 的注册名（正文/思考生词）。 */
    const HIGHLIGHT_WORDS = 'dsh-hover-dict-words'

/** 已掌握词单独一个 highlight（淡色；用户开了「已掌握也显示」才用）。 */
    const HIGHLIGHT_KNOWN = 'dsh-hover-dict-known'

/** 单帧色块上限。超出按距视口中心距离取最近的（设计 §C2.3，**仅回退路径**）。 */
    const MARK_MAX = 400

/** 视口裁剪余量：上下左右各留这么多像素，滚动手感不会缺一块。 */
    const VIEWPORT_PAD_PX = 200

/** 滚动重算节流间隔（设计 §C2.4）。 */
    const SCROLL_THROTTLE_MS = 120

/** 正文变化的防抖间隔。流式输出期间靠它把重渲染合并成低频重算（§G 硬要求）。 */
    const MUTATION_DEBOUNCE_MS = 250

/** 思考区根节点的特征属性。折叠时正文不在 DOM，TreeWalker 天然扫不到。 */
    const THINK_SELECTOR = '[data-variant="think"]'

/**
 * 词匹配用的正则：字母开头，后可跟字母、撇号（直/弯）、连字符，总长 ≤ 64。
 * 与 word.js 的 MAX_WORD_LEN 口径一致。
 */
    const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]{0,63}/g

/** 一个矩形，视口坐标系（与 getBoundingClientRect 一致）。 */
/**
 * @typedef {object} MarkerRect
 * @property {number} left
 * @property {number} top
 * @property {number} right
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * 一次词命中：文本节点内的字符区间 + 归一化后的词键。
 *
 * @typedef {object} MarkerHit
 * @property {Text} node
 * @property {number} start
 * @property {number} end
 * @property {string} text   原文片段（保留大小写，仅用于调试与日志）
 * @property {string} key    normalizeKey 之后的键，查词集用
 * @property {boolean} think 是否落在思考区
 */

/**
 * 一个待画的色块组：一个命中的全部矩形（跨行会有多段）。
 *
 * @typedef {object} MarkerMark
 * @property {string} key
 * @property {string} text
 * @property {boolean} think
 * @property {boolean} known  词集里带「已掌握」标记的词（淡色显示）
 * @property {MarkerRect[]} rects
 * @property {MarkerRect | null} bounds
 */

/* ── 小工具 ─────────────────────────────────────────────────────────── */

    const isNum = (value) => typeof value === 'number' && Number.isFinite(value)

    const rectOf = (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const left = isNum(raw.left) ? raw.left : NaN
      const top = isNum(raw.top) ? raw.top : NaN
      const right = isNum(raw.right) ? raw.right : (isNum(raw.width) && isNum(left) ? left + raw.width : NaN)
      const bottom = isNum(raw.bottom) ? raw.bottom : (isNum(raw.height) && isNum(top) ? top + raw.height : NaN)
      if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
        return null
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }

/** 一组矩形取并集；空数组返回 null。 */
    function unionRectsOf(rects) {
      if (!Array.isArray(rects) || rects.length === 0) return null
      let left = Infinity
      let top = Infinity
      let right = -Infinity
      let bottom = -Infinity
      for (const raw of rects) {
        const rect = rectOf(raw)
        if (!rect) continue
        if (rect.left < left) left = rect.left
        if (rect.top < top) top = rect.top
        if (rect.right > right) right = rect.right
        if (rect.bottom > bottom) bottom = rect.bottom
      }
      if (left === Infinity) return null
      return { left, top, right, bottom, width: right - left, height: bottom - top }
    }

/* ── C1.1 词集展开 ─────────────────────────────────────────────────── */

/**
 * 把生词本展开成「要着色的词键集合」。
 *
 * 口径（设计 §C1）：
 *   - 只取 `state !== 'known'` 的词；`known` 默认不着色（已掌握就不该再刺眼），
 *     设置里开 `markKnown` 才收进来（渲染时给淡色）；
 *   - 每个词头连同它的**变位**一起收：变位串在词条槽 5 起、格式 `p:ran/i:running`，
 *     与 dict.js `parseForms` / app.js `collectBookSet` 同一条规则
 *     （架构.md 旧文档写的槽 3 已作废，别按那个写）。
 *
 * 词集为空是常态（新用户），调用方据此直接清空色块、跳过整轮扫描。
 *
 * @param {object} input
 * @param {Iterable<{ head: string, state?: string }>} [input.entries] 生词本 list()
 * @param {{ entries?: Record<string, any[]> } | null} [input.dict]     词库（可选）
 * @param {boolean} [input.markKnown] 是否连已掌握的词一起收
 * @returns {Map<string, boolean>} 键 → 是否「已掌握」（true 时渲染淡色）
 */
    function expandWordSet(input) {
      const out = new Map()
      const entries = input?.entries
      if (!entries) return out
      const dict = input?.dict ?? null
      const markKnown = input?.markKnown === true

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue
        const head = normalizeKey(entry.head)
        if (!head) continue
        const known = entry.state === 'known'
        if (known && !markKnown) continue
        out.set(head, known)

        const node = dict?.entries?.[head]
        if (!Array.isArray(node)) continue
        for (let i = 5; i < node.length; i += 1) {
          const slot = node[i]
          if (typeof slot !== 'string') continue
          for (const part of slot.split('/')) {
            const colon = part.indexOf(':')
            if (colon <= 0) continue
            const form = normalizeKey(part.slice(colon + 1))
        // 变位表单里可能自带句尾标点，normalizeKey 只处理撇号与大小写，这里再裁一次
            const trimmed = form.replace(/^[^a-z]+|[^a-z'-]+$/g, '')
            if (!trimmed) continue
        // 词头比变位优先：已知的词头不要被变位的淡色标记覆盖
            if (out.has(trimmed) && !out.get(trimmed)) continue
            out.set(trimmed, known)
          }
        }
      }
      return out
    }

/* ── C1.2 文本节点词匹配 ───────────────────────────────────────────── */

/**
 * 在一个文本节点的字符串里找出所有「在词集里」的词。
 *
 * 正则 `/[A-Za-z][A-Za-z'’-]{0,63}/g`，normalizeKey 后查 Set —— 大小写不敏感。
 * 不处理词组、不做词形还原（变位已经在词集里了）。
 *
 * @param {string} text
 * @param {Map<string, boolean> | Set<string>} keys
 * @returns {Array<{ start: number, end: number, text: string, key: string, known: boolean }>}
 */
    function matchWordsInText(text, keys) {
      const out = []
      if (typeof text !== 'string' || text === '' || !keys) return out
      const isMap = typeof keys.get === 'function'
      const has = typeof keys.has === 'function'
        ? (key) => keys.has(key)
        : (key) => typeof keys[key] === 'boolean'

      WORD_PATTERN.lastIndex = 0
      let match = WORD_PATTERN.exec(text)
      while (match !== null) {
        const raw = match[0]
    // 正则允许词尾是撇号/连字符（`don't` 的撇号在中间，`well-` 在词尾是断词），裁掉
        const trimmed = raw.replace(/['’-]+$/, '')
        if (trimmed.length >= 2) {
          const key = normalizeKey(trimmed)
          if (key && has(key)) {
            out.push({
              start: match.index,
              end: match.index + trimmed.length,
              text: trimmed,
              key,
              known: isMap ? keys.get(key) === true : false,
            })
          }
        }
        match = WORD_PATTERN.exec(text)
      }
      return out
    }

/* ── C1.3 视口裁剪与上限截断 ───────────────────────────────────────── */

/**
 * 只留与「视口 + 余量」相交的矩形。
 *
 * @param {MarkerRect[] | Array<{ rects?: MarkerRect[] }>} input
 * @param {{ left: number, top: number, right: number, bottom: number } | { width: number, height: number }} viewport
 * @param {number} [pad] 默认 ±200px
 * @returns {MarkerRect[]}
 */
    function cullToViewport(input, viewport, pad) {
      const list = Array.isArray(input) ? input : []
      if (list.length === 0) return []
      const margin = isNum(pad) ? pad : VIEWPORT_PAD_PX
      const box = normalizeViewport(viewport, margin)
      if (!box) return list.map(rectOf).filter(Boolean)
      const out = []
      for (const item of list) {
        const rect = rectOf(item)
        if (!rect) continue
        if (rect.right < box.left || rect.left > box.right) continue
        if (rect.bottom < box.top || rect.top > box.bottom) continue
        out.push(rect)
      }
      return out
    }

/**
 * 把视口形状统一成带余量的包围盒。接受 `{left,top,right,bottom}` 或 `{width,height}`。
 *
 * @param {object} viewport
 * @param {number} pad
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
    function normalizeViewport(viewport, pad) {
      const margin = isNum(pad) ? pad : VIEWPORT_PAD_PX
      if (!viewport || typeof viewport !== 'object') return null
      if ([viewport.left, viewport.top, viewport.right, viewport.bottom].every(isNum)) {
        return {
          left: viewport.left - margin,
          top: viewport.top - margin,
          right: viewport.right + margin,
          bottom: viewport.bottom + margin,
        }
      }
      if (isNum(viewport.width) && isNum(viewport.height)) {
        return {
          left: (isNum(viewport.scrollX) ? -viewport.scrollX : 0) - margin,
          top: (isNum(viewport.scrollY) ? -viewport.scrollY : 0) - margin,
          right: viewport.width - (isNum(viewport.scrollX) ? viewport.scrollX : 0) + margin,
          bottom: viewport.height - (isNum(viewport.scrollY) ? viewport.scrollY : 0) + margin,
        }
      }
      return null
    }

/**
 * 从 document/window 读当前视口（真实运行环境用；测试里可直接传 viewport 对象）。
 *
 * @param {Document | null} doc
 * @returns {{ left: number, top: number, right: number, bottom: number } | null}
 */
    function viewportOf(doc) {
      const win = doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)
      if (!win || !isNum(win.innerWidth) || !isNum(win.innerHeight)) return null
      return { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }
    }

/**
 * 上限截断：色块数超过 `max` 时，按「距视口中心距离」从近到远取前 max 个。
 *
 * 为什么按中心距离而不是 DOM 顺序：用户眼睛盯着屏幕中间，先保中间的可读性；
 * 一屏 400 个色块已经是失控状态（正常一屏几十个），保近处比保「文档前面」有用。
 *
 * @template {{ rects?: MarkerRect[], bounds?: MarkerRect | null }} T
 * @param {T[]} marks
 * @param {{ max?: number, viewport?: object | null }} [options]
 * @returns {T[]}
 */
    function capMarks(marks, options) {
      const list = Array.isArray(marks) ? marks : []
      const max = isNum(options?.max) && options.max > 0 ? Math.floor(options.max) : MARK_MAX
      if (list.length <= max) return list

      const box = normalizeViewport(options?.viewport, 0)
      const cx = box ? (box.left + box.right) / 2 : 0
      const cy = box ? (box.top + box.bottom) / 2 : 0

      const ranked = list.map((mark, index) => {
        const bounds = rectOf(mark?.bounds) ?? unionRectsOf(mark?.rects ?? [])
        if (!bounds) return { mark, index, distance: Infinity }
        const dx = (bounds.left + bounds.right) / 2 - cx
        const dy = (bounds.top + bounds.bottom) / 2 - cy
        return { mark, index, distance: dx * dx + dy * dy }
      })

  // 同距离保持原顺序（稳定排序），否则滚动时色块会无规律跳动
      ranked.sort((a, b) => (a.distance - b.distance) || (a.index - b.index))
      return ranked.slice(0, max).sort((a, b) => a.index - b.index).map((row) => row.mark)
    }

/* ── C1.4 扫描器（TreeWalker） ─────────────────────────────────────── */

/**
 * 判定一个元素是不是「不许着色」的区域（复用 hit.js 的 HIT_BLOCKERS，不重写判定）。
 *
 * @param {Element | null} el
 * @returns {{ blocked: boolean, reason: string }}
 */
    function blockerOf(el) {
      if (!el || typeof el.closest !== 'function') return { blocked: false, reason: 'unknown' }
      for (const blocker of HIT_BLOCKERS) {
        let hit = false
        try { hit = blocker.matches(el) === true } catch { hit = false }
        if (hit) return { blocked: true, reason: blocker.reason }
      }
      return { blocked: false, reason: 'ok' }
    }

/**
 * 收集一个根节点下的全部文本节点（文档顺序）。
 *
 * 优先用 `doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)`；环境/测试桩没有它时
 * 退化成递归遍历，结果顺序一致。**退化路径是给 node 单测用的**，真实浏览器永远走 TreeWalker。
 *
 * @param {Document | null} doc
 * @param {Node | null} root
 * @returns {Text[]}
 */
    function collectTextNodes(doc, root) {
      if (!root) return []
      const nodes = []
      if (doc && typeof doc.createTreeWalker === 'function') {
        let walker = null
        try {
          walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
        } catch {
          walker = null
        }
        if (walker && typeof walker.nextNode === 'function') {
          let node = walker.nextNode()
          while (node) {
            if (node.nodeType === 3) nodes.push(node)
            node = walker.nextNode()
          }
          return nodes
        }
      }
      const stack = [root]
      while (stack.length > 0) {
        const current = stack.pop()
        const kids = current?.childNodes
        if (!kids) continue
        for (let i = kids.length - 1; i >= 0; i -= 1) {
          const kid = kids[i]
          if (!kid) continue
          if (kid.nodeType === 3) nodes.push(kid)
          else if (kid.childNodes) stack.push(kid)
        }
      }
      return nodes
    }

/**
 * 把 root 参数解析成根节点数组：选择器串 → 全部匹配；元素 → 单元素。
 *
 * @param {Document | null} doc
 * @param {Node | Node[] | string | null} [root]
 * @returns {Node[]}
 */
    function resolveRoots(doc, root) {
      if (Array.isArray(root)) return root.filter(Boolean)
      if (root === null || root === undefined) {
        return collectBySelector(doc, SELECTORS.allowedRoot)
      }
      if (typeof root === 'string') return collectBySelector(doc, root)
      if (typeof root === 'object') return [root]
      return []
    }

    function collectBySelector(doc, selector) {
      if (!doc || typeof doc.querySelectorAll !== 'function' || typeof selector !== 'string' || selector === '') return []
      try {
        return [...doc.querySelectorAll(selector)]
      } catch {
        return []
      }
    }

/** 取文本节点的字符串内容（老环境与测试桩可能只有 data）。 */
    function textOfNode(node) {
      if (!node) return ''
      if (typeof node.nodeValue === 'string') return node.nodeValue
      if (typeof node.data === 'string') return node.data
      return ''
    }

/**
 * 扫描一遍：输入 doc + 根选择器 + 词集，输出命中区间列表。
 *
 * 排除（沿用 hit.js，不重写）：代码块、行内代码、公式、链接、用户消息、
 * 工具调用卡片、输入框、本插件自己的覆盖层 —— 最后的 `[data-hover-dict-ui]`
 * 顺带保证色块自己不会被再扫一遍（否则会无限套娃）。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root] 省略时用 SELECTORS.allowedRoot
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @param {boolean} [input.think] 是否把 `think: true` 标在命中上（思考区判定）
 * @returns {MarkerHit[]}
 */
    function scanTextNodes(input) {
      const doc = input?.doc ?? null
      const keys = input?.keys
      const out = []
      if (!keys || typeof keys.has !== 'function') return out
      if (typeof keys.size === 'number' && keys.size === 0) return out

      const roots = resolveRoots(doc, input?.root)
      if (roots.length === 0) return out

      for (const root of roots) {
        for (const node of collectTextNodes(doc, root)) {
          const text = textOfNode(node)
          if (text === '') continue
          const parent = node.parentElement ?? node.parentNode ?? null
          if (parent && blockerOf(parent).blocked) continue
          const matches = matchWordsInText(text, keys)
          if (matches.length === 0) continue
          const inThink = typeof parent?.closest === 'function' && parent.closest(THINK_SELECTOR) !== null
          for (const match of matches) {
            out.push({
              node,
              start: match.start,
              end: match.end,
              text: match.text,
              key: match.key,
          // known 来自词集的值（matchWordsInText 已经从 Map 取出来了）。
          // 之前这里漏传，导致 Highlight 主路径没法把「已掌握」单独分桶。
              known: match.known === true,
              think: inThink,
            })
          }
        }
      }
      return out
    }

/* ── 量矩形（只读，不改 DOM） ──────────────────────────────────────── */

/**
 * 把命中区间量成视口矩形。跨行时一个命中会有多段，**逐段保留**。
 *
 * @param {MarkerHit[]} hits
 * @param {{ doc?: Document | null }} [options]
 * @returns {MarkerMark[]}
 */
    function measureHits(hits, options) {
      const list = Array.isArray(hits) ? hits : []
      const out = []
      if (list.length === 0) return out
      const doc = options?.doc ?? (typeof document !== 'undefined' ? document : null)
      if (!doc || typeof doc.createRange !== 'function') return out

      for (const hit of list) {
        const node = hit?.node
        if (!node || typeof node.nodeType !== 'number') continue
        let range = null
        try {
          range = doc.createRange()
          range.setStart(node, hit.start)
          range.setEnd(node, hit.end)
        } catch {
      // 节点已脱离文档 / 偏移越界：跳过，不抛
          continue
        }
        let raw = []
        try {
          raw = range.getClientRects ? [...range.getClientRects()] : []
        } catch {
          raw = []
        }
        const rects = []
        for (const item of raw) {
          const rect = rectOf(item)
      // 换行处的空 Range 会给出 0 宽/0 高矩形，画出来是脏点
          if (!rect || rect.width <= 0 || rect.height <= 0) continue
          rects.push(rect)
        }
        if (rects.length === 0) continue
    // rangeRefs 与 rects **等长**：跨行时一个命中对应 N 段矩形，而它们全部来自
    // 同一个 Range。所以 refs 里是同一条 {node,start,end} 重复 N 次 —— 形状上
    // 满足「一一对应」（快路径按下标取 div 时不用再算映射），语义上快路径必须
    // **按 mark 去重**只量一次，否则 224 块会变成 224 次重复 layout。
        const rangeRef = { node, start: hit.start, end: hit.end }
        const rangeRefs = new Array(rects.length)
        for (let i = 0; i < rects.length; i += 1) rangeRefs[i] = rangeRef
        out.push({
          key: hit.key,
          text: hit.text,
          think: hit.think === true,
          known: hit.known === true,
          rects,
          rangeRefs,
          bounds: unionRectsOf(rects),
        })
      }
      return out
    }

/**
 * 一次完整重算的纯函数流水线：扫描 → 量矩形 → 视口裁剪 → 上限截断。
 *
 * 生词本变化、滚动、resize、DOM 变化最终都调这一个函数；它不做渲染，
 * 只交出「这一帧该画哪些色块」。色块为空数组时调用方应直接清空覆盖层并返回。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root]
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @param {object} [input.viewport] 省略时从 doc.defaultView 读
 * @param {number} [input.pad] 视口余量
 * @param {number} [input.max] 上限
 * @returns {MarkerMark[]}
 */
    function buildMarks(input) {
      const doc = input?.doc ?? null
      const keys = input?.keys
      if (!keys || typeof keys.has !== 'function') return []
      if (typeof keys.size === 'number' && keys.size === 0) return []

      const hits = scanTextNodes({ doc, root: input?.root, keys })
      if (hits.length === 0) return []

      const marks = measureHits(hits, { doc })
      if (marks.length === 0) return []

      const viewport = input?.viewport ?? viewportOf(doc)
      const pad = isNum(input?.pad) ? input.pad : VIEWPORT_PAD_PX
      const marksWithPad = viewport
        ? marks
          .map((mark) => {
        // 裁剪要同时保留「留下来的段」对应的 rangeRefs 下标，否则快路径
        // 按下标写样式会写到别的段上（§C2.3 裁剪 + 快路径必须共用同一套下标）。
            const kept = []
            const keptRefs = []
            const source = Array.isArray(mark.rects) ? mark.rects : []
            const refs = Array.isArray(mark.rangeRefs) ? mark.rangeRefs : []
            const box = normalizeViewport(viewport, pad)
            for (let i = 0; i < source.length; i += 1) {
              const rect = rectOf(source[i])
              if (!rect) continue
              if (box && (rect.right < box.left || rect.left > box.right
                || rect.bottom < box.top || rect.top > box.bottom)) continue
              kept.push(rect)
              keptRefs.push(refs[i] ?? refs[0] ?? { node: null, start: 0, end: 0 })
            }
            if (kept.length === 0) return null
            return { ...mark, rects: kept, rangeRefs: keptRefs, bounds: unionRectsOf(kept) }
          })
          .filter(Boolean)
        : marks

      return capMarks(marksWithPad, { max: input?.max, viewport })
    }

/* ── C1.5 重算调度器（纯逻辑，时钟可注入） ─────────────────────────── */

/**
 * 重算调度器：把三类触发源（滚动 / DOM 变化 / resize）合并成低频重算。
 *
 * 规则（设计 §C2.4）：
 *   - 滚动：节流 120ms —— 首次立即重算，窗口内后续只挂一个尾随调用；
 *   - 正文变化：防抖 250ms —— 每次调用都把计时器往后推，静默满 250ms 才跑
 *     （流式输出期间自然合并成低频重算）；
 *   - resize：立即重算，并取消挂起的尾随/防抖（尺寸变了，之前算的都作废）。
 *
 * 时钟与计时器可注入，所以 `_marker.mjs` 用假时钟就能把节流/防抖的时序断言干净。
 *
 * @param {object} options
 * @param {() => void} options.run 重算动作
 * @param {() => number} [options.now]
 * @param {(fn: () => void, ms: number) => any} [options.setTimeout]
 * @param {(handle: any) => void} [options.clearTimeout]
 * @param {number} [options.scrollThrottleMs]
 * @param {number} [options.mutationDebounceMs]
 * @returns {{
 *   scroll: () => void, mutate: () => void, resize: () => void,
 *   request: () => void, cancel: () => void, dispose: () => void,
 *   pending: () => { throttle: boolean, debounce: boolean },
 *   runs: () => number, lastRunAt: () => number
 * }}
 */
    function createRecalcScheduler(options) {
      const run = typeof options?.run === 'function' ? options.run : () => {}
      const now = typeof options?.now === 'function' ? options.now : Date.now
      const setT = typeof options?.setTimeout === 'function' ? options.setTimeout : (fn, ms) => setTimeout(fn, ms)
      const clearT = typeof options?.clearTimeout === 'function' ? options.clearTimeout : (handle) => clearTimeout(handle)
      const throttleMs = isNum(options?.scrollThrottleMs) ? options.scrollThrottleMs : SCROLL_THROTTLE_MS
      const debounceMs = isNum(options?.mutationDebounceMs) ? options.mutationDebounceMs : MUTATION_DEBOUNCE_MS

      let lastRunAt = -Infinity
      let throttleTimer = null
      let debounceTimer = null
      let disposed = false
      let runs = 0

      const fire = () => {
        if (disposed) return
        lastRunAt = now()
        runs += 1
        try { run() } catch { /* 重算失败不该让监听器连锁崩溃 */ }
      }

      const clearThrottle = () => {
        if (throttleTimer === null) return
        try { clearT(throttleTimer) } catch { /* ignore */ }
        throttleTimer = null
      }

      const clearDebounce = () => {
        if (debounceTimer === null) return
        try { clearT(debounceTimer) } catch { /* ignore */ }
        debounceTimer = null
      }

      const scroll = () => {
        if (disposed) return
        const elapsed = now() - lastRunAt
        if (elapsed >= throttleMs) {
          clearThrottle()
          fire()
          return
        }
    // 窗口内：只挂一个尾随调用，后续 scroll 不再叠加
        if (throttleTimer !== null) return
        throttleTimer = setT(() => {
          throttleTimer = null
          fire()
        }, Math.max(0, throttleMs - elapsed))
      }

      const mutate = () => {
        if (disposed) return
        clearDebounce()
        debounceTimer = setT(() => {
          debounceTimer = null
          fire()
        }, debounceMs)
      }

      const resize = () => {
        if (disposed) return
    // 尺寸变了，挂起的滚动尾随与防抖都已过期
        clearThrottle()
        clearDebounce()
        fire()
      }

      const cancel = () => {
        clearThrottle()
        clearDebounce()
      }

      return {
        scroll,
        mutate,
        resize,
        request: fire,
        cancel,
        dispose: () => { disposed = true; cancel() },
        pending: () => ({ throttle: throttleTimer !== null, debounce: debounceTimer !== null }),
        runs: () => runs,
        lastRunAt: () => lastRunAt,
      }
    }

/**
 * 把调度器接到真实 DOM 事件上。**只挂监听，不写 DOM**。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {ReturnType<typeof createRecalcScheduler>} input.scheduler
 * @param {{ addEventListener?: Function, removeEventListener?: Function } | null} [input.win]
 * @returns {() => void} disposer
 */
    function bindRecalcEvents(input) {
      const doc = input?.doc ?? null
      const scheduler = input?.scheduler
      const win = input?.win ?? doc?.defaultView ?? null
      if (!scheduler) return () => {}
      const pairs = []
      const on = (target, type, handler, opts) => {
        if (!target || typeof target.addEventListener !== 'function') return
        try { target.addEventListener(type, handler, opts) } catch { return }
        pairs.push([target, type, handler, opts])
      }

  // 滚动用 capture：程序滚动（流式输出跟随）也要能触发重算。
  //
  // 走 Highlight 主路径时纯滚动**不需要**重算（字色跟文字走），这里保留节流重算
  // 只是为了兜住「滚动推出新一批文本节点」（虚拟列表）与 resize 后的换行变化。
      on(win, 'scroll', () => scheduler.scroll(), { capture: true, passive: true })
      on(win, 'resize', () => scheduler.resize(), { passive: true })

  // MutationObserver：流式输出期间靠 250ms 防抖合并（§G：不许更激进）。
  //
  // 观察目标先取 chatRegion。**拿不到就退到 documentElement 整棵观察** ——
  // apply 跑的时候会话区往往还没渲染出来（用户还没发第一句话），
  // 只挂 chatRegion 会让 observer 永久挂空，流式输出反而不会触发重算。
  // 整棵观察的成本由 250ms 防抖吸收：一帧内再多的变动也只排一次重算。
      let observer = null
      const observe = (target) => {
        if (!target || typeof MutationObserver !== 'function') return false
        const next = new MutationObserver(() => scheduler.mutate())
        try {
          next.observe(target, { childList: true, subtree: true, characterData: true })
        } catch {
          return false
        }
        observer = next
        return true
      }
      if (doc && typeof doc.querySelector === 'function') {
        const region = doc.querySelector(SELECTORS.chatRegion)
        const target = region ?? doc.documentElement ?? doc.body ?? null
        observe(target)
      }

      return () => {
        for (const [target, type, handler, opts] of pairs) {
          try { target.removeEventListener(type, handler, opts) } catch { /* ignore */ }
        }
        pairs.length = 0
        try { observer?.disconnect() } catch { /* ignore */ }
        observer = null
      }
    }

/* ── C2 画法：色块样式与渲染组件 ───────────────────────────────────── */

/**
 * 用户色 → `color-mix()` 表达式。亮/暗主题都不发黑（设计 §C2.2 否掉了 multiply）。
 *
 * @param {string} color hex
 * @param {number} percent 底色浓度
 * @param {number} alpha 额外透明度（已掌握词用 0.5）
 * @returns {string}
 */
    function colorMix(color, percent, alpha) {
  // 走 markColorToCss：它把 theme-error 哨兵翻成 var(...) 并带 hex 兜底，
  // 坏值也回落同一个 token —— 所以这里永远拿到一个合法的 CSS 颜色分量
  // （color-mix 支持 var() 参与求值）。
      const css = markColorToCss(color)
      const ratio = isNum(percent) ? Math.min(Math.max(percent, 0), 100) : 18
      const fade = isNum(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1
      const value = fade >= 1
        ? `color-mix(in srgb, ${css} ${ratio}%, transparent)`
        : `color-mix(in srgb, ${css} ${Math.round(ratio * fade)}%, transparent)`
      return value
    }

/**
 * 一个色块的内联样式。三种 markStyle（设计 §C4）：
 *   underline  半透明底色 + 1.5px 下划线（默认）
 *   background 仅底色
 *   text       仅下划线
 *
 * 文字颜色不动 —— 改不了正文，垫底 + 下划线足够醒目。
 *
 * @param {MarkerRect} rect
 * @param {{ known?: boolean }} [mark]
 * @param {{ markColor?: string, markStyle?: string, markKnown?: boolean }} [appearance]
 * @returns {object}
 */
    function styleOfMark(rect, mark, appearance) {
      const box = rectOf(rect)
      if (!box) return { display: 'none' }
      const color = typeof appearance?.markColor === 'string' ? appearance.markColor : DEFAULT_MARK_COLOR
      const style = MARK_STYLES.includes(appearance?.markStyle) ? appearance.markStyle : 'underline'
      const known = mark?.known === true
      const base = {
        position: 'fixed',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        pointerEvents: 'none',
        borderRadius: '2px',
    // 色块本身不许被选中、不许被查词扫描到（覆盖层带 data-hover-dict-ui）
        userSelect: 'none',
      }
      if (known) base.opacity = 0.5
      if (style === 'background') {
        base.background = colorMix(color, 26, known ? 0.6 : 1)
        return base
      }
      if (style === 'text') {
        base.borderBottom = `1.5px solid ${color}`
        return base
      }
      base.background = colorMix(color, 18, known ? 0.6 : 1)
      base.borderBottom = `1.5px solid ${color}`
      return base
    }

/**
 * 色块层组件：渲染进 `shell.overlay`，与浮层/大卡片是兄弟，key 用 'markers'。
 *
 * 组件只画**已经算好**的色块（几何由 buildMarks 给），自身不扫描、不监听事件 ——
 * 监听与重算在 app.js 的接线里（t8），这样渲染路径永远没有重活，不会拖帧。
 *
 * `h` 由构建前导注入；本组件在 node 单测里不会被调用。
 *
 * @param {object} props
 * @param {MarkerMark[]} props.marks
 * @param {{ markColor?: string, markStyle?: string, markKnown?: boolean, markWords?: boolean }} [props.appearance]
 * @returns {import('react').ReactElement | null}
 */
    function MarkerLayer(props) {
      const appearance = props?.appearance
      if (appearance?.markWords === false) return null
      const marks = Array.isArray(props?.marks) ? props.marks : []
      if (marks.length === 0) return null

      const children = []
      for (let i = 0; i < marks.length; i += 1) {
        const mark = marks[i]
        const rects = Array.isArray(mark?.rects) ? mark.rects : []
        for (let j = 0; j < rects.length; j += 1) {
          children.push(h('div', {
            key: `${i}:${j}`,
            className: 'hd-mark',
        // 快路径靠它按 id 找到 div 直接改 style（不走 React）。格式 `${markIndex}:${rectIndex}`
        // 与 buildMarks 输出的 marks[i].rects[j] 一一对应。
            'data-mark-id': `${i}:${j}`,
            style: styleOfMark(rects[j], mark, appearance),
          }))
        }
      }
      if (children.length === 0) return null
      return h('div', { className: 'hd-marks', 'aria-hidden': 'true' }, children)
    }

/**
 * MarkerLayer 用到的 CSS 片段。由 overlay.js 的 ensureStyle 一并注入
 * （t3b 接线时追加，或调用这里的 markCss() 拼进去）。
 *
 * @returns {string}
 */
    function markCss() {
      return `
    [data-hover-dict-ui] .hd-marks {
      position: fixed;
      inset: 0;
      pointer-events: none;
      contain: layout style;
      z-index: 0;
    }
    [data-hover-dict-ui] .hd-mark {
      position: fixed;
      pointer-events: none;
    }
    `
    }
/* ── C2 主路径：CSS Custom Highlight API（用户裁定：只要改字的颜色） ─────────
 *
 * 用户原话：「我们不需要下划线和色块啊，只要改字的颜色即可。」
 *
 * Highlight API 是浏览器原生能力：`CSS.highlights.set(name, new Highlight(...ranges))`
 * 就能给指定文字区间上**文字颜色**，**完全不改正文 DOM**（不包 span、不加属性），
 * 所以「不改正文 DOM」那条红线天然守住。
 *
 * 它的另一个决定性好处：颜色是浏览器渲染时跟着文字走的，文字滚到哪颜色就到哪 ——
 * 之前「滚动时色块不跟字」的偏移问题**从根上不存在**，不需要 rAF 逐帧重测。
 *
 * 下面这套函数只在环境支持时启用；不支持（老浏览器/测试桩）就回退到色块方案
 * （buildMarks + MarkerLayer，仍在文件后半部分保留）。
 */

/**
 * 判断当前环境能不能用 Highlight API。
 *
 * 两条都要：`Highlight` 构造函数存在，且 `CSS.highlights`（HighlightRegistry）可用。
 * 缺一就回退 —— 只判其中一个会在某些实现里抛 TypeError。
 *
 * @param {object} [scope] 通常传 window/globalThis，单测可注入假对象
 * @returns {boolean}
 */
    function supportsHighlight(scope) {
      const host = scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
      if (!host) return false
      if (typeof host.Highlight !== 'function') return false
      const css = host.CSS
      if (!css || typeof css !== 'object') return false
      const registry = css.highlights
      if (!registry || typeof registry.set !== 'function') return false
      return true
    }

/**
 * 用户配置的 markColor → CSS 颜色值。
 *
 * - `theme-error` 哨兵 → `var(--dsw-alias-state-error-primary, #e5484d)`
 *   （带 hex 兜底：token 缺失时仍是可见的红，不会变成继承色）
 * - 合法 hex → 原样（小写归一）
 * - 其它 → 回落 theme-error 的 token
 *
 * @param {string} [color]
 * @returns {string}
 */
    function markColorToCss(color) {
      const raw = typeof color === 'string' ? color.trim() : ''
      if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase()
      return 'var(--dsw-alias-state-error-primary, #e5484d)'
    }

/**
 * 把命中区间变成 Range 列表。**不量矩形、不裁剪视口** ——
 * Highlight 不需要坐标，浏览器自己知道这些 range 在屏幕上的位置。
 *
 * 每个命中一个 Range（setStart/setEnd 到文本节点的字符偏移）。
 * 已经脱离文档的节点跳过（量不出也没意义）。
 *
 * @param {object} input
 * @param {Document | null} input.doc
 * @param {Node | Node[] | string | null} [input.root] 省略时用 SELECTORS.allowedRoot
 * @param {Map<string, boolean> | Set<string>} input.keys
 * @returns {{
 *   ranges: Range[],
 *   knownRanges: Range[],
 *   rangeRefs: Array<{ node: Text, start: number, end: number, key: string, known: boolean, think: boolean }>,
 *   stats: { hits: number, words: number, known: number, skipped: number }
 * }}
 */
    function buildHighlightRanges(input) {
      const doc = input?.doc ?? null
      const keys = input?.keys
      const empty = { ranges: [], knownRanges: [], rangeRefs: [], stats: { hits: 0, words: 0, known: 0, skipped: 0 } }
      if (!doc || !keys || typeof keys.has !== 'function') return empty
      if (typeof keys.size === 'number' && keys.size === 0) return empty

      const hits = scanTextNodes({ doc, root: input?.root, keys })
      if (hits.length === 0) return empty

      const ranges = []
      const knownRanges = []
      const rangeRefs = []
      let skipped = 0

      for (const hit of hits) {
        const node = hit?.node
        if (!node || typeof node.nodeType !== 'number') { skipped += 1; continue }
    // 已脱离文档的节点建 Range 会抛；直接跳过（下一轮慢路径会重扫）
        if (typeof node.isConnected === 'boolean' && node.isConnected === false) { skipped += 1; continue }
        let range = null
        try {
          range = doc.createRange()
          range.setStart(node, hit.start)
          range.setEnd(node, hit.end)
        } catch {
          skipped += 1
          continue
        }
        const known = hit.known === true
        if (known) knownRanges.push(range)
        else ranges.push(range)
        rangeRefs.push({
          node, start: hit.start, end: hit.end, key: hit.key, known, think: hit.think === true,
        })
      }

      return {
        ranges,
        knownRanges,
        rangeRefs,
        stats: {
          hits: hits.length,
          words: ranges.length,
          known: knownRanges.length,
          skipped,
        },
      }
    }

/**
 * 把 ranges 注册进 CSS.highlights。
 *
 * 空数组时**删除**对应注册（否则上一轮的旧高亮会留在正文上）。
 * 注册失败（环境半支持、Highlight 构造抛错）返回 false，调用方据此回退色块路径。
 *
 * @param {object} input
 * @param {object} [input.scope] window/globalThis，单测可注入
 * @param {Range[]} [input.ranges]
 * @param {Range[]} [input.knownRanges]
 * @returns {{ ok: boolean, words: number, known: number, error?: string }}
 */
    function applyHighlights(input) {
      const scope = input?.scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
      const ranges = Array.isArray(input?.ranges) ? input.ranges : []
      const knownRanges = Array.isArray(input?.knownRanges) ? input.knownRanges : []
      if (!supportsHighlight(scope)) return { ok: false, words: 0, known: 0, error: 'unsupported' }

      const registry = scope.CSS.highlights
      const HighlightCtor = scope.Highlight
      try {
        if (ranges.length === 0) registry.delete(HIGHLIGHT_WORDS)
        else registry.set(HIGHLIGHT_WORDS, new HighlightCtor(...ranges))

        if (knownRanges.length === 0) registry.delete(HIGHLIGHT_KNOWN)
        else registry.set(HIGHLIGHT_KNOWN, new HighlightCtor(...knownRanges))

        return { ok: true, words: ranges.length, known: knownRanges.length }
      } catch (error) {
        return { ok: false, words: 0, known: 0, error: error?.message ?? 'failed' }
      }
    }

/**
 * 清掉本插件注册的两个 highlight（关闭着色 / 卸载时调）。
 *
 * @param {object} [scope]
 * @returns {void}
 */
    function clearHighlights(scope) {
      const host = scope ?? (typeof globalThis !== 'undefined' ? globalThis : undefined)
      const registry = host?.CSS?.highlights
      if (!registry || typeof registry.delete !== 'function') return
      try { registry.delete(HIGHLIGHT_WORDS) } catch { /* ignore */ }
      try { registry.delete(HIGHLIGHT_KNOWN) } catch { /* ignore */ }
    }

/**
 * 生成 `::highlight(...)` 规则。
 *
 * **只写 color**：用户要的是「改字的颜色」，不要 background / border / text-decoration。
 * 已掌握词用淡化（`color-mix` 把同色掺到 transparent）而不是换色 —— 保持同源。
 *
 * 注意 ::highlight 是伪元素，可用的属性很少（color、background-color、
 * text-decoration、text-shadow 等），正因为少，这里只给 color 最稳。
 *
 * @param {object} [appearance]
 * @param {{ markColor?: string, markKnown?: boolean }} [appearance]
 * @returns {string}
 */
    function highlightCss(appearance) {
      const color = markColorToCss(appearance?.markColor)
      const knownOn = appearance?.markKnown === true
      const parts = [
        `::highlight(${HIGHLIGHT_WORDS}) { color: ${color}; }`,
      ]
      if (knownOn) {
    // 已掌握：同色但对半掺透明，淡一档。theme-error 是 var() 时同样成立
    // （color-mix 支持把 var() 当颜色分量求值）。
        parts.push(`::highlight(${HIGHLIGHT_KNOWN}) { color: color-mix(in srgb, ${color} 50%, transparent); }`)
      } else {
    // 没开「已掌握也显示」就不注册规则（清掉残留）
        parts.push(`::highlight(${HIGHLIGHT_KNOWN}) { }`)
      }
      return parts.join('\n')
    }

      return { HIGHLIGHT_WORDS, HIGHLIGHT_KNOWN, MARK_MAX, VIEWPORT_PAD_PX, SCROLL_THROTTLE_MS, MUTATION_DEBOUNCE_MS, THINK_SELECTOR, WORD_PATTERN, unionRectsOf, expandWordSet, matchWordsInText, cullToViewport, normalizeViewport, viewportOf, capMarks, blockerOf, collectTextNodes, resolveRoots, textOfNode, scanTextNodes, measureHits, buildMarks, createRecalcScheduler, bindRecalcEvents, colorMix, styleOfMark, MarkerLayer, markCss, supportsHighlight, markColorToCss, buildHighlightRanges, applyHighlights, clearHighlights, highlightCss }
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
      var { highlightCss, MarkerLayer } = __mod_marker
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

/**
 * 生词状态的短标签与色点（设计 §A2 四态）。
 *
 * 放在 overlay 而不是 wordbook：这是**展示层**映射，与数据层无关，
 * 而且浮层与色块共用同一套色（unknown 红 / fuzzy 橙 / known 绿）。
 */
    const WORD_STATE_LABELS = { new: '未学', unknown: '不认识', fuzzy: '记错', known: '已掌握' }
    const WORD_STATE_TONES = {
      new: 'var(--dsw-alias-label-secondary, #666)',
      unknown: 'var(--dsw-alias-state-error-primary, #e5484d)',
      fuzzy: 'var(--dsw-alias-state-warn-primary, #f0a441)',
      known: 'var(--dsw-alias-state-success-primary, #2f9e44)',
    }

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
/* ── 生词着色层（设计-v2 §C2.2）：垫在正文文字底下的色块 ──
   pointer-events:none 让点击穿透到正文，现有的单击取词不受影响（§C3）。
   z-index:0 让它在浮层（.hd-pop/.hd-card 各自定位）之下。
   底色浓度与下划线由 marker.js 的 styleOfMark 逐块内联给出（用户自选色是唯一例外）。 */
    [${UI_ATTR}] .hd-marks {
      position: fixed;
      inset: 0;
      pointer-events: none;
      contain: layout style;
      z-index: 0;
    }
    [${UI_ATTR}] .hd-mark {
      position: fixed;
      pointer-events: none;
    }
/* 浮层里的「已在生词本 · 状态」小字行（§C3） */
    [${UI_ATTR}] .hd-state {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: .86em;
      line-height: 1.4;
      color: var(--dsw-alias-label-secondary, #666);
    }
    [${UI_ATTR}] .hd-state-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex: none;
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
    function ensureStyle(doc, appearance) {
      if (!doc || typeof doc.createElement !== 'function') return () => {}
  // ::highlight 的 color 由用户配置决定，所以整份样式内容包含它。
  // 改色时 ensureStyle 会被重新调用（内容变了就替换 textContent），即时生效。
      const css = `${CSS}\n${highlightCss(appearance ?? {})}\n`
      const selector = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`
      let node = doc.querySelector(selector)
      if (node === null) {
        node = doc.createElement('style')
        node.dataset.pluginCss = STYLE_ID
        node.textContent = css
        const head = doc.head ?? doc.documentElement
        if (head) head.appendChild(node)
        else return () => {}
      } else if (node.textContent !== css) {
        node.textContent = css
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
 * 生词着色层宿主：把 marker.js 的 MarkerLayer 包一层，做两件事：
 *   - `markWords === false` 时**整个不渲染**（用户要求的「直接不变颜色」）；
 *   - 保证它排在 OverlayHost children 的**第一个**，画在浮层/卡片之下（§C2.2 z-index）。
 *
 * 真正的色块几何由 app.js 的 buildMarks 算好传进来 —— 这个组件不扫描、不监听、不量矩形，
 * 渲染路径上没有任何重活，所以不会拖帧也不会有抛错风险。
 *
 * @param {object} props
 * @param {Array<object>} props.marks
 * @param {object} [props.appearance]
 * @returns {import('react').ReactElement | null}
 */
    function MarkerLayerHost(props) {
      const appearance = props?.appearance
      if (!appearance || appearance.markWords === false) return null
      const marks = Array.isArray(props?.marks) ? props.marks : []
      if (marks.length === 0) return null
      return h(MarkerLayer, { marks, appearance })
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

  // 「已在生词本 · 状态」小字行（设计 §C3）：点中被着色的词时，
  // 用户需要知道「这个词我标成什么了」，否则红色色块等于没有解释。
      if (inBook) {
        const entry = props.entry
        const state = typeof entry?.state === 'string' ? entry.state : ''
        const label = WORD_STATE_LABELS[state] ?? ''
        const tone = WORD_STATE_TONES[state] ?? 'var(--dsw-alias-label-secondary, #666)'
        children.push(h('div', { key: 'state', className: 'hd-state' },
          h('span', { className: 'hd-state-dot', style: { background: tone } }),
          h('span', null, label ? `已在生词本 · ${label}` : '已在生词本'),
        ))
      }

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

      return { UI_ATTR, ensureStyle, MarkerLayerHost, PopoverBody, StatusNote, PhraseBody }
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
    // 按在按钮、链接、输入框上时不启动拖动。
    // 把手内部可能嵌着星标、关闭这些控件，它们的点击必须原样传下去，
    // 否则用户点星标会被拖动手势吃掉（表现为「点了没反应」）。
        if (event.target && typeof event.target.closest === 'function') {
          if (event.target.closest('button, a, input, textarea, select, [role="button"]') !== null) return
        }
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
 * 顶部页签导航。
 *
 * 为什么是 tab 而不是左侧竖排：宿主给设置页的宽度不定，竖排会在窄容器里
 * 把内容区挤成一条。横排 tab 在窄容器里可以横向滚动，永远不会挤坏正文。
 *
 * @param {object} props
 * @param {Array<{ id: string, label: string, badge?: string }>} props.items
 * @param {string} props.value 当前选中的 id
 * @param {(id: string) => void} props.onChange
 * @returns {import('react').ReactElement}
 */
      function Tabs(props) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('div', {
        role: 'tablist',
        'aria-label': props.label,
        style: {
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          padding: 4,
          borderRadius: RADIUS.md + 1,
          border: `1px solid ${C.border1}`,
          background: C.bg1,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        },
      }, items.map((item) => {
        const active = item.id === props.value
        return h('button', {
          key: item.id,
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          onClick: () => props.onChange(item.id),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: GAP.xs,
            padding: '6px 14px',
            borderRadius: RADIUS.sm,
            border: `1px solid ${active ? C.border2 : 'transparent'}`,
            background: active ? C.bg2 : 'transparent',
            boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.09)' : 'none',
            color: active ? C.text : C.textDim,
            font: 'inherit',
            fontSize: FS.body,
            fontWeight: active ? 650 : 520,
            lineHeight: 1.6,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: `background .18s ${EASE.out}, color .18s ${EASE.out}, border-color .18s ${EASE.out}`,
            WebkitTapHighlightColor: 'transparent',
          },
        }, [
          h('span', { key: 'l' }, item.label),
          item.badge ? h('span', {
            key: 'b',
            style: {
              padding: '0 6px',
              borderRadius: RADIUS.pill,
              background: active ? C.overlay : 'transparent',
              border: `1px solid ${C.border1}`,
              fontSize: 10.5,
              fontVariantNumeric: 'tabular-nums',
              color: C.textFaint,
            },
          }, item.badge) : null,
        ])
      }))
    }

/**
 * 统计数字块：一个大数字 + 一行标签。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string|number} props.value
 * @param {string} [props.hint]
 * @param {'neutral'|'accent'|'success'|'danger'|'warn'} [props.tone]
 * @returns {import('react').ReactElement}
 */
      function Stat(props) {
      const tone = props.tone ?? 'neutral'
      const color = {
        neutral: C.text,
        accent: C.accent,
        success: C.success,
        danger: C.danger,
        warn: C.warn,
      }[tone] ?? C.text
      return h('div', {
        'aria-label': `${props.label} ${props.value}`,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 96,
          flex: '1 1 96px',
          padding: '10px 13px',
          borderRadius: RADIUS.md,
          border: `1px solid ${C.border1}`,
          background: C.bg1,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        },
      }, [
        h('span', {
          key: 'v',
          style: {
            fontSize: 19, fontWeight: 680, lineHeight: 1.35,
            letterSpacing: '-.4px', fontVariantNumeric: 'tabular-nums', color,
          },
        }, String(props.value)),
        h('span', {
          key: 'l',
          style: { fontSize: FS.small, lineHeight: 1.7, color: C.textDim },
        }, props.label),
        props.hint ? h('span', {
          key: 'h',
          style: { fontSize: 10.5, lineHeight: 1.65, color: C.textFaint },
        }, props.hint) : null,
      ])
    }

/**
 * 可选芯片（单个选中 / 单选组）。
 *
 * @param {object} props
 * @param {string} props.label
 * @param {boolean} [props.active]
 * @param {() => void} props.onClick
 * @param {string} [props.count] 右侧小数字
 * @returns {import('react').ReactElement}
 */
      function Chip(props) {
      const active = props.active === true
      return h('button', {
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        onClick: props.onClick,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 11px',
          borderRadius: RADIUS.pill,
          border: `1px solid ${active ? `color-mix(in srgb, ${C.accent} 55%, transparent)` : C.border2}`,
          background: active ? `color-mix(in srgb, ${C.accent} 12%, transparent)` : C.bg1,
          color: active ? C.accent : C.textDim,
          font: 'inherit',
          fontSize: FS.small,
          fontWeight: active ? 620 : 500,
          lineHeight: 1.7,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: `background .18s ${EASE.out}, border-color .18s ${EASE.out}, color .18s ${EASE.out}`,
          WebkitTapHighlightColor: 'transparent',
        },
      }, [
        h('span', { key: 'l' }, props.label),
        props.count !== undefined && props.count !== null
          ? h('span', { key: 'c', style: { opacity: 0.72, fontVariantNumeric: 'tabular-nums' } }, String(props.count))
          : null,
      ])
    }

/**
 * 复选框。原生 input 太丑，这里画一个方框 + 勾。
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {string} [props.label] 无障碍标签
 * @returns {import('react').ReactElement}
 */
      function Checkbox(props) {
      const on = props.checked === true
      return h('button', {
        type: 'button',
        role: 'checkbox',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': props.label,
        onClick: () => props.onChange(!on),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 17,
          height: 17,
          flex: 'none',
          padding: 0,
          borderRadius: 5,
          border: `1px solid ${on ? 'transparent' : C.border2}`,
          background: on ? C.accent : C.bgBase,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.14)',
          color: '#fff',
          fontSize: 11,
          lineHeight: 1,
          cursor: 'pointer',
          transition: `background .16s ${EASE.out}, border-color .16s ${EASE.out}`,
          WebkitTapHighlightColor: 'transparent',
        },
      }, on ? '✓' : '')
    }

/**
 * 分段控件（两个以上互斥选项，比下拉更一眼看全）。
 *
 * @param {object} props
 * @param {Array<{ id: string, label: string }>} props.items
 * @param {string} props.value
 * @param {(id: string) => void} props.onChange
 * @returns {import('react').ReactElement}
 */
      function Segment(props) {
      const items = Array.isArray(props.items) ? props.items : []
      return h('div', {
        role: 'radiogroup',
        'aria-label': props.label,
        style: {
          display: 'inline-flex',
          padding: 2,
          borderRadius: RADIUS.pill,
          border: `1px solid ${C.border1}`,
          background: C.bg1,
        },
      }, items.map((item) => {
        const active = item.id === props.value
        return h('button', {
          key: item.id,
          type: 'button',
          role: 'radio',
          'aria-checked': active ? 'true' : 'false',
          onClick: () => props.onChange(item.id),
          style: {
            padding: '3px 12px',
            borderRadius: RADIUS.pill,
            border: 0,
            background: active ? C.bg2 : 'transparent',
            boxShadow: active ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
            color: active ? C.text : C.textDim,
            font: 'inherit',
            fontSize: FS.small,
            fontWeight: active ? 620 : 500,
            lineHeight: 1.7,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: `background .18s ${EASE.out}, color .18s ${EASE.out}`,
            WebkitTapHighlightColor: 'transparent',
          },
        }, item.label)
      }))
    }

/**
 * 造一套原语。
 *
 * @param {Function} h React.createElement（由插件入口从 `require('react')` 拿到）
 * @returns {{
 *   Card: Function, Button: Function, Switch: Function, Input: Function,
 *   Select: Function, Badge: Function, Note: Function, Field: Function,
 *   PageHeader: Function, Page: Function,
 *   Tabs: Function, Stat: Function, Chip: Function, Checkbox: Function, Segment: Function,
 *   FS: object, GAP: object, RADIUS: object, C: object, EASE: object, sx: Function, hintStyle: Function,
 * }}
 */
    function makePrimitives(h) {
      if (typeof h !== 'function') {
        throw new TypeError('makePrimitives 需要 React.createElement')
      }
      return {
        Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page,
        Tabs, Stat, Chip, Checkbox, Segment,
        FS, GAP, RADIUS, C, EASE, sx, hintStyle,
      }
    }

      return { FS, GAP, RADIUS, C, EASE, sx, hintStyle, makePrimitives }
    })()

    // ═══ settings.js ═══
    var __mod_settings = (function () {
      var { loadUx, saveUx, DEFAULT_MARK_COLOR, MARK_COLOR_PRESETS } = __mod_config
      var { markColorToCss } = __mod_marker
      var { makePrimitives } = __mod_ui
      var { parseImportDetailed, summarizeImport, glossText, IMPORT_FORMATS } = __mod_importer
      var { API_PREFIX } = __mod_net
      var { GRADE_BUTTONS, REVIEW_FILTERS, DIRECTIONS, AHEAD_COUNT, filterQueue, queueForDirection, cardBackFor, roundSummary, dueLabel, aheadQueue, shouldHandleKey, actionForKey, briefTextFor, booksOfEntry, ReviewCardBack, PronounceButton, canSpeak } = __mod_review
      var { briefOf, describeEntry } = __mod_dict
      var { normalizeKey } = __mod_word
/**
 * settings.js —— 插件设置面板（挂在 Plugins 页的插件详情里）。
 *
 * v2 起改成**顶部 tab 导航**五个页签（设计-v2 §B）：
 *   1. 生词本   —— 统计条 + 搜索/筛选/词书/排序 + 表格分页 + 批量操作 + 导出
 *   2. 复习     —— 刷词卡（review.js 提供出题与评分，这里只画）
 *   3. 导入     —— 粘贴/文件 → 解析预览 → 确认写库（importer.js 负责解析）
 *   4. 外观与交互 —— 原有字段全保留，另含词库与句子库、翻译接口
 *   5. 有道同步 —— 本任务先放占位（D 任务填充真实面板）
 *
 * 所有设置存在 localStorage，不走宿主 Config —— 这些是界面偏好，
 * 为了让用户改一个数字去重启宿主是不合理的。
 */

// 预览必须与实际渲染用同一个颜色解析：theme-error 哨兵 → var(--dsw-alias-state-error-primary,…)。
// 自己另写一套（比如把哨兵当 hex 塞进 color-mix）会让预览与正文对不上。
// §E1 复习背面发音：复用 review.js 那一套（canSpeak/speakWord 在里面），
// 不在这里另写发音逻辑 —— card.js 与复习卡共用同一份实现。
// 注意：注释不能写在上面的 import 花括号内部，构建器按逗号切名字会把它当导入名。

/**
 * 生词本表格每页行数（设计 §B1：50 行一页）。
 *
 * v1 这里是个 chips 墙，用 CHIP_LIMIT=120 硬截断，超出的只留一句「还有 N 个」。
 * v2 改成真分页：全部词都能翻到，所以 CHIP_LIMIT 这个常量已经删掉了 ——
 * 现在「上限有交代」由下面的 PAGE_SIZE 与 PREVIEW_ROW_LIMIT 承担。
 */
    const PAGE_SIZE = 50

/**
 * 导入预览表最多渲染多少行。
 *
 * 预览是给眼睛看的，不是给人滚两万行用的：词表可能两万条（有道上限），
 * 全渲染会卡死面板。**截断的只是预览的显示**，确认导入时仍然导入全部 ——
 * 所以这不是静默丢词，表格下面会明确写出「还有 N 行没显示，仍会全部导入」。
 */
    const PREVIEW_ROW_LIMIT = 200

/** 状态 → 中文名与徽章语气。四色：new 灰 / unknown 红 / fuzzy 橙 / known 绿。 */
    const STATE_META = {
      new: { label: '未学', tone: 'neutral' },
      unknown: { label: '不认识', tone: 'danger' },
      fuzzy: { label: '记错', tone: 'warn' },
      known: { label: '已掌握', tone: 'success' },
    }

/** 来源 → 中文短名。 */
    const SOURCE_LABEL = {
      dsh: '划词',
      youdao: '有道',
      manual: '手动',
      import: '导入',
    }

/** 排序方式。 */
    const SORT_OPTIONS = [
      { id: 'recent', label: '最近添加' },
      { id: 'stale', label: '最久未复习' },
      { id: 'alpha', label: '字母序' },
    ]

/** 设置面板的样式。 */
    const CSS = `
/* ═══════════════════════════════════════════════════════════════════════
   英语翻译设置 · 视觉系统
   分层用 --dsw-alias-bg-layer-1/2，按钮细边 + 内高光 + 悬停扫光，
   卡片带拉丝细纹底与外投影。昼夜由宿主切换，这里不写死颜色。
   ═══════════════════════════════════════════════════════════════════════ */

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
      margin-inline: auto;
      width: 100%;
      padding: 4px 0 32px;
      font-size: var(--fs-body);
      line-height: 1.8;
      color: var(--dsw-alias-label-primary, #1a1a1a);
      -webkit-font-smoothing: antialiased;
    }
    .hds-page * { box-sizing: border-box; }

    .hds-header {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 2px 2px 20px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
    }
    .hds-header-line { display: flex; align-items: center; gap: 10px; }
    .hds-header-icon { font-size: 20px; line-height: 1; }
    .hds-header-title {
      margin: 0; font-size: 20px; font-weight: 680; letter-spacing: -.3px; line-height: 1.4;
    }
    .hds-header-desc {
      margin: 0; max-width: 58ch; font-size: var(--fs-body); line-height: 1.85;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-header-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
    .hds-stat-chip {
      display: inline-flex; align-items: baseline; gap: 3px;
      padding: 4px 11px; border-radius: 999px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      font-size: var(--fs-small); line-height: 1.7;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-stat-chip b {
      font-size: 12.5px; font-weight: 650; font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }

    .hds-root { display: flex; flex-direction: column; gap: 16px; }

    .hds-section {
      display: flex; flex-direction: column;
      border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background:
        repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
        var(--dsw-alias-bg-layer-2, #ffffff);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
      overflow: hidden;
    }
    .hds-head {
      display: flex; flex-direction: column; gap: 5px;
      padding: 15px 18px 13px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
    }
    .hds-title {
      margin: 0; font-size: var(--fs-title); font-weight: 680;
      letter-spacing: -.15px; line-height: 1.5;
    }
    .hds-subtitle {
      margin: 0; font-size: var(--fs-body); font-weight: 650; line-height: 1.6;
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }
    .hds-hint {
      margin: 0; font-size: var(--fs-small); line-height: 1.9;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-stack { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 18px; }
    .hds-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .hds-field { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
    .hds-field > .hds-label {
      font-size: 12.5px; line-height: 1.7;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

    .hds-btn {
      position: relative; overflow: hidden;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      min-height: 32px; padding: 6px 16px; border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
      color: var(--dsw-alias-label-primary, #1a1a1a);
      font: inherit; font-size: 12.5px; font-weight: 580; line-height: 1.4;
      cursor: pointer; white-space: nowrap;
      transition:
        transform .16s var(--ease-settle),
        border-color .2s var(--ease-instrument),
        background .2s var(--ease-instrument),
        box-shadow .2s var(--ease-instrument),
        opacity .16s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .hds-btn::after {
      content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 42%;
      background: linear-gradient(100deg, transparent, rgb(255 255 255 / 14%), transparent);
      transform: skewX(-18deg); transition: left .5s var(--ease-instrument);
      pointer-events: none;
    }
    .hds-btn:hover:not(:disabled)::after { left: 118%; }
    .hds-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 7%, var(--dsw-alias-bg-layer-2, #ffffff));
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
    }
    .hds-btn:active:not(:disabled) {
      transform: scale(.985); transition-duration: .09s;
      box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%);
    }
    .hds-btn:focus-visible {
      outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 2px;
    }
    .hds-btn:disabled { opacity: .45; cursor: default; box-shadow: none; transform: none; }
    .hds-btn:disabled::after { content: none; }

    .hds-btn-primary {
      background: linear-gradient(180deg,
        color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #fff),
        var(--dsw-alias-brand-primary, #4d6bfe));
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 82%, #000);
      color: var(--dsw-alias-label-primary, #fff);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%), inset 0 -10px 18px -12px rgb(0 0 0 / 24%);
    }
    .hds-btn-primary:hover:not(:disabled) {
      background: linear-gradient(180deg,
        var(--dsw-alias-brand-primary, #4d6bfe),
        color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #000));
    }
    .hds-btn-ghost {
      background: transparent; border-color: transparent; box-shadow: none;
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

    .hds-input, .hds-select {
      font: inherit; font-size: 13px; padding: 8px 12px; border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 10%);
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
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 8%),
                  0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
    }
    .hds-input[type="number"] { max-width: 110px; }

    .hds-textarea {
      width: 100%; min-height: 128px;
      font-family: var(--ds-font-family-code, ui-monospace, monospace);
      font-size: 12.5px; line-height: 1.85; padding: 12px 14px; border-radius: 9px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 10%);
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

/* ── 开关 ─────────────────────────────────────────────────────────────── */
    .hds-switch {
      display: inline-flex; align-items: center; gap: 9px; cursor: pointer;
      user-select: none; appearance: none; background: transparent; border: 0;
      padding: 0; font: inherit; color: inherit; -webkit-tap-highlight-color: transparent;
    }
    .hds-switch-track {
      width: 38px; height: 21px; border-radius: 999px;
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%), inset 0 -1px 0 rgb(255 255 255 / 4%);
      position: relative; flex: none;
      transition: background .22s var(--ease-instrument), border-color .22s var(--ease-instrument),
                  box-shadow .22s var(--ease-instrument);
    }
    .hds-switch-track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
      border-radius: 50%; background: var(--dsw-alias-label-primary, #1a1a1a);
      box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%);
      transition: transform .28s var(--ease-settle), background .2s var(--ease-instrument),
                  width .14s var(--ease-instrument);
    }
    .hds-switch:active .hds-switch-track::after { width: 18px; }
    .hds-switch[aria-checked="true"] .hds-switch-track {
      background: var(--dsw-alias-brand-primary, #4d6bfe);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 85%, #000);
    }
    .hds-switch[aria-checked="true"] .hds-switch-track::after {
      transform: translateX(17px); background: var(--dsw-alias-label-primary, #fff);
    }
    .hds-switch[aria-checked="true"]:active .hds-switch-track::after { transform: translateX(14px); }
    .hds-switch:focus-visible .hds-switch-track {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 22%, transparent);
    }
    .hds-switch-text { font-size: 13px; line-height: 1.7; }

/* ── 卡片 ─────────────────────────────────────────────────────────────── */
    .hds-card {
      display: flex; align-items: center; gap: 14px; padding: 13px 15px;
      border-radius: 13px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background:
        repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
        color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), inset 0 -12px 24px -16px rgb(0 0 0 / 14%);
      transition: transform .22s var(--ease-instrument), box-shadow .26s var(--ease-instrument),
                  border-color .2s var(--ease-instrument);
    }
    .hds-card:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 58%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
    }
    .hds-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .hds-card-name {
      display: flex; align-items: center; gap: 8px;
      font-size: 13.5px; font-weight: 650; letter-spacing: -.1px; line-height: 1.55;
    }
    .hds-card-meta {
      font-size: 12px; line-height: 1.85;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

/* ── 状态徽章 ─────────────────────────────────────────────────────────── */
    .hds-badge {
      display: inline-flex; align-items: center; padding: 1px 8px;
      border-radius: 999px; font-size: 10.5px; font-weight: 500; line-height: 1.7;
      border: 1px solid transparent; white-space: nowrap;
    }
    .hds-badge-new { color: var(--dsw-alias-label-secondary, #5c5c5c); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); }
    .hds-badge-unknown { color: var(--dsw-alias-state-error-primary, #e5484d); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent); }
    .hds-badge-fuzzy { color: var(--dsw-alias-state-warn-primary, #f0a441); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f0a441) 45%, transparent); }
    .hds-badge-known { color: var(--dsw-alias-state-success-primary, #2f9e44); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent); }
    .hds-badge-builtin { color: var(--dsw-alias-label-secondary, #5c5c5c); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); }

/* ── 词表 ─────────────────────────────────────────────────────────────── */
    .hds-table { display: flex; flex-direction: column; border-radius: 11px; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
    .hds-thead, .hds-trow {
      display: grid;
      grid-template-columns: 28px minmax(96px, 1.3fr) 78px 96px 74px minmax(120px, 1fr);
      gap: 10px;
      align-items: center;
      padding: 8px 12px;
    }
    .hds-thead {
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 92%, transparent);
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      font-size: 11px; line-height: 1.6;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      letter-spacing: .02em;
    }
    .hds-trow {
      border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 60%, transparent);
      font-size: 12.5px; line-height: 1.7;
      transition: background .16s var(--ease-instrument);
    }
    .hds-trow:last-child { border-bottom: 0; }
    .hds-trow:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 4%, transparent); }
    .hds-thead > span, .hds-trow > span { min-width: 0; }
    .hds-cell-head {
      font-weight: 650; letter-spacing: -.1px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hds-cell-head button {
      font: inherit; color: inherit; background: none; border: 0; padding: 0;
      cursor: pointer; text-align: left;
      border-bottom: 1px dashed color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 80%, transparent);
    }
    .hds-cell-head button:hover { color: var(--dsw-alias-brand-primary, #4d6bfe); border-bottom-color: currentColor; }
    .hds-cell-dim { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); font-variant-numeric: tabular-nums; }
    .hds-cell-ops { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

    .hds-detail {
      grid-column: 1 / -1;
      display: flex; flex-direction: column; gap: 8px;
      margin: 2px 0 6px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 70%, transparent);
      font-size: 12.5px; line-height: 1.85;
    }
    .hds-detail-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
    .hds-detail-key { flex: none; min-width: 44px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); }
    .hds-detail-val { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .hds-detail-sense { display: flex; gap: 6px; flex-wrap: wrap; }
    .hds-detail-pos {
      flex: none; font-size: 10.5px; padding: 0 6px; border-radius: 999px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      color: var(--dsw-alias-label-secondary, #5c5c5c); line-height: 1.7;
    }

/* ── 分页 ─────────────────────────────────────────────────────────────── */
    .hds-pager {
      display: flex; align-items: center; justify-content: space-between;
      gap: 10px; flex-wrap: wrap;
      padding-top: 2px;
      font-size: var(--fs-small);
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      font-variant-numeric: tabular-nums;
    }

/* ── 打卡格子 ─────────────────────────────────────────────────────────── */
    .hds-heat { display: flex; gap: 4px; align-items: flex-end; flex-wrap: wrap; }
    .hds-heat-cell {
      width: 15px; height: 15px; border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 70%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c5c5c) 12%, transparent);
    }
    .hds-heat-legend {
      display: flex; align-items: center; gap: 5px;
      font-size: 10.5px; color: var(--dsw-alias-label-secondary, #5c5c5c);
    }

/* ── 状态占比条 ───────────────────────────────────────────────────────── */
    .hds-bar {
      display: flex; height: 9px; border-radius: 999px; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 80%, transparent);
    }
    .hds-bar > span { display: block; height: 100%; }

/* ── 导入预览 ─────────────────────────────────────────────────────────── */
    .hds-preview { display: flex; flex-direction: column; gap: 10px; }
    .hds-preview-table {
      display: flex; flex-direction: column; border-radius: 11px; overflow: hidden;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      max-height: 360px; overflow-y: auto;
    }
    .hds-preview-row {
      display: grid;
      grid-template-columns: 40px minmax(90px, 1.1fr) 74px minmax(120px, 1.6fr);
      gap: 10px; align-items: center;
      padding: 7px 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 60%, transparent);
      font-size: 12.5px; line-height: 1.7;
    }
    .hds-preview-row:last-child { border-bottom: 0; }
    .hds-preview-line { font-size: 11px; color: var(--dsw-alias-label-secondary, #5c5c5c); font-variant-numeric: tabular-nums; }
    .hds-preview-gloss {
      font-size: 12px; color: var(--dsw-alias-label-secondary, #5c5c5c);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hds-preview-skip {
      display: flex; flex-direction: column; gap: 4px;
      padding: 10px 13px; border-radius: 10px;
      border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      font-size: 11.5px; line-height: 1.8;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-skip-row { display: flex; gap: 8px; }
    .hds-skip-line { flex: none; min-width: 34px; font-variant-numeric: tabular-nums; }

/* ── 复习卡 ───────────────────────────────────────────────────────────── */
    .hds-review-top {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: space-between;
    }
    .hds-cardstage {
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      padding: 26px 20px;
      border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background:
        repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
        color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 88%, transparent);
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 10px 26px -18px rgb(0 0 0 / 30%);
      min-height: 190px;
      justify-content: center;
      text-align: center;
      cursor: pointer;
    }
    .hds-cardstage-word {
      font-size: 30px; font-weight: 680; letter-spacing: -.6px; line-height: 1.3;
      font-family: var(--ds-font-family-code, ui-monospace, monospace);
      overflow-wrap: anywhere;
    }
    .hds-cardstage-back { display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; }
/* .hds-cardstage-sense / .hds-cardstage-example 已随之删除：
   背面的义项与例句现在由 review.js 的 ReviewCardBack 内联渲染，
   留着这两条规则等于一份无人使用的样式债。 */
    .hds-cardstage-tip { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); }
    .hds-grade-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .hds-grade-btn {
      flex: 1 1 110px;
      display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
      padding: 9px 14px; border-radius: 10px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: var(--dsw-alias-bg-layer-2, #ffffff);
      color: var(--dsw-alias-label-primary, #1a1a1a);
      font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      transition: transform .16s var(--ease-settle), border-color .2s var(--ease-instrument),
                  background .2s var(--ease-instrument);
    }
    .hds-grade-btn:hover:not(:disabled) { transform: translateY(-1px); }
    .hds-grade-btn:active:not(:disabled) { transform: scale(.985); }
    .hds-grade-btn:disabled { opacity: .45; cursor: default; }
    .hds-grade-btn small { font-size: 10.5px; font-weight: 450; opacity: .7; }
    .hds-grade-again {
      border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      color: var(--dsw-alias-state-error-primary, #e5484d);
    }
    .hds-grade-hard {
      border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f0a441) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      color: var(--dsw-alias-state-warn-primary, #f0a441);
    }
    .hds-grade-good {
      border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
      color: var(--dsw-alias-state-success-primary, #2f9e44);
    }

/* ── 提示条 ──────────────────────────────────────────────────────────── */
    .hds-note {
      display: flex; gap: 9px; padding: 10px 13px; border-radius: 11px;
      border: 1px solid; font-size: 12px; line-height: 1.8;
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
      font-size: 11.5px; line-height: 1.9; padding: 8px 12px; border-radius: 8px;
      border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      user-select: all;
    }

/* ── 有道同步页签（设计 §D3） ─────────────────────────────────────── */

    .hds-steps { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
    .hds-step {
      display: flex; align-items: flex-start; gap: 11px;
      padding: 9px 0; font-size: var(--fs-small); line-height: 1.85;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
    }
    .hds-step + .hds-step { border-top: 1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
    .hds-step-no {
      flex: none; width: 20px; height: 20px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      margin-top: 2px;
      border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 45%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 11%, transparent);
      color: var(--dsw-alias-brand-primary, #4d6bfe);
      font-size: 11px; font-weight: 680; font-variant-numeric: tabular-nums;
    }
    .hds-step-body { flex: 1; min-width: 0; }
    .hds-step-body b { color: var(--dsw-alias-label-primary, #1a1a1a); font-weight: 640; }

    .hds-status-card {
      display: flex; align-items: center; gap: 12px;
      padding: 13px 15px; border-radius: 13px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
      background: var(--dsw-alias-bg-layer-1, #f7f7f8);
    }
    .hds-status-card[data-tone="ok"] {
      border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 42%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 8%, transparent);
    }
    .hds-status-card[data-tone="warn"] {
      border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 46%, transparent);
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 9%, transparent);
    }
    .hds-status-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .hds-status-title {
      font-size: var(--fs-body); font-weight: 650; line-height: 1.6;
      color: var(--dsw-alias-label-primary, #1a1a1a);
    }
    .hds-status-meta {
      font-size: var(--fs-small); line-height: 1.8;
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      font-variant-numeric: tabular-nums;
    }

/* 「正在抓取…」进度条。sync 是一次性 POST，没有真实进度，所以是不定长流光条。 */
    .hds-progress {
      position: relative; overflow: hidden;
      height: 5px; border-radius: 999px;
      background: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, transparent);
    }
    .hds-progress::after {
      content: ""; position: absolute; inset-block: 0; width: 38%;
      border-radius: 999px;
      background: var(--dsw-alias-brand-primary, #4d6bfe);
      animation: hds-progress-slide 1.15s cubic-bezier(.5,0,.5,1) infinite;
    }
    @keyframes hds-progress-slide {
      0% { left: -40%; }
      100% { left: 100%; }
    }

/* ── 生词着色设置组（设计 §C4） ─────────────────────────────────── */

    .hds-swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .hds-swatch {
      width: 26px; height: 26px; padding: 0; border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      cursor: pointer; position: relative;
      transition: transform .16s cubic-bezier(.16,1,.3,1), box-shadow .16s cubic-bezier(.16,1,.3,1);
    }
    .hds-swatch:hover { transform: translateY(-1px); }
    .hds-swatch[aria-pressed="true"] {
      box-shadow: 0 0 0 2px var(--dsw-alias-bg-base, #fff),
                  0 0 0 4px var(--dsw-alias-brand-primary, #4d6bfe);
    }
    .hds-swatch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 3px; }

/* 实时预览句：色块由内联 style 给，这里只管排版 */
    .hds-mark-preview {
      padding: 12px 14px; border-radius: 11px;
      border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
      background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
      font-size: 14.5px; line-height: 2.1;
      color: var(--dsw-alias-label-primary, #1a1a1a);
      word-break: break-word;
    }
    .hds-mark-preview[data-off="true"] {
      color: var(--dsw-alias-label-secondary, #5c5c5c);
      font-style: italic;
    }

    @media (prefers-reduced-motion: reduce) {
      .hds-progress::after { animation: none; left: 20%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .hds-root .hds-card:hover,
      .hds-root .hds-btn:hover:not(:disabled),
      .hds-root .hds-btn:active:not(:disabled),
      .hds-root .hds-grade-btn:hover:not(:disabled),
      .hds-root .hds-grade-btn:active:not(:disabled) { transform: none; }
      .hds-root .hds-btn::after { content: none; }
    }
    `

/* ═══════════════════════════════════════════════════════════════════════
   小工具
   ═══════════════════════════════════════════════════════════════════════ */

/** localStorage，失败返回 undefined。 */
    function safeLocal() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
      } catch { /* ignore */ }
      return undefined
    }

/** 状态徽章文案。 */
    const stateLabel = (state) => STATE_META[state]?.label ?? '未学'
    const stateTone = (state) => STATE_META[state]?.tone ?? 'neutral'

/**
 * 下载一段文本为文件。
 *
 * 不依赖宿主能力，用 Blob + a[download]。失败静默 —— 但返回 false，
 * 让调用方能把「导出失败」说出来（不静默失败）。
 */
    function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
      try {
        const blob = new Blob([text], { type: mime })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return true
      } catch {
        return false
      }
    }

/** CSV 转义：字段里有逗号/引号/换行就包引号。 */
    function csvCell(value) {
      const text = String(value ?? '')
      if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
      return text
    }

/**
 * 导出三件套之一：txt 一行一词。
 */
    function exportTxt(entries) {
      return entries.map((entry) => entry.head).join('\n')
    }

/**
 * 导出三件套之二：CSV 带状态与释义。
 */
    function exportCsv(entries) {
      const rows = [['word', 'state', 'book', 'gloss', 'note', 'due', 'addedAt']]
      for (const entry of entries) {
        rows.push([
          entry.head,
          entry.state,
          entry.bookId,
          entry.gloss,
          entry.note,
          String(entry.srs?.due ?? 0),
          String(entry.addedAt ?? 0),
        ])
      }
      return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    }

/** 导出三件套之三：JSON 完整备份（可被导入页恢复）。 */
    function exportJson(book) {
      const payload = {
        format: 'dsh-hover-dict/wordbook',
        version: 2,
        exportedAt: new Date().toISOString(),
        books: typeof book?.listBooks === 'function' ? book.listBooks() : [],
        words: typeof book?.exportAll === 'function' ? book.exportAll() : (book?.list?.() ?? []),
      }
      return JSON.stringify(payload, null, 2)
    }

/** 排序词条。 */
    function sortEntries(entries, mode) {
      const list = entries.slice()
      if (mode === 'alpha') return list.sort((a, b) => a.head.localeCompare(b.head))
      if (mode === 'stale') {
        return list.sort((a, b) => {
          const la = a.srs?.lastReviewAt || a.addedAt || 0
          const lb = b.srs?.lastReviewAt || b.addedAt || 0
          if (la !== lb) return la - lb
          return a.head.localeCompare(b.head)
        })
      }
      return list.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
    }

/**
 * 词条搜过滤：词头或释义（含词库释义）。
 */
    function matchQuery(entry, query, dict) {
      if (query === '') return true
      const needle = query.toLowerCase()
      if (entry.head.includes(needle)) return true
      if (typeof entry.gloss === 'string' && entry.gloss.toLowerCase().includes(needle)) return true
      const raw = dict?.entries?.[entry.head]
      if (raw) {
        try {
          const brief = briefOf(raw)
          if (typeof brief?.zh === 'string' && brief.zh.toLowerCase().includes(needle)) return true
          if (typeof brief?.pos === 'string' && brief.pos.toLowerCase().includes(needle)) return true
        } catch { /* 词库结构异常就只按词头匹配 */ }
      }
      return false
    }

/* ═══════════════════════════════════════════════════════════════════════
   主面板
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 设置面板组件。
 *
 * @param {object} props 宿主注入的 PropsRuntime，含 view 与懒取的 wordbook / dict
 * @returns {import('react').ReactElement | null}
 */
    function SettingsPanel(props) {
  // 只在宿主**明确**说这是 summary 视图时才走摘要分支（沿用 v1 判定）。
      if (props?.view === 'summary') {
        return h('div', { className: 'hds-hint' }, '点选查词 · 生词本 · 离线词库')
      }

      const storage = safeLocal()
      const [ux, setUx] = useState(() => loadUx(storage))
      const [tab, setTab] = useState('book')
      const [message, setMessage] = useState(null)
      const [bookVersion, setBookVersion] = useState(0)

      const book = props?.wordbook
      const dict = props?.dict
      const packsDir = props?.packsDir ?? '~/.dsh/profiles/desktop/node_modules/dsh-hover-dict/data/packs'

  // 生词本一变就重读：stats/list 都是即时计算的，靠版本号触发重渲染
      useEffect(() => {
        if (!book || typeof book.subscribe !== 'function') return undefined
        const off = book.subscribe(() => setBookVersion((n) => n + 1))
        return () => { try { off() } catch { /* ignore */ } }
      }, [book])

      const patchAppearance = (key, value) => {
        saveUx(storage, { appearance: { ...ux.appearance, [key]: value } })
        setUx(loadUx(storage))
      }

      const say = (text, tone = 'ok') => setMessage({ text, tone })

  /** 每次改动后重读一遍本地镜像（book 是外部可变对象）。 */
      const bump = () => setBookVersion((n) => n + 1)

      const stats = (() => {
        try {
          return typeof book?.stats === 'function'
            ? book.stats()
            : { total: book?.size?.() ?? 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, addedToday: 0, reviewedToday: 0, streak: 0, days: [] }
        } catch {
          return { total: 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, addedToday: 0, reviewedToday: 0, streak: 0, days: [] }
        }
      })()
      void bookVersion

      const P = makePrimitives(h)
      const { Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page,
        Tabs, Stat, Chip, Checkbox, Segment, GAP, FS, C } = P

      const section = (key, title, hint, children, action) => h(Card, { key, title, hint, action }, children)
      const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

      const tabs = [
        { id: 'book', label: '生词本', badge: stats.total > 0 ? String(stats.total) : undefined },
        { id: 'review', label: '复习', badge: stats.dueToday > 0 ? String(stats.dueToday) : undefined },
        { id: 'import', label: '导入' },
        { id: 'appearance', label: '外观与交互' },
        { id: 'youdao', label: '有道同步' },
      ]

      const body = []
      if (tab === 'book') body.push(bookTab({ h, P, book, dict, stats, say, bump, storage, bookVersion }))
      else if (tab === 'review') body.push(h(ReviewTab, { key: 'review', h, P, book, dict, stats, say, bump }))
      else if (tab === 'import') body.push(h(ImportTab, { key: 'import', h, P, book, dict, say, bump }))
      else if (tab === 'appearance') body.push(appearanceTab({ h, P, ux, patchAppearance, dictInfo: props?.dictInfo, packsDir, storage, section, field, setUx }))
      else body.push(h(YoudaoTab, {
        key: 'youdao', h, P, book, say, onGoBook: () => { setTab('book'); setMessage(null) },
      }))

      return h(Page, null, [
        h(PageHeader, {
          key: 'hdr',
          title: '英语翻译',
          desc: '在对话里点击或划选英文单词看释义，划选纯英文句子翻成中文。生词本会自动高亮你已经背过的词。',
          extra: [
            h(Badge, { key: 'b', text: '离线', tone: 'success' }),
            h(Badge, { key: 'c', text: `${stats.total} 词`, tone: 'neutral' }),
          ],
        }),

        h('div', { key: 'tabs' }, h(Tabs, {
          items: tabs, value: tab, onChange: (id) => { setTab(id); setMessage(null) }, label: '英语翻译分页',
        })),

        ...body,

        message !== null
          ? h(Note, {
            key: 'msg',
            tone: message.tone === 'err' ? 'err' : message.tone === 'info' ? 'info' : 'ok',
            text: message.text,
          })
          : null,
      ])
    }

/* ═══════════════════════════════════════════════════════════════════════
   Tab 1：生词本管理台
   ═══════════════════════════════════════════════════════════════════════ */

    function bookTab(ctx) {
      const { h, P, book, dict, stats, say, bump, storage } = ctx
      const { Card, Button, Input, Select, Badge, Note, Stat, Chip, Checkbox, GAP, FS, C } = P

      const [query, setQuery] = useState('')
      const [stateFilter, setStateFilter] = useState('all')
      const [bookFilter, setBookFilter] = useState('all')
      const [sortMode, setSortMode] = useState('recent')
      const [page, setPage] = useState(0)
      const [expanded, setExpanded] = useState(null)
      const [selected, setSelected] = useState([])
      const [removing, setRemoving] = useState(null)
      const [noteEditing, setNoteEditing] = useState(null)
      const [noteDraft, setNoteDraft] = useState('')

      const all = (() => {
        try { return typeof book?.list === 'function' ? book.list() : [] } catch { return [] }
      })()
      const books = (() => {
        try { return typeof book?.listBooks === 'function' ? book.listBooks() : [] } catch { return [] }
      })()

      const filtered = all.filter((entry) => {
        if (stateFilter !== 'all' && entry.state !== stateFilter) return false
        if (bookFilter !== 'all' && !booksOfEntry(entry).includes(bookFilter)) return false
        return matchQuery(entry, query.trim(), dict)
      })
      const sorted = sortEntries(filtered, sortMode)
      const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
      const safePage = Math.min(page, pageCount - 1)
      const rows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
      const pageHeads = rows.map((row) => row.head)
      const allOnPageSelected = pageHeads.length > 0 && pageHeads.every((head) => selected.includes(head))

      const toggleSelect = (head, on) => {
        setSelected((prev) => {
          if (on) return prev.includes(head) ? prev : [...prev, head]
          return prev.filter((item) => item !== head)
        })
      }

      const onBatchState = (state) => {
        if (selected.length === 0 || typeof book?.setState !== 'function') return
        Promise.all(selected.map((head) => book.setState(head, state)))
          .then(() => { say(`已把 ${selected.length} 个词转为「${stateLabel(state)}」`); setSelected([]); bump() })
          .catch(() => say('批量转状态失败', 'err'))
      }

      const onBatchMove = (bookId) => {
        if (selected.length === 0 || typeof book?.importMany !== 'function') return
        book.importMany(selected, 'manual', { bookId })
          .then(() => { say(`已把 ${selected.length} 个词加入所选词书`); setSelected([]); bump() })
          .catch(() => say('移入词书失败', 'err'))
      }

      const onBatchRemove = () => {
        if (selected.length === 0 || typeof book?.remove !== 'function') return
        Promise.all(selected.map((head) => book.remove(head)))
          .then(() => { say(`已移出 ${selected.length} 个词`); setSelected([]); setRemoving(null); bump() })
          .catch(() => say('移出失败', 'err'))
      }

      const onExport = (kind) => {
        const entries = typeof book?.exportAll === 'function' ? book.exportAll() : all
        const stamp = new Date().toISOString().slice(0, 10)
        let text = ''
        let name = ''
        let mime = 'text/plain;charset=utf-8'
        if (kind === 'txt') { text = exportTxt(entries); name = `生词本-${stamp}.txt` }
        else if (kind === 'csv') { text = exportCsv(entries); name = `生词本-${stamp}.csv`; mime = 'text/csv;charset=utf-8' }
        else { text = exportJson(book); name = `生词本备份-${stamp}.json`; mime = 'application/json;charset=utf-8' }
        if (entries.length === 0) { say('生词本还是空的，没有可导出的内容', 'info'); return }
        if (downloadText(text, name, mime)) say(`已导出 ${entries.length} 个词（${name}）`)
        else say('导出失败：浏览器不让下载', 'err')
      }

      const onClear = () => {
        if (typeof book?.remove !== 'function') return
        const total = all.length
        if (total === 0) { say('生词本已经是空的', 'info'); return }
        if (removing !== '__clear__') {
          setRemoving('__clear__')
          say(`再点一次「确认清空」会删掉 ${total} 个生词，这个操作不能撤销。`, 'info')
          return
        }
        setRemoving(null)
        Promise.all(all.map((entry) => book.remove(entry.head)))
          .then(() => { say('已清空'); setSelected([]); bump() })
          .catch(() => say('清空失败', 'err'))
      }

      const stateChips = [
        { id: 'all', label: '全部', count: all.length },
        { id: 'new', label: '未学', count: stats.byState.new ?? 0 },
        { id: 'unknown', label: '不认识', count: stats.byState.unknown ?? 0 },
        { id: 'fuzzy', label: '记错', count: stats.byState.fuzzy ?? 0 },
        { id: 'known', label: '已掌握', count: stats.byState.known ?? 0 },
      ]

      const dueText = (entry) => dueLabel(entry.srs?.due ?? 0)

      return h('div', { key: 'booktab', style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
    /* 统计条 */
        h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Stat, { key: 's1', label: '总词数', value: stats.total }),
          h(Stat, { key: 's2', label: '今日到期', value: stats.dueToday, tone: stats.dueToday > 0 ? 'accent' : 'neutral' }),
          h(Stat, { key: 's3', label: '已掌握', value: stats.byState.known ?? 0, tone: 'success' }),
          h(Stat, { key: 's4', label: '连续学习', value: `${stats.streak ?? 0} 天`, tone: stats.streak > 0 ? 'success' : 'neutral' }),
        ]),

    /* 状态占比条 + 30 天打卡 */
        h(Card, { key: 'chart', title: '掌握度与打卡', hint: '四态占比横条；下面 30 格是最近 30 天的复习次数，颜色越深复习越多。' }, [
          h(StatusBar, { key: 'bar', h, P, byState: stats.byState, total: stats.total }),
          h(HeatGrid, { key: 'heat', h, P, days: stats.days, }),
        ]),

    /* 工具行 */
        h(Card, { key: 'tools', title: '词表', hint: null }, [
          h('div', { key: 'row1', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
            h('div', { key: 'q', style: { flex: '1 1 200px', minWidth: 160 } }, h(Input, {
              type: 'search',
              value: query,
              placeholder: '按词头或释义搜索',
              onChange: (value) => { setQuery(value); setPage(0) },
            })),
            h(Select, {
              key: 'bk',
              value: bookFilter,
              onChange: (value) => { setBookFilter(value); setPage(0) },
              options: [{ value: 'all', label: '全部词书' }, ...books.map((item) => ({ value: item.id, label: item.name }))],
            }),
            h(Select, {
              key: 'sort',
              value: sortMode,
              onChange: (value) => { setSortMode(value); setPage(0) },
              options: SORT_OPTIONS.map((item) => ({ value: item.id, label: item.label })),
            }),
          ]),

          h('div', { key: 'row2', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            stateChips.map((chip) => h(Chip, {
              key: chip.id, label: chip.label, count: chip.count, active: stateFilter === chip.id,
              onClick: () => { setStateFilter(chip.id); setPage(0) },
            }))),

      /* 批量操作 */
          selected.length > 0
            ? h('div', { key: 'batch', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.border1}`, background: C.bg1 } }, [
              h('span', { key: 'n', style: { fontSize: FS.small, color: C.textDim } }, `已选 ${selected.length} 个`),
              h(Button, { key: 'b1', label: '转为已掌握', size: 'sm', onClick: () => onBatchState('known') }),
              h(Select, {
                key: 'bk2',
                value: '',
                onChange: (value) => { if (value !== '') onBatchMove(value) },
                options: [{ value: '', label: '移入词书…' }, ...books.map((item) => ({ value: item.id, label: item.name }))],
              }),
              removing === '__batch__'
                ? h(Button, { key: 'b2', label: '确认移出', variant: 'primary', size: 'sm', onClick: onBatchRemove })
                : h(Button, { key: 'b2', label: '移出', variant: 'danger', size: 'sm', onClick: () => { setRemoving('__batch__'); say(`再点一次「确认移出」会删掉这 ${selected.length} 个词。`, 'info') } }),
              removing === '__batch__'
                ? h(Button, { key: 'b3', label: '取消', variant: 'ghost', size: 'sm', onClick: () => setRemoving(null) })
                : null,
            ])
            : null,

      /* 词表 */
          sorted.length === 0
            ? h('p', { key: 'empty', style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textFaint } },
              all.length === 0
                ? '还没有生词。在对话里点开一个词，点标题旁边的 ☆ 就能收进来。'
                : '当前筛选下没有词。换个状态或词书试试。')
            : h('div', { key: 'table', className: 'hds-table' }, [
              h('div', { key: 'thead', className: 'hds-thead' }, [
                h('span', { key: 'c' }, h(Checkbox, {
                  checked: allOnPageSelected,
                  label: '全选本页',
                  onChange: (on) => {
                    if (!on) setSelected((prev) => prev.filter((head) => !pageHeads.includes(head)))
                    else setSelected((prev) => [...new Set([...prev, ...pageHeads])])
                  },
                })),
                h('span', { key: 'w' }, '词头'),
                h('span', { key: 's' }, '状态'),
                h('span', { key: 'd' }, '下次复习'),
                h('span', { key: 'r' }, '来源'),
                h('span', { key: 'o', style: { textAlign: 'right' } }, '操作'),
              ]),
              ...rows.map((entry) => {
                const open = expanded === entry.head
                const node = h('div', { key: `row-${entry.head}`, className: 'hds-trow' }, [
                  h('span', { key: 'c' }, h(Checkbox, {
                    checked: selected.includes(entry.head),
                    label: `选择 ${entry.head}`,
                    onChange: (on) => toggleSelect(entry.head, on),
                  })),
                  h('span', { key: 'w', className: 'hds-cell-head' }, h('button', {
                    type: 'button',
                    onClick: () => setExpanded(open ? null : entry.head),
                  }, entry.head)),
                  h('span', { key: 's' }, h(Badge, { text: stateLabel(entry.state), tone: stateTone(entry.state) })),
                  h('span', { key: 'd', className: 'hds-cell-dim' }, dueText(entry)),
                  h('span', { key: 'r', className: 'hds-cell-dim' }, SOURCE_LABEL[entry.source] ?? entry.source),
                  h('span', { key: 'o', className: 'hds-cell-ops' }, [
                    h(Select, {
                      key: 'st',
                      value: entry.state,
                      onChange: (value) => {
                        Promise.resolve(book.setState(entry.head, value))
                          .then(() => { say(`「${entry.head}」转为「${stateLabel(value)}」`); bump() })
                          .catch(() => say('转状态失败', 'err'))
                      },
                      options: Object.keys(STATE_META).map((id) => ({ value: id, label: stateLabel(id) })),
                    }),
                    h(Button, {
                      key: 'note', label: noteEditing === entry.head ? '存备注' : '备注', size: 'sm', variant: 'ghost',
                      onClick: () => {
                        if (noteEditing === entry.head) {
                          Promise.resolve(book.setNote(entry.head, noteDraft))
                            .then(() => { say('备注已保存'); setNoteEditing(null); bump() })
                            .catch(() => say('备注保存失败', 'err'))
                        } else {
                          setNoteEditing(entry.head)
                          setNoteDraft(entry.note ?? '')
                        }
                      },
                    }),
                    removing === entry.head
                      ? h(Button, { key: 'x', label: '确认移出', variant: 'primary', size: 'sm', onClick: () => {
                        Promise.resolve(book.remove(entry.head))
                          .then(() => { say(`已移出「${entry.head}」`); setRemoving(null); setExpanded(null); bump() })
                          .catch(() => say('移出失败', 'err'))
                      } })
                      : h(Button, { key: 'x', label: '移出', variant: 'danger', size: 'sm', onClick: () => { setRemoving(entry.head); say(`再点一次「确认移出」会删掉「${entry.head}」`, 'info') } }),
                  ]),
                ])
                if (!open) return node
                return [
                  node,
                  h('div', { key: `det-${entry.head}`, className: 'hds-trow', style: { display: 'block', padding: '0 12px 10px' } },
                    h(EntryDetail, { h, P, entry, dict, noteEditing, noteDraft, setNoteDraft })),
                ]
              }).flat(),
            ]),

      /* 分页 + 导出 */
          sorted.length > PAGE_SIZE
            ? h('div', { key: 'pager', className: 'hds-pager' }, [
              h('span', { key: 'info' }, `第 ${safePage + 1}/${pageCount} 页 · 共 ${sorted.length} 个`),
              h('span', { key: 'btns', style: { display: 'flex', gap: GAP.xs } }, [
                h(Button, { key: 'prev', label: '上一页', size: 'sm', disabled: safePage <= 0, onClick: () => setPage(Math.max(0, safePage - 1)) }),
                h(Button, { key: 'next', label: '下一页', size: 'sm', disabled: safePage >= pageCount - 1, onClick: () => setPage(Math.min(pageCount - 1, safePage + 1)) }),
              ]),
            ])
            : h('div', { key: 'pager1', className: 'hds-pager' }, [
              h('span', { key: 'info' }, sorted.length === 0 ? '没有词' : `共 ${sorted.length} 个词`),
            ]),

          h('div', { key: 'exports', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
            h(Button, { key: 't', label: '导出 txt', size: 'sm', disabled: all.length === 0, onClick: () => onExport('txt') }),
            h(Button, { key: 'c', label: '导出 CSV（带状态与释义）', size: 'sm', disabled: all.length === 0, onClick: () => onExport('csv') }),
            h(Button, { key: 'j', label: '导出 JSON 备份', size: 'sm', disabled: all.length === 0, onClick: () => onExport('json') }),
            h(Button, {
              key: 'clear',
              label: removing === '__clear__' ? '确认清空' : '清空生词本',
              variant: removing === '__clear__' ? 'primary' : 'danger',
              size: 'sm',
              disabled: all.length === 0,
              onClick: onClear,
            }),
            removing === '__clear__'
              ? h(Button, { key: 'cancel', label: '取消', variant: 'ghost', size: 'sm', onClick: () => { setRemoving(null); say('已取消', 'info') } })
              : null,
          ]),
        ]),
      ])
    }

/** 四态占比横条。纯 CSS，不引图表库。 */
    function StatusBar(props) {
      const { h, P, byState, total } = props
      const { C } = P
      const colors = {
        new: `color-mix(in srgb, ${C.textFaint} 55%, transparent)`,
        unknown: C.danger,
        fuzzy: C.warn,
        known: C.success,
      }
      const safeTotal = total > 0 ? total : 1
      const order = ['known', 'fuzzy', 'unknown', 'new']
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        h('div', { key: 'bar', className: 'hds-bar' }, order.map((state) => {
          const value = byState?.[state] ?? 0
          if (value === 0) return null
          return h('span', {
            key: state,
            title: `${stateLabel(state)} ${value}`,
            style: { width: `${(value / safeTotal) * 100}%`, background: colors[state] },
          })
        })),
        h('div', { key: 'legend', style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: FS.small, color: C.textDim } }, order.map((state) => h('span', {
          key: state,
          style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
        }, [
          h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 2, background: colors[state] } }),
          `${stateLabel(state)} ${byState?.[state] ?? 0}`,
        ]))),
      ])
    }

/** 近 30 天打卡格子：颜色深浅 = 当日复习数。 */
    function HeatGrid(props) {
      const { h, P, days } = props
      const { C } = P
      const list = Array.isArray(days) ? days : []
      const max = list.reduce((acc, day) => Math.max(acc, day.reviewed ?? 0), 0)
      const cellBg = (count) => {
        if (!count) return `color-mix(in srgb, ${C.textFaint} 12%, transparent)`
        const ratio = max > 0 ? count / max : 1
        return `color-mix(in srgb, ${C.success} ${Math.round(18 + ratio * 62)}%, transparent)`
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
        h('div', { key: 'grid', className: 'hds-heat' }, list.map((day, index) => h('span', {
          key: day.date ?? index,
          className: 'hds-heat-cell',
          title: `${day.date} · 复习 ${day.reviewed ?? 0} · 新增 ${day.added ?? 0}`,
          style: { background: cellBg(day.reviewed ?? 0) },
        }))),
        h('div', { key: 'legend', className: 'hds-heat-legend' }, [
          h('span', { key: 'l' }, '30 天前'),
          h('span', { key: 'a', style: { width: 9, height: 9, borderRadius: 2, background: cellBg(1) } }),
          h('span', { key: 'b', style: { width: 9, height: 9, borderRadius: 2, background: cellBg(max || 4) } }),
          h('span', { key: 'r' }, '今天'),
        ]),
      ])
    }

/** 行内详情：词库释义 / 音标 / 例句；查不到就老实说查不到（CETgo 口径）。 */
    function EntryDetail(props) {
      const { h, P, entry, dict, noteEditing, noteDraft, setNoteDraft } = props
      const { Input, Note, C, FS } = P

      let described = null
      const raw = dict?.entries?.[normalizeKey(entry.head)]
      if (raw) {
        try { described = describeEntry(raw) } catch { described = null }
      }
      const seen = entry.review?.seen ?? 0
      const lastSeen = entry.review?.lastSeenAt ?? 0
      const seenText = seen > 0
        ? `查过 ${seen} 次 · 最近 ${lastSeen > 0 ? dueLabel(lastSeen) : '未知'}`
        : '还没查过'

      const rows = []
      if (described && described.senses.length > 0) {
        rows.push(h('div', { key: 'senses', className: 'hds-detail-row' }, [
          h('span', { key: 'k', className: 'hds-detail-key' }, '释义'),
          h('span', { key: 'v', className: 'hds-detail-val' }, described.senses.slice(0, 3).map((sense, index) => h('div', {
            key: index, className: 'hds-detail-sense',
          }, [
            sense.posLabel ? h('span', { key: 'p', className: 'hds-detail-pos' }, sense.posLabel) : null,
            h('span', { key: 'z' }, sense.zh.join('；')),
          ]))),
        ]))
      } else if (typeof entry.gloss === 'string' && entry.gloss.trim() !== '') {
        rows.push(h('div', { key: 'gloss', className: 'hds-detail-row' }, [
          h('span', { key: 'k', className: 'hds-detail-key' }, '释义'),
          h('span', { key: 'v', className: 'hds-detail-val' }, entry.gloss),
        ]))
      } else {
        rows.push(h(Note, { key: 'nodict', tone: 'info', text: '词库未收录，暂无释义（可以自己写一条备注）' }))
      }

      if (described && described.examples.length > 0) {
        const sample = described.examples[0]
        rows.push(h('div', { key: 'ex', className: 'hds-detail-row' }, [
          h('span', { key: 'k', className: 'hds-detail-key' }, '例句'),
          h('span', { key: 'v', className: 'hds-detail-val' }, `${sample?.en ?? ''}　${sample?.zh ?? ''}`),
        ]))
      }

      rows.push(h('div', { key: 'meta', className: 'hds-detail-row' }, [
        h('span', { key: 'k', className: 'hds-detail-key' }, '记录'),
        h('span', { key: 'v', className: 'hds-detail-val', style: { fontSize: FS.small, color: C.textDim } },
          `${seenText} · 加于 ${new Date(entry.addedAt ?? 0).toLocaleDateString()} · 复习 ${entry.srs?.reps ?? 0} 次对 / ${entry.srs?.lapses ?? 0} 次错`),
      ]))

      if (noteEditing === entry.head) {
        rows.push(h(Input, {
          key: 'noteinput',
          value: noteDraft,
          placeholder: '写一条备注（最多 500 字）',
          onChange: setNoteDraft,
        }))
      } else if ((entry.note ?? '') !== '') {
        rows.push(h('div', { key: 'note', className: 'hds-detail-row' }, [
          h('span', { key: 'k', className: 'hds-detail-key' }, '备注'),
          h('span', { key: 'v', className: 'hds-detail-val' }, entry.note),
        ]))
      }

      return h('div', { className: 'hds-detail' }, rows)
    }

/* ═══════════════════════════════════════════════════════════════════════
   Tab 2：复习卡
   ═══════════════════════════════════════════════════════════════════════ */

    function ReviewTab(props) {
      const { h, P, book, dict, stats, say, bump } = props
      const { Card, Button, Note, Stat, Chip, Segment, GAP, FS, C } = P

      const [direction, setDirection] = useState('en-zh')
      const [filter, setFilter] = useState('all')
      const [bookFilter, setBookFilter] = useState('all')
      const [flipped, setFlipped] = useState(false)
      const [index, setIndex] = useState(0)
      const [answered, setAnswered] = useState([])
      const [roundDone, setRoundDone] = useState(false)
      const [queue, setQueue] = useState(null)

      const books = (() => {
        try { return book?.listBooks?.() ?? [] } catch { return [] }
      })()

  /** 造一轮队列（到期 + 筛选 + 方向）。 */
      const buildQueue = (ahead = false) => {
        let base = []
        try {
          if (ahead) base = aheadQueue(typeof book?.list === 'function' ? book.list() : [], AHEAD_COUNT)
          else base = typeof book?.dueQueue === 'function' ? book.dueQueue() : []
        } catch { base = [] }
        const filtered = filterQueue(base, { state: filter, bookId: bookFilter })
        return queueForDirection(filtered, direction, dict)
      }

      const current = queue === null ? null : (queue[index] ?? null)
      const remaining = queue === null ? 0 : Math.max(0, queue.length - index)

      const startRound = (ahead = false) => {
        setQueue(buildQueue(ahead))
        setIndex(0)
        setAnswered([])
        setRoundDone(false)
        setFlipped(false)
      }

      const grade = (value) => {
        if (!current || typeof book?.grade !== 'function') return
        Promise.resolve(book.grade(current.head, value))
          .then(() => {
            setAnswered((prev) => [...prev, { head: current.head, grade: value }])
            setFlipped(false)
            const next = index + 1
            if (queue && next >= queue.length) setRoundDone(true)
            setIndex(next)
            bump()
          })
          .catch(() => say('评分失败', 'err'))
      }

  /* 键盘：空格/回车翻面，1/2/3 评分，Esc 退出本轮 */
      useEffect(() => {
        const onKey = (event) => {
          if (!shouldHandleKey(event)) return
          const action = actionForKey(event.key)
          if (action === '') return
          event.preventDefault?.()
          if (action === 'exit') { setRoundDone(false); setQueue(null); return }
          if (!current) return
          if (action === 'flip') { setFlipped((prev) => !prev); return }
          grade(action)
        }
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('keydown', onKey)
          return () => { try { window.removeEventListener('keydown', onKey) } catch { /* ignore */ } }
        }
        return undefined
      }, [current, queue, index])

      const summary = roundSummary(answered)
      const back = current && flipped ? cardBackFor(current.head, dict) : null
      const brief = current && direction === 'zh-en' ? briefTextFor(current, dict) : ''

  /* ── 本轮结束 ── */
      if (roundDone) {
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
          h(Card, { key: 'done', title: '本轮结束', hint: `复习了 ${summary.total} 个词。` }, [
            h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
              h(Stat, { key: 'a', label: '正确率', value: `${summary.accuracy}%`, tone: summary.accuracy >= 70 ? 'success' : 'warn' }),
              h(Stat, { key: 'b', label: '认识', value: summary.good, tone: 'success' }),
              h(Stat, { key: 'c', label: '记错', value: summary.hard, tone: 'warn' }),
              h(Stat, { key: 'd', label: '不认识', value: summary.again, tone: 'danger' }),
            ]),
            h(StatusBar, { key: 'bar', h, P, byState: stats.byState, total: stats.total }),
            h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
              h(Button, { key: 'again', label: '再来一轮', variant: 'primary', onClick: () => startRound(false) }),
            ]),
          ]),
        ])
      }

  /* ── 未开始 / 队列空 ── */
      if (queue === null || queue.length === 0) {
        const empty = queue !== null && queue.length === 0
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
          h(Card, {
            key: 'start',
            title: empty ? '今天没有到期的词' : '开始复习',
            hint: empty ? '队列是空的。可以提前复习最早到期的词，或去导入新词。' : `今日到期 ${stats.dueToday} 个。空格翻面，1/2/3 评分。`,
          }, [
            h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
              h(Stat, { key: 'a', label: '今日到期', value: stats.dueToday, tone: 'accent' }),
              h(Stat, { key: 'b', label: '总词数', value: stats.total }),
              h(Stat, { key: 'c', label: '连续学习', value: `${stats.streak ?? 0} 天`, tone: 'success' }),
            ]),
            h('div', { key: 'filters', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
              h(Segment, { key: 'dir', items: DIRECTIONS, value: direction, onChange: setDirection, label: '出题方向' }),
              h('span', { key: 'sep', style: { fontSize: FS.small, color: C.textDim } }, '筛选'),
              ...REVIEW_FILTERS.map((item) => h(Chip, {
                key: item.id, label: item.label, active: filter === item.id,
                onClick: () => setFilter(item.id),
              })),
              books.length > 1
                ? h('select', {
                  key: 'bk',
                  value: bookFilter,
                  onChange: (event) => setBookFilter(event.target.value),
                  style: { font: 'inherit', fontSize: FS.body, padding: '5px 9px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.bgBase, color: C.text },
                }, [{ value: 'all', label: '全部词书' }, ...books.map((item) => ({ value: item.id, label: item.name }))].map((option) => h('option', { key: option.value, value: option.value }, option.label)))
                : null,
            ]),
            h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
              h(Button, { key: 'go', label: empty ? '提前复习最早到期的 20 个' : '开始复习', variant: 'primary', onClick: () => startRound(empty) }),
            ]),
            stats.total === 0
              ? h(Note, { key: 'tip', tone: 'info', text: '生词本还是空的。先在对话里收藏几个词，或去「导入」页签批量加词。' })
              : null,
          ]),
        ])
      }

  /* ── 卡片 ── */
      const front = current.head
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
        h(Card, { key: 'card', title: '复习', hint: null }, [
          h('div', { key: 'top', className: 'hds-review-top' }, [
            h('span', { key: 'l', style: { fontSize: FS.small, color: C.textDim } },
              `今日到期 ${stats.dueToday} 个 · 本轮已复习 ${summary.total} 个 · 剩余 ${remaining}`),
            h(Segment, { key: 'dir', items: DIRECTIONS, value: direction, onChange: (id) => { setDirection(id); setQueue(null) }, label: '出题方向' }),
          ]),

          h('div', {
            key: 'stage',
            className: 'hds-cardstage',
            role: 'button',
            tabIndex: 0,
            onClick: () => setFlipped((prev) => !prev),
          }, flipped
            ? h('div', { key: 'back', className: 'hds-cardstage-back' }, [
          // 背面内容块（词头 + 🔊 + 义项≤3 + 例句）整段复用 review.js 的 ReviewCardBack。
          // 它与 card.js 的卡片背面共用同一份实现，发音按钮跟着一起来了（§E1），
          // 不需要在设置页再维护一套「词头 + 释义 + 例句」的模板。
              h(ReviewCardBack, {
                key: 'back',
                word: front,
                back,
                gloss: current.gloss ?? '',
                size: 'md',
                P,
              }),
          // 评分键盘提示留在外层：ReviewCardBack 只画「这个词长什么样」，
          // 不掺入复习流程的交互说明（那些属于 ReviewTab 的职责）。
              h('div', { key: 'tip', className: 'hds-cardstage-tip' }, '1 ✗ 不认识 · 2 ↻ 记错 · 3 ✓ 认识 · 空格再翻一次'),
            ])
            : h('div', { key: 'front', style: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' } }, [
              h('div', { key: 'w', className: 'hds-cardstage-word' }, direction === 'zh-en' ? (brief || '（无释义）') : front),
              h('div', { key: 'tip', className: 'hds-cardstage-tip' }, '点卡片或按空格翻面'),
            ])),
        ]),

        h('div', { key: 'grades', className: 'hds-grade-row' }, GRADE_BUTTONS.map((item) => h('button', {
          key: item.grade,
          type: 'button',
          className: `hds-grade-btn hds-grade-${item.grade}`,
          onClick: () => grade(item.grade),
        }, [
          h('span', { key: 'l', style: { fontSize: FS.body } }, item.label),
          h('small', { key: 'k', style: { fontSize: 10.5, opacity: 0.7 } }, `键 ${item.key}`),
        ]))),
      ])
    }

/* ═══════════════════════════════════════════════════════════════════════
   Tab 3：粘贴导入
   ═══════════════════════════════════════════════════════════════════════ */

    function ImportTab(props) {
      const { h, P, book, dict, say, bump } = props
      const { Card, Button, Input, Select, Badge, Note, Field, GAP, FS, C } = P

      const [text, setText] = useState('')
      const [bookId, setBookId] = useState('default')
      const [newBookName, setNewBookName] = useState('')
      const [parsed, setParsed] = useState(null)
      const [showSkipped, setShowSkipped] = useState(false)
      const [busy, setBusy] = useState('')
      const [fileName, setFileName] = useState('')

      const books = (() => {
        try { return book?.listBooks?.() ?? [] } catch { return [] }
      })()

      const probes = {
        isDup: (head) => (typeof book?.has === 'function' ? book.has(head) : false),
        isKnown: (head) => Boolean(dict?.entries?.[head]),
      }

      const onParse = () => {
        if (text.trim() === '') { say('先粘贴或用文件读入一些内容', 'info'); return }
        let result = null
        try { result = parseImportDetailed(text, probes) } catch { result = null }
        if (!result) { say('解析失败：这段内容读不出词', 'err'); return }
        setParsed(result)
        setShowSkipped(false)
        const sum = summarizeImport(result)
        say(`识别 ${sum.total} 个词：新增 ${sum.fresh}、已存在 ${sum.dup}、词库未收录 ${sum.nodict}${sum.skipped > 0 ? `；跳过 ${sum.skipped} 行` : ''}`, 'info')
      }

      const onConfirm = () => {
        if (!parsed || parsed.words.length === 0) return
        if (typeof book?.importMany !== 'function') { say('生词本还没就绪', 'err'); return }
        setBusy('import')
        const targetBook = newBookName.trim() !== '' ? null : bookId
        const prepare = newBookName.trim() !== ''
          ? Promise.resolve(typeof book.createBook === 'function' ? book.createBook(newBookName.trim()) : null)
          : Promise.resolve(null)
        prepare.then((created) => {
          const id = created?.id ?? targetBook ?? 'default'
      // 备份恢复：带 record 的行整条传下去，保住 state/srs/bookId
          const records = parsed.words
            .filter((row) => row.status !== 'dup')
            .map((row) => {
              const gloss = glossText(row)
              if (row.record && typeof row.record === 'object') return { ...row.record, head: row.head, gloss: row.record.gloss || gloss }
              return { head: row.head, gloss }
            })
          return book.importMany(records, 'import', { bookId: id }).then((added) => {
            bump()
            setBusy('')
            setParsed(null)
            setText('')
            setFileName('')
            setNewBookName('')
            say(`导入完成：新增 ${added} 个${created ? `，新词书「${created.name}」已建立` : ''}`)
          })
        }).catch(() => { setBusy(''); say('导入失败', 'err') })
      }

      const onFile = (event) => {
        const file = event?.target?.files?.[0]
        if (!file) return
        setFileName(file.name)
        try {
          const reader = new FileReader()
          reader.onload = () => {
            const content = typeof reader.result === 'string' ? reader.result : ''
            setText(content)
            setParsed(null)
            say(`已读入「${file.name}」（${content.length} 字符），点「解析预览」看结果`, 'info')
          }
          reader.onerror = () => say('文件读取失败', 'err')
          reader.readAsText(file, 'utf-8')
        } catch {
          say('这个浏览器不支持读取本地文件', 'err')
        }
      }

      const sum = parsed ? summarizeImport(parsed) : null

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
        h(Card, {
          key: 'input',
          title: '导入生词',
          hint: '两步：先在下面粘贴或读入内容，点「解析预览」看清会加什么，再点「确认导入」才真正写进生词本。',
        }, [
          h(Input, {
            key: 'ta',
            multiline: true,
            value: text,
            placeholder: '三种都认：\n一行一词\napple,ˈæpl,n. 苹果\nhello  /həˈloʊ/  int. 喂\n也可以直接粘本插件导出的 JSON 备份。',
            onChange: (value) => { setText(value); setParsed(null) },
          }),
          h('div', { key: 'file', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
            h('label', {
              key: 'fl',
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '5px 12px', borderRadius: 8, minHeight: 30,
                border: `1px solid ${C.border2}`, background: C.bg1,
                fontSize: FS.body, fontWeight: 580, color: C.text,
              },
            }, [
              '从文件读取',
              h('input', {
                key: 'in',
                type: 'file',
                accept: '.txt,.csv,.tsv,.json',
                style: { display: 'none' },
                onChange: onFile,
              }),
            ]),
            fileName !== ''
              ? h('span', { key: 'fn', style: { fontSize: FS.small, color: C.textDim } }, fileName)
              : h('span', { key: 'fn0', style: { fontSize: FS.small, color: C.textFaint } }, '支持 .txt / .csv / .tsv / .json'),
          ]),

          h('div', { key: 'book', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
            h(Select, {
              key: 'sel',
              value: bookId,
              onChange: setBookId,
              options: books.map((item) => ({ value: item.id, label: item.name })),
            }),
            h('div', { key: 'nb', style: { flex: '1 1 160px', minWidth: 140 } }, h(Input, {
              value: newBookName,
              placeholder: '或新建一本词书（填名字）',
              onChange: setNewBookName,
            })),
          ]),

          h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
            h(Button, {
              key: 'parse', label: '解析预览', variant: 'primary',
              disabled: text.trim() === '', busy: busy === 'parse',
              onClick: onParse,
            }),
            parsed && parsed.words.length > 0
              ? h(Button, {
                key: 'confirm',
                label: `确认导入 ${parsed.words.filter((row) => row.status !== 'dup').length} 个`,
                busy: busy === 'import',
                onClick: onConfirm,
              })
              : null,
            parsed !== null
              ? h(Button, { key: 'cancel', label: '清空预览', variant: 'ghost', onClick: () => { setParsed(null); setShowSkipped(false) } })
              : null,
          ]),
        ]),

        parsed !== null
          ? h(Card, {
            key: 'preview',
            title: '预览',
            hint: sum
              ? `识别 ${sum.total} 个词：新增 ${sum.fresh}、已存在 ${sum.dup}、词库未收录 ${sum.nodict}${sum.skipped > 0 ? `；跳过 ${sum.skipped} 行` : ''}。确认之前不会写库。`
              : null,
          }, [
            parsed.words.length === 0
              ? h(Note, { key: 'none', tone: 'warn', text: '这段内容里没有可用词条。看看下面的跳过原因。' })
              : h('div', { key: 'list', className: 'hds-preview' }, [
                h('div', { key: 'head', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: FS.small, color: C.textDim } }, [
                  h(Badge, { key: 'f', text: `格式 ${IMPORT_FORMATS.includes(parsed.format) ? parsed.format : 'plain'}`, tone: 'neutral' }),
                  h(Badge, { key: 'n', text: `新增 ${sum.fresh}`, tone: 'success' }),
                  h(Badge, { key: 'd', text: `已存在 ${sum.dup}`, tone: 'neutral' }),
                  h(Badge, { key: 'k', text: `未收录 ${sum.nodict}`, tone: 'warn' }),
                ]),
                h('div', { key: 'table', className: 'hds-preview-table' }, [
                  h('div', { key: 'th', className: 'hds-preview-row', style: { fontSize: FS.small, color: C.textDim, background: C.bg1 } }, [
                    h('span', { key: 'a' }, '行'),
                    h('span', { key: 'b' }, '词头'),
                    h('span', { key: 'c' }, '状态'),
                    h('span', { key: 'd' }, '释义'),
                  ]),
                  ...parsed.words.slice(0, PREVIEW_ROW_LIMIT).map((row) => h('div', { key: `r-${row.line}-${row.head}`, className: 'hds-preview-row' }, [
                    h('span', { key: 'a', className: 'hds-preview-line' }, String(row.line)),
                    h('span', { key: 'b', style: { fontWeight: 620 } }, row.head),
                    h('span', { key: 'c' }, h(Badge, {
                      text: row.status === 'dup' ? '已存在' : row.status === 'nodict' ? '词库未收录' : '将新增',
                      tone: row.status === 'dup' ? 'neutral' : row.status === 'nodict' ? 'warn' : 'success',
                    })),
                    h('span', { key: 'd', className: 'hds-preview-gloss' }, glossText(row) || '—'),
                  ])),
                ]),
                parsed.words.length > PREVIEW_ROW_LIMIT
                  ? h('p', {
                    key: 'more',
                    style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textFaint },
                  }, `预览只显示前 ${PREVIEW_ROW_LIMIT} 行，还有 ${parsed.words.length - PREVIEW_ROW_LIMIT} 行没显示；点「确认导入」时会把这些也一起导进去。`)
                  : null,
              ]),

            parsed.skipped.length > 0
              ? h('div', { key: 'skip', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
                h(Button, {
                  key: 'toggle',
                  label: showSkipped ? `收起跳过的 ${parsed.skipped.length} 行` : `跳过 ${parsed.skipped.length} 行（展开看原因）`,
                  size: 'sm',
                  variant: 'ghost',
                  onClick: () => setShowSkipped((prev) => !prev),
                }),
                showSkipped
                  ? h('div', { key: 'skips', className: 'hds-preview-skip' }, parsed.skipped.map((row, index) => h('div', {
                    key: `s-${row.line}-${index}`, className: 'hds-skip-row',
                  }, [
                    h('span', { key: 'l', className: 'hds-skip-line' }, `#${row.line}`),
                    h('span', { key: 'r', style: { flex: '0 0 auto', fontWeight: 600 } }, row.reason),
                    h('span', { key: 't', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.raw || '（空行）'),
                  ])))
                  : null,
              ])
              : null,
          ])
          : null,
      ])
    }

/* ═══════════════════════════════════════════════════════════════════════
   Tab 4：外观与交互（原有字段全保留）
   ═══════════════════════════════════════════════════════════════════════ */

    const WORD_PACKS = [
      { id: 'core', name: '核心词库', builtin: true, desc: '20,499 个考纲核心词：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE，每个词带词性、中文释义、英文释义与变音标注。' },
      { id: 'roots', name: '词根词缀库', builtin: true, desc: '6,374 个词的词根词缀拆解，来自 ECDICT 词根库（MIT）。' },
      { id: 'examples', name: '双语例句库', builtin: true, desc: '8,960 个词的中英对照例句，来自 Tatoeba（CC BY 2.0 FR）。' },
    ]

    function appearanceTab(ctx) {
      const { h, P, ux, patchAppearance, packsDir, storage } = ctx
      const { Card, Button, Input, Select, Switch, Note, Field, GAP, FS, C } = P
      const section = (key, title, hint, children) => h(Card, { key, title, hint }, children)
      const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

      const [translator, setTranslator] = useState(() => readTranslator(storage))
      const [packs, setPacks] = useState(() => readPacks(storage))
      const [maxHanRatio, setMaxHanRatio] = useState(() => readMaxHanRatioRaw(storage))
      const [dictInfo, setDictInfo] = useState(null)

      useEffect(() => {
        let alive = true
        try {
          fetch('/api/dsh-hover-dict/meta.json')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (alive && data) setDictInfo(data) })
            .catch(() => { /* 拿不到就不显示 */ })
        } catch { /* ignore */ }
        return () => { alive = false }
      }, [])

  /* ── 生词着色设置组（设计 §C4） ──
     读写都走 patchAppearance → saveUx → localStorage；
     app.js 里包了 localStorage.setItem，写完立刻触发 marker 重算，所以这即时生效。 */
  /**
   * 当前标记色的原始存档值。
   *
   * 可能是哨兵 'theme-error'（默认，跟随主题错误红），也可能是七位 hex。
   * 判等必须拿这个原值比 —— 不能拿 markColorToCss 的结果比，
   * 否则「跟随主题」与「恰好也是 #e5484d」会混成同一个高亮态。
   */
      const markColorRaw = ux.appearance.markColor ?? DEFAULT_MARK_COLOR
  /** 解析成可用于 CSS 的颜色（哨兵→var(...)），给预览用。 */
      const markColor = markColorToCss(markColorRaw)
  /**
   * 当前是否「跟随主题错误红」。
   *
   * 必须拿**原始存档值**跟哨兵比，不能拿解析结果比 ——
   * markColor 已经是 `var(--dsw-alias-state-error-primary, #e5484d)`，
   * 拿它跟 'theme-error' 比永远为 false，高亮态就永远不会亮（踩过一次）。
   */
      const isThemeColor = markColorRaw === DEFAULT_MARK_COLOR

      const markPreview = (() => {
        const off = ux.appearance.markWords === false
    // 与 marker.js highlightCss 同一套解析：哨兵 → var(...)，hex → 原样
        const color = markColor
    // 已掌握的淡色也照抄 highlightCss：同色掺 50% 透明（不是另造一个 opacity）
        const knownColor = `color-mix(in srgb, ${color} 50%, transparent)`
        const markOne = (word, known) => {
          if (off) return h('span', { key: word }, word)
      // 只改字的颜色 —— 没有底色、没有下划线（用户裁定「只要改字的颜色」）
          return h('span', { key: word, style: { color: known ? knownColor : color } }, word)
        }
    // 预览句里几个词模拟「已收藏未掌握」，一个模拟「已掌握」（markKnown 开时淡色）
        return h('div', {
          key: 'preview',
          className: 'hds-mark-preview',
          'data-off': off ? 'true' : undefined,
          'aria-label': '生词着色预览',
        }, off
          ? 'The quick brown fox jumps over the lazy dog. —— 着色已关闭，正文不会变色'
          : [
            'The ',
            markOne('quick'),
            ' ',
            markOne('brown'),
            ' fox jumps over the ',
            markOne('lazy', ux.appearance.markKnown === true),
            ' dog.',
          ])
      })()

      const markSection = () => section('mark', '生词着色',
        '把生词本里还没掌握的词在助手回复和思考内容里标出来，一眼看见自己不会的词。只改这些字的颜色，不加底色、不加下划线，正文内容一个字都不动。',
        [
          field('m1', '着色开关',
            h(Switch, {
              checked: ux.appearance.markWords !== false,
              onChange: (next) => patchAppearance('markWords', next),
              label: ux.appearance.markWords !== false ? '开启' : '关闭（正文完全不变色）',
            }),
            '关掉之后正文一个字都不会变，浮层与生词本照常工作。'),

          field('m2', '标记颜色',
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } }, [
              h('div', { key: 'sw', className: 'hds-swatches' }, [
            // 首选项：跟随主题错误红（哨兵 'theme-error'，不是 hex）。
            // 与该词在正文里的实际取色同一个 token —— 换主题/暗色都跟着变。
                h('button', {
                  key: 'theme-error',
                  type: 'button',
                  className: 'hds-swatch',
                  'aria-label': '标记颜色：跟随主题错误红',
                  'aria-pressed': isThemeColor ? 'true' : 'false',
                  title: '跟随主题错误红',
                  style: {
                // 画成一道斜杠 + 红边，表示「这个色由主题决定」而不是某个固定色
                    background: `linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 22%, transparent), color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 70%, transparent))`,
                    borderColor: 'var(--dsw-alias-state-error-primary, #e5484d)',
                  },
                  onClick: () => patchAppearance('markColor', DEFAULT_MARK_COLOR),
                }),
                ...MARK_COLOR_PRESETS.map((preset) => h('button', {
                  key: preset,
                  type: 'button',
                  className: 'hds-swatch',
                  'aria-label': `用颜色 ${preset}`,
                  'aria-pressed': !isThemeColor && markColorRaw === preset ? 'true' : 'false',
                  style: { background: preset },
                  onClick: () => patchAppearance('markColor', preset),
                })),
                h('input', {
                  key: 'pick',
                  type: 'color',
              // <input type=color> 只认七位 hex；哨兵态下回落默认红，只是取色器的初始值，
              // 用户一动手就切到固定 hex（不改变「当前是跟随主题」这个事实被 aria-pressed 记录）
                  value: /^#[0-9a-f]{6}$/i.test(markColorRaw) ? markColorRaw : '#e5484d',
                  'aria-label': '自定义标记颜色',
                  title: '自定义颜色',
                  style: {
                    width: 34, height: 26, padding: 0, border: `1px solid ${C.border2}`,
                    borderRadius: 8, background: C.bgBase, cursor: 'pointer',
                  },
                  onChange: (event) => patchAppearance('markColor', event.target.value),
                }),
              ]),
              h('span', {
                key: 'now',
                style: { fontSize: FS.small, lineHeight: 1.8, color: C.textDim },
              }, isThemeColor
                ? '当前：跟随主题错误红（与工具报错的红色一致，随主题变化）'
                : `当前：固定颜色 ${markColorRaw}`),
            ]),
            '默认跟随主题错误红。只在词上改字体颜色，不加底色、不加下划线。'),

          field('m4', '已掌握的词也淡色显示',
            h(Switch, {
              checked: ux.appearance.markKnown === true,
              onChange: (next) => patchAppearance('markKnown', next),
              label: ux.appearance.markKnown === true ? '淡色显示' : '不着色',
            }),
            '默认不着色 —— 已经掌握的词不该继续刺眼。'),

          field('m5', '预览', markPreview, '改上面任何一项，这句会立刻跟着变；真实对话里的着色也是即时生效的。'),
        ])

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
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
          field('s3', '中文占比超过多少不翻译',
            h(Input, {
              type: 'number',
              value: String(Math.round(maxHanRatio * 100)),
              onChange: (v) => {
                const pct = Math.max(0, Math.min(100, Number(v) || 0))
                setMaxHanRatio(pct / 100)
                try { storage?.setItem?.('dsh-hover-dict:maxHanRatio', String(pct / 100)) } catch { /* ignore */ }
              },
              style: { maxWidth: 110 },
            }),
            '按百分比算：汉字数 ÷（汉字 + 英文字母）。超过这个比例就完全不弹窗，既不翻译也不提示。设 0 表示只要有一个汉字就不翻。'),
          field('s4', '显示考纲标签',
            h(Switch, {
              checked: ux.appearance.showTags !== false,
              onChange: (next) => patchAppearance('showTags', next),
              label: ux.appearance.showTags !== false ? '显示' : '隐藏',
            })),
        ]),

        markSection(),

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

        section('packs', '词库与句子库',
          '系统自带三个，随插件分发，完全离线。其余词库可以自己加。',
          [
            h('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } },
              WORD_PACKS.map((pack) => h('div', {
                key: pack.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: GAP.md,
                  padding: '13px 15px', borderRadius: 13,
                  border: `1px solid ${C.border2}`, background: C.bg1,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
                },
              }, [
                h('div', { key: 'm', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 } }, [
                  h('div', { key: 'n', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
                    h('span', { key: 't', style: { fontSize: FS.body, fontWeight: 650, color: C.text } }, pack.name),
                    h(P.Badge, { key: 'b', text: '系统自带', tone: 'neutral' }),
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
                    userSelect: 'all', overflowWrap: 'anywhere',
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
      ])
    }

/* ═══════════════════════════════════════════════════════════════════════
   Tab 5：有道同步（设计 §D3）
   ═══════════════════════════════════════════════════════════════════════ */

/** 有道路由前缀。与宿主 index.js 的 API_PREFIX 同源（net.js 也导出了一份）。 */
    const YOUDAO_BASE = `${API_PREFIX}/youdao`

/** 四步傻瓜引导（用户是 IT 小白，每步一句话说清点哪里）。 */
    const YOUDAO_STEPS = [
      { title: '登录有道词典', detail: '浏览器打开 dict.youdao.com，用你的账号登录。没登录的话下一步会拿到空的 Cookie。' },
      { title: '打开开发者工具', detail: '按 F12（Mac 是 ⌥⌘I），切到「网络 / Network」标签，然后刷新一次页面。' },
      { title: '复制 Cookie', detail: '在请求列表里点第一个请求，右侧找到「请求头 / Request Headers」，把 Cookie 那一整行的值全部复制。' },
      { title: '粘贴并保存', detail: '回到这里粘进下面的输入框，点「保存并验证」。看到昵称就是成功了。' },
    ]

/** 降级引导（宿主报接口改版时显示，设计 §D2 第 3 点）。 */
    const YOUDAO_FALLBACK_STEPS = [
      '在有道生词本页面，把词表整段全选复制（Ctrl/⌘ + A，再 Ctrl/⌘ + C）。',
      '切到本插件的「导入」页签，粘贴进去。',
      '点「解析预览」确认词表认得对，再点「确认导入」。',
    ]

/**
 * 有道路由统一请求。
 *
 * 与 net.js 的 fetchAsset 分工：那个只管词库文件（GET + ETag 缓存），
 * 这里要 POST/DELETE 并能把宿主的 `{ok:false,error:{code,message,fallback}}`
 * 原样带出来给面板判断（要不要显示降级区靠 error.fallback）。
 *
 * 永不抛：网络错也折成 { ok:false, error:{code:'E_NETWORK'} }，
 * 因为设置面板的渲染路径不该因为宿主没起而炸掉。
 */
    async function youdaoRequest(method, tail, body, timeoutMs = 30000) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const response = await fetch(`${YOUDAO_BASE}${tail}`, {
          method,
          credentials: 'same-origin',
          ...(body === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
          ...(controller ? { signal: controller.signal } : {}),
        })
        let payload = null
        try { payload = await response.json() } catch { payload = null }
        if (payload !== null && typeof payload === 'object') return payload
        return { ok: false, error: { code: 'E_BAD_JSON', message: '宿主返回的内容看不懂，请重启 DSH 后再试' } }
      } catch (error) {
        if (error?.name === 'AbortError') {
          return { ok: false, error: { code: 'E_YOUDAO_TIMEOUT', message: '超时了，收藏夹可能很大，稍后再试一次' } }
        }
        return { ok: false, error: { code: 'E_NETWORK', message: `连不上宿主，请确认插件已启用：${error?.message ?? error}` } }
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

/**
 * E_ → 面板话术。
 *
 * 宿主已经给了中文 message，这里只在少数需要「下一步做什么」的错误上
 * 补一句可操作的话；其余直接用宿主文案，不自己编。
 */
    function youdaoErrorText(error) {
      const code = String(error?.code ?? '')
      const message = typeof error?.message === 'string' && error.message !== '' ? error.message : '操作失败'
      if (code === 'E_YOUDAO_AUTH') return `${message}（依次按 F12 → 网络 → 刷新，重新复制 Cookie）`
      return message
    }

/**
 * 上次同步时间 → 「刚刚 / 3 分钟前 / 今天 14:20 / 11 月 20 日」。
 *
 * @param {number} at 时间戳
 * @param {number} [now] 便于测试注入
 * @returns {string}
 */
    function syncedAtLabel(at, now = Date.now()) {
      if (!Number.isFinite(at) || at <= 0) return '还没同步过'
      const diff = now - at
      if (diff < 60_000) return '刚刚同步过'
      if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前同步`
      const date = new Date(at)
      const hh = String(date.getHours()).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      if (diff < 24 * 3600_000) return `今天 ${hh}:${mm} 同步`
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日同步`
    }

/**
 * 状态卡三态（设计 §D3）。纯函数，单独可测。
 *
 *   empty  未配置：hasCookie=false                  → 四步引导
 *   ready  已配置且有效：hasCookie && valid          → 昵称 + 同步统计
 *   stale  已配置但失效：hasCookie && !valid         → 红条「重新复制」
 *   checking 还在查
 *
 * 注意 hasCookie 与 valid 是**两个独立维度**：宿主在 Cookie 失效时
 * 仍报 hasCookie=true（不清盘），这正是「失效红条」能显示出来的前提。
 *
 * @param {{ hasCookie?: boolean, valid?: boolean } | null} status
 * @param {boolean} [checking]
 * @returns {'checking'|'empty'|'ready'|'stale'}
 */
    function youdaoMode(status, checking) {
      if (checking) return 'checking'
      if (!status || status.hasCookie !== true) return 'empty'
      return status.valid === true ? 'ready' : 'stale'
    }

/**
 * 一键抓取完成后的结果条文案（设计 §D3）。
 *
 * **重要**：宿主返回的 added/dup 恒为 0（它不知道浏览器生词本里已有什么），
 * 真实数字必须前端算：抓取前记一次 size，importMany 之后再看一次。
 * 所以这里收的是「算好的」数字，不是宿主字段。纯函数，便于验证不算错。
 *
 * @param {{ before: number, after: number, fetched: number }} input
 * @returns {{ added: number, dup: number, total: number, text: string }}
 */
    function youdaoSyncResult(input) {
      const before = Number.isFinite(input?.before) ? Math.max(0, input.before) : 0
      const after = Number.isFinite(input?.after) ? Math.max(0, input.after) : before
      const fetched = Number.isFinite(input?.fetched) ? Math.max(0, input.fetched) : 0
  // 新增 = 生词本总量的真实增量；已存在 = 抓到的里面没能新建的
      const added = Math.max(0, after - before)
      const dup = Math.max(0, fetched - added)
      return {
        added,
        dup,
        total: fetched,
        text: fetched === 0
          ? '收藏夹里没有词（或者这本收藏夹是空的）'
          : `抓取完成：新增 ${added} 词，已存在 ${dup} 词（共 ${fetched} 个）。`,
      }
    }

/**
 * 有道同步页签。
 *
 * 三种状态（设计 §D3）：
 *   未配置  hasCookie=false            → 四步引导 + 输入框
 *   已配置  hasCookie=true  valid=true → 昵称 + 上次同步 + 抓取按钮
 *   已失效  hasCookie=true  valid=false→ 红条「重新复制」+ 输入框
 *
 * 抓取是一次性 POST /youdao/sync，没有真实进度，所以用不定长流光条 +
 * 「正在抓取…」文案，完成后直接出数字（不做 SSE）。
 */
    function YoudaoTab(props) {
      const { h, P, book, say: outerSay, onGoBook } = props
      const { Card, Button, Input, Select, Switch, Badge, Note, Field, GAP, FS, C } = P

      const [status, setStatus] = useState(null)   // 宿主 status 响应
      const [checking, setChecking] = useState(true)
      const [cookieText, setCookieText] = useState('')
      const [saving, setSaving] = useState(false)
      const [syncing, setSyncing] = useState(false)
      const [result, setResult] = useState(null)   // { added, dup, total }
      const [failure, setFailure] = useState(null) // { code, message, fallback }
      const [books, setBooks] = useState(() => {
        try { return typeof book?.listBooks === 'function' ? book.listBooks() : [] } catch { return [] }
      })
      const [targetBook, setTargetBook] = useState('default')
      const [manualOpen, setManualOpen] = useState(false)

      const refreshStatus = () => {
        setChecking(true)
        youdaoRequest('GET', '/status').then((payload) => {
          setChecking(false)
          if (payload?.ok === true) {
            setStatus(payload)
        // 失效时把红条留在界面上，但不清它 —— hasCookie 仍为 true（宿主口径）
            if (payload.valid !== true && payload.hasCookie === true) {
              setFailure({ code: 'E_YOUDAO_AUTH', message: 'Cookie 已失效，请重新复制' })
            } else {
              setFailure(null)
            }
          } else {
            setStatus({ hasCookie: false, valid: false, lastSyncAt: 0, lastCount: 0 })
            setFailure(null)
          }
        }).catch(() => { setChecking(false) })
      }

      useEffect(() => { refreshStatus() }, [])
      useEffect(() => {
        try { if (typeof book?.listBooks === 'function') setBooks(book.listBooks()) } catch { /* ignore */ }
      }, [book])

      const hasCookie = status?.hasCookie === true
      const mode = youdaoMode(status, checking)

      const onSave = () => {
        const value = cookieText.trim()
        if (value === '') { setFailure({ code: 'E_EMPTY_COOKIE', message: '先把复制的 Cookie 粘进来' }); return }
        setSaving(true)
        setFailure(null)
        youdaoRequest('POST', '/cookie', { cookie: value }).then((payload) => {
          setSaving(false)
          if (payload?.ok === true && payload.valid === true) {
        // 成功后立刻清空输入框 —— 明文不该在界面上多留一秒
            setCookieText('')
            setResult(null)
            refreshStatus()
            outerSay?.('Cookie 已保存并通过验证', 'ok')
          } else if (payload?.ok === true) {
            setFailure({ code: 'E_YOUDAO_AUTH', message: payload.message ?? 'Cookie 无效或已过期' })
          } else {
            setFailure({ code: payload?.error?.code ?? 'E_YOUDAO_FAILED', message: youdaoErrorText(payload?.error) })
          }
        }).catch(() => setSaving(false))
      }

      const onClear = () => {
        setSaving(true)
        youdaoRequest('DELETE', '/cookie').then(() => {
          setSaving(false)
          setCookieText('')
          setResult(null)
          setFailure(null)
          refreshStatus()
        }).catch(() => setSaving(false))
      }

      const onSync = () => {
        setSyncing(true)
        setFailure(null)
        setResult(null)
        youdaoRequest('POST', '/sync', { bookId: targetBook }, 180000).then((payload) => {
          if (payload?.ok !== true) {
            setSyncing(false)
            const error = payload?.error ?? { code: 'E_YOUDAO_FAILED', message: '抓取失败' }
            setFailure({ code: error.code, message: youdaoErrorText(error), fallback: error.fallback })
            if (error.code === 'E_YOUDAO_AUTH' || error.code === 'E_YOUDAO_ENDPOINT') refreshStatus()
            return
          }
          const heads = Array.isArray(payload.words) ? payload.words : []
          const glosses = payload.glosses && typeof payload.glosses === 'object' ? payload.glosses : null
      // 宿主不知道浏览器库里已有什么，added/dup 恒为 0 —— 真实新增数必须这算。
          const before = (() => { try { return book?.size?.() ?? 0 } catch { return 0 } })()
          const runImport = async () => {
            try {
              if (typeof book?.importMany !== 'function') return 0
              await book.importMany(heads, 'youdao', { bookId: targetBook, ...(glosses ? { glosses } : {}) })
              return heads.length
            } catch { return 0 }
          }
          runImport().then(() => {
            const after = (() => { try { return book?.size?.() ?? 0 } catch { return 0 } })()
            const summary = youdaoSyncResult({ before, after, fetched: heads.length })
            setSyncing(false)
            setResult({ ...summary, endpoint: payload.endpoint, pages: payload.pages })
            if (heads.length === 0) {
              setFailure({ code: 'E_YOUDAO_EMPTY', message: summary.text })
            }
            refreshStatus()
          })
        }).catch(() => setSyncing(false))
      }

  // ── 状态卡 ──
      const statusCard = (() => {
        if (mode === 'checking') {
          return h('div', { key: 'st', className: 'hds-status-card' }, [
            h('div', { key: 'm', className: 'hds-status-main' }, [
              h('div', { key: 't', className: 'hds-status-title' }, '正在检查登录状态…'),
            ]),
          ])
        }
        if (mode === 'ready') {
          return h('div', { key: 'st', className: 'hds-status-card', 'data-tone': 'ok' }, [
            h('div', { key: 'm', className: 'hds-status-main' }, [
              h('div', { key: 't', className: 'hds-status-title' },
                status?.nickname ? `${status.nickname} · 已连接` : '已连接有道'),
              h('div', { key: 'd', className: 'hds-status-meta' },
                `${syncedAtLabel(status?.lastSyncAt)}${status?.lastCount > 0 ? ` · 上次抓到 ${status.lastCount} 个词` : ''}`),
            ]),
            h(Badge, { key: 'b', text: '有效', tone: 'success' }),
          ])
        }
        if (mode === 'stale') {
          return h('div', { key: 'st', className: 'hds-status-card', 'data-tone': 'warn' }, [
            h('div', { key: 'm', className: 'hds-status-main' }, [
              h('div', { key: 't', className: 'hds-status-title' }, 'Cookie 已失效'),
              h('div', { key: 'd', className: 'hds-status-meta' },
                '有道那边不认这段登录态了。重新走一遍下面四步，把新的 Cookie 粘进来。'),
            ]),
            h(Badge, { key: 'b', text: '失效', tone: 'danger' }),
          ])
        }
        return h('div', { key: 'st', className: 'hds-status-card' }, [
          h('div', { key: 'm', className: 'hds-status-main' }, [
            h('div', { key: 't', className: 'hds-status-title' }, '还没连接有道'),
            h('div', { key: 'd', className: 'hds-status-meta' },
              '按下面四步复制一次 Cookie 就行，不用在这里输账号密码。'),
          ]),
          h(Badge, { key: 'b', text: '未配置', tone: 'neutral' }),
        ])
      })()

  // ── 四步引导（未配置 / 失效时都显示，失效的人也需要照着重做） ──
      const steps = (mode === 'empty' || mode === 'stale') ? h('ol', {
        key: 'steps', className: 'hds-steps',
      }, YOUDAO_STEPS.map((step, index) => h('li', { key: String(index), className: 'hds-step' }, [
        h('span', { key: 'n', className: 'hds-step-no', 'aria-hidden': 'true' }, String(index + 1)),
        h('div', { key: 'b', className: 'hds-step-body' }, [
          h('b', { key: 't' }, step.title),
          h('span', { key: 's' }, `　${step.detail}`),
        ]),
      ]))) : null

      const cookieField = (mode === 'empty' || mode === 'stale') ? h(Field, {
        key: 'cookie',
        label: 'Cookie',
        hint: '粘贴后输入框内容会被隐藏。保存成功后自动清空，不会留在这台机器以外的地方。',
      }, [
        h('div', { key: 'row', style: { display: 'flex', gap: GAP.sm, alignItems: 'center', flexWrap: 'wrap' } }, [
          h(Input, {
            key: 'i',
            type: 'password',
            value: cookieText,
            placeholder: '把 Request Headers 里 Cookie 那一整行全部粘进来',
            onChange: (next) => setCookieText(next),
            style: { flex: 1, minWidth: 240 },
          }),
          h(Button, {
            key: 'save',
            label: '保存并验证',
            variant: 'primary',
            busy: saving,
            onClick: onSave,
          }),
          hasCookie
            ? h(Button, { key: 'clear', label: '清除', variant: 'danger', size: 'sm', onClick: onClear })
            : null,
        ]),
      ]) : h('div', {
        key: 'connected',
        style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' },
      }, [
        h(Button, { key: 'clear2', label: '清除 Cookie', variant: 'danger', size: 'sm', onClick: onClear }),
      ])

  // ── 抓取区 ──
      const syncBlock = (mode === 'ready') ? h('div', {
        key: 'sync',
        style: { display: 'flex', flexDirection: 'column', gap: GAP.sm },
      }, [
        h('div', { key: 'row', style: { display: 'flex', gap: GAP.sm, alignItems: 'flex-end', flexWrap: 'wrap' } }, [
          h(Field, {
            key: 'book',
            label: '抓到哪里',
            hint: '抓回来的词会进这个生词本，重复的词不会重复建档。',
          }, h(Select, {
            value: targetBook,
            options: (books.length > 0 ? books : [{ id: 'default', name: '默认生词本' }])
              .map((item) => ({ value: item.id, label: item.name })),
            onChange: (value) => setTargetBook(value),
          })),
          h(Button, {
            key: 'go',
            label: syncing ? '正在抓取…' : '一键抓取收藏夹',
            variant: 'primary',
            busy: syncing,
            onClick: onSync,
          }),
        ]),
        syncing
          ? h('div', { key: 'bar', className: 'hds-progress', role: 'progressbar', 'aria-label': '正在抓取有道收藏夹' })
          : null,
        syncing
          ? h('div', { key: 'tip', style: { fontSize: FS.small, lineHeight: 1.85, color: C.textDim } },
            '每页间隔至少 0.4 秒，词多的时候要等一会儿。请别关这个页面。')
          : null,
        result !== null
          ? h(Note, {
            key: 'done',
            tone: 'ok',
            text: result.text,
            action: onGoBook
              ? h(Button, { key: 'jump', label: '去生词本查看', size: 'sm', onClick: onGoBook })
              : null,
          })
          : null,
      ]) : null

  // ── 降级引导（宿主报接口改版） ──
      const showFallback = failure?.code === 'E_YOUDAO_ENDPOINT' || failure?.fallback === 'manual' || manualOpen
      const fallbackBlock = showFallback ? h('div', {
        key: 'fallback',
        style: { display: 'flex', flexDirection: 'column', gap: GAP.sm },
      }, [
        h(Note, {
          key: 'n',
          tone: 'err',
          text: '有道生词本接口改版了，自动抓取暂时用不了。可以按下面三步手动导进来，词一个都不会少。',
        }),
        h('ol', { key: 'steps', className: 'hds-steps' }, FALLBACK_STEP_NODES(h)),
        onGoBook
          ? h('div', { key: 'act', style: { display: 'flex', gap: GAP.sm } }, [
            h(Button, {
              key: 'go',
              label: '打开导入页',
              variant: 'primary',
              size: 'sm',
              onClick: onGoBook,
            }),
          ])
          : null,
      ]) : null

      const failureBlock = (failure !== null && failure.code !== 'E_YOUDAO_ENDPOINT')
        ? h(Note, { key: 'fail', tone: 'err', text: failure.message })
        : null

      return h(Card, {
        key: 'youdao',
        title: '有道同步',
        hint: '把有道词典收藏夹里的词一次性抓进生词本。只需复制一次 Cookie，不在这里输账号密码。',
      }, [
        statusCard,
        (mode === 'stale') ? h(Note, {
          key: 'stale',
          tone: 'err',
          text: 'Cookie 失效了。照着下面四步重新复制一次，旧的会被覆盖。',
        }) : null,
        failureBlock,
        steps,
        cookieField,
        syncBlock,
        fallbackBlock,
        !showFallback
          ? h('div', { key: 'manual', style: { display: 'flex', alignItems: 'center', gap: GAP.sm } }, [
            h('span', { key: 't', style: { fontSize: FS.small, color: C.textFaint } }, '自动抓取不顺利？'),
            h(Button, {
              key: 'b', label: '看手动导出方法', variant: 'ghost', size: 'sm',
              onClick: () => setManualOpen(true),
            }),
          ])
          : null,
      ])
    }

/** 降级引导的三步节点（抽出来是因为它嵌在 ol 里，别把组件体撑长）。 */
    function FALLBACK_STEP_NODES(h) {
      return YOUDAO_FALLBACK_STEPS.map((text, index) => h('li', { key: String(index), className: 'hds-step' }, [
        h('span', { key: 'n', className: 'hds-step-no', 'aria-hidden': 'true' }, String(index + 1)),
        h('div', { key: 'b', className: 'hds-step-body' }, text),
      ]))
    }

/* ═══════════════════════════════════════════════════════════════════════
   localStorage 读写（沿用 v1 的键名）
   ═══════════════════════════════════════════════════════════════════════ */

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

/** 读中文占比上限，默认 0.1（10%）。 */
    function readMaxHanRatioRaw(storage) {
      try {
        const raw = storage?.getItem?.('dsh-hover-dict:maxHanRatio')
        if (raw !== null && raw !== undefined && raw !== '') {
          const value = Number(raw)
          if (Number.isFinite(value) && value >= 0 && value <= 1) return value
        }
      } catch { /* ignore */ }
      return 0.1
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
      return { SettingsPanel, bookTab, ReviewTab, ImportTab, appearanceTab, syncedAtLabel, youdaoMode, youdaoSyncResult, YoudaoTab, readPacks, writePacks, readMaxHanRatioRaw, readTranslator, writeTranslator, translatorChain, ensureSettingsStyle }
    })()

    // ═══ card.js ═══
    var __mod_card = (function () {
      var { attachDrag } = __mod_drag
      var { PronounceButton } = __mod_review
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
    // 发音按钮：紧挨词头（设计 §E1）。刻意放在拖动把手**外面** —— 把手
    // 会 preventDefault + 抢指针捕获，放里面按钮就收不到点击（星标踩过这个坑）。
    // 不支持 speechSynthesis 时 PronounceButton 自己返回 null，不留死按钮。
        h(PronounceButton, { key: 'speak', word: props.word ?? '' }),
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
      } else if (props.gloss && String(props.gloss).trim() !== '') {
    // 词库查不到，但有释义快照（导入/有道抓回来的）→ 直接展示快照
        children.push(h('div', { key: 'gloss', className: 'hd-zh', style: { marginTop: 2 } }, String(props.gloss).trim()))
      } else {
    // 词库未收录：老实说查不到，不假装给释义（CETgo 口径，设计 §E2）。
    // 「仍要收藏」复用现成的 onToggleStar —— 收藏后 gloss 留空，
    // 管理台会显示未收录徽章（t2 已做）。已在生词本时这句改成状态提示。
        children.push(h(MissNotice, {
          key: 'miss',
          word: props.word ?? '',
          inBook,
          onToggleStar: props.onToggleStar,
        }))
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

/**
 * 词库未收录时的说明块（设计 §E2）。
 *
 * 口径是「不假装给释义」：词库没有就说没有，别猜、别拿拼音凑。
 * 但用户**主动**点开了一个生僻词，往往正因为他想记住它 ——
 * 所以这里必须留一个「仍要收藏」的出口，而不是一句冷冰冰的查不到。
 *
 * @param {object} props
 * @param {string} props.word
 * @param {boolean} props.inBook
 * @param {() => void} [props.onToggleStar]
 * @returns {import('react').ReactElement}
 */
    function MissNotice(props) {
      const inBook = props.inBook === true
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px dashed var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
          background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.08))',
        },
      }, [
        h('div', {
          key: 'text',
          style: {
            fontSize: '.94em',
            lineHeight: 1.8,
            color: 'var(--dsw-alias-label-secondary, #666)',
          },
        }, '词库未收录，暂无释义'),
        h('div', {
          key: 'row',
          style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        }, [
          inBook
            ? h('span', {
              key: 'state',
              style: { fontSize: '.88em', color: 'var(--dsw-alias-state-warn-primary, #f0a441)' },
            }, '已在生词本 · 未收录')
            : h('button', {
              key: 'save',
              type: 'button',
              title: `把 ${props.word || '这个词'} 加入生词本（释义留空）`,
              onPointerDown: (event) => event.stopPropagation(),
              onMouseDown: (event) => { event.preventDefault(); event.stopPropagation() },
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                props.onToggleStar?.()
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
                fontSize: '.92em',
                cursor: 'pointer',
              },
            }, '仍要收藏'),
          h('span', {
            key: 'hint',
            style: { fontSize: '.86em', color: 'var(--dsw-alias-label-secondary, #999)' },
          }, '收录后可以在生词本里自己写备注'),
        ]),
      ])
    }

      return { pickUpgradeTarget, splitExample, CardRoot, SenseGroups, Examples, MissNotice }
    })()

    // ═══ app.js ═══
    var __mod_app = (function () {
      var { loadUx, STORAGE_KEY, tagLabel } = __mod_config
      var { briefOf, buildIndex, describeEntry, loadDictionary, lookup } = __mod_dict
      var { fetchAsset, humanizeError } = __mod_net
      var { computeOverlayRect } = __mod_position
      var { ensureStyle, MarkerLayerHost, PopoverBody, PhraseBody, UI_ATTR } = __mod_overlay
      var { buildMarks, buildHighlightRanges, applyHighlights, clearHighlights, highlightCss, supportsHighlight, bindRecalcEvents, createRecalcScheduler, expandWordSet, MARK_MAX } = __mod_marker
      var { CardRoot } = __mod_card
      var { caretAtPoint, DEFAULT_MAX_HAN_RATIO, rangeRects, readSelection, unionOf } = __mod_selection
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

      return { createHoverMachine, apply, inject, OverlayHost }
    })()

    // ── 宿主加载契约只读这两个名字 ──
    exports.apply = __mod_app.apply
    exports.inject = __mod_app.inject

    // ── 纯函数透出给测试（不影响宿主） ──
    exports.AGAIN_DELAY_MS = __mod_srs.AGAIN_DELAY_MS
    exports.AHEAD_COUNT = __mod_review.AHEAD_COUNT
    exports.API_PREFIX = __mod_net.API_PREFIX
    exports.C = __mod_ui.C
    exports.CardRoot = __mod_card.CardRoot
    exports.DAY_MS = __mod_srs.DAY_MS
    exports.DEFAULT_APPEARANCE = __mod_config.DEFAULT_APPEARANCE
    exports.DEFAULT_MARK_COLOR = __mod_config.DEFAULT_MARK_COLOR
    exports.DEFAULT_MAX_HAN_RATIO = __mod_selection.DEFAULT_MAX_HAN_RATIO
    exports.DEFAULT_TIMING = __mod_config.DEFAULT_TIMING
    exports.DEFAULT_UX = __mod_config.DEFAULT_UX
    exports.DIRECTIONS = __mod_review.DIRECTIONS
    exports.DRAG_THRESHOLD_PX = __mod_drag.DRAG_THRESHOLD_PX
    exports.EASE = __mod_ui.EASE
    exports.EASE_MAX = __mod_srs.EASE_MAX
    exports.EASE_MIN = __mod_srs.EASE_MIN
    exports.Examples = __mod_card.Examples
    exports.FS = __mod_ui.FS
    exports.GAP = __mod_ui.GAP
    exports.GRADE_BUTTONS = __mod_review.GRADE_BUTTONS
    exports.HIGHLIGHT_KNOWN = __mod_marker.HIGHLIGHT_KNOWN
    exports.HIGHLIGHT_WORDS = __mod_marker.HIGHLIGHT_WORDS
    exports.HIT_BLOCKERS = __mod_hit.HIT_BLOCKERS
    exports.IMPORT_FORMATS = __mod_importer.IMPORT_FORMATS
    exports.INTERVAL_MAX = __mod_srs.INTERVAL_MAX
    exports.ImportTab = __mod_settings.ImportTab
    exports.KNOWN_INTERVAL = __mod_srs.KNOWN_INTERVAL
    exports.MARK_COLOR_PRESETS = __mod_config.MARK_COLOR_PRESETS
    exports.MARK_MAX = __mod_marker.MARK_MAX
    exports.MARK_STYLES = __mod_config.MARK_STYLES
    exports.MAX_SELECTION_CHARS = __mod_selection.MAX_SELECTION_CHARS
    exports.MAX_WORD_LEN = __mod_word.MAX_WORD_LEN
    exports.MUTATION_DEBOUNCE_MS = __mod_marker.MUTATION_DEBOUNCE_MS
    exports.MarkerLayer = __mod_marker.MarkerLayer
    exports.MarkerLayerHost = __mod_overlay.MarkerLayerHost
    exports.MissNotice = __mod_card.MissNotice
    exports.OverlayHost = __mod_app.OverlayHost
    exports.PhraseBody = __mod_overlay.PhraseBody
    exports.PopoverBody = __mod_overlay.PopoverBody
    exports.PronounceButton = __mod_review.PronounceButton
    exports.RADIUS = __mod_ui.RADIUS
    exports.REVIEW_FILTERS = __mod_review.REVIEW_FILTERS
    exports.ReviewCardBack = __mod_review.ReviewCardBack
    exports.ReviewTab = __mod_settings.ReviewTab
    exports.SCROLL_THROTTLE_MS = __mod_marker.SCROLL_THROTTLE_MS
    exports.SELECTORS = __mod_hit.SELECTORS
    exports.SRS_GRADES = __mod_srs.SRS_GRADES
    exports.STORAGE_KEY = __mod_config.STORAGE_KEY
    exports.SenseGroups = __mod_card.SenseGroups
    exports.SettingsPanel = __mod_settings.SettingsPanel
    exports.StatusNote = __mod_overlay.StatusNote
    exports.THEME_ERROR_COLOR = __mod_config.THEME_ERROR_COLOR
    exports.THINK_SELECTOR = __mod_marker.THINK_SELECTOR
    exports.UI_ATTR = __mod_overlay.UI_ATTR
    exports.VIEWPORT_PAD = __mod_drag.VIEWPORT_PAD
    exports.VIEWPORT_PAD_PX = __mod_marker.VIEWPORT_PAD_PX
    exports.WORD_PATTERN = __mod_marker.WORD_PATTERN
    exports.WORD_STATES = __mod_srs.WORD_STATES
    exports.YoudaoTab = __mod_settings.YoudaoTab
    exports.actionForKey = __mod_review.actionForKey
    exports.aheadQueue = __mod_review.aheadQueue
    exports.anchorOf = __mod_anchor.anchorOf
    exports.appearanceTab = __mod_settings.appearanceTab
    exports.applyHighlights = __mod_marker.applyHighlights
    exports.attachDrag = __mod_drag.attachDrag
    exports.bindRecalcEvents = __mod_marker.bindRecalcEvents
    exports.blockerOf = __mod_marker.blockerOf
    exports.bookTab = __mod_settings.bookTab
    exports.booksOfEntry = __mod_review.booksOfEntry
    exports.briefOf = __mod_dict.briefOf
    exports.briefTextFor = __mod_review.briefTextFor
    exports.buildHighlightRanges = __mod_marker.buildHighlightRanges
    exports.buildIndex = __mod_dict.buildIndex
    exports.buildMarks = __mod_marker.buildMarks
    exports.canSpeak = __mod_review.canSpeak
    exports.capMarks = __mod_marker.capMarks
    exports.cardBackFor = __mod_review.cardBackFor
    exports.caretAt = __mod_hit.caretAt
    exports.caretAtPoint = __mod_selection.caretAtPoint
    exports.clampAppearance = __mod_config.clampAppearance
    exports.clampTiming = __mod_config.clampTiming
    exports.clampToViewport = __mod_drag.clampToViewport
    exports.classifySelection = __mod_selection.classifySelection
    exports.clearHighlights = __mod_marker.clearHighlights
    exports.collectTextNodes = __mod_marker.collectTextNodes
    exports.colorMix = __mod_marker.colorMix
    exports.computeCardPlacement = __mod_position.computeCardPlacement
    exports.computeOverlayRect = __mod_position.computeOverlayRect
    exports.computePopoverPlacement = __mod_position.computePopoverPlacement
    exports.containsPoint = __mod_position.containsPoint
    exports.createHoverMachine = __mod_app.createHoverMachine
    exports.createRecalcScheduler = __mod_marker.createRecalcScheduler
    exports.createWordbook = __mod_wordbook.createWordbook
    exports.cullToViewport = __mod_marker.cullToViewport
    exports.defaultSrs = __mod_srs.defaultSrs
    exports.describeEntry = __mod_dict.describeEntry
    exports.detectImportFormat = __mod_importer.detectImportFormat
    exports.dragPosition = __mod_drag.dragPosition
    exports.dueLabel = __mod_review.dueLabel
    exports.ensureSettingsStyle = __mod_settings.ensureSettingsStyle
    exports.ensureStyle = __mod_overlay.ensureStyle
    exports.expandWordSet = __mod_marker.expandWordSet
    exports.familyOf = __mod_family.familyOf
    exports.fetchAsset = __mod_net.fetchAsset
    exports.filterQueue = __mod_review.filterQueue
    exports.glossText = __mod_importer.glossText
    exports.hanRatio = __mod_selection.hanRatio
    exports.highlightCss = __mod_marker.highlightCss
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
    exports.markColorToCss = __mod_marker.markColorToCss
    exports.markCss = __mod_marker.markCss
    exports.matchWordsInText = __mod_marker.matchWordsInText
    exports.measureHits = __mod_marker.measureHits
    exports.nextSrs = __mod_srs.nextSrs
    exports.nodeIdentity = __mod_anchor.nodeIdentity
    exports.normalizeKey = __mod_word.normalizeKey
    exports.normalizeMarkColor = __mod_config.normalizeMarkColor
    exports.normalizeSrs = __mod_srs.normalizeSrs
    exports.normalizeViewport = __mod_marker.normalizeViewport
    exports.parseForms = __mod_dict.parseForms
    exports.parseImportDetailed = __mod_importer.parseImportDetailed
    exports.parseImportText = __mod_wordbook.parseImportText
    exports.pickUpgradeTarget = __mod_card.pickUpgradeTarget
    exports.posLabel = __mod_dict.posLabel
    exports.queueForDirection = __mod_review.queueForDirection
    exports.rangeRects = __mod_selection.rangeRects
    exports.readMaxHanRatioRaw = __mod_settings.readMaxHanRatioRaw
    exports.readPacks = __mod_settings.readPacks
    exports.readSelection = __mod_selection.readSelection
    exports.readTranslator = __mod_settings.readTranslator
    exports.rectsOf = __mod_selection.rectsOf
    exports.resolveRoots = __mod_marker.resolveRoots
    exports.roundSummary = __mod_review.roundSummary
    exports.sameWord = __mod_anchor.sameWord
    exports.saveUx = __mod_config.saveUx
    exports.scanTextNodes = __mod_marker.scanTextNodes
    exports.shouldHandleKey = __mod_review.shouldHandleKey
    exports.speakWord = __mod_review.speakWord
    exports.splitExample = __mod_card.splitExample
    exports.stateAfterGrade = __mod_srs.stateAfterGrade
    exports.stemCandidates = __mod_word.stemCandidates
    exports.stemVariants = __mod_family.stemVariants
    exports.styleOfMark = __mod_marker.styleOfMark
    exports.summarizeImport = __mod_importer.summarizeImport
    exports.supportsHighlight = __mod_marker.supportsHighlight
    exports.sx = __mod_ui.sx
    exports.syncedAtLabel = __mod_settings.syncedAtLabel
    exports.tagLabel = __mod_config.tagLabel
    exports.textOfNode = __mod_marker.textOfNode
    exports.translatorChain = __mod_settings.translatorChain
    exports.unionOf = __mod_selection.unionOf
    exports.unionRect = __mod_position.unionRect
    exports.unionRectsOf = __mod_marker.unionRectsOf
    exports.viewportOf = __mod_marker.viewportOf
    exports.wordAt = __mod_word.wordAt
    exports.writePacks = __mod_settings.writePacks
    exports.writeTranslator = __mod_settings.writeTranslator
    exports.youdaoMode = __mod_settings.youdaoMode
    exports.youdaoSyncResult = __mod_settings.youdaoSyncResult

    return module.exports
  },
})
