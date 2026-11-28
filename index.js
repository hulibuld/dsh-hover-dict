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


import { randomUUID } from 'node:crypto'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
    // 只认 .dat（JSON）与 .csv（ECDICT 格式）。
    // 名字必须是纯字母数字与连字符，挡掉 ../ 与奇怪字符。
    const isDat = /^[a-z0-9][a-z0-9-]*\.dat$/.test(name)
    const isCsv = /^[a-z0-9][a-z0-9-]*\.csv$/.test(name)
    if (!isDat && !isCsv) continue
    // CSV 要现转 JSON，走单独的处理器，所以这里标记出来
    out.set(name, {
      file: `packs/${name}`,
      contentType: isDat ? 'application/json; charset=utf-8' : 'application/json; charset=utf-8',
      gzip: true,
      csv: isCsv,
    })
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
    // 登录会话管理器在装配阶段就建好，这样插件卸载时能把还开着的浏览器窗口一起关掉。
    // 建它不碰 IO：真浏览器要到 start 才起。
    const youdaoLogin = createYoudaoLoginManager({ logger: SILENT_LOGGER })
    const handler = createHandler({
      assets,
      llm,
      dataDir,
      config: { ...resolved, enabled },
      logger: SILENT_LOGGER,
      youdaoLogin,
    })

    // 注册即 effect：插件卸载时 disposer 撤掉路由，不泄漏。
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler,
    })
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        try { dispose() } catch { /* ignore */ }
        // 别把用户的有道登录窗口留在屏幕上
        void youdaoLogin.disposeAll().catch(() => {})
      }, 'dsh-hover-dict: /api/dsh-hover-dict 路由与登录会话')
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

  /** 有道 Cookie 存储：内存 + dataDir/youdao-cookie.json（0o600）。 */
  const youdaoStore = options.youdaoStore ?? createYoudaoStore(dataDir, logger)

  /**
   * 外网 fetch。设计 §D2 要求可注入（`youdaoFetch`），
   * 这样宿主测试能用 mock 跑分页与降级，不依赖外网。
   */
  const youdaoFetch = typeof options.youdaoFetch === 'function'
    ? options.youdaoFetch
    : (...args) => globalThis.fetch(...args)

  /** 每页间隔可注入，测试把它调 0 才跑得快；线上固定 ≥400ms。 */
  const youdaoGapMs = Number.isFinite(options.youdaoGapMs)
    ? Math.max(0, Math.min(options.youdaoGapMs, YOUDAO_PAGE_GAP_MS))
    : YOUDAO_PAGE_GAP_MS

  /**
   * 有道「浏览器登录」会话表：一次性、10 分钟过期、只活在内存里。
   * 测试可以注入 `youdaoLogin` 换成假实现，完全不依赖 puppeteer 与 GUI。
   */
  const youdaoLogin = options.youdaoLogin ?? createYoudaoLoginManager({
    logger,
    ...(options.youdaoLoginBrowser !== undefined ? { browser: options.youdaoLoginBrowser } : {}),
  })

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

      // 每个尾段允许的方法。不在表里的一律只读（GET/HEAD）。
      const WRITE_ROUTES = {
        translate: ['POST'],
        'youdao/cookie': ['POST', 'DELETE'],
        'youdao/sync': ['POST'],
        'youdao/login/start': ['POST'],
        'youdao/login/cancel': ['POST'],
      }
      const allowed = WRITE_ROUTES[rawTail0]

      if (allowed !== undefined) {
        if (!allowed.includes(method)) {
          // HEAD 也算只读探测：写路由不接受，但 allow 头要列全
          res.setHeader('allow', allowed.join(', '))
          const label = rawTail0 === 'translate'
            ? '翻译接口只接受 POST'
            : `该接口只接受 ${allowed.join(' 与 ')}`
          return sendError(res, 405, 'E_METHOD', label, method === 'HEAD')
        }
      } else if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD')
        return sendError(res, 405, 'E_METHOD', '只支持 GET 与 HEAD', false)
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

      // ── 有道同步四路由（设计 v2 §D2）──
      if (tail === 'youdao/cookie') {
        return handleYoudaoCookie(req, res, method, youdaoStore, youdaoFetch)
      }
      if (tail === 'youdao/status') {
        return handleYoudaoStatus(res, method, youdaoStore, youdaoFetch)
      }
      if (tail === 'youdao/sync') {
        return handleYoudaoSync(req, res, method, youdaoStore, youdaoFetch, youdaoGapMs, logger)
      }
      // ── 有道浏览器登录会话（点登录 → 开可见窗口 → 自动取 Cookie）──
      if (tail === 'youdao/login/start') {
        return handleYoudaoLoginStart(res, method, youdaoLogin)
      }
      if (tail === 'youdao/login/poll') {
        return handleYoudaoLoginPoll(res, method, url, youdaoLogin, youdaoStore, youdaoFetch)
      }
      if (tail === 'youdao/login/cancel') {
        return handleYoudaoLoginCancel(req, res, method, youdaoLogin)
      }

      if (tail === 'health') {
        const meta = readMeta(assets)
        return sendJson(res, 200, {
          ok: true,
          enabled,
          entries: meta?.entries ?? 0,
          examples: meta?.examples ?? 0,
          // 前端要显示「把文件放这里」，只有宿主知道真实路径
          packsDir: join(dataDir, 'packs'),
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
        // CSV 词库现转成 JSON。转换结果按 mtime 缓存，不要每次请求都转。
        body = asset?.csv
          ? csvPackToJson(resolved.path, resolved.mtimeMs)
          : readFileSync(resolved.path)
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

  // 依次尝试宿主注册的每个 provider 及其模型，第一个能出结果的就用。
  //
  // 为什么不能写死一个：宿主的 provider 由用户装的通道决定（raccoon / buddy /
  // codearts…），写死 'deepseek' 会拿一个无效 key 去请求，报
  // 「api key: ****c80e is invalid」。也不能只取第一个 —— 第一个往往不是
  // 当前在用的那个通道。
  const targets = await listTranslateTargets(llm)
  if (targets.length === 0) {
    return sendError(res, 503, 'E_NO_MODEL',
      '宿主没有可用的模型通道，无法翻译（查词不受影响）', false)
  }

  const prompt = [
    '把下面的英文翻译成简体中文。',
    '只输出译文，不要解释、不要加引号、不要保留原文。',
    '保留原有的换行与标点结构。',
    '',
    text,
  ].join('\n')

  let translated = ''
  const failures = []
  for (const target of targets) {
    let acc = ''
    try {
      for await (const chunk of llm.stream({
        provider: target.provider,
        model: target.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0,
        maxTokens: 1024,
      })) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          acc += chunk.text
        }
        if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
          throw new Error(chunk.reason.failure?.message ?? '模型返回错误')
        }
      }
      if (acc.trim() !== '') {
        translated = acc
        break
      }
      failures.push(`${target.provider}/${target.model}：没有输出`)
    } catch (error) {
      failures.push(`${target.provider}/${target.model}：${error?.message ?? error}`)
    }
  }

  if (translated.trim() === '') {
    return sendError(res, 502, 'E_TRANSLATE_FAILED',
      `翻译失败。试过的通道：${failures.slice(0, 3).join('；')}`, false)
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
/**
 * 列出所有可尝试的 provider + model 组合。
 *
 * 顺序就是让列表顺序，不做挑选 —— 翻译这种短任务谁先出结果用谁，
 * 挑错反而会拿到一个没配好 key 的通道。
 *
 * @param {object} llm
 * @returns {Promise<Array<{ provider: string, model: string }>>}
 */
async function listTranslateTargets(llm) {
  const out = []
  try {
    const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    for (const item of Array.isArray(providers) ? providers : []) {
      const id = item?.id ?? item?.provider
      if (typeof id !== 'string' || id === '') continue
      let models = []
      try {
        models = await llm.listModels(id)
      } catch { models = [] }
      if (Array.isArray(models)) {
        for (const model of models) {
          if (typeof model?.id === 'string' && model.id !== '') {
            out.push({ provider: id, model: model.id })
          }
        }
      }
    }
  } catch { /* 拿不到就返回空，上层给明确提示 */ }
  return out
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

/**
 * 把 ECDICT 格式的 CSV 转成与 dict.dat 同构的 JSON。
 *
 * 只取四个字段：word / translation / definition / tag。
 * 其他字段（音标、audio、detail）本插件不用，转过来只是浪费体积。
 *
 * 结果按文件 mtime 缓存：一个几万行的 CSV 转一次要几百毫秒，
 * 每次请求都转是不可接受的。
 *
 * @type {Map<string, { mtimeMs: number, body: Buffer }>}
 */
const CSV_CACHE = new Map()

function csvPackToJson(path, mtimeMs) {
  const hit = CSV_CACHE.get(path)
  if (hit !== undefined && hit.mtimeMs === mtimeMs) return hit.body

  const text = readFileSync(path, 'utf8')
  const rows = parseCsvRows(text)
  if (rows.length === 0) return Buffer.from('{}')

  const header = rows[0].map((name) => name.trim())
  const at = (name) => header.indexOf(name)
  const iWord = at('word')
  const iTrans = at('translation')
  const iDef = at('definition')
  const iTag = at('tag')
  if (iWord < 0 || iTrans < 0) {
    throw new Error('CSV 缺少 word 或 translation 列')
  }

  const out = Object.create(null)
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    const word = String(row[iWord] ?? '').trim().toLowerCase()
    if (word === '' || /\s/.test(word)) continue
    if (!/^[a-z][a-z'-]*$/.test(word)) continue
    const translation = String(row[iTrans] ?? '').trim()
    if (translation === '') continue

    // 义项按换行拆，每行形如 `n. 算法`
    const senses = []
    for (const line of translation.split(/\\n|\n/)) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const hit2 = /^([A-Za-z]{1,8})\.\s*(.*)$/.exec(trimmed)
      const pos = hit2 ? `${hit2[1]}.` : ''
      const zh = (hit2 ? hit2[2] : trimmed)
        .split(/[,，;；]/)
        .map((x) => x.trim())
        .filter(Boolean)
      if (zh.length === 0) continue
      senses.push(pos === '' ? [pos, zh] : [pos, zh])
    }
    if (senses.length === 0) continue

    const tags = iTag >= 0 ? String(row[iTag] ?? '').trim() : ''
    const def = iDef >= 0 ? String(row[iDef] ?? '').trim() : ''
    const entry = [senses, tags === '' ? null : tags.replace(/\s+/g, ' '), 0, 0, 0]
    if (def !== '') entry.push([[null, def]])
    out[word] = entry
  }

  const body = Buffer.from(JSON.stringify(out))
  CSV_CACHE.set(path, { mtimeMs, body })
  // 只留最近两份，数据目录换了才会累积
  if (CSV_CACHE.size > 4) {
    const oldest = [...CSV_CACHE.keys()].slice(0, CSV_CACHE.size - 4)
    for (const key of oldest) CSV_CACHE.delete(key)
  }
  return body
}

/** 极简 CSV 解析：支持引号包裹与双引号转义。 */
function parseCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1 } else { quoted = false }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// 有道收藏夹抓取（设计 v2 §D2）
//
// 方案定死：宿主侧代理 + 用户粘贴 Cookie，不做账号密码登录。
// Cookie 只活在宿主内存与 dataDir/youdao-cookie.json（0o600），
// 不进 Config、不进 localStorage、不回显给前端。
// ─────────────────────────────────────────────────────────────────────────────

/** Cookie 落盘文件名。加进 .gitignore / .npmignore，发包不带用户凭据。 */
const YOUDAO_COOKIE_FILE = 'youdao-cookie.json'

/** 单次外网请求超时，设计 §D2 定 15s。 */
const YOUDAO_TIMEOUT_MS = 15000

/** 翻页间隔下限：设计 §D2 要求每页 ≥400ms，别把有道打疼。 */
const YOUDAO_PAGE_GAP_MS = 400

/** 单页条数上限（设计定 limit≤100）。 */
const YOUDAO_PAGE_LIMIT = 100

/** 总页数上限：100×200 = 2 万词封顶（设计定总页≤200）。 */
const YOUDAO_MAX_PAGES = 200

/** 有道那边认 UA，没 UA 会拿到 SPA 空壳之外的东西。 */
const YOUDAO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** 身份验证端点。未登录返回 `{"msg":"NO_LOGIN","code":2035}`（2026-11 实测）。 */
const YOUDAO_ACCOUNT_URL = 'https://dict.youdao.com/login/acc/query/accountinfo'

/**
 * 新版网页生词本 API。
 *
 * 2026-11 实测形态：无 Cookie → HTTP 200 + `{"code":401,"msg":"用户未登录","data":null}`。
 * 所以**先看 body.code，别看 HTTP 状态码** —— 它永远 200。
 */
function youdaoApiUrl(offset, limit) {
  return `https://dict.youdao.com/wordbook/webapi/v2/word/list?limit=${limit}&offset=${offset}`
}

/** 旧版生词本 HTML 页（降级路径）。 */
function youdaoHtmlUrl(page, itemPerPage = 15) {
  return `https://dict.youdao.com/wordbook/wordlist?p=${page}&itemPerPage=${itemPerPage}`
}

/** 睡一会儿。限速用，测试里 mock fetch 时同样生效（400ms×页数，测试取小页数）。 */
function sleep(ms) {
  return new Promise((done) => { setTimeout(done, ms) })
}

/**
 * 造一个 Cookie 存储：内存 + dataDir/youdao-cookie.json（0o600）。
 *
 * 读盘惰性：apply 是同步装配阶段，不能在里面 await IO。
 * 写盘固定 chmod 0o600 —— writeFileSync 的 mode 只在**新建**时生效，
 * 文件已存在（比如上次崩溃留下 0644）时必须再 chmod 一次。
 *
 * 落盘内容：{ cookie, savedAt, nickname, lastSyncAt, lastCount }。
 * 任何路径都不把 cookie 明文回给前端。
 */
export function createYoudaoStore(dataDir, logger = SILENT_LOGGER) {
  const path = join(dataDir, YOUDAO_COOKIE_FILE)
  /** @type {{ cookie: string, savedAt: number, nickname: string, lastSyncAt: number, lastCount: number } | null} */
  let cache = null

  const empty = () => ({ cookie: '', savedAt: 0, nickname: '', lastSyncAt: 0, lastCount: 0 })

  function normalize(raw) {
    const base = empty()
    if (!raw || typeof raw !== 'object') return base
    return {
      cookie: typeof raw.cookie === 'string' ? raw.cookie : '',
      savedAt: Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
      nickname: typeof raw.nickname === 'string' ? raw.nickname : '',
      lastSyncAt: Number.isFinite(raw.lastSyncAt) ? raw.lastSyncAt : 0,
      lastCount: Number.isFinite(raw.lastCount) ? raw.lastCount : 0,
    }
  }

  function load() {
    if (cache !== null) return cache
    try {
      cache = normalize(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // 没文件、坏 JSON 都当「没配过」，不当错误：用户第一次用就是这状态
      cache = empty()
    }
    return cache
  }

  function persist(next) {
    cache = next
    try {
      writeFileSync(path, JSON.stringify({
        cookie: next.cookie,
        savedAt: next.savedAt,
        nickname: next.nickname,
        lastSyncAt: next.lastSyncAt,
        lastCount: next.lastCount,
      }), { mode: 0o600 })
      // 文件已存在时 mode 不生效，显式再设一次；Windows 上 chmod 是空操作，包在 try 里
      try { chmodSync(path, 0o600) } catch { /* ignore */ }
    } catch (error) {
      logger.warn?.(`[dsh-hover-dict] 有道 Cookie 落盘失败：${error?.message ?? error}`)
    }
    return next
  }

  return {
    path,
    read: () => ({ ...load() }),
    hasCookie: () => load().cookie !== '',
    /** 存 Cookie（顺带记住验证到的昵称）。 */
    save(cookie, nickname) {
      const prev = load()
      return { ...persist({
        cookie,
        savedAt: Date.now(),
        nickname: typeof nickname === 'string' ? nickname : '',
        lastSyncAt: prev.lastSyncAt,
        lastCount: prev.lastCount,
      }) }
    },
    setNickname(nickname) {
      const prev = load()
      if (prev.cookie === '') return { ...prev }
      return { ...persist({ ...prev, nickname: typeof nickname === 'string' ? nickname : prev.nickname }) }
    },
    /** 同步成功后记一笔，status 要用。 */
    markSync(count) {
      const prev = load()
      if (prev.cookie === '') return { ...prev }
      return { ...persist({ ...prev, lastSyncAt: Date.now(), lastCount: Number.isFinite(count) ? count : 0 }) }
    },
    /** 清 Cookie。文件一起删，别留一份还能用的凭据在盘上。 */
    clear() {
      cache = empty()
      try { unlinkSync(path) } catch { /* 本来就没有 */ }
      return { ...cache }
    },
  }
}

/**
 * POST /youdao/cookie —— 存 Cookie 并当场验证。
 * DELETE /youdao/cookie —— 清除。
 *
 * 响应里**永远不带 cookie 明文**，只报 valid / nickname。
 */
async function handleYoudaoCookie(req, res, method, store, fetchImpl) {
  if (method === 'DELETE') {
    store.clear()
    return sendJson(res, 200, { ok: true }, false)
  }
  if (method !== 'POST') {
    return sendError(res, 405, 'E_METHOD', '该接口只接受 POST 与 DELETE', false)
  }

  const body = await readJsonBody(req)
  const raw = typeof body?.cookie === 'string' ? body.cookie.trim() : ''
  if (raw === '') {
    return sendError(res, 400, 'E_EMPTY_COOKIE', '没有收到 Cookie，请把浏览器里复制的整段贴进来', false)
  }
  // 只做形状校验：必须在头里能拼出 `k=v`，否则是无意义输入
  if (!/=/.test(raw)) {
    return sendError(res, 400, 'E_BAD_COOKIE',
      '这段不像 Cookie（应形如 name=value; name2=value2），请复制 Request Headers 里 Cookie 那一整行', false)
  }
  const cookie = raw.length > 8000 ? raw.slice(0, 8000) : raw

  let verdict
  try {
    verdict = await verifyYoudaoCookie(fetchImpl, cookie)
  } catch (error) {
    // 网络错不是「Cookie 无效」：存下来让用户重试验证，错误如实报
    store.save(cookie, '')
    return sendError(res, 502, error?.code ?? 'E_YOUDAO_NETWORK',
      error?.message ?? '验证时连不上有道，Cookie 已暂存，稍后可重试', false)
  }

  if (!verdict.valid) {
    // 无效就不落盘：留着也没用，还会让人以为已经配好了
    return sendJson(res, 200, {
      ok: true,
      valid: false,
      message: 'Cookie 无效或已过期，请重新在浏览器里复制一次',
    }, false)
  }

  const saved = store.save(cookie, verdict.nickname)
  return sendJson(res, 200, {
    ok: true,
    valid: true,
    ...(saved.nickname !== '' ? { nickname: saved.nickname } : {}),
  }, false)
}

/**
 * GET /youdao/status —— 只报状态，**不报 cookie 明文**。
 *
 * 带 Cookie 时顺手验一次（便宜：accountinfo 一个请求）。
 * 验证失败但网络错的，hasCookie 仍为 true，valid=false 并带 reason，
 * 让前端能区分「没配」与「配了但连不上」。
 */
async function handleYoudaoStatus(res, method, store, fetchImpl) {
  const state = store.read()
  const hasCookie = state.cookie !== ''
  let valid = false
  let nickname = state.nickname
  let reason = ''

  if (hasCookie) {
    try {
      const verdict = await verifyYoudaoCookie(fetchImpl, state.cookie)
      valid = verdict.valid
      reason = verdict.reason
      if (verdict.nickname !== '') {
        nickname = verdict.nickname
        store.setNickname(verdict.nickname)
      }
    } catch (error) {
      // 网络错 ≠ Cookie 无效：hasCookie 仍 true，reason 带上具体码让前端区分
      valid = false
      reason = typeof error?.code === 'string' ? error.code : 'network'
    }
  } else {
    reason = 'no-cookie'
  }

  return sendJson(res, 200, {
    ok: true,
    hasCookie,
    valid,
    ...(nickname !== '' ? { nickname } : {}),
    lastSyncAt: state.lastSyncAt,
    lastCount: state.lastCount,
    ...(reason !== '' ? { reason } : {}),
  }, method === 'HEAD')
}

/**
 * POST /youdao/sync —— 抓收藏夹，返回词表 + glosses 给前端。
 *
 * 前端拿到后自己调 `wordbook.importMany(words, 'youdao', {bookId, glosses})`：
 * 生词本是浏览器 localStorage/KV 里的东西，宿主不碰，也就不会有「两边各存一份」。
 *
 * 响应：{ ok:true, added:number, dup:number, total:number, words:string[], glosses:{}, endpoint, pages }
 *   added/dup 在这里只能报 0（不知道浏览器里已有的），前端 importMany 后自行改写数字。
 */
async function handleYoudaoSync(req, res, method, store, fetchImpl, gapMs, logger) {
  const state = store.read()
  if (state.cookie === '') {
    return sendError(res, 401, 'E_YOUDAO_AUTH', '还没保存有道 Cookie，请先复制并保存', false)
  }

  const body = await readJsonBody(req)
  const bookId = typeof body?.bookId === 'string' && body.bookId !== '' ? body.bookId : undefined

  let result
  try {
    result = await fetchYoudaoSaved(fetchImpl, state.cookie, { gapMs })
  } catch (error) {
    const code = error?.code ?? 'E_YOUDAO_FAILED'
    const status = code === 'E_YOUDAO_AUTH' ? 401
      : code === 'E_YOUDAO_TIMEOUT' ? 504
        : code === 'E_YOUDAO_ENDPOINT' ? 502
          : code === 'E_YOUDAO_NETWORK' ? 502
            : 500
    logger.warn?.(`[dsh-hover-dict] 有道抓取失败：${code} ${error?.message ?? error}`)
    // 失效**不清 Cookie**：设计 §D3 的「Cookie 失效（红条提示重新复制）」要求
    // status 同时报 hasCookie:true + valid:false。删了就退化成「没配过」，
    // 用户看不到该看的那条提示。真正清理由用户点「清除」触发（DELETE）。
    const extra = error?.extra && typeof error.extra === 'object' ? error.extra : undefined
    return sendError(res, status, code, error?.message ?? '抓取失败', false, extra)
  }

  const words = result.words.map((item) => item.head)
  /** @type {Record<string,string>} */
  const glosses = Object.create(null)
  for (const item of result.words) {
    if (item.gloss !== '') glosses[item.head.toLowerCase()] = item.gloss
  }

  store.markSync(words.length)

  return sendJson(res, 200, {
    ok: true,
    // added/dup 由前端按自己库里已有情况算，这里给 0 之外的值会撒谎
    added: 0,
    dup: 0,
    total: words.length,
    words,
    glosses,
    endpoint: result.endpoint,
    pages: result.pages,
    ...(bookId !== undefined ? { bookId } : {}),
  }, false)
}

/** 一个带 code 的失败。路由层把它翻成 {ok:false,error:{code,message}}。 */
function youdaoError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  if (extra !== undefined) error.extra = extra
  return error
}

// ─────────────────────────────────────────────────────────────────────────────
// 有道浏览器登录会话（点「登录有道」→ 宿主起可见窗口 → 自动取 Cookie）
//
// 为什么由宿主起浏览器而不是打开用户浏览器：Cookie 必须由宿主读得到。
// 用户自己浏览器里的 Cookie 跨进程、跨域，宿主拿不到；而 puppeteer 的
// page.cookies() 能直接读。窗口是可见的（headless:false），用户在窗口里
// 正常登录，宿主轮询 URL 与 Cookie 数量判断完成。
//
// 纪律：独立 --user-data-dir（/tmp 下 mkdtemp），用完即关即删，
// 绝不碰用户主 Chrome profile，也不搬运用户 profile 里的 Cookie。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 真实登录入口。
 *
 * 2026-11 施工时无凭据探测结论：
 *   - 旧端点 `https://dict.youdao.com/login/acc/login` 已死，会跳到
 *     weibo2cidian-fail.html，不能用；
 *   - dict.youdao.com 首页点 `a.login` 触发的是一个 iframe 登录框，
 *     iframe 链是 c.youdao.com/common-login-web → passport.youdao.com；
 *   - 直接打开下面这个 URL（带 redirect_url）能渲染出登录框，登录成功后
 *     按 redirect_url 跳回 dict.youdao.com —— 这就是「登录完成」的信号。
 */
const YOUDAO_LOGIN_URL = 'https://c.youdao.com/common-login-web/index.html'
  + '?redirect_url=' + encodeURIComponent('https://dict.youdao.com/')

/** 登录会话存活上限。过期就关窗口删 profile，别留一个还能用的浏览器。 */
const YOUDAO_LOGIN_TTL_MS = 10 * 60 * 1000

/**
 * 兜底验证的启动时间。
 *
 * 正常路径是「登录成功 → 按 redirect_url 跳回 dict.youdao.com」，URL 一跳就 ready。
 * 但如果登录是在 iframe / 新标签里完成、外层 URL 一直停在 c.youdao.com，
 * 只靠 URL 就把用户卡死在 pending。所以超过这个时长后，允许拿当前 Cookie
 * 直接打 accountinfo —— 那才是「登没登录」的权威判据，不会误判。
 */
const YOUDAO_LOGIN_FALLBACK_AFTER_MS = 60 * 1000

/** 兜底验证的最小间隔，别每 2 秒 poll 都打一次有道。 */
const YOUDAO_LOGIN_FALLBACK_GAP_MS = 15 * 1000

/** 跳回 dict 域就算「离开登录页」了。 */
const YOUDAO_LOGIN_DONE_HOST = 'dict.youdao.com'

/**
 * 匿名基线页：先访它一次，把匿名态 Cookie 种进来。
 *
 * 全新 profile 上直接打登录页，dict 域一个 Cookie 都没有（实测），
 * 「Cookie 比基线多」这条判据就成了永远成立/永不成立的废判据。
 */
const YOUDAO_LOGIN_ANON_URL = 'https://dict.youdao.com/'

/** Cookie 只从有道域取，别把无关域名的 Cookie 拼进请求头。 */
const YOUDAO_COOKIE_DOMAIN_RE = /(^|\.)(youdao|163)\.com$/i

/** 候选 Chrome 可执行文件：macOS / Linux / Windows 常见的几处。 */
function chromeCandidates() {
  const fromEnv = typeof process.env.DSH_CHROME_PATH === 'string' && process.env.DSH_CHROME_PATH.trim() !== ''
    ? [process.env.DSH_CHROME_PATH.trim()]
    : []
  if (process.platform === 'darwin') {
    return [
      ...fromEnv,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ]
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? 'C:\\Users\\Public'
    return [
      ...fromEnv,
      join(base, 'Google/Chrome/Application/chrome.exe'),
      join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    ]
  }
  return [
    ...fromEnv,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
}

/** puppeteer-core 的候选位置：宿主 profile 里那份优先（本机已实测可用）。 */
function puppeteerCoreCandidates() {
  const fromEnv = typeof process.env.DSH_PUPPETEER_CORE === 'string' && process.env.DSH_PUPPETEER_CORE.trim() !== ''
    ? [process.env.DSH_PUPPETEER_CORE.trim()]
    : []
  return [
    ...fromEnv,
    join(homedir(), '.dsh/profiles/desktop/node_modules/puppeteer-core'),
    'puppeteer-core',
  ]
}

/**
 * 把一个 puppeteer-core 候选解析成能 import 的入口。
 *
 * 不能直接 `import(pathToFileURL(dir))` —— 那是目录 URL，ESM 不做目录解析，
 * 只会报「没有 puppeteer-core」。要读 package.json 的 exports/main 拿真正的文件。
 *
 * @returns {string | null} 入口的 import specifier；解析不出来返回 null
 */
function resolvePuppeteerEntry(candidate) {
  if (!isAbsolute(candidate)) return candidate // 交给 Node 的裸模块解析（装了依赖的环境）
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(candidate, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const exported = pkg?.exports?.['.']
  const entry = (typeof exported === 'string' ? exported : exported?.import ?? exported?.require)
    ?? pkg?.main
    ?? 'index.js'
  const path = join(candidate, entry)
  return existsSync(path) ? pathToFileURL(path).href : null
}

/**
 * 起一个真的可见 Chrome，打开有道登录页。
 *
 * 返回一个最小契约，测试可以完全照这个形状造假的：
 *   { profileDir, pageUrl(), readCookies(), close() }
 *
 * @returns {Promise<{ profileDir: string, pageUrl: () => string, readCookies: () => Promise<Array<{name:string,value:string,domain:string}>>, close: () => Promise<void> }>}
 */
export async function launchYoudaoLoginBrowser(options = {}) {
  const loginUrl = options.loginUrl ?? YOUDAO_LOGIN_URL
  const executablePath = options.executablePath
    ?? chromeCandidates().find((path) => existsSync(path))
  if (typeof executablePath !== 'string' || executablePath === '' || !existsSync(executablePath)) {
    throw youdaoError('E_NO_BROWSER',
      '找不到 Chrome（或 Edge/Chromium），自动登录不可用。请改装 Chrome，或用手动粘贴 Cookie')
  }

  let puppeteer
  for (const candidate of puppeteerCoreCandidates()) {
    try {
      const spec = resolvePuppeteerEntry(candidate)
      if (spec === null) continue
      puppeteer = await import(spec)
      if (typeof puppeteer?.launch === 'function') break
      puppeteer = null
    } catch { /* 试下一个 */ }
  }
  if (!puppeteer || typeof puppeteer.launch !== 'function') {
    throw youdaoError('E_NO_BROWSER',
      '宿主环境里没有 puppeteer-core，自动登录不可用。请用手动粘贴 Cookie')
  }

  // 独立 profile：绝不碰用户主 Chrome 的数据目录
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-hover-dict-login-'))
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      userDataDir: profileDir,
      defaultViewport: null,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
  } catch (error) {
    rmSync(profileDir, { recursive: true, force: true })
    throw youdaoError('E_NO_BROWSER',
      `起浏览器失败：${error?.message ?? error}。请用手动粘贴 Cookie`)
  }

  let page
  try {
    // 复用启动时那个 about:blank 标签，别在用户屏幕上多留一个空白页
    const existing = await browser.pages()
    page = Array.isArray(existing) && existing.length > 0 ? existing[0] : await browser.newPage()
    // 先访一次 dict 首页：全新 profile 上直接打登录页的话，dict 域一个 Cookie
    // 都没有（实测），前端「等待中」只能显示 0 个 Cookie，看不出进展。
    try {
      await page.goto(YOUDAO_LOGIN_ANON_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })
    } catch { /* 拿不到就当 0，判据由 URL + accountinfo 兜底 */ }
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (error) {
    try { await browser.close() } catch { /* ignore */ }
    rmSync(profileDir, { recursive: true, force: true })
    throw youdaoError('E_NO_BROWSER',
      `打开有道登录页失败：${error?.message ?? error}。请用手动粘贴 Cookie`)
  }

  let closed = false

  /**
   * 一个常驻的 CDP 会话，用来读**全部** Cookie。
   *
   * 为什么不只用 page.cookies()：它按当前页面 URL 过滤。登录页在 c.youdao.com
   * 上时 `page.cookies()` 只回 1 个（实测），登录态 Cookie 却种在 dict.youdao.com /
   * .youdao.com 上，会整个漏掉。`Network.getAllCookies` 不受当前页限制（实测 6 个全拿到），
   * 所以优先走它；拿不到再退回 context.cookies() / page.cookies()。
   */
  let cdp = null
  async function cookieSource() {
    if (cdp === null) {
      try { cdp = await page.createCDPSession() } catch { cdp = false }
    }
    return cdp
  }

  async function readCookies() {
    let list = []
    const client = await cookieSource()
    if (client) {
      try {
        const result = await client.send('Network.getAllCookies')
        list = Array.isArray(result?.cookies) ? result.cookies : []
      } catch { list = [] }
    }
    if (list.length === 0) {
      try {
        const context = typeof browser.defaultBrowserContext === 'function'
          ? browser.defaultBrowserContext()
          : null
        list = context && typeof context.cookies === 'function'
          ? await context.cookies()
          : await page.cookies()
      } catch {
        try { list = await page.cookies() } catch { list = [] }
      }
    }
    return (Array.isArray(list) ? list : [])
      .filter((item) => YOUDAO_COOKIE_DOMAIN_RE.test(String(item?.domain ?? '').replace(/^\./, '')))
      .map((item) => ({ name: String(item.name), value: String(item.value), domain: String(item.domain) }))
  }

  return {
    profileDir,
    pageUrl: () => String(page?.url?.() ?? ''),
    /**
     * 所有页面的 URL。
     *
     * 登录可能在 iframe 里完成、也可能弹出新标签，所以判据不能只看一开始那一页：
     * 只要**任意**一页已经在 dict.youdao.com，就说明登录走完了。
     */
    async pageUrls() {
      const urls = []
      try {
        const pages = await browser.pages()
        for (const item of Array.isArray(pages) ? pages : []) {
          try { urls.push(String(item.url())) } catch { /* 页可能已关 */ }
        }
      } catch { /* 拿不到就用下面那一页 */ }
      if (urls.length === 0) urls.push(String(page?.url?.() ?? ''))
      return urls
    },
    readCookies,
    close: async () => {
      if (closed) return
      closed = true
      if (cdp) { try { await cdp.detach() } catch { /* ignore */ } cdp = null }
      try { await browser.close() } catch { /* 用户可能自己关了窗口 */ }
      rmSync(profileDir, { recursive: true, force: true })
    },
  }
}

/** 把 cookies 拼成请求头里那一行。 */
export function cookiesToHeader(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((item) => typeof item?.name === 'string' && item.name !== '')
    .map((item) => `${item.name}=${item.value}`)
    .join('; ')
}

/**
 * 登录会话管理器。会话一次性、10 分钟过期、只活在内存里。
 *
 * @param {object} [options]
 * @param {{ launch?: Function }} [options.browser] 浏览器工厂（测试注入假实现）
 * @param {() => number} [options.now] 时钟（测试用来跳过 10 分钟）
 * @param {{ warn?: Function, info?: Function }} [options.logger]
 */
export function createYoudaoLoginManager(options = {}) {
  const logger = options.logger ?? SILENT_LOGGER
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const launch = typeof options.browser?.launch === 'function'
    ? options.browser.launch
    : launchYoudaoLoginBrowser

  /** @type {Map<string, { id: string, createdAt: number, status: string, session: any, baseline: number }>} */
  const sessions = new Map()

  /** 关窗口删 profile。失败也吞掉——会话已经没用了，别因此报错。 */
  async function release(record) {
    const session = record.session
    record.session = null
    if (session && typeof session.close === 'function') {
      try { await session.close() } catch (error) {
        logger.warn?.(`[dsh-hover-dict] 关闭登录窗口失败：${error?.message ?? error}`)
      }
    }
  }

  /** 清掉过期的，顺手把取消态的老记录也带走。 */
  async function sweep() {
    const stamp = now()
    for (const [id, record] of sessions) {
      if (record.status === 'pending' && stamp - record.createdAt > YOUDAO_LOGIN_TTL_MS) {
        await release(record)
        record.status = 'expired'
      }
      // 取消/过期/成功的记录留 5 分钟供前端最后一次 poll 读到，之后丢
      if (record.status !== 'pending' && stamp - record.createdAt > YOUDAO_LOGIN_TTL_MS + 5 * 60 * 1000) {
        sessions.delete(id)
      }
    }
  }

  return {
    async start() {
      await sweep()
      const session = await launch({ loginUrl: YOUDAO_LOGIN_URL })
      // 匿名基线：只用于诊断（pending 会带回来给前端看进展），不当登录判据
      let baseline = 0
      try { baseline = (await session.readCookies()).length } catch { baseline = 0 }
      const id = randomUUID()
      sessions.set(id, { id, createdAt: now(), status: 'pending', session, baseline })
      return { sessionId: id, loginUrl: YOUDAO_LOGIN_URL }
    },

    /**
     * 看一次状态。ready 时把 Cookie 串交出去，由路由去验证/落盘，
     * 通过后再调 finish 关窗口。
     */
    async poll(id) {
      await sweep()
      const record = sessions.get(id)
      if (!record) return { status: 'not-found' }
      if (record.status === 'cancelled') return { status: 'cancelled' }
      if (record.status === 'expired') return { status: 'expired' }
      if (record.status === 'success') return { status: 'success' }

      const session = record.session
      if (!session) return { status: 'expired' }

      let cookies = []
      try { cookies = await session.readCookies() } catch { cookies = [] }
      const cookie = cookiesToHeader(cookies)
      const cookieCount = cookies.length
      const age = now() - record.createdAt

      // 判据 1（主路径）：URL 已按 redirect_url 跳回 dict.youdao.com。
      // 登录在 iframe / passport 里的中间阶段就算冒出 Cookie 也还不是登录态，
      // 所以这条不能用「Cookie 变多」代替 —— 实测匿名 Cookie 数在 5~6 之间
      // 抖动（埋点 Cookie 会自己过期重建），拿数量当门槛必然误判。
      const urls = typeof session.pageUrls === 'function'
        ? await session.pageUrls()
        : [String(session.pageUrl?.() ?? '')]
      const leftLoginPage = urls.some((raw) => {
        try { return new URL(String(raw)).hostname === YOUDAO_LOGIN_DONE_HOST } catch { return false }
      })
      if (leftLoginPage) {
        if (cookie === '') return { status: 'pending', cookieCount: 0, baseline: record.baseline }
        return { status: 'ready', cookie, cookieCount, reason: 'redirected' }
      }

      // 判据 2（兜底）：登录若在 iframe / 新标签里完成、外层 URL 一直不跳，
      // 过 60 秒就拿当前 Cookie 去验证 —— 真的登录了才 ready，不会误判。
      // 每 15 秒最多试一次，别每 2 秒 poll 都打有道。
      if (cookie !== ''
        && age >= YOUDAO_LOGIN_FALLBACK_AFTER_MS
        && (record.lastFallbackAt === undefined
          || now() - record.lastFallbackAt >= YOUDAO_LOGIN_FALLBACK_GAP_MS)) {
        record.lastFallbackAt = now()
        return { status: 'ready', cookie, cookieCount, reason: 'fallback' }
      }

      return { status: 'pending', cookieCount, baseline: record.baseline, ageMs: age }
    },

    /** 验证成功后收尾：关窗口删 profile，会话标 success（poll 再问也只报 success）。 */
    async finish(id) {
      const record = sessions.get(id)
      if (!record) return
      record.status = 'success'
      await release(record)
    },

    async cancel(id) {
      const record = sessions.get(id)
      if (!record) return false
      record.status = 'cancelled'
      await release(record)
      return true
    },

    /** 插件卸载/进程退出时把所有还开着的窗口关掉。 */
    async disposeAll() {
      for (const record of sessions.values()) await release(record)
      sessions.clear()
    },

    /** 诊断用：当前活跃会话数（测试断言「cancel 后不残留」）。 */
    size() {
      let live = 0
      for (const record of sessions.values()) if (record.status === 'pending') live += 1
      return live
    },
  }
}

/**
 * POST /youdao/login/start —— 生成会话并起可见浏览器。
 * 拿不到浏览器就报 E_NO_BROWSER，前端据此降级到手动粘贴。
 */
async function handleYoudaoLoginStart(res, method, manager) {
  if (method !== 'POST') {
    return sendError(res, 405, 'E_METHOD', '该接口只接受 POST', false)
  }
  try {
    const started = await manager.start()
    return sendJson(res, 200, {
      ok: true,
      sessionId: started.sessionId,
      loginUrl: started.loginUrl,
      ttlMs: YOUDAO_LOGIN_TTL_MS,
    }, false)
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'E_NO_BROWSER'
    return sendError(res, 503, code,
      error?.message ?? '起不了浏览器，自动登录不可用，请用手动粘贴 Cookie', false)
  }
}

/**
 * GET /youdao/login/poll?session=ID —— 轮一次状态。
 *
 * 判据（探测结论）：URL 已跳回 dict.youdao.com + Cookie 数量比匿名多。
 * 满足后提取 Cookie → accountinfo 验证 → valid 才落盘 → 关窗口删 profile。
 */
async function handleYoudaoLoginPoll(res, method, url, manager, store, fetchImpl) {
  if (method !== 'GET' && method !== 'HEAD') {
    return sendError(res, 405, 'E_METHOD', '该接口只接受 GET', false)
  }
  const id = String(url?.searchParams?.get('session') ?? '').trim()
  if (id === '') {
    return sendError(res, 400, 'E_LOGIN_NOT_FOUND', '没有会话 id', method === 'HEAD')
  }

  let state
  try {
    state = await manager.poll(id)
  } catch (error) {
    return sendError(res, 502, 'E_LOGIN_FAILED', error?.message ?? '读取登录窗口状态失败', false)
  }

  const status = state?.status ?? 'not-found'

  if (status === 'not-found') {
    return sendError(res, 404, 'E_LOGIN_NOT_FOUND', '会话不存在或已清理，请重新点「登录有道」', method === 'HEAD')
  }
  if (status === 'expired') {
    return sendError(res, 410, 'E_LOGIN_TIMEOUT',
      '登录超时了（10 分钟），窗口已关闭，请重新点「登录有道」', method === 'HEAD')
  }
  if (status === 'cancelled') {
    return sendError(res, 409, 'E_LOGIN_CANCELLED', '已取消登录', method === 'HEAD')
  }
  if (status === 'success') {
    return sendJson(res, 200, { ok: true, status: 'success' }, method === 'HEAD')
  }
  if (status !== 'ready') {
    return sendJson(res, 200, {
      ok: true,
      status: 'pending',
      cookieCount: Number.isFinite(state?.cookieCount) ? state.cookieCount : 0,
      ...(Number.isFinite(state?.ageMs) ? { ageMs: state.ageMs } : {}),
    }, method === 'HEAD')
  }

  // 拿到 Cookie 串：先验证，valid 才落盘；不 valid 继续 pending（用户可能还在跳转）
  let verdict
  try {
    verdict = await verifyYoudaoCookie(fetchImpl, state.cookie)
  } catch (error) {
    return sendJson(res, 200, {
      ok: true,
      status: 'pending',
      reason: typeof error?.code === 'string' ? error.code : 'network',
    }, method === 'HEAD')
  }
  if (!verdict.valid) {
    return sendJson(res, 200, { ok: true, status: 'pending', reason: verdict.reason }, method === 'HEAD')
  }

  const saved = store.save(state.cookie, verdict.nickname)
  await manager.finish(id)
  return sendJson(res, 200, {
    ok: true,
    status: 'success',
    valid: true,
    ...(saved.nickname !== '' ? { nickname: saved.nickname } : {}),
  }, method === 'HEAD')
}

/** POST /youdao/login/cancel —— 关窗口、删 profile、清会话。 */
async function handleYoudaoLoginCancel(req, res, method, manager) {
  if (method !== 'POST') {
    return sendError(res, 405, 'E_METHOD', '该接口只接受 POST', false)
  }
  const body = await readJsonBody(req)
  const id = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (id === '') {
    return sendError(res, 400, 'E_LOGIN_NOT_FOUND', '没有会话 id', false)
  }
  const cleaned = await manager.cancel(id)
  if (!cleaned) {
    return sendError(res, 404, 'E_LOGIN_NOT_FOUND', '会话不存在或已清理', false)
  }
  return sendJson(res, 200, { ok: true, status: 'cancelled' }, false)
}

/**
 * 发一个 GET，返回 { status, text, location }。
 *
 * 不用 `redirect: 'manual'` 判登录：URL 是 dict.youdao.com 同一域名，
 * 302 到 /login 也常见，两种都当「Cookie 失效」处理即可。
 * 超时用 AbortController，15s。
 */
async function youdaoGet(fetchImpl, url, cookie) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), YOUDAO_TIMEOUT_MS) : null
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        cookie,
        'user-agent': YOUDAO_UA,
        accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      ...(controller ? { signal: controller.signal } : {}),
    })
    const status = Number(res?.status ?? 0)
    let text = ''
    try {
      text = typeof res?.text === 'function' ? await res.text() : ''
    } catch { text = '' }
    const headers = res?.headers
    const location = typeof headers?.get === 'function' ? (headers.get('location') ?? '') : ''
    return { status, text, location }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw youdaoError('E_YOUDAO_TIMEOUT', '连有道超时了（15 秒），请检查网络后再试')
    }
    throw youdaoError('E_YOUDAO_NETWORK',
      `连不上有道：${error?.message ?? error}。若是网络问题，可改用「手动导入」`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 302/303 到登录页 = Cookie 失效。 */
function looksLikeLoginRedirect(status, location) {
  if (!(status === 301 || status === 302 || status === 303 || status === 307 || status === 308)) return false
  return /login|signin|passport|account\/login/i.test(String(location ?? ''))
}

/**
 * 从 webapi v2 的 JSON 里抠出词表。
 *
 * 有道没公开契约，字段名随版本漂：可能 `data` 是数组，也可能包一层
 * `list/words/wordList`。词头可能叫 word/head/wordHead/content。
 * 这里全部兼容，抠不出来就算空页（上层据此判「这端点不可用」）。
 *
 * @returns {Array<{ head: string, gloss: string }>}
 */
export function apiWordContainer(json) {
  const data = json?.data ?? json
  if (Array.isArray(data)) return data
  for (const key of ['list', 'words', 'wordList', 'data']) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return null
}

export function extractWordsFromApi(json) {
  const list = apiWordContainer(json) ?? []
  const out = []
  for (const item of list) {
    const rawHead = typeof item === 'string'
      ? item
      : (item?.word ?? item?.head ?? item?.wordHead ?? item?.content ?? item?.name ?? item?.wordName ?? '')
    const head = String(rawHead ?? '').trim()
    if (head === '') continue
    const rawGloss = typeof item === 'string'
      ? ''
      : (item?.trans ?? item?.translation ?? item?.definition ?? item?.explain ?? item?.paraphrase ?? '')
    const gloss = Array.isArray(rawGloss)
      ? rawGloss.map((x) => String(x ?? '').trim()).filter(Boolean).join('; ')
      : String(rawGloss ?? '').trim()
    out.push({ head, gloss: gloss.slice(0, 300) })
  }
  return out
}

/** 从旧版 HTML 里抠词头：`<td class="word">…</td>` 与 `data-word="…"`。 */
export function extractWordsFromHtml(html) {
  const out = []
  const text = String(html ?? '')
  const tdRe = /<td[^>]*class\s*=\s*["'][^"']*\bword\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi
  let hit
  while ((hit = tdRe.exec(text)) !== null) {
    const head = decodeEntities(hit[1].replace(/<[^>]*>/g, ' ')).trim()
    if (head !== '') out.push({ head, gloss: '' })
  }
  if (out.length > 0) return out
  const dataRe = /data-word\s*=\s*["']([^"']{1,64})["']/gi
  while ((hit = dataRe.exec(text)) !== null) {
    const head = decodeEntities(hit[1]).trim()
    if (head !== '') out.push({ head, gloss: '' })
  }
  return out
}

/** 极简实体解码，够 HTML 词表用。 */
function decodeEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 解析 JSON，失败返回 null。 */
function tryParseJson(text) {
  try {
    return JSON.parse(String(text ?? ''))
  } catch {
    return null
  }
}

/**
 * 验证 Cookie。
 *
 * 顺序：accountinfo（便宜，直接区分 2035 NO_LOGIN）→ webapi v2 第一页。
 * 两个都判断不了（端点挂了/网络错），按「无效」返回，让用户重新复制。
 *
 * @returns {Promise<{ valid: boolean, nickname: string, reason: string }>}
 */
export async function verifyYoudaoCookie(fetchImpl, cookie) {
  if (typeof cookie !== 'string' || cookie.trim() === '') {
    return { valid: false, nickname: '', reason: 'empty' }
  }

  // 1) accountinfo
  try {
    const res = await youdaoGet(fetchImpl, YOUDAO_ACCOUNT_URL, cookie)
    if (looksLikeLoginRedirect(res.status, res.location)) {
      return { valid: false, nickname: '', reason: 'redirect-login' }
    }
    const json = tryParseJson(res.text)
    if (json && typeof json === 'object') {
      const code = Number(json.code)
      const msg = String(json.msg ?? '')
      if (code === 2035 || code === 401 || /NO_LOGIN|未登录/i.test(msg)) {
        return { valid: false, nickname: '', reason: 'no-login' }
      }
      if (code === 0 || code === 200 || json.data) {
        const data = json.data ?? {}
        const nickname = String(
          data.nickname ?? data.userName ?? data.username ?? data.user_name ?? data.name ?? '',
        ).trim()
        return { valid: true, nickname, reason: 'accountinfo' }
      }
    }
  } catch { /* 端点不可用就往下试 webapi，别把网络错当「Cookie 无效」 */ }

  // 2) webapi v2 第一页
  try {
    const res = await youdaoGet(fetchImpl, youdaoApiUrl(0, 1), cookie)
    if (looksLikeLoginRedirect(res.status, res.location)) {
      return { valid: false, nickname: '', reason: 'redirect-login' }
    }
    const json = tryParseJson(res.text)
    if (json && typeof json === 'object') {
      const code = Number(json.code)
      const msg = String(json.msg ?? '')
      if (code === 401 || code === 2035 || /未登录|NO_LOGIN/i.test(msg)) {
        return { valid: false, nickname: '', reason: 'no-login' }
      }
      if (code === 0 || Array.isArray(json.data) || json.data) {
        return { valid: true, nickname: '', reason: 'webapi' }
      }
    }
  } catch { /* 落到下面统一按无效处理 */ }

  return { valid: false, nickname: '', reason: 'unknown' }
}

/**
 * 抓完整收藏夹。按设计顺序试端点：webapi v2 → 旧版 HTML → accountinfo 兜底判定。
 *
 * 限速每页 ≥400ms、单页 ≤100、总页 ≤200、超时 15s。
 * 401/302 登录页 → E_YOUDAO_AUTH；两个端点都抠不出词 → E_YOUDAO_ENDPOINT
 * （带 fallback:'manual'，前端据此显示「手动导入」引导，不许静默失败）。
 *
 * @returns {Promise<{ words: Array<{head: string, gloss: string}>, endpoint: string, pages: number }>}
 */
export async function fetchYoudaoSaved(fetchImpl, cookie, options = {}) {
  if (typeof cookie !== 'string' || cookie.trim() === '') {
    throw youdaoError('E_YOUDAO_AUTH', '还没保存有道 Cookie，请先复制并保存')
  }
  const gap = Number.isFinite(options.gapMs) ? options.gapMs : YOUDAO_PAGE_GAP_MS
  const limit = Math.min(
    Number.isFinite(options.limit) ? options.limit : YOUDAO_PAGE_LIMIT,
    YOUDAO_PAGE_LIMIT,
  )
  const maxPages = Math.min(
    Number.isFinite(options.maxPages) ? options.maxPages : YOUDAO_MAX_PAGES,
    YOUDAO_MAX_PAGES,
  )

  /** @type {Map<string, { head: string, gloss: string }>} 小写词头 → 原词头与释义，天然去重 */
  const collected = new Map()

  // ── 端点 1：webapi v2 ──
  let lastAt = 0
  /** false = 端点数形态不认识（该试 HTML 降级） */
  let apiUsable = true
  /** true = 端点数形态认识，只是这本真没词（不是改版，别误报） */
  let apiShapeOk = false
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * limit
    const wait = lastAt === 0 ? 0 : gap - (Date.now() - lastAt)
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()

    const res = await youdaoGet(fetchImpl, youdaoApiUrl(offset, limit), cookie)
    if (looksLikeLoginRedirect(res.status, res.location)) {
      throw youdaoError('E_YOUDAO_AUTH', 'Cookie 已失效，请重新复制')
    }
    const json = tryParseJson(res.text)
    if (!json || typeof json !== 'object') { apiUsable = false; break }
    const code = Number(json.code)
    const msg = String(json.msg ?? '')
    if (code === 401 || code === 2035 || /未登录|NO_LOGIN/i.test(msg)) {
      throw youdaoError('E_YOUDAO_AUTH', 'Cookie 已失效，请重新复制')
    }
    if (code !== 0 && code !== 200) { apiUsable = false; break }

    // 先把「形态认识」和「有没有词」分开：空数组是合法结果，null 才是改版
    const container = apiWordContainer(json)
    if (container === null) { apiUsable = false; break }
    apiShapeOk = true

    const batch = extractWordsFromApi(json)
    if (batch.length === 0) break
    for (const item of batch) {
      const key = item.head.toLowerCase()
      if (!collected.has(key)) collected.set(key, { head: item.head, gloss: item.gloss })
    }
    if (batch.length < limit) break
    const total = Number(json?.data?.total ?? json?.total ?? NaN)
    if (Number.isFinite(total) && offset + batch.length >= total) break
  }

  if (collected.size > 0) {
    return {
      words: [...collected.values()],
      endpoint: 'webapi',
      pages: Math.ceil(collected.size / limit),
    }
  }

  // ── 端点 2：旧版 HTML 词表页 ──
  let htmlPages = 0
  if (apiUsable === false) {
    const perPage = 15
    for (let page = 1; page <= maxPages; page += 1) {
      const wait = lastAt === 0 ? 0 : gap - (Date.now() - lastAt)
      if (wait > 0) await sleep(wait)
      lastAt = Date.now()

      const res = await youdaoGet(fetchImpl, youdaoHtmlUrl(page, perPage), cookie)
      if (looksLikeLoginRedirect(res.status, res.location)) {
        throw youdaoError('E_YOUDAO_AUTH', 'Cookie 已失效，请重新复制')
      }
      const batch = extractWordsFromHtml(res.text)
      if (batch.length === 0) break
      htmlPages += 1
      for (const item of batch) {
        const key = item.head.toLowerCase()
        if (!collected.has(key)) collected.set(key, { head: item.head, gloss: item.gloss })
      }
      if (batch.length < perPage) break
    }
  }

  if (collected.size > 0) {
    return {
      words: [...collected.values()],
      endpoint: 'html',
      pages: htmlPages,
    }
  }

  // ── 端点 3：身份兜底判定 ──
  const identity = await verifyYoudaoCookie(fetchImpl, cookie)
  if (!identity.valid) {
    throw youdaoError('E_YOUDAO_AUTH', 'Cookie 已失效，请重新复制')
  }
  // 身份有效 + 端点数形态认识 + 就是没词：如实返回空表（收藏夹真的空）。
  // 这不是「静默失败」—— 失败一定报错；这是成功但零结果。
  if (apiShapeOk) {
    return { words: [], endpoint: 'webapi', pages: 0 }
  }
  throw youdaoError(
    'E_YOUDAO_ENDPOINT',
    '有道生词本接口改版了，抓不到词表。请改用「手动导入」：在有道生词本页全选复制，粘贴到「导入」页签',
    { fallback: 'manual' },
  )
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

/**
 * 统一失败响应。形状固定 `{ok:false,error:{code,message}}`，客户端只认这个。
 *
 * `extra` 用来在有道降级时多带一个字段（如 `fallback:'manual'`），
 * 合并进 `error` 而不是外层，免得破坏固定形状。
 */
function sendError(res, status, code, message, headOnly, extra) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  const body = extra === undefined ? { code, message } : { code, message, ...extra }
  const payload = Buffer.from(JSON.stringify({ ok: false, error: body }))
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
