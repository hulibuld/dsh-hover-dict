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

/** 侧边栏图标组件。用 currentColor，跟随主题与选中态。 */
export function PanelIcon(props) {
  const size = props?.size ?? 20
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    role: 'img',
    'aria-label': '字典',
  }, [
    h('path', { key: 'l', d: 'M12 6.4C10.2 5.2 7.9 4.9 5.4 5.6v11.2c2.5-.7 4.8-.4 6.6.8' }),
    h('path', { key: 'r', d: 'M12 6.4c1.8-1.2 4.1-1.5 6.6-.8v11.2c-2.5-.7-4.8-.4-6.6.8' }),
    h('path', { key: 's', d: 'M12 6.4v11.2' }),
    h('path', { key: 'a1', d: 'M8.2 13.6l1.5-3.4 1.5 3.4' }),
    h('path', { key: 'a2', d: 'M8.7 12.6h2' }),
    h('path', { key: 'r1', d: 'M14.6 9.2h2.6' }),
    h('path', { key: 'r2', d: 'M14.6 11.8h2.6' }),
  ])
}

/** 面板页面的样式（比设置面板宽松，占满整列）。 */
const PANEL_CSS = `
.hdp-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
}
.hdp-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px 16px 8px;
  border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
}
.hdp-title { font-weight: 600; font-size: 14px; }
.hdp-sub { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; }
.hdp-body {
  padding: 14px 0 8px;
}
.hdp-tabs {
  display: flex;
  gap: 4px;
  padding: 0 0 4px;
  border-bottom: .5px solid var(--dsw-alias-border-l1, rgba(127,127,127,.2));
}
.hdp-tab {
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary, #888);
  font: inherit;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -0.5px;
}
.hdp-tab:hover { color: var(--dsw-alias-label-secondary, #666); }
.hdp-tab[data-active] {
  color: var(--dsw-alias-label-primary, inherit);
  border-bottom-color: var(--dsw-alias-state-business-primary, #3b82f6);
}
.hdp-empty {
  color: var(--dsw-alias-label-tertiary, #888);
  text-align: center;
  padding: 40px 16px;
  line-height: 1.7;
}
.hdp-list { display: flex; flex-direction: column; gap: 2px; }
.hdp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer;
}
.hdp-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.hdp-item-word { font-weight: 600; font-size: 14px; }
.hdp-item-zh {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-secondary, #666);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hdp-item-x {
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}
.hdp-item-x:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16));
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.hdp-search {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: var(--dsw-radius-sm, 6px);
  border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font: inherit;
}
`

/** 插面板样式。 */
export function ensurePanelStyle(doc) {
  if (!doc || typeof doc.createElement !== 'function') return () => {}
  const id = 'dsh-hover-dict/panel.css'
  const selector = `style[data-plugin-css=${JSON.stringify(id)}]`
  let node = doc.querySelector(selector)
  if (node === null) {
    node = doc.createElement('style')
    node.dataset.pluginCss = id
    node.textContent = PANEL_CSS
    const head = doc.head ?? doc.documentElement
    if (!head) return () => {}
    head.appendChild(node)
  } else if (node.textContent !== PANEL_CSS) {
    node.textContent = PANEL_CSS
  }
  return () => { try { node.remove() } catch { /* ignore */ } }
}

/**
 * 侧边栏面板：生词本 + 设置，一页看完。
 *
 * @param {object} props
 * @returns {import('react').ReactElement}
 */
export function DictionaryPanel(props) {
  const book = props?.wordbook
  const dict = props?.dict
  const [tab, setTab] = useState('book')
  const [version, setVersion] = useState(0)
  const [query, setQuery] = useState('')

  // 订阅生词本变化
  useEffect(() => {
    if (!book || typeof book.subscribe !== 'function') return undefined
    const off = book.subscribe(() => setVersion((n) => n + 1))
    return () => { try { off() } catch { /* ignore */ } }
  }, [book])

  const words = book?.list?.() ?? []
  const filtered = query.trim() === ''
    ? words
    : words.filter((item) => item.head.includes(query.trim().toLowerCase()))

  /** 取一个词的中文简述，用于列表右侧。 */
  const briefOfWord = (head) => {
    if (!dict) return ''
    const entry = dict.entries?.[head]
    if (!Array.isArray(entry)) return ''
    const groups = Array.isArray(entry[0]) ? entry[0] : []
    for (const group of groups) {
      const zh = Array.isArray(group?.[1]) ? group[1] : []
      if (zh.length > 0) return zh.slice(0, 2).join('；')
    }
    return ''
  }

  const tabs = [
    h('button', {
      key: 'book', className: 'hdp-tab', type: 'button',
      'data-active': tab === 'book' ? '' : undefined,
      onClick: () => setTab('book'),
    }, `生词本 ${words.length > 0 ? `(${words.length})` : ''}`),
    h('button', {
      key: 'settings', className: 'hdp-tab', type: 'button',
      'data-active': tab === 'settings' ? '' : undefined,
      onClick: () => setTab('settings'),
    }, '设置'),
  ]

  const body = []

  if (tab === 'book') {
    if (words.length === 0) {
      body.push(h('div', { key: 'empty', className: 'hdp-empty' },
        '生词本还是空的。',
        h('br'),
        '在对话里点开一个词，点标题旁边那颗 ☆ 就能收进来。'))
    } else {
      body.push(h('input', {
        key: 'q', className: 'hdp-search', type: 'text',
        placeholder: `在 ${words.length} 个生词里搜…`,
        value: query,
        onChange: (event) => setQuery(event.target.value),
      }))
      body.push(h('div', { key: 'list', className: 'hdp-list' },
        filtered.map((item) => h('div', {
          key: item.head,
          className: 'hdp-item',
        },
        h('span', { className: 'hdp-item-word' }, item.head),
        h('span', { className: 'hdp-item-zh' }, briefOfWord(item.head)),
        h('button', {
          className: 'hdp-item-x', type: 'button', title: '移出',
          onClick: (event) => {
            event.stopPropagation()
            book.remove(item.head)
          },
        }, '×'),
        ))))
      if (filtered.length === 0) {
        body.push(h('div', { key: 'noresult', className: 'hdp-empty' }, '没有匹配的词'))
      }
    }
  } else {
    body.push(h(SettingsPanel, {
      key: 'settings',
      view: 'page',
      wordbook: book,
      apiPrefix: '/api/dsh-hover-dict',
    }))
  }

  return h('div', { className: 'hdp-root' }, [
    h('div', { key: 'tabs', className: 'hdp-tabs' }, tabs),
    h('div', { key: 'body', className: 'hdp-body' }, body),
  ])
}
