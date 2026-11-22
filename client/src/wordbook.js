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

import { normalizeKey } from './word.js'
import {
  defaultSrs, normalizeSrs, nextSrs, stateAfterGrade, WORD_STATES, DAY_MS,
} from './srs.js'

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
export function createWordbook(options) {
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
export function parseImportText(text) {
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