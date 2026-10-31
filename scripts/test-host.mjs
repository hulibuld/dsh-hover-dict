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
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

import { API_PREFIX, createAssetResolver, createHandler } from '../index.js'

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
  const assets = createAssetResolver({ dataDir: DATA_DIR, maxBytesPerFile: 32 * 1024 * 1024 })
  const { llm: injectedLlm, ...rest } = options ?? {}
  const handler = createHandler({ assets, llm: injectedLlm, dataDir: DATA_DIR, config: { enabled: true, ...rest } })
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
