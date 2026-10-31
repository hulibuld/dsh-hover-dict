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
/* ═══════════════════════════════════════════════════════════════════════
   英语翻译设置 · 视觉系统
   参照 dsh-get-it-for-free 的 ofm 设计语言：
   分层用 --dsw-alias-bg-layer-1/2/3，按钮用细边 + 内高光 + 悬停扫光，
   卡片带拉丝细纹底与外投影。昼夜由宿主切换，这里不写死颜色。
   ═══════════════════════════════════════════════════════════════════════ */

.hds-root {
  --ease-instrument: cubic-bezier(.16,1,.3,1);
  --ease-settle: cubic-bezier(.34,1.4,.4,1);
  display: flex;
  flex-direction: column;
  gap: 30px;
  max-width: 860px;
  padding: 4px 0 28px;
  font-size: 13.5px;
  line-height: 1.78;
  color: var(--dsw-alias-label-primary);
  -webkit-font-smoothing: antialiased;
}
.hds-root * { box-sizing: border-box; }

/* ── 区块 ────────────────────────────────────────────────────────────── */
.hds-section { display: flex; flex-direction: column; gap: 18px; }

.hds-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
}

.hds-title {
  font-size: 14px;
  font-weight: 680;
  letter-spacing: -.2px;
  line-height: 1.5;
}

.hds-hint {
  font-size: 12px;
  line-height: 1.85;
  color: var(--dsw-alias-label-tertiary);
}

.hds-stack { display: flex; flex-direction: column; gap: 14px; }
.hds-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

/* 一行设置：标签在上、控件在下，留足垂直空间 */
.hds-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.hds-field > .hds-label {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary);
}

/* ── 按钮 ────────────────────────────────────────────────────────────── */
.hds-btn {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 16px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-3) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 580;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  transition:
    transform .16s var(--ease-settle),
    border-color .2s var(--ease-instrument),
    background .2s var(--ease-instrument),
    box-shadow .2s var(--ease-instrument),
    opacity .16s ease;
  -webkit-tap-highlight-color: transparent;
}

/* 悬停扫光：一条斜向高光从左侧滑过 */
.hds-btn::after {
  content: "";
  position: absolute;
  top: 0; bottom: 0;
  left: -60%;
  width: 42%;
  background: linear-gradient(100deg, transparent, rgb(255 255 255 / 14%), transparent);
  transform: skewX(-18deg);
  transition: left .5s var(--ease-instrument);
  pointer-events: none;
}
.hds-btn:hover:not(:disabled)::after { left: 118%; }

.hds-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 62%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-3));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
}

/* 按下：快速陷落 + 内阴影加深 */
.hds-btn:active:not(:disabled) {
  transform: scale(.985);
  transition-duration: .09s;
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%);
}

.hds-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.hds-btn:disabled { opacity: .45; cursor: default; box-shadow: none; transform: none; }
.hds-btn:disabled::after { content: none; }

.hds-btn-primary {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsw-alias-state-business-primary) 88%, #fff),
    var(--dsw-alias-state-business-primary));
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 82%, #000);
  color: var(--dsw-alias-label-on-accent, #fff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%),
              inset 0 -10px 18px -12px rgb(0 0 0 / 24%);
}
.hds-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg,
    var(--dsw-alias-state-business-primary),
    color-mix(in srgb, var(--dsw-alias-state-business-primary) 88%, #000));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 26%),
              inset 0 -10px 18px -12px rgb(0 0 0 / 18%);
}

.hds-btn-ghost {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--dsw-alias-label-secondary);
}
.hds-btn-ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 80%, transparent);
  border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.hds-btn-ghost::after { content: none; }

.hds-btn-danger {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-border-l2));
  color: var(--dsw-alias-state-error-primary);
}
.hds-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-3));
  border-color: var(--dsw-alias-state-error-primary);
}

.hds-btn-sm { min-height: 28px; padding: 4px 12px; font-size: 11.5px; border-radius: 7px; }

/* ── 输入 ────────────────────────────────────────────────────────────── */
.hds-input, .hds-select {
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 10%);
  color: var(--dsw-alias-label-primary);
  min-width: 0;
  transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
}
.hds-input:hover, .hds-select:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 55%, var(--dsw-alias-state-business-primary));
}
.hds-input:focus, .hds-select:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 8%),
              0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}
.hds-input[type="number"] { max-width: 110px; }

.hds-textarea {
  width: 100%;
  min-height: 128px;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 12.5px;
  line-height: 1.85;
  padding: 12px 14px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 10%);
  color: var(--dsw-alias-label-primary);
  resize: vertical;
  transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
}
.hds-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: inset 0 2px 6px -2px rgb(0 0 0 / 8%),
              0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}

/* ── 开关：spring 滑块 ───────────────────────────────────────────────── */
.hds-switch {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  user-select: none;
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
}

.hds-switch-track {
  width: 38px;
  height: 21px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%), inset 0 -1px 0 rgb(255 255 255 / 4%);
  position: relative;
  flex: none;
  transition: background .22s var(--ease-instrument),
              border-color .22s var(--ease-instrument),
              box-shadow .22s var(--ease-instrument);
}

.hds-switch-track::after {
  content: "";
  position: absolute;
  top: 2px; left: 2px;
  width: 15px; height: 15px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%);
  transition: transform .28s var(--ease-settle),
              background .2s var(--ease-instrument),
              width .14s var(--ease-instrument);
}

.hds-switch:active .hds-switch-track::after { width: 18px; }

.hds-switch[aria-checked="true"] .hds-switch-track {
  background: var(--dsw-alias-state-business-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 85%, #000);
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 14%), inset 0 -1px 0 rgb(255 255 255 / 8%);
}
.hds-switch[aria-checked="true"] .hds-switch-track::after {
  transform: translateX(17px);
  background: var(--dsw-alias-label-on-accent, #fff);
}
.hds-switch[aria-checked="true"]:active .hds-switch-track::after {
  transform: translateX(14px);
}
.hds-switch:focus-visible .hds-switch-track {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
}

.hds-switch-text { font-size: 13px; line-height: 1.7; }

/* ── 卡片 ────────────────────────────────────────────────────────────── */
.hds-cards { display: flex; flex-direction: column; gap: 10px; }

.hds-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 15px;
  border-radius: 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  /* 拉丝细纹垫底：从边缘隐约透出，不做成显眼图案 */
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-3) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%),
              inset 0 -12px 24px -16px rgb(0 0 0 / 14%);
  transition: transform .22s var(--ease-instrument),
              box-shadow .26s var(--ease-instrument),
              border-color .2s var(--ease-instrument);
}

.hds-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 58%, var(--dsw-alias-border-l2));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 11%),
              inset 0 -12px 24px -16px rgb(0 0 0 / 10%);
}

.hds-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

.hds-card-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 650;
  letter-spacing: -.1px;
  line-height: 1.55;
}

.hds-card-meta {
  font-size: 12px;
  line-height: 1.85;
  color: var(--dsw-alias-label-tertiary);
}

.hds-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.7;
  border: 1px solid transparent;
  white-space: nowrap;
}
.hds-badge-builtin {
  color: var(--dsw-alias-label-tertiary);
  border-color: var(--dsw-alias-border-l2);
}
.hds-badge-on {
  color: var(--dsw-alias-state-success-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent);
}

/* ── 生词本 chips ────────────────────────────────────────────────────── */
.hds-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 190px;
  overflow: auto;
  padding: 4px 2px 4px 0;
}
.hds-chips::-webkit-scrollbar { width: 10px; height: 10px; }
.hds-chips::-webkit-scrollbar-track { background: transparent; }
.hds-chips::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 32%, transparent);
  border-radius: 5px;
}

.hds-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12.5px;
  line-height: 1.7;
  transition: border-color .18s var(--ease-instrument), background .18s var(--ease-instrument);
}
.hds-chip:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 55%, var(--dsw-alias-state-business-primary));
}

.hds-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px; height: 19px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background .16s ease, color .16s ease;
}
.hds-chip-x:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

/* ── 提示条 ──────────────────────────────────────────────────────────── */
.hds-note {
  display: flex;
  gap: 9px;
  padding: 10px 13px;
  border-radius: 11px;
  border: 1px solid;
  font-size: 12px;
  line-height: 1.8;
}
.hds-note-ok {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent);
}
.hds-note-err {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);
}
.hds-note-info {
  border-color: var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 70%, transparent);
  color: var(--dsw-alias-label-secondary);
}

.hds-stat { font-variant-numeric: tabular-nums; font-weight: 600; }

.hds-path {
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.9;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, transparent);
  color: var(--dsw-alias-label-tertiary);
  user-select: all;
}

/* 减弱动效偏好：只留颜色反馈 */
@media (prefers-reduced-motion: reduce) {
  .hds-root .hds-card:hover,
  .hds-root .hds-btn:hover:not(:disabled),
  .hds-root .hds-btn:active:not(:disabled) { transform: none; }
  .hds-root .hds-btn::after { content: none; }
}
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
    return h('div', { className: 'hds-hint' }, '点选查词 · 生词本 · 离线词库')
  }

  const storage = safeLocal()
  const [ux, setUx] = useState(() => loadUx(storage))
  const [translator, setTranslator] = useState(() => readTranslator(storage))
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState('')
  const [dictInfo, setDictInfo] = useState(null)
  const [packs, setPacks] = useState(() => readPacks(storage))

  const book = props?.wordbook
  const apiPrefix = props?.apiPrefix ?? '/api/dsh-hover-dict'
  // 词库包目录。宿主侧 dataDir 默认是包内 data/，这里写成用户能直接打开的绝对路径。
  const packsDir = props?.packsDir ?? '~/.dsh/profiles/desktop/node_modules/dsh-hover-dict/data/packs'

  // 首次挂载读词库元信息
  useEffect(() => {
    let alive = true
    fetch(`${apiPrefix}/meta.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setDictInfo(data) })
      .catch(() => { /* 拿不到就不显示 */ })
    return () => { alive = false }
  }, [apiPrefix])

  const patchAppearance = (key, value) => {
    saveUx(storage, { appearance: { ...ux.appearance, [key]: value } })
    setUx(loadUx(storage))
  }

  const say = (text, tone = 'ok') => setMessage({ text, tone })

  const onImport = () => {
    const words = parseImportText(importText)
    if (words.length === 0) { say('没有解析出任何单词', 'err'); return }
    if (!book) { say('生词本还没就绪', 'err'); return }
    setBusy('import')
    book.importMany(words, 'import').then((added) => {
      setBusy('')
      setImportText('')
      say(`导入完成：识别 ${words.length} 个，新增 ${added} 个（其余已存在）`)
    }).catch(() => { setBusy(''); say('导入失败', 'err') })
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
      say(`已导出 ${book.list().length} 个词`)
    } catch { say('导出失败', 'err') }
  }

  const onClear = () => {
    if (!book) return
    const total = book.size()
    if (total === 0) { say('生词本已经是空的', 'info'); return }
    if (!window.confirm(`确定清空 ${total} 个生词？这个操作不能撤销。`)) return
    setBusy('clear')
    Promise.all(book.list().map((item) => book.remove(item.head))).then(() => {
      setBusy('')
      say('已清空')
    })
  }

  /** 下载/卸载一个词库包。数据来自宿主，按包名请求。 */
  const onTogglePack = (pack) => {
    if (pack.builtin) return
    setBusy(pack.id)
    const next = { ...packs }
    if (next[pack.id]) delete next[pack.id]
    else next[pack.id] = { installedAt: Date.now() }
    writePacks(storage, next)
    setPacks(next)
    setBusy('')
    say(next[pack.id] ? `已启用「${pack.name}」` : `已停用「${pack.name}」`)
  }

  const bookSize = book?.size?.() ?? 0
  const bookWords = book?.list?.() ?? []

  /* ── 区块头 ── */
  const section = (key, title, hint, children) => h('div', { key, className: 'hds-section' }, [
    h('div', { key: 'head', className: 'hds-head' }, [
      h('div', { key: 't', className: 'hds-title' }, title),
      hint ? h('div', { key: 'h', className: 'hds-hint' }, hint) : null,
    ]),
    h('div', { key: 'body', className: 'hds-stack' }, children),
  ])

  /* ── 一行设置 ── */
  const field = (key, label, control) => h('div', { key, className: 'hds-field' }, [
    h('span', { key: 'l', className: 'hds-label' }, label),
    h('div', { key: 'c', className: 'hds-row' }, control),
  ])

  return h('div', { className: 'hds-root' }, [

    /* 翻译接口 */
    section('tr', '翻译接口',
      '划选纯英文句子时用哪个服务翻译。三项都不需要额外密钥。',
      [
        field('f1', '翻译服务', h('select', {
          className: 'hds-select',
          value: translator,
          onChange: (event) => {
            setTranslator(event.target.value)
            writeTranslator(storage, event.target.value)
          },
        },
        h('option', { value: 'auto' }, '自动（先用 Google，失败换 Bing）'),
        h('option', { value: 'google' }, 'Google 翻译'),
        h('option', { value: 'bing' }, 'Bing 翻译'),
        h('option', { value: 'off' }, '关闭句子翻译'),
        )),
      ]),

    /* 词库管理 */
    section('packs', '词库与句子库',
      '系统自带三个，随插件分发，完全离线。其余词库可以用下面的方式自己加。',
      [
        h('div', { key: 'cards', className: 'hds-cards' },
          WORD_PACKS.map((pack) => h('div', {
            key: pack.id,
            className: 'hds-card',
            'data-installed': '',
          }, [
            h('div', { key: 'm', className: 'hds-card-main' }, [
              h('div', { key: 'n', className: 'hds-card-name' }, [
                h('span', { key: 't' }, pack.name),
                h('span', { key: 'b', className: 'hds-badge hds-badge-builtin' }, '系统自带'),
              ]),
              h('div', { key: 'd', className: 'hds-card-meta' }, pack.desc),
            ]),
          ])),
        ),
        h('div', { key: 'custom', className: 'hds-stack' }, [
          h('div', { key: 't', className: 'hds-title', style: { fontSize: '13.5px' } }, '自己加词库'),
          h('div', { key: 'h', className: 'hds-hint' },
            '把词库文件放进下面这个目录，重启 DSH 后自动加载。'
            + '支持 ECDICT 的 CSV（只要有 word 与 translation 两列），'
            + '或者与 dict.dat 同构的 JSON。'),
          h('div', { key: 'pathrow', className: 'hds-row' }, [
            h('code', { key: 'p', className: 'hds-path' }, packsDir),
            h('button', {
              key: 'copy',
              className: 'hds-btn hds-btn-sm',
              type: 'button',
              onClick: (event) => {
                const btn = event.currentTarget
                const done = () => {
                  if (btn) btn.textContent = '已复制'
                  setTimeout(() => { if (btn) btn.textContent = '复制路径' }, 1400)
                }
                try {
                  navigator.clipboard?.writeText(packsDir).then(done, () => {})
                } catch { /* 剪贴板不可用就静默 */ }
              },
            }, '复制路径'),
            h('button', {
              key: 'open',
              className: 'hds-btn hds-btn-sm',
              type: 'button',
              title: '在文件管理器里打开（若宿主支持）',
              onClick: () => {
                try {
                  window.open(`file://${packsDir}`, '_blank')
                } catch { /* 被拦截就算了 */ }
              },
            }, '打开文件夹'),
          ]),
        ]),
        h('div', { key: 'note', className: 'hds-note hds-note-info' },
          `当前词库共 ${dictInfo?.entries ? dictInfo.entries.toLocaleString() : '20,499'} 个词条，`
          + `${dictInfo?.examples ? dictInfo.examples.toLocaleString() : '8,960'} 个带双语例句，`
          + `${dictInfo?.roots ? dictInfo.roots.toLocaleString() : '6,374'} 个带词根分析。`),
      ]),

    /* 生词本 */
    section('book', '生词本',
      `已收藏 ${bookSize} 个词。支持从有道、欧路、百词斩导出的内容直接粘贴，一行一个。`,
      [
        bookSize > 0
          ? h('div', { key: 'chips', className: 'hds-chips' },
            bookWords.slice(0, 120).map((item) => h('span', { key: item.head, className: 'hds-chip' }, [
              h('span', { key: 'w' }, item.head),
              h('button', {
                key: 'x',
                className: 'hds-chip-x',
                type: 'button',
                title: '移出',
                onClick: () => book.remove(item.head),
              }, '×'),
            ])),
          )
          : h('div', { key: 'empty', className: 'hds-hint' }, '还没有生词。在对话里点开一个词，点标题旁边的 ☆ 就能收进来。'),

        h('textarea', {
          key: 'ta',
          className: 'hds-textarea',
          placeholder: '粘贴单词表，一行一个。有道的导出内容可以直接贴（每行第一个词会被识别）。',
          value: importText,
          onChange: (event) => setImportText(event.target.value),
        }),

        h('div', { key: 'btns', className: 'hds-row' }, [
          h('button', {
            key: 'import',
            className: 'hds-btn hds-btn-primary',
            type: 'button',
            disabled: busy === 'import' || importText.trim() === '',
            onClick: onImport,
          }, busy === 'import' ? '导入中…' : '导入'),
          h('button', {
            key: 'export',
            className: 'hds-btn',
            type: 'button',
            disabled: bookSize === 0,
            onClick: onExport,
          }, '导出为 txt'),
          h('button', {
            key: 'clear',
            className: 'hds-btn hds-btn-danger',
            type: 'button',
            disabled: busy === 'clear' || bookSize === 0,
            onClick: onClear,
          }, '清空'),
        ]),
      ]),

    /* 显示 */
    section('ui', '显示', null, [
      field('s1', '浮层释义条数', h('input', {
        className: 'hds-input',
        type: 'number',
        min: 1,
        max: 5,
        value: ux.appearance.maxSensesInPopover,
        onChange: (event) => patchAppearance('maxSensesInPopover', Number(event.target.value)),
      })),
      field('s2', '卡片宽度', h('input', {
        className: 'hds-input',
        type: 'number',
        min: 240,
        max: 720,
        step: 20,
        value: ux.appearance.cardMaxWidthPx,
        onChange: (event) => patchAppearance('cardMaxWidthPx', Number(event.target.value)),
      })),
      h('div', { key: 's3', className: 'hds-field' }, [
        h('span', { key: 'l', className: 'hds-label' }, '显示考纲标签'),
        h('button', {
          key: 'sw',
          className: 'hds-switch',
          type: 'button',
          role: 'switch',
          'aria-checked': ux.appearance.showTags !== false ? 'true' : 'false',
          onClick: () => patchAppearance('showTags', ux.appearance.showTags === false),
        }, [
          h('span', { key: 'track', className: 'hds-switch-track', 'aria-hidden': 'true' }),
          h('span', { key: 'text', className: 'hds-switch-text' },
            ux.appearance.showTags !== false ? '显示' : '隐藏'),
        ]),
      ]),
    ]),

    message !== null
      ? h('div', {
        key: 'msg',
        className: `hds-note hds-note-${message.tone === 'err' ? 'err' : message.tone === 'info' ? 'info' : 'ok'}`,
      }, message.text)
      : null,
  ])
}

/**
 * 可下载的词库包清单。
 *
 * builtin 的三个是随包分发的，不能停用。
 * 其余按需下载——装了就参与查词，没装就查不到那部分词。
 */
export const WORD_PACKS = [
  { id: 'core', name: '核心词库', builtin: true, desc: '20,499 个考纲核心词：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE，每个词带词性、中文释义、英文释义与变音标注。' },
  { id: 'roots', name: '词根词缀库', builtin: true, desc: '6,374 个词的词根词缀拆解，来自 ECDICT 词根库（MIT）。' },
  { id: 'examples', name: '双语例句库', builtin: true, desc: '8,960 个词的中英对照例句，来自 Tatoeba（CC BY 2.0 FR）。' },
]

/** 读已启用的词库包。 */
export function readPacks(storage) {
  try {
    const raw = storage?.getItem?.('dsh-hover-dict:packs')
    if (typeof raw === 'string' && raw !== '') {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    }
  } catch { /* ignore */ }
  return {}
}

/** 写已启用的词库包。 */
export function writePacks(storage, packs) {
  try {
    storage?.setItem?.('dsh-hover-dict:packs', JSON.stringify(packs))
  } catch { /* ignore */ }
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
