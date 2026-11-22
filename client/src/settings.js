/**
 * settings.js —— 插件设置面板（挂在 Plugins 页的插件详情里）。
 *
 * v2 起改成**顶部 tab 导航**五个页签（设计-v2 §B）：
 *   1. 生词本   —— 统计条 + 搜索/筛选/词书/排序 + 表格分页 + 批量操作 + 导出
 *   2. 复习     —— 刷词卡（review.js 提供出题与评分，这里只画）
 *   3. 导入     —— 粘贴/文件 → 解析预览 → 确认写库（importer.js 负责解析）
 *   4. 外观与交互 —— 原有字段全保留，另含词库与句子库、翻译接口
 *   5. 有道同步 —— 本任务先放占位（D 任务填充真实面板）
 *
 * 所有设置存在 localStorage，不走宿主 Config —— 这些是界面偏好，
 * 为了让用户改一个数字去重启宿主是不合理的。
 */

import {
  loadUx, saveUx, DEFAULT_MARK_COLOR, MARK_COLOR_PRESETS,
} from './config.js'
// 预览必须与实际渲染用同一个颜色解析：theme-error 哨兵 → var(--dsw-alias-state-error-primary,…)。
// 自己另写一套（比如把哨兵当 hex 塞进 color-mix）会让预览与正文对不上。
import { markColorToCss } from './marker.js'
import { makePrimitives } from './ui.js'
import { parseImportDetailed, summarizeImport, glossText, IMPORT_FORMATS } from './importer.js'
import { API_PREFIX } from './net.js'
// §E1 复习背面发音：复用 review.js 那一套（canSpeak/speakWord 在里面），
// 不在这里另写发音逻辑 —— card.js 与复习卡共用同一份实现。
// 注意：注释不能写在上面的 import 花括号内部，构建器按逗号切名字会把它当导入名。
import {
  GRADE_BUTTONS, REVIEW_FILTERS, DIRECTIONS, AHEAD_COUNT,
  filterQueue, queueForDirection, cardBackFor, roundSummary, dueLabel,
  aheadQueue, shouldHandleKey, actionForKey, briefTextFor, booksOfEntry,
  ReviewCardBack, PronounceButton, canSpeak,
} from './review.js'
import { briefOf, describeEntry } from './dict.js'
import { normalizeKey } from './word.js'

/**
 * 生词本表格每页行数（设计 §B1：50 行一页）。
 *
 * v1 这里是个 chips 墙，用 CHIP_LIMIT=120 硬截断，超出的只留一句「还有 N 个」。
 * v2 改成真分页：全部词都能翻到，所以 CHIP_LIMIT 这个常量已经删掉了 ——
 * 现在「上限有交代」由下面的 PAGE_SIZE 与 PREVIEW_ROW_LIMIT 承担。
 */
const PAGE_SIZE = 50

/**
 * 导入预览表最多渲染多少行。
 *
 * 预览是给眼睛看的，不是给人滚两万行用的：词表可能两万条（有道上限），
 * 全渲染会卡死面板。**截断的只是预览的显示**，确认导入时仍然导入全部 ——
 * 所以这不是静默丢词，表格下面会明确写出「还有 N 行没显示，仍会全部导入」。
 */
const PREVIEW_ROW_LIMIT = 200

/** 状态 → 中文名与徽章语气。四色：new 灰 / unknown 红 / fuzzy 橙 / known 绿。 */
const STATE_META = {
  new: { label: '未学', tone: 'neutral' },
  unknown: { label: '不认识', tone: 'danger' },
  fuzzy: { label: '记错', tone: 'warn' },
  known: { label: '已掌握', tone: 'success' },
}

/** 来源 → 中文短名。 */
const SOURCE_LABEL = {
  dsh: '划词',
  youdao: '有道',
  manual: '手动',
  import: '导入',
}

/** 排序方式。 */
const SORT_OPTIONS = [
  { id: 'recent', label: '最近添加' },
  { id: 'stale', label: '最久未复习' },
  { id: 'alpha', label: '字母序' },
]

/** 设置面板的样式。 */
const CSS = `
/* ═══════════════════════════════════════════════════════════════════════
   英语翻译设置 · 视觉系统
   分层用 --dsw-alias-bg-layer-1/2，按钮细边 + 内高光 + 悬停扫光，
   卡片带拉丝细纹底与外投影。昼夜由宿主切换，这里不写死颜色。
   ═══════════════════════════════════════════════════════════════════════ */

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
  margin-inline: auto;
  width: 100%;
  padding: 4px 0 32px;
  font-size: var(--fs-body);
  line-height: 1.8;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  -webkit-font-smoothing: antialiased;
}
.hds-page * { box-sizing: border-box; }

.hds-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 2px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
}
.hds-header-line { display: flex; align-items: center; gap: 10px; }
.hds-header-icon { font-size: 20px; line-height: 1; }
.hds-header-title {
  margin: 0; font-size: 20px; font-weight: 680; letter-spacing: -.3px; line-height: 1.4;
}
.hds-header-desc {
  margin: 0; max-width: 58ch; font-size: var(--fs-body); line-height: 1.85;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-header-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.hds-stat-chip {
  display: inline-flex; align-items: baseline; gap: 3px;
  padding: 4px 11px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  font-size: var(--fs-small); line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-stat-chip b {
  font-size: 12.5px; font-weight: 650; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.hds-root { display: flex; flex-direction: column; gap: 16px; }

.hds-section {
  display: flex; flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
    var(--dsw-alias-bg-layer-2, #ffffff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
  overflow: hidden;
}
.hds-head {
  display: flex; flex-direction: column; gap: 5px;
  padding: 15px 18px 13px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
}
.hds-title {
  margin: 0; font-size: var(--fs-title); font-weight: 680;
  letter-spacing: -.15px; line-height: 1.5;
}
.hds-subtitle {
  margin: 0; font-size: var(--fs-body); font-weight: 650; line-height: 1.6;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.hds-hint {
  margin: 0; font-size: var(--fs-small); line-height: 1.9;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-stack { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 18px; }
.hds-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.hds-field { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
.hds-field > .hds-label {
  font-size: 12.5px; line-height: 1.7;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}

.hds-btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 32px; padding: 6px 16px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 7%);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font: inherit; font-size: 12.5px; font-weight: 580; line-height: 1.4;
  cursor: pointer; white-space: nowrap;
  transition:
    transform .16s var(--ease-settle),
    border-color .2s var(--ease-instrument),
    background .2s var(--ease-instrument),
    box-shadow .2s var(--ease-instrument),
    opacity .16s ease;
  -webkit-tap-highlight-color: transparent;
}
.hds-btn::after {
  content: ""; position: absolute; top: 0; bottom: 0; left: -60%; width: 42%;
  background: linear-gradient(100deg, transparent, rgb(255 255 255 / 14%), transparent);
  transform: skewX(-18deg); transition: left .5s var(--ease-instrument);
  pointer-events: none;
}
.hds-btn:hover:not(:disabled)::after { left: 118%; }
.hds-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 7%, var(--dsw-alias-bg-layer-2, #ffffff));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 10%);
}
.hds-btn:active:not(:disabled) {
  transform: scale(.985); transition-duration: .09s;
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 14%), inset 0 1px 0 rgb(255 255 255 / 3%);
}
.hds-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 2px;
}
.hds-btn:disabled { opacity: .45; cursor: default; box-shadow: none; transform: none; }
.hds-btn:disabled::after { content: none; }

.hds-btn-primary {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #fff),
    var(--dsw-alias-brand-primary, #4d6bfe));
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 82%, #000);
  color: var(--dsw-alias-label-primary, #fff);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 22%), inset 0 -10px 18px -12px rgb(0 0 0 / 24%);
}
.hds-btn-primary:hover:not(:disabled) {
  background: linear-gradient(180deg,
    var(--dsw-alias-brand-primary, #4d6bfe),
    color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 88%, #000));
}
.hds-btn-ghost {
  background: transparent; border-color: transparent; box-shadow: none;
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

.hds-input, .hds-select {
  font: inherit; font-size: 13px; padding: 8px 12px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 10%);
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
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 8%),
              0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 16%, transparent);
}
.hds-input[type="number"] { max-width: 110px; }

.hds-textarea {
  width: 100%; min-height: 128px;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: 12.5px; line-height: 1.85; padding: 12px 14px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%), inset 0 2px 6px -2px rgb(0 0 0 / 10%);
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

/* ── 开关 ─────────────────────────────────────────────────────────────── */
.hds-switch {
  display: inline-flex; align-items: center; gap: 9px; cursor: pointer;
  user-select: none; appearance: none; background: transparent; border: 0;
  padding: 0; font: inherit; color: inherit; -webkit-tap-highlight-color: transparent;
}
.hds-switch-track {
  width: 38px; height: 21px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  box-shadow: inset 0 1px 3px rgb(0 0 0 / 10%), inset 0 -1px 0 rgb(255 255 255 / 4%);
  position: relative; flex: none;
  transition: background .22s var(--ease-instrument), border-color .22s var(--ease-instrument),
              box-shadow .22s var(--ease-instrument);
}
.hds-switch-track::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
  border-radius: 50%; background: var(--dsw-alias-label-primary, #1a1a1a);
  box-shadow: 0 1px 3px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 20%);
  transition: transform .28s var(--ease-settle), background .2s var(--ease-instrument),
              width .14s var(--ease-instrument);
}
.hds-switch:active .hds-switch-track::after { width: 18px; }
.hds-switch[aria-checked="true"] .hds-switch-track {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 85%, #000);
}
.hds-switch[aria-checked="true"] .hds-switch-track::after {
  transform: translateX(17px); background: var(--dsw-alias-label-primary, #fff);
}
.hds-switch[aria-checked="true"]:active .hds-switch-track::after { transform: translateX(14px); }
.hds-switch:focus-visible .hds-switch-track {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 22%, transparent);
}
.hds-switch-text { font-size: 13px; line-height: 1.7; }

/* ── 卡片 ─────────────────────────────────────────────────────────────── */
.hds-card {
  display: flex; align-items: center; gap: 14px; padding: 13px 15px;
  border-radius: 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4.5%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 84%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), inset 0 -12px 24px -16px rgb(0 0 0 / 14%);
  transition: transform .22s var(--ease-instrument), box-shadow .26s var(--ease-instrument),
              border-color .2s var(--ease-instrument);
}
.hds-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 58%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
}
.hds-card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.hds-card-name {
  display: flex; align-items: center; gap: 8px;
  font-size: 13.5px; font-weight: 650; letter-spacing: -.1px; line-height: 1.55;
}
.hds-card-meta {
  font-size: 12px; line-height: 1.85;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}

/* ── 状态徽章 ─────────────────────────────────────────────────────────── */
.hds-badge {
  display: inline-flex; align-items: center; padding: 1px 8px;
  border-radius: 999px; font-size: 10.5px; font-weight: 500; line-height: 1.7;
  border: 1px solid transparent; white-space: nowrap;
}
.hds-badge-new { color: var(--dsw-alias-label-secondary, #5c5c5c); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); }
.hds-badge-unknown { color: var(--dsw-alias-state-error-primary, #e5484d); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent); }
.hds-badge-fuzzy { color: var(--dsw-alias-state-warn-primary, #f0a441); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f0a441) 45%, transparent); }
.hds-badge-known { color: var(--dsw-alias-state-success-primary, #2f9e44); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 45%, transparent); }
.hds-badge-builtin { color: var(--dsw-alias-label-secondary, #5c5c5c); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.18)); }

/* ── 词表 ─────────────────────────────────────────────────────────────── */
.hds-table { display: flex; flex-direction: column; border-radius: 11px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
.hds-thead, .hds-trow {
  display: grid;
  grid-template-columns: 28px minmax(96px, 1.3fr) 78px 96px 74px minmax(120px, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
}
.hds-thead {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 92%, transparent);
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  font-size: 11px; line-height: 1.6;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  letter-spacing: .02em;
}
.hds-trow {
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 60%, transparent);
  font-size: 12.5px; line-height: 1.7;
  transition: background .16s var(--ease-instrument);
}
.hds-trow:last-child { border-bottom: 0; }
.hds-trow:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 4%, transparent); }
.hds-thead > span, .hds-trow > span { min-width: 0; }
.hds-cell-head {
  font-weight: 650; letter-spacing: -.1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hds-cell-head button {
  font: inherit; color: inherit; background: none; border: 0; padding: 0;
  cursor: pointer; text-align: left;
  border-bottom: 1px dashed color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 80%, transparent);
}
.hds-cell-head button:hover { color: var(--dsw-alias-brand-primary, #4d6bfe); border-bottom-color: currentColor; }
.hds-cell-dim { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); font-variant-numeric: tabular-nums; }
.hds-cell-ops { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.hds-detail {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; gap: 8px;
  margin: 2px 0 6px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 70%, transparent);
  font-size: 12.5px; line-height: 1.85;
}
.hds-detail-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
.hds-detail-key { flex: none; min-width: 44px; font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); }
.hds-detail-val { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.hds-detail-sense { display: flex; gap: 6px; flex-wrap: wrap; }
.hds-detail-pos {
  flex: none; font-size: 10.5px; padding: 0 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  color: var(--dsw-alias-label-secondary, #5c5c5c); line-height: 1.7;
}

/* ── 分页 ─────────────────────────────────────────────────────────────── */
.hds-pager {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap;
  padding-top: 2px;
  font-size: var(--fs-small);
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  font-variant-numeric: tabular-nums;
}

/* ── 打卡格子 ─────────────────────────────────────────────────────────── */
.hds-heat { display: flex; gap: 4px; align-items: flex-end; flex-wrap: wrap; }
.hds-heat-cell {
  width: 15px; height: 15px; border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 70%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-secondary, #5c5c5c) 12%, transparent);
}
.hds-heat-legend {
  display: flex; align-items: center; gap: 5px;
  font-size: 10.5px; color: var(--dsw-alias-label-secondary, #5c5c5c);
}

/* ── 状态占比条 ───────────────────────────────────────────────────────── */
.hds-bar {
  display: flex; height: 9px; border-radius: 999px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 80%, transparent);
}
.hds-bar > span { display: block; height: 100%; }

/* ── 导入预览 ─────────────────────────────────────────────────────────── */
.hds-preview { display: flex; flex-direction: column; gap: 10px; }
.hds-preview-table {
  display: flex; flex-direction: column; border-radius: 11px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  max-height: 360px; overflow-y: auto;
}
.hds-preview-row {
  display: grid;
  grid-template-columns: 40px minmax(90px, 1.1fr) 74px minmax(120px, 1.6fr);
  gap: 10px; align-items: center;
  padding: 7px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(0,0,0,.10)) 60%, transparent);
  font-size: 12.5px; line-height: 1.7;
}
.hds-preview-row:last-child { border-bottom: 0; }
.hds-preview-line { font-size: 11px; color: var(--dsw-alias-label-secondary, #5c5c5c); font-variant-numeric: tabular-nums; }
.hds-preview-gloss {
  font-size: 12px; color: var(--dsw-alias-label-secondary, #5c5c5c);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hds-preview-skip {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 13px; border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  font-size: 11.5px; line-height: 1.8;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-skip-row { display: flex; gap: 8px; }
.hds-skip-line { flex: none; min-width: 34px; font-variant-numeric: tabular-nums; }

/* ── 复习卡 ───────────────────────────────────────────────────────────── */
.hds-review-top {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: space-between;
}
.hds-cardstage {
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: 26px 20px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 4%) 0 1px, transparent 1px 2.5px) padding-box,
    color-mix(in srgb, var(--dsw-alias-bg-layer-2, #ffffff) 88%, transparent);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 10px 26px -18px rgb(0 0 0 / 30%);
  min-height: 190px;
  justify-content: center;
  text-align: center;
  cursor: pointer;
}
.hds-cardstage-word {
  font-size: 30px; font-weight: 680; letter-spacing: -.6px; line-height: 1.3;
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
.hds-cardstage-back { display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; }
/* .hds-cardstage-sense / .hds-cardstage-example 已随之删除：
   背面的义项与例句现在由 review.js 的 ReviewCardBack 内联渲染，
   留着这两条规则等于一份无人使用的样式债。 */
.hds-cardstage-tip { font-size: 11.5px; color: var(--dsw-alias-label-secondary, #5c5c5c); }
.hds-grade-row { display: flex; gap: 10px; flex-wrap: wrap; }
.hds-grade-btn {
  flex: 1 1 110px;
  display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 9px 14px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-primary, #1a1a1a);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: transform .16s var(--ease-settle), border-color .2s var(--ease-instrument),
              background .2s var(--ease-instrument);
}
.hds-grade-btn:hover:not(:disabled) { transform: translateY(-1px); }
.hds-grade-btn:active:not(:disabled) { transform: scale(.985); }
.hds-grade-btn:disabled { opacity: .45; cursor: default; }
.hds-grade-btn small { font-size: 10.5px; font-weight: 450; opacity: .7; }
.hds-grade-again {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  color: var(--dsw-alias-state-error-primary, #e5484d);
}
.hds-grade-hard {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f0a441) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  color: var(--dsw-alias-state-warn-primary, #f0a441);
}
.hds-grade-good {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 50%, var(--dsw-alias-border-l2, rgba(0,0,0,.18)));
  color: var(--dsw-alias-state-success-primary, #2f9e44);
}

/* ── 提示条 ──────────────────────────────────────────────────────────── */
.hds-note {
  display: flex; gap: 9px; padding: 10px 13px; border-radius: 11px;
  border: 1px solid; font-size: 12px; line-height: 1.8;
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
  font-size: 11.5px; line-height: 1.9; padding: 8px 12px; border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  user-select: all;
}

/* ── 有道同步页签（设计 §D3） ─────────────────────────────────────── */

.hds-steps { display: flex; flex-direction: column; gap: 0; margin: 0; padding: 0; list-style: none; }
.hds-step {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 9px 0; font-size: var(--fs-small); line-height: 1.85;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
}
.hds-step + .hds-step { border-top: 1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
.hds-step-no {
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  margin-top: 2px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 11%, transparent);
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  font-size: 11px; font-weight: 680; font-variant-numeric: tabular-nums;
}
.hds-step-body { flex: 1; min-width: 0; }
.hds-step-body b { color: var(--dsw-alias-label-primary, #1a1a1a); font-weight: 640; }

.hds-status-card {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 15px; border-radius: 13px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10));
  background: var(--dsw-alias-bg-layer-1, #f7f7f8);
}
.hds-status-card[data-tone="ok"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 42%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2f9e44) 8%, transparent);
}
.hds-status-card[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 46%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 9%, transparent);
}
.hds-status-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hds-status-title {
  font-size: var(--fs-body); font-weight: 650; line-height: 1.6;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}
.hds-status-meta {
  font-size: var(--fs-small); line-height: 1.8;
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  font-variant-numeric: tabular-nums;
}

/* 「正在抓取…」进度条。sync 是一次性 POST，没有真实进度，所以是不定长流光条。 */
.hds-progress {
  position: relative; overflow: hidden;
  height: 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-border-l2, rgba(0,0,0,.18)) 55%, transparent);
}
.hds-progress::after {
  content: ""; position: absolute; inset-block: 0; width: 38%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  animation: hds-progress-slide 1.15s cubic-bezier(.5,0,.5,1) infinite;
}
@keyframes hds-progress-slide {
  0% { left: -40%; }
  100% { left: 100%; }
}

/* ── 生词着色设置组（设计 §C4） ─────────────────────────────────── */

.hds-swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
.hds-swatch {
  width: 26px; height: 26px; padding: 0; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  cursor: pointer; position: relative;
  transition: transform .16s cubic-bezier(.16,1,.3,1), box-shadow .16s cubic-bezier(.16,1,.3,1);
}
.hds-swatch:hover { transform: translateY(-1px); }
.hds-swatch[aria-pressed="true"] {
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base, #fff),
              0 0 0 4px var(--dsw-alias-brand-primary, #4d6bfe);
}
.hds-swatch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 3px; }

/* 实时预览句：色块由内联 style 给，这里只管排版 */
.hds-mark-preview {
  padding: 12px 14px; border-radius: 11px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.18));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f7f7f8) 60%, transparent);
  font-size: 14.5px; line-height: 2.1;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  word-break: break-word;
}
.hds-mark-preview[data-off="true"] {
  color: var(--dsw-alias-label-secondary, #5c5c5c);
  font-style: italic;
}

@media (prefers-reduced-motion: reduce) {
  .hds-progress::after { animation: none; left: 20%; }
}

@media (prefers-reduced-motion: reduce) {
  .hds-root .hds-card:hover,
  .hds-root .hds-btn:hover:not(:disabled),
  .hds-root .hds-btn:active:not(:disabled),
  .hds-root .hds-grade-btn:hover:not(:disabled),
  .hds-root .hds-grade-btn:active:not(:disabled) { transform: none; }
  .hds-root .hds-btn::after { content: none; }
}
`

/* ═══════════════════════════════════════════════════════════════════════
   小工具
   ═══════════════════════════════════════════════════════════════════════ */

/** localStorage，失败返回 undefined。 */
function safeLocal() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch { /* ignore */ }
  return undefined
}

/** 状态徽章文案。 */
const stateLabel = (state) => STATE_META[state]?.label ?? '未学'
const stateTone = (state) => STATE_META[state]?.tone ?? 'neutral'

/**
 * 下载一段文本为文件。
 *
 * 不依赖宿主能力，用 Blob + a[download]。失败静默 —— 但返回 false，
 * 让调用方能把「导出失败」说出来（不静默失败）。
 */
function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** CSV 转义：字段里有逗号/引号/换行就包引号。 */
function csvCell(value) {
  const text = String(value ?? '')
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * 导出三件套之一：txt 一行一词。
 */
function exportTxt(entries) {
  return entries.map((entry) => entry.head).join('\n')
}

/**
 * 导出三件套之二：CSV 带状态与释义。
 */
function exportCsv(entries) {
  const rows = [['word', 'state', 'book', 'gloss', 'note', 'due', 'addedAt']]
  for (const entry of entries) {
    rows.push([
      entry.head,
      entry.state,
      entry.bookId,
      entry.gloss,
      entry.note,
      String(entry.srs?.due ?? 0),
      String(entry.addedAt ?? 0),
    ])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** 导出三件套之三：JSON 完整备份（可被导入页恢复）。 */
function exportJson(book) {
  const payload = {
    format: 'dsh-hover-dict/wordbook',
    version: 2,
    exportedAt: new Date().toISOString(),
    books: typeof book?.listBooks === 'function' ? book.listBooks() : [],
    words: typeof book?.exportAll === 'function' ? book.exportAll() : (book?.list?.() ?? []),
  }
  return JSON.stringify(payload, null, 2)
}

/** 排序词条。 */
function sortEntries(entries, mode) {
  const list = entries.slice()
  if (mode === 'alpha') return list.sort((a, b) => a.head.localeCompare(b.head))
  if (mode === 'stale') {
    return list.sort((a, b) => {
      const la = a.srs?.lastReviewAt || a.addedAt || 0
      const lb = b.srs?.lastReviewAt || b.addedAt || 0
      if (la !== lb) return la - lb
      return a.head.localeCompare(b.head)
    })
  }
  return list.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
}

/**
 * 词条搜过滤：词头或释义（含词库释义）。
 */
function matchQuery(entry, query, dict) {
  if (query === '') return true
  const needle = query.toLowerCase()
  if (entry.head.includes(needle)) return true
  if (typeof entry.gloss === 'string' && entry.gloss.toLowerCase().includes(needle)) return true
  const raw = dict?.entries?.[entry.head]
  if (raw) {
    try {
      const brief = briefOf(raw)
      if (typeof brief?.zh === 'string' && brief.zh.toLowerCase().includes(needle)) return true
      if (typeof brief?.pos === 'string' && brief.pos.toLowerCase().includes(needle)) return true
    } catch { /* 词库结构异常就只按词头匹配 */ }
  }
  return false
}

/* ═══════════════════════════════════════════════════════════════════════
   主面板
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 设置面板组件。
 *
 * @param {object} props 宿主注入的 PropsRuntime，含 view 与懒取的 wordbook / dict
 * @returns {import('react').ReactElement | null}
 */
export function SettingsPanel(props) {
  // 只在宿主**明确**说这是 summary 视图时才走摘要分支（沿用 v1 判定）。
  if (props?.view === 'summary') {
    return h('div', { className: 'hds-hint' }, '点选查词 · 生词本 · 离线词库')
  }

  const storage = safeLocal()
  const [ux, setUx] = useState(() => loadUx(storage))
  const [tab, setTab] = useState('book')
  const [message, setMessage] = useState(null)
  const [bookVersion, setBookVersion] = useState(0)

  const book = props?.wordbook
  const dict = props?.dict
  const packsDir = props?.packsDir ?? '~/.dsh/profiles/desktop/node_modules/dsh-hover-dict/data/packs'

  // 生词本一变就重读：stats/list 都是即时计算的，靠版本号触发重渲染
  useEffect(() => {
    if (!book || typeof book.subscribe !== 'function') return undefined
    const off = book.subscribe(() => setBookVersion((n) => n + 1))
    return () => { try { off() } catch { /* ignore */ } }
  }, [book])

  const patchAppearance = (key, value) => {
    saveUx(storage, { appearance: { ...ux.appearance, [key]: value } })
    setUx(loadUx(storage))
  }

  const say = (text, tone = 'ok') => setMessage({ text, tone })

  /** 每次改动后重读一遍本地镜像（book 是外部可变对象）。 */
  const bump = () => setBookVersion((n) => n + 1)

  const stats = (() => {
    try {
      return typeof book?.stats === 'function'
        ? book.stats()
        : { total: book?.size?.() ?? 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, addedToday: 0, reviewedToday: 0, streak: 0, days: [] }
    } catch {
      return { total: 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, addedToday: 0, reviewedToday: 0, streak: 0, days: [] }
    }
  })()
  void bookVersion

  const P = makePrimitives(h)
  const { Card, Button, Switch, Input, Select, Badge, Note, Field, PageHeader, Page,
    Tabs, Stat, Chip, Checkbox, Segment, GAP, FS, C } = P

  const section = (key, title, hint, children, action) => h(Card, { key, title, hint, action }, children)
  const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

  const tabs = [
    { id: 'book', label: '生词本', badge: stats.total > 0 ? String(stats.total) : undefined },
    { id: 'review', label: '复习', badge: stats.dueToday > 0 ? String(stats.dueToday) : undefined },
    { id: 'import', label: '导入' },
    { id: 'appearance', label: '外观与交互' },
    { id: 'youdao', label: '有道同步' },
  ]

  const body = []
  if (tab === 'book') body.push(bookTab({ h, P, book, dict, stats, say, bump, storage, bookVersion }))
  else if (tab === 'review') body.push(h(ReviewTab, { key: 'review', h, P, book, dict, stats, say, bump }))
  else if (tab === 'import') body.push(h(ImportTab, { key: 'import', h, P, book, dict, say, bump }))
  else if (tab === 'appearance') body.push(appearanceTab({ h, P, ux, patchAppearance, dictInfo: props?.dictInfo, packsDir, storage, section, field, setUx }))
  else body.push(h(YoudaoTab, {
    key: 'youdao', h, P, book, say, onGoBook: () => { setTab('book'); setMessage(null) },
  }))

  return h(Page, null, [
    h(PageHeader, {
      key: 'hdr',
      title: '英语翻译',
      desc: '在对话里点击或划选英文单词看释义，划选纯英文句子翻成中文。生词本会自动高亮你已经背过的词。',
      extra: [
        h(Badge, { key: 'b', text: '离线', tone: 'success' }),
        h(Badge, { key: 'c', text: `${stats.total} 词`, tone: 'neutral' }),
      ],
    }),

    h('div', { key: 'tabs' }, h(Tabs, {
      items: tabs, value: tab, onChange: (id) => { setTab(id); setMessage(null) }, label: '英语翻译分页',
    })),

    ...body,

    message !== null
      ? h(Note, {
        key: 'msg',
        tone: message.tone === 'err' ? 'err' : message.tone === 'info' ? 'info' : 'ok',
        text: message.text,
      })
      : null,
  ])
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 1：生词本管理台
   ═══════════════════════════════════════════════════════════════════════ */

export function bookTab(ctx) {
  const { h, P, book, dict, stats, say, bump, storage } = ctx
  const { Card, Button, Input, Select, Badge, Note, Stat, Chip, Checkbox, GAP, FS, C } = P

  const [query, setQuery] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [bookFilter, setBookFilter] = useState('all')
  const [sortMode, setSortMode] = useState('recent')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [selected, setSelected] = useState([])
  const [removing, setRemoving] = useState(null)
  const [noteEditing, setNoteEditing] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')

  const all = (() => {
    try { return typeof book?.list === 'function' ? book.list() : [] } catch { return [] }
  })()
  const books = (() => {
    try { return typeof book?.listBooks === 'function' ? book.listBooks() : [] } catch { return [] }
  })()

  const filtered = all.filter((entry) => {
    if (stateFilter !== 'all' && entry.state !== stateFilter) return false
    if (bookFilter !== 'all' && !booksOfEntry(entry).includes(bookFilter)) return false
    return matchQuery(entry, query.trim(), dict)
  })
  const sorted = sortEntries(filtered, sortMode)
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const rows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const pageHeads = rows.map((row) => row.head)
  const allOnPageSelected = pageHeads.length > 0 && pageHeads.every((head) => selected.includes(head))

  const toggleSelect = (head, on) => {
    setSelected((prev) => {
      if (on) return prev.includes(head) ? prev : [...prev, head]
      return prev.filter((item) => item !== head)
    })
  }

  const onBatchState = (state) => {
    if (selected.length === 0 || typeof book?.setState !== 'function') return
    Promise.all(selected.map((head) => book.setState(head, state)))
      .then(() => { say(`已把 ${selected.length} 个词转为「${stateLabel(state)}」`); setSelected([]); bump() })
      .catch(() => say('批量转状态失败', 'err'))
  }

  const onBatchMove = (bookId) => {
    if (selected.length === 0 || typeof book?.importMany !== 'function') return
    book.importMany(selected, 'manual', { bookId })
      .then(() => { say(`已把 ${selected.length} 个词加入所选词书`); setSelected([]); bump() })
      .catch(() => say('移入词书失败', 'err'))
  }

  const onBatchRemove = () => {
    if (selected.length === 0 || typeof book?.remove !== 'function') return
    Promise.all(selected.map((head) => book.remove(head)))
      .then(() => { say(`已移出 ${selected.length} 个词`); setSelected([]); setRemoving(null); bump() })
      .catch(() => say('移出失败', 'err'))
  }

  const onExport = (kind) => {
    const entries = typeof book?.exportAll === 'function' ? book.exportAll() : all
    const stamp = new Date().toISOString().slice(0, 10)
    let text = ''
    let name = ''
    let mime = 'text/plain;charset=utf-8'
    if (kind === 'txt') { text = exportTxt(entries); name = `生词本-${stamp}.txt` }
    else if (kind === 'csv') { text = exportCsv(entries); name = `生词本-${stamp}.csv`; mime = 'text/csv;charset=utf-8' }
    else { text = exportJson(book); name = `生词本备份-${stamp}.json`; mime = 'application/json;charset=utf-8' }
    if (entries.length === 0) { say('生词本还是空的，没有可导出的内容', 'info'); return }
    if (downloadText(text, name, mime)) say(`已导出 ${entries.length} 个词（${name}）`)
    else say('导出失败：浏览器不让下载', 'err')
  }

  const onClear = () => {
    if (typeof book?.remove !== 'function') return
    const total = all.length
    if (total === 0) { say('生词本已经是空的', 'info'); return }
    if (removing !== '__clear__') {
      setRemoving('__clear__')
      say(`再点一次「确认清空」会删掉 ${total} 个生词，这个操作不能撤销。`, 'info')
      return
    }
    setRemoving(null)
    Promise.all(all.map((entry) => book.remove(entry.head)))
      .then(() => { say('已清空'); setSelected([]); bump() })
      .catch(() => say('清空失败', 'err'))
  }

  const stateChips = [
    { id: 'all', label: '全部', count: all.length },
    { id: 'new', label: '未学', count: stats.byState.new ?? 0 },
    { id: 'unknown', label: '不认识', count: stats.byState.unknown ?? 0 },
    { id: 'fuzzy', label: '记错', count: stats.byState.fuzzy ?? 0 },
    { id: 'known', label: '已掌握', count: stats.byState.known ?? 0 },
  ]

  const dueText = (entry) => dueLabel(entry.srs?.due ?? 0)

  return h('div', { key: 'booktab', style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
    /* 统计条 */
    h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
      h(Stat, { key: 's1', label: '总词数', value: stats.total }),
      h(Stat, { key: 's2', label: '今日到期', value: stats.dueToday, tone: stats.dueToday > 0 ? 'accent' : 'neutral' }),
      h(Stat, { key: 's3', label: '已掌握', value: stats.byState.known ?? 0, tone: 'success' }),
      h(Stat, { key: 's4', label: '连续学习', value: `${stats.streak ?? 0} 天`, tone: stats.streak > 0 ? 'success' : 'neutral' }),
    ]),

    /* 状态占比条 + 30 天打卡 */
    h(Card, { key: 'chart', title: '掌握度与打卡', hint: '四态占比横条；下面 30 格是最近 30 天的复习次数，颜色越深复习越多。' }, [
      h(StatusBar, { key: 'bar', h, P, byState: stats.byState, total: stats.total }),
      h(HeatGrid, { key: 'heat', h, P, days: stats.days, }),
    ]),

    /* 工具行 */
    h(Card, { key: 'tools', title: '词表', hint: null }, [
      h('div', { key: 'row1', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('div', { key: 'q', style: { flex: '1 1 200px', minWidth: 160 } }, h(Input, {
          type: 'search',
          value: query,
          placeholder: '按词头或释义搜索',
          onChange: (value) => { setQuery(value); setPage(0) },
        })),
        h(Select, {
          key: 'bk',
          value: bookFilter,
          onChange: (value) => { setBookFilter(value); setPage(0) },
          options: [{ value: 'all', label: '全部词书' }, ...books.map((item) => ({ value: item.id, label: item.name }))],
        }),
        h(Select, {
          key: 'sort',
          value: sortMode,
          onChange: (value) => { setSortMode(value); setPage(0) },
          options: SORT_OPTIONS.map((item) => ({ value: item.id, label: item.label })),
        }),
      ]),

      h('div', { key: 'row2', style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        stateChips.map((chip) => h(Chip, {
          key: chip.id, label: chip.label, count: chip.count, active: stateFilter === chip.id,
          onClick: () => { setStateFilter(chip.id); setPage(0) },
        }))),

      /* 批量操作 */
      selected.length > 0
        ? h('div', { key: 'batch', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.border1}`, background: C.bg1 } }, [
          h('span', { key: 'n', style: { fontSize: FS.small, color: C.textDim } }, `已选 ${selected.length} 个`),
          h(Button, { key: 'b1', label: '转为已掌握', size: 'sm', onClick: () => onBatchState('known') }),
          h(Select, {
            key: 'bk2',
            value: '',
            onChange: (value) => { if (value !== '') onBatchMove(value) },
            options: [{ value: '', label: '移入词书…' }, ...books.map((item) => ({ value: item.id, label: item.name }))],
          }),
          removing === '__batch__'
            ? h(Button, { key: 'b2', label: '确认移出', variant: 'primary', size: 'sm', onClick: onBatchRemove })
            : h(Button, { key: 'b2', label: '移出', variant: 'danger', size: 'sm', onClick: () => { setRemoving('__batch__'); say(`再点一次「确认移出」会删掉这 ${selected.length} 个词。`, 'info') } }),
          removing === '__batch__'
            ? h(Button, { key: 'b3', label: '取消', variant: 'ghost', size: 'sm', onClick: () => setRemoving(null) })
            : null,
        ])
        : null,

      /* 词表 */
      sorted.length === 0
        ? h('p', { key: 'empty', style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textFaint } },
          all.length === 0
            ? '还没有生词。在对话里点开一个词，点标题旁边的 ☆ 就能收进来。'
            : '当前筛选下没有词。换个状态或词书试试。')
        : h('div', { key: 'table', className: 'hds-table' }, [
          h('div', { key: 'thead', className: 'hds-thead' }, [
            h('span', { key: 'c' }, h(Checkbox, {
              checked: allOnPageSelected,
              label: '全选本页',
              onChange: (on) => {
                if (!on) setSelected((prev) => prev.filter((head) => !pageHeads.includes(head)))
                else setSelected((prev) => [...new Set([...prev, ...pageHeads])])
              },
            })),
            h('span', { key: 'w' }, '词头'),
            h('span', { key: 's' }, '状态'),
            h('span', { key: 'd' }, '下次复习'),
            h('span', { key: 'r' }, '来源'),
            h('span', { key: 'o', style: { textAlign: 'right' } }, '操作'),
          ]),
          ...rows.map((entry) => {
            const open = expanded === entry.head
            const node = h('div', { key: `row-${entry.head}`, className: 'hds-trow' }, [
              h('span', { key: 'c' }, h(Checkbox, {
                checked: selected.includes(entry.head),
                label: `选择 ${entry.head}`,
                onChange: (on) => toggleSelect(entry.head, on),
              })),
              h('span', { key: 'w', className: 'hds-cell-head' }, h('button', {
                type: 'button',
                onClick: () => setExpanded(open ? null : entry.head),
              }, entry.head)),
              h('span', { key: 's' }, h(Badge, { text: stateLabel(entry.state), tone: stateTone(entry.state) })),
              h('span', { key: 'd', className: 'hds-cell-dim' }, dueText(entry)),
              h('span', { key: 'r', className: 'hds-cell-dim' }, SOURCE_LABEL[entry.source] ?? entry.source),
              h('span', { key: 'o', className: 'hds-cell-ops' }, [
                h(Select, {
                  key: 'st',
                  value: entry.state,
                  onChange: (value) => {
                    Promise.resolve(book.setState(entry.head, value))
                      .then(() => { say(`「${entry.head}」转为「${stateLabel(value)}」`); bump() })
                      .catch(() => say('转状态失败', 'err'))
                  },
                  options: Object.keys(STATE_META).map((id) => ({ value: id, label: stateLabel(id) })),
                }),
                h(Button, {
                  key: 'note', label: noteEditing === entry.head ? '存备注' : '备注', size: 'sm', variant: 'ghost',
                  onClick: () => {
                    if (noteEditing === entry.head) {
                      Promise.resolve(book.setNote(entry.head, noteDraft))
                        .then(() => { say('备注已保存'); setNoteEditing(null); bump() })
                        .catch(() => say('备注保存失败', 'err'))
                    } else {
                      setNoteEditing(entry.head)
                      setNoteDraft(entry.note ?? '')
                    }
                  },
                }),
                removing === entry.head
                  ? h(Button, { key: 'x', label: '确认移出', variant: 'primary', size: 'sm', onClick: () => {
                    Promise.resolve(book.remove(entry.head))
                      .then(() => { say(`已移出「${entry.head}」`); setRemoving(null); setExpanded(null); bump() })
                      .catch(() => say('移出失败', 'err'))
                  } })
                  : h(Button, { key: 'x', label: '移出', variant: 'danger', size: 'sm', onClick: () => { setRemoving(entry.head); say(`再点一次「确认移出」会删掉「${entry.head}」`, 'info') } }),
              ]),
            ])
            if (!open) return node
            return [
              node,
              h('div', { key: `det-${entry.head}`, className: 'hds-trow', style: { display: 'block', padding: '0 12px 10px' } },
                h(EntryDetail, { h, P, entry, dict, noteEditing, noteDraft, setNoteDraft })),
            ]
          }).flat(),
        ]),

      /* 分页 + 导出 */
      sorted.length > PAGE_SIZE
        ? h('div', { key: 'pager', className: 'hds-pager' }, [
          h('span', { key: 'info' }, `第 ${safePage + 1}/${pageCount} 页 · 共 ${sorted.length} 个`),
          h('span', { key: 'btns', style: { display: 'flex', gap: GAP.xs } }, [
            h(Button, { key: 'prev', label: '上一页', size: 'sm', disabled: safePage <= 0, onClick: () => setPage(Math.max(0, safePage - 1)) }),
            h(Button, { key: 'next', label: '下一页', size: 'sm', disabled: safePage >= pageCount - 1, onClick: () => setPage(Math.min(pageCount - 1, safePage + 1)) }),
          ]),
        ])
        : h('div', { key: 'pager1', className: 'hds-pager' }, [
          h('span', { key: 'info' }, sorted.length === 0 ? '没有词' : `共 ${sorted.length} 个词`),
        ]),

      h('div', { key: 'exports', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
        h(Button, { key: 't', label: '导出 txt', size: 'sm', disabled: all.length === 0, onClick: () => onExport('txt') }),
        h(Button, { key: 'c', label: '导出 CSV（带状态与释义）', size: 'sm', disabled: all.length === 0, onClick: () => onExport('csv') }),
        h(Button, { key: 'j', label: '导出 JSON 备份', size: 'sm', disabled: all.length === 0, onClick: () => onExport('json') }),
        h(Button, {
          key: 'clear',
          label: removing === '__clear__' ? '确认清空' : '清空生词本',
          variant: removing === '__clear__' ? 'primary' : 'danger',
          size: 'sm',
          disabled: all.length === 0,
          onClick: onClear,
        }),
        removing === '__clear__'
          ? h(Button, { key: 'cancel', label: '取消', variant: 'ghost', size: 'sm', onClick: () => { setRemoving(null); say('已取消', 'info') } })
          : null,
      ]),
    ]),
  ])
}

/** 四态占比横条。纯 CSS，不引图表库。 */
function StatusBar(props) {
  const { h, P, byState, total } = props
  const { C } = P
  const colors = {
    new: `color-mix(in srgb, ${C.textFaint} 55%, transparent)`,
    unknown: C.danger,
    fuzzy: C.warn,
    known: C.success,
  }
  const safeTotal = total > 0 ? total : 1
  const order = ['known', 'fuzzy', 'unknown', 'new']
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
    h('div', { key: 'bar', className: 'hds-bar' }, order.map((state) => {
      const value = byState?.[state] ?? 0
      if (value === 0) return null
      return h('span', {
        key: state,
        title: `${stateLabel(state)} ${value}`,
        style: { width: `${(value / safeTotal) * 100}%`, background: colors[state] },
      })
    })),
    h('div', { key: 'legend', style: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: FS.small, color: C.textDim } }, order.map((state) => h('span', {
      key: state,
      style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
    }, [
      h('span', { key: 'd', style: { width: 8, height: 8, borderRadius: 2, background: colors[state] } }),
      `${stateLabel(state)} ${byState?.[state] ?? 0}`,
    ]))),
  ])
}

/** 近 30 天打卡格子：颜色深浅 = 当日复习数。 */
function HeatGrid(props) {
  const { h, P, days } = props
  const { C } = P
  const list = Array.isArray(days) ? days : []
  const max = list.reduce((acc, day) => Math.max(acc, day.reviewed ?? 0), 0)
  const cellBg = (count) => {
    if (!count) return `color-mix(in srgb, ${C.textFaint} 12%, transparent)`
    const ratio = max > 0 ? count / max : 1
    return `color-mix(in srgb, ${C.success} ${Math.round(18 + ratio * 62)}%, transparent)`
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
    h('div', { key: 'grid', className: 'hds-heat' }, list.map((day, index) => h('span', {
      key: day.date ?? index,
      className: 'hds-heat-cell',
      title: `${day.date} · 复习 ${day.reviewed ?? 0} · 新增 ${day.added ?? 0}`,
      style: { background: cellBg(day.reviewed ?? 0) },
    }))),
    h('div', { key: 'legend', className: 'hds-heat-legend' }, [
      h('span', { key: 'l' }, '30 天前'),
      h('span', { key: 'a', style: { width: 9, height: 9, borderRadius: 2, background: cellBg(1) } }),
      h('span', { key: 'b', style: { width: 9, height: 9, borderRadius: 2, background: cellBg(max || 4) } }),
      h('span', { key: 'r' }, '今天'),
    ]),
  ])
}

/** 行内详情：词库释义 / 音标 / 例句；查不到就老实说查不到（CETgo 口径）。 */
function EntryDetail(props) {
  const { h, P, entry, dict, noteEditing, noteDraft, setNoteDraft } = props
  const { Input, Note, C, FS } = P

  let described = null
  const raw = dict?.entries?.[normalizeKey(entry.head)]
  if (raw) {
    try { described = describeEntry(raw) } catch { described = null }
  }
  const seen = entry.review?.seen ?? 0
  const lastSeen = entry.review?.lastSeenAt ?? 0
  const seenText = seen > 0
    ? `查过 ${seen} 次 · 最近 ${lastSeen > 0 ? dueLabel(lastSeen) : '未知'}`
    : '还没查过'

  const rows = []
  if (described && described.senses.length > 0) {
    rows.push(h('div', { key: 'senses', className: 'hds-detail-row' }, [
      h('span', { key: 'k', className: 'hds-detail-key' }, '释义'),
      h('span', { key: 'v', className: 'hds-detail-val' }, described.senses.slice(0, 3).map((sense, index) => h('div', {
        key: index, className: 'hds-detail-sense',
      }, [
        sense.posLabel ? h('span', { key: 'p', className: 'hds-detail-pos' }, sense.posLabel) : null,
        h('span', { key: 'z' }, sense.zh.join('；')),
      ]))),
    ]))
  } else if (typeof entry.gloss === 'string' && entry.gloss.trim() !== '') {
    rows.push(h('div', { key: 'gloss', className: 'hds-detail-row' }, [
      h('span', { key: 'k', className: 'hds-detail-key' }, '释义'),
      h('span', { key: 'v', className: 'hds-detail-val' }, entry.gloss),
    ]))
  } else {
    rows.push(h(Note, { key: 'nodict', tone: 'info', text: '词库未收录，暂无释义（可以自己写一条备注）' }))
  }

  if (described && described.examples.length > 0) {
    const sample = described.examples[0]
    rows.push(h('div', { key: 'ex', className: 'hds-detail-row' }, [
      h('span', { key: 'k', className: 'hds-detail-key' }, '例句'),
      h('span', { key: 'v', className: 'hds-detail-val' }, `${sample?.en ?? ''}　${sample?.zh ?? ''}`),
    ]))
  }

  rows.push(h('div', { key: 'meta', className: 'hds-detail-row' }, [
    h('span', { key: 'k', className: 'hds-detail-key' }, '记录'),
    h('span', { key: 'v', className: 'hds-detail-val', style: { fontSize: FS.small, color: C.textDim } },
      `${seenText} · 加于 ${new Date(entry.addedAt ?? 0).toLocaleDateString()} · 复习 ${entry.srs?.reps ?? 0} 次对 / ${entry.srs?.lapses ?? 0} 次错`),
  ]))

  if (noteEditing === entry.head) {
    rows.push(h(Input, {
      key: 'noteinput',
      value: noteDraft,
      placeholder: '写一条备注（最多 500 字）',
      onChange: setNoteDraft,
    }))
  } else if ((entry.note ?? '') !== '') {
    rows.push(h('div', { key: 'note', className: 'hds-detail-row' }, [
      h('span', { key: 'k', className: 'hds-detail-key' }, '备注'),
      h('span', { key: 'v', className: 'hds-detail-val' }, entry.note),
    ]))
  }

  return h('div', { className: 'hds-detail' }, rows)
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 2：复习卡
   ═══════════════════════════════════════════════════════════════════════ */

export function ReviewTab(props) {
  const { h, P, book, dict, stats, say, bump } = props
  const { Card, Button, Note, Stat, Chip, Segment, GAP, FS, C } = P

  const [direction, setDirection] = useState('en-zh')
  const [filter, setFilter] = useState('all')
  const [bookFilter, setBookFilter] = useState('all')
  const [flipped, setFlipped] = useState(false)
  const [index, setIndex] = useState(0)
  const [answered, setAnswered] = useState([])
  const [roundDone, setRoundDone] = useState(false)
  const [queue, setQueue] = useState(null)

  const books = (() => {
    try { return book?.listBooks?.() ?? [] } catch { return [] }
  })()

  /** 造一轮队列（到期 + 筛选 + 方向）。 */
  const buildQueue = (ahead = false) => {
    let base = []
    try {
      if (ahead) base = aheadQueue(typeof book?.list === 'function' ? book.list() : [], AHEAD_COUNT)
      else base = typeof book?.dueQueue === 'function' ? book.dueQueue() : []
    } catch { base = [] }
    const filtered = filterQueue(base, { state: filter, bookId: bookFilter })
    return queueForDirection(filtered, direction, dict)
  }

  const current = queue === null ? null : (queue[index] ?? null)
  const remaining = queue === null ? 0 : Math.max(0, queue.length - index)

  const startRound = (ahead = false) => {
    setQueue(buildQueue(ahead))
    setIndex(0)
    setAnswered([])
    setRoundDone(false)
    setFlipped(false)
  }

  const grade = (value) => {
    if (!current || typeof book?.grade !== 'function') return
    Promise.resolve(book.grade(current.head, value))
      .then(() => {
        setAnswered((prev) => [...prev, { head: current.head, grade: value }])
        setFlipped(false)
        const next = index + 1
        if (queue && next >= queue.length) setRoundDone(true)
        setIndex(next)
        bump()
      })
      .catch(() => say('评分失败', 'err'))
  }

  /* 键盘：空格/回车翻面，1/2/3 评分，Esc 退出本轮 */
  useEffect(() => {
    const onKey = (event) => {
      if (!shouldHandleKey(event)) return
      const action = actionForKey(event.key)
      if (action === '') return
      event.preventDefault?.()
      if (action === 'exit') { setRoundDone(false); setQueue(null); return }
      if (!current) return
      if (action === 'flip') { setFlipped((prev) => !prev); return }
      grade(action)
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onKey)
      return () => { try { window.removeEventListener('keydown', onKey) } catch { /* ignore */ } }
    }
    return undefined
  }, [current, queue, index])

  const summary = roundSummary(answered)
  const back = current && flipped ? cardBackFor(current.head, dict) : null
  const brief = current && direction === 'zh-en' ? briefTextFor(current, dict) : ''

  /* ── 本轮结束 ── */
  if (roundDone) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
      h(Card, { key: 'done', title: '本轮结束', hint: `复习了 ${summary.total} 个词。` }, [
        h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Stat, { key: 'a', label: '正确率', value: `${summary.accuracy}%`, tone: summary.accuracy >= 70 ? 'success' : 'warn' }),
          h(Stat, { key: 'b', label: '认识', value: summary.good, tone: 'success' }),
          h(Stat, { key: 'c', label: '记错', value: summary.hard, tone: 'warn' }),
          h(Stat, { key: 'd', label: '不认识', value: summary.again, tone: 'danger' }),
        ]),
        h(StatusBar, { key: 'bar', h, P, byState: stats.byState, total: stats.total }),
        h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Button, { key: 'again', label: '再来一轮', variant: 'primary', onClick: () => startRound(false) }),
        ]),
      ]),
    ])
  }

  /* ── 未开始 / 队列空 ── */
  if (queue === null || queue.length === 0) {
    const empty = queue !== null && queue.length === 0
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
      h(Card, {
        key: 'start',
        title: empty ? '今天没有到期的词' : '开始复习',
        hint: empty ? '队列是空的。可以提前复习最早到期的词，或去导入新词。' : `今日到期 ${stats.dueToday} 个。空格翻面，1/2/3 评分。`,
      }, [
        h('div', { key: 'stats', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Stat, { key: 'a', label: '今日到期', value: stats.dueToday, tone: 'accent' }),
          h(Stat, { key: 'b', label: '总词数', value: stats.total }),
          h(Stat, { key: 'c', label: '连续学习', value: `${stats.streak ?? 0} 天`, tone: 'success' }),
        ]),
        h('div', { key: 'filters', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
          h(Segment, { key: 'dir', items: DIRECTIONS, value: direction, onChange: setDirection, label: '出题方向' }),
          h('span', { key: 'sep', style: { fontSize: FS.small, color: C.textDim } }, '筛选'),
          ...REVIEW_FILTERS.map((item) => h(Chip, {
            key: item.id, label: item.label, active: filter === item.id,
            onClick: () => setFilter(item.id),
          })),
          books.length > 1
            ? h('select', {
              key: 'bk',
              value: bookFilter,
              onChange: (event) => setBookFilter(event.target.value),
              style: { font: 'inherit', fontSize: FS.body, padding: '5px 9px', borderRadius: 8, border: `1px solid ${C.border2}`, background: C.bgBase, color: C.text },
            }, [{ value: 'all', label: '全部词书' }, ...books.map((item) => ({ value: item.id, label: item.name }))].map((option) => h('option', { key: option.value, value: option.value }, option.label)))
            : null,
        ]),
        h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
          h(Button, { key: 'go', label: empty ? '提前复习最早到期的 20 个' : '开始复习', variant: 'primary', onClick: () => startRound(empty) }),
        ]),
        stats.total === 0
          ? h(Note, { key: 'tip', tone: 'info', text: '生词本还是空的。先在对话里收藏几个词，或去「导入」页签批量加词。' })
          : null,
      ]),
    ])
  }

  /* ── 卡片 ── */
  const front = current.head
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
    h(Card, { key: 'card', title: '复习', hint: null }, [
      h('div', { key: 'top', className: 'hds-review-top' }, [
        h('span', { key: 'l', style: { fontSize: FS.small, color: C.textDim } },
          `今日到期 ${stats.dueToday} 个 · 本轮已复习 ${summary.total} 个 · 剩余 ${remaining}`),
        h(Segment, { key: 'dir', items: DIRECTIONS, value: direction, onChange: (id) => { setDirection(id); setQueue(null) }, label: '出题方向' }),
      ]),

      h('div', {
        key: 'stage',
        className: 'hds-cardstage',
        role: 'button',
        tabIndex: 0,
        onClick: () => setFlipped((prev) => !prev),
      }, flipped
        ? h('div', { key: 'back', className: 'hds-cardstage-back' }, [
          // 背面内容块（词头 + 🔊 + 义项≤3 + 例句）整段复用 review.js 的 ReviewCardBack。
          // 它与 card.js 的卡片背面共用同一份实现，发音按钮跟着一起来了（§E1），
          // 不需要在设置页再维护一套「词头 + 释义 + 例句」的模板。
          h(ReviewCardBack, {
            key: 'back',
            word: front,
            back,
            gloss: current.gloss ?? '',
            size: 'md',
            P,
          }),
          // 评分键盘提示留在外层：ReviewCardBack 只画「这个词长什么样」，
          // 不掺入复习流程的交互说明（那些属于 ReviewTab 的职责）。
          h('div', { key: 'tip', className: 'hds-cardstage-tip' }, '1 ✗ 不认识 · 2 ↻ 记错 · 3 ✓ 认识 · 空格再翻一次'),
        ])
        : h('div', { key: 'front', style: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' } }, [
          h('div', { key: 'w', className: 'hds-cardstage-word' }, direction === 'zh-en' ? (brief || '（无释义）') : front),
          h('div', { key: 'tip', className: 'hds-cardstage-tip' }, '点卡片或按空格翻面'),
        ])),
    ]),

    h('div', { key: 'grades', className: 'hds-grade-row' }, GRADE_BUTTONS.map((item) => h('button', {
      key: item.grade,
      type: 'button',
      className: `hds-grade-btn hds-grade-${item.grade}`,
      onClick: () => grade(item.grade),
    }, [
      h('span', { key: 'l', style: { fontSize: FS.body } }, item.label),
      h('small', { key: 'k', style: { fontSize: 10.5, opacity: 0.7 } }, `键 ${item.key}`),
    ]))),
  ])
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 3：粘贴导入
   ═══════════════════════════════════════════════════════════════════════ */

export function ImportTab(props) {
  const { h, P, book, dict, say, bump } = props
  const { Card, Button, Input, Select, Badge, Note, Field, GAP, FS, C } = P

  const [text, setText] = useState('')
  const [bookId, setBookId] = useState('default')
  const [newBookName, setNewBookName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [busy, setBusy] = useState('')
  const [fileName, setFileName] = useState('')

  const books = (() => {
    try { return book?.listBooks?.() ?? [] } catch { return [] }
  })()

  const probes = {
    isDup: (head) => (typeof book?.has === 'function' ? book.has(head) : false),
    isKnown: (head) => Boolean(dict?.entries?.[head]),
  }

  const onParse = () => {
    if (text.trim() === '') { say('先粘贴或用文件读入一些内容', 'info'); return }
    let result = null
    try { result = parseImportDetailed(text, probes) } catch { result = null }
    if (!result) { say('解析失败：这段内容读不出词', 'err'); return }
    setParsed(result)
    setShowSkipped(false)
    const sum = summarizeImport(result)
    say(`识别 ${sum.total} 个词：新增 ${sum.fresh}、已存在 ${sum.dup}、词库未收录 ${sum.nodict}${sum.skipped > 0 ? `；跳过 ${sum.skipped} 行` : ''}`, 'info')
  }

  const onConfirm = () => {
    if (!parsed || parsed.words.length === 0) return
    if (typeof book?.importMany !== 'function') { say('生词本还没就绪', 'err'); return }
    setBusy('import')
    const targetBook = newBookName.trim() !== '' ? null : bookId
    const prepare = newBookName.trim() !== ''
      ? Promise.resolve(typeof book.createBook === 'function' ? book.createBook(newBookName.trim()) : null)
      : Promise.resolve(null)
    prepare.then((created) => {
      const id = created?.id ?? targetBook ?? 'default'
      // 备份恢复：带 record 的行整条传下去，保住 state/srs/bookId
      const records = parsed.words
        .filter((row) => row.status !== 'dup')
        .map((row) => {
          const gloss = glossText(row)
          if (row.record && typeof row.record === 'object') return { ...row.record, head: row.head, gloss: row.record.gloss || gloss }
          return { head: row.head, gloss }
        })
      return book.importMany(records, 'import', { bookId: id }).then((added) => {
        bump()
        setBusy('')
        setParsed(null)
        setText('')
        setFileName('')
        setNewBookName('')
        say(`导入完成：新增 ${added} 个${created ? `，新词书「${created.name}」已建立` : ''}`)
      })
    }).catch(() => { setBusy(''); say('导入失败', 'err') })
  }

  const onFile = (event) => {
    const file = event?.target?.files?.[0]
    if (!file) return
    setFileName(file.name)
    try {
      const reader = new FileReader()
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : ''
        setText(content)
        setParsed(null)
        say(`已读入「${file.name}」（${content.length} 字符），点「解析预览」看结果`, 'info')
      }
      reader.onerror = () => say('文件读取失败', 'err')
      reader.readAsText(file, 'utf-8')
    } catch {
      say('这个浏览器不支持读取本地文件', 'err')
    }
  }

  const sum = parsed ? summarizeImport(parsed) : null

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
    h(Card, {
      key: 'input',
      title: '导入生词',
      hint: '两步：先在下面粘贴或读入内容，点「解析预览」看清会加什么，再点「确认导入」才真正写进生词本。',
    }, [
      h(Input, {
        key: 'ta',
        multiline: true,
        value: text,
        placeholder: '三种都认：\n一行一词\napple,ˈæpl,n. 苹果\nhello  /həˈloʊ/  int. 喂\n也可以直接粘本插件导出的 JSON 备份。',
        onChange: (value) => { setText(value); setParsed(null) },
      }),
      h('div', { key: 'file', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
        h('label', {
          key: 'fl',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            padding: '5px 12px', borderRadius: 8, minHeight: 30,
            border: `1px solid ${C.border2}`, background: C.bg1,
            fontSize: FS.body, fontWeight: 580, color: C.text,
          },
        }, [
          '从文件读取',
          h('input', {
            key: 'in',
            type: 'file',
            accept: '.txt,.csv,.tsv,.json',
            style: { display: 'none' },
            onChange: onFile,
          }),
        ]),
        fileName !== ''
          ? h('span', { key: 'fn', style: { fontSize: FS.small, color: C.textDim } }, fileName)
          : h('span', { key: 'fn0', style: { fontSize: FS.small, color: C.textFaint } }, '支持 .txt / .csv / .tsv / .json'),
      ]),

      h('div', { key: 'book', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap', alignItems: 'center' } }, [
        h(Select, {
          key: 'sel',
          value: bookId,
          onChange: setBookId,
          options: books.map((item) => ({ value: item.id, label: item.name })),
        }),
        h('div', { key: 'nb', style: { flex: '1 1 160px', minWidth: 140 } }, h(Input, {
          value: newBookName,
          placeholder: '或新建一本词书（填名字）',
          onChange: setNewBookName,
        })),
      ]),

      h('div', { key: 'btns', style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' } }, [
        h(Button, {
          key: 'parse', label: '解析预览', variant: 'primary',
          disabled: text.trim() === '', busy: busy === 'parse',
          onClick: onParse,
        }),
        parsed && parsed.words.length > 0
          ? h(Button, {
            key: 'confirm',
            label: `确认导入 ${parsed.words.filter((row) => row.status !== 'dup').length} 个`,
            busy: busy === 'import',
            onClick: onConfirm,
          })
          : null,
        parsed !== null
          ? h(Button, { key: 'cancel', label: '清空预览', variant: 'ghost', onClick: () => { setParsed(null); setShowSkipped(false) } })
          : null,
      ]),
    ]),

    parsed !== null
      ? h(Card, {
        key: 'preview',
        title: '预览',
        hint: sum
          ? `识别 ${sum.total} 个词：新增 ${sum.fresh}、已存在 ${sum.dup}、词库未收录 ${sum.nodict}${sum.skipped > 0 ? `；跳过 ${sum.skipped} 行` : ''}。确认之前不会写库。`
          : null,
      }, [
        parsed.words.length === 0
          ? h(Note, { key: 'none', tone: 'warn', text: '这段内容里没有可用词条。看看下面的跳过原因。' })
          : h('div', { key: 'list', className: 'hds-preview' }, [
            h('div', { key: 'head', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: FS.small, color: C.textDim } }, [
              h(Badge, { key: 'f', text: `格式 ${IMPORT_FORMATS.includes(parsed.format) ? parsed.format : 'plain'}`, tone: 'neutral' }),
              h(Badge, { key: 'n', text: `新增 ${sum.fresh}`, tone: 'success' }),
              h(Badge, { key: 'd', text: `已存在 ${sum.dup}`, tone: 'neutral' }),
              h(Badge, { key: 'k', text: `未收录 ${sum.nodict}`, tone: 'warn' }),
            ]),
            h('div', { key: 'table', className: 'hds-preview-table' }, [
              h('div', { key: 'th', className: 'hds-preview-row', style: { fontSize: FS.small, color: C.textDim, background: C.bg1 } }, [
                h('span', { key: 'a' }, '行'),
                h('span', { key: 'b' }, '词头'),
                h('span', { key: 'c' }, '状态'),
                h('span', { key: 'd' }, '释义'),
              ]),
              ...parsed.words.slice(0, PREVIEW_ROW_LIMIT).map((row) => h('div', { key: `r-${row.line}-${row.head}`, className: 'hds-preview-row' }, [
                h('span', { key: 'a', className: 'hds-preview-line' }, String(row.line)),
                h('span', { key: 'b', style: { fontWeight: 620 } }, row.head),
                h('span', { key: 'c' }, h(Badge, {
                  text: row.status === 'dup' ? '已存在' : row.status === 'nodict' ? '词库未收录' : '将新增',
                  tone: row.status === 'dup' ? 'neutral' : row.status === 'nodict' ? 'warn' : 'success',
                })),
                h('span', { key: 'd', className: 'hds-preview-gloss' }, glossText(row) || '—'),
              ])),
            ]),
            parsed.words.length > PREVIEW_ROW_LIMIT
              ? h('p', {
                key: 'more',
                style: { margin: 0, fontSize: FS.small, lineHeight: 1.9, color: C.textFaint },
              }, `预览只显示前 ${PREVIEW_ROW_LIMIT} 行，还有 ${parsed.words.length - PREVIEW_ROW_LIMIT} 行没显示；点「确认导入」时会把这些也一起导进去。`)
              : null,
          ]),

        parsed.skipped.length > 0
          ? h('div', { key: 'skip', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h(Button, {
              key: 'toggle',
              label: showSkipped ? `收起跳过的 ${parsed.skipped.length} 行` : `跳过 ${parsed.skipped.length} 行（展开看原因）`,
              size: 'sm',
              variant: 'ghost',
              onClick: () => setShowSkipped((prev) => !prev),
            }),
            showSkipped
              ? h('div', { key: 'skips', className: 'hds-preview-skip' }, parsed.skipped.map((row, index) => h('div', {
                key: `s-${row.line}-${index}`, className: 'hds-skip-row',
              }, [
                h('span', { key: 'l', className: 'hds-skip-line' }, `#${row.line}`),
                h('span', { key: 'r', style: { flex: '0 0 auto', fontWeight: 600 } }, row.reason),
                h('span', { key: 't', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.raw || '（空行）'),
              ])))
              : null,
          ])
          : null,
      ])
      : null,
  ])
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 4：外观与交互（原有字段全保留）
   ═══════════════════════════════════════════════════════════════════════ */

const WORD_PACKS = [
  { id: 'core', name: '核心词库', builtin: true, desc: '20,499 个考纲核心词：中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE，每个词带词性、中文释义、英文释义与变音标注。' },
  { id: 'roots', name: '词根词缀库', builtin: true, desc: '6,374 个词的词根词缀拆解，来自 ECDICT 词根库（MIT）。' },
  { id: 'examples', name: '双语例句库', builtin: true, desc: '8,960 个词的中英对照例句，来自 Tatoeba（CC BY 2.0 FR）。' },
]

export function appearanceTab(ctx) {
  const { h, P, ux, patchAppearance, packsDir, storage } = ctx
  const { Card, Button, Input, Select, Switch, Note, Field, GAP, FS, C } = P
  const section = (key, title, hint, children) => h(Card, { key, title, hint }, children)
  const field = (key, label, control, hint) => h(Field, { key, label, hint }, control)

  const [translator, setTranslator] = useState(() => readTranslator(storage))
  const [packs, setPacks] = useState(() => readPacks(storage))
  const [maxHanRatio, setMaxHanRatio] = useState(() => readMaxHanRatioRaw(storage))
  const [dictInfo, setDictInfo] = useState(null)

  useEffect(() => {
    let alive = true
    try {
      fetch('/api/dsh-hover-dict/meta.json')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => { if (alive && data) setDictInfo(data) })
        .catch(() => { /* 拿不到就不显示 */ })
    } catch { /* ignore */ }
    return () => { alive = false }
  }, [])

  /* ── 生词着色设置组（设计 §C4） ──
     读写都走 patchAppearance → saveUx → localStorage；
     app.js 里包了 localStorage.setItem，写完立刻触发 marker 重算，所以这即时生效。 */
  /**
   * 当前标记色的原始存档值。
   *
   * 可能是哨兵 'theme-error'（默认，跟随主题错误红），也可能是七位 hex。
   * 判等必须拿这个原值比 —— 不能拿 markColorToCss 的结果比，
   * 否则「跟随主题」与「恰好也是 #e5484d」会混成同一个高亮态。
   */
  const markColorRaw = ux.appearance.markColor ?? DEFAULT_MARK_COLOR
  /** 解析成可用于 CSS 的颜色（哨兵→var(...)），给预览用。 */
  const markColor = markColorToCss(markColorRaw)
  /**
   * 当前是否「跟随主题错误红」。
   *
   * 必须拿**原始存档值**跟哨兵比，不能拿解析结果比 ——
   * markColor 已经是 `var(--dsw-alias-state-error-primary, #e5484d)`，
   * 拿它跟 'theme-error' 比永远为 false，高亮态就永远不会亮（踩过一次）。
   */
  const isThemeColor = markColorRaw === DEFAULT_MARK_COLOR

  const markPreview = (() => {
    const off = ux.appearance.markWords === false
    // 与 marker.js highlightCss 同一套解析：哨兵 → var(...)，hex → 原样
    const color = markColor
    // 已掌握的淡色也照抄 highlightCss：同色掺 50% 透明（不是另造一个 opacity）
    const knownColor = `color-mix(in srgb, ${color} 50%, transparent)`
    const markOne = (word, known) => {
      if (off) return h('span', { key: word }, word)
      // 只改字的颜色 —— 没有底色、没有下划线（用户裁定「只要改字的颜色」）
      return h('span', { key: word, style: { color: known ? knownColor : color } }, word)
    }
    // 预览句里几个词模拟「已收藏未掌握」，一个模拟「已掌握」（markKnown 开时淡色）
    return h('div', {
      key: 'preview',
      className: 'hds-mark-preview',
      'data-off': off ? 'true' : undefined,
      'aria-label': '生词着色预览',
    }, off
      ? 'The quick brown fox jumps over the lazy dog. —— 着色已关闭，正文不会变色'
      : [
        'The ',
        markOne('quick'),
        ' ',
        markOne('brown'),
        ' fox jumps over the ',
        markOne('lazy', ux.appearance.markKnown === true),
        ' dog.',
      ])
  })()

  const markSection = () => section('mark', '生词着色',
    '把生词本里还没掌握的词在助手回复和思考内容里标出来，一眼看见自己不会的词。只改这些字的颜色，不加底色、不加下划线，正文内容一个字都不动。',
    [
      field('m1', '着色开关',
        h(Switch, {
          checked: ux.appearance.markWords !== false,
          onChange: (next) => patchAppearance('markWords', next),
          label: ux.appearance.markWords !== false ? '开启' : '关闭（正文完全不变色）',
        }),
        '关掉之后正文一个字都不会变，浮层与生词本照常工作。'),

      field('m2', '标记颜色',
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } }, [
          h('div', { key: 'sw', className: 'hds-swatches' }, [
            // 首选项：跟随主题错误红（哨兵 'theme-error'，不是 hex）。
            // 与该词在正文里的实际取色同一个 token —— 换主题/暗色都跟着变。
            h('button', {
              key: 'theme-error',
              type: 'button',
              className: 'hds-swatch',
              'aria-label': '标记颜色：跟随主题错误红',
              'aria-pressed': isThemeColor ? 'true' : 'false',
              title: '跟随主题错误红',
              style: {
                // 画成一道斜杠 + 红边，表示「这个色由主题决定」而不是某个固定色
                background: `linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 22%, transparent), color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 70%, transparent))`,
                borderColor: 'var(--dsw-alias-state-error-primary, #e5484d)',
              },
              onClick: () => patchAppearance('markColor', DEFAULT_MARK_COLOR),
            }),
            ...MARK_COLOR_PRESETS.map((preset) => h('button', {
              key: preset,
              type: 'button',
              className: 'hds-swatch',
              'aria-label': `用颜色 ${preset}`,
              'aria-pressed': !isThemeColor && markColorRaw === preset ? 'true' : 'false',
              style: { background: preset },
              onClick: () => patchAppearance('markColor', preset),
            })),
            h('input', {
              key: 'pick',
              type: 'color',
              // <input type=color> 只认七位 hex；哨兵态下回落默认红，只是取色器的初始值，
              // 用户一动手就切到固定 hex（不改变「当前是跟随主题」这个事实被 aria-pressed 记录）
              value: /^#[0-9a-f]{6}$/i.test(markColorRaw) ? markColorRaw : '#e5484d',
              'aria-label': '自定义标记颜色',
              title: '自定义颜色',
              style: {
                width: 34, height: 26, padding: 0, border: `1px solid ${C.border2}`,
                borderRadius: 8, background: C.bgBase, cursor: 'pointer',
              },
              onChange: (event) => patchAppearance('markColor', event.target.value),
            }),
          ]),
          h('span', {
            key: 'now',
            style: { fontSize: FS.small, lineHeight: 1.8, color: C.textDim },
          }, isThemeColor
            ? '当前：跟随主题错误红（与工具报错的红色一致，随主题变化）'
            : `当前：固定颜色 ${markColorRaw}`),
        ]),
        '默认跟随主题错误红。只在词上改字体颜色，不加底色、不加下划线。'),

      field('m4', '已掌握的词也淡色显示',
        h(Switch, {
          checked: ux.appearance.markKnown === true,
          onChange: (next) => patchAppearance('markKnown', next),
          label: ux.appearance.markKnown === true ? '淡色显示' : '不着色',
        }),
        '默认不着色 —— 已经掌握的词不该继续刺眼。'),

      field('m5', '预览', markPreview, '改上面任何一项，这句会立刻跟着变；真实对话里的着色也是即时生效的。'),
    ])

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.md } }, [
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

    markSection(),

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

    section('packs', '词库与句子库',
      '系统自带三个，随插件分发，完全离线。其余词库可以自己加。',
      [
        h('div', { key: 'cards', style: { display: 'flex', flexDirection: 'column', gap: GAP.sm } },
          WORD_PACKS.map((pack) => h('div', {
            key: pack.id,
            style: {
              display: 'flex', alignItems: 'center', gap: GAP.md,
              padding: '13px 15px', borderRadius: 13,
              border: `1px solid ${C.border2}`, background: C.bg1,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
            },
          }, [
            h('div', { key: 'm', style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 } }, [
              h('div', { key: 'n', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
                h('span', { key: 't', style: { fontSize: FS.body, fontWeight: 650, color: C.text } }, pack.name),
                h(P.Badge, { key: 'b', text: '系统自带', tone: 'neutral' }),
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
                userSelect: 'all', overflowWrap: 'anywhere',
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
  ])
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 5：有道同步（设计 §D3）
   ═══════════════════════════════════════════════════════════════════════ */

/** 有道路由前缀。与宿主 index.js 的 API_PREFIX 同源（net.js 也导出了一份）。 */
const YOUDAO_BASE = `${API_PREFIX}/youdao`

/** 四步傻瓜引导（用户是 IT 小白，每步一句话说清点哪里）。 */
const YOUDAO_STEPS = [
  { title: '登录有道词典', detail: '浏览器打开 dict.youdao.com，用你的账号登录。没登录的话下一步会拿到空的 Cookie。' },
  { title: '打开开发者工具', detail: '按 F12（Mac 是 ⌥⌘I），切到「网络 / Network」标签，然后刷新一次页面。' },
  { title: '复制 Cookie', detail: '在请求列表里点第一个请求，右侧找到「请求头 / Request Headers」，把 Cookie 那一整行的值全部复制。' },
  { title: '粘贴并保存', detail: '回到这里粘进下面的输入框，点「保存并验证」。看到昵称就是成功了。' },
]

/** 降级引导（宿主报接口改版时显示，设计 §D2 第 3 点）。 */
const YOUDAO_FALLBACK_STEPS = [
  '在有道生词本页面，把词表整段全选复制（Ctrl/⌘ + A，再 Ctrl/⌘ + C）。',
  '切到本插件的「导入」页签，粘贴进去。',
  '点「解析预览」确认词表认得对，再点「确认导入」。',
]

/**
 * 有道路由统一请求。
 *
 * 与 net.js 的 fetchAsset 分工：那个只管词库文件（GET + ETag 缓存），
 * 这里要 POST/DELETE 并能把宿主的 `{ok:false,error:{code,message,fallback}}`
 * 原样带出来给面板判断（要不要显示降级区靠 error.fallback）。
 *
 * 永不抛：网络错也折成 { ok:false, error:{code:'E_NETWORK'} }，
 * 因为设置面板的渲染路径不该因为宿主没起而炸掉。
 */
async function youdaoRequest(method, tail, body, timeoutMs = 30000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await fetch(`${YOUDAO_BASE}${tail}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      ...(controller ? { signal: controller.signal } : {}),
    })
    let payload = null
    try { payload = await response.json() } catch { payload = null }
    if (payload !== null && typeof payload === 'object') return payload
    return { ok: false, error: { code: 'E_BAD_JSON', message: '宿主返回的内容看不懂，请重启 DSH 后再试' } }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, error: { code: 'E_YOUDAO_TIMEOUT', message: '超时了，收藏夹可能很大，稍后再试一次' } }
    }
    return { ok: false, error: { code: 'E_NETWORK', message: `连不上宿主，请确认插件已启用：${error?.message ?? error}` } }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * E_ → 面板话术。
 *
 * 宿主已经给了中文 message，这里只在少数需要「下一步做什么」的错误上
 * 补一句可操作的话；其余直接用宿主文案，不自己编。
 */
function youdaoErrorText(error) {
  const code = String(error?.code ?? '')
  const message = typeof error?.message === 'string' && error.message !== '' ? error.message : '操作失败'
  if (code === 'E_YOUDAO_AUTH') return `${message}（依次按 F12 → 网络 → 刷新，重新复制 Cookie）`
  return message
}

/**
 * 上次同步时间 → 「刚刚 / 3 分钟前 / 今天 14:20 / 11 月 20 日」。
 *
 * @param {number} at 时间戳
 * @param {number} [now] 便于测试注入
 * @returns {string}
 */
export function syncedAtLabel(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '还没同步过'
  const diff = now - at
  if (diff < 60_000) return '刚刚同步过'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前同步`
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  if (diff < 24 * 3600_000) return `今天 ${hh}:${mm} 同步`
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日同步`
}

/**
 * 状态卡三态（设计 §D3）。纯函数，单独可测。
 *
 *   empty  未配置：hasCookie=false                  → 四步引导
 *   ready  已配置且有效：hasCookie && valid          → 昵称 + 同步统计
 *   stale  已配置但失效：hasCookie && !valid         → 红条「重新复制」
 *   checking 还在查
 *
 * 注意 hasCookie 与 valid 是**两个独立维度**：宿主在 Cookie 失效时
 * 仍报 hasCookie=true（不清盘），这正是「失效红条」能显示出来的前提。
 *
 * @param {{ hasCookie?: boolean, valid?: boolean } | null} status
 * @param {boolean} [checking]
 * @returns {'checking'|'empty'|'ready'|'stale'}
 */
export function youdaoMode(status, checking) {
  if (checking) return 'checking'
  if (!status || status.hasCookie !== true) return 'empty'
  return status.valid === true ? 'ready' : 'stale'
}

/**
 * 一键抓取完成后的结果条文案（设计 §D3）。
 *
 * **重要**：宿主返回的 added/dup 恒为 0（它不知道浏览器生词本里已有什么），
 * 真实数字必须前端算：抓取前记一次 size，importMany 之后再看一次。
 * 所以这里收的是「算好的」数字，不是宿主字段。纯函数，便于验证不算错。
 *
 * @param {{ before: number, after: number, fetched: number }} input
 * @returns {{ added: number, dup: number, total: number, text: string }}
 */
export function youdaoSyncResult(input) {
  const before = Number.isFinite(input?.before) ? Math.max(0, input.before) : 0
  const after = Number.isFinite(input?.after) ? Math.max(0, input.after) : before
  const fetched = Number.isFinite(input?.fetched) ? Math.max(0, input.fetched) : 0
  // 新增 = 生词本总量的真实增量；已存在 = 抓到的里面没能新建的
  const added = Math.max(0, after - before)
  const dup = Math.max(0, fetched - added)
  return {
    added,
    dup,
    total: fetched,
    text: fetched === 0
      ? '收藏夹里没有词（或者这本收藏夹是空的）'
      : `抓取完成：新增 ${added} 词，已存在 ${dup} 词（共 ${fetched} 个）。`,
  }
}

/**
 * 有道同步页签。
 *
 * 三种状态（设计 §D3）：
 *   未配置  hasCookie=false            → 四步引导 + 输入框
 *   已配置  hasCookie=true  valid=true → 昵称 + 上次同步 + 抓取按钮
 *   已失效  hasCookie=true  valid=false→ 红条「重新复制」+ 输入框
 *
 * 抓取是一次性 POST /youdao/sync，没有真实进度，所以用不定长流光条 +
 * 「正在抓取…」文案，完成后直接出数字（不做 SSE）。
 */
export function YoudaoTab(props) {
  const { h, P, book, say: outerSay, onGoBook } = props
  const { Card, Button, Input, Select, Switch, Badge, Note, Field, GAP, FS, C } = P

  const [status, setStatus] = useState(null)   // 宿主 status 响应
  const [checking, setChecking] = useState(true)
  const [cookieText, setCookieText] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState(null)   // { added, dup, total }
  const [failure, setFailure] = useState(null) // { code, message, fallback }
  const [books, setBooks] = useState(() => {
    try { return typeof book?.listBooks === 'function' ? book.listBooks() : [] } catch { return [] }
  })
  const [targetBook, setTargetBook] = useState('default')
  const [manualOpen, setManualOpen] = useState(false)

  const refreshStatus = () => {
    setChecking(true)
    youdaoRequest('GET', '/status').then((payload) => {
      setChecking(false)
      if (payload?.ok === true) {
        setStatus(payload)
        // 失效时把红条留在界面上，但不清它 —— hasCookie 仍为 true（宿主口径）
        if (payload.valid !== true && payload.hasCookie === true) {
          setFailure({ code: 'E_YOUDAO_AUTH', message: 'Cookie 已失效，请重新复制' })
        } else {
          setFailure(null)
        }
      } else {
        setStatus({ hasCookie: false, valid: false, lastSyncAt: 0, lastCount: 0 })
        setFailure(null)
      }
    }).catch(() => { setChecking(false) })
  }

  useEffect(() => { refreshStatus() }, [])
  useEffect(() => {
    try { if (typeof book?.listBooks === 'function') setBooks(book.listBooks()) } catch { /* ignore */ }
  }, [book])

  const hasCookie = status?.hasCookie === true
  const mode = youdaoMode(status, checking)

  const onSave = () => {
    const value = cookieText.trim()
    if (value === '') { setFailure({ code: 'E_EMPTY_COOKIE', message: '先把复制的 Cookie 粘进来' }); return }
    setSaving(true)
    setFailure(null)
    youdaoRequest('POST', '/cookie', { cookie: value }).then((payload) => {
      setSaving(false)
      if (payload?.ok === true && payload.valid === true) {
        // 成功后立刻清空输入框 —— 明文不该在界面上多留一秒
        setCookieText('')
        setResult(null)
        refreshStatus()
        outerSay?.('Cookie 已保存并通过验证', 'ok')
      } else if (payload?.ok === true) {
        setFailure({ code: 'E_YOUDAO_AUTH', message: payload.message ?? 'Cookie 无效或已过期' })
      } else {
        setFailure({ code: payload?.error?.code ?? 'E_YOUDAO_FAILED', message: youdaoErrorText(payload?.error) })
      }
    }).catch(() => setSaving(false))
  }

  const onClear = () => {
    setSaving(true)
    youdaoRequest('DELETE', '/cookie').then(() => {
      setSaving(false)
      setCookieText('')
      setResult(null)
      setFailure(null)
      refreshStatus()
    }).catch(() => setSaving(false))
  }

  const onSync = () => {
    setSyncing(true)
    setFailure(null)
    setResult(null)
    youdaoRequest('POST', '/sync', { bookId: targetBook }, 180000).then((payload) => {
      if (payload?.ok !== true) {
        setSyncing(false)
        const error = payload?.error ?? { code: 'E_YOUDAO_FAILED', message: '抓取失败' }
        setFailure({ code: error.code, message: youdaoErrorText(error), fallback: error.fallback })
        if (error.code === 'E_YOUDAO_AUTH' || error.code === 'E_YOUDAO_ENDPOINT') refreshStatus()
        return
      }
      const heads = Array.isArray(payload.words) ? payload.words : []
      const glosses = payload.glosses && typeof payload.glosses === 'object' ? payload.glosses : null
      // 宿主不知道浏览器库里已有什么，added/dup 恒为 0 —— 真实新增数必须这算。
      const before = (() => { try { return book?.size?.() ?? 0 } catch { return 0 } })()
      const runImport = async () => {
        try {
          if (typeof book?.importMany !== 'function') return 0
          await book.importMany(heads, 'youdao', { bookId: targetBook, ...(glosses ? { glosses } : {}) })
          return heads.length
        } catch { return 0 }
      }
      runImport().then(() => {
        const after = (() => { try { return book?.size?.() ?? 0 } catch { return 0 } })()
        const summary = youdaoSyncResult({ before, after, fetched: heads.length })
        setSyncing(false)
        setResult({ ...summary, endpoint: payload.endpoint, pages: payload.pages })
        if (heads.length === 0) {
          setFailure({ code: 'E_YOUDAO_EMPTY', message: summary.text })
        }
        refreshStatus()
      })
    }).catch(() => setSyncing(false))
  }

  // ── 状态卡 ──
  const statusCard = (() => {
    if (mode === 'checking') {
      return h('div', { key: 'st', className: 'hds-status-card' }, [
        h('div', { key: 'm', className: 'hds-status-main' }, [
          h('div', { key: 't', className: 'hds-status-title' }, '正在检查登录状态…'),
        ]),
      ])
    }
    if (mode === 'ready') {
      return h('div', { key: 'st', className: 'hds-status-card', 'data-tone': 'ok' }, [
        h('div', { key: 'm', className: 'hds-status-main' }, [
          h('div', { key: 't', className: 'hds-status-title' },
            status?.nickname ? `${status.nickname} · 已连接` : '已连接有道'),
          h('div', { key: 'd', className: 'hds-status-meta' },
            `${syncedAtLabel(status?.lastSyncAt)}${status?.lastCount > 0 ? ` · 上次抓到 ${status.lastCount} 个词` : ''}`),
        ]),
        h(Badge, { key: 'b', text: '有效', tone: 'success' }),
      ])
    }
    if (mode === 'stale') {
      return h('div', { key: 'st', className: 'hds-status-card', 'data-tone': 'warn' }, [
        h('div', { key: 'm', className: 'hds-status-main' }, [
          h('div', { key: 't', className: 'hds-status-title' }, 'Cookie 已失效'),
          h('div', { key: 'd', className: 'hds-status-meta' },
            '有道那边不认这段登录态了。重新走一遍下面四步，把新的 Cookie 粘进来。'),
        ]),
        h(Badge, { key: 'b', text: '失效', tone: 'danger' }),
      ])
    }
    return h('div', { key: 'st', className: 'hds-status-card' }, [
      h('div', { key: 'm', className: 'hds-status-main' }, [
        h('div', { key: 't', className: 'hds-status-title' }, '还没连接有道'),
        h('div', { key: 'd', className: 'hds-status-meta' },
          '按下面四步复制一次 Cookie 就行，不用在这里输账号密码。'),
      ]),
      h(Badge, { key: 'b', text: '未配置', tone: 'neutral' }),
    ])
  })()

  // ── 四步引导（未配置 / 失效时都显示，失效的人也需要照着重做） ──
  const steps = (mode === 'empty' || mode === 'stale') ? h('ol', {
    key: 'steps', className: 'hds-steps',
  }, YOUDAO_STEPS.map((step, index) => h('li', { key: String(index), className: 'hds-step' }, [
    h('span', { key: 'n', className: 'hds-step-no', 'aria-hidden': 'true' }, String(index + 1)),
    h('div', { key: 'b', className: 'hds-step-body' }, [
      h('b', { key: 't' }, step.title),
      h('span', { key: 's' }, `　${step.detail}`),
    ]),
  ]))) : null

  const cookieField = (mode === 'empty' || mode === 'stale') ? h(Field, {
    key: 'cookie',
    label: 'Cookie',
    hint: '粘贴后输入框内容会被隐藏。保存成功后自动清空，不会留在这台机器以外的地方。',
  }, [
    h('div', { key: 'row', style: { display: 'flex', gap: GAP.sm, alignItems: 'center', flexWrap: 'wrap' } }, [
      h(Input, {
        key: 'i',
        type: 'password',
        value: cookieText,
        placeholder: '把 Request Headers 里 Cookie 那一整行全部粘进来',
        onChange: (next) => setCookieText(next),
        style: { flex: 1, minWidth: 240 },
      }),
      h(Button, {
        key: 'save',
        label: '保存并验证',
        variant: 'primary',
        busy: saving,
        onClick: onSave,
      }),
      hasCookie
        ? h(Button, { key: 'clear', label: '清除', variant: 'danger', size: 'sm', onClick: onClear })
        : null,
    ]),
  ]) : h('div', {
    key: 'connected',
    style: { display: 'flex', gap: GAP.sm, flexWrap: 'wrap' },
  }, [
    h(Button, { key: 'clear2', label: '清除 Cookie', variant: 'danger', size: 'sm', onClick: onClear }),
  ])

  // ── 抓取区 ──
  const syncBlock = (mode === 'ready') ? h('div', {
    key: 'sync',
    style: { display: 'flex', flexDirection: 'column', gap: GAP.sm },
  }, [
    h('div', { key: 'row', style: { display: 'flex', gap: GAP.sm, alignItems: 'flex-end', flexWrap: 'wrap' } }, [
      h(Field, {
        key: 'book',
        label: '抓到哪里',
        hint: '抓回来的词会进这个生词本，重复的词不会重复建档。',
      }, h(Select, {
        value: targetBook,
        options: (books.length > 0 ? books : [{ id: 'default', name: '默认生词本' }])
          .map((item) => ({ value: item.id, label: item.name })),
        onChange: (value) => setTargetBook(value),
      })),
      h(Button, {
        key: 'go',
        label: syncing ? '正在抓取…' : '一键抓取收藏夹',
        variant: 'primary',
        busy: syncing,
        onClick: onSync,
      }),
    ]),
    syncing
      ? h('div', { key: 'bar', className: 'hds-progress', role: 'progressbar', 'aria-label': '正在抓取有道收藏夹' })
      : null,
    syncing
      ? h('div', { key: 'tip', style: { fontSize: FS.small, lineHeight: 1.85, color: C.textDim } },
        '每页间隔至少 0.4 秒，词多的时候要等一会儿。请别关这个页面。')
      : null,
    result !== null
      ? h(Note, {
        key: 'done',
        tone: 'ok',
        text: result.text,
        action: onGoBook
          ? h(Button, { key: 'jump', label: '去生词本查看', size: 'sm', onClick: onGoBook })
          : null,
      })
      : null,
  ]) : null

  // ── 降级引导（宿主报接口改版） ──
  const showFallback = failure?.code === 'E_YOUDAO_ENDPOINT' || failure?.fallback === 'manual' || manualOpen
  const fallbackBlock = showFallback ? h('div', {
    key: 'fallback',
    style: { display: 'flex', flexDirection: 'column', gap: GAP.sm },
  }, [
    h(Note, {
      key: 'n',
      tone: 'err',
      text: '有道生词本接口改版了，自动抓取暂时用不了。可以按下面三步手动导进来，词一个都不会少。',
    }),
    h('ol', { key: 'steps', className: 'hds-steps' }, FALLBACK_STEP_NODES(h)),
    onGoBook
      ? h('div', { key: 'act', style: { display: 'flex', gap: GAP.sm } }, [
        h(Button, {
          key: 'go',
          label: '打开导入页',
          variant: 'primary',
          size: 'sm',
          onClick: onGoBook,
        }),
      ])
      : null,
  ]) : null

  const failureBlock = (failure !== null && failure.code !== 'E_YOUDAO_ENDPOINT')
    ? h(Note, { key: 'fail', tone: 'err', text: failure.message })
    : null

  return h(Card, {
    key: 'youdao',
    title: '有道同步',
    hint: '把有道词典收藏夹里的词一次性抓进生词本。只需复制一次 Cookie，不在这里输账号密码。',
  }, [
    statusCard,
    (mode === 'stale') ? h(Note, {
      key: 'stale',
      tone: 'err',
      text: 'Cookie 失效了。照着下面四步重新复制一次，旧的会被覆盖。',
    }) : null,
    failureBlock,
    steps,
    cookieField,
    syncBlock,
    fallbackBlock,
    !showFallback
      ? h('div', { key: 'manual', style: { display: 'flex', alignItems: 'center', gap: GAP.sm } }, [
        h('span', { key: 't', style: { fontSize: FS.small, color: C.textFaint } }, '自动抓取不顺利？'),
        h(Button, {
          key: 'b', label: '看手动导出方法', variant: 'ghost', size: 'sm',
          onClick: () => setManualOpen(true),
        }),
      ])
      : null,
  ])
}

/** 降级引导的三步节点（抽出来是因为它嵌在 ol 里，别把组件体撑长）。 */
function FALLBACK_STEP_NODES(h) {
  return YOUDAO_FALLBACK_STEPS.map((text, index) => h('li', { key: String(index), className: 'hds-step' }, [
    h('span', { key: 'n', className: 'hds-step-no', 'aria-hidden': 'true' }, String(index + 1)),
    h('div', { key: 'b', className: 'hds-step-body' }, text),
  ]))
}

/* ═══════════════════════════════════════════════════════════════════════
   localStorage 读写（沿用 v1 的键名）
   ═══════════════════════════════════════════════════════════════════════ */

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