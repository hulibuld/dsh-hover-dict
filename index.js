/**
 * dsh-hover-dict —— 宿主侧入口。
 *
 * 只做三件事：
 *   1. 声明插件身份与依赖的服务（`webServer`）；
 *   2. 声明配置 schema（**必须是 schemastery**，普通对象会让插件静默不激活，
 *      报错是 `Cannot read properties of undefined (reading 'validate')`）；
 *   3. 在 `ctx.effect` 里注册**一条** prefix 路由 `/api/dsh-hover-dict`，
 *      把 data/ 下的两个词库文件按需吐给浏览器半，返回 disposer。
 *
 * 这个插件**不注册工具、不写会话事件、不改 agent-loop**。查词全在浏览器里发生，
 * 宿主侧只是一台静态文件服务器 —— 理由见 docs/架构.md 的「词库放哪一侧」一节。
 *
 * 为什么 apply 里不 await 顶层 IO：cordis 的 apply 是同步装配阶段，在里面 await
 * 会把插件加载拖进不确定状态。词库文件在第一次请求时才读盘，且带 stat 缓存。
 *
 * 什么时候会失败、失败给谁看：
 *   - 缺 `webServer` 服务 → cordis 不会加载本插件（inject 声明了它），不会半死；
 *   - data/ 下缺文件 → 路由返回 503 与一句中文，界面显示「词库未就绪」；
 *   - 装配阶段异常一律 console.warn 一次，不刷屏。
 */


import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import z from '@deepseek-ai/schemastery'

/** 插件名。与 package.json 的 `name` 一致，也是 cordis 里的行标识。 */
export const name = 'dsh-hover-dict'

/**
 * 依赖的宿主服务。
 *
 * 只依赖 `webServer`：本插件不读会话、不注册工具、不碰 agent 状态。
 * 缺它就让 cordis 明确不加载，而不是半死状态。
 */
export const inject = ['webServer']

/**
 * 路由前缀。改这里必须同步改 `client/src/net.js` 里的 `API_PREFIX`。
 * @type {string}
 */
export const API_PREFIX = '/api/dsh-hover-dict'

/**
 * 插件配置。
 *
 * 这里只放**宿主侧真的会读**的项。悬停延迟、浮层尺寸这类纯界面参数不进 Config，
 * 因为它们属于浏览器半、且改了要立刻生效，塞进 Config 会强迫用户为了调 50ms
 * 去改 profile 的 cordis.patch.yml。界面项走 localStorage，见 docs/架构.md 的配置表。
 *
 * @typedef {object} HoverDictConfig
 * @property {string} dataDir       词库目录，留空 = 包内 ./data
 * @property {boolean} enabled      总开关。关掉后路由仍注册（返回 404），客户端不挂监听
 * @property {number} maxBytesPerFile 单文件读取上限（字节），防误配超大文件把宿主撑爆
 */
export const Config = z.object({
  dataDir: z.string().default('').description('词库目录，留空则使用包内 data/'),
  enabled: z.boolean().default(true).description('启用悬停查词'),
  maxBytesPerFile: z
    .number()
    .default(32 * 1024 * 1024)
    .description('单个词库文件的读取上限（字节）'),
})

/**
 * 词库文件清单。宿主只认这两个名字，客户端也只请求这两个。
 *
 * 类型见 docs/架构.md §4：
 *   - `dict.dat`  → `Record<string, Entry>`（以词头为键，值见契约 §4.2）
 *   - `meta.json` → `DictMeta`（§4.1）
 *
 * **没有 forms.idx**：变位信息已经在每个词条的槽 3 里，客户端运行时建索引
 * （见 docs/架构.md §4.3 / §4.4，以及 §4.4 里「词头优先」那条建索引顺序）。
 *
 * @type {ReadonlyArray<{ file: string, contentType: string, gzip: boolean }>}
 */
const ASSETS = Object.freeze([
  { file: 'meta.json', contentType: 'application/json; charset=utf-8', gzip: true },
  { file: 'dict.dat', contentType: 'application/json; charset=utf-8', gzip: true },
  // 词根词缀分析。可选文件：没有它客户端只是不显示这一块，不影响查词。
  { file: 'wordroot.dat', contentType: 'application/json; charset=utf-8', gzip: true },
])

/** 包内默认词库目录。用 import.meta.url 推导，不能用 process.cwd()。 */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_DIR = join(PACKAGE_DIR, 'data')

/** 白名单集合。请求进来先查它，查不到直接 404，绝不拼路径。 */
const ASSET_BY_NAME = new Map(ASSETS.map((asset) => [asset.file, asset]))

/**
 * 额外的词库包：`data/packs/<名字>.dat`。
 *
 * 用白名单 + 目录扫描的结果来判定，**不接受任意文件名** ——
 * 拼路径再判存在是路径穿越的入口。扫描只在启动时做一次，
 * 名字必须落在扫描结果里才允许读。
 *
 * @returns {Map<string, { file: string, contentType: string, gzip: boolean }>}
 */
function scanPacks(dataDir) {
  const out = new Map()
  const dir = join(dataDir, 'packs')
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    // 只认 .dat，且名字必须是纯字母数字与连字符，挡掉 ../ 与奇怪字符
    if (!name.endsWith('.dat')) continue
    if (!/^[a-z0-9][a-z0-9-]*\.dat$/.test(name)) continue
    out.set(name, { file: `packs/${name}`, contentType: 'application/json; charset=utf-8', gzip: true })
  }
  return out
}

/** 当前可用的全部资源（内置三个 + 目录里扫到的包）。每次请求都重扫，代价可忽略。 */
function availableAssets(dataDir) {
  const merged = new Map(ASSET_BY_NAME)
  for (const [name, spec] of scanPacks(dataDir)) {
    if (!merged.has(name)) merged.set(name, spec)
  }
  return merged
}

/** gzip 的最小收益门槛：小于这个尺寸压了反而更大，还多一次 CPU。 */
const GZIP_MIN_BYTES = 1024

/** 默认 logger。宿主没给就用 console，但只在真出问题时说话。 */
const SILENT_LOGGER = Object.freeze({
  warn: () => {},
  error: () => {},
})

/**
 * 插件装配。
 *
 * @param {{ webServer: { register: (options: object) => () => void }, effect?: Function }} ctx
 * @param {HoverDictConfig} config - 已过 schema 校验的配置
 * @returns {void}
 */
export function apply(ctx, config) {
  try {
    const resolved = config ?? {}
    const enabled = resolved.enabled !== false
    const dataDir = normalizeDataDir(resolved.dataDir)
    const maxBytesPerFile = Number.isFinite(resolved.maxBytesPerFile) && resolved.maxBytesPerFile > 0
      ? resolved.maxBytesPerFile
      : 32 * 1024 * 1024

    const assets = createAssetResolver({ dataDir, maxBytesPerFile })
    // llm 是可选服务：没有它插件照样查词，只是不翻译。
    // 用 ctx.get 探测，不能写 ctx.llm（未声明时会抛错）。
    let llm
    if (typeof ctx?.get === 'function') {
      try { llm = ctx.get('llm') } catch { llm = undefined }
    }
    const handler = createHandler({ assets, llm, dataDir, config: { ...resolved, enabled }, logger: SILENT_LOGGER })

    // 注册即 effect：插件卸载时 disposer 撤掉路由，不泄漏。
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler,
    })
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => dispose, 'dsh-hover-dict: /api/dsh-hover-dict 路由')
    }
  } catch (error) {
    // apply 抛错会让整条插件在宿主里静默消失，非常难查。这里降级成一句警告。
    console.warn(
      `[dsh-hover-dict] 装配失败，查词功能不可用：${error?.message ?? error}`,
    )
  }
}

/**
 * 把配置里的 dataDir 归一化成绝对路径。
 *
 * 空串 = 用包内 data/；相对路径按包目录解析（不是按 cwd，cwd 是用户工作区）。
 */
function normalizeDataDir(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_DATA_DIR
  const trimmed = value.trim()
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(PACKAGE_DIR, trimmed)
}

/**
 * 造一个词库文件解析器：把 URL 尾段映射到磁盘文件，带 stat 缓存与 ETag。
 *
 * 缓存的键是文件名，值是 `{ path, size, mtimeMs, etag }`。
 * 文件 mtime 变了才重算 ETag —— 用户改 data/ 不重启也能生效，但不要每次请求都 stat。
 *
 * @param {object} options
 * @param {string} options.dataDir
 * @param {number} options.maxBytesPerFile
 * @param {{ warn: Function, info?: Function }} [options.logger]
 * @returns {{
 *   resolve: (name: string) => { ok: true, path: string, size: number, mtimeMs: number, etag: string } | { ok: false, code: string, message: string },
 *   invalidate: (name?: string) => void
 * }}
 */
export function createAssetResolver(options) {
  const { dataDir, maxBytesPerFile } = options
  const logger = options.logger ?? SILENT_LOGGER
  /** @type {Map<string, { size: number, mtimeMs: number, etag: string, path: string }>} */
  const cache = new Map()

  return {
    resolve(name, whitelist) {
      // 白名单先于一切：不在清单里的名字直接拒绝。
      // 不要「拼出路径再判断存在」——那是路径穿越的入口（../ 会拼出包外的文件）。
      const allowed = whitelist ?? ASSET_BY_NAME
      if (typeof name !== 'string' || !allowed.has(name)) {
        return { ok: false, code: 'E_NOT_FOUND', message: '没有这个词库文件' }
      }

      const spec = allowed.get(name)
      const path = join(dataDir, spec.file ?? name)
      let stat
      try {
        stat = statSync(path)
      } catch {
        return { ok: false, code: 'E_DICT_MISSING', message: '词库未就绪，请先运行数据构建脚本' }
      }
      if (!stat.isFile()) {
        return { ok: false, code: 'E_DICT_MISSING', message: '词库未就绪，请先运行数据构建脚本' }
      }
      if (stat.size > maxBytesPerFile) {
        return { ok: false, code: 'E_TOO_LARGE', message: '词库文件超出允许的大小上限' }
      }

      const hit = cache.get(name)
      if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) {
        return { ok: true, ...hit }
      }

      const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
      const fresh = { path, size: stat.size, mtimeMs: stat.mtimeMs, etag }
      cache.set(name, fresh)
      return { ok: true, ...fresh }
    },

    invalidate(name) {
      if (typeof name === 'string') cache.delete(name)
      else cache.clear()
      logger.info?.(`[dsh-hover-dict] 词库缓存已失效${name ? `（${name}）` : ''}`)
    },
  }
}

/**
 * 造 HTTP handler。
 *
 * 路由形状（prefix 挂载在 API_PREFIX 上，内部按 method + 尾段分派）：
 *
 *   GET  /api/dsh-hover-dict/dict.dat    → Record<string, Entry> JSON
 *   GET  /api/dsh-hover-dict/meta.json   → DictMeta JSON
 *   GET  /api/dsh-hover-dict/health      → { ok: true, entries, bytes }
 *
 * @param {object} options
 * @param {{ resolve: Function, invalidate: Function }} options.assets
 * @param {HoverDictConfig} options.config
 * @param {{ warn: Function, error?: Function }} [options.logger]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createHandler(options) {
  const { assets, config } = options
  /** 可选的 llm 服务，用来做句子翻译。取不到时翻译接口返回明确提示。 */
  const llm = options.llm
  /** 词库目录，用于扫描 data/packs/ 下的额外词库包。
   *  没传就退回包内 data/ —— 传空字符串会让词库包静默失效。 */
  const dataDir = options.dataDir || DEFAULT_DATA_DIR
  const logger = options.logger ?? SILENT_LOGGER
  const enabled = config?.enabled !== false

  /**
   * gzip 结果按 ETag 缓存。词库 3 MB 压一次约 40 ms，
   * 每个请求重压是不可接受的，但缓存整份压缩结果只有 1.4 MB。
   * @type {Map<string, Buffer>}
   */
  const gzipCache = new Map()

  return async function handle(req, res) {
    try {
      const method = req.method ?? 'GET'
      // translate 是唯一的写操作，其余一律只读。
      // 先把路径解析出来再判方法，否则 POST /translate 会在方法闸门就被 405 挡掉。
      const url0 = new URL(req.url ?? '/', 'http://localhost')
      const rawTail0 = url0.pathname.startsWith(API_PREFIX)
        ? url0.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
        : ''
      const isTranslate = rawTail0 === 'translate'

      if (method !== 'GET' && method !== 'HEAD') {
        if (!(isTranslate && method === 'POST')) {
          res.setHeader('allow', 'GET, HEAD')
          return sendError(res, 405, 'E_METHOD', '只支持 GET 与 HEAD', false)
        }
      }
      if (isTranslate && (method === 'GET' || method === 'HEAD')) {
        res.setHeader('allow', 'POST')
        return sendError(res, 405, 'E_METHOD', '翻译接口只接受 POST', method === 'HEAD')
      }

      // 先按 URL 解析路径，再对尾段单独 decode。
      // 对整条 url 做 decodeURIComponent 会把 %2F 解成 /，凭空造出路径分隔符。
      const url = new URL(req.url ?? '/', 'http://localhost')
      const rawTail = url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length)
        : ''
      let tail
      try {
        tail = decodeURIComponent(rawTail.replace(/^\/+/, ''))
      } catch {
        return sendError(res, 404, 'E_NOT_FOUND', '没有这个词库文件', method === 'HEAD')
      }

      // 翻译：用宿主的 llm 服务直接调模型。
      //
      // 为什么不用 @deepseek-ai/dsh-experimental-translator：那个 bundle 默认关闭，
      // 用户没开就没法翻译。而 llm 是宿主必然挂载的核心服务，用它更可靠。
      if (tail === 'translate' && method === 'POST') {
        return handleTranslate(req, res, llm)
      }

      if (tail === 'health') {
        const meta = readMeta(assets)
        return sendJson(res, 200, {
          ok: true,
          enabled,
          entries: meta?.entries ?? 0,
          examples: meta?.examples ?? 0,
        }, method === 'HEAD')
      }

      if (!enabled) {
        return sendError(res, 404, 'E_DISABLED', '悬停查词已关闭', method === 'HEAD')
      }

      const whitelist = availableAssets(dataDir)
      const resolved = assets.resolve(tail, whitelist)
      if (!resolved.ok) {
        const status = resolved.code === 'E_NOT_FOUND' ? 404 : 503
        return sendError(res, status, resolved.code, resolved.message, method === 'HEAD')
      }

      const asset = whitelist.get(tail)
      let body
      try {
        body = readFileSync(resolved.path)
      } catch (error) {
        logger.warn?.(`[dsh-hover-dict] 读取 ${tail} 失败：${error?.message ?? error}`)
        return sendError(res, 503, 'E_DICT_MISSING', '词库读取失败，请重新构建数据', method === 'HEAD')
      }

      const acceptEncoding = String(req.headers['accept-encoding'] ?? '')
      const wantsGzip = asset.gzip && body.length >= GZIP_MIN_BYTES && /\bgzip\b/.test(acceptEncoding)

      if (wantsGzip) {
        let compressed = gzipCache.get(resolved.etag)
        if (compressed === undefined) {
          compressed = gzipSync(body)
          gzipCache.set(resolved.etag, compressed)
          // 只留最近一份：数据变了旧的那份不可能再被命中
          if (gzipCache.size > 2) {
            for (const key of gzipCache.keys()) {
              if (key !== resolved.etag) gzipCache.delete(key)
            }
          }
        }
        body = compressed
      }

      const etag = wantsGzip ? `${resolved.etag.slice(0, -1)}-gz"` : resolved.etag
      const ifNoneMatch = String(req.headers['if-none-match'] ?? '')
      if (ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
        res.statusCode = 304
        res.setHeader('etag', etag)
        res.setHeader('vary', 'accept-encoding')
        res.setHeader('cache-control', 'private, max-age=0, must-revalidate')
        res.end()
        return
      }

      res.statusCode = 200
      res.setHeader('content-type', asset.contentType)
      res.setHeader('content-length', String(body.length))
      res.setHeader('etag', etag)
      res.setHeader('vary', 'accept-encoding')
      // 不用 immutable：用户会自己重跑数据脚本，缓存必须能失效
      res.setHeader('cache-control', 'private, max-age=0, must-revalidate')
      res.setHeader('x-content-type-options', 'nosniff')
      if (wantsGzip) res.setHeader('content-encoding', 'gzip')

      if (method === 'HEAD') res.end()
      else res.end(body)
    } catch (error) {
      logger.error?.(`[dsh-hover-dict] 处理请求失败：${error?.message ?? error}`)
      // 不回显磁盘路径与堆栈
      if (!res.headersSent) sendError(res, 500, 'E_INTERNAL', '服务内部错误', false)
      else res.end()
    }
  }
}

/**
 * 处理句子翻译。
 *
 * 走宿主的 `llm.stream()`：它是核心服务，不像 translator 那样需要额外开 bundle。
 *
 * 请求体：{ text: string, target?: string }
 * 响应体：{ ok: true, text: '<译文>' } 或 { ok: false, error: { code, message } }
 */
async function handleTranslate(req, res, llm) {
  const body = await readJsonBody(req)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (text === '') {
    return sendError(res, 400, 'E_EMPTY_TEXT', '没有要翻译的内容', false)
  }
  if (text.length > 1200) {
    return sendError(res, 400, 'E_TOO_LONG', '这段话太长了，请分几次选', false)
  }

  if (!llm || typeof llm.stream !== 'function') {
    return sendError(res, 503, 'E_NO_LLM',
      '宿主没有提供 llm 服务，翻译不可用（查词不受影响）', false)
  }

  // 用宿主当前选定的模型。resolveModelInfo 不可用时退到 deepseek 默认。
  let provider = 'deepseek'
  let model = 'deepseek-chat'
  try {
    const info = await resolveDefaultTarget(llm)
    if (info) { provider = info.provider; model = info.model }
  } catch { /* 用兜底值 */ }

  const prompt = [
    '把下面的英文翻译成简体中文。',
    '只输出译文，不要解释、不要加引号、不要保留原文。',
    '保留原有的换行与标点结构。',
    '',
    text,
  ].join('\n')

  let translated = ''
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0,
      maxTokens: 1024,
    })) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        translated += chunk.text
      }
      if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new Error(chunk.reason.failure?.message ?? '模型返回错误')
      }
    }
  } catch (error) {
    return sendError(res, 502, 'E_TRANSLATE_FAILED',
      `翻译失败：${error?.message ?? error}`, false)
  }

  const clean = translated.trim()
  if (clean === '') {
    return sendError(res, 502, 'E_TRANSLATE_EMPTY', '模型没有返回译文', false)
  }
  return sendJson(res, 200, { ok: true, text: clean }, false)
}

/**
 * 找一个能用的 provider/model。
 *
 * 优先用宿主已注册的 provider 列表里的第一个，拿不到就用 deepseek 兜底。
 */
async function resolveDefaultTarget(llm) {
  try {
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    if (Array.isArray(providers) && providers.length > 0) {
      const first = providers[0]
      const id = first?.id ?? first?.provider
      if (typeof id === 'string' && id !== '') {
        const models = await llm.listModels(id)
        if (Array.isArray(models) && models.length > 0 && typeof models[0]?.id === 'string') {
          return { provider: id, model: models[0].id }
        }
        return { provider: id, model: 'deepseek-chat' }
      }
    }
  } catch { /* 落到兜底 */ }
  return null
}

/** 读请求体 JSON。体积上限 256 KB。 */
function readJsonBody(req) {
  return new Promise((done) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) { done(null); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        done(null)
      }
    })
    req.on('error', () => done(null))
  })
}

/** 读 meta.json 里的词条数，用于 health。读不到就返回 undefined，不要抛。 */
function readMeta(assets) {
  try {
    const resolved = assets.resolve('meta.json')
    if (!resolved.ok) return undefined
    return JSON.parse(readFileSync(resolved.path, 'utf8'))
  } catch {
    return undefined
  }
}

/** 统一失败响应。形状固定，客户端只认这个。 */
function sendError(res, status, code, message, headOnly) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const payload = Buffer.from(JSON.stringify({ ok: false, error: { code, message } }))
  res.setHeader('content-length', String(payload.length))
  if (headOnly) res.end()
  else res.end(payload)
}

/** 统一成功响应。 */
function sendJson(res, status, value, headOnly) {
  const payload = Buffer.from(JSON.stringify(value))
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', String(payload.length))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (headOnly) res.end()
  else res.end(payload)
}
