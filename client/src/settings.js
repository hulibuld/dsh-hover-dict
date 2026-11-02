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
import { makePrimitives } from './ui.js'
import { parseImportText } from './wordbook.js'

/** 设置面板的样式。 */
const CSS = `
/* ═══════════════════════════════════════════════════════════════════════
   英语翻译设置 · 视觉系统
   参照 dsh-get-it-for-free 的 ofm 设计语言：
   分层用 --dsw-alias-bg-layer-1/2/3，按钮用细边 + 内高光 + 悬停扫光，
   卡片带拉丝细纹底与外投影。昼夜由宿主切换，这里不写死颜色。
   ═══════════════════════════════════════════════════════════════════════ */

/** 字号标度：三档，不再散成五档 */
.hds-page {
  --ease-instrument: cubic-bezier(.16,1,.3,1);
  --ease-settle: cubic-bezier(.34,1.4,.4,1);
  --fs-title: 15px;
  --fs-body: 13px;
  --fs-small: 11.5px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 820px;
  /* 不通栏贴左：宽屏下居中，两侧留白 */
  margin-inline: auto;
  width: 100%;
  padding: 4px 0 32px;
  font-size: var(--fs-body);
  line-height: 1.8;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  -webkit-font-smoothing: antialiased;
}
.hds-page * { box-sizing: border-box; }

/* ── 页面头 ──────────────────────────────────────────────────────────── */
.hds-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 2px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
}
.hds-header-line {
  display: flex;
  align-items: center;
  gap: 10px;
}
.hds-header-icon { font-size: 20px; line-height: 1; }
.hds-header-title {
  margin: 0;
  font-size: 20px;
  font-weight: 680;
  letter-spacing: -.3px;
  line-height: 1.4;
}
.hds-header-desc {
  margin: 0;
  max-width: 58ch;
  font-size: var(--fs-body);
  line-height: 1.85;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-header-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}
.hds-stat-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  font-size: var(--fs-small);
  line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-stat-chip b {
  font-size: 12.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.hds-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 分区：一张卡片 ──────────────────────────────────────────────────── */
.hds-section {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
    var(--dsw-alias-bg-layer-2, #ffffff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
  overflow: hidden;
}

.hds-head {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 15px 18px 13px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
}

.hds-title {
  margin: 0;
  font-size: var(--fs-title);
  font-weight: 680;
  letter-spacing: -.15px;
  line-height: 1.5;
}

.hds-subtitle {
  margin: 0;
  font-size: var(--fs-body);
  font-weight: 650;
  line-height: 1.6;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.hds-hint {
  margin: 0;
  font-size: var(--fs-small);
  line-height: 1.9;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}

.hds-stack { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 18px; }
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
  color: var(--dsw-alias-label-secondary, #5c5c5c);
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
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
  color: var(--dsw-alias-label-primary, #1a1a1a);
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
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 7%, var(--dsw-alias-bg-layer-2, #ffffff));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
}

/* 按下：快速陷落 + 内阴影加深 */
.hds-btn:active:not(:disabled) {
  transform: scale(.985);
  transition-duration: .09s;
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%);
}

.hds-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: 2px;
}

.hds-btn:disabled { opacity: .45; cursor: default; box-shadow: none; transform: none; }
.hds-btn:disabled::after { content: none; }

.hds-btn-primary {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #fff),
    var(--dsw-alias-brand-primary, #4d6bfe));
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 82%, #000);
  color: var(--dsw-alias-label-primary, #fff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%),
              inset 0 -10px 18px -12px rgb(0 0 0 / 24%);
}
.hds-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg,
    var(--dsw-alias-brand-primary, #4d6bfe),
    color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #000));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 26%),
              inset 0 -10px 18px -12px rgb(0 0 0 / 18%);
}

.hds-btn-ghost {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-btn-ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 80%, transparent);
  border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.hds-btn-ghost::after { content: none; }

.hds-btn-danger {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 55%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.hds-btn-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 8%, var(--dsw-alias-bg-layer-2, #ffffff));
  border-color: var(--dsw-alias-state-error-primary, #e5484d);
}

.hds-btn-sm { min-height: 28px; padding: 4px 12px; font-size: 11.5px; border-radius: 7px; }

/* ── 输入 ────────────────────────────────────────────────────────────── */
.hds-input, .hds-select {
  font: inherit;
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 10%);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  min-width: 0;
  transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
}
.hds-input:hover, .hds-select:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, var(--dsw-alias-brand-primary, #4d6bfe));
}
.hds-input:focus, .hds-select:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 8%),
              0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
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
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%),
              inset 0 2px 6px -2px rgb(0 0 0 / 10%);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  resize: vertical;
  transition: border-color .18s var(--ease-instrument), box-shadow .2s var(--ease-instrument);
}
.hds-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: inset 0 2px 6px -2px rgb(0 0 0 / 8%),
              0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
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
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
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
  background: var(--dsw-alias-label-primary, #1a1a1a);
  box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%);
  transition: transform .28s var(--ease-settle),
              background .2s var(--ease-instrument),
              width .14s var(--ease-instrument);
}

.hds-switch:active .hds-switch-track::after { width: 18px; }

.hds-switch[aria-checked="true"] .hds-switch-track {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 85%, #000);
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 14%), inset 0 -1px 0 rgb(255 255 255 / 8%);
}
.hds-switch[aria-checked="true"] .hds-switch-track::after {
  transform: translateX(17px);
  background: var(--dsw-alias-label-primary, #fff);
}
.hds-switch[aria-checked="true"]:active .hds-switch-track::after {
  transform: translateX(14px);
}
.hds-switch:focus-visible .hds-switch-track {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 22%, transparent);
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
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  /* 拉丝细纹垫底：从边缘隐约透出，不做成显眼图案 */
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%),
              inset 0 -12px 24px -16px rgb(0 0 0 / 14%);
  transition: transform .22s var(--ease-instrument),
              box-shadow .26s var(--ease-instrument),
              border-color .2s var(--ease-instrument);
}

.hds-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 58%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
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
  color: var(--dsw-alias-label-secondary, #5c5c5c);
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
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18));
}
.hds-badge-on {
  color: var(--dsw-alias-state-success-primary, #2f9e44);
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
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
  background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c5c5c) 32%, transparent);
  border-radius: 5px;
}

.hds-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  font-size: 12.5px;
  line-height: 1.7;
  transition: border-color .18s var(--ease-instrument), background .18s var(--ease-instrument);
}
.hds-chip:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, var(--dsw-alias-brand-primary, #4d6bfe));
}

.hds-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px; height: 19px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background .16s ease, color .16s ease;
}
.hds-chip-x:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent);
  color: var(--dsw-alias-state-error-primary, #e5484d);
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
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 9%, transparent);
}
.hds-note-err {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 9%, transparent);
}
.hds-note-info {
  border-color: var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 70%, transparent);
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}

.hds-stat { font-variant-numeric: tabular-nums; font-weight: 600; }

.hds-path {
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 11.5px;
  line-height: 1.9;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
  color: var(--dsw-alias-label-secondary, #5c5c5c);
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
/** 生词本一次最多渲染多少个 chip。超出的用一句「还有 N 个」交代，不静默截断。 */
const CHIP_LIMIT = 120

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
  const [clearPending, setClearPending] = useState(false)
  const [maxHanRatio, setMaxHanRatio] = useState(() => readMaxHanRatioRaw(storage))

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

  /**
   * 清空生词本。
   *
   * 用内联二次确认，不用原生对话框 —— 系统弹窗会打断页面观感，
   * 而且在设置页里弹一个原生弹窗像出错了。
   */
  const onClear = () => {
    if (!book) return
    const total = book.size()
    if (total === 0) { say('生词本已经是空的', 'info'); return }
    if (!clearPending) {
      setClearPending(true)
      say(`再点一次「确认清空」会删掉 ${total} 个生词，这个操作不能撤销。`, 'info')
      return
    }
    setClearPending(false)
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

  /* ── 用共用原语组装 ── */
  const P = makePrimitives(h)
  const { Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page, GAP, C, FS } = P

  const section = (key, title, hint, children, action) => h(Card, {
    key,
    title,
    hint,
    action,
  }, children)

  const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

  return h(Page, null, [
    h(PageHeader, {
      key: 'hdr',
      title: '英语翻译',
      desc: '在对话里点击或划选英文单词看释义，划选纯英文句子翻成中文。生词本会自动高亮你已经背过的词。',
      extra: [
        h(Badge, { key: 'b', text: '离线', tone: 'success' }),
        h(Badge, { key: 'c', text: `${(dictInfo?.entries ?? 20499).toLocaleString()} 词条`, tone: 'neutral' }),
      ],
    }),

    /* 翻译接口 */
    section('tr', '翻译接口',
      '划选纯英文句子时用哪个服务。三项都不需要额外密钥。',
      [
        field('f1', '翻译服务', h(Select, {
          value: translator,
          options: [
            { value: 'auto', label: '自动（先用 Google，失败换 Bing）' },
            { value: 'google', label: 'Google 翻译' },
            { value: 'bing', label: 'Bing 翻译' },
            { value: 'off', label: '关闭句子翻译' },
          ],
          onChange: (value) => { setTranslator(value); writeTranslator(storage, value) },
        })),
      ]),

    /* 词库 */
    section('packs', '词库与句子库',
      '系统自带三个，随插件分发，完全离线。其余词库可以自己加。',
      [
        h('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } },
          WORD_PACKS.map((pack) => h('div', {
            key: pack.id,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: GAP.md,
              padding: '13px 15px',
              borderRadius: 13,
              border: `1px solid ${C.border2}`,
              background: C.bg1,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
            },
          }, [
            h('div', { key: 'm', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 } }, [
              h('div', { key: 'n', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
                h('span', { key: 't', style: { fontSize: FS.body, fontWeight: 650, color: C.text } }, pack.name),
                h(Badge, { key: 'b', text: '系统自带', tone: 'neutral' }),
              ]),
              h('div', { key: 'd', style: { fontSize: FS.small, lineHeight: 1.85, color: C.textFaint } }, pack.desc),
            ]),
          ])),
        ),
        h('div', { key: 'custom', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } }, [
          h('h4', { key: 't', style: { margin: 0, fontSize: FS.body, fontWeight: 650, color: C.text } }, '自己加词库'),
          h('p', { key: 'h', style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textDim } },
            '把词库文件放进下面这个目录，重启 DSH 后自动加载。支持 ECDICT 的 CSV（只要有 word 与 translation 两列），或者与 dict.dat 同构的 JSON。'),
          h('div', { key: 'row', style: { display: 'flex', alignItems: 'center', gap: GAP.sm, flexWrap: 'wrap' } }, [
            h('code', {
              key: 'p',
              style: {
                flex: 1, minWidth: 200,
                fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
                fontSize: FS.small, lineHeight: 1.9,
                padding: '8px 12px', borderRadius: 8,
                border: `1px dashed ${C.border2}`,
                background: C.bgBase, color: C.textFaint,
                userSelect: 'all',
                overflowWrap: 'anywhere',
              },
            }, packsDir),
            h(Button, {
              key: 'copy', label: '复制路径', size: 'sm',
              onClick: (event) => {
                const btn = event?.currentTarget
                const done = () => {
                  if (btn) btn.textContent = '已复制'
                  setTimeout(() => { if (btn) btn.textContent = '复制路径' }, 1400)
                }
                try { navigator.clipboard?.writeText(packsDir).then(done, () => {}) } catch { /* ignore */ }
              },
            }),
          ]),
        ]),
        h(Note, {
          key: 'note',
          tone: 'info',
          text: `当前 ${(dictInfo?.entries ?? 20499).toLocaleString()} 个词条 · `
            + `${(dictInfo?.examples ?? 8960).toLocaleString()} 个带双语例句 · `
            + `${(dictInfo?.roots ?? 6374).toLocaleString()} 个带词根分析`,
        }),
      ]),

    /* 生词本 */
    section('book', '生词本',
      `已收藏 ${bookSize} 个词。支持从有道、欧路、百词斩导出的内容直接粘贴，一行一个。`,
      [
        bookSize > 0
          ? h('div', { key: 'chips', className: 'hds-chips' },
            bookWords.slice(0, CHIP_LIMIT).map((item) => h('span', { key: item.head, className: 'hds-chip' }, [
              h('span', { key: 'w' }, item.head),
              h('button', {
                key: 'x', className: 'hds-chip-x', type: 'button', title: '移出',
                onClick: () => book.remove(item.head),
              }, '×'),
            ])),
          )
          : h('p', { key: 'empty', style: { margin: 0, fontSize: FS.small, lineHeight: 1.85, color: C.textFaint } },
            '还没有生词。在对话里点开一个词，点标题旁边的 ☆ 就能收进来。'),

        bookSize > CHIP_LIMIT
          ? h('p', { key: 'more', style: { margin: 0, fontSize: FS.small, color: C.textFaint } },
            `只显示了前 ${CHIP_LIMIT} 个，还有 ${bookSize - CHIP_LIMIT} 个。用搜索或导出来看全部。`)
          : null,

        h(Input, {
          key: 'ta',
          multiline: true,
          value: importText,
          placeholder: '粘贴单词表，一行一个。有道的导出内容可以直接贴（每行第一个词会被识别）。',
          onChange: setImportText,
        }),

        h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Button, {
            key: 'import', label: '导入', variant: 'primary',
            disabled: importText.trim() === '', busy: busy === 'import',
            onClick: onImport,
          }),
          h(Button, {
            key: 'export', label: '导出为 txt',
            disabled: bookSize === 0, onClick: onExport,
          }),
          h(Button, {
            key: 'clear',
            label: clearPending ? '确认清空' : '清空',
            variant: clearPending ? 'primary' : 'danger',
            disabled: busy === 'clear' || bookSize === 0,
            onClick: onClear,
          }),
          clearPending
            ? h(Button, {
              key: 'cancel', label: '取消', variant: 'ghost',
              onClick: () => { setClearPending(false); setMessage(null) },
            })
            : null,
        ]),
      ]),

    /* 显示 */
    section('ui', '显示', null, [
      field('s1', '浮层释义条数',
        h(Input, {
          type: 'number', value: String(ux.appearance.maxSensesInPopover),
          onChange: (v) => patchAppearance('maxSensesInPopover', Number(v)),
          style: { maxWidth: 110 },
        })),
      field('s2', '卡片宽度',
        h(Input, {
          type: 'number', value: String(ux.appearance.cardMaxWidthPx),
          onChange: (v) => patchAppearance('cardMaxWidthPx', Number(v)),
          style: { maxWidth: 130 },
        })),
      field('s3', '中文占比超过多少不翻译',
        h(Input, {
          type: 'number',
          value: String(Math.round(maxHanRatio * 100)),
          onChange: (v) => {
            const pct = Math.max(0, Math.min(100, Number(v) || 0))
            setMaxHanRatio(pct / 100)
            try { storage?.setItem?.('dsh-hover-dict:maxHanRatio', String(pct / 100)) } catch { /* ignore */ }
          },
          style: { maxWidth: 110 },
        }),
        '按百分比算：汉字数 ÷（汉字 + 英文字母）。超过这个比例就完全不弹窗，既不翻译也不提示。设 0 表示只要有一个汉字就不翻。'),

      field('s4', '显示考纲标签',
        h(Switch, {
          checked: ux.appearance.showTags !== false,
          onChange: (next) => patchAppearance('showTags', next),
          label: ux.appearance.showTags !== false ? '显示' : '隐藏',
        })),
    ]),

    message !== null
      ? h(Note, {
        key: 'msg',
        tone: message.tone === 'err' ? 'err' : message.tone === 'info' ? 'info' : 'ok',
        text: message.text,
      })
      : null,
  ])
}

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

/** 读中文占比上限，默认 0.1（10%）。 */
export function readMaxHanRatioRaw(storage) {
  try {
    const raw = storage?.getItem?.('dsh-hover-dict:maxHanRatio')
    if (raw !== null && raw !== undefined && raw !== '') {
      const value = Number(raw)
      if (Number.isFinite(value) && value >= 0 && value <= 1) return value
    }
  } catch { /* ignore */ }
  return 0.1
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
