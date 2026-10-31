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

import { normalizeKey } from './word.js'

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
export function createWordbook(options) {
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
