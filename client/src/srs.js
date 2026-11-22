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
export const DAY_MS = 86400000

/** ease 的下限与上限。 */
export const EASE_MIN = 1.3
export const EASE_MAX = 3.0

/** 单次间隔的天数上限。 */
export const INTERVAL_MAX = 365

/** 「不认识」之后多少毫秒重来。 */
export const AGAIN_DELAY_MS = 10 * 60000

/** 间隔跨过这个天数才算「已掌握」。 */
export const KNOWN_INTERVAL = 21

/** 合法的评分。 */
export const SRS_GRADES = ['again', 'hard', 'good']

/** 合法的词条状态：new 未学、unknown 不认识、fuzzy 记错、known 已掌握。 */
export const WORD_STATES = ['new', 'unknown', 'fuzzy', 'known']

/**
 * 一份全新的 srs 记录。
 *
 * @returns {{ due: number, interval: number, ease: number, reps: number, lapses: number, lastReviewAt: number }}
 */
export function defaultSrs() {
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
export function normalizeSrs(raw) {
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
export function nextSrs(srs, grade, now = Date.now()) {
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
export function stateAfterGrade(prevState, grade, newInterval) {
  const prev = WORD_STATES.includes(prevState) ? prevState : 'new'
  if (grade === 'again') return 'unknown'
  if (grade === 'hard') return 'fuzzy'
  const interval = Number.isFinite(newInterval) ? newInterval : 0
  if (interval >= KNOWN_INTERVAL) return 'known'
  return prev === 'new' ? 'fuzzy' : prev
}