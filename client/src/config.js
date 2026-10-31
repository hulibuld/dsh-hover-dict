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
 */

/** @type {UxAppearance} */
export const DEFAULT_APPEARANCE = {
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
