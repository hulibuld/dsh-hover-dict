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
export const DEFAULT_TIMING = {
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
export const THEME_ERROR_COLOR = 'theme-error'

/**
 * 默认高亮色（红）。
 *
 * v2 起默认「跟随宿主错误红」而不是固定 hex —— 用户原话是「和宿主报错红字一样的红」。
 * 用户仍可改成固定 hex（六预设或自定义）。
 */
export const DEFAULT_MARK_COLOR = THEME_ERROR_COLOR

/**
 * 合法的着色样式。
 *
 * @deprecated 用户裁定「只要改字的颜色即可」——不着色块、不下划线，
 * 所以这三档（underline/background/text）已废弃，渲染层不再使用。
 * 保留导出只为不让旧存档/旧调用点直接炸；正式清理留给后续版本。
 */
export const MARK_STYLES = ['underline', 'background', 'text']

/** 设置面板给的六个预设色块（红/橙/黄/绿/蓝/紫），第一项是固定红。 */
export const MARK_COLOR_PRESETS = ['#e5484d', '#f0a441', '#d4b106', '#2f9e44', '#4d6bfe', '#8b5cf6']

/** 默认的着色配置。 */
const DEFAULT_MARK = {
  markWords: true,
  markColor: DEFAULT_MARK_COLOR,
  markKnown: false,
  markStyle: 'underline',
}

/** @type {UxAppearance} */
export const DEFAULT_APPEARANCE = {
  maxSensesInPopover: 2,
  cardMaxWidthPx: 420,
  cardMaxHeightRatio: 0.7,
  offsetPx: 6,
  viewportMarginPx: 8,
  showTags: true,
  tagOrder: ['cet4', 'cet6', 'ky', 'ielts'],
  pageSize: 20,
  ...DEFAULT_MARK,
}

/**
 * 生词本词表每页行数的三档。
 *
 * 这是**枚举**不是区间：用户要的就是 10/15/20 三选一，
 * 所以不能像其它数值项那样用 min/max 夹取（那会把 50 夹成 20，
 * 看起来结果对了，但语义是「超出上限」而不是「不在三档里，回落默认」）。
 *
 * @type {ReadonlyArray<number>}
 */
export const PAGE_SIZE_OPTIONS = Object.freeze([10, 15, 20])

/**
 * 合并后的默认值。app.js 用它对 Config 与 localStorage 做兜底。
 * @type {{ timing: UxTiming, appearance: UxAppearance }}
 */
export const DEFAULT_UX = {
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
export const STORAGE_KEY = 'dsh-hover-dict:ux'

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
export function loadUx(storage) {
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
export function saveUx(storage, patch) {
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
export function clampTiming(input) {
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
export function normalizeMarkColor(value) {
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
export function clampAppearance(input) {
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
    // 三档枚举：不在 [10,15,20] 里的一律回落 20（旧存档没有这个键也走这条）
    pageSize: PAGE_SIZE_OPTIONS.includes(source.pageSize) ? source.pageSize : DEFAULT_APPEARANCE.pageSize,
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
export function tagLabel(tag, locale) {
  if (typeof tag !== 'string' || tag === '') return ''
  const table = locale === 'en' ? TAG_LABELS_EN : TAG_LABELS_ZH
  return table[tag] ?? tag
}
