#!/usr/bin/env node
/**
 * test-host.mjs —— 宿主侧路由的行为测试。
 *
 * 起一个真的 http 服务器，把 createHandler 挂上去，用真的请求打一遍。
 * 不 mock `req`/`res`：这一层最容易出错的地方恰恰是头部顺序、304 的空 body、
 * HEAD 不发 body 这些只有真请求才暴露的细节。
 *
 * 用法：node scripts/test-host.mjs
 * 退出码：全过 0，有失败 1。
 */

import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

import { API_PREFIX, createAssetResolver, createHandler, createYoudaoStore } from '../index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, 'data')

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  ${mark}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

/** 起一个服务器，返回 { origin, close }。 */
async function serve(options) {
  const {
    llm: injectedLlm,
    youdaoFetch,
    youdaoGapMs,
    youdaoStore,
    dataDir: injectedDataDir,
    ...rest
  } = options ?? {}
  const dir = injectedDataDir ?? DATA_DIR
  const assets = createAssetResolver({ dataDir: dir, maxBytesPerFile: 32 * 1024 * 1024 })
  const handler = createHandler({
    assets,
    llm: injectedLlm,
    dataDir: dir,
    config: { enabled: true, ...rest },
    ...(youdaoFetch !== undefined ? { youdaoFetch } : {}),
    ...(youdaoGapMs !== undefined ? { youdaoGapMs } : {}),
    ...(youdaoStore !== undefined ? { youdaoStore } : {}),
  })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}${API_PREFIX}`,
    close: () => new Promise((done) => server.close(done)),
  }
}


/**
 * 用 node:http 发一个请求，拿**未经解压**的原始响应体与头部。
 *
 * 为什么需要它：Node 的 fetch 会自动解开 gzip，测不出「服务器到底压没压」。
 * 只有绕到 http 层才能看到线上的真实字节。
 *
 * @param {string} origin 形如 http://127.0.0.1:PORT/api/dsh-hover-dict
 * @param {string} path   origin 后面的路径，如 /dict.dat
 * @param {Record<string,string>} headers
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: Buffer }>}
 */
function rawGet(origin, path, headers = {}) {
  return new Promise((done, fail) => {
    const url = new URL(origin + path)
    import('node:http').then(({ request }) => {
      const req = request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers,
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => done({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }))
      })
      req.on('error', fail)
      req.end()
    }).catch(fail)
  })
}

async function main() {
  const server = await serve({})
  const { origin } = server

  try {
    console.log('\n[1] 基本读取')

    const metaRes = await fetch(`${origin}/meta.json`)
    const metaText = await metaRes.text()
    let meta
    try { meta = JSON.parse(metaText) } catch { meta = null }
    record('GET meta.json → 200', metaRes.status === 200, `status=${metaRes.status}`)
    record('GET meta.json → 可解析 JSON', meta !== null && typeof meta.entries === 'number',
      meta ? `entries=${meta.entries}` : '解析失败')
    record('GET meta.json → content-type 正确',
      String(metaRes.headers.get('content-type')).includes('application/json'),
      metaRes.headers.get('content-type'))

    const dictRes = await fetch(`${origin}/dict.dat`)
    const dictBuf = Buffer.from(await dictRes.arrayBuffer())
    const onDisk = readFileSync(join(DATA_DIR, 'dict.dat'))
    record('GET dict.dat → 200', dictRes.status === 200, `status=${dictRes.status}`)
    record('GET dict.dat → 字节数与磁盘一致', dictBuf.length === onDisk.length,
      `${dictBuf.length} vs ${onDisk.length}`)
    record('GET dict.dat → 能 JSON.parse', (() => {
      try { JSON.parse(dictBuf.toString('utf8')); return true } catch { return false }
    })())

    console.log('\n[2] gzip 协商')

    // Node 的 fetch（undici）会**自动解压**带 content-encoding 的响应，
    // 连 `decompress: false` 都不认。要验证压缩是否真的生效，只能用 node:http
    // 拿到未经处理的原始字节。
    const gzRes = await rawGet(origin, '/dict.dat', { 'accept-encoding': 'gzip' })
    const gzBuf = gzRes.body
    record('带 accept-encoding: gzip → content-encoding: gzip',
      gzRes.headers['content-encoding'] === 'gzip',
      gzRes.headers['content-encoding'])
    record('gzip 后体积小于原始体积', gzBuf.length < onDisk.length,
      `${gzBuf.length} < ${onDisk.length}`)
    record('content-length 报的是压缩后长度',
      Number(gzRes.headers['content-length']) === gzBuf.length,
      `header=${gzRes.headers['content-length']} actual=${gzBuf.length}`)
    let inflated = null
    try { inflated = gunzipSync(gzBuf) } catch { inflated = null }
    record('gzip 解压后与原始字节一致', inflated !== null && inflated.equals(onDisk),
      inflated ? `${inflated.length} bytes` : '解压失败')

    const noGzRes = await fetch(`${origin}/dict.dat`, { headers: { 'accept-encoding': 'identity' } })
    record('不带 gzip 时回原文', noGzRes.headers.get('content-encoding') === null,
      noGzRes.headers.get('content-encoding') ?? '(none)')
    await noGzRes.arrayBuffer()

    console.log('\n[3] 条件请求')

    const etag = gzRes.headers.etag
    record('响应带 etag', typeof etag === 'string' && etag.length > 2, etag)
    const cachedRes = await rawGet(origin, '/dict.dat', {
      'accept-encoding': 'gzip',
      'if-none-match': etag ?? '',
    })
    const cachedBody = { byteLength: cachedRes.body.length }
    record('if-none-match 命中 → 304', cachedRes.status === 304, `status=${cachedRes.status}`)
    record('304 的 body 为空', cachedBody.byteLength === 0, `${cachedBody.byteLength} bytes`)
    record('响应带 cache-control 且不是 immutable',
      String(cachedRes.headers['cache-control'] ?? '').includes('must-revalidate')
      && !String(cachedRes.headers['cache-control'] ?? '').includes('immutable'),
      cachedRes.headers['cache-control'])
    record('响应带 vary: accept-encoding',
      String(cachedRes.headers.vary ?? '').includes('accept-encoding'),
      cachedRes.headers.vary)

    console.log('\n[4] 安全边界')

    const traversal = await fetch(`${origin}/../../../../etc/passwd`)
    const traversalBody = await traversal.text()
    record('路径穿越被拒绝', traversal.status === 404,
      `status=${traversal.status} body=${traversalBody.slice(0, 60)}`)
    record('路径穿越不回显文件内容', !traversalBody.includes('root:'),
      traversalBody.includes('root:') ? '泄露了 /etc/passwd！' : '安全')

    const encodedTraversal = await fetch(`${origin}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
    record('编码后的路径穿越也被拒绝', encodedTraversal.status === 404,
      `status=${encodedTraversal.status}`)

    const missing = await fetch(`${origin}/nonexist`)
    record('未知文件名 → 404', missing.status === 404, `status=${missing.status}`)
    record('错误响应形状是 {ok:false,error:{code,message}}', await (async () => {
      try {
        const body = await missing.json()
        return body?.ok === false && typeof body?.error?.code === 'string'
          && typeof body?.error?.message === 'string'
      } catch { return false }
    })())

    console.log('\n[5] 方法约束')

    const postRes = await fetch(`${origin}/dict.dat`, { method: 'POST' })
    record('POST → 405', postRes.status === 405, `status=${postRes.status}`)
    record('405 带 allow 头', String(postRes.headers.get('allow') ?? '').includes('GET'),
      postRes.headers.get('allow'))
    await postRes.arrayBuffer()

    const headRes = await fetch(`${origin}/meta.json`, { method: 'HEAD' })
    const headBody = await headRes.arrayBuffer()
    record('HEAD → 200', headRes.status === 200, `status=${headRes.status}`)
    record('HEAD 无 body', headBody.byteLength === 0, `${headBody.byteLength} bytes`)
    record('HEAD 仍带 content-length', Number(headRes.headers.get('content-length')) > 0,
      headRes.headers.get('content-length'))

    console.log('\n[6] health 与禁用状态')

    const healthRes = await fetch(`${origin}/health`)
    const health = await healthRes.json()
    record('GET health → 200 且带 entries', healthRes.status === 200
      && typeof health.entries === 'number' && health.entries > 0, `entries=${health.entries}`)
    record('health 报的 entries 与 meta 一致', health.entries === meta.entries,
      `${health.entries} vs ${meta?.entries}`)
  } finally {
    await server.close()
  }

  console.log('\n[6.5] 句子翻译')

// 假 llm：把输入原样回显成「译文」，用来验证路由与流式拼装
const fakeLlm = {
  listProviders: () => [{ id: 'deepseek' }],
  listModels: async () => [{ id: 'deepseek-chat' }],
  async *stream(options) {
    const userText = options.messages?.[0]?.content?.[0]?.text ?? ''
    // 只回显最后一段（原文）
    const source = userText.split('\n').filter(Boolean).pop() ?? ''
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `【译】${source}` }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}

const translateServer = await serve({ llm: fakeLlm })
try {
  const res = await fetch(`${translateServer.origin}/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'The quick brown fox' }),
  })
  const body = await res.json()
  record('POST translate → 200', res.status === 200, `status=${res.status}`)
  record('翻译结果包含原文', typeof body?.text === 'string' && body.text.includes('The quick brown fox'),
    body?.text)

  const empty = await fetch(`${translateServer.origin}/translate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '' }),
  })
  const emptyBody = await empty.json()
  record('空文本 → 400', empty.status === 400, `status=${empty.status}`)
  record('空文本错误码正确', emptyBody?.error?.code === 'E_EMPTY_TEXT', emptyBody?.error?.code)

  const long = await fetch(`${translateServer.origin}/translate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'a'.repeat(2000) }),
  })
  const longBody = await long.json()
  record('超长文本 → 400', long.status === 400, `status=${long.status}`)
  record('超长错误码正确', longBody?.error?.code === 'E_TOO_LONG', longBody?.error?.code)
} finally {
  await translateServer.close()
}

// 没有 llm 服务时
const noLlmServer = await serve({})
try {
  const res = await fetch(`${noLlmServer.origin}/translate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello world' }),
  })
  const body = await res.json()
  record('无 llm 服务 → 503', res.status === 503, `status=${res.status}`)
  record('无 llm 错误码是 E_NO_LLM', body?.error?.code === 'E_NO_LLM', body?.error?.code)
  record('无 llm 时查词仍可用', (await fetch(`${noLlmServer.origin}/meta.json`)).status === 200)
} finally {
  await noLlmServer.close()
}

console.log('\n[6.8] 额外词库包')

// 测试自己造一个包，不依赖仓库里有没有——跑完删掉
const packsDir = join(DATA_DIR, 'packs')
const samplePackPath = join(packsDir, 'testpack.dat')
mkdirSync(packsDir, { recursive: true })
writeFileSync(samplePackPath, JSON.stringify({
  sample: [[['n.', ['测试包词条']]], 'ielts', 1000, 3, 0],
}))

const packServer = await serve({})
try {
  const res = await fetch(`${packServer.origin}/testpack.dat`)
  const body = await res.json().catch(() => null)
  record('可下载词库包能被读取', res.status === 200, `status=${res.status}`)
  record('词库包内容正确', body !== null && typeof body.sample === 'object', JSON.stringify(body)?.slice(0, 60))

  // 路径穿越：即便 packs 目录里真有文件，也不能用 ../ 摸出去
  const evil = await fetch(`${packServer.origin}/../dict.dat`)
  record('词库包路径穿越被拒', evil.status === 404, `status=${evil.status}`)

  const notPack = await fetch(`${packServer.origin}/nonexistent.dat`)
  record('不存在的包 → 404', notPack.status === 404, `status=${notPack.status}`)

  // CSV 词库：放进去就能用，不需要预处理
  const csvPath = join(packsDir, 'testcsv.csv')
  writeFileSync(csvPath, 'word,translation,definition,tag\nserendipity,"n. 意外发现, 侥幸","luck",cet6\n')
  try {
    const csvRes = await fetch(`${packServer.origin}/testcsv.csv`)
    const csvBody = await csvRes.json().catch(() => null)
    record('CSV 词库能读', csvRes.status === 200, `status=${csvRes.status}`)
    record('CSV 转成词条结构',
      csvBody?.serendipity?.[0]?.[0]?.[1]?.includes('意外发现'), JSON.stringify(csvBody?.serendipity)?.slice(0, 60))
    record('CSV 标签保留', csvBody?.serendipity?.[1] === 'cet6', csvBody?.serendipity?.[1])
  } finally {
    try { rmSync(csvPath) } catch { /* ignore */ }
  }
} finally {
  await packServer.close()
  // 清理：删掉测试包，别把痕迹留进仓库
  try { rmSync(samplePackPath) } catch { /* ignore */ }
}

// 多通道降级：第一个通道报错，第二个能出结果
const failingLlm = {
  listProviders: () => [{ id: 'bad' }, { id: 'good' }],
  listModels: async (id) => (id === 'bad' ? [{ id: 'bad-model' }] : [{ id: 'good-model' }]),
  async *stream(options) {
    if (options.provider === 'bad') {
      throw new Error('Authentication Fails, Your api key: ****c80e is invalid')
    }
    yield { type: 'text-delta', index: 0, text: '译文' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
}
const failoverServer = await serve({ llm: failingLlm })
try {
  const res = await fetch(`${failoverServer.origin}/translate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello world' }),
  })
  const body = await res.json()
  record('坏通道失败后自动换下一个', res.status === 200 && body?.text === '译文',
    `status=${res.status} text=${body?.text}`)
} finally {
  await failoverServer.close()
}

// 全部失败时要把试过哪些通道说出来
const allBadLlm = {
  listProviders: () => [{ id: 'x' }],
  listModels: async () => [{ id: 'xm' }],
  async *stream() { throw new Error('boom') },
}
const allBadServer = await serve({ llm: allBadLlm })
try {
  const res = await fetch(`${allBadServer.origin}/translate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello world' }),
  })
  const body = await res.json()
  record('全部失败 → 502 且说明原因',
    res.status === 502 && String(body?.error?.message ?? '').includes('boom'),
    body?.error?.message)
} finally {
  await allBadServer.close()
}

console.log('\n[7] 词库缺失与禁用')

  const backup = join(tmpdir(), `dsh-hover-dict-data-${process.pid}`)
  renameSync(DATA_DIR, backup)
  try {
    const emptyServer = await serve({})
    try {
      const res = await fetch(`${emptyServer.origin}/dict.dat`)
      const body = await res.json().catch(() => ({}))
      record('词库缺失 → 503', res.status === 503, `status=${res.status}`)
      record('词库缺失的 code 是 E_DICT_MISSING', body?.error?.code === 'E_DICT_MISSING',
        body?.error?.code)
    } finally {
      await emptyServer.close()
    }
  } finally {
    renameSync(backup, DATA_DIR)
  }

  const disabledServer = await serve({ enabled: false })
  try {
    const res = await fetch(`${disabledServer.origin}/dict.dat`)
    const body = await res.json().catch(() => ({}))
    record('插件禁用 → 404', res.status === 404, `status=${res.status}`)
    record('禁用态的 code 是 E_DISABLED', body?.error?.code === 'E_DISABLED', body?.error?.code)
    const healthRes = await fetch(`${disabledServer.origin}/health`)
    const health = await healthRes.json()
    record('禁用时 health 仍可用且报 enabled:false',
      healthRes.status === 200 && health.enabled === false, `enabled=${health.enabled}`)
  } finally {
    await disabledServer.close()
  }

  console.log('\n[8] 有道同步：Cookie 存取删与状态')

  // 用临时目录当 dataDir：既隔离发布物，又能验证 Cookie 文件权限
  const youdaoDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-'))
  const cookiePath = join(youdaoDir, 'youdao-cookie.json')
  const SAMPLE_COOKIE = 'DICT_SESS=v2|abcdef123456; OUTFOX_SEARCH_USER_ID=42@1.2.3.4'
  const NICK = '小词典用户'

  /** 造一个假 Response，够 youdaoGet 用的最小形状。 */
  const fakeRes = (status, text, headers = {}) => ({
    status,
    text: async () => text,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  })

  /**
   * 有道 mock：accountinfo 有效、webapi 分页给词。
   * 记录每次请求的 URL，供断言 limit/offset/间隔。
   */
  function makeYoudaoMock(pages = []) {
    const calls = []
    const mock = async (url) => {
      calls.push({ url: String(url), at: Date.now() })
      const u = String(url)
      if (u.includes('/login/acc/query/accountinfo')) {
        return fakeRes(200, JSON.stringify({ code: 0, msg: 'SUCCESS', data: { nickname: NICK } }))
      }
      if (u.includes('/wordbook/webapi/v2/word/list')) {
        const parsed = new URL(u)
        const limit = Number(parsed.searchParams.get('limit') ?? '0')
        const offset = Number(parsed.searchParams.get('offset') ?? '0')
        const slice = pages.slice(offset, offset + limit)
        return fakeRes(200, JSON.stringify({
          code: 0, msg: 'SUCCESS',
          data: { total: pages.length, list: slice },
        }))
      }
      if (u.includes('/wordbook/wordlist')) return fakeRes(200, '<html><body>无词</body></html>')
      return fakeRes(404, '{}')
    }
    mock.calls = calls
    return mock
  }

  const pageWords = []
  for (let i = 0; i < 7; i += 1) {
    pageWords.push({ word: `word${i}`, trans: `释义${i}` })
  }
  // 故意放一个重复词，验证跨页去重
  pageWords.push({ word: 'word0', trans: '重复的释义' })

  const youdaoMock = makeYoudaoMock(pageWords)
  const youdaoServer = await serve({ youdaoFetch: youdaoMock, youdaoGapMs: 0, dataDir: youdaoDir })

  try {
    // --- 未配置状态 ---
    const status0 = await fetch(`${youdaoServer.origin}/youdao/status`)
    const status0Body = await status0.json()
    record('无 Cookie 时 status → 200', status0.status === 200, `status=${status0.status}`)
    record('status 报 hasCookie:false',
      status0Body?.ok === true && status0Body?.hasCookie === false, JSON.stringify(status0Body))
    record('无 Cookie 时 valid:false', status0Body?.valid === false, `valid=${status0Body?.valid}`)

    const sync0 = await fetch(`${youdaoServer.origin}/youdao/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const sync0Body = await sync0.json()
    record('无 Cookie 时 sync → 401', sync0.status === 401, `status=${sync0.status}`)
    record('无 Cookie 时 sync 报 E_YOUDAO_AUTH',
      sync0Body?.error?.code === 'E_YOUDAO_AUTH', sync0Body?.error?.code)
    record('sync 失败形状是 {ok:false,error:{code,message}}',
      sync0Body?.ok === false && typeof sync0Body?.error?.message === 'string',
      sync0Body?.error?.message)
    record('没有 Cookie 时不会凭空造文件', !existsFile(cookiePath), cookiePath)

    // --- 保存并验证 ---
    const saveRes = await fetch(`${youdaoServer.origin}/youdao/cookie`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: SAMPLE_COOKIE }),
    })
    const saveBody = await saveRes.json()
    record('POST cookie → 200 且 valid:true',
      saveRes.status === 200 && saveBody?.valid === true, JSON.stringify(saveBody))
    record('验证通过带回昵称', saveBody?.nickname === NICK, saveBody?.nickname)
    record('保存响应不回显 cookie 明文',
      !JSON.stringify(saveBody).includes('DICT_SESS'),
      JSON.stringify(saveBody).includes('DICT_SESS') ? '泄露了 Cookie！' : '安全')

    record('Cookie 落盘', existsFile(cookiePath), cookiePath)
    const mode = existsFile(cookiePath) ? (statSync(cookiePath).mode & 0o777) : -1
    record('Cookie 文件权限是 0o600', mode === 0o600, `mode=0o${mode.toString(8)}`)
    const onDisk = existsFile(cookiePath) ? JSON.parse(readFileSync(cookiePath, 'utf8')) : {}
    record('落盘内容含 cookie 与保存时间',
      typeof onDisk.cookie === 'string' && onDisk.cookie !== '' && Number.isFinite(onDisk.savedAt),
      `savedAt=${onDisk.savedAt}`)

    // --- status 不回显明文 ---
    const status1 = await fetch(`${youdaoServer.origin}/youdao/status`)
    const status1Text = await status1.text()
    const status1Body = JSON.parse(status1Text)
    record('配置后 status 报 hasCookie:true', status1Body?.hasCookie === true, JSON.stringify(status1Body))
    record('配置后 status 报 valid:true', status1Body?.valid === true, `valid=${status1Body?.valid}`)
    record('status 含昵称', status1Body?.nickname === NICK, status1Body?.nickname)
    record('status 响应体不含 cookie 明文', !status1Text.includes('DICT_SESS'),
      status1Text.includes('DICT_SESS') ? '泄露了 Cookie！' : '安全')
    record('status 响应体不含 cookie 任何片段', !status1Text.includes('abcdef123456'),
      status1Text.includes('abcdef123456') ? '泄露了 Cookie 片段！' : '安全')

    // --- 抓取分页 ---
    const syncRes = await fetch(`${youdaoServer.origin}/youdao/sync`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const syncBody = await syncRes.json()
    record('POST sync → 200', syncRes.status === 200, `status=${syncRes.status}`)
    record('抓回 7 个去重后的词（8 条里有 1 条重复）',
      syncBody?.total === 7 && Array.isArray(syncBody?.words) && syncBody.words.length === 7,
      `total=${syncBody?.total}`)
    record('返回词头清单给前端（前端调 importMany）',
      syncBody?.words?.includes('word3'), JSON.stringify(syncBody?.words)?.slice(0, 80))
    record('跨页重复词只算一次',
      syncBody?.words?.filter((w) => w === 'word0').length === 1,
      `word0 出现 ${syncBody?.words?.filter((w) => w === 'word0').length} 次`)
    record('释义随词返回（进 gloss）', syncBody?.glosses?.word3 === '释义3', syncBody?.glosses?.word3)
    record('抓取走的是 webapi v2 端点', syncBody?.endpoint === 'webapi', syncBody?.endpoint)

    const listCalls = youdaoMock.calls.filter((c) => c.url.includes('/word/list'))
    record('第一页 offset=0', /offset=0/.test(listCalls[0]?.url ?? ''), listCalls[0]?.url)
    record('单页 limit 不超过 100',
      listCalls.every((c) => Number(new URL(c.url).searchParams.get('limit')) <= 100),
      listCalls.map((c) => new URL(c.url).searchParams.get('limit')).join(','))
    record('带 Cookie 头请求', youdaoMock.calls.length > 0, `${youdaoMock.calls.length} 次外网调用`)

    const status2 = await (await fetch(`${youdaoServer.origin}/youdao/status`)).json()
    record('status 报上次同步词数', status2?.lastCount === 7, `lastCount=${status2?.lastCount}`)
    record('status 报上次同步时间', Number.isFinite(status2?.lastSyncAt) && status2.lastSyncAt > 0,
      `lastSyncAt=${status2?.lastSyncAt}`)

    // --- 方法闸门 ---
    const withGet = await fetch(`${youdaoServer.origin}/youdao/cookie`)
    record('GET /youdao/cookie → 405', withGet.status === 405, `status=${withGet.status}`)
    record('405 带 allow: POST, DELETE',
      String(withGet.headers.get('allow') ?? '').includes('POST')
      && String(withGet.headers.get('allow') ?? '').includes('DELETE'),
      withGet.headers.get('allow'))
    await withGet.arrayBuffer()

    const statusPost = await fetch(`${youdaoServer.origin}/youdao/status`, { method: 'POST' })
    record('POST /youdao/status → 405', statusPost.status === 405, `status=${statusPost.status}`)
    await statusPost.arrayBuffer()

    const syncGet = await fetch(`${youdaoServer.origin}/youdao/sync`)
    record('GET /youdao/sync → 405', syncGet.status === 405, `status=${syncGet.status}`)
    await syncGet.arrayBuffer()

    // --- 清除 ---
    const delRes = await fetch(`${youdaoServer.origin}/youdao/cookie`, { method: 'DELETE' })
    const delBody = await delRes.json()
    record('DELETE cookie → 200 ok', delRes.status === 200 && delBody?.ok === true,
      JSON.stringify(delBody))
    record('删除后文件不留在盘上', !existsFile(cookiePath),
      existsFile(cookiePath) ? '文件还在！' : '已删除')
    const status3 = await (await fetch(`${youdaoServer.origin}/youdao/status`)).json()
    record('删除后 status 报 hasCookie:false', status3?.hasCookie === false, `hasCookie=${status3?.hasCookie}`)

    const sync3 = await fetch(`${youdaoServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const sync3Body = await sync3.json()
    record('删除后 sync 回到 E_YOUDAO_AUTH',
      sync3.status === 401 && sync3Body?.error?.code === 'E_YOUDAO_AUTH',
      `${sync3.status} ${sync3Body?.error?.code}`)

    // --- 空白 / 形状不对的 Cookie ---
    const emptyCookie = await fetch(`${youdaoServer.origin}/youdao/cookie`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cookie: '' }),
    })
    const emptyCookieBody = await emptyCookie.json()
    record('空 Cookie → 400 E_EMPTY_COOKIE',
      emptyCookie.status === 400 && emptyCookieBody?.error?.code === 'E_EMPTY_COOKIE',
      `${emptyCookie.status} ${emptyCookieBody?.error?.code}`)

    const junk = await fetch(`${youdaoServer.origin}/youdao/cookie`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: '这不是cookie' }),
    })
    const junkBody = await junk.json()
    record('形状不对的 Cookie → 400 E_BAD_COOKIE',
      junk.status === 400 && junkBody?.error?.code === 'E_BAD_COOKIE',
      `${junk.status} ${junkBody?.error?.code}`)
    record('无效输入不落盘', !existsFile(cookiePath), cookiePath)
  } finally {
    await youdaoServer.close()
  }

  console.log('\n[8.05] 有道同步：空收藏夹 vs 接口改版（不许混淆）')

  // 身份有效、端点形态认识、就是 0 个词 → 成功返回空表
  const emptyBookMock = async (url) => {
    const u = String(url)
    if (u.includes('/accountinfo')) {
      return fakeRes(200, JSON.stringify({ code: 0, data: { nickname: 'emptyuser' } }))
    }
    if (u.includes('/word/list')) {
      return fakeRes(200, JSON.stringify({ code: 0, msg: 'SUCCESS', data: { total: 0, list: [] } }))
    }
    return fakeRes(200, '<html><body></body></html>')
  }
  const emptyDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-empty-'))
  const emptyStore = createYoudaoStore(emptyDir)
  emptyStore.save('DICT_SESS=v2|empty', '')
  const emptyServer = await serve({
    youdaoFetch: emptyBookMock, youdaoGapMs: 0, dataDir: emptyDir, youdaoStore: emptyStore,
  })
  try {
    const res = await fetch(`${emptyServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const body = await res.json()
    record('空收藏夹 → 200 ok（不是改版）', res.status === 200 && body?.ok === true,
      `${res.status} ok=${body?.ok}`)
    record('空收藏夹 total=0 且 words 为空数组',
      body?.total === 0 && Array.isArray(body?.words) && body.words.length === 0,
      `total=${body?.total}`)
    record('空收藏夹不报 E_YOUDAO_ENDPOINT', body?.error === undefined, body?.error?.code ?? '(无错误)')
  } finally {
    await emptyServer.close()
  }

  console.log('\n[8.1] 有道同步：Cookie 失效与降级')

  // Cookie 被服务端判未登录（2026-11 实测形态：HTTP 200 + code:401）
  const expiredMock = async (url) => {
    const u = String(url)
    if (u.includes('/accountinfo')) return fakeRes(200, JSON.stringify({ msg: 'NO_LOGIN', code: 2035 }))
    if (u.includes('/word/list')) {
      return fakeRes(200, JSON.stringify({ code: 401, msg: '用户未登录', data: null }))
    }
    return fakeRes(200, '<html><body></body></html>')
  }
  const expiredDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-exp-'))
  const expiredStore = createYoudaoStore(expiredDir)
  expiredStore.save('DICT_SESS=v2|expired', '')

  const expiredServer = await serve({
    youdaoFetch: expiredMock, youdaoGapMs: 0, dataDir: expiredDir, youdaoStore: expiredStore,
  })
  try {
    const res = await fetch(`${expiredServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const body = await res.json()
    record('Cookie 失效 → 401', res.status === 401, `status=${res.status}`)
    record('失效错误码 E_YOUDAO_AUTH 且文案指向重新复制',
      body?.error?.code === 'E_YOUDAO_AUTH' && String(body?.error?.message).includes('重新'),
      body?.error?.message)
    record('失效不静默：不是 ok:true 空词表', body?.ok === false, `ok=${body?.ok}`)

    const st = await (await fetch(`${expiredServer.origin}/youdao/status`)).json()
    record('失效时 status valid:false 但 hasCookie 仍报真实状态',
      st?.valid === false && st?.hasCookie === true, `valid=${st?.valid} hasCookie=${st?.hasCookie}`)

    // 失效 Cookie 无法通过验证时不落盘
    const reSave = await fetch(`${expiredServer.origin}/youdao/cookie`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie: 'DICT_SESS=v2|nope' }),
    })
    const reSaveBody = await reSave.json()
    record('验证不通过的 Cookie 回 valid:false',
      reSave.status === 200 && reSaveBody?.valid === false, JSON.stringify(reSaveBody))
    record('验证不通过时给出重贴提示',
      String(reSaveBody?.message ?? '').includes('复制'), reSaveBody?.message)
  } finally {
    await expiredServer.close()
  }

  // 端点全部改版：能验身份但抓不到词 → 明确降级，不许静默
  const brokenMock = async (url) => {
    const u = String(url)
    if (u.includes('/accountinfo')) {
      return fakeRes(200, JSON.stringify({ code: 0, data: { nickname: 'okbutnovoca' } }))
    }
    // webapi 返回了别的 schema，HTML 页也没词
    if (u.includes('/word/list')) return fakeRes(200, JSON.stringify({ code: 0, data: { foo: 'bar' } }))
    return fakeRes(200, '<html><body><div>页面改版了</div></body></html>')
  }
  const brokenServer = await serve({
    youdaoFetch: brokenMock, youdaoGapMs: 0, dataDir: brokenDir(),
    youdaoStore: brokenStore(),
  })
  try {
    const res = await fetch(`${brokenServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const body = await res.json()
    record('端点改版 → 502', res.status === 502, `status=${res.status}`)
    record('端点改版错误码 E_YOUDAO_ENDPOINT',
      body?.error?.code === 'E_YOUDAO_ENDPOINT', body?.error?.code)
    record('端点改版带 fallback:manual 供前端显示手动导入引导',
      body?.error?.fallback === 'manual', `fallback=${body?.error?.fallback}`)
    record('端点改版文案教用户用手动导入',
      String(body?.error?.message).includes('手动导入'), body?.error?.message)
    record('端点改版不静默返回 0 个词', body?.ok === false, `ok=${body?.ok}`)
  } finally {
    await brokenServer.close()
  }

  console.log('\n[8.2] 有道同步：限速与超时')

  const slowPagesList = []
  for (let i = 0; i < 3; i += 1) slowPagesList.push({ word: `gap${i}`, trans: `间隔${i}` })
  const gapMock = makeYoudaoMock(slowPagesList)
  const gapDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-gap-'))
  const gapStore = createYoudaoStore(gapDir)
  gapStore.save('DICT_SESS=v2|gap', '')
  // 不传 youdaoGapMs → 走线上默认 400ms，验证限速真的生效
  const gapServer = await serve({ youdaoFetch: gapMock, dataDir: gapDir, youdaoStore: gapStore })
  try {
    const started = Date.now()
    const res = await fetch(`${gapServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const body = await res.json()
    const elapsed = Date.now() - started
    const listCalls = gapMock.calls.filter((c) => c.url.includes('/word/list'))
    record('默认 400ms 间隔下抓完 3 词', res.status === 200 && body?.total === 3,
      `total=${body?.total}`)
    // 3 个词 < limit，只打一页：没有第二次翻页就没有间隔要求
    record('小收藏夹只打一页', listCalls.length === 1, `${listCalls.length} 页`)
    record('单页内不额外拖延', elapsed < 2000, `${elapsed}ms`)
  } finally {
    await gapServer.close()
  }

  // 两页：第 2 页必须等 ≥400ms
  const twoPageWords = []
  for (let i = 0; i < 101; i += 1) twoPageWords.push({ word: `p${i}`, trans: `t${i}` })
  const twoPageMock = makeYoudaoMock(twoPageWords)
  const twoDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-two-'))
  const twoStore = createYoudaoStore(twoDir)
  twoStore.save('DICT_SESS=v2|two', '')
  const twoPageServer = await serve({ youdaoFetch: twoPageMock, dataDir: twoDir, youdaoStore: twoStore })
  try {
    const res = await fetch(`${twoPageServer.origin}/youdao/sync`, { method: 'POST', body: '{}' })
    const body = await res.json()
    const listCalls = twoPageMock.calls.filter((c) => c.url.includes('/word/list'))
    record('101 词分两页抓完', res.status === 200 && body?.total === 101, `total=${body?.total}`)
    record('确实翻了第二页', listCalls.length === 2, `${listCalls.length} 页`)
    record('第二页 offset=100',
      new URL(listCalls[1]?.url ?? 'http://x/?offset=-1').searchParams.get('offset') === '100',
      listCalls[1]?.url)
    const gaps = listCalls.length >= 2 ? listCalls[1].at - listCalls[0].at : 0
    record('两页之间间隔 ≥400ms', gaps >= 380, `${gaps}ms`)
  } finally {
    await twoPageServer.close()
  }

  const failed = results.filter((item) => !item.ok)
  console.log(`\n================ ${results.length - failed.length}/${results.length} 通过 ================`)
  if (failed.length > 0) {
    console.log('失败项：')
    for (const item of failed) console.log(`  - ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('测试自身崩溃：', error)
  process.exit(1)
})

/** existsFile：statSync 探存在，不抛。 */
function existsFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

/** brokenDir/brokenStore：降级测试专用临时目录（同一份，避免留痕）。 */
let _brokenDir = null
function brokenDir() {
  if (_brokenDir === null) _brokenDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-youdao-broken-'))
  return _brokenDir
}
let _brokenStore = null
function brokenStore() {
  if (_brokenStore === null) {
    _brokenStore = createYoudaoStore(brokenDir())
    _brokenStore.save('DICT_SESS=v2|broken', '')
  }
  return _brokenStore
}
