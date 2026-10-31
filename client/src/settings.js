/**
 * settings.js —— 插件设置面板（挂在 Plugins 页的插件详情里）。
 *
 * 四块：
 *   1. 翻译接口：选 google / bing / 关闭
 *   2. 离线词库：显示当前版本与体积，可重新下载
 *   3. 生词本：显示数量、导入、导出、清空
 *   4. 交互参数：悬停释义条数、卡片宽度这些
 *
 * 所有设置存在 localStorage，不走宿主 Config —— 这些是界面偏好，
 * 为了让用户改一个数字去重启宿主是不合理的。
 */

import { loadUx, saveUx, DEFAULT_TIMING } from './config.js'
import { parseImportText } from './wordbook.js'

/** 设置面板的样式。 */
const CSS = `
.hds-root {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 0 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
}
.hds-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
}
.hds-section:last-child { border-bottom: none; padding-bottom: 0; }
.hds-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
}
.hds-hint {
  color: var(--dsw-alias-label-tertiary, #888);
  font-size: 12px;
  line-height: 1.5;
}
.hds-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hds-row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.hds-label {
  min-width: 7.5em;
  color: var(--dsw-alias-label-secondary, #666);
}
.hds-input {
  flex: 1;
  min-width: 80px;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font: inherit;
}
.hds-btn {
  padding: 5px 12px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.hds-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.hds-btn:disabled { opacity: .5; cursor: default; }
.hds-btn-primary {
  background: var(--dsw-alias-state-business-primary, #3b82f6);
  border-color: transparent;
  color: #fff;
}
.hds-btn-primary:hover { filter: brightness(1.08); }
.hds-btn-danger { color: var(--dsw-alias-state-error-primary, #e5484d); }
.hds-textarea {
  width: 100%;
  min-height: 96px;
  padding: 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font-family: var(--ds-font-family-code, monospace);
  font-size: 12px;
  resize: vertical;
}
.hds-select {
  padding: 4px 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font: inherit;
}
.hds-stat {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.hds-ok { color: var(--dsw-alias-state-success-primary, #2f9e44); }
.hds-err { color: var(--dsw-alias-state-error-primary, #e5484d); }
.hds-book-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
  padding: 6px 0;
}
.hds-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  font-size: 12px;
}
.hds-chip-x {
  cursor: pointer;
  opacity: .6;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  padding: 0;
}
.hds-chip-x:hover { opacity: 1; color: var(--dsw-alias-state-error-primary, #e5484d); }
`

/**
 * 设置面板组件。
 *
 * @param {object} props 宿主注入的 PropsRuntime，含 view 与 form
 * @returns {import('react').ReactElement | null}
 */
export function SettingsPanel(props) {
  // 只有当宿主**明确**说这是 summary 视图时才走摘要分支。
  // 不能写成 `view !== 'page'`：宿主在某些版本里可能根本不传 view，
  // 那样整个面板会一直显示成一行的摘要，用户以为没装。
  if (props?.view === 'summary') {
    return h('div', { className: 'hds-hint' }, '英语翻译设置 · 生词本、翻译接口、离线词库')
  }

  const storage = safeLocal()
  const [ux, setUx] = useState(() => loadUx(storage))
  const [translator, setTranslator] = useState(() => readTranslator(storage))
  const [bookVersion, setBookVersion] = useState(0)
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dictInfo, setDictInfo] = useState(null)

  const book = props?.wordbook ?? null

  // 首次挂载时读一下词库版本信息
  useEffect(() => {
    let alive = true
    fetch(`${props?.apiPrefix ?? '/api/dsh-hover-dict'}/meta.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setDictInfo(data) })
      .catch(() => { /* 拿不到就不显示 */ })
    return () => { alive = false }
  }, [props?.apiPrefix])

  const patchUx = (patch) => {
    saveUx(storage, patch)
    setUx(loadUx(storage))
  }

  const patchAppearance = (key, value) => {
    const next = { ...ux.appearance, [key]: value }
    patchUx({ appearance: next })
  }

  const onImport = () => {
    const words = parseImportText(importText)
    if (words.length === 0) {
      setMessage('没有解析出任何单词')
      return
    }
    if (!book) {
      setMessage('生词本还没就绪')
      return
    }
    setBusy(true)
    book.importMany(words, 'import').then((added) => {
      setBusy(false)
      setImportText('')
      setBookVersion((n) => n + 1)
      setMessage(`导入完成：识别 ${words.length} 个，新增 ${added} 个（其余已存在）`)
    }).catch(() => {
      setBusy(false)
      setMessage('导入失败')
    })
  }

  const onExport = () => {
    if (!book) return
    const text = book.list().map((item) => item.head).join('\n')
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `生词本-${new Date().toISOString().slice(0, 10)}.txt`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage(`已导出 ${book.list().length} 个词`)
    } catch {
      setMessage('导出失败')
    }
  }

  const onClear = () => {
    if (!book) return
    const total = book.size()
    if (total === 0) { setMessage('生词本已经是空的'); return }
    if (!window.confirm(`确定清空 ${total} 个生词？这个操作不能撤销。`)) return
    setBusy(true)
    Promise.all(book.list().map((item) => book.remove(item.head))).then(() => {
      setBusy(false)
      setBookVersion((n) => n + 1)
      setMessage('已清空')
    })
  }

  const onDownloadDict = () => {
    setDownloading(true)
    setMessage('')
    // 词库随包分发，这里的「下载」是重新拉一次并让浏览器更新缓存
    const url = `${props?.apiPrefix ?? '/api/dsh-hover-dict'}/dict.dat?t=${Date.now()}`
    fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((data) => {
        const count = Object.keys(data).length
        setDownloading(false)
        setMessage(`词库已更新：${count.toLocaleString()} 个词条`)
      })
      .catch(() => {
        setDownloading(false)
        setMessage('词库下载失败，请确认插件已启用')
      })
  }

  const bookSize = book?.size?.() ?? 0
  const bookWords = book?.list?.() ?? []

  return h('div', { className: 'hds-root' }, [
    h('div', { key: 'title', className: 'hds-title', style: { fontSize: '15px' } }, '英语翻译设置'),

    // ── 翻译接口 ──
    h('div', { key: 'tr', className: 'hds-section' }, [
      h('div', { key: 't', className: 'hds-title' }, '翻译接口'),
      h('div', { key: 'h', className: 'hds-hint' },
        '划选短语或句子时用哪个服务翻译。google 与 bing 都不需要额外密钥；关掉则只查单词不翻译。'),
      h('div', { key: 'r', className: 'hds-row' },
        h('span', { className: 'hds-label' }, '服务'),
        h('select', {
          className: 'hds-select',
          value: translator,
          onChange: (event) => {
            const value = event.target.value
            setTranslator(value)
            writeTranslator(storage, value)
          },
        },
        h('option', { value: 'google' }, 'Google 翻译'),
        h('option', { value: 'bing' }, 'Bing 翻译'),
        h('option', { value: 'auto' }, '自动（先 Google 后 Bing）'),
        h('option', { value: 'off' }, '关闭句子翻译'),
        ),
      ),
    ]),

    // ── 离线词库与句子库 ──
    h('div', { key: 'dict', className: 'hds-section' }, [
      h('div', { key: 't', className: 'hds-title' }, '离线词库与句子库'),
      h('div', { key: 'h', className: 'hds-hint' },
        '词库与例句随插件分发，默认已就绪，不需要联网。这里可以把它们重新下载一遍'
        + '（浏览器丢弃缓存、重读磁盘上的最新副本），或者从远端拉一次更新。'),
      h('div', { key: 'info', className: 'hds-row' },
        h('span', { className: 'hds-label' }, '词库'),
        h('span', { className: 'hds-stat' },
          dictInfo?.entries ? `${dictInfo.entries.toLocaleString()} 词条` : '读取中…'),
        dictInfo?.examples
          ? h('span', { className: 'hds-hint' }, `· ${dictInfo.examples.toLocaleString()} 个词带例句`)
          : null,
        dictInfo?.roots
          ? h('span', { className: 'hds-hint' }, `· ${dictInfo.roots.toLocaleString()} 个词有词根分析`)
          : null,
      ),
      h('div', { key: 'btn', className: 'hds-row' },
        h('button', {
          className: 'hds-btn',
          type: 'button',
          disabled: downloading === 'dict',
          onClick: () => onDownload('dict'),
        }, downloading === 'dict' ? '下载中…' : '重新下载词库'),
        h('button', {
          className: 'hds-btn',
          type: 'button',
          disabled: downloading === 'root',
          onClick: () => onDownload('root'),
        }, downloading === 'root' ? '下载中…' : '重新下载词根库'),
        h('button', {
          className: 'hds-btn',
          type: 'button',
          disabled: downloading === 'examples',
          onClick: () => onDownload('examples'),
        }, downloading === 'examples' ? '下载中…' : '检查句子库'),
      ),
      h('div', { key: 'note', className: 'hds-hint' },
        '句子库（双语例句）已经嵌在词库里，不需要单独下载。'),
    ]),

    // ── 生词本 ──
    h('div', { key: 'book', className: 'hds-section' }, [
      h('div', { key: 't', className: 'hds-title' }, '生词本'),
      h('div', { key: 'h', className: 'hds-hint' },
        `已收藏 ${bookSize} 个词。支持从有道、欧路、百词斩等导出的一行一词格式直接粘贴导入。`),
      bookSize > 0
        ? h('div', { key: 'list', className: 'hds-book-list' },
          bookWords.slice(0, 100).map((item) => h('span', { key: item.head, className: 'hds-chip' },
            item.head,
            h('button', {
              className: 'hds-chip-x',
              type: 'button',
              title: '移出',
              onClick: () => {
                book.remove(item.head).then(() => setBookVersion((n) => n + 1))
              },
            }, '×'),
          )),
          bookWords.length > 100
            ? h('span', { className: 'hds-hint' }, `…还有 ${bookWords.length - 100} 个`)
            : null,
        )
        : null,
      h('textarea', {
        key: 'ta',
        className: 'hds-textarea',
        placeholder: '在这里粘贴单词表，一行一个。也可以直接粘贴有道的导出内容（每行第一个词会被识别）。',
        value: importText,
        onChange: (event) => setImportText(event.target.value),
      }),
      h('div', { key: 'btn', className: 'hds-row' },
        h('button', {
          className: 'hds-btn hds-btn-primary',
          type: 'button',
          disabled: busy || importText.trim() === '',
          onClick: onImport,
        }, busy ? '处理中…' : '导入'),
        h('button', {
          className: 'hds-btn',
          type: 'button',
          disabled: bookSize === 0,
          onClick: onExport,
        }, '导出为 txt'),
        h('button', {
          className: 'hds-btn hds-btn-danger',
          type: 'button',
          disabled: busy || bookSize === 0,
          onClick: onClear,
        }, '清空'),
      ),
    ]),

    // ── 显示 ──
    h('div', { key: 'ui', className: 'hds-section' }, [
      h('div', { key: 't', className: 'hds-title' }, '显示'),
      h('div', { key: 'r1', className: 'hds-row-between' },
        h('span', { className: 'hds-label' }, '浮层释义条数'),
        h('input', {
          className: 'hds-input',
          style: { maxWidth: '80px' },
          type: 'number',
          min: 1,
          max: 5,
          value: ux.appearance.maxSensesInPopover,
          onChange: (event) => patchAppearance('maxSensesInPopover', Number(event.target.value)),
        }),
      ),
      h('div', { key: 'r2', className: 'hds-row-between' },
        h('span', { className: 'hds-label' }, '卡片宽度'),
        h('input', {
          className: 'hds-input',
          style: { maxWidth: '100px' },
          type: 'number',
          min: 240,
          max: 720,
          step: 20,
          value: ux.appearance.cardMaxWidthPx,
          onChange: (event) => patchAppearance('cardMaxWidthPx', Number(event.target.value)),
        }),
      ),
      h('div', { key: 'r3', className: 'hds-row-between' },
        h('span', { className: 'hds-label' }, '显示考纲标签'),
        h('input', {
          type: 'checkbox',
          checked: ux.appearance.showTags !== false,
          onChange: (event) => patchAppearance('showTags', event.target.checked),
        }),
      ),
    ]),

    message !== ''
      ? h('div', { key: 'msg', className: 'hds-hint hds-ok' }, message)
      : null,
  ])
}

/** 读 localStorage，失败返回 undefined。 */
function safeLocal() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch { /* ignore */ }
  return undefined
}

/** 读翻译接口偏好。 */
export function readTranslator(storage) {
  try {
    const raw = storage?.getItem?.('dsh-hover-dict:translator')
    if (raw === 'google' || raw === 'bing' || raw === 'auto' || raw === 'off') return raw
  } catch { /* ignore */ }
  return 'auto'
}

/** 写翻译接口偏好。 */
export function writeTranslator(storage, value) {
  try {
    storage?.setItem?.('dsh-hover-dict:translator', String(value))
  } catch { /* ignore */ }
}

/** 把偏好翻成实际要试的 provider 列表。 */
export function translatorChain(preference) {
  if (preference === 'off') return []
  if (preference === 'google') return ['google']
  if (preference === 'bing') return ['bing']
  return ['google', 'bing']
}

/** 把设置面板的样式插进文档。 */
export function ensureSettingsStyle(doc) {
  if (!doc || typeof doc.createElement !== 'function') return () => {}
  const id = 'dsh-hover-dict/settings.css'
  const selector = `style[data-plugin-css=${JSON.stringify(id)}]`
  let node = doc.querySelector(selector)
  if (node === null) {
    node = doc.createElement('style')
    node.dataset.pluginCss = id
    node.textContent = CSS
    const head = doc.head ?? doc.documentElement
    if (!head) return () => {}
    head.appendChild(node)
  } else if (node.textContent !== CSS) {
    node.textContent = CSS
  }
  return () => { try { node.remove() } catch { /* ignore */ } }
}
