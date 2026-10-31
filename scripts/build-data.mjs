#!/usr/bin/env node
/**
 * dsh-hover-dict 数据包构建脚本
 *
 * 输入 (默认 /tmp/dictwork):
 *   ecdict.csv                 ECDICT 词典库 (MIT)，770,611 行 13 列
 *   cmn-eng_links.tsv.bz2      Tatoeba 中→英句对索引：<cmn_id>\t<eng_id>
 *   cmn_detailed.tsv.bz2       <id>\tcmn\t<中文句子>\t作者\t日期\t添加时间
 *   eng_detailed.tsv.bz2       <id>\teng\t<英文句子>\t作者\t日期\t添加时间
 *
 * 输出 (默认 ./data):
 *   dict.dat     JSON 对象，词形 -> 词条数据（字段见文件末尾 SCHEMA）
 *   forms.idx    JSON 对象，查询键 -> 原形
 *   meta.json    构建元信息
 *
 * 零第三方依赖。唯一外部命令是系统 bunzip2 —— node:zlib 不支持 bzip2。
 * Tatoeba 的 bz2 可能处于"未下完"状态，`bunzip2 -t` 会报 EOF。
 * bzip2 是分块压缩，未下完的文件里已完成的块仍能完整解出，
 * 所以这里只把 bunzip2 的非零退出码当警告，照常用已解出的数据。
 *
 * 用法：
 *   node scripts/build-data.mjs [--src DIR] [--out DIR] [--max-examples N]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// ---------------------------------------------------------------- 常量

// 只保留这八个考纲标签，其余丢弃
const KEEP_TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'];
const KEEP_TAG_SET = new Set(KEEP_TAGS);

// ECDICT 行首词性前缀 -> 规范词性。a. = adj.，ad. = adv.，vt./vi. 归到 v.
const POS_MAP = new Map([
  ['n.', 'n.'], ['v.', 'v.'], ['vt.', 'v.'], ['vi.', 'v.'],
  ['a.', 'adj.'], ['adj.', 'adj.'],
  ['ad.', 'adv.'], ['adv.', 'adv.'],
  ['prep.', 'prep.'], ['conj.', 'conj.'], ['pron.', 'pron.'],
  ['num.', 'num.'], ['art.', 'art.'],
  ['int.', 'int.'], ['interj.', 'int.'],
  ['aux.', 'aux.'], ['pl.', 'n.'], ['un.', 'n.'],
]);

// exchange 里可以当"词形"用的键。
// 必须排除 `1:` —— 它是变位类型码（如 1:p），不是单词。
// `0:` 单独处理：它指回原形，只有当本条本身不是原形时才有意义。
const FORM_KEYS = ['p', 'd', 'i', '3', 's', 'r', 't'];
const FORM_LABEL_TEXT = {
  p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
  s: '复数', r: '比较级', t: '最高级',
};
/** 中文标签 → ECDICT 短键的反查表。编码时把标签换回短键，渲染层再换回来。 */
const FORM_KEY_BY_LABEL = new Map(Object.entries(FORM_LABEL_TEXT).map(([k, v]) => [v, k]));

// translation / definition 的分隔符是【字面量】反斜杠+n，不是真换行
// （实测全表 770,611 行中含真换行/CR 的字段数为 0）。
const LINE_SPLIT = /\\r\\n|\\n/;

const DOMAIN_TAG = /\[[^\]]*\]/g;                 // [网络] [计] [经] [医] [化] ...
const POS_PREFIX = /^([A-Za-z]{1,7})\.\s*(.*)$/;
const SENSE_SPLIT = /[,，;；]\s*/;
const XREF_NOISE = /的(过去式|过去分词|现在分词|第三人称单数|复数|比较级|最高级|第三人称)/;

// 体积预算：新契约下只剩 dict.dat 一个数据文件（forms.idx 已取消）
const DICT_BUDGET = 3.3 * 1024 * 1024;
const GZ_BUDGET = 1.5 * 1024 * 1024;

// 例句挑选：优先 4–18 词
const EX_MIN_WORDS = 4;
const EX_MAX_WORDS = 18;
const EX_IDEAL_WORDS = 10;

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const out = { src: '/tmp/dictwork', out: 'data', maxExamples: 3 };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--src') out.src = v;
    else if (k === '--out') out.out = v;
    else if (k === '--max-examples') out.maxExamples = Number(v);
    else throw new Error(`未知参数: ${k}`);
  }
  return out;
}

// ---------------------------------------------------------------- CSV

/** RFC4180 解析，逐行回调。 */
function parseCsv(text, onRow) {
  let i = 0;
  const n = text.length;
  let row = [], field = '', inQuotes = false;
  const push = () => { row.push(field); field = ''; };

  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += text[i]; i++; continue;
    }
    if (c === 34) { inQuotes = true; i++; continue; }
    if (c === 44) { push(); i++; continue; }                 // ,
    if (c === 10) { push(); onRow(row); row = []; i++; continue; }
    if (c === 13) { i++; continue; }                          // CRLF
    field += text[i]; i++;
  }
  if (field.length || row.length) { push(); onRow(row); }
}

// ---------------------------------------------------------------- bz2

/**
 * 用系统 bunzip2 解压到内存。
 * 文件未下完时 bunzip2 退出码非 0，但已完成的块照常输出——
 * 只当警告，不中止（Tatoeba 的导出文件常常就是这个状态）。
 */
function bunzipToBuffer(file) {
  return new Promise((res, rej) => {
    if (!existsSync(file)) return rej(new Error(`缺少输入文件: ${file}`));
    const p = spawn('bunzip2', ['-c', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => { err += c.toString(); });
    p.on('error', rej);
    p.on('close', (code) => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return rej(new Error(`解压 ${file} 无输出: ${err.trim()}`));
      if (code !== 0) {
        console.warn(`  ! ${file} 未完整（bunzip2 exit ${code}），已用已解出的 ${buf.length.toLocaleString()} 字节`);
      }
      res(buf);
    });
  });
}

// ---------------------------------------------------------------- 文本

const clean = (s) =>
  s.replace(DOMAIN_TAG, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,;，；\s]+|[,;，；\s]+$/g, '');

/** 把 translation / definition 拆成 [词性前缀, 正文] */
function splitLines(field) {
  const out = [];
  if (!field) return out;
  for (const raw of field.split(LINE_SPLIT)) {
    const line = raw.trim();
    if (!line) continue;
    const m = POS_PREFIX.exec(line);
    if (m) out.push([m[1].toLowerCase() + '.', m[2]]);
    else out.push(['', line]);
  }
  return out;
}

const normPos = (pfx) => POS_MAP.get(pfx) ?? '';

/**
 * 把空词性前缀(p === '')的组并进有词性的组：
 * 只看中文义项是否有交集（领域标记已在 clean() 里去掉）。
 * 有交集 -> 义项并入目标组并去重；
 * 无交集但本身有中文 -> 自成一组；
 * 没有中文 -> 丢弃（只剩英文释义的空壳组不保留）。
 */
function mergePosGroups(groups) {
  const named = [], anonymous = [];
  for (const g of groups) (g.p ? named : anonymous).push(g);

  for (const g of anonymous) {
    const zhSet = new Set(g.zh);
    const target = named.find((n) => n.zh.some((x) => zhSet.has(x)));
    if (target) {
      for (const x of g.zh) if (!target.zh.includes(x)) target.zh.push(x);
      for (const x of g.en) if (!target.en.includes(x)) target.en.push(x);
    } else if (g.zh.length) {
      named.push(g);
    }
  }
  return named;
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = resolve(args.src);
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });

  const t0 = Date.now();
  const log = (...a) => console.log(...a);
  const MB = (n) => (n / 1048576).toFixed(2);

  // ---- 1. ECDICT：解析 + 筛选
  log('[1/5] 解析 ecdict.csv ...');
  const csvPath = join(src, 'ecdict.csv');
  if (!existsSync(csvPath)) throw new Error(`找不到 ${csvPath}`);
  const csvText = readFileSync(csvPath, 'utf8');

  const HEADER = ['word', 'phonetic', 'definition', 'translation', 'pos', 'collins',
    'oxford', 'tag', 'bnc', 'frq', 'exchange', 'detail', 'audio'];
  const IX = Object.fromEntries(HEADER.map((h, i) => [h, i]));

  const candidates = [];
  let totalRows = 0;
  const skipped = { unfiltered: 0, space: 0, lead: 0, empty: 0, tooLong: 0 };

  parseCsv(csvText, (cols) => {
    if (cols.length < 3) return;
    const word = cols[IX.word];
    if (word === 'word' && cols[IX.phonetic] === 'phonetic') return;   // 表头
    totalRows++;

    const tags = (cols[IX.tag] || '').replace(/,/g, ' ').split(/\s+/).filter((t) => KEEP_TAG_SET.has(t));
    const frq = Number.parseInt(cols[IX.frq] || '0', 10) || 0;
    const collins = Number.parseInt(cols[IX.collins] || '0', 10) || 0;
    const oxford = (cols[IX.oxford] || '').trim() === '1';
    const translation = cols[IX.translation] || '';

    // 筛选口径：tag 命中 || 0<frq<=20000 || collins>0 || oxford=1
    const keep = tags.length > 0 || (frq > 0 && frq <= 20000) || collins > 0 || oxford;
    if (!keep) { skipped.unfiltered++; return; }
    if (word.includes(' ')) { skipped.space++; return; }
    if (!/^[A-Za-z]/.test(word)) { skipped.lead++; return; }
    if (!translation.trim()) { skipped.empty++; return; }
    if (word.length > 32) { skipped.tooLong++; return; }

    candidates.push({
      word, lw: word.toLowerCase(), translation,
      definition: cols[IX.definition] || '',
      exchange: cols[IX.exchange] || '',
      tags, frq, collins, oxford,
    });
  });

  log(`      数据行 ${totalRows.toLocaleString()}；过筛选口径 ${candidates.length.toLocaleString()}`);
  log(`      跳过：未达口径 ${skipped.unfiltered.toLocaleString()}，含空格 ${skipped.space}，非字母开头 ${skipped.lead}，无释义 ${skipped.empty}，过长 ${skipped.tooLong}`);

  // ---- 2. 变位行并入原形
  const baseOf = (exchange) => {
    for (const part of (exchange || '').split('/')) {
      if (part.startsWith('0:')) {
        const b = part.slice(2).trim();
        if (b) return b;
      }
    }
    return '';
  };
  const keptLower = new Set(candidates.map((c) => c.lw));
  let mergedInflected = 0;
  const entries = [];
  for (const c of candidates) {
    const b = baseOf(c.exchange).toLowerCase();
    if (b && b !== c.lw && keptLower.has(b)) { mergedInflected++; continue; }
    entries.push(c);
  }
  log(`      变位行并入原形 ${mergedInflected.toLocaleString()}；词条 ${entries.length.toLocaleString()}`);

  // ---- 3. 组装词条
  log('[2/5] 组装词条 ...');
  const built = [];
  let posOk = 0;

  for (const c of entries) {
    const groups = new Map();
    const order = [];
    const ensure = (p) => {
      let g = groups.get(p);
      if (!g) { g = { p, zh: [], en: [] }; groups.set(p, g); order.push(p); }
      return g;
    };
    const seenZh = new Set();

    for (const [pfx, body] of splitLines(c.translation)) {
      if (XREF_NOISE.test(body)) continue;              // "run的过去式" 这类交叉引用
      const p = normPos(pfx);
      const text = clean(body);
      if (!text) continue;
      const g = ensure(p);
      for (const piece of text.split(SENSE_SPLIT)) {
        const s = clean(piece);
        if (!s) continue;
        const key = `${p}\u0000${s}`;
        if (seenZh.has(key)) continue;
        seenZh.add(key);
        g.zh.push(s);
      }
    }

    const seenEn = new Set();
    for (const [pfx, body] of splitLines(c.definition)) {
      const p = normPos(pfx);
      const text = clean(body);
      if (!text || seenEn.has(text)) continue;
      seenEn.add(text);
      ensure(p).en.push(text);
    }

    // 合并空 p 组，丢掉没有中文的空壳组，再按义项数排序（最重要的词性在前）
    const merged = mergePosGroups(order.map((p) => groups.get(p)))
      .filter((g) => g.zh.length)
      .sort((a, b) => b.zh.length - a.zh.length);
    if (!merged.length) continue;

    if (merged.some((g) => g.p)) posOk++;

    const forms = [];
    const formLabels = new Map();     // 词形 -> 中文变位标签
    const seenForm = new Set();
    for (const part of (c.exchange || '').split('/')) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      const k = part.slice(0, idx);
      if (!FORM_KEYS.includes(k)) continue;
      const v = part.slice(idx + 1).trim().toLowerCase();
      if (!v || v === c.lw || seenForm.has(v)) continue;
      seenForm.add(v);
      forms.push(v);
      formLabels.set(v, FORM_LABEL_TEXT[k] || '');
    }

    built.push({
      w: c.lw,
      tags: [...new Set(c.tags)].sort((a, b) => KEEP_TAGS.indexOf(a) - KEEP_TAGS.indexOf(b)),
      frq: c.frq,
      collins: c.collins || 0,
      oxford: !!c.oxford,
      forms,
      formLabels,
      pos: merged,
    });
  }
  log(`      可供打包的词条 ${built.length.toLocaleString()}`);

  // ---- 4. Tatoeba 配对
  log('[3/5] 读取 Tatoeba 句子并配对 ...');
  const linksBuf = await bunzipToBuffer(join(src, 'cmn-eng_links.tsv.bz2'));
  const pairs = [];
  const needCmn = new Set(), needEng = new Set();
  for (const ln of linksBuf.toString('utf8').split('\n')) {
    if (!ln) continue;
    const t = ln.split('\t');
    if (t.length < 2) continue;
    const cid = Number.parseInt(t[0], 10), eid = Number.parseInt(t[1], 10);
    if (!Number.isFinite(cid) || !Number.isFinite(eid)) continue;
    pairs.push([cid, eid]);
    needCmn.add(cid); needEng.add(eid);
  }
  log(`      links ${pairs.length.toLocaleString()} 行`);

  async function loadSentences(file, needed) {
    const text = (await bunzipToBuffer(join(src, file))).toString('utf8');
    const map = new Map();
    for (const ln of text.split('\n')) {
      if (!ln) continue;
      const t = ln.split('\t');
      if (t.length < 3) continue;
      const id = Number.parseInt(t[0], 10);
      if (!Number.isFinite(id) || !needed.has(id)) continue;
      const s = t[2].trim();
      if (s) map.set(id, s);
    }
    return map;
  }

  const engMap = await loadSentences('eng_detailed.tsv.bz2', needEng);
  const cmnMap = await loadSentences('cmn_detailed.tsv.bz2', needCmn);
  log(`      取到英文句 ${engMap.size.toLocaleString()} / 中文句 ${cmnMap.size.toLocaleString()}`);

  const usable = [];
  for (const [cid, eid] of pairs) {
    const e = engMap.get(eid), z = cmnMap.get(cid);
    if (e && z) usable.push([e, z]);
  }
  log(`      中英成对 ${usable.length.toLocaleString()} 对`);

  // 倒排：英文词 -> 句子下标
  const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  const inverted = new Map();
  const wordCounts = new Int16Array(usable.length);
  for (let i = 0; i < usable.length; i++) {
    const toks = usable[i][0].match(WORD_RE) || [];
    wordCounts[i] = toks.length;
    for (const tk of toks) {
      const low = tk.toLowerCase();
      let arr = inverted.get(low);
      if (!arr) { arr = []; inverted.set(low, arr); }
      arr.push(i);
    }
  }

  const scoreOf = (i) => {
    const n = wordCounts[i];
    const outOfRange = n < EX_MIN_WORDS || n > EX_MAX_WORDS ? 1 : 0;
    return outOfRange * 1000 + Math.abs(n - EX_IDEAL_WORDS);
  };


  // ---- 5. 挂例句
  log('[4/5] 给词条挂例句 ...');
  const maxEx = args.maxExamples;
  let candEx = 0;
  for (const e of built) {
    const cand = new Set();
    for (const key of [e.w, ...e.forms]) {
      const hit = inverted.get(key);
      if (hit) for (const i of hit) cand.add(i);
    }
    if (!cand.size) continue;
    const ranked = [...cand].sort((a, b) => scoreOf(a) - scoreOf(b) || a - b);
    const out = [], seen = new Set();
    for (const i of ranked) {
      if (out.length >= maxEx) break;
      const [en, zh] = usable[i];
      if (seen.has(en)) continue;
      seen.add(en);
      out.push([en, zh]);
    }
    if (out.length) { e.ex = out; candEx++; }
  }
  log(`      有候选例句的词条 ${candEx.toLocaleString()} / ${built.length.toLocaleString()} = ${(100 * candEx / built.length).toFixed(1)}%（这是语料上限）`);

  // ---- 6. 编码，把 dict.dat 压到 2.95 MB 以内
  log('[5/5] 编码并压到预算内 ...');

  /**
   * dict.dat 每条 7 个固定槽位：
   *   [0] senses  : [[pos, [中文义项...], [英英释义...]], ...]
   *   [1] tags    : "zk gk" | null
   *   [2] frq     : number，0 表示没有
   *   [3] collins : 0-5
   *   [4] oxford  : 0 | 1
   *   [5] forms   : [["ran","过去式"],...]   没有就省略
   *   [6] examples: [["英文","中文"],...]     没有就省略
   */
  /**
   * 变位用 ECDICT 原生的紧凑串，不用 `[["ran","过去式"],...]`。
   *
   * 实测：带中文标签的数组形式占 0.74 MB，比全部例句（0.31 MB）还多一倍，
   * 因为「过去式 / 现在分词 / 复数」这些标签在几千个动词上重复了几万次。
   * 换成 `p:ran/i:running/s:runs` 这种 KEY 串后体积降到约 0.2 MB，
   * 标签由渲染层按 KEY 查表补上（KEY 只有 7 种，查表成本可忽略）。
   *
   * @returns {string | null} 形如 `p:ran/i:running/3:runs`；无变位返回 null
   */
  function formsToCompact(e) {
    if (!e.forms.length) return null;
    const parts = [];
    // e.forms 是纯词形字符串数组；标签在 e.formLabels（词形 → 中文标签）里分开存。
    // 直接 `for (const [form, label] of e.forms)` 会解构成两个单字符，静默产出空串。
    for (const form of e.forms) {
      const label = e.formLabels.get(form);
      const key = label ? FORM_KEY_BY_LABEL.get(label) : undefined;
      if (!key) continue;
      parts.push(`${key}:${form}`);
    }
    return parts.length ? parts.join('/') : null;
  }

  function encodeBase(o) {
    const obj = {};
    for (const e of built) {
      const senses = [];
      for (const g of e.pos) {
        const zh = o.zhCap ? g.zh.slice(0, o.zhCap) : g.zh;
        if (!zh.length) continue;
        const row = [g.p, zh];
        if (o.enCap && e.frq > 0 && e.frq <= o.enFrqMax && g.en.length) {
          const en = g.en.slice(0, o.enCap).map((s) => (s.length > o.enTrunc ? s.slice(0, o.enTrunc - 1) + '…' : s));
          if (en.length) row.push(en);
        }
        senses.push(row);
      }
      if (!senses.length) continue;
      obj[e.w] = [senses, e.tags.length ? e.tags.join(' ') : null, e.frq || 0, e.collins || 0, e.oxford ? 1 : 0];
      const fw = formsToCompact(e);
      if (fw) obj[e.w].push(fw);
    }
    return obj;
  }

  const cutZ = (s, n) => (n && s.length > n ? s.slice(0, n - 1) + '…' : s);

  // 重要性排序：考纲标签多的优先，其次词频小的
  const ordered = [...built].sort((a, b) =>
    (b.tags.length - a.tags.length) || ((a.frq || 1e9) - (b.frq || 1e9)));

  /**
   * 吃满预算地挂例句。
   * 先保证每个有例句的词都挂上第 1 条（覆盖优先），再把剩下的预算
   * 按重要性给前面的词补第 2 条。
   */
  function attachExamples(obj, o) {
    let used = Buffer.byteLength(JSON.stringify(obj));
    let first = 0, second = 0;

    // 第一轮：每条 1 个例句
    //
    // 槽位下标必须**动态算**，不能写死 6。encodeBase 只在有变位时才 push forms，
    // 所以没变位的词 examples 落在 5、有变位的落在 6。写死 6 会让绝大多数词
    // 的例句被悄悄丢掉，而统计那边还按 6 数，结果就是「例句覆盖率 0%」这种
    // 看起来像语料没配对、实际是下标写错的故障。
    const got = [];
    for (const e of ordered) {
      if (!e.ex || !e.ex.length) continue;
      const ex = [[e.ex[0][0], cutZ(e.ex[0][1], o.exZhTrunc)]];
      const extra = Buffer.byteLength(JSON.stringify(ex)) + 1;
      if (used + extra > DICT_BUDGET) break;
      obj[e.w].push(ex);
      used += extra;
      first++; got.push(e);
    }

    // 第二轮：剩下的预算补给最重要的词，加第 2 个例句
    if (o.exN >= 2) {
      for (const e of got) {
        if (!e.ex || e.ex.length < 2) continue;
        const add = [e.ex[1][0], cutZ(e.ex[1][1], o.exZhTrunc)];
        const slot = obj[e.w].length - 1;   // 刚 push 进去的例句数组
        const cur = obj[e.w][slot];
        if (!Array.isArray(cur)) continue;
        const before = Buffer.byteLength(JSON.stringify(cur));
        const after = Buffer.byteLength(JSON.stringify([...cur, add]));
        if (used + (after - before) > DICT_BUDGET) break;
        obj[e.w][slot] = [...cur, add];
        used += after - before;
        second++;
      }
    }
    return { first, second };
  }

  const fitsSize = (obj) => {
    const dj = JSON.stringify(obj);
    return { dict: Buffer.byteLength(dj), gz: gzipSync(dj).length, dj };
  };

  // 让步顺序（按团队指定）：例句 2->1 优先，其次降英文释义的 frq 门槛，
  // 最后才降中文义项条数。中文义项、考纲标签、变位、词条数四项不动。
  const tiers = [
    { name: 'zh5 en1/70 f2000 ex2', zhCap: 5, enCap: 1, enTrunc: 70, enFrqMax: 2000, exN: 2, exZhTrunc: 60 },
    { name: 'zh5 en1/70 f2000 ex1', zhCap: 5, enCap: 1, enTrunc: 70, enFrqMax: 2000, exN: 1, exZhTrunc: 60 },
    { name: 'zh5 en1/70 f800  ex1', zhCap: 5, enCap: 1, enTrunc: 70, enFrqMax: 800,  exN: 1, exZhTrunc: 60 },
    { name: 'zh5 en1/70 f500  ex1', zhCap: 5, enCap: 1, enTrunc: 70, enFrqMax: 500,  exN: 1, exZhTrunc: 60 },
    { name: 'zh5 en off       ex1', zhCap: 5, enCap: 0, exN: 1, exZhTrunc: 60 },
    { name: 'zh4 en off       ex1', zhCap: 4, enCap: 0, exN: 1, exZhTrunc: 60 },
    { name: 'zh3 en off       ex1', zhCap: 3, enCap: 0, exN: 1, exZhTrunc: 60 },
  ];

  let chosen = null, finalObj = null, exStats = { first: 0, second: 0 };
  for (const t of tiers) {
    const obj = encodeBase(t);
    const stats = attachExamples(obj, t);
    const s = fitsSize(obj);
    const ok = s.dict <= DICT_BUDGET && s.gz <= GZ_BUDGET;
    log(`      ${t.name.padEnd(22)} 例句 ${String(stats.first).padStart(5)} (+${String(stats.second).padStart(4)} 第二条) ${(s.dict / 1048576).toFixed(2)} MB gz ${(s.gz / 1048576).toFixed(2)} MB ${ok ? '✓' : ''}`);
    if (ok) { chosen = t; finalObj = obj; exStats = stats; break; }
  }

  if (!chosen) {
    log('      全部阶梯超预算，退到只留中文义项 + 标签 + 变位（无例句无反义）');
    chosen = { name: 'zh only', zhCap: 0, enCap: 0, exN: 0, exZhTrunc: 60 };
    finalObj = encodeBase(chosen);
    exStats = { first: 0, second: 0 };
  }

  const dictJson = JSON.stringify(finalObj);
  writeFileSync(join(outDir, 'dict.dat'), dictJson);

  const dictBytes = Buffer.byteLength(dictJson);
  const dictGz = gzipSync(dictJson).length;
  const entriesN = Object.keys(finalObj).length;
  // 例句下标随「有没有变位」浮动，不要在编码后的对象上反推。
  // attachExamples 已经准确数过挂了几条，直接用它的结果。
  const withExN = exStats.first;

  const meta = {
    schema: 1,
    builtAt: new Date().toISOString(),
    entries: entriesN,
    examples: withExN,
    sources: ['ECDICT', 'Tatoeba'],
    licenses: { ecdict: 'MIT', tatoeba: 'CC-BY-2.0-FR' },
    corpus: {
      pairs: usable.length,
      tier: chosen.name,
      zhSenseCap: chosen.zhCap,
      enDefCap: chosen.enCap || 0,
      enDefFrqMax: chosen.enCap ? chosen.enFrqMax : 0,
      exMax: chosen.exN || 0,
    },
  };
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  log('');
  log('================ 构建结果 ================');
  log(`压缩档位          ${chosen.name}`);
  log(`词条数            ${entriesN.toLocaleString()}   (要求 >= 18,000)`);
  log(`有例句的词条      ${withExN.toLocaleString()} (${(100 * withExN / entriesN).toFixed(1)}%)`);
  log(`  其中 2 条例句   ${exStats.second.toLocaleString()}`);
  log(`dict.dat          ${(dictBytes / 1048576).toFixed(2)} MB (gz ${(dictGz / 1048576).toFixed(2)})   (上限 2.95)`);
  log(`词性解析成功      ${posOk.toLocaleString()} / ${built.length.toLocaleString()} = ${(100 * posOk / built.length).toFixed(1)}%   (要求 >= 85%)`);
  log(`耗时              ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log('==========================================');

  // 清理旧契约留下的文件，免得客户端读到过期数据
  for (const stale of ['forms.idx']) {
    const p = join(outDir, stale);
    if (existsSync(p)) { rmSync(p); log(`已删除旧文件 ${stale}（新契约不再需要）`); }
  }

  if (dictBytes > DICT_BUDGET) {
    console.warn(`\n! dict.dat 超出 ${(DICT_BUDGET / 1048576).toFixed(2)} MB 上限`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('构建失败:', e.message);
  process.exitCode = 1;
});

/**
 * SCHEMA —— dict.dat（schema 1）
 *
 *   { "<词头>": [senses, tags, frq, collins, oxford, forms?, examples?] }
 *
 *   [0] senses   [[pos, [中文义项...], [英英释义...]?], ...]
 *                按中文义项数从多到少排。pos 带点："n." "v." "adj." "adv."
 *                "prep." "conj." "pron." "num." "art." "int." "aux."，解析不到为 ""。
 *                [2] 英英释义只有常见词才有。
 *   [1] tags     "zk gk" | null，空格分隔，顺序固定
 *                zk gk cet4 cet6 ky toefl ielts gre
 *   [2] frq      number，0 表示没有
 *   [3] collins  0-5
 *   [4] oxford   0 | 1
 *   [5] forms    [["ran","过去式"], ["running","现在分词"], ...]   无变位则省略该位
 *   [6] examples [["英文句","中文译文"], ...]                     无例句则省略该位
 *
 * 变位不另存映射表：客户端加载后从各条目的 forms 现场建 Map。
 * 查词顺序：dict.dat[key] 直接命中；未命中则在从 forms 建的反查表里取原形，再回 dict.dat。
 *
 * 例句中文超过 60 字符会截断加省略号；英文原样保留。
 */
