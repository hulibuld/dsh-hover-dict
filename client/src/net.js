/**
 * net.js —— 浏览器半访问宿主的唯一出口。
 *
 * 只做一件事：从 `/api/dsh-hover-dict/` 拉词库，把失败翻译成人话。
 *
 * 为什么不在浏览器里直接打包词库：3 MB 的 JSON 塞进 client.js 会让这个文件
 * 变成每次会话都要解析的负担，而且宿主已经有 HTTP 服务，走它更顺。
 * 宿主那边带 ETag 与 gzip，第二次启动基本是 304。
 */

/** 路由前缀。改这里必须同步改 index.js 里的 API_PREFIX。 */
export const API_PREFIX = '/api/dsh-hover-dict'

/** 单次请求超时。词库 3 MB，本机取毫秒级；超过 15 秒说明宿主出问题了。 */
const TIMEOUT_MS = 15000

/**
 * 错误码 → 给用户看的中文。
 *
 * 界面只显示这里的话术，绝不把原始 JSON 或字段名透到屏幕上。
 * 未列入的码走通用兜底。
 */
const ERROR_TEXT = {
  E_NOT_FOUND: '插件没有提供这个词库文件',
  E_DICT_MISSING: '词库未就绪，请先运行数据构建脚本',
  E_TOO_LARGE: '词库文件太大，宿主拒绝了',
  E_DISABLED: '悬停查词已关闭',
  E_INTERNAL: '插件内部出错了，稍后再试',
  E_NETWORK: '连不上宿主，请确认插件已启用',
  E_TIMEOUT: '读取词库超时',
  E_BAD_JSON: '词库文件损坏，请重新构建数据',
}

/**
 * 从任意异常里抽出一句人话。
 *
 * @param {unknown} error
 * @returns {string}
 */
export function humanizeError(error) {
  if (typeof error === 'string') return error
  const code = error?.code
  if (typeof code === 'string' && ERROR_TEXT[code]) return ERROR_TEXT[code]
  if (error?.name === 'AbortError') return ERROR_TEXT.E_TIMEOUT
  const message = error?.message
  if (typeof message === 'string' && message.length > 0) return message
  return '查词暂时不可用'
}

/**
 * 造一个带错误码的 Error。界面靠 code 再翻译一次，不靠 message 匹配。
 */
function fail(code, detail) {
  const error = new Error(ERROR_TEXT[code] ?? '查词暂时不可用')
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

/**
 * 拉一个词库文件并解析成 JSON。
 *
 * @param {string} name - 只能是 'meta.json' 或 'dict.dat'
 * @param {AbortSignal} [signal] - 外部取消信号（插件卸载时用）
 * @returns {Promise<any>}
 * @throws 失败一律抛带 code 的 Error；调用方用 humanizeError 转成话术
 */
export async function fetchAsset(name, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  // 外部信号与内部超时合并：任一先到都取消
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw fail('E_TIMEOUT') }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  let response
  try {
    response = await fetch(`${API_PREFIX}/${name}`, {
      signal: controller.signal,
      // 词库带 ETag，让浏览器自己缓存；不要加 cache: 'no-store'
      credentials: 'same-origin',
    })
  } catch (error) {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    if (error?.name === 'AbortError') {
      throw signal?.aborted ? fail('E_DISABLED') : fail('E_TIMEOUT')
    }
    throw fail('E_NETWORK', error?.message)
  }

  clearTimeout(timer)
  if (signal) signal.removeEventListener('abort', onAbort)

  if (!response.ok) {
    // 宿主失败时回的是 { ok:false, error:{ code, message } }
    let code = 'E_INTERNAL'
    try {
      const body = await response.json()
      if (typeof body?.error?.code === 'string') code = body.error.code
    } catch { /* 响应不是 JSON，用兜底码 */ }
    throw fail(code, response.status)
  }

  try {
    return await response.json()
  } catch {
    throw fail('E_BAD_JSON')
  }
}
