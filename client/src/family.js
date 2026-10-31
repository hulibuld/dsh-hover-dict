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
export function inflectionsOf(entry) {
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
export function stemVariants(word) {
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
export function familyOf(dict, head) {
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
