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
/* ── 版式基准 ────────────────────────────────────────────────
   设置页要“大气”，靠的是三件事：字号、行高、留白。
   原来 13px / gap 8px / line-height 1.5 挤在一起，读起来累。
   现在正文 14px、行高 1.7、区块间距 28px、控件高 34px。 */

.hds-root {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 8px 0 24px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--dsw-alias-label-primary, inherit);
  max-width: 760px;
}

.hds-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hds-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hds-title {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.5;
  letter-spacing: .01em;
  color: var(--dsw-alias-label-primary, inherit);
}

.hds-hint {
  color: var(--dsw-alias-label-tertiary, #8a8a8a);
  font-size: 13px;
  line-height: 1.75;
}

/* 一行设置：左边标签固定宽，右边控件 —— 让所有控件左边缘对齐 */
.hds-field {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  min-height: 36px;
}

.hds-label {
  color: var(--dsw-alias-label-secondary, #6b6b6b);
  font-size: 14px;
  line-height: 1.6;
}

.hds-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.hds-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 按钮：立体感 + 按下回弹 ────────────────────────────────
   立体感不靠渐变，靠三样东西：
   1. 底部一条 2px 深色边（让按钮看起来是“浮”起一块）
   2. 一层极淡的上高光
   3. 轻微的投影
   按下时：下边框缩到 1px、整体下沉 1px、投影收紧 —— 手感像真的按进去。 */

.hds-btn {
  --btn-bg: var(--dsw-alias-bg-base, #fff);
  --btn-border: var(--dsw-alias-border-l2, rgba(0,0,0,.16));
  --btn-shadow: rgba(0,0,0,.10);

  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 18px;
  border-radius: 9px;
  border: 1px solid var(--btn-border);
  border-bottom-width: 2px;
  background: var(--btn-bg);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.55),
    0 2px 5px var(--btn-shadow);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition:
    transform .09s cubic-bezier(.34,1.4,.64,1),
    box-shadow .09s ease,
    border-bottom-width .09s ease,
    background-color .12s ease;
  -webkit-tap-highlight-color: transparent;
}

.hds-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.10));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.6),
    0 3px 8px rgba(0,0,0,.13);
}

.hds-btn:active:not(:disabled) {
  transform: translateY(2px);
  border-bottom-width: 1px;
  box-shadow:
    inset 0 1px 3px rgba(0,0,0,.14),
    0 0 0 rgba(0,0,0,0);
}

.hds-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6);
  outline-offset: 2px;
}

.hds-btn:disabled {
  opacity: .42;
  cursor: default;
  transform: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.4);
}

/* 主按钮：实底 */
.hds-btn-primary {
  --btn-bg: var(--dsw-alias-state-business-primary, #3b82f6);
  --btn-border: transparent;
  --btn-shadow: rgba(59,130,246,.36);
  color: #fff;
}
.hds-btn-primary:hover:not(:disabled) {
  background: var(--dsw-alias-state-business-primary, #3b82f6);
  filter: brightness(1.06);
}

/* 危险按钮 */
.hds-btn-danger {
  --btn-border: var(--dsw-alias-state-error-primary, #e5484d);
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.hds-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent);
}

/* 小号按钮（词库里“下载/已装”这类） */
.hds-btn-sm {
  min-height: 30px;
  padding: 0 13px;
  font-size: 13px;
  border-radius: 7px;
  gap: 6px;
}

/* ── 输入控件 ────────────────────────────────────────────── */

.hds-input,
.hds-select {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.16));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font: inherit;
  font-size: 14px;
  transition: border-color .12s ease, box-shadow .12s ease;
}

.hds-input:focus,
.hds-select:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 18%, transparent);
}

.hds-input[type="number"] { max-width: 96px; }

.hds-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 120px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.16));
  background: var(--dsw-alias-bg-base, transparent);
  color: inherit;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  transition: border-color .12s ease, box-shadow .12s ease;
}

.hds-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary, #3b82f6);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 18%, transparent);
}

/* 开关：不用原生 checkbox，自己画一个 */
.hds-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 46px;
  height: 26px;
  border-radius: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.18));
  cursor: pointer;
  transition: background-color .16s ease, border-color .16s ease;
  padding: 0;
}
.hds-switch[data-on] {
  background: var(--dsw-alias-state-business-primary, #3b82f6);
  border-color: transparent;
}
.hds-switch::after {
  content: "";
  position: absolute;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.28);
  transition: transform .16s cubic-bezier(.34,1.4,.64,1);
}
.hds-switch[data-on]::after { transform: translateX(20px); }

/* ── 词库卡片 ────────────────────────────────────────────── */

.hds-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hds-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: var(--dsw-alias-bg-base, transparent);
  transition: border-color .12s ease, background-color .12s ease;
}

.hds-card:hover {
  border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18));
}

.hds-card[data-installed] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 40%, transparent);
}

.hds-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hds-card-name {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hds-card-meta {
  color: var(--dsw-alias-label-tertiary, #8a8a8a);
  font-size: 13px;
  line-height: 1.6;
}

.hds-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.7;
  border: 1px solid transparent;
}
.hds-badge-on {
  color: var(--dsw-alias-state-success-primary, #2f9e44);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
}
.hds-badge-builtin {
  color: var(--dsw-alias-label-tertiary, #8a8a8a);
  border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18));
}

/* ── 生词本标签 ──────────────────────────────────────────── */

.hds-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 180px;
  overflow: auto;
  padding: 4px 0;
}

.hds-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
  font-size: 13px;
  line-height: 1.6;
  transition: border-color .12s ease;
}
.hds-chip:hover { border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.22)); }

.hds-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-tertiary, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background-color .12s ease, color .12s ease;
}
.hds-chip-x:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
}

/* ── 状态提示 ────────────────────────────────────────────── */

.hds-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
}
.hds-note-ok {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 10%, transparent);
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}
.hds-note-err {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.hds-note-info {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.10));
  color: var(--dsw-alias-label-secondary, #6b6b6b);
}

.hds-stat {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
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
      `系统自带三个：核心词库 ${dictInfo?.entries ? `${dictInfo.entries.toLocaleString()} 词` : ''}、词根库、双语例句库。其余按需下载，装了才会参与查词。`,
      [
        h('div', { key: 'cards', className: 'hds-cards' },
          WORD_PACKS.map((pack) => {
            const installed = pack.builtin || Boolean(packs[pack.id])
            const loading = busy === pack.id
            return h('div', {
              key: pack.id,
              className: 'hds-card',
              'data-installed': installed ? '' : undefined,
            }, [
              h('div', { key: 'm', className: 'hds-card-main' }, [
                h('div', { key: 'n', className: 'hds-card-name' }, [
                  h('span', { key: 't' }, pack.name),
                  pack.builtin
                    ? h('span', { key: 'b', className: 'hds-badge hds-badge-builtin' }, '系统自带')
                    : installed
                      ? h('span', { key: 'b', className: 'hds-badge hds-badge-on' }, '已启用')
                      : null,
                ]),
                h('div', { key: 'd', className: 'hds-card-meta' }, pack.desc),
              ]),
              pack.builtin
                ? null
                : h('button', {
                  key: 'btn',
                  className: `hds-btn hds-btn-sm${installed ? '' : ' hds-btn-primary'}`,
                  type: 'button',
                  disabled: loading,
                  onClick: () => onTogglePack(pack),
                }, loading ? '处理中…' : installed ? '停用' : '下载'),
            ])
          }),
        ),
        h('div', { key: 'note', className: 'hds-note hds-note-info' },
          '自定义词库：把 ECDICT 格式的 CSV 放到插件的 data/packs/ 目录，重启后在设置里就会出现。'),
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
      field('s3', '显示考纲标签', h('button', {
        className: 'hds-switch',
        type: 'button',
        role: 'switch',
        'aria-checked': ux.appearance.showTags !== false ? 'true' : 'false',
        'data-on': ux.appearance.showTags !== false ? '' : undefined,
        onClick: () => patchAppearance('showTags', ux.appearance.showTags === false),
      })),
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
  { id: 'core', name: '核心词库', builtin: true, desc: '20,499 个考纲核心词：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE。' },
  { id: 'roots', name: '词根词缀库', builtin: true, desc: '6,374 个词的词根词缀拆解，来自 ECDICT 词根库。' },
  { id: 'examples', name: '双语例句库', builtin: true, desc: '8,960 个词的中英对照例句，来自 Tatoeba，CC BY 2.0 FR。' },
  { id: 'cet', name: '四六级专项', desc: '教育部四六级大纲词汇，按考纲顺序补充超纲词与近义词辨析。' },
  { id: 'kaoyan', name: '考研英语专项', desc: '考研英语一 / 二大纲词汇，含真题高频词与长难句例句。' },
  { id: 'ielts', name: '雅思专项', desc: 'IELTS 学术类与培训类高频词，含听力场景词与写作替换词。' },
  { id: 'toefl', name: '托福专项', desc: 'TOEFL 学科词汇：生物、地质、天文、艺术史等讲座高频词。' },
  { id: 'collins', name: '柯林斯星级词', desc: '柯林斯词典 1–5 星词汇，按使用频率分级，适合按频率背诵。' },
  { id: 'business', name: '商务英语', desc: 'BEC 与外贸函电常用词：谈判、合同、物流、财务、邮件套语。' },
  { id: 'it', name: 'IT 与新技术词', desc: 'AI、云计算、前端框架、开源生态里的新词与缩写，词典里通常查不到。' },
  { id: 'daily', name: '日常口语', desc: '口语高频短语与俚语，含常见搭配与场景例句。' },
  { id: 'wordnet', name: 'WordNet 同义网络', desc: '英文释义与同反义词网络，用于补充词义细节，CC BY 4.0。' },
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
