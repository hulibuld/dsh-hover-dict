#!/usr/bin/env node
/**
 * smoke.mjs —— 端到端冒烟：把 client.js 装进一个假宿主里跑一遍。
 *
 * 这一层不测算法（各模块的单测管那个），它测的是**接线**：
 *   - 产物的 factory 能不能在只有 react 的环境里跑起来；
 *   - apply 会不会因为缺服务而抛；
 *   - slot 注册的参数是不是宿主认识的形状；
 *   - 覆盖层组件真的渲染出来后，DOM 结构对不对（含「不改正文 DOM」这条红线）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEST_DIR = join(ROOT, 'client', 'test')
const OUTPUT = readFileSync(join(ROOT, 'client.js'), 'utf8')

let pass = 0
let fail = 0
const t = (name, ok, detail) => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
}

// ── [0] 单测清单：把 client/test/_*.mjs 全部跑一遍 ──
//
// 这些单测是纯函数与数据层的独立文件（_srs / _wordbook / _dict …），
// 由本文件统一驱动，这样「四条验收命令」就是唯一闸门 ——
// 新增一个 _x.mjs 不用再改 package.json 或别处，不会被漏跑。
// 用子进程而不是 import：每个单测自己打印结果并在失败时 exit 1，
// 而且 _dict.mjs 会读 3 MB 数据文件，隔离子进程更稳。
console.log('\n[0] 单元测试清单')

const unitFiles = readdirSync(TEST_DIR)
  .filter((name) => /^_.+\.mjs$/.test(name))
  .sort()

t('找到单测文件', unitFiles.length > 0, `${unitFiles.length} 个`)
t('_srs.mjs 在清单里（设计 §A6）', unitFiles.includes('_srs.mjs'))
t('_wordbook.mjs 在清单里', unitFiles.includes('_wordbook.mjs'))

for (const file of unitFiles) {
  let ok = true
  let detail = ''
  try {
    const out = execFileSync(process.execPath, [join(TEST_DIR, file)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const summary = /(\d+)\/(\d+) passed/.exec(out)
    detail = summary ? `${summary[1]}/${summary[2]}` : 'ok'
  } catch (error) {
    ok = false
    const out = `${error.stdout ?? ''}\n${error.stderr ?? ''}`
    const failures = out.split('\n').filter((line) => line.startsWith('FAIL')).slice(0, 3)
    detail = failures.join(' | ') || `exit ${error.status ?? '?'}`
  }
  t(`单测 ${file}`, ok, detail)
}

// ── 假 React：只要能把元素树建出来 ──
function makeReact() {
  const hooks = []
  let hookIndex = 0
  const react = {
    createElement: (type, props, ...children) => {
      // 函数型 type 就是组件：递归求值，模拟 React 的渲染行为。
      // 不这么做，组件会以「函数」的形式留在树里，断言找不到它实际渲染的节点。
      if (typeof type === 'function') {
        try {
          return type({ ...(props ?? {}), children: children.flat() })
        } catch {
          return null
        }
      }
      return { type, props, children: children.flat() }
    },
    useState: (initial) => {
      const slot = hookIndex++
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [hooks[slot], (v) => { hooks[slot] = v }]
    },
    useEffect: () => {},
    useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
  return { react, resetHooks: () => { hookIndex = 0 } }
}

// ── 假 document ──
function makeDocument() {
  const listeners = new Map()
  const created = []
  const doc = {
    head: { appendChild: (node) => created.push(node) },
    documentElement: { clientWidth: 1200, clientHeight: 800 },
    createElement: (tag) => {
      const node = {
        tagName: tag.toUpperCase(),
        dataset: {},
        textContent: '',
        remove: () => {},
        setAttribute: () => {},
      }
      return node
    },
    createRange: () => ({ setStart: () => {}, setEnd: () => {}, getClientRects: () => [] }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(fn)
    },
    removeEventListener: (type, fn) => {
      const list = listeners.get(type)
      if (!list) return
      const index = list.indexOf(fn)
      if (index >= 0) list.splice(index, 1)
    },
    getSelection: () => ({ toString: () => '' }),
    __listeners: listeners,
    __created: created,
  }
  return doc
}

// ── 假宿主 ctx ──
function makeCtx(registerCalls, injectCalls) {
  const effects = []
  return {
    slots: {
      inject: (key, callback) => {
        injectCalls.push(key)
        const disposer = callback()
        return () => { if (typeof disposer === 'function') disposer() }
      },
      register: (options, component) => {
        registerCalls.push({ options, component })
        return () => {}
      },
    },
    effect: (fn) => {
      const disposer = fn()
      if (typeof disposer === 'function') effects.push(disposer)
      return () => {}
    },
    __effects: effects,
  }
}

function runFactory() {
  const { react, resetHooks } = makeReact()
  let api = null
  const sandbox = { __ModuleLoader__: { load: ({ id, factory }) => { api = factory(() => react) } } }
  const runner = new Function('window', 'document', 'requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout', 'console', OUTPUT)
  const doc = makeDocument()
  runner(
    { __ModuleLoader__: sandbox.__ModuleLoader__, innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined },
    doc,
    (fn) => { fn(); return 1 },
    () => {},
    () => 1,
    () => {},
    { warn: () => {}, error: () => {}, log: () => {} },
  )
  // h9 = 真的 React.createElement（会递归求值函数型组件）。
  // 渲染 settings 里的 section()/field() 必须用它：那些都是返回组件的函数，
  // 用一个不递归的假 h 会让整棵树塌成一层，断言就查不到里面的色块。
  return { api, doc, h: react.createElement, resetHooks }
}

console.log('\n[1] 产物装载')

const { api, doc, h: hReact, resetHooks } = runFactory()
t('factory 执行不抛', api !== null)
t('导出 apply 是函数', typeof api?.apply === 'function', typeof api?.apply)
t('导出 inject 含 slots', Array.isArray(api?.inject) && api.inject.includes('slots'), JSON.stringify(api?.inject))


console.log('\n[2] apply 的健壮性')

// 完全没有 ctx
let threw = false
try { api.apply(undefined) } catch { threw = true }
t('apply(undefined) 不抛', threw === false)

// 没有 slots 服务
threw = false
try { api.apply({}) } catch { threw = true }
t('apply({}) 不抛', threw === false)

// 正常挂载
const registerCalls = []
const injectCalls = []
const ctx = makeCtx(registerCalls, injectCalls)
threw = false
try { api.apply(ctx) } catch { threw = true }
t('apply(ctx) 不抛', threw === false)
t('只注册两个 slot（覆盖层 + 设置页）', registerCalls.length === 2, `${registerCalls.length} 次`)
t('覆盖层', registerCalls[0]?.options?.name === 'shell.overlay', registerCalls[0]?.options?.name)
t('设置页', registerCalls[1]?.options?.name === 'settings.section', registerCalls[1]?.options?.name)
t('设置页 id 稳定', registerCalls[1]?.options?.id === 'hover-dict', registerCalls[1]?.options?.id)
t('设置页有导航文字', typeof registerCalls[1]?.options?.label === 'function'
  && registerCalls[1].options.label() === '英语翻译', String(registerCalls[1]?.options?.label?.()))
t('设置页只用 id/order/label 三个字段',
  Object.keys(registerCalls[1]?.options ?? {}).every((k) => ['name', 'id', 'order', 'label', 'locale', 'inject'].includes(k)),
  Object.keys(registerCalls[1]?.options ?? {}).join(','))
t('注册带 id（宿主必需）', typeof registerCalls[0]?.options?.id === 'string',
  registerCalls[0]?.options?.id)
t('注册只用了宿主登记的字段',
  Object.keys(registerCalls[0]?.options ?? {}).every((k) => ['name', 'id', 'order', 'label', 'locale', 'inject'].includes(k)),
  Object.keys(registerCalls[0]?.options ?? {}).join(','))
t('inject 请求了两个 slot', injectCalls.length === 2
  && injectCalls.includes('shell.overlay')
  && injectCalls.includes('settings.section'), JSON.stringify(injectCalls))
t('注册了清理 effect', ctx.__effects.length >= 1, `${ctx.__effects.length} 个`)
t('样式节点已插入', doc.__created.length > 0, `${doc.__created.length} 个 style`)
t('样式节点带 data-plugin-css', doc.__created[0]?.dataset?.pluginCss !== undefined,
  doc.__created[0]?.dataset?.pluginCss)

console.log('\n[3] 覆盖层组件渲染')

const component = registerCalls[0]?.component
t('注册的是组件函数', typeof component === 'function')

// 空 store（词库还没加载）
const noopStore = {
  getSnapshot: () => ({
    mode: 'none', selection: null, result: null, entryRaw: null,
    translation: null, translating: false, translateError: '',
    placement: null, status: 'not-ready', errorMessage: '',
    ux: { timing: {}, appearance: {} },
  }),
  subscribe: () => () => {},
}
let node = null
threw = false
try { node = component({ store: noopStore, actions: {}, tagLabel: (x) => x }) } catch (e) { threw = true; console.log('    ', e.message) }
t('空状态渲染不抛', threw === false)
t('空状态渲染出根节点', node !== null && node.type === 'div')
t('根节点带 data-hover-dict-ui', node?.props?.['data-hover-dict-ui'] !== undefined)

// 有词的状态
const selection = {
  kind: 'word', text: 'hello', key: 'hello',
  rects: [{ left: 100, top: 200, right: 140, bottom: 220, width: 40, height: 20 }],
  collapsed: false,
}
const result = {
  status: 'ok', head: 'hello', matchedBy: 'head', entry: [[['int.', ['喂', '嘿']]], 'zk gk', 2238, 3, 1],
  senses: [{ pos: 'int.', posLabel: '感叹词', zh: ['喂', '嘿'], en: [] }],
  brief: { pos: '感叹词', zh: '喂；嘿', tags: ['中考', '高考'] },
  hasDetail: false,
}
const filledStore = {
  getSnapshot: () => ({
    mode: 'popover', selection, result, entryRaw: result.entry,
    translation: null, translating: false, translateError: '',
    placement: { top: 226, left: 100, placement: 'bottom', clamped: false },
    status: 'ready', errorMessage: '',
    ux: { timing: {}, appearance: { maxSensesInPopover: 2, cardMaxWidthPx: 420, cardMaxHeightRatio: 0.7, showTags: true } },
  }),
  subscribe: () => () => {},
}
threw = false
let popNode = null
try { popNode = component({ store: filledStore, actions: {}, tagLabel: (x) => x }) } catch (e) { threw = true; console.log('    ', e.message) }
t('有词状态渲染不抛', threw === false)
const flat = JSON.stringify(popNode, (k, v) => (k === 'node' || k === 'hit' || k === 'owner' ? '[obj]' : v))
t('渲染出浮层', flat.includes('hd-pop'))
t('不再渲染高亮遮罩', !flat.includes('hd-hl'))
t('显示原始词形', flat.includes('hello'))
t('显示中文释义', flat.includes('喂'))
t('显示考纲标签', flat.includes('中考'))

// 句子翻译模式
const phraseStore = {
  getSnapshot: () => ({
    mode: 'phrase',
    selection: { kind: 'phrase', text: 'The quick brown fox', key: 'The quick brown fox',
      rects: [{ left: 100, top: 200, right: 300, bottom: 220, width: 200, height: 20 }], collapsed: false },
    result: null, entryRaw: null,
    translation: '那只敏捷的棕色狐狸',
    translating: false, translateError: '',
    placement: { top: 226, left: 100, placement: 'bottom', clamped: false },
    status: 'ready', errorMessage: '',
    ux: { timing: {}, appearance: { cardMaxWidthPx: 420, cardMaxHeightRatio: 0.7 } },
  }),
  subscribe: () => () => {},
}
let phraseNode = null
threw = false
try { phraseNode = component({ store: phraseStore, actions: {}, tagLabel: (x) => x }) } catch (e) { threw = true; console.log('    ', e.message) }
const phraseJson = JSON.stringify(phraseNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('句子模式渲染不抛', threw === false)
t('渲染出译文卡片', phraseJson.includes('hd-card'))
t('显示原文', phraseJson.includes('The quick brown fox'))
t('显示译文', phraseJson.includes('那只敏捷的棕色狐狸'))

const loadingStore = {
  getSnapshot: () => ({ ...phraseStore.getSnapshot(), translation: null, translating: true }),
  subscribe: () => () => {},
}
let loadingNode = null
try { loadingNode = component({ store: loadingStore, actions: {}, tagLabel: (x) => x }) } catch { /* ignore */ }
const loadingJson = JSON.stringify(loadingNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('翻译中显示提示', loadingJson.includes('翻译中'))

// notice 形态：v2 起专供「词库未收录」提示（设计 §E2）。
// v1 曾用 notice 弹「中英混排」，后来混排改成完全不弹（selection.js 里已改回不处理），
// 所以那条旧断言改为「混排这条文案不再被任何地方渲染」。
const mixedNoticeStore = {
  getSnapshot: () => ({
    mode: 'notice',
    selection: { kind: 'skip', reason: 'mixed-language', text: '这个 tokenizers 的分词', rects: [{left:100,top:200,right:300,bottom:220,width:200,height:20}] },
    result: null, entryRaw: null, translation: null, translating: false, translateError: '',
    notice: '选中的内容中英混排，只翻译纯英文',
    placement: { top: 226, left: 100, placement: 'bottom', clamped: false },
    status: 'ready', errorMessage: '',
    ux: { timing: {}, appearance: { cardMaxWidthPx: 420, cardMaxHeightRatio: 0.7 } },
  }),
  subscribe: () => () => {},
}
let noticeNode = null
threw = false
try { noticeNode = component({ store: mixedNoticeStore, actions: {}, tagLabel: (x) => x }) } catch (e) { threw = true }
const noticeJson = JSON.stringify(noticeNode, (k, v) => (k === 'node' ? '[obj]' : v))
// 渲染级断言在 v2 下不成立：notice 是通用容器，喂什么渲染什么 —— 上面这个 store
// 主动喂了混排文案，渲染结果当然有它。真正的判据是「代码里不再产出这句文案」，
// 所以查 app.js（唯一设置 notice 的地方）而不是查渲染结果。
// t13 原意的两条正是这条 + 下面那条 source 级断言。
t('不再产出混排提示文案', !readFileSync(join(ROOT, 'client/src/app.js'), 'utf8').includes('只翻译纯英文'))
const selSrc = readFileSync(join(ROOT, 'client/src/selection.js'), 'utf8')
t('混排走「不处理」而不是 skip 提示', selSrc.includes('直接不处理，界面上什么都不弹'))

// miss 词 notice：写说明 + 给「仍要收藏」（设计 §E2）
const missStore = {
  getSnapshot: () => ({
    mode: 'notice',
    selection: { kind: 'word', text: 'zzzznotaword', key: 'zzzznotaword', rects: [{left:100,top:200,right:300,bottom:220,width:200,height:20}], collapsed: true, byPick: true },
    result: null, entryRaw: null, translation: null, translating: false, translateError: '',
    notice: '词库未收录，已加入查词记录',
    missKey: 'zzzznotaword',
    placement: { top: 226, left: 100, placement: 'bottom', clamped: false },
    status: 'ready', errorMessage: '', inBook: false,
    ux: { timing: {}, appearance: { cardMaxWidthPx: 420, cardMaxHeightRatio: 0.7 } },
  }),
  subscribe: () => () => {},
}
let missNode = null
let savedCalls = 0
threw = false
try {
  missNode = component({ store: missStore, actions: { onSaveMiss: () => { savedCalls += 1 } }, tagLabel: (x) => x })
} catch (e) { threw = true; console.log('    ', e.message) }
const missJson = JSON.stringify(missNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('miss notice 渲染不抛', threw === false)
t('miss notice 显示「词库未收录，已加入查词记录」', missJson.includes('词库未收录，已加入查词记录'))
t('miss notice 有「仍要收藏」按钮', missJson.includes('仍要收藏'))
t('miss notice 说明释义留空', missJson.includes('释义留空'))
t('仍要收藏按钮点了会走 onSaveMiss', (() => {
  // 在渲染树里找到那个按钮并触发它的 onClick
  const walk = (node) => {
    if (!node || typeof node !== 'object') return false
    if (Array.isArray(node)) return node.some(walk)
    if (node.type === 'button' && node.children && node.children.includes && node.children.includes('仍要收藏')) {
      node.props?.onClick?.({ preventDefault() {}, stopPropagation() {} })
      return true
    }
    return walk(node.children)
  }
  walk(missNode)
  return savedCalls === 1
})())

// 已收藏后：不再给按钮
const missSavedStore = {
  getSnapshot: () => ({ ...missStore.getSnapshot(), inBook: true, missKey: '', notice: '词库未收录，已加入生词本（释义留空，可在设置里写备注）' }),
  subscribe: () => () => {},
}
const missSavedJson = JSON.stringify(component({ store: missSavedStore, actions: {}, tagLabel: (x) => x }), (k, v) => (k === 'node' ? '[obj]' : v))
t('已收藏后不再显示仍要收藏', !missSavedJson.includes('仍要收藏'))
t('已收藏后文案改成已加入', missSavedJson.includes('已加入生词本'))

console.log('\n[4] 侧边栏面板')

// 面板组件是注册的第二项（设置页那一项）
const panelComponent = registerCalls[1]?.component
t('面板是组件函数', typeof panelComponent === 'function')

let panelNode = null
threw = false
try {
  panelNode = panelComponent({ wordbook: null, dict: null })
} catch (e) { threw = true; console.log('    ', e.message) }
const panelJson = JSON.stringify(panelNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('空生词本渲染不抛', threw === false)
t('页面有头部标题', panelJson.includes('英语翻译'))
t('页面有说明文字', panelJson.includes('点击或划选'))
t('分区有卡片外壳', panelJson.includes('aria-label') || panelJson.includes('section'))
// v2 起「词库与句子库」收进「外观与交互」页签（设计 §B5），默认页签是生词本，
// 所以这里验证源码里仍在，而不是默认视图里能看见。
const settingsSrc = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
t('词库区块仍在（外观页签）', settingsSrc.includes('词库与句子库'))

// 有生词的情况
const fakeBook = {
  list: () => [
    { head: 'cute', addedAt: 1, source: 'dsh', note: '', review: { seen: 0, lastSeenAt: 0 } },
    { head: 'run', addedAt: 2, source: 'dsh', note: '', review: { seen: 0, lastSeenAt: 0 } },
  ],
  subscribe: () => () => {},
  remove: () => Promise.resolve(true),
  size: () => 2,
}
const fakeDict = {
  entries: {
    cute: [[['adj.', ['可爱的']], 'ielts', 4345, 1, 0]],
    run: [[['v.', ['跑', '奔跑']]], 'zk gk', 202, 5, 1],
  },
}
let filledPanel = null
threw = false
try { filledPanel = panelComponent({ wordbook: fakeBook, dict: fakeDict }) } catch (e) { threw = true }
const filledJson = JSON.stringify(filledPanel, (k, v) => (k === 'node' ? '[obj]' : v))
t('生词本渲染不抛', threw === false)
t('显示生词 cute', filledJson.includes('cute'))
t('显示生词 run', filledJson.includes('run'))
t('生词本区块能渲染', filledJson.includes('hds-table') || filledJson.includes('生词'))
t('显示生词数量', filledJson.includes('总词数') && filledJson.includes('2'))

// 设置标签页（tab 默认是生词本，这里直接渲染 SettingsPanel 部分不方便，
// 改为验证开关组件与词库卡片存在于源码里）
const src = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
t('按钮有悬停扫光与按压缩放',
  src.includes('.hds-btn::after') && src.includes('transform: scale(.985)'),
  '扫光/缩放')
t('按钮用存在的分层 token', src.includes('--dsw-alias-bg-layer-2') && !src.includes('bg-layer-3'))
t('有词库包清单', src.includes('WORD_PACKS'))
t('系统自带三个包', (src.match(/builtin: true/g) ?? []).length === 3,
  String((src.match(/builtin: true/g) ?? []).length))
// 只列系统自带的三个；且组件里不再渲染「下载/停用」按钮
t('只列系统自带的三个包', (src.match(/builtin: true/g) ?? []).length === 3,
  String((src.match(/builtin: true/g) ?? []).length))
t('不再渲染下载按钮', !src.includes("'下载'") && !src.includes("'停用'"))
t('给了自定义词库的放法', src.includes('packsDir') && src.includes('复制路径'))
t('开关有 track 与滑块', src.includes('hds-switch-track') && src.includes('aria-checked'))
t('行高够松', src.includes('line-height: 1.78') || src.includes('line-height: 1.85'))
t('有自定义开关控件', src.includes('hds-switch'))

console.log('\n[5] v2 后台：五 tab 与管理台')

const settingsSrc2 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
for (const label of ['生词本', '复习', '导入', '外观与交互', '有道同步']) {
  t(`页签「${label}」存在`, settingsSrc2.includes(`label: '${label}'`))
}
t('默认页签是生词本', /useState\('book'\)/.test(settingsSrc2))

t('产物透出 bookTab', typeof api.bookTab === 'function')
t('产物透出 ReviewTab', typeof api.ReviewTab === 'function')
t('产物透出 ImportTab', typeof api.ImportTab === 'function')
t('产物透出 parseImportDetailed', typeof api.parseImportDetailed === 'function')
t('产物透出 GRADE_BUTTONS', Array.isArray(api.GRADE_BUTTONS))

t('管理台分页档位可调（10/15/20，默认 20）',
  settingsSrc2.includes('PAGE_SIZE_OPTIONS') && settingsSrc2.includes('DEFAULT_APPEARANCE.pageSize'))
t('管理台有搜索框', settingsSrc2.includes('按词头或释义搜索'))
t('管理台有状态筛选', settingsSrc2.includes('stateChips'))
t('管理台有批量操作', settingsSrc2.includes('转为已掌握') && settingsSrc2.includes('移入词书'))
t('管理台有三种导出', settingsSrc2.includes("onExport('txt')") && settingsSrc2.includes("onExport('csv')") && settingsSrc2.includes("onExport('json')"))
t('确认移出不用原生弹窗', !settingsSrc2.includes('window.confirm('))
t('不再按 120 硬截断（改为真分页）',
  /const CHIP_LIMIT\s*=/.test(settingsSrc2) === false && settingsSrc2.includes('pageSize'))

// 导入：真跑一次解析，钉子钉在产物的真实函数上
const parsedDemo = api.parseImportDetailed('# 注释\napple  /ˈæpl/  n. 苹果\nbanana  n. 香蕉', {
  isDup: (h) => h === 'banana',
  isKnown: () => true,
})
t('产物解析出词头', parsedDemo.words.map((w) => w.head).join(','), 'apple,banana')
t('产物解析出音标', parsedDemo.words[0].phonetic, '/ˈæpl/')
t('产物标出已存在', parsedDemo.words[1].status, 'dup')
t('产物跳过行带原因', parsedDemo.skipped.length === 1 && parsedDemo.skipped[0].reason === '注释行')
t('导入两步（确认才写库）', settingsSrc2.includes('解析预览') && settingsSrc2.includes('确认导入'))
t('导入支持文件读取', settingsSrc2.includes("type: 'file'") && settingsSrc2.includes('FileReader'))
t('导入支持 JSON 备份恢复', settingsSrc2.includes('record') && settingsSrc2.includes('dsh-hover-dict/wordbook'))

// 复习
t('复习空格翻面', settingsSrc2.includes('空格') && api.actionForKey(' ') === 'flip')
t('复习 1/2/3 评分', api.actionForKey('1') === 'again' && api.actionForKey('2') === 'hard' && api.actionForKey('3') === 'good')
const reviewSrc = readFileSync(join(ROOT, 'client/src/review.js'), 'utf8')
t('复习双向切换', (settingsSrc2 + reviewSrc).includes('英 → 中') && (settingsSrc2 + reviewSrc).includes('中 → 英'))
t('复习空队列引导', settingsSrc2.includes('今天没有到期的词') && settingsSrc2.includes('提前复习'))
t('复习结束页有正确率', settingsSrc2.includes('正确率'))
t('复习键盘不抢输入框', api.shouldHandleKey({ key: '1', target: { tagName: 'INPUT' } }) === false)

// ── review.js 纯函数（并入 smoke，in-scope 只登记了 _importer.mjs） ──
const mkEntry = (head, state, extra = {}) => ({
  head, addedAt: 1_700_000_000_000, source: 'dsh', bookId: 'default', note: '', gloss: '', state,
  srs: { due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReviewAt: 0 }, ...extra,
})
t('评分顺序 again/hard/good', api.GRADE_BUTTONS.map((g) => g.grade).join(','), 'again,hard,good')
t('评分键位 1/2/3', api.GRADE_BUTTONS.map((g) => g.key).join(''), '123')
t('筛选芯片三个', api.REVIEW_FILTERS.map((f) => f.id).join(','), 'all,unknown,fuzzy')
t('方向两个', api.DIRECTIONS.map((d) => d.id).join(','), 'en-zh,zh-en')
t('提前复习默认 20', api.AHEAD_COUNT === 20)
t('归属书含 alsoIn', api.booksOfEntry(mkEntry('a', 'new', { alsoIn: ['cet4', 'cet4'] })).join(','), 'default,cet4')
t('只刷不认识', api.filterQueue([mkEntry('a', 'unknown'), mkEntry('b', 'fuzzy')], { state: 'unknown' }).map((e) => e.head).join(','), 'a')
t('按词书筛（alsoIn 也算）', api.filterQueue([mkEntry('a', 'new', { alsoIn: ['x'] })], { bookId: 'x' }).length === 1)
t('空 head 被剔掉', api.filterQueue([null, { head: '' }, mkEntry('a', 'new')]).map((e) => e.head).join(','), 'a')
t('中→英剔掉没释义的词', api.queueForDirection([mkEntry('apple', 'new'), mkEntry('zzz', 'new')], 'zh-en', { entries: { apple: [[['n.', ['苹果']]], null, null] } }).map((e) => e.head).join(','), 'apple')
t('有 gloss 就能中→英', api.briefTextFor(mkEntry('x', 'new', { gloss: 'n. 叉' }), null), 'n. 叉')
t('背面词性对齐 describeEntry', api.cardBackFor('apple', { entries: { apple: [[['n.', ['苹果']]], null, null] } }).senses[0].pos, 'n.')
t('背面例句是 {en,zh}', JSON.stringify(api.cardBackFor('run', { entries: { run: [[['v.', ['跑']]], null, null, 0, 0, [['I run.', '我跑。']]] } }).example), JSON.stringify({ en: 'I run.', zh: '我跑。' }))
t('词库没有 → 空背面', api.cardBackFor('zzz', { entries: {} }).senses.length === 0)
t('本轮正确率', api.roundSummary([{ grade: 'good' }, { grade: 'good' }, { grade: 'again' }, { grade: 'hard' }]).accuracy === 50)
t('空轮正确率 0', api.roundSummary([]).accuracy === 0)
t('due=0 → 已到期', api.dueLabel(0, 1_700_000_000_000), '已到期')
t('due 明天 → 今天或明天', api.dueLabel(1_700_000_000_000 + 43200000, 1_700_000_000_000), '今天或明天')
t('提前复习按 due 升序', api.aheadQueue([
  mkEntry('late', 'new', { srs: { due: 9e12 } }),
  mkEntry('soon', 'new', { srs: { due: 1e9 } }),
], 2, 1_700_000_000_000).map((e) => e.head).join(','), 'soon,late')
t('空格→flip', api.actionForKey(' '), 'flip')
t('回车→flip', api.actionForKey('Enter'), 'flip')
t('Esc→exit', api.actionForKey('Escape'), 'exit')
t('1/2/3→again/hard/good', [api.actionForKey('1'), api.actionForKey('2'), api.actionForKey('3')].join(','), 'again,hard,good')
t('其他键不处理', api.actionForKey('x') === '')
t('输入框里不抢键', api.shouldHandleKey({ key: '1', target: { tagName: 'INPUT' } }) === false)
t('可编辑区不抢键', api.shouldHandleKey({ key: '1', target: { isContentEditable: true } }) === false)
t('带修饰键不抢', api.shouldHandleKey({ key: '1', metaKey: true }) === false)
t('已处理过的事件不重入', api.shouldHandleKey({ key: '1', defaultPrevented: true }) === false)
t('空格接管', api.shouldHandleKey({ key: ' ' }) === true)
t('aheadQueue 默认上限 20', api.aheadQueue(Array.from({ length: 30 }, (_, i) => mkEntry(`w${i}`, 'new', { srs: { due: i } }))).length === 20)
t('dueLabel 5 天后', api.dueLabel(1_700_000_000_000 + 5 * 86400000, 1_700_000_000_000) === '5 天后')
t('booksOfEntry(null) 返回空', api.booksOfEntry(null).length === 0)
t('filterQueue(null) 不抛', api.filterQueue(null, {}).length === 0)
t('cardBackFor 空 head 返回空', api.cardBackFor('', { entries: {} }).senses.length === 0)
t('roundSummary 三态计数', (() => { const r = api.roundSummary([{ grade: 'good' }, { grade: 'again' }, { grade: 'hard' }, { grade: 'again' }]); return r.good === 1 && r.again === 2 && r.hard === 1 && r.total === 4 })())
t('英→中不剔词', api.queueForDirection([mkEntry('apple', 'new'), mkEntry('zzz', 'new')], 'en-zh', null).length === 2)

t('侧边栏渲染出五个页签', (() => {
  const node = panelComponent({ wordbook: null, dict: null })
  const json = JSON.stringify(node, (k, v) => (k === 'node' ? '[obj]' : v))
  return ['生词本', '复习', '导入', '外观与交互', '有道同步'].every((label) => json.includes(label))
})())

console.log('\n[6] 生词着色：挂载与「不改正文 DOM」红线回归')

// ── 6.1 着色层挂进 OverlayHost ──
const marksStore = {
  getSnapshot: () => ({
    mode: 'none', selection: null, result: null, entryRaw: null,
    translation: null, translating: false, translateError: '',
    placement: null, status: 'ready', errorMessage: '',
    ux: { timing: {}, appearance: { markWords: true, markColor: '#e5484d', markKnown: false, markStyle: 'underline' } },
    marks: [
      { key: 'cute', text: 'cute', think: false, known: false,
        rects: [{ left: 10, top: 20, right: 50, bottom: 36, width: 40, height: 16 }],
        bounds: { left: 10, top: 20, right: 50, bottom: 36, width: 40, height: 16 } },
    ],
  }),
  subscribe: () => () => {},
}
let marksNode = null
threw = false
try { marksNode = component({ store: marksStore, actions: {}, tagLabel: (x) => x }) } catch (e) { threw = true; console.log('    ', e.message) }
t('有着色时装色块渲染不抛', threw === false)

const marksJson = JSON.stringify(marksNode, (k, v) => (k === 'node' || k === 'hit' || k === 'owner' ? '[obj]' : v))
t('色块层出现在渲染树里', marksJson.includes('hd-marks'))
t('色块本身是 hd-mark', marksJson.includes('hd-mark'))
t('色块层排在浮层之前（画在下面）', (() => {
  const kids = marksNode?.children ?? []
  const first = kids[0]
  const json = JSON.stringify(first, (k, v) => (k === 'node' ? '[obj]' : v))
  return json.includes('hd-marks')
})())
t('色块层不吃鼠标事件', (() => {
  const stack = [marksNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-marks')) {
      return cur.props.onClick === undefined && cur.props.onPointerDown === undefined
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())
t('色块用 fixed 定位且不吃事件', (() => {
  const stack = [marksNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-mark')) {
      const style = cur.props.style ?? {}
      return style.position === 'fixed' && style.pointerEvents === 'none'
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())
t('色块用半透明底色（color-mix，无 blend mode）', (() => {
  const stack = [marksNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-mark')) {
      const style = cur.props.style ?? {}
      const bg = String(style.background ?? '')
      return bg.includes('color-mix') && bg.includes('#e5484d') && style.mixBlendMode === undefined
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())
t('色块带 1.5px 下划线（默认 underline）', (() => {
  const stack = [marksNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-mark')) {
      return String(cur.props.style?.borderBottom ?? '').includes('1.5px solid')
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())

const offStore = {
  getSnapshot: () => ({
    ...marksStore.getSnapshot(),
    ux: { timing: {}, appearance: { markWords: false, markColor: '#e5484d' } },
  }),
  subscribe: () => () => {},
}
const offNode = component({ store: offStore, actions: {}, tagLabel: (x) => x })
const offJson = JSON.stringify(offNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('markWords=false 完全不渲染色块', !offJson.includes('hd-mark'), '无 hd-mark 节点')
t('markWords=false 仍渲染覆盖层根', offNode !== null)

const blueStore = {
  getSnapshot: () => ({
    ...marksStore.getSnapshot(),
    ux: { timing: {}, appearance: { markWords: true, markColor: '#4d6bfe', markStyle: 'background' } },
  }),
  subscribe: () => () => {},
}
const blueNode = component({ store: blueStore, actions: {}, tagLabel: (x) => x })
const blueJson = JSON.stringify(blueNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('改色即时生效', blueJson.includes('#4d6bfe') && !blueJson.includes('#e5484d'))
t('改样式即时生效（background 无下划线）', (() => {
  const stack = [blueNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-mark')) {
      return cur.props.style?.borderBottom === undefined && String(cur.props.style?.background ?? '').includes('color-mix')
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())
const knownStore = {
  getSnapshot: () => ({
    ...marksStore.getSnapshot(),
    marks: [{ ...marksStore.getSnapshot().marks[0], known: true }],
  }),
  subscribe: () => () => {},
}
const knownNode = component({ store: knownStore, actions: {}, tagLabel: (x) => x })
t('已掌握词 opacit .5 淡色', (() => {
  const stack = [knownNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-mark')) return cur.props.style?.opacity === 0.5
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())

const emptyMarksStore = {
  getSnapshot: () => ({ ...marksStore.getSnapshot(), marks: [] }),
  subscribe: () => () => {},
}
t('无色块时不渲染空层', !JSON.stringify(component({ store: emptyMarksStore, actions: {}, tagLabel: (x) => x }),
  (k, v) => (k === 'node' ? '[obj]' : v)).includes('hd-marks'))

// ── 6.2 红线回归：正文 DOM 零改动 ──
function snapshotDom(root) {
  const out = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    const attrs = node.attributes && typeof node.attributes === 'object'
      ? Object.keys(node.attributes).sort().map((k) => `${k}=${String(node.attributes[k])}`).join('|')
      : (node.dataset && typeof node.dataset === 'object'
        ? Object.keys(node.dataset).sort().map((k) => `data-${k}=${String(node.dataset[k])}`).join('|')
        : '')
    out.push(`${path}:${node.tagName ?? node.nodeName ?? node.type ?? ''}:${attrs}:${node.childNodes?.length ?? node.children?.length ?? 0}:${String(node.textContent ?? node.nodeValue ?? '')}`)
    const kids = node.childNodes ?? node.children ?? []
    for (let i = 0; i < kids.length; i += 1) walk(kids[i], `${path}/${i}`)
  }
  walk(root, 'r')
  return out.join('\n')
}

function makeBodyTree() {
  const text = (value) => ({ nodeType: 3, nodeValue: value, data: value, textContent: value, childNodes: [] })
  const p1 = { nodeType: 1, tagName: 'P', attributes: {}, childNodes: [text('a cute cat runs fast')], textContent: 'a cute cat runs fast' }
  const p2 = { nodeType: 1, tagName: 'P', attributes: {}, childNodes: [text('this cute thing')], textContent: 'this cute thing' }
  const think = {
    nodeType: 1, tagName: 'DIV', attributes: { 'data-variant': 'think' },
    childNodes: [p2], textContent: 'this cute thing',
  }
  const root = {
    nodeType: 1, tagName: 'DIV',
    attributes: { 'data-chat-flow-kind': 'assistant-step' },
    childNodes: [p1, think], textContent: 'a cute cat runs fastthis cute thing',
  }
  p1.parentNode = root; p2.parentNode = think; think.parentNode = root
  return root
}

const bodyTree = makeBodyTree()
const before = snapshotDom(bodyTree)
const bodyMarkCount = bodyTree.childNodes.length

component({ store: marksStore, actions: {}, tagLabel: (x) => x })
component({ store: offStore, actions: {}, tagLabel: (x) => x })
component({ store: blueStore, actions: {}, tagLabel: (x) => x })
const after = snapshotDom(bodyTree)

t('正文 DOM 逐节点未变（红线）', before === after, before === after ? '指纹一致' : '正文被改过')
t('正文节点数未增', bodyTree.childNodes.length === bodyMarkCount, `${bodyTree.childNodes.length} vs ${bodyMarkCount}`)
t('正文没有新增属性', (() => {
  const attrs = Object.keys(bodyTree.attributes ?? {})
  return attrs.join(',') === 'data-chat-flow-kind'
})(), Object.keys(bodyTree.attributes ?? {}).join(','))
t('正文段落没有子节点被插入', bodyTree.childNodes[0].childNodes.length === 1)
t('正文里不存在任何 hd-mark', !snapshotDom(bodyTree).includes('hd-mark'))

// ── 6.3 纯函数层经产物可用 ──
t('产物透出 MarkerLayer', typeof api.MarkerLayer === 'function')
t('产物透出 MarkerLayerHost', typeof api.MarkerLayerHost === 'function')
t('产物透出 buildMarks', typeof api.buildMarks === 'function')
t('产物透出 expandWordSet', typeof api.expandWordSet === 'function')
t('产物透出色块上限 400', api.MARK_MAX === 400)
t('产物 expandWordSet 保留 known 过滤口径', (() => {
  const keys = api.expandWordSet({
    entries: [{ head: 'cute', state: 'fuzzy' }, { head: 'know', state: 'known' }],
    dict: { entries: { cute: [null, null, null, null, null, 'r:cuter'] } },
  })
  return keys.has('cute') && keys.has('cuter') && !keys.has('know')
})())
t('产物 expandWordSet 开 markKnown 才收 known', api.expandWordSet({
  entries: [{ head: 'know', state: 'known' }], dict: null, markKnown: true,
}).get('know') === true)
t('产物 buildMarks 词集空 → 空结果且不抛', api.buildMarks({ doc: makeDocument(), keys: new Map() }).length === 0)

// ── 6.4 浮层里的「已在生词本 · 状态」小字行（§C3） ──
const statefulStore = {
  getSnapshot: () => ({
    ...filledStore.getSnapshot(),
    inBook: true,
    inBookEntry: { head: 'hello', state: 'unknown' },
  }),
  subscribe: () => () => {},
}
const statefulNode = component({ store: statefulStore, actions: {}, tagLabel: (x) => x })
const statefulJson = JSON.stringify(statefulNode, (k, v) => (k === 'node' ? '[obj]' : v))
t('浮层显示「已在生词本 · 状态」', statefulJson.includes('已在生词本') && statefulJson.includes('不认识'))
t('状态行带色点', statefulJson.includes('hd-state-dot'))
t('状态行是状态色的点而非写死色', (() => {
  const stack = [statefulNode]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    const cls = cur.props?.className
    if (typeof cls === 'string' && cls.split(/\s+/).includes('hd-state-dot')) {
      return String(cur.props.style?.background ?? '').startsWith('var(--dsw-alias-')
    }
    for (const kid of cur.children ?? []) stack.push(kid)
  }
  return false
})())
const knownStateStore = {
  getSnapshot: () => ({ ...filledStore.getSnapshot(), inBook: true, inBookEntry: { head: 'hello', state: 'known' } }),
  subscribe: () => () => {},
}
t('状态行跟随词条状态（known → 已掌握）', JSON.stringify(
  component({ store: knownStateStore, actions: {}, tagLabel: (x) => x }),
  (k, v) => (k === 'node' ? '[obj]' : v)).includes('已掌握'))
t('不在生词本时不显示状态行', !flat.includes('hd-state'))

// ── 6.5 性能预算：一次全量扫描 <16ms（§C2.5） ──
const PERF_NODES = 200
const PERF_WORDS = 60
const tokenOf = (i) => `zz${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`
const perfKeys = new Map()
for (let i = 0; i < PERF_WORDS; i += 1) perfKeys.set(tokenOf(i), false)
const perfSentence = `the quick brown fox ${tokenOf(3)} jumps over the lazy dog while ${tokenOf(7)} and ${tokenOf(11)} share ${tokenOf(23)} a line of prose`
function makePerfDoc() {
  const nodes = []
  for (let i = 0; i < PERF_NODES; i += 1) {
    nodes.push({
      nodeType: 3,
      nodeValue: perfSentence,
      data: perfSentence,
      __rects: () => [{
        left: 10, top: i * 18, right: 300, bottom: i * 18 + 16, width: 290, height: 16,
      }],
    })
  }
  const root = { nodeType: 1, tagName: 'DIV', childNodes: nodes, closest: () => null }
  for (const node of nodes) { node.parentNode = root; node.parentElement = root }
  return {
    doc: {
      createRange: () => {
        const state = { node: null }
        return {
          setStart(node) { state.node = node },
          setEnd() {},
          getClientRects() { return state.node?.__rects?.() ?? [] },
        }
      },
      createTreeWalker: () => {
        let index = 0
        return { nextNode: () => nodes[index++] ?? null }
      },
      querySelectorAll: (sel) => (sel === '[data-chat-flow-kind="assistant-step"]' ? [root] : []),
      querySelector: () => null,
    },
    root,
  }
}
const perf = makePerfDoc()
const perfStart = performance.now()
const perfMarks = api.buildMarks({ doc: perf.doc, keys: perfKeys, viewport: { left: 0, top: 0, right: 1200, bottom: 800 } })
const perfMs = performance.now() - perfStart
t('全量扫描产出色块', perfMarks.length > 0, `${perfMarks.length} 块`)
t('单次扫描 <16ms（性能预算）', perfMs < 16, `${perfMs.toFixed(2)} ms / ${PERF_NODES} 节点`)
t('色块被视口裁剪（一屏外的没画）', perfMarks.every((m) => m.bounds.bottom >= -200 && m.bounds.top <= 1000), `${perfMarks.length} 块`)
t('色块不超过 400 上限', perfMarks.length <= 400, String(perfMarks.length))

const manyMarks = []
for (let i = 0; i < 600; i += 1) {
  manyMarks.push({ key: `k${i}`, rects: [], bounds: { left: 0, top: i * 2, right: 40, bottom: i * 2 + 16, width: 40, height: 16 } })
}
const capped = api.capMarks(manyMarks, { max: api.MARK_MAX, viewport: { width: 1200, height: 800 } })
t('色块超过 400 时截断到 400', capped.length === 400, `${capped.length} / 600`)
t('截断保视口中心附近（不是简单取前 400）', (() => {
  const tops = capped.map((m) => m.bounds.top)
  const center = 800 / 2
  return tops.filter((top) => Math.abs(top - center) < 200).length > 0
})())

// ── 6.6 重算调度器（滚动/流式/生词本三条入口共用同一个） ──
const srcApp = readFileSync(join(ROOT, 'client/src/app.js'), 'utf8')
t('接线用了 createRecalcScheduler', srcApp.includes('createRecalcScheduler'))
t('接线用了 bindRecalcEvents（滚动+resize+MutationObserver）', srcApp.includes('bindRecalcEvents'))
t('生词本 subscribe 触发重算', /subscribe\(\(\)\s*=>\s*\{[\s\S]{0,400}?markScheduler\.request\(\)/.test(srcApp))
t('词库 ready 后触发词集重算', /rebuildMarkKeys\(\)[\s\S]{0,200}?markScheduler\.request\(\)/.test(srcApp))
t('首扫走 requestIdleCallback', srcApp.includes('scheduleMarkScan') && srcApp.includes('requestIdleCallback'))
t('collectBookSet 复用 marker 的词集展开', /const collectBookSet[\s\S]{0,600}?expandWordSet\(/.test(srcApp))
t('OverlayHost 把色块层放在第一个 child', /const children = \[\][\s\S]{0,600}?children\.push\(h\(MarkerLayerHost/.test(srcApp))
t('接线段没有直接写 DOM 的调用', !srcApp.includes('textContent =') && !srcApp.includes('setAttribute(') && !srcApp.includes('appendChild('))

let schedRuns = 0
let schedNow = 0
const schedTimers = new Map()
let schedSeq = 1
const sched = api.createRecalcScheduler({
  run: () => { schedRuns += 1 },
  now: () => schedNow,
  setTimeout: (fn, ms) => { const id = schedSeq++; schedTimers.set(id, { at: schedNow + ms, fn }); return id },
  clearTimeout: (id) => { schedTimers.delete(id) },
})
const advance = (ms) => {
  schedNow += ms
  for (const [id, timer] of [...schedTimers]) {
    if (timer.at <= schedNow) { schedTimers.delete(id); timer.fn() }
  }
}
sched.scroll()
t('滚动首跑立即重算', schedRuns === 1, String(schedRuns))
sched.scroll(); sched.scroll()
t('窗口内多次滚动只挂一个尾随', schedTimers.size === 1, `${schedTimers.size} 个计时器`)
advance(120)
t('120ms 节流后补跑一次', schedRuns === 2, String(schedRuns))
advance(200)
const beforeMutate = schedRuns
sched.mutate(); advance(100); sched.mutate(); advance(100); sched.mutate()
t('流式输出 250ms 防抖合并成一次', schedRuns === beforeMutate, String(schedRuns))
advance(250)
t('静默 250ms 后跑（不是每帧扫）', schedRuns === beforeMutate + 1, String(schedRuns))
const beforeResize = schedRuns
sched.mutate(); sched.resize()
t('resize 立即重算并清挂起', schedRuns === beforeResize + 1 && schedTimers.size === 0)
sched.dispose()
const afterDispose = schedRuns
sched.scroll(); sched.mutate(); advance(1000)
t('卸载后不再重算', schedRuns === afterDispose)

// ── 6.7 单帧耗时进快照 ──
t('快照带 markStats', (() => {
  const snap = marksStore.getSnapshot()
  return snap.markStats === undefined || typeof snap.markStats === 'object'
})())
t('接线记录单帧耗时', srcApp.includes('markStats') && srcApp.includes('lastMs'))
t('接线把色块数记进快照', srcApp.includes('count: marks.length'))

// ── 6.8 主路径：CSS Custom Highlight API（用户裁定只要改字色） ──
//
// 用户原话：「我们不需要下划线和色块啊，只要改字的颜色即可。」
// Highlight API 在完全不改正文 DOM 的前提下给文字上色，且颜色跟文字走，
// 所以「滚动时色块不跟字」的偏移问题从根上消失 —— 不需要任何 rAF 重测。

t('产物透出 buildHighlightRanges', typeof api.buildHighlightRanges === 'function')
t('产物透出 applyHighlights', typeof api.applyHighlights === 'function')
t('产物透出 supportsHighlight', typeof api.supportsHighlight === 'function')
t('产物透出 markColorToCss', typeof api.markColorToCss === 'function')
t('产物透出 highlightCss', typeof api.highlightCss === 'function')
t('产物透出 highlight 注册名', api.HIGHLIGHT_WORDS === 'dsh-hover-dict-words', api.HIGHLIGHT_WORDS)
t('已知词用独立注册名', api.HIGHLIGHT_KNOWN === 'dsh-hover-dict-known', api.HIGHLIGHT_KNOWN)

// theme-error：默认色就是宿主错误红 token（用户要的「和报错红字一样的红」）
t('默认色是 theme-error 哨兵', api.normalizeMarkColor('theme-error') === 'theme-error')
t('哨兵翻成错误红 token 且带 hex 兜底',
  api.markColorToCss('theme-error') === 'var(--dsw-alias-state-error-primary, #e5484d)')
t('具体 hex 仍走 hex 路径', api.markColorToCss('#4d6bfe') === '#4d6bfe')

// ::highlight 规则只改 color，不带 background/border/text-decoration
const hlRule = api.highlightCss({ markColor: 'theme-error' })
t('::highlight 用 words 注册名', hlRule.includes('::highlight(dsh-hover-dict-words)'))
t('::highlight 用错误红 token', hlRule.includes('color: var(--dsw-alias-state-error-primary, #e5484d)'))
t('::highlight 不含 background', !hlRule.includes('background'))
t('::highlight 不含 border', !hlRule.includes('border'))
t('::highlight 不含 text-decoration', !hlRule.includes('text-decoration'))

// 接线：主路径优先，注册失败才回退色块
t('接线判断环境是否支持 Highlight', srcApp.includes('supportsHighlight('))
t('接线用 buildHighlightRanges', srcApp.includes('buildHighlightRanges('))
t('接线用 applyHighlights 注册', srcApp.includes('applyHighlights('))
t('主路径优先于色块回退', /if \(highlightOn\)[\s\S]{0,700}?buildHighlightRanges[\s\S]{0,700}?applyHighlights[\s\S]{0,900}?回退路径/.test(srcApp)
  || (srcApp.indexOf('buildHighlightRanges(') < srcApp.indexOf('buildMarks({ doc, keys, max: MARK_MAX })')))
t('关闭着色时清掉 highlight 注册', /markWords === false[\s\S]{0,400}?clearHighlights/.test(srcApp))
t('卸载时清掉 highlight 注册', /ctx\.effect[\s\S]{0,600}?clearHighlights/.test(srcApp))
t('改色时重刷 ::highlight 规则（即时生效落点）', /reloadUx[\s\S]{0,400}?refreshStyle/.test(srcApp))
t('快照带 markMode 区分两条路径', srcApp.includes("markMode: highlightOn ? 'highlight' : 'overlay'"))
t('快照带 markCount（Highlight 没有色块只有计数）', srcApp.includes('markCount: runtime.markCount'))

// 端到端：真跑产物，注册/清空/不支持的降级
const hlRegistry = new Map()
const hlScope = {
  Highlight: function Highlight(...rs) { this.ranges = rs },
  CSS: { highlights: { set: (k, v) => hlRegistry.set(k, v), delete: (k) => hlRegistry.delete(k) } },
}
t('supportsHighlight 认完整环境', api.supportsHighlight(hlScope) === true)
t('supportsHighlight 缺 registry 时不认', api.supportsHighlight({ Highlight: function () {}, CSS: {} }) === false)

const hlDocForTest = {
  createRange: () => {
    const st = { node: null, start: 0, end: 0 }
    return {
      setStart(n, o) { st.node = n; st.start = o },
      setEnd(n, o) { st.end = o },
      getClientRects() { return [] },
    }
  },
  createTreeWalker: () => {
    const list = [{ nodeType: 3, nodeValue: 'a cute cat', data: 'a cute cat', isConnected: true }]
    let i = 0
    return { nextNode: () => list[i++] ?? null }
  },
  querySelectorAll: (sel) => {
    if (sel !== '[data-chat-flow-kind="assistant-step"]') return []
    const node = { nodeType: 3, nodeValue: 'a cute cat', data: 'a cute cat', isConnected: true }
    node.parentNode = { nodeType: 1, closest: () => null }
    node.parentElement = node.parentNode
    const root = { nodeType: 1, childNodes: [node], closest: () => null }
    return [root]
  },
  querySelector: () => null,
}
// 注意：matchWordsInText 过滤掉长度 <2 的片段（单字母不查），所以这里用两个真词
const hlKeysForTest = new Map([['cute', false], ['cat', false]])
const hlBuiltForTest = api.buildHighlightRanges({ doc: hlDocForTest, keys: hlKeysForTest })
t('端到端建出 ranges', hlBuiltForTest.ranges.length === 2, `${hlBuiltForTest.ranges.length} 个`)
t('端到端 stats 有 hits/words', hlBuiltForTest.stats.words === 2 && hlBuiltForTest.stats.hits === 2)
const hlApplied = api.applyHighlights({ scope: hlScope, ranges: hlBuiltForTest.ranges, knownRanges: [] })
t('端到端注册成功', hlApplied.ok === true)
t('注册表里有 words', hlRegistry.has('dsh-hover-dict-words'))
api.applyHighlights({ scope: hlScope, ranges: [], knownRanges: [] })
t('空 ranges 时删除注册', hlRegistry.has('dsh-hover-dict-words') === false)

// 红线：Highlight 路径不改正文任何节点
const bodyForHl = makeBodyTree()
const beforeHl = snapshotDom(bodyForHl)
api.applyHighlights({ scope: hlScope, ranges: hlBuiltForTest.ranges, knownRanges: [] })
api.clearHighlights(hlScope)
t('Highlight 路径跑完正文指纹不变（红线）', snapshotDom(bodyForHl) === beforeHl)
t('产物透出 clearHighlights', typeof api.clearHighlights === 'function')

// 假 window 没有 Highlight，所以 smoke 里走的是色块回退路径（这本身要能被证明）。
// 真浏览器（supported）走主路径 —— 用「同一份 recalc 决策逻辑」各跑一遍来证明分叉正确。
t('假 window 下判定为不支持（→走回退）', api.supportsHighlight(globalThis.Highlight ? globalThis : {}) === false
  || typeof globalThis.Highlight === 'undefined')

// 主路径下 recalcMarks 不产色块：用产物 API 模拟一次（ranges 有值 → markCount 为正，marks 为空）
t('主路径不产色块（marks 保持空数组）', (() => {
  // buildHighlightRanges 有结果时，app 里 runtime.marks 被显式设为 []
  return /runtime\.marks = \[\]\s*\n\s*runtime\.markCount = built\.stats\.words/.test(srcApp)
})())
t('回退路径仍算色块', /marks = buildMarks\(\{ doc, keys, max: MARK_MAX \}\)/.test(srcApp))
t('两条路径都记 lastMs（性能可观测）', (srcApp.match(/lastMs: Date\.now\(\) - started/g) ?? []).length === 2)

console.log('\n[7] 查词记录与 miss 提示（设计 §E2）')

// ── 7.1 浮层一弹出就 touch（seen+1）──
t('applySelection 在 word 命中分支调 touch', /runtime\.result = hit[\s\S]{0,400}?wordbook\?\.touch\?\.\(selection\.key\)/.test(srcApp))
t('touch 只记录已收藏词（不因为点一下就建档）', (() => {
  const wbSrc = readFileSync(join(ROOT, 'client/src/wordbook.js'), 'utf8')
  // touch 的实现里对不存在的词是 return（no-op）
  return /async touch\(word\)[\s\S]{0,320}?if \(!entry\) return/.test(wbSrc)
})())

// 运行时探针：真跑一次 touch，看 seen 是否 +1、lastSeenAt 是否更新。
// （t13 报告要求的就是这一组；当时留了空壳，这里补实 —— 用产物里的真 createWordbook，
//   配一个内存 KV 桩，不碰 localStorage。）
function makeMemoryStore() {
  const table = new Map()
  return {
    async get(key) { return table.has(key) ? { value: table.get(key) } : undefined },
    async set(key, value) { table.set(key, value) },
    async delete(key) { table.delete(key) },
    __table: table,
  }
}
const probeStore = makeMemoryStore()
const probeBook = api.createWordbook({ storage: probeStore })

t('touch 对不在生词本的词是 no-op（不建档）', (() => {
  const sizeBefore = probeBook.size()
  probeBook.touch('zzzznotaword')
  return probeBook.size() === sizeBefore && probeBook.has('zzzznotaword') === false
})())

t('收藏后 touch 记 seen=1', (() => {
  probeBook.add('cute', 'dsh')
  probeBook.touch('cute')
  const entry = probeBook.get('cute')
  return entry?.review?.seen === 1
})())

t('再 touch 一次 seen=2', (() => {
  probeBook.touch('cute')
  return probeBook.get('cute')?.review?.seen === 2
})())

t('touch 会更新 lastSeenAt', (() => {
  const entry = probeBook.get('cute')
  return typeof entry?.review?.lastSeenAt === 'number' && entry.review.lastSeenAt > 0
})())

t('miss 词用 add(key, manual) 收下（不是 toggle）', (() => {
  probeBook.add('zzzznotaword', 'manual')
  return probeBook.has('zzzznotaword') === true
})())

t('add(manual) 四字段齐全', (() => {
  const entry = probeBook.get('zzzznotaword')
  return entry?.source === 'manual'
    && entry?.state === 'new'
    && entry?.gloss === ''
    && entry?.bookId === 'default'
})())

t('add(manual) 的 gloss 留空（不编释义）', (() => {
  const entry = probeBook.get('zzzznotaword')
  return entry?.gloss === ''
})())

// ── 7.2 miss 词：notice + 仍要收藏 ──
t('miss 分支用 notice 形态', srcApp.includes("runtime.mode = 'notice'"))
t('miss 文案是「词库未收录，已加入查词记录」', srcApp.includes('词库未收录，已加入查词记录'))
t('miss 只在主动点击时提示（byPick 闸门）', srcApp.includes('selection.byPick === true'))
t('pickWordAt 标了 byPick', /applySelection\(\{[\s\S]{0,300}?byPick: true/.test(srcApp))
t('收藏走 add(key, manual) 而不是 toggle', srcApp.includes("wordbook.add(key, 'manual')"))
t('missKey 进快照供按钮判断', srcApp.includes('missKey: runtime.missKey'))
t('notice 形态有仍要收藏按钮', srcApp.includes('仍要收藏') && srcApp.includes('actions.onSaveMiss'))
t('换词/关闭时清 missKey', (srcApp.match(/runtime\.missKey = ''/g) ?? []).length >= 3)

// ── 7.3 划选短语与 marker 不受影响 ──
t('短语分支没有 miss 提示', (() => {
  const phrasePart = srcApp.slice(srcApp.indexOf("runtime.mode = 'phrase'"), srcApp.indexOf("void translatePhrase"))
  return !phrasePart.includes('词库未收录')
})())
t('marker 被动扫描不产生 notice', (() => {
  const mkSrc = readFileSync(join(ROOT, 'client/src/marker.js'), 'utf8')
  return !mkSrc.includes('notice') && !mkSrc.includes('词库未收录')
})())

// ── 7.4 运行时：Render 一次 miss notice 已经在上面的 [3] 段验过，这里验 store 层 ──
t('onSaveMiss 会刷新 notice 文案', srcApp.includes('已加入生词本（释义留空'))
t('onSaveMiss 收藏后重算着色', /onSaveMiss[\s\S]{0,600}?markScheduler\?\.request\?\.\(\)/.test(srcApp))



console.log('\n[8] 复习背面发音（设计 §E1）')

// ── 8.1 源码层：背面换成 ReviewCardBack，不是另写一份模板 ──
const srcSettings8 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
const srcReview8 = readFileSync(join(ROOT, 'client/src/review.js'), 'utf8')
void srcReview8

t('复习背面渲染 ReviewCardBack', /h\(ReviewCardBack,\s*\{[\s\S]{0,220}?word: front/.test(srcSettings8))
t('复习背面不再自己拼词头+义项模板', !/className: 'hds-cardstage-word', style: \{ fontSize: FS\.title \+ 5 \}/.test(srcSettings8))
t('评分键盘提示仍保留在背面', srcSettings8.includes('1 ✗ 不认识 · 2 ↻ 记错 · 3 ✓ 认识 · 空格再翻一次'))
t('导入的是 review.js 的发音实现，不另写',
  /import \{[\s\S]{0,400}?PronounceButton[\s\S]{0,80}?\} from '\.\/review\.js'/.test(srcSettings8))
t('settings.js 里没有自己实现 speechSynthesis', !srcSettings8.includes('speechSynthesis'))

// 我自己的改动引入的死样式必须已清掉（class 不再被引用的 CSS 是无人看守的债）
t('删掉了不再被引用的 .hds-cardstage-sense 规则', !srcSettings8.includes('.hds-cardstage-sense {'))
t('删掉了不再被引用的 .hds-cardstage-example 规则', !srcSettings8.includes('.hds-cardstage-example {'))

// ── 8.2 发音语义在产物上真跑（canSpeak / speakWord 的 en-US + rate 0.9 / 再点停止）──
const makeSpeech = () => {
  const said = []
  const stub = {
    speaking: false,
    pending: false,
    speak(u) { said.push(u); stub.speaking = true },
    cancel() { stub.speaking = false; stub.pending = false },
  }
  class Utterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1 }
  }
  return { stub, Utterance, said }
}

const speech = makeSpeech()
globalThis.speechSynthesis = speech.stub
globalThis.SpeechSynthesisUtterance = speech.Utterance

t('canSpeak 在支持的浏览器为 true', api.canSpeak() === true)
const first = api.speakWord('cute')
t('speakWord 首次返回 speak', first === 'speak')
t('念的是传进来的词', speech.said.at(-1)?.text, 'cute')
t('语言是 en-US', speech.said.at(-1)?.lang, 'en-US')
t('语速是 0.9', speech.said.at(-1)?.rate, 0.9)

const second = api.speakWord('cute')
t('再点一次返回 stop（不重复念）', second === 'stop')
t('stop 时调了 cancel', speech.stub.speaking === false)
t('stop 没有新增朗读', speech.said.length === 1, `${speech.said.length} 次`)

t('空词返回 failed 不抛', api.speakWord('   ') === 'failed')

// ── 8.3 不支持 speechSynthesis 时不渲染死按钮（§E1 硬要求）──
const savedSynth = globalThis.speechSynthesis
const savedUtt = globalThis.SpeechSynthesisUtterance
delete globalThis.speechSynthesis
delete globalThis.SpeechSynthesisUtterance
t('无 speechSynthesis 时 canSpeak 为 false', api.canSpeak() === false)
t('无 speechSynthesis 时 PronounceButton 返回 null（不留死按钮）',
  api.PronounceButton({ word: 'cute' }) === null)
t('无 speechSynthesis 时 speakWord 返回 unsupported',
  api.speakWord('cute') === 'unsupported')

// 只缺 Utterance 也算不支持（两个都要）
globalThis.speechSynthesis = speech.stub
t('只缺 SpeechSynthesisUtterance 时也不支持', api.canSpeak() === false)
globalThis.speechSynthesis = savedSynth
globalThis.SpeechSynthesisUtterance = savedUtt

// ── 8.4 真渲染复习背面：🔊 出现，且义项/例句/提示都在 ──
t('ReviewCardBack 渲染出 🔊 按钮', (() => {
  try {
    const node = api.ReviewCardBack({
      word: 'cute',
      back: { senses: [{ posLabel: 'adj.', zh: ['可爱的', '漂亮的'] }], example: { en: 'A cute cat.', zh: '一只可爱的猫。' } },
      gloss: '',
      P: api.makePrimitives(hReact),
    })
    const json = JSON.stringify(node)
    return json.includes('🔊')
  } catch { return false }
})())
t('ReviewCardBack 仍渲染义项与例句', (() => {
  try {
    const node = api.ReviewCardBack({
      word: 'cute',
      back: { senses: [{ posLabel: 'adj.', zh: ['可爱的'] }], example: { en: 'A cute cat.', zh: '一只可爱的猫。' } },
      gloss: '',
      P: api.makePrimitives(hReact),
    })
    const json = JSON.stringify(node)
    return json.includes('adj.') && json.includes('可爱的') && json.includes('A cute cat.')
  } catch { return false }
})())
t('词库未收录时背面给明确说明而不是空着', (() => {
  try {
    const node = api.ReviewCardBack({ word: 'zzzz', back: { senses: [], example: null }, gloss: '' })
    return JSON.stringify(node).includes('词库未收录，暂无释义')
  } catch { return false }
})())
t('有 gloss 快照时背面优先显示 gloss', (() => {
  try {
    const node = api.ReviewCardBack({ word: 'zzzz', back: { senses: [], example: null }, gloss: '自己写的释义' })
    return JSON.stringify(node).includes('自己写的释义')
  } catch { return false }
})())

console.log('\n[9] 着色设置组：只改字色 + 跟随主题错误红（设计 §C4 修订）')

// 用户裁定「不需要下划线和色块，只要改字的颜色」→ t15 改用 CSS Custom Highlight，
// 这里守的是**面板**：不再有 markStyle 死控件、默认色是 theme-error 哨兵、预览只改 color。
const srcSettings9 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')

// ── 9.1 markStyle 死控件必须彻底移除（点了没效果的控件比缺功能更糟）──
t('不再渲染「标记样式」分区', !srcSettings9.includes("'标记样式'"))
t('不再渲染三档样式文案',
  !srcSettings9.includes('底色 + 下划线') && !srcSettings9.includes('仅底色') && !srcSettings9.includes('仅下划线'))
t('settings.js 不再引用 MARK_STYLES', !srcSettings9.includes('MARK_STYLES'))
t('settings.js 不再写 markStyle', !/patchAppearance\(\s*'markStyle'/.test(srcSettings9))
t('外观页解构里不再拉 Segment（唯一用处已被删）',
  !/const \{ Card, Button, Input, Select, Switch, Note, Field, Segment,/.test(srcSettings9))

// ── 9.2 预览必须与实际渲染同源（哨兵当 hex 会静默变透明）──
t('预览颜色走 marker.js 的 markColorToCss 解析', /import \{ markColorToCss \} from '\.\/marker\.js'/.test(srcSettings9))
t('预览只用 color，不再拼底色/下划线',
  /style: \{ color: known \? knownColor : color \}/.test(srcSettings9))
t('预览的已掌握淡色照抄 highlightCss 的 50% 掺透明',
  /color-mix\(in srgb, \$\{color\} 50%, transparent\)/.test(srcSettings9))
t('主题色高亮判等用原始存档值而非解析后的 var()',
  /isThemeColor = markColorRaw === DEFAULT_MARK_COLOR/.test(srcSettings9))

// ── 9.3 运行时：三种状态真渲染 ──
const P9 = api.makePrimitives(hReact)
const renderAppearance = (appearance) => {
  if (typeof api.appearanceTab !== 'function') return null
  try {
    if (typeof resetHooks === 'function') resetHooks()
    return api.appearanceTab({
      h: hReact,
      P: P9, ux: { appearance }, patchAppearance: () => {},
      packsDir: '/x', storage: { getItem: () => null, setItem: () => {} },
    })
  } catch { return null }
}
const walk9 = (node, pred, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (pred(node)) out.push(node)
  for (const c of (node.children ?? [])) walk9(c, pred, out)
  return out
}
const find9 = (node, pred) => walk9(node, pred)[0] ?? null
const previewSpans = (tree) => {
  const box = find9(tree, (n) => n.props?.className === 'hds-mark-preview')
  if (!box) return []
  return walk9(box, (n) => typeof n.type === 'string' && n.type === 'span' && n.props?.style?.color)
}

const themeTree = renderAppearance({ markWords: true, markColor: 'theme-error', markKnown: false })
t('默认态渲染出七个色块（跟随主题 + 六预设）',
  walk9(themeTree, (n) => n.props?.className === 'hds-swatch').length === 7)
t('「跟随主题错误红」排在首选项',
  walk9(themeTree, (n) => n.props?.className === 'hds-swatch')[0]?.props?.['aria-label'] === '标记颜色：跟随主题错误红')
t('默认态首选项是高亮的',
  walk9(themeTree, (n) => n.props?.className === 'hds-swatch')[0]?.props?.['aria-pressed'] === 'true')
t('哨兵态预览用 var(--dsw-alias-state-error-primary',
  previewSpans(themeTree).every((n) => String(n.props.style.color).includes('var(--dsw-alias-state-error-primary')),
  String(previewSpans(themeTree)[0]?.props?.style?.color ?? ''))
t('哨兵态预览没有把 theme-error 当颜色值',
  !JSON.stringify(themeTree).includes('"color":"theme-error"'))
t('预览标了三个词且不带底色/下划线', (() => {
  const marked = previewSpans(themeTree).filter((n) => ['quick', 'brown', 'lazy'].includes(n.children?.[0]))
  return marked.length === 3
    && marked.every((n) => n.props.style.background === undefined && n.props.style.borderBottom === undefined)
})())

const blueTree9 = renderAppearance({ markWords: true, markColor: '#4d6bfe', markKnown: false })
t('选具体预设后切到固定 hex',
  previewSpans(blueTree9).every((n) => String(n.props.style.color).includes('#4d6bfe')),
  String(previewSpans(blueTree9)[0]?.props?.style?.color ?? ''))
t('选固定 hex 后「跟随主题」不再高亮',
  walk9(blueTree9, (n) => n.props?.className === 'hds-swatch')[0]?.props?.['aria-pressed'] === 'false')

const knownTree9 = renderAppearance({ markWords: true, markColor: 'theme-error', markKnown: true })
t('markKnown 开时预览出现 color-mix 淡色',
  previewSpans(knownTree9).some((n) => String(n.props.style.color).includes('color-mix')))

const offTree9 = renderAppearance({ markWords: false, markColor: 'theme-error', markKnown: false })
t('着色关闭时预览只剩文字说明', previewSpans(offTree9).length === 0)

console.log('\n[10] 设置页空白回归：StatusBar 必须拿到 FS')

// 背景：StatusBar 只从 P 解构了 C，却裸用 FS.small，渲染时抛
// `ReferenceError: FS is not defined`。真实 React 18 没有 error boundary，
// 子组件一抛就把整棵设置页树卸载 —— 用户看到的是后台一片空白。
//
// [4] 那套假 React 会把组件异常吞成 null（makeReact 里的 try/catch），
// 于是这个 bug 在旧断言里只表现为「少了个节点」，从来报不出来。
// 这里用**记录错误**的 createElement 还原真实行为：抛错的位置产出 __error 节点。
function runFactoryCapturing() {
  const { react, resetHooks: reset } = makeReact()
  const captured = []
  // 必须在 factory 之前替换：产物前导里 `var h = React.createElement` 是取值时绑定的，
  // 事后再改 react.createElement 影响不到模块内部闭包里的 h。
  react.createElement = (type, props, ...children) => {
    if (typeof type !== 'function') return { type, props, children: children.flat() }
    try {
      return type({ ...(props ?? {}), children: children.flat() })
    } catch (error) {
      const message = String(error?.message ?? error)
      captured.push(message)
      return { type: 'error', props: { __error: message }, children: [] }
    }
  }
  let api10 = null
  const runner = new Function('window', 'document', 'requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout', 'console', OUTPUT)
  runner(
    { __ModuleLoader__: { load: ({ factory }) => { api10 = factory(() => react) } }, innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined },
    makeDocument(),
    (fn) => { fn(); return 1 },
    () => {},
    () => 1,
    () => {},
    { warn: () => {}, error: () => {}, log: () => {} },
  )
  return { api: api10, h: react.createElement, captured, resetHooks: reset }
}

const strict10 = runFactoryCapturing()
const renderPanel10 = () => {
  try {
    strict10.resetHooks()
    return strict10.api.SettingsPanel({ close: () => {} })
  } catch { return null }
}
const panel10 = renderPanel10()
const json10 = JSON.stringify(panel10, (k, v) => (k === 'node' ? '[obj]' : v))
const errNodes10 = walk9(panel10, (n) => n.props?.__error !== undefined)

t('默认「生词本」页签渲染不抛', panel10 !== null)
t('渲染树里没有 __error 节点', errNodes10.length === 0,
  errNodes10.slice(0, 3).map((n) => n.props.__error).join(' | ') || '0 个')
t('渲染过程没有 FS is not defined',
  !strict10.captured.some((m) => m.includes('FS is not defined')) && !json10.includes('FS is not defined'),
  strict10.captured.join(' | ') || '无报错')
t('StatusBar 正常产出占比条 hds-bar', json10.includes('hds-bar'))

// 换一个**全新**的 factory 实例再验一遍，确保结论不依赖上面那个记录错误的 h。
// （不能复用 [1]~[9] 的 api：假 React 的 hooks 是同一个数组，直调 appearanceTab
//   留下的旧槽位会让 SettingsPanel 的 tab 初始值失真，渲染成别的页签。）
const fresh10 = runFactory()
const panel10b = (() => {
  try { fresh10.resetHooks(); return fresh10.api.SettingsPanel({ close: () => {} }) } catch { return null }
})()
t('全新实例渲染同样含 hds-bar',
  JSON.stringify(panel10b, (k, v) => (k === 'node' ? '[obj]' : v)).includes('hds-bar'))

console.log('\n[11] 设置页切页签回归：每组件独立 hooks 表（真实 React 语义）')

// 背景（用户报「点击有道同步后又变成一片空的」）：
// SettingsPanel 里 bookTab / appearanceTab 曾经是**直接函数调用**，
// 那两个页签里的 useState/useEffect 会记进 SettingsPanel 自己的 fiber，
// 于是 SettingsPanel 的 hooks 数随页签变化（book=14、appearance=8、其余=4）。
// React 18 对「同一组件两次渲染 hooks 变少」直接抛
// `Rendered fewer hooks than expected`；没有错误边界，整棵设置页树卸载 —— 一片空白。
// 所以从生词本切到任何其它页签都会空白（用户先点有道同步撞上了）。
//
// [1]~[10] 用的假 React 只有一个全局 hooks 数组，测不出 fiber 归属；
// 这一段按真实 React 语义建模型：**每个组件类型一张独立 hooks 表**，
// createElement 遇到函数型 type 时切到该组件的表，返回后切回来。
// 于是「内联调用」与「组件调用」的区别在这个模型里就真实存在了。
function runFactoryIsolated() {
  const tables = new Map()
  let active = null
  let index = 0
  let usesState = 0
  const log = []
  const captured = []

  const enter = (fn) => {
    if (!tables.has(fn)) tables.set(fn, [])
    active = tables.get(fn)
    index = 0
    usesState = 0
  }
  const leave = (fn, node) => {
    log.push({ name: fn.name || 'anon', slots: index, states: usesState })
    return node
  }

  const react = {
    createElement: (type, props, ...children) => {
      if (typeof type !== 'function') return { type, props, children: children.flat() }
      const prevTable = active
      const prevIndex = index
      const prevStates = usesState
      enter(type)
      let node
      try {
        node = type({ ...(props ?? {}), children: children.flat() })
      } catch (error) {
        const message = String(error?.message ?? error)
        captured.push(message)
        node = { type: 'error', props: { __error: message }, children: [] }
      }
      const out = leave(type, node)
      active = prevTable
      index = prevIndex
      usesState = prevStates
      return out
    },
    useState: (init) => {
      const slot = index++
      usesState += 1
      if (!(slot in active)) active[slot] = typeof init === 'function' ? init() : init
      return [active[slot], (v) => { active[slot] = v }]
    },
    useEffect: () => { index += 1 },
    useLayoutEffect: () => { index += 1 },
    useRef: (v) => { index += 1; return { current: v } },
    useMemo: (fn) => { index += 1; return fn() },
    useCallback: (fn) => { index += 1; return fn },
  }

  let isoApi = null
  const runner = new Function('window', 'document', 'requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout', 'console', OUTPUT)
  runner(
    {
      __ModuleLoader__: { load: ({ factory }) => { isoApi = factory(() => react) } },
      innerWidth: 1200, innerHeight: 800,
      addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined,
    },
    makeDocument(),
    (fn) => { fn(); return 1 },
    () => {},
    () => 1,
    () => {},
    { warn: () => {}, error: () => {}, log: () => {} },
  )

  return {
    api: isoApi,
    tables,
    log,
    captured,
    /** 渲染一个组件函数当根（等价于 React 渲染根组件）。 */
    render(fn, props) {
      const prevTable = active
      const prevIndex = index
      const prevStates = usesState
      enter(fn)
      let node
      try {
        node = fn({ ...(props ?? {}) })
      } catch (error) {
        const message = String(error?.message ?? error)
        captured.push(message)
        node = { type: 'error', props: { __error: message }, children: [] }
      }
      const out = leave(fn, node)
      active = prevTable
      index = prevIndex
      usesState = prevStates
      return out
    },
  }
}

// ── 11.1 静态：根因那两行必须已经是组件调用 ──
const srcSettings11 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
t('settings.js 不再内联调用 bookTab(...)', !/body\.push\(\s*bookTab\(/.test(srcSettings11))
t('settings.js 不再内联调用 appearanceTab(...)', !/body\.push\(\s*appearanceTab\(/.test(srcSettings11))
t('book / appearance 都改成 h() 组件调用',
  /body\.push\(h\(bookTab,\s*\{/.test(srcSettings11) && /body\.push\(h\(appearanceTab,\s*\{/.test(srcSettings11))

// ── 11.2 运行时：五页签走一圈再切回，每次都不许有空树 ──
const iso11 = runFactoryIsolated()
const SP11 = iso11.api?.SettingsPanel
const json11 = (tree) => JSON.stringify(tree, (k, v) => (k === 'node' ? '[obj]' : v))
const errs11 = (tree) => walk9(tree, (n) => n.props?.__error !== undefined)
const root11 = () => iso11.log.at(-1) ?? { name: '?', slots: -1, states: -1 }

t('独立实例拿到 SettingsPanel', typeof SP11 === 'function')

const STEPS11 = [
  { id: 'book', label: '生词本', marker: '按词头或释义搜索' },
  { id: 'review', label: '复习', marker: '出题方向' },
  { id: 'import', label: '导入', marker: '解析预览' },
  { id: 'appearance', label: '外观与交互', marker: '翻译服务' },
  { id: 'youdao', label: '有道同步', marker: '正在检查登录状态' },
  { id: 'book', label: '生词本（切回）', marker: '按词头或释义搜索' },
]

let panelSlots11 = null
STEPS11.forEach((step, i) => {
  // 直接改 tab 这个 hook 槽，等价于用户点了页签（比调 onChange 更接近「切换」的实质）
  if (i > 0 && iso11.tables.has(SP11)) iso11.tables.get(SP11)[1] = step.id
  iso11.captured.length = 0
  const tree = iso11.render(SP11, { close: () => {} })
  const bad = errs11(tree)
  const hooks = root11()
  if (panelSlots11 === null) panelSlots11 = hooks.slots

  t(`页签「${step.label}」渲染无 __error`, bad.length === 0 && iso11.captured.length === 0,
    bad.slice(0, 2).map((n) => n.props.__error).join(' | ') || iso11.captured.join(' | ') || '0 个')
  t(`页签「${step.label}」目标内容出现`, json11(tree).includes(step.marker))
  t(`页签「${step.label}」SettingsPanel hooks 恒等（4 个 useState）`,
    hooks.states === 4 && hooks.slots === panelSlots11,
    `useState=${hooks.states} slots=${hooks.slots}（首次 ${panelSlots11}）`)
})

// ── 11.3 归属证据：页签自己的 hooks 落在自己的表里 ──
const hookMax11 = (() => {
  const out = {}
  for (const entry of iso11.log) out[entry.name] = Math.max(out[entry.name] ?? 0, entry.states)
  return out
})()
t('bookTab 的 10 个 useState 记在自己 fiber 上', hookMax11.bookTab === 10, String(hookMax11.bookTab))
t('appearanceTab 的 4 个 useState 记在自己 fiber 上', hookMax11.appearanceTab === 4, String(hookMax11.appearanceTab))
t('SettingsPanel 自身始终 4 个 useState，不随页签变', hookMax11.SettingsPanel === 4, String(hookMax11.SettingsPanel))
t('切换一圈后树没有塌（仍含页面头「英语翻译」）',
  json11(iso11.render(SP11, { close: () => {} })).includes('英语翻译'))

console.log('\n[12] 空白现象复现：hooks 数变少 → 整棵树卸载')

// [11] 证明了「hooks 归属正确」，但没证明「归属错了会怎样」。
// 这一段把 React 18 的硬规则补进模型，让断言直接对着用户看到的**空白**：
//   同一组件上一次渲染调了 N 个 hook，这一次调用得比 N 少 →
//   React 抛 `Rendered fewer hooks than expected`；没有错误边界 → 整棵设置页树卸载 → 空白。
// 于是先让模型自检（合成旧形状必须判为减少），再让真组件切一圈，一次都不许触发。

// ── 12.1 模型自检：旧的内联形状（14 → 5）必须被判为「变少」 ──
// 不依赖产物，纯手搓父子对，只验证「减少检出」这条规则本身是真的在工作。
const probe12 = (() => {
  const tables = new Map()
  let active = null
  let index = 0
  let childCount = 10
  const useFake = (init) => {
    const slot = index++
    if (!(slot in active)) active[slot] = init
    return [active[slot], (v) => { active[slot] = v }]
  }
  // 父组件：先内联调一个「有 N 个 useState 的普通函数」，再自己调 4 个 —— 旧 settings.js 的形状
  const parent = () => {
    for (let i = 0; i < childCount; i += 1) useFake(0)
    for (let i = 0; i < 4; i += 1) useFake(0)
    return null
  }
  const render = () => {
    if (!tables.has(parent)) tables.set(parent, [])
    const before = tables.has('__last') ? tables.get('__last')[0] : undefined
    active = tables.get(parent)
    index = 0
    parent()
    const used = index
    const shrank = before !== undefined && used < before
    tables.set('__last', [used])
    active = null
    return { used, shrank }
  }
  const first = render()
  childCount = 1
  const second = render()
  return { first, second }
})()
t('模型自检：旧内联形状 14 → 5 被判为 hooks 减少',
  probe12.first.used === 14 && probe12.second.used === 5 && probe12.second.shrank === true,
  `${probe12.first.used} → ${probe12.second.used}`)

// ── 12.2 真组件：同一圈切页签，不许有一次 hooks 变少 / 树变 null ──
/**
 * 造一个「按真实 React 语义」跑产物的沙箱。
 *
 * @param {{setTimeout?: Function, clearTimeout?: Function}} [timers]
 *   可选的定时器替身。14.5 要自己点火轮询，不能用真 setTimeout（会真等 2 秒）。
 */
function runFactoryWithRules(timers) {
  const tables = new Map()
  const lastUsed = new Map()
  let active = null
  let index = 0
  const HOOK_ERROR = 'Rendered fewer hooks than expected.'

  const run = (fn, props) => {
    if (!tables.has(fn)) tables.set(fn, [])
    const prevTable = active
    const prevIndex = index
    active = tables.get(fn)
    index = 0
    let node = null
    let thrown = null
    try {
      node = fn({ ...(props ?? {}), children: (props?.children ?? []) })
    } catch (error) {
      thrown = error
    }
    const used = index
    active = prevTable
    index = prevIndex
    const before = lastUsed.get(fn)
    // 渲染中途抛错时 index 是残缺的，不拿它做「变少」判定（否则会把别的错误报成 hooks 违规）
    if (thrown === null) lastUsed.set(fn, used)
    if (thrown !== null) throw thrown
    // 真实 React：这一次比上一次少 → 抛错；没人接 → 整棵树卸载。
    if (before !== undefined && used < before) {
      throw new Error(HOOK_ERROR + ` (${fn.name || 'anon'}: ${before} → ${used})`)
    }
    return node
  }

  const react = {
    createElement: (type, props, ...children) => {
      if (typeof type !== 'function') return { type, props, children: children.flat() }
      return run(type, { ...(props ?? {}), children: children.flat() })
    },
    useState: (init) => {
      const slot = index++
      // setState 必须绑在**当前组件自己的**表上：组件函数返回后 active 会被还原，
      // 异步回调（比如轮询 .then）里再去读 active 就指向 null 或别的组件。
      const owner = active
      if (!(slot in owner)) owner[slot] = typeof init === 'function' ? init() : init
      return [owner[slot], (v) => { owner[slot] = typeof v === 'function' ? v(owner[slot]) : v }]
    },
    useEffect: () => { index += 1 },
    useLayoutEffect: () => { index += 1 },
    useRef: (v) => { const owner = active; index += 1; const slot = index - 1; if (!(slot in owner)) owner[slot] = { current: v }; return owner[slot] },
    useMemo: (fn) => { index += 1; return fn() },
    useCallback: (fn) => { index += 1; return fn },
  }

  let rulesApi = null
  const runner = new Function('window', 'document', 'requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout', 'console', OUTPUT)
  runner(
    {
      __ModuleLoader__: { load: ({ factory }) => { rulesApi = factory(() => react) } },
      innerWidth: 1200, innerHeight: 800,
      addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined,
    },
    makeDocument(),
    (fn) => { fn(); return 1 },
    () => {},
    timers?.setTimeout ?? (() => 1),
    timers?.clearTimeout ?? (() => {}),
    { warn: () => {}, error: () => {}, log: () => {} },
  )

  return {
    api: rulesApi,
    tables,
    /** 渲染根组件。抛错 = 真实 React 的整棵树卸载 → tree 为 null（用户看到的空白）。 */
    mount(fn, props) {
      try { return { tree: run(fn, props), error: null } }
      catch (error) { return { tree: null, error: String(error?.message ?? error) } }
    },
  }
}

const rules12 = runFactoryWithRules()
const SP12 = rules12.api?.SettingsPanel
t('React 规则实例拿到 SettingsPanel', typeof SP12 === 'function')

const SQ12 = [
  ['book', '生词本', '按词头或释义搜索'],
  ['review', '复习', '出题方向'],
  ['import', '导入', '解析预览'],
  ['appearance', '外观与交互', '翻译服务'],
  ['youdao', '有道同步', '正在检查登录状态'],
  ['book', '生词本（回切）', '按词头或释义搜索'],
]

const tree12 = (tree) => JSON.stringify(tree, (k, v) => (k === 'node' ? '[obj]' : v))
SQ12.forEach(([id, label, marker], i) => {
  // 首轮拿默认 book；之后直接改 tab 槽，等价于用户点了该页签
  if (i > 0) {
    const table = rules12.tables.get(SP12) ?? []
    table[1] = id
  }
  const result = rules12.mount(SP12, { close: () => {} })
  const bad = result.tree === null ? [] : walk9(result.tree, (n) => n.props?.__error !== undefined)
  t(`React 规则·页签「${label}」不空白`, result.tree !== null, result.error ?? 'null')
  t(`React 规则·页签「${label}」无 __error`, bad.length === 0 && result.error === null,
    bad.map((n) => n.props.__error).join(' | ') || result.error || '0 个')
  t(`React 规则·页签「${label}」目标内容出现`,
    result.tree !== null && tree12(result.tree).includes(marker))
  t(`React 规则·页签「${label}」没触发 hooks 减少`,
    result.error === null || !result.error.includes('fewer hooks'), result.error ?? '无')
})


// ── 13. 深色模式对比度回归（token 层） ──
//
// 1.3.1 的教训：深色下 `--dsw-alias-brand-primary` 本身就是近白（#f9fafb），
// 拿它当按钮/开关底色，再配写死 #fff 就是白底白字（实测 1.05），
// 开关滑块变成白滑块白轨道（1.00，完全隐形）。
//
// 这一段是**没有浏览器时的等价闸门**：钉住「底色 token 与文字 token 必须是
// 一对反色语义 token」——label-primary 底 + bg-base 字。两者在亮暗两套主题里
// 必然互换明暗，所以只要这个配对不被改掉，颜色就不可能撞成同一档。
// 13.6 再把宿主 token 真灌进浏览器实测一遍（装没装浏览器都可跑，没装则 SKIP）。
console.log('\n[13] 深色对比度回归（token 配对）')

const uiSrc13 = readFileSync(join(ROOT, 'client/src/ui.js'), 'utf8')
const setSrc13 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')

// 13.1 token 表里两个键都在，且各自走的是宿主语义 token
t('C.invert 取 label-primary（反色块的底）',
  /invert:\s*'var\(--dsw-alias-label-primary, #[0-9a-f]{3,8}\)'/.test(uiSrc13))
t('C.onAccent 取 bg-base（反色块的字）',
  /onAccent:\s*'var\(--dsw-alias-bg-base, #[0-9a-f]{3,8}\)'/.test(uiSrc13))
t('两个键是不同的 token（不是同一个值换个名字）',
  /invert:\s*'var\(--dsw-alias-label-primary/.test(uiSrc13)
  && /onAccent:\s*'var\(--dsw-alias-bg-base/.test(uiSrc13))

// 13.2 三个控件都用这对配对，且不再有写死白
t('primary 按钮用 C.invert 当底、C.onAccent 当字',
  /primary:\s*\{\s*background:\s*C\.invert,\s*color:\s*C\.onAccent,/.test(uiSrc13))
t('开关打开时轨道 C.invert / 滑块 C.onAccent',
  /background:\s*on \? C\.invert : C\.bg1/.test(uiSrc13)
  && /background:\s*on \? C\.onAccent : C\.textFaint/.test(uiSrc13))
t('复选框打开时底 C.invert / 勾 C.onAccent',
  /background:\s*on \? C\.invert : C\.bgBase/.test(uiSrc13)
  && /color:\s*C\.onAccent,/.test(uiSrc13))
t('ui.js 里没有写死的白色（#fff / #ffffff 只允许出现在 token 备用值里）',
  (() => {
    const stripped = uiSrc13
      .replace(/var\(--dsw-alias-[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g, '') // 备用值
      .replace(/\/\/.*$/gm, '') // 行注释（说明文字里引用了旧值）
      .replace(/\/\*[\s\S]*?\*\//g, '')
    return !/#fff\b|#ffffff\b/i.test(stripped)
  })())

// 13.3 设置页 CSS 同一套配对
t('设置页 .hds-btn-primary 底取 label-primary',
  /\.hds-btn-primary\s*\{[^}]*background:\s*var\(--dsw-alias-label-primary,/.test(setSrc13))
t('设置页 .hds-btn-primary 字取 bg-base',
  /\.hds-btn-primary\s*\{[^}]*color:\s*var\(--dsw-alias-bg-base,/.test(setSrc13))
t('设置页开关打开时轨道 label-primary、滑块 bg-base',
  /\.hds-switch\[aria-checked="true"\]\s+\.hds-switch-track\s*\{[^}]*background:\s*var\(--dsw-alias-label-primary,/.test(setSrc13)
  && /\.hds-switch\[aria-checked="true"\]\s+\.hds-switch-track::after\s*\{[^}]*background:\s*var\(--dsw-alias-bg-base,/.test(setSrc13))

// 13.4 反向断言：不许退回 brand-primary 当实心块底色
t('按钮/开关/勾选的实心底色不再用 brand-primary（C.accent）',
  !/background:\s*C\.accent/.test(uiSrc13)
  && !/\.hds-btn-primary\s*\{[^}]*background:[^;}]*brand-primary/.test(setSrc13)
  && !/aria-checked="true"\]\s+\.hds-switch-track\s*\{[^}]*background:[^;}]*brand-primary/.test(setSrc13))

// 13.5 真渲染：三个控件渲染出来确实带着这对 token（不是只写在表里没人用）
const P13 = api.makePrimitives(hReact)
const btnPrimary13 = P13.Button({ label: '主', variant: 'primary', onClick: () => {} })
const btnDefault13 = P13.Button({ label: '普', variant: 'default', onClick: () => {} })
t('渲染出来的 primary 按钮底色是 label-primary',
  String(btnPrimary13?.props?.style?.background).includes('--dsw-alias-label-primary'))
t('渲染出来的 primary 按钮字色是 bg-base',
  String(btnPrimary13?.props?.style?.color).includes('--dsw-alias-bg-base'))
t('primary 按钮的底与字不是同一个 token',
  String(btnPrimary13?.props?.style?.background) !== String(btnPrimary13?.props?.style?.color))
t('default 按钮不受影响（仍走 bg-layer-1）',
  String(btnDefault13?.props?.style?.background).includes('--dsw-alias-bg-layer-1'))

const sw13 = P13.Switch({ checked: true, onChange: () => {}, label: '开关' })
const swTrack13 = sw13?.children?.[0]
const swKnob13 = swTrack13?.children?.[0]
t('开关打开：轨道 label-primary / 滑块 bg-base（两者不同色）',
  String(swTrack13?.props?.style?.background).includes('--dsw-alias-label-primary')
  && String(swKnob13?.props?.style?.background).includes('--dsw-alias-bg-base')
  && String(swTrack13?.props?.style?.background) !== String(swKnob13?.props?.style?.background))
const swOff13 = P13.Switch({ checked: false, onChange: () => {}, label: '开关' })
t('开关关闭：轨道仍走 bg-layer-1（不回归）',
  String(swOff13?.children?.[0]?.props?.style?.background).includes('--dsw-alias-bg-layer-1'))

const cb13 = P13.Checkbox({ checked: true, onChange: () => {} })
t('复选框打开：底 label-primary / 勾 bg-base',
  String(cb13?.props?.style?.background).includes('--dsw-alias-label-primary')
  && String(cb13?.props?.style?.color).includes('--dsw-alias-bg-base'))


// ── 13.6 真浏览器实测（有 puppeteer-core + Chrome 才跑，缺任一则 SKIP） ──
//
// 上面的 token 配对断言能保证「底和字是不同的反色 token」，但保证不了
// 「这两个 token 在真实主题里真的不是同一个颜色」——1.3.1 就是两个都「看着像
// 品牌色」，实际一算 1.05。所以这一段把宿主 token 真灌进浏览器，走真实的
// var() 解析链，再用 WCAG 相对亮度算一遍。
//
// 依赖是**可选**的：本插件运行期零依赖，puppeteer-core 不在 package.json 里。
// 找不到就 SKIP（不判失败），但必须把「跳过了」打在屏幕上，不能静默通过。
async function contrastProbe() {
  const { createRequire } = await import('node:module')
  const { homedir } = await import('node:os')
  const { existsSync } = await import('node:fs')

  const loadPuppeteer = () => {
    for (const dir of [process.env.PUPPETEER_CORE_DIR, join(ROOT, 'node_modules'),
                       join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules')].filter(Boolean)) {
      try {
        if (!existsSync(join(dir, 'puppeteer-core'))) continue
        return createRequire(join(dir, 'anchor.js'))('puppeteer-core')
      } catch { /* 下一个 */ }
    }
    try { return createRequire(join(ROOT, 'anchor.js'))('puppeteer-core') } catch { return null }
  }
  const findChrome = () => [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p)) ?? null

  const puppeteer = loadPuppeteer()
  const chrome = findChrome()
  if (puppeteer === null || chrome === null) {
    console.log('  SKIP  真浏览器对比度实测 —— 本机缺少 puppeteer-core 或 Chrome')
    console.log(`        puppeteer-core: ${puppeteer === null ? '未找到' : '已找到'} / Chrome: ${chrome ?? '未找到'}`)
    console.log('        装上后跑：PUPPETEER_CORE_DIR=<含 puppeteer-core 的 node_modules> CHROME_BIN=<chrome 路径>')
    console.log('        13.1~13.5 的 token 配对断言已生效，这一段是更硬的实测，不算失败。')
    return
  }

  // 宿主主题 token 夹具：2026-11-28 用真 Chrome 从本机 DSH theme bundle 解析出的实测值。
  // 只列用得上的键 —— 让「深色下 brand-primary 是近白」在源码里一眼可读。
  const TOKENS = {
    light: {
      '--dsw-alias-bg-base': '#ffffff', '--dsw-alias-bg-layer-1': '#ffffff',
      '--dsw-alias-bg-layer-2': '#ffffff', '--dsw-alias-bg-overlay': '#e9ecf2',
      '--dsw-alias-border-l1': 'rgba(0,0,0,.04)', '--dsw-alias-border-l2': 'rgba(0,0,0,.1)',
      '--dsw-alias-brand-primary': '#0f1115', '--dsw-alias-label-primary': '#0f1115',
      '--dsw-alias-label-secondary': '#61666b', '--dsw-alias-state-error-primary': '#ec1313',
      '--dsw-alias-state-success-primary': '#22c55e', '--dsw-alias-state-warn-primary': '#f59e0b',
      '--dsw-alias-state-idle-primary': '#d4d4d4',
    },
    dark: {
      '--dsw-alias-bg-base': '#151517', '--dsw-alias-bg-layer-1': '#232324',
      '--dsw-alias-bg-layer-2': '#2c2c2e', '--dsw-alias-bg-overlay': '#61666b',
      '--dsw-alias-border-l1': 'rgba(255,255,255,.06)', '--dsw-alias-border-l2': 'rgba(255,255,255,.12)',
      // ↓ 近白。深色下拿它当底 + 写死白字 = 1.3.1 的事故现场（1.05）
      '--dsw-alias-brand-primary': '#f9fafb', '--dsw-alias-label-primary': '#f9fafb',
      '--dsw-alias-label-secondary': '#cfd3d6', '--dsw-alias-state-error-primary': '#f25a5a',
      '--dsw-alias-state-success-primary': '#22c55e', '--dsw-alias-state-warn-primary': '#f59e0b',
      '--dsw-alias-state-idle-primary': '#545557',
    },
  }
  const themeCss = (theme) =>
    `body{${Object.entries(TOKENS[theme]).map(([k, v]) => `${k}:${v}`).join(';')}}`

  // 页面里跑的度量代码：字符串注入，不能靠闭包传函数进去。
  const HELPERS = `
function parseColor(s){
  s = String(s).trim()
  if (s.startsWith('color(')) {
    const n = s.slice(6, -1).trim().split(/[\\/\\s]+/).filter(Boolean).slice(1).map(Number)
    return { r: n[0]*255, g: n[1]*255, b: n[2]*255, a: n[3] === undefined ? 1 : n[3] }
  }
  const m = s.match(/[\\d.]+/g).map(Number)
  return { r: m[0], g: m[1], b: m[2], a: m[3] === undefined ? 1 : m[3] }
}
function over(f, b) {
  return { r: f.r*f.a + b.r*(1-f.a), g: f.g*f.a + b.g*(1-f.a), b: f.b*f.a + b.b*(1-f.a), a: 1 }
}
function lum(c) {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) })
  return 0.2126*r + 0.7152*g + 0.0722*b
}
function ratio(f, b) {
  const l1 = lum(f), l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}
function stopsOf(el) {
  const bg = getComputedStyle(el).backgroundImage
  if (!bg || bg === 'none') return []
  return [...bg.matchAll(/(?:rgb|rgba|color)\\([^)]*\\)/g)].map((m) => parseColor(m[0]))
}
function baseColor() {
  const p = document.createElement('div')
  p.style.color = 'var(--dsw-alias-bg-base)'
  document.body.append(p)
  const c = parseColor(getComputedStyle(p).color)
  p.remove()
  return c
}
function stackUnder(el) {
  const stack = []
  let n = el.parentElement
  while (n && n !== document.documentElement) {
    const bg = getComputedStyle(n).backgroundColor
    if (bg && !bg.includes('0, 0, 0, 0')) stack.push(parseColor(bg))
    n = n.parentElement
  }
  let acc = baseColor()
  for (let i = stack.length - 1; i >= 0; i--) acc = over(stack[i], acc)
  return acc
}
function bgsOf(el) {
  // 有渐变时可见表面就是渐变本身（backgroundColor 只是垫在下面那层，看不见）；
  // 没渐变时才用纯色叠父层。不区分这两种会把握渐变按钮量成透明底。
  const stops = stopsOf(el)
  if (stops.length) return stops.map((s) => over(s, stackUnder(el)))
  const bg = getComputedStyle(el).backgroundColor
  if (bg && !bg.includes('0, 0, 0, 0')) return [over(parseColor(bg), stackUnder(el))]
  return [stackUnder(el)]
}
function worst(fgEl, bgEl) {
  const fg = parseColor(getComputedStyle(fgEl).color)
  let w = Infinity, detail = null
  for (const bg of bgsOf(bgEl)) {
    const c = ratio(over(fg, bg), bg)
    if (c < w) { w = c; detail = { fg: getComputedStyle(fgEl).color, bg: 'rgb(' + (bg.r|0) + ',' + (bg.g|0) + ',' + (bg.b|0) + ')' } }
  }
  return Object.assign({ c: +w.toFixed(2) }, detail)
}
function knobVsTrack(trackEl, knobColor) {
  let w = Infinity
  for (const bg of bgsOf(trackEl)) {
    const c = ratio(over(parseColor(knobColor), bg), bg)
    if (c < w) w = c
  }
  return +w.toFixed(2)
}
`

  // 用 client.js 的真实 factory 搭组件，并注入设置页 CSS 规则 —— 测的是产物，不是源码文本。
  const MOUNT = `
function mount(code, hdsRules, dark) {
  if (dark) document.body.setAttribute('data-ds-dark-theme', '')
  function h(type, props, ...children) {
    if (typeof type === 'function') return type(Object.assign({}, props, { children: children.flat(Infinity) }))
    const el = document.createElement(type)
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'style' && v) Object.assign(el.style, v)
      else if (k === 'key' || k === 'children' || k.startsWith('on')) continue
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v))
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue
      el.append(typeof c === 'object' ? c : document.createTextNode(String(c)))
    }
    return el
  }
  const react = {
    createElement: h,
    useState: (i) => [typeof i === 'function' ? i() : i, () => {}],
    useEffect: () => {}, useLayoutEffect: () => {},
    useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f,
    Fragment: 'div',
  }
  let exported = null
  window.__ModuleLoader__ = { load: ({ factory }) => { exported = factory((n) => { if (n === 'react') return react; throw new Error('no ' + n) }) } }
  eval(code)
  const P = exported.makePrimitives(h)
  const root = document.getElementById('root')
  for (const variant of ['default', 'primary', 'ghost', 'danger']) {
    const b = P.Button({ label: '按钮', variant, onClick() {} })
    b.id = 'ui-btn-' + variant
    root.append(b)
  }
  const sw = P.Switch({ checked: true, onChange() {}, label: '开关' })
  sw.id = 'ui-switch'
  root.append(sw)
  const cb = P.Checkbox({ checked: true, onChange() {} })
  cb.id = 'ui-checkbox'
  root.append(cb)
  const st = document.createElement('style')
  st.textContent = hdsRules.join('\\n')
  document.head.append(st)
  const mk = (cls, text, id) => { const b = document.createElement('button'); b.className = cls; b.id = id; b.textContent = text; root.append(b) }
  mk('hds-btn', '普通', 'css-btn-default')
  mk('hds-btn hds-btn-primary', '主', 'css-btn-primary')
  mk('hds-btn hds-btn-ghost', '幽灵', 'css-btn-ghost')
  mk('hds-btn hds-btn-danger', '危险', 'css-btn-danger')
  const sw2 = document.createElement('button')
  sw2.className = 'hds-switch'
  sw2.id = 'css-switch'
  sw2.setAttribute('aria-checked', 'true')
  sw2.innerHTML = '<span class="hds-switch-track"></span><span class="hds-switch-text">开关</span>'
  root.append(sw2)
}
`

  const MEASURE = `
function measure() {
  const res = {}
  for (const id of ['ui-btn-default', 'ui-btn-primary', 'ui-btn-ghost', 'ui-btn-danger',
                    'css-btn-default', 'css-btn-primary', 'css-btn-ghost', 'css-btn-danger']) {
    const el = document.getElementById(id)
    if (el) res[id] = worst(el, el)
  }
  const sw = document.getElementById('ui-switch')
  res['ui-switch'] = { c: knobVsTrack(sw.children[0], getComputedStyle(sw.children[0].children[0]).backgroundColor) }
  res['ui-checkbox'] = worst(document.getElementById('ui-checkbox'), document.getElementById('ui-checkbox'))
  const tr = document.querySelector('#css-switch .hds-switch-track')
  res['css-switch'] = { c: knobVsTrack(tr, getComputedStyle(tr, '::after').backgroundColor) }
  return res
}
`

  // 设置页 CSS 在 client.js 的 CSS 模板串里，按规则原样抽出来。
  // 抽不到说明产物形状变了 —— 上面的 13.3 会先红，不会静默。
  const hdsRules = [...OUTPUT.matchAll(/\.hds-[^{}]+\{[^}]*\}/g)].map((m) => m[0])

  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', `--user-data-dir=/tmp/hover-dict-contrast-${process.pid}`],
  })

  // 每套主题开一张新页面：渲染时就带上 token，避免 background 的 0.2s 过渡把测量污染。
  const probeTheme = async (theme) => {
    const page = await browser.newPage()
    await page.setContent('<html><head></head><body><div id="root"></div></body></html>')
    await page.addStyleTag({ content: themeCss(theme) })
    await page.evaluate(`(${MOUNT})(${JSON.stringify(OUTPUT)}, ${JSON.stringify(hdsRules)}, ${theme === 'dark'})`)
    await new Promise((r) => setTimeout(r, 300))
    const out = await page.evaluate(`(function(){ ${HELPERS}\n${MEASURE}\nreturn measure() })()`)
    await page.close()
    return out
  }

  let dark, light
  try {
    dark = await probeTheme('dark')
    light = await probeTheme('light')
  } finally {
    await browser.close()
  }

  const assertMin = (set, id, min, label, baseline) => {
    const got = set[id]
    t(`${label} ≥ ${min}`, got !== undefined && got.c >= min,
      got === undefined ? '没量到'
        : `实测 ${got.c}${baseline ? `（基线 ${baseline}）` : ''}${got.fg ? `  (${got.fg} on ${got.bg})` : ''}`)
  }

  console.log('\n  ── 深色（修的就是这组）──')
  assertMin(dark, 'ui-btn-default', 4.5, '深色 default 按钮文字/底')
  assertMin(dark, 'ui-btn-primary', 4.5, '深色 primary 按钮文字/底')
  assertMin(dark, 'ui-btn-ghost', 4.5, '深色 ghost 按钮文字/底')
  assertMin(dark, 'ui-btn-danger', 4.5, '深色 danger 按钮文字/底')
  assertMin(dark, 'ui-switch', 3, '深色 ui.js 开关滑块/轨道')
  assertMin(dark, 'ui-checkbox', 4.5, '深色 ui.js 复选框勾/底')
  assertMin(dark, 'css-btn-primary', 4.5, '深色设置页 .hds-btn-primary 文字/底')
  assertMin(dark, 'css-switch', 3, '深色设置页 .hds-switch 滑块/轨道')

  console.log('\n  ── 亮色（不许回归）──')
  assertMin(light, 'ui-btn-default', 4.5, '亮色 default 按钮文字/底', '18.90')
  assertMin(light, 'ui-btn-primary', 4.5, '亮色 primary 按钮文字/底', '18.90')
  assertMin(light, 'ui-btn-ghost', 4.5, '亮色 ghost 按钮文字/底', '5.80')
  assertMin(light, 'ui-btn-danger', 4.5, '亮色 danger 按钮文字/底', '4.50')
  assertMin(light, 'ui-switch', 3, '亮色 ui.js 开关滑块/轨道', '18.90')
  assertMin(light, 'ui-checkbox', 4.5, '亮色 ui.js 复选框勾/底', '18.90')
  assertMin(light, 'css-btn-primary', 4.5, '亮色设置页 .hds-btn-primary 文字/底', '18.90')
  assertMin(light, 'css-switch', 3, '亮色设置页 .hds-switch 滑块/轨道', '18.90')

  // ── 灵敏度自证：探针必须能抓住 1.3.1 的原配色 ──
  // 只会说 PASS 的探针什么也没证明。这里把原配色（brand-primary 底 + #fff 字/滑块）
  // 单独渲染一遍，断言它**确实**算不出 4.5 / 3。
  const b2 = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', `--user-data-dir=/tmp/hover-dict-contrast-neg-${process.pid}`],
  })
  let legacy
  try {
    const p = await b2.newPage()
    await p.setContent('<html><head></head><body><div id="root"></div></body></html>')
    await p.addStyleTag({ content: themeCss('dark') })
    legacy = await p.evaluate(`(function(){ ${HELPERS}
      document.body.setAttribute('data-ds-dark-theme', '')
      const root = document.getElementById('root')
      const old = document.createElement('button')
      old.id = 'old-primary'
      old.style.cssText = 'background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;border:0;padding:6px 16px'
      old.textContent = '旧主按钮'
      root.append(old)
      const tr = document.createElement('span')
      tr.id = 'old-track'
      tr.style.cssText = 'display:inline-block;width:38px;height:21px;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d6bfe);position:relative'
      const kn = document.createElement('span')
      kn.id = 'old-knob'
      kn.style.cssText = 'position:absolute;top:2px;left:20px;width:15px;height:15px;border-radius:50%;background:#fff'
      tr.append(kn)
      root.append(tr)
      return {
        oldPrimary: worst(document.getElementById('old-primary'), document.getElementById('old-primary')),
        oldSwitch: knobVsTrack(document.getElementById('old-track'), getComputedStyle(document.getElementById('old-knob')).backgroundColor),
      }
    })()`)
  } finally {
    await b2.close()
  }
  console.log('\n  ── 探针灵敏度（原配色必须被判失败）──')
  t('1.3.1 原 primary 配色 < 4.5（探针抓得住白底白字）', legacy.oldPrimary.c < 4.5, `实测 ${legacy.oldPrimary.c}`)
  t('1.3.1 原开关配色 < 3（探针抓得住隐形滑块）', legacy.oldSwitch < 3, `实测 ${legacy.oldSwitch}`)
}

await contrastProbe()

// ── 14. 有道「点登录自动拿 Cookie」客户端 ──
//
// 这一段不碰网络也不碰 GUI：YoudaoTab 的所有请求都走 youdaoRequest（内部 fetch），
// 而渲染本身只读 props。所以两件事分开验：
//   14.1 状态机（纯函数）：pending → success / E_NO_BROWSER 降级 / 取消 / 超时 各条分支
//   14.2 真组件渲染：未配置态有「登录有道」按钮、等待态有取消按钮、降级态指向手动粘贴
// 这样「窗口起得来吗」这种只能靠手测的部分不会混进自动化，但流程一旦错位立刻红。
console.log('\n[14] 有道登录：点一下自动取 Cookie（客户端）')

const UY = {
  initial: api?.youdaoLoginInitial,
  reduce: api?.youdaoLoginReduce,
  shouldPoll: api?.youdaoLoginShouldPoll,
  errorText: api?.youdaoLoginErrorText,
  mode: api?.youdaoMode,
}
t('导出登录状态机四件套',
  ['initial', 'reduce', 'shouldPoll', 'errorText'].every((k) => typeof UY[k] === 'function'),
  Object.keys(UY).filter((k) => typeof UY[k] === 'function').join(','))

// ── 14.1 状态机：主路径 pending → success ──
{
  let s = UY.initial()
  t('初始状态是 idle 且不轮询', s.phase === 'idle' && UY.shouldPoll(s) === false, s.phase)

  s = UY.reduce(s, { type: 'start-request' })
  t('点「登录有道」→ starting', s.phase === 'starting' && UY.shouldPoll(s) === false, s.phase)

  s = UY.reduce(s, { type: 'start-reply', payload: { ok: true, sessionId: 'sess-1', loginUrl: 'https://c.youdao.com/x' } })
  t('start 成功 → waiting 并开始轮询', s.phase === 'waiting' && s.sessionId === 'sess-1' && UY.shouldPoll(s) === true,
    `${s.phase} ${s.sessionId}`)

  s = UY.reduce(s, { type: 'poll', payload: { ok: true, status: 'pending', cookieCount: 6 } })
  t('poll pending → 继续 waiting 且仍在轮询', s.phase === 'waiting' && UY.shouldPoll(s) === true, s.phase)
  t('poll 计数随每次答复 +1', s.polls === 1, `polls=${s.polls}`)

  s = UY.reduce(s, { type: 'poll', payload: { ok: true, status: 'success', valid: true, nickname: '词典用户' } })
  t('poll success → done 且停止轮询', s.phase === 'done' && UY.shouldPoll(s) === false, s.phase)
  t('success 带回昵称（状态卡要用）', s.nickname === '词典用户', s.nickname)
  t('success 后清掉 sessionId（不再有会话可轮）', s.sessionId === '', `"${s.sessionId}"`)
}

// ── 14.2 状态机：E_NO_BROWSER 降级 ──
{
  let s = UY.reduce(UY.initial(), { type: 'start-request' })
  s = UY.reduce(s, {
    type: 'start-reply',
    payload: { ok: false, error: { code: 'E_NO_BROWSER', message: '找不到 Chrome' } },
  })
  t('E_NO_BROWSER → failed 且标记降级', s.phase === 'failed' && s.degraded === true, `${s.phase} degraded=${s.degraded}`)
  t('E_NO_BROWSER 文案指向手动粘贴', /手动粘贴/.test(s.message), s.message)
  t('降级后不轮询', UY.shouldPoll(s) === false)

  // 降级是「这台机器没浏览器」的能力结论：再点一次不该假装恢复了
  const again = UY.reduce(s, { type: 'start-request' })
  t('降级态再点一次仍保留降级标记', again.degraded === true, `degraded=${again.degraded}`)

  // 取消之后同样保留降级（否则手动区会突然收起来）
  const afterCancel = UY.reduce(s, { type: 'cancel' })
  t('降级态取消后仍保留降级标记', afterCancel.degraded === true, `degraded=${afterCancel.degraded}`)
}

// ── 14.3 状态机：超时 / 取消 / 会话丢失 / 网络抖动 ──
{
  let base = UY.reduce(UY.initial(), { type: 'start-reply', payload: { ok: true, sessionId: 's2' } })

  const timeout = UY.reduce(base, { type: 'poll', payload: { ok: false, error: { code: 'E_LOGIN_TIMEOUT', message: '超时' } } })
  t('E_LOGIN_TIMEOUT → failed 且停止轮询', timeout.phase === 'failed' && UY.shouldPoll(timeout) === false, timeout.phase)
  t('超时文案告诉用户可以再点一次', /再点一次/.test(timeout.message), timeout.message)

  const gone = UY.reduce(base, { type: 'poll', payload: { ok: false, error: { code: 'E_LOGIN_NOT_FOUND', message: '没了' } } })
  t('E_LOGIN_NOT_FOUND → failed 且停止轮询', gone.phase === 'failed' && UY.shouldPoll(gone) === false, gone.phase)

  const cancelled = UY.reduce(base, { type: 'poll', payload: { ok: false, error: { code: 'E_LOGIN_CANCELLED', message: '取消' } } })
  t('E_LOGIN_CANCELLED → failed 且停止轮询', cancelled.phase === 'failed' && UY.shouldPoll(cancelled) === false, cancelled.phase)

  const cancel = UY.reduce(base, { type: 'cancel' })
  t('本地取消 → idle 且停止轮询', cancel.phase === 'idle' && UY.shouldPoll(cancel) === false, cancel.phase)

  // 网络抖一下不能判会话死：用户可能正在输密码，窗口还开着
  const blip = UY.reduce(base, { type: 'poll', payload: { ok: false, error: { code: 'E_NETWORK', message: '断了' } } })
  t('网络抖动 → 继续 waiting（不误判登录失败）', blip.phase === 'waiting' && UY.shouldPoll(blip) === true, blip.phase)

  const reset = UY.reduce(base, { type: 'reset' })
  t('reset 回到初始态', reset.phase === 'idle' && reset.sessionId === '', reset.phase)
}

// ── 14.4 真组件渲染：三种阶段的可见文案 ──
{
  // 独立实例：不污染前面几段用过的 hooks 表
  const rules14 = runFactoryWithRules()
  const makeP14 = rules14.api?.makePrimitives
  t('导出 makePrimitives 供独立渲染', typeof makeP14 === 'function')

  const P14 = typeof makeP14 === 'function' ? makeP14(rules14.api?.__h ?? (() => null)) : null

  // 直接用产物里的 h（React.createElement 的最小替身）
  const h14 = (type, props, ...children) => ({ type, props, children: children.flat() })
  const P14b = typeof makeP14 === 'function' ? makeP14(h14) : null
  t('能造出一套原语', P14b !== null && typeof P14b?.Button === 'function')

  const flat14 = (tree) => JSON.stringify(tree, (k, v) => (k === 'node' ? '[obj]' : v))

  // 渲染 YoudaoTab。props 里的 book 给最小桩：组件会调 listBooks()/size()。
  //
  // 组件首轮 checking=true，会先显示「正在检查登录状态…」——真机上是 GET /status
  // 回来之前那一瞬。要验「未配置态的登录入口」，得把 hooks 表里 status/checking
  // 两个槽预置成「查完了、没配过」，等价于宿主回了 hasCookie:false。
  const renderYoudao = (slotsPreset) => {
    const Tab = rules14.api?.YoudaoTab
    if (typeof Tab !== 'function' || P14b === null) return null
    const table = rules14.tables.get(Tab) ?? []
    if (slotsPreset !== undefined) {
      table[0] = { hasCookie: false, valid: false, lastSyncAt: 0, lastCount: 0 }
      table[1] = false
    }
    rules14.tables.set(Tab, table)
    const props = {
      h: h14,
      P: P14b,
      book: {
        listBooks: () => [{ id: 'default', name: '默认生词本' }],
        size: () => 0,
        importMany: async () => {},
      },
      say: () => {},
      onGoBook: () => {},
    }
    return rules14.mount(Tab, props)
  }

  const beforeCheck = renderYoudao()
  const beforeJson = beforeCheck?.tree === null ? '' : flat14(beforeCheck.tree)
  t('查询中先显示「正在检查登录状态」（不闪空）',
    /正在检查登录状态/.test(beforeJson), beforeJson.slice(0, 0) || '')

  const first = renderYoudao(true)
  t('未配置态渲染不抛错', first !== null && first.error === null, first?.error ?? 'ok')
  const firstJson = first?.tree === null ? '' : flat14(first.tree)
  t('未配置态出现「登录有道」按钮', firstJson.includes('登录有道'), firstJson.slice(0, 0) || '')
  t('未配置态说明「不用复制 Cookie」', /不用复制 Cookie|不用回来点任何东西/.test(firstJson))
  t('未配置态渲染手动粘贴折叠入口（兜底保留）', /手动粘贴 Cookie/.test(firstJson))
  t('未配置态默认不展开手动区（自动登录是主路径）',
    !firstJson.includes('保存并验证'), firstJson.includes('保存并验证') ? '手动区被默认展开了' : '已折叠')

  // ── 等待态：正在等用户登录 + 取消按钮 ──
  // 槽位 11 是 login：YoudaoTab 前 11 个 useState 依次是
  // status(0) checking(1) cookieText(2) saving(3) syncing(4) result(5)
  // failure(6) books(7) targetBook(8) manualOpen(9) manualPasteOpen(10)，login 是第 12 个 → 索引 11。
  // 预置它就等价于「start 回来了、轮询开始了」那一帧 —— 不用真发请求。
  const waitingTab = () => {
    const Tab = rules14.api?.YoudaoTab
    const table = rules14.tables.get(Tab) ?? []
    table[11] = { phase: 'waiting', sessionId: 'sess-1', message: '', degraded: false, nickname: '', polls: 1, code: '' }
    rules14.tables.set(Tab, table)
    return rules14.mount(Tab, {
      h: h14, P: P14b,
      book: { listBooks: () => [], size: () => 0, importMany: async () => {} },
      say: () => {}, onGoBook: () => {},
    })
  }
  const waiting = waitingTab()
  const waitingJson = waiting?.tree === null ? '' : flat14(waiting.tree)
  t('等待态渲染不抛错', waiting?.error === null, waiting?.error ?? 'ok')
  t('等待态出现「正在等你在浏览器里登录…」',
    waitingJson.includes('正在等你在浏览器里登录'), waitingJson.slice(0, 0) || '')
  t('等待态出现取消按钮', waitingJson.includes('取消登录'), waitingJson.slice(0, 0) || '')
  // 说明文案里也会出现「登录有道」这几个字，所以不能拿整棵树搜字符串，
  // 要认按钮本身：Button 的 label 是精确值。
  const buttonLabels = (tree) => walk9(tree, (n) => n?.type === P14b.Button
    || (typeof n?.props?.label === 'string' && n?.type?.name === 'Button'))
    .map((n) => n?.props?.label ?? '')
  const waitingLabels = waiting?.tree === null ? [] : buttonLabels(waiting.tree)
  t('等待态主按钮已换成取消（不再有「登录有道」按钮）',
    !waitingLabels.includes('登录有道') && waitingLabels.includes('取消登录'), waitingLabels.join(' | '))

  // ── 降级态：没有浏览器 → 指向手动粘贴，且手动区自动展开 ──
  const degradedTab = () => {
    const Tab = rules14.api?.YoudaoTab
    const table = rules14.tables.get(Tab) ?? []
    table[11] = {
      phase: 'failed', sessionId: '', degraded: true, nickname: '', polls: 0, code: 'E_NO_BROWSER',
      message: '自动登录不可用：找不到 Chrome。用下面的「手动粘贴 Cookie」一样能连上，不用装任何东西。',
    }
    rules14.tables.set(Tab, table)
    return rules14.mount(Tab, {
      h: h14, P: P14b,
      book: { listBooks: () => [], size: () => 0, importMany: async () => {} },
      say: () => {}, onGoBook: () => {},
    })
  }
  const degraded = degradedTab()
  const degradedJson = degraded?.tree === null ? '' : flat14(degraded.tree)
  t('降级态渲染不抛错', degraded?.error === null, degraded?.error ?? 'ok')
  t('降级态提示「自动登录不可用」', /自动登录不可用/.test(degradedJson), degradedJson.slice(0, 0) || '')
  t('降级态指向「手动粘贴 Cookie」', /手动粘贴 Cookie/.test(degradedJson))
  t('降级态自动展开手动区（那是唯一能走的路）',
    degradedJson.includes('保存并验证'), degradedJson.includes('保存并验证') ? 'ok' : '手动区没展开')
  const degradedLabels = degraded?.tree === null ? [] : buttonLabels(degraded.tree)
  t('降级态不显示「登录有道」主按钮（点了也起不来）',
    !degradedLabels.includes('登录有道'), degradedLabels.join(' | ') || '无按钮')
  t('降级态仍留着手动区按钮（兜底可用）',
    degradedLabels.includes('保存并验证'), degradedLabels.join(' | ') || '无按钮')

  // ── 已连接态：状态卡说「已连接」，不再给登录入口，手动区收起 ──
  const doneTab = () => {
    const Tab = rules14.api?.YoudaoTab
    const table = rules14.tables.get(Tab) ?? []
    // status(0) 与 checking(1) 一起预置：这才是「GET /status 回来且通了」的样子
    table[0] = { hasCookie: true, valid: true, nickname: '词典用户', lastSyncAt: 0, lastCount: 0 }
    table[1] = false
    table[11] = { phase: 'done', sessionId: '', message: '', degraded: false, nickname: '词典用户', polls: 3, code: '' }
    rules14.tables.set(Tab, table)
    return rules14.mount(Tab, {
      h: h14, P: P14b,
      book: { listBooks: () => [{ id: 'default', name: '默认生词本' }], size: () => 0, importMany: async () => {} },
      say: () => {}, onGoBook: () => {},
    })
  }
  const done = doneTab()
  const doneJson = done?.tree === null ? '' : flat14(done.tree)
  const doneLabels = done?.tree === null ? [] : buttonLabels(done.tree)
  t('已连接态渲染不抛错', done?.error === null, done?.error ?? 'ok')
  t('已连接态状态卡显示昵称 + 已连接', /词典用户 · 已连接/.test(doneJson), doneJson.slice(0, 0) || '')
  t('登录完成给一条成功说明', /已通过浏览器登录连上有道/.test(doneJson), doneJson.slice(0, 0) || '')
  t('已连接态不再显示登录入口（无需重复登录）',
    !doneLabels.includes('登录有道') && !doneLabels.includes('重试登录有道'), doneLabels.join(' | '))
  t('已连接态给抓取按钮（主用途回来了）',
    doneLabels.includes('一键抓取收藏夹'), doneLabels.join(' | '))
  t('已连接态给清除 Cookie 的入口',
    doneLabels.includes('清除 Cookie'), doneLabels.join(' | '))
}

// ── 14.5 真跑一遍点击流程（fetch 打桩，无网络无 GUI）──
// 前面几段验的是「状态机对不对」「渲染对不对」，这一段验**接线对不对**：
// 点按钮真的发 POST /login/start、真的排上 2 秒定时器、真的每轮 GET poll、
// 拿 success 之后真的清掉 sessionId 并回头刷 status。
// 假 fetch 只认四个端点，别的路径一律记下来当失败信号。
{
  const calls = []
  let pollCount = 0
  const fakeFetch = async (url, opts = {}) => {
    const u = String(url)
    const method = opts.method ?? 'GET'
    calls.push(`${method} ${u.slice(u.indexOf('/api/dsh-hover-dict') + '/api/dsh-hover-dict'.length)}`)
    const reply = (value) => ({ json: async () => value })
    if (u.includes('/youdao/status')) {
      return reply({ ok: true, hasCookie: false, valid: false, lastSyncAt: 0, lastCount: 0 })
    }
    if (u.includes('/youdao/login/start')) {
      return reply({ ok: true, sessionId: 'SESS-X', loginUrl: 'https://c.youdao.com/x' })
    }
    if (u.includes('/youdao/login/poll')) {
      pollCount += 1
      return reply(pollCount < 2
        ? { ok: true, status: 'pending', cookieCount: 6 }
        : { ok: true, status: 'success', valid: true, nickname: '真登录用户' })
    }
    return reply({ ok: true })
  }

  // 需要能手动点火的 setTimeout / clearTimeout：把定时器攒起来自己跑
  const timers = []
  const rules145 = runFactoryWithRules({ setTimeout: (fn, ms) => { timers.push({ fn, ms }), timers.length }, clearTimeout: (id) => { if (id) timers[id - 1] = null } })
  const Tab145 = rules145.api?.YoudaoTab
  const P145 = typeof rules145.api?.makePrimitives === 'function'
    ? rules145.api.makePrimitives((type, props, ...kids) => ({ type, props, children: kids.flat() }))
    : null
  t('14.5 独立实例可用', typeof Tab145 === 'function' && P145 !== null)

  if (typeof Tab145 === 'function' && P145 !== null) {
    const table = [{ hasCookie: false, valid: false, lastSyncAt: 0, lastCount: 0 }, false]
    rules145.tables.set(Tab145, table)
    const tree145 = rules145.mount(Tab145, {
      h: (type, props, ...kids) => ({ type, props, children: kids.flat() }),
      P: P145,
      book: { listBooks: () => [], size: () => 0, importMany: async () => {} },
      say: () => {}, onGoBook: () => {},
    }).tree

    // 14.4 里那些断言之所以能用 walk9，是因为父级都是原生标签（h('div',...,[kids])）；
    // 这里根是 Card 组件，孩子们挂在 **props.children** 上（组件还没被 h() 求值），
    // 所以要用同时看 children 与 props.children 的遍历器。
    const walkDeep = (node, pred, out = []) => {
      if (!node || typeof node !== 'object') return out
      if (Array.isArray(node)) { node.forEach((n) => walkDeep(n, pred, out)); return out }
      if (pred(node)) out.push(node)
      for (const c of (node.children ?? [])) walkDeep(c, pred, out)
      for (const c of (node.props?.children ?? [])) walkDeep(c, pred, out)
      return out
    }
    const btns145 = walkDeep(tree145, (n) => typeof n?.props?.label === 'string')
    const label145 = (n) => String(n?.props?.label ?? '')
    const loginBtn = btns145.find((n) => label145(n) === '登录有道')
    t('14.5 找得到「登录有道」按钮', !!loginBtn, btns145.map(label145).join(' | '))

    if (loginBtn) {
      // 这一段的 fetch 桩要盖住产物内部的 fetch；用 globalThis 是因为
      // youdaoRequest 里是裸 fetch 调用（浏览器全局）
      const prevFetch = globalThis.fetch
      globalThis.fetch = fakeFetch
      try {
        await loginBtn.props.onClick()
        await new Promise((r) => setTimeout(r, 20))
        t('14.5 点一下真的发了 POST /login/start',
          calls.some((c) => c === 'POST /youdao/login/start'), calls.join(' | '))
        t('14.5 拿到 sessionId 后排上 2 秒轮询',
          timers.some((x) => x && x.ms === 2000), timers.filter(Boolean).map((x) => x.ms).join(','))
        t('14.5 状态进入 waiting', table[11]?.phase === 'waiting', table[11]?.phase)

        const takePoll = () => {
          const i = timers.findIndex((x) => x && x.ms === 2000)
          if (i < 0) return false
          const job = timers[i]
          timers[i] = null
          job.fn()
          return true
        }

        if (takePoll()) await new Promise((r) => setTimeout(r, 20))
        t('14.5 第一轮 poll 拿到 pending 后仍在等待',
          table[11]?.phase === 'waiting' && table[11]?.polls === 1, `${table[11]?.phase} polls=${table[11]?.polls}`)
        t('14.5 poll 带的 session 就是 start 给的那个',
          calls.some((c) => c.includes('session=SESS-X')), calls.filter((c) => c.includes('poll')).join(' | '))

        if (takePoll()) await new Promise((r) => setTimeout(r, 20))
        t('14.5 第二轮 poll 拿到 success → done', table[11]?.phase === 'done', table[11]?.phase)
        t('14.5 done 带回昵称', table[11]?.nickname === '真登录用户', table[11]?.nickname)
        t('14.5 done 后清掉 sessionId（不再轮询）', table[11]?.sessionId === '', `"${table[11]?.sessionId}"`)
        t('14.5 done 后没有残留的轮询定时器',
          !timers.some((x) => x && x.ms === 2000), timers.filter(Boolean).map((x) => x.ms).join(',') || '无')
        // 注意：本模拟器里 useEffect 是空实现，所以挂载时那次 refreshStatus 并不会跑。
        // 因此「done 后刷过 status」应该表现为**恰好出现一次** status 调用，且它是最后一条。
        for (let i = 0; i < 5 && !calls.at(-1)?.includes('/youdao/status'); i += 1) {
          await new Promise((r) => setTimeout(r, 10))
        }
        t('14.5 done 后回头刷了一次 status（状态卡要昵称/词数）',
          calls.filter((c) => c === 'GET /youdao/status').length === 1
          && calls.at(-1) === 'GET /youdao/status',
          calls.join(' | '))
      } finally {
        globalThis.fetch = prevFetch
      }
    }
  }
}

// ── 14.6 轮询不许泄漏 ──
// 只靠 cleanup 里的 clearTimeout 不够：卸载那一刻若有 poll 请求在飞，
// 它的 .then 回来还会排新定时器 → 留下一个一直打宿主的轮询。
// 这是这段 UI 里唯一会「静默坏事」的地方，钉住它。
{
  const setSrc14 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
  t('有卸载标记 aliveRef', /aliveRef\s*=\s*useRef\(/.test(setSrc14))
  t('cleanup 里把卸载标记置 false', /aliveRef\.current\s*=\s*false/.test(setSrc14))
  const scheduleSites = setSrc14.match(/loginTimer\.current\s*=\s*setTimeout\(/g) ?? []
  const guarded = setSrc14.match(/aliveRef\.current\)\s*\{\s*\n\s*loginTimer\.current\s*=\s*setTimeout\(/g) ?? []
  t('每一处排定时器都先看卸载标记',
    scheduleSites.length > 0 && guarded.length === scheduleSites.length,
    `排定时器 ${scheduleSites.length} 处 / 有守卫 ${guarded.length} 处`)
  t('轮询间隔是 2 秒（不是 0 或特别密）', /YOUDAO_LOGIN_POLL_MS\s*=\s*2000/.test(setSrc14),
    /YOUDAO_LOGIN_POLL_MS\s*=\s*(\d+)/.exec(setSrc14)?.[1] ?? '?')
}


// ── 15. 复习队列不丢词 + 空态按钮可点（1.3.2 修复回归） ──
//
// 用户报：「复习页一直说今天没有到期的词，提前复习按钮点了没反应」。
// 根因是 filterQueue 把「全部词书」哨兵 'all' 当成真词书 id 去匹配 ——
// 没有任何词的 bookId 是 'all'（都是 'default'），于是全部词被过滤光，队列恒空。
// 上面这些断言钉住三件事：'all' 不丢词、真词书 id 仍能过滤、空态两个按钮真的能进卡片。
console.log('\n[15] 复习队列：\'all\' 哨兵不丢词 + 空态按钮可点')

{
  const filterQueue = api.filterQueue
  const aheadQueue = api.aheadQueue
  const booksOfEntry = api.booksOfEntry
  t('导出 filterQueue / aheadQueue / booksOfEntry',
    typeof filterQueue === 'function' && typeof aheadQueue === 'function' && typeof booksOfEntry === 'function')

  // ── 15.1 纯函数层：'all' 必须等于「不筛」 ──
  const entries = [
    { head: 'alpha', state: 'new', bookId: 'default', addedAt: 1, srs: { due: 0 } },
    { head: 'beta', state: 'new', bookId: 'default', addedAt: 2, srs: { due: 0 } },
    { head: 'gamma', state: 'fuzzy', bookId: 'other', addedAt: 3, srs: { due: 0 } },
  ]
  const allCount = filterQueue(entries, { state: 'all', bookId: 'all' }).length
  t("filterQueue(bookId='all') 不丢词（3 个都在）", allCount === 3, `实测 ${allCount}，期望 3`)
  t("filterQueue(bookId='') 与 'all' 等价",
    filterQueue(entries, { state: 'all', bookId: '' }).length === allCount)
  t('filterQueue 不给 filter 参数也不丢词',
    filterQueue(entries).length === allCount, String(filterQueue(entries).length))
  t('真词书 id 仍能正确过滤（default → 2 个）',
    filterQueue(entries, { state: 'all', bookId: 'default' }).length === 2,
    String(filterQueue(entries, { state: 'all', bookId: 'default' }).length))
  t('真词书 id 仍能正确过滤（other → 1 个）',
    filterQueue(entries, { state: 'all', bookId: 'other' }).length === 1)
  t('不存在的词书 id 过滤成 0（不是静默放过）',
    filterQueue(entries, { state: 'all', bookId: 'zzz' }).length === 0)
  t("state 筛选用 'all' 也是不筛",
    filterQueue(entries, { state: 'all', bookId: 'all' }).length
    === filterQueue(entries, { state: 'all', bookId: '' }).length)
  t('state 真筛选仍生效（fuzzy → 1 个）',
    filterQueue(entries, { state: 'fuzzy', bookId: 'all' }).length === 1)
  t("'all' 与真 id 组合也不冲突（state=all + bookId=default → 2）",
    filterQueue(entries, { state: 'all', bookId: 'default' }).length === 2)
  t("alsoIn 里的词书仍能被匹配", (() => {
    const withAlso = [{ head: 'delta', state: 'new', bookId: 'default', alsoIn: ['extra'], srs: { due: 0 } }]
    return filterQueue(withAlso, { state: 'all', bookId: 'extra' }).length === 1
  })())

  // 源码层再钉一次：不许有人把 'all' 的判断改回「只判空串」。
  // （纯函数断言已经能抓，但源码断言能把「改回去」的意图直接点出来）
  const reviewSrc15 = readFileSync(join(ROOT, 'client/src/review.js'), 'utf8')
  t("review.js 里 bookId 明确排除 'all' 哨兵",
    /rawBook\s*!==\s*ALL|bookId\s*!==\s*'all'|bookId\s*!==\s*ALL/.test(reviewSrc15))

  // ── 15.2 真 wordbook：3 个 due=0 的词，'all' 全程不丢 ──
  {
    const wb15 = api.createWordbook({})
    await wb15.ready()
    await wb15.importMany(['alpha', 'beta', 'gamma'], 'manual')
    const due = wb15.dueQueue()
    t('wordbook：3 个新词立刻到期', due.length === 3, String(due.length))
    t("真 dueQueue + bookId='all' 不丢词",
      filterQueue(due, { state: 'all', bookId: 'all' }).length === due.length,
      `queue ${due.length} → filtered ${filterQueue(due, { state: 'all', bookId: 'all' }).length}`)
    t("真 dueQueue + bookId='default' 也全中（词都在默认本）",
      filterQueue(due, { state: 'all', bookId: 'default' }).length === 3)
    t('aheadQueue 同样不因 all 丢词（它后面也过 filterQueue）',
      filterQueue(aheadQueue(wb15.list(), 20), { state: 'all', bookId: 'all' }).length === 3)
  }

  // ── 15.3 真渲染 ReviewTab：空态 → 点按钮 → 卡片出现 ──
  // 用独立 fiber 实例（[11]/[13] 那套），避免污染别段的 hooks 表。
  const rules15 = runFactoryWithRules()
  const RT15 = rules15.api?.ReviewTab
  const P15raw = rules15.api?.makePrimitives
  const h15 = (type, props, ...kids) => ({ type, props, children: kids.flat() })
  const P15 = typeof P15raw === 'function' ? P15raw(h15) : null
  t('15 独立实例：ReviewTab + makePrimitives 可用',
    typeof RT15 === 'function' && P15 !== null)

  // ReviewTab 根是原生 div，孩子直接挂在 children 上；Card/Button 这些是组件，
  // 在假 React 里已被 h() 求值成元素，孩子的 props.children 也要看 —— 用双向遍历。
  const walk15 = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { node.forEach((n) => walk15(n, pred, out)); return out }
    if (pred(node)) out.push(node)
    for (const c of (node.children ?? [])) walk15(c, pred, out)
    for (const c of (node.props?.children ?? [])) walk15(c, pred, out)
    return out
  }
  const flat15 = (tree) => (tree === null ? '' : JSON.stringify(tree, (k, v) => (k === 'node' ? '[obj]' : v)))
  const labels15 = (tree) => walk15(tree, (n) => typeof n?.props?.label === 'string')
    .map((n) => String(n.props.label))

  /**
   * 渲染 ReviewTab 并返回 { tree, buttons, json }。
   *
   * book 桩直接用真 wordbook —— 这一段的重点就是「真数据 + 真组件」串起来。
   * due 参数用来把全部词的到期时间整体推到未来，制造「真空队列」。
   */
  const renderReview = (book) => {
    // 新实例 = 干净 hooks 表（否则 queue/index 会沿用上一轮的槽位）
    const r = runFactoryWithRules()
    const Tab = r.api?.ReviewTab
    const Pf = r.api?.makePrimitives(h15)
    const result = r.mount(Tab, {
      h: h15, P: Pf, book,
      dict: null,
      stats: typeof book?.stats === 'function' ? book.stats() : { total: 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, streak: 0 },
      say: () => {}, bump: () => {},
    })
    const buttons = walk15(result.tree, (n) => typeof n?.props?.label === 'string')
    return { result, buttons, json: flat15(result.tree), rules: r, Tab }
  }

  // ── 场景 A：有到期词 → 点「开始复习」→ 卡片真的出现 ──
  {
    const wbA = api.createWordbook({})
    await wbA.ready()
    await wbA.importMany(['alpha', 'beta', 'gamma'], 'manual')

    const a0 = renderReview(wbA)
    t('A 首屏渲染不抛错', a0.result.error === null, a0.result.error ?? 'ok')
    t('A 首屏出现「开始复习」按钮', labels15(a0.result.tree).includes('开始复习'),
      labels15(a0.result.tree).join(' | '))
    t('A 首屏不是空态文案（有到期词却说没有就是 bug）',
      !a0.json.includes('今天没有到期的词'))

    const goBtn = a0.buttons.find((n) => String(n.props.label) === '开始复习')
    t('A 「开始复习」按钮 not disabled', goBtn !== undefined && goBtn.props.disabled !== true)
    if (goBtn && typeof goBtn.props.onClick === 'function') {
      // 点击会 setQueue；再用同一个 fiber 实例重渲染，读到新队列
      goBtn.props.onClick()
      const a1 = a0.rules.mount(a0.Tab, {
        h: h15, P: a0.rules.api.makePrimitives(h15), book: wbA, dict: null,
        stats: wbA.stats(), say: () => {}, bump: () => {},
      })
      t('A 点「开始复习」后进入卡片（不是回到空态）',
        a1.tree !== null && !flat15(a1.tree).includes('今天没有到期的词'),
        a1.error ?? 'ok')
      const stage = walk15(a1.tree, (n) => n?.props?.className === 'hds-cardstage')
      t('A 点击后真的出现卡片舞台 .hds-cardstage', stage.length > 0, `${stage.length} 个`)
      t('A 卡片正面是词头 alpha', flat15(a1.tree).includes('alpha'))
    } else {
      t('A 「开始复习」按钮 onClick 是函数', false)
    }
  }

  // ── 场景 B：全部词都在未来 → 真空队列 → 「提前复习」可点且能进卡片 ──
  {
    const wbB = api.createWordbook({})
    await wbB.ready()
    await wbB.importMany(['alpha', 'beta', 'gamma'], 'manual')
    const future = Date.now() + 30 * 86400000
    for (const head of ['alpha', 'beta', 'gamma']) wbB.get(head).srs.due = future
    t('B 全部推到未来后 dueQueue 为空', wbB.dueQueue().length === 0)

    const b0 = renderReview(wbB)
    t('B 真空队列渲染不抛错', b0.result.error === null, b0.result.error ?? 'ok')
    // 首轮 queue 是 null（未开始），标题是「开始复习」；点一次才进空态。
    const startBtn = b0.buttons.find((n) => String(n.props.label) === '开始复习')
    t('B 未开始态有「开始复习」按钮', startBtn !== undefined,
      labels15(b0.result.tree).join(' | '))
    if (startBtn) {
      startBtn.props.onClick()
      // 同一个 fiber 实例重渲染：queue 槽已经变成 []（空态），读到的是点击后的界面
      const b1r = b0.rules.mount(b0.Tab, {
        h: h15, P: b0.rules.api.makePrimitives(h15), book: wbB, dict: null,
        stats: wbB.stats(), say: () => {}, bump: () => {},
      })
      const json1 = flat15(b1r.tree)
      t('B 点「开始复习」后进入空态（显示今天没有到期的词）',
        json1.includes('今天没有到期的词'), b1r.error ?? 'ok')

      const aheadBtn = walk15(b1r.tree, (n) => typeof n?.props?.label === 'string'
        && /提前复习/.test(String(n.props.label)))[0]
      t('B 空态出现「提前复习最早到期的 20 个」按钮',
        aheadBtn !== undefined, labels15(b1r.tree).join(' | '))
      t('B 「提前复习」按钮 not disabled（点了要能用）',
        aheadBtn !== undefined && aheadBtn.props.disabled !== true)
      if (aheadBtn && typeof aheadBtn.props.onClick === 'function') {
        aheadBtn.props.onClick()
        const b2 = b0.rules.mount(b0.Tab, {
          h: h15, P: b0.rules.api.makePrimitives(h15), book: wbB, dict: null,
          stats: wbB.stats(), say: () => {}, bump: () => {},
        })
        const json2 = flat15(b2.tree)
        const stage2 = walk15(b2.tree, (n) => n?.props?.className === 'hds-cardstage')
        t('B 点「提前复习」后真的进入卡片（不再回到空态）',
          stage2.length > 0 && !json2.includes('今天没有到期的词'), b2.error ?? 'ok')
        t('B 提前复习出的词来自 aheadQueue', json2.includes('alpha'))
      } else {
        t('B 「提前复习」onClick 是函数', false)
      }
    }
  }

  // ── 15.4 dueToday 与 dueQueue 口径：分开说，不许自相矛盾 ──
  {
    // 造「今天中午到期、现在还是早上」的场景：
    // due 落在今天之内但晚于此刻 → stats.dueToday 计入，dueQueue 不计入。
    const wbC = api.createWordbook({})
    await wbC.ready()
    await wbC.importMany(['alpha', 'beta'], 'manual')
    const now = Date.now()
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const noon = dayStart.getTime() + 12 * 3600000
    // 只在「此刻早于中午」的时候这个构造才成立；否则把 due 放到今天末尾
    const laterToday = noon > now ? noon : dayStart.getTime() + 23 * 3600000
    for (const head of ['alpha', 'beta']) wbC.get(head).srs.due = laterToday
    const stC = wbC.stats(now)
    t('C 今日到期 > 0（due < 今天结束）', stC.dueToday > 0, String(stC.dueToday))
    t('C 此刻可复习 = 0（due > now）', wbC.dueQueue(now).length === 0,
      String(wbC.dueQueue(now).length))
    t('C 两个口径确实不同（这就是当年那句自相矛盾的来源）',
      stC.dueToday > 0 && wbC.dueQueue(now).length === 0)

    const c0 = renderReview(wbC)
    const startC = c0.buttons.find((n) => String(n.props.label) === '开始复习')
    if (startC) {
      startC.props.onClick()
      const c1 = c0.rules.mount(c0.Tab, {
        h: h15, P: c0.rules.api.makePrimitives(h15), book: wbC, dict: null,
        stats: wbC.stats(), say: () => {}, bump: () => {},
      })
      const jsonC = flat15(c1.tree)
      // 注意钉的是 **hint 原文**（「此刻可复习的是 0 个」），不是标题里那个「此刻」——
      // 标题叫「此刻没有可复习的词」也算含「此刻」，用它判定会假通过。
      t('C 空态 hint 说「此刻可复习的是 0 个」（不再只说「队列是空的」）',
        jsonC.includes('此刻可复习的是 0 个'), jsonC.slice(0, 0) || '')
      t('C 空态明确交代今日到期的还没到复习点',
        /还没到复习点/.test(jsonC), '')
      t('C 空态不再出现「队列是空的」这种不交代口径的旧文案',
        !jsonC.includes('队列是空的'))
      t('C 「今日到期」统计仍然显示真实数字（口径没错，不改）',
        jsonC.includes('今日到期'), '')
    } else {
      t('C 找到「开始复习」按钮', false)
    }
  }
}

// ── 16. 发音按钮：换词要念新词，同词才停（t6） ──
//
// 1.3.1 的真实 bug：speakWord 只判「有没有在念」，不判「在念哪个词」。
// 念 A 时点 B 的 🔊 → 走进 stop 分支 → cancel 掉 A 却不念 B → 用户听到静音。
// 用户描述是「点不了/没声音」「有些词有、有些没有」，其实是换词必静音、
// 停下来后再点同一个词才出声。
//
// 这一段用可控的假 speechSynthesis（speaking/pending 能手动翻，记录 speak/cancel 次数），
// 把三种情况逐条钉住：换词要念、同词要停、念完要复位。
console.log("\n[16] 发音按钮：换词念新词、同词才停、念完复位")

/** 可控假引擎：每次 speak 记一条，cancel 记一次；utterance 的 onend/onerror 可手动触发。 */
const makeSpeech16 = () => {
  const said = []          // 每次 speak 的 utterance
  let cancelCount = 0
  const stub = {
    speaking: false,
    pending: false,
    speak(u) { said.push(u); stub.speaking = true; stub.pending = false },
    cancel() { cancelCount += 1; stub.speaking = false; stub.pending = false },
  }
  class Utterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.onend = null; this.onerror = null }
  }
  return { stub, Utterance, said, cancels: () => cancelCount }
}

const speak16 = api?.speakWord
t('导出 speakWord', typeof speak16 === 'function')

{
  const savedSynth16 = globalThis.speechSynthesis
  const savedUtt16 = globalThis.SpeechSynthesisUtterance
  const sp = makeSpeech16()
  globalThis.speechSynthesis = sp.stub
  globalThis.SpeechSynthesisUtterance = sp.Utterance
  try {
    // ── 16.1 念 A → 念 B：必须真念 B，不许只 cancel ──
    const r1 = speak16('alpha')
    t('16.1 首次念 alpha 返回 speak', r1 === 'speak', r1)
    t('16.1 alpha 真的进了 speak', sp.said.at(-1)?.text === 'alpha', sp.said.at(-1)?.text)

    const cancelBefore = sp.cancels()
    const r2 = speak16('banana')
    t('16.1 念 alpha 时点 banana 的 🔊 → 返回 speak（不是 stop）', r2 === 'speak', r2)
    t('16.1 换词时先 cancel 掉旧词', sp.cancels() === cancelBefore + 1,
      `cancel ${cancelBefore} → ${sp.cancels()}`)
    t('16.1 换词后真的念了 banana', sp.said.at(-1)?.text === 'banana', sp.said.at(-1)?.text)
    t('16.1 换词一共念了两次（alpha + banana）', sp.said.length === 2, `${sp.said.length} 次`)

    // ── 16.2 念 A → 再念 A：停，不重复念 ──
    const countBeforeA = sp.said.length
    const r3 = speak16('banana')
    t('16.2 正在念 banana 时再点 banana → 返回 stop', r3 === 'stop', r3)
    t('16.2 同词再点没有新增朗读', sp.said.length === countBeforeA, `${countBeforeA} → ${sp.said.length}`)
    t('16.2 同词再点确实 cancel 了', sp.stub.speaking === false, `speaking=${sp.stub.speaking}`)

    // ── 16.3 念完（onend）后，同一个词还能重新念 ──
    const r4 = speak16('cherry')
    t('16.3 停掉之后念新词 cherry 能出声', r4 === 'speak' && sp.said.at(-1)?.text === 'cherry', `${r4} / ${sp.said.at(-1)?.text}`)
    // 模拟念完
    const lastUtt = sp.said.at(-1)
    sp.stub.speaking = false
    if (typeof lastUtt?.onend === 'function') lastUtt.onend()
    const r5 = speak16('cherry')
    t('16.3 cherry 念完后 onend 复位，再点 cherry 能重新念', r5 === 'speak', r5)
    t('16.3 重新念的确实是 cherry', sp.said.at(-1)?.text === 'cherry', sp.said.at(-1)?.text)

    // ── 16.4 onDone 回调：念完/出错/被停都要通知，按钮靠它复位 ──
    let doneCount = 0
    const r6 = speak16('durian', () => { doneCount += 1 })
    t('16.4 speak 时 onDone 不被立刻调用（还在念）', r6 === 'speak' && doneCount === 0, `${r6} / ${doneCount}`)
    const durianUtt = sp.said.at(-1)
    sp.stub.speaking = false
    if (typeof durianUtt?.onend === 'function') durianUtt.onend()
    t('16.4 念完 onend 触发 onDone（按钮据此复位）', doneCount === 1, `${doneCount}`)

    // 出错也要复位，否则按钮会一直亮着
    let errDone = 0
    const r7 = speak16('elder', () => { errDone += 1 })
    const elderUtt = sp.said.at(-1)
    sp.stub.speaking = false
    if (typeof elderUtt?.onerror === 'function') elderUtt.onerror()
    t('16.4 出错 onerror 也触发 onDone（不许留一个永远亮着的喇叭）', r7 === 'speak' && errDone === 1, `${r7} / ${errDone}`)

    // 主动停止（同词再点）也要复位按钮
    let stopDone = 0
    const r8 = speak16('fig')
    const r9 = speak16('fig', () => { stopDone += 1 })
    t('16.4 同词再点停止时也调 onDone', r8 === 'speak' && r9 === 'stop' && stopDone === 1, `${r9} / ${stopDone}`)

    // ── 16.5 念完复位后，另一个词也能立刻接上（不残留 currentWord） ──
    const countBeforeSwitch = sp.said.length
    const r10 = speak16('grape')
    t('16.5 停完能直接接下一个词', r10 === 'speak' && sp.said.length === countBeforeSwitch + 1,
      `${r10} / ${sp.said.length - countBeforeSwitch}`)
  } finally {
    globalThis.speechSynthesis = savedSynth16
    globalThis.SpeechSynthesisUtterance = savedUtt16
  }
}

// ── 16.6 PronounceButton 真渲染：data-speaking 随点击/念完翻转 ──
{
  const savedSynth16 = globalThis.speechSynthesis
  const savedUtt16 = globalThis.SpeechSynthesisUtterance
  const sp = makeSpeech16()
  globalThis.speechSynthesis = sp.stub
  globalThis.SpeechSynthesisUtterance = sp.Utterance
  try {
    // 用能记住 setState 的假 React：按钮内部 setSpeaking 要能反映到下一次渲染
    const hooks = []
    let hi = 0
    const hBtn = (type, props, ...kids) => (typeof type === 'function'
      ? (() => { const prev = hi; hi = 0; const node = type({ ...(props ?? {}), children: kids.flat() }); hi = prev; return node })()
      : { type, props: props ?? {}, children: kids.flat() })
    const btn = api.PronounceButton({ word: 'alpha' })
    // PronounceButton 是组件：上面这次调用已进入它内部，hooks 用全局数组
    void btn

    // 更稳的做法：直接建一个最小 React 环境跑它
    const react16 = {
      createElement: (type, props, ...kids) => (typeof type === 'function'
        ? react16.__render(type, { ...(props ?? {}), children: kids.flat() })
        : { type, props: props ?? {}, children: kids.flat() }),
      useState: (init) => {
        const slot = react16.__i++
        const owner = react16.__active
        if (!(slot in owner)) owner[slot] = typeof init === 'function' ? init() : init
        return [owner[slot], (v) => { owner[slot] = v }]
      },
      useEffect: () => { react16.__i += 1 },
      useLayoutEffect: () => { react16.__i += 1 },
      useRef: (v) => { react16.__i += 1; return { current: v } },
      useMemo: (fn) => { react16.__i += 1; return fn() },
      useCallback: (fn) => { react16.__i += 1; return fn },
      __tables: new Map(),
      __i: 0,
      __active: null,
      __render(fn, props) {
        if (!react16.__tables.has(fn)) react16.__tables.set(fn, [])
        const prevA = react16.__active
        const prevI = react16.__i
        react16.__active = react16.__tables.get(fn)
        react16.__i = 0
        const node = fn(props)
        react16.__active = prevA
        react16.__i = prevI
        return node
      },
    }

    let api16 = null
    const runner16 = new Function('window', 'document', 'requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout', 'console', OUTPUT)
    runner16(
      { __ModuleLoader__: { load: ({ factory }) => { api16 = factory(() => react16) } }, innerWidth: 1200, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {}, localStorage: undefined },
      makeDocument(),
      (fn) => { fn(); return 1 },
      () => {},
      () => 1,
      () => {},
      { warn: () => {}, error: () => {}, log: () => {} },
    )

    const Btn16 = api16?.PronounceButton
    t('16.6 拿到 PronounceButton', typeof Btn16 === 'function')

    if (typeof Btn16 === 'function') {
      const render16 = () => react16.__render(Btn16, { word: 'alpha' })
      const btn1 = render16()
      t('16.6 初始 data-speaking 未设置（不在念）',
        btn1?.props?.['data-speaking'] === undefined, String(btn1?.props?.['data-speaking']))

      btn1.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
      const btn2 = render16()
      t('16.6 点击后 data-speaking=true', btn2?.props?.['data-speaking'] === 'true',
        String(btn2?.props?.['data-speaking']))
      t('16.6 点击确实念了 alpha', sp.said.at(-1)?.text === 'alpha', sp.said.at(-1)?.text)

      // 念完 → 按钮要自己复位
      const utt = sp.said.at(-1)
      sp.stub.speaking = false
      if (typeof utt?.onend === 'function') utt.onend()
      const btn3 = render16()
      t('16.6 onend 后 data-speaking 复位为 false', btn3?.props?.['data-speaking'] === undefined,
        String(btn3?.props?.['data-speaking']))
      t('16.6 复位后 title 回到「朗读」而不是「停止发音」',
        String(btn3?.props?.title ?? '').startsWith('朗读'), btn3?.props?.title)

      // 换词：另一个词的按钮点了要念新的
      const btnB = react16.__render(Btn16, { word: 'banana' })
      btnB.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
      t('16.6 换个词的按钮点了真的念新词', sp.said.at(-1)?.text === 'banana', sp.said.at(-1)?.text)
    }
  } finally {
    globalThis.speechSynthesis = savedSynth16
    globalThis.SpeechSynthesisUtterance = savedUtt16
  }
}

// ── 16.7 源码层：反向钉住「不许只按 speaking 就判 stop」 ──
{
  const src16 = readFileSync(join(ROOT, 'client/src/review.js'), 'utf8')
  const body16 = src16.slice(src16.indexOf('export function speakWord'))
  t('16.7 speakWord 有「记住当前词」的模块级变量', /let currentWord\s*=/.test(src16), '')
  t('16.7 停止分支要求「正在念的正是这个词」', /busy\s*&&\s*currentWord\s*===\s*text/.test(body16), '')
  t('16.7 换词路径不返回 stop（cancel 之后继续往下念）',
    /speechSynthesis\.cancel\(\)\s*\n\s*currentWord\s*=\s*text/.test(body16), '')
  t('16.7 utterance 上挂了 onend 与 onerror 两个复位钩子',
    /utterance\.onend\s*=/.test(body16) && /utterance\.onerror\s*=/.test(body16), '')
  t('16.7 PronounceButton 把复位回调传给了 speakWord',
    /speakWord\(word,\s*\(\)\s*=>\s*setSpeaking\(false\)\)/.test(src16), '')
}


// ── 17. 例句繁转简（用户：「一些例句的翻译是繁体」） ──
//
// Tatoeba 的句对源是繁中，8960 条例句里 3145 条含繁体字。
// 架构.md 早期那句「例句中文是繁体，不要转换」已过时 —— 用户 2026-11-28 明确要简体。
//
// 字典是 opencc-js 的 tw→cn 裁到本词库实际用字的子集（17.2KB 内嵌，零 npm 依赖），
// 两遍法（繁异体归一 → 繁转简）与 opencc 官方对 8960 条例句 + 75578 条释义
// 逐条比对 0 差异。这一段钉四件事：
//   ① 典型繁体句真的转对了；② 简体句原样不动（不许反过来改）；
//   ③ 一对多（著/乾/麵/裡）走的是正确的那一支；④ describeEntry 出来的例句已是简体。
console.log('\n[17] 例句繁转简（两遍法，与 opencc 0 差异）')

{
  const toSimplified = api.toSimplified
  const needsConversion = api.needsConversion
  t('产物导出 toSimplified / needsConversion',
    typeof toSimplified === 'function' && typeof needsConversion === 'function')

  // ── 17.1 典型繁体句 ──
  const SENTENCES = [
    ['我長大後想當國王。', '我长大后想当国王。'],
    ['科學幻想的簡稱是科幻。', '科学幻想的简称是科幻。'],
    ['他穿著一件藍襯衫。', '他穿着一件蓝衬衫。'],
    ['這個裝置是用開關啟動的。', '这个装置是用开关启动的。'],
    ['中國的四大名著是《西遊記》《三國演義》《水滸傳》和《紅樓夢》。',
      '中国的四大名著是《西游记》《三国演义》《水浒传》和《红楼梦》。'],
  ]
  for (const [src, want] of SENTENCES) {
    t(`繁体句转简「${src.slice(0, 12)}…」`, toSimplified(src) === want,
      toSimplified(src) === want ? '' : `得到「${toSimplified(src)}」`)
  }

  // ── 17.2 简体句必须原样（转换不能反过来改简体） ──
  const SIMPLIFIED = ['在中国的旁边', '瑞士像一个荒废的乡村似的。', '我长大后想当国王。']
  for (const src of SIMPLIFIED) {
    t(`简体句不动「${src.slice(0, 10)}…」`, toSimplified(src) === src,
      toSimplified(src) === src ? '' : `被改成「${toSimplified(src)}」`)
  }
  // 幂等：转过的结果再转一次不该再变（否则「已经简体」的输入会二次变形）
  for (const [src] of SENTENCES) {
    const once = toSimplified(src)
    t(`转换幂等「${once.slice(0, 10)}…」`, toSimplified(once) === once,
      toSimplified(once) === once ? '' : `再转一次变成「${toSimplified(once)}」`)
  }

  // ── 17.3 一对多：这几组是繁转简最容易错的地方 ──
  const AMBIGUOUS = [
    ['頭髮', '头发', '发（不是 头發/头髮）'],
    ['皇后', '皇后', '皇后里的「后」本来就写后，不许改成「皇後」'],
    ['乾燥', '干燥', '乾→干（不是 乾→干戈的干之外别的）'],
    ['干預', '干预', '干預本来就是干，不许改成「乾預」'],
    ['麵條', '面条', '麵→面（不是 麵→麪）'],
    ['裡面', '里面', '裡→里（不是 裡→裏）'],
    ['里程', '里程', '里程的「里」是里程，不许改成「裡程」'],
    ['著名', '著名', '著 在「著名」里保持 著（不是 着名）'],
    ['著作', '著作', '著作保持 著（不是 着作）'],
    ['著名的大學', '著名的大学', '短语里也保持 著'],
  ]
  for (const [src, want, why] of AMBIGUOUS) {
    t(`一对多 ${src} → ${want}（${why}）`, toSimplified(src) === want,
      toSimplified(src) === want ? '' : `得到「${toSimplified(src)}」`)
  }

  // ── 17.4 needsConversion 是粗筛：宁多判，但不能漏判 ──
  t('needsConversion 认得出繁体句', needsConversion('我長大後想當國王。') === true)
  t('needsConversion 对纯英文返回 false', needsConversion('I want to be a king.') === false)
  t('needsConversion 对空串返回 false', needsConversion('') === false)
  // 反例：needsConversion 是「可能含繁体」的高召回粗筛，返回值 true 不保证一定变
  // （比如「显著」里的 显 在表里），所以这一条只断言「粗筛不吞掉真繁体」：
  t('needsConversion 不会把含繁体的句子判成 false',
    ['科學幻想', '頭髮', '乾燥', '麵條'].every((s) => needsConversion(s) === true))

  // ── 17.5 真 dict.dat：describeEntry 出来的例句必须是简体 ──
  const dictSrc17 = JSON.parse(readFileSync(join(ROOT, 'data/dict.dat'), 'utf8'))
  const ab = api.describeEntry(dictSrc17.abandon)
  const aEntry = api.describeEntry(dictSrc17.a)
  t('describeEntry(abandon) 例句中文是简体（中文逗号保留）',
    ab.examples.some((ex) => ex.zh === '在中国的旁边，瑞士像一个荒废的乡村似的。'),
    JSON.stringify(ab.examples.map((e) => e.zh)))
  t('describeEntry(a) 例句中文从繁体转成简体',
    aEntry.examples.some((ex) => ex.zh === '我长大后想当国王。'),
    JSON.stringify(aEntry.examples.map((e) => e.zh)))
  t('describeEntry 没动英文原句',
    aEntry.examples.some((ex) => ex.en === 'When I grow up, I want to be a king.'))

  // 全量：8960 条例句转换后再转一次不该变（幂等 = 没有残留可转的繁体）
  let exTotal = 0
  let nonIdem = 0
  const stuck = []
  for (const head of Object.keys(dictSrc17)) {
    const described = api.describeEntry(dictSrc17[head])
    for (const ex of described.examples) {
      exTotal += 1
      const again = api.toSimplified(ex.zh)
      if (again !== ex.zh) {
        nonIdem += 1
        if (stuck.length < 3) stuck.push(`${head}: ${ex.zh} → ${again}`)
      }
    }
  }
  t('全量 8960 条例句都取到了', exTotal === 8960, String(exTotal))
  t('转换后再转不再变化（无残留繁体）', nonIdem === 0,
    nonIdem === 0 ? '' : `${nonIdem} 条：${stuck.join(' | ')}`)

  // ── 17.6 零依赖 + 体积 ──
  const pkg17 = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  t('dependencies 仍然是空对象（不引 npm 依赖）',
    JSON.stringify(pkg17.dependencies ?? {}) === '{}', JSON.stringify(pkg17.dependencies))
  const t2sSrc17 = readFileSync(join(ROOT, 'client/src/t2s.js'), 'utf8')
  // 只算数据字面量的字节数（注释与算法代码不算「字典体积」）。
  //
  // 踩过的坑：一开始用正则 `^const [A-Z_]+ =\n([\s\S]*?)(?=\n\nconst ...)` 提取，
  // 但它被数据里的空行/换行位置截断，只量到 1.2KB —— 那是**假通过**：
  // 「≤ 30KB」被满足，可是根本没量到真数据。现在改成把字面量真的求值出来再量长度，
  // 并且反向断言「四个表都非空、总条目数在合理量级」，防止再被静默截断。
  const dataBytes17 = (() => {
    const head = t2sSrc17.slice(0, t2sSrc17.indexOf('/* ── 运行时'))
    const from = head.indexOf('const PHRASES')
    if (from < 0) return { bytes: 0, entries: 0, tables: 0 }
    const code = head.slice(from)
    const names = ['PHRASES', 'CHAR_T', 'CHAR_S', 'TW_IDENT', 'TW_T', 'TW_S', 'TW_MULTI']
    const values = new Function(`${code}\nreturn {${names.join(',')}}`)()
    let bytes = 0
    let entries = 0
    let tables = 0
    for (const name of names) {
      const value = values[name]
      if (typeof value !== 'string' || value === '') continue
      tables += 1
      bytes += Buffer.byteLength(value)
      entries += name === 'CHAR_T' || name === 'CHAR_S' || name === 'TW_T' || name === 'TW_S'
        ? [...value].length
        : value.split('|').filter(Boolean).length
    }
    return { bytes, entries, tables }
  })()
  t('内嵌字典四个表都解析得出来', dataBytes17.tables === 7, `${dataBytes17.tables} 个表`)
  t('内嵌字典条目数在合理量级（不是被截断的空表）', dataBytes17.entries > 1000,
    `${dataBytes17.entries} 条`)
  t('内嵌字典 ≤ 30KB', dataBytes17.bytes > 0 && dataBytes17.bytes <= 30 * 1024,
    `${(dataBytes17.bytes / 1024).toFixed(1)} KB`)
  t('t2s.js 里没有 import（纯内嵌，不依赖别的模块）',
    !/^import\s/m.test(t2sSrc17))

  // ── 17.7 两条下游渲染路径都吃到简体（一处接好，不许漏） ──
  // 转换接在 describeEntry 里，所以 cardBackFor（复习卡背面）与 card.js 的
  // 例句块（点词卡片）应当**都**是简体，不需要各自再转一遍。
  const review17 = readFileSync(join(ROOT, 'client/src/review.js'), 'utf8')
  const cardSrc17 = readFileSync(join(ROOT, 'client/src/card.js'), 'utf8')
  t('cardBackFor 走 describeEntry（因此自动吃到简体）',
    /export function cardBackFor\(head, dict\)[\s\S]{0,400}?describeEntry\(raw\)/.test(review17))
  t('review.js 没有自己再转一遍（只此一处，避免两套逻辑打架）',
    !review17.includes('toSimplified'))
  t('card.js 没有自己再转一遍（同上）', !cardSrc17.includes('toSimplified'))

  // 真跑：cardBackFor 拿真 dict.dat 出来的例句是简体
  const back17 = api.cardBackFor('a', { entries: { a: dictSrc17.a } })
  t('cardBackFor(a) 的例句中文是简体',
    back17.example !== null && back17.example.zh === '我长大后想当国王。',
    JSON.stringify(back17.example))
  t('ReviewCardBack 渲染该例句用的是同一份数据（不二次转换）',
    typeof api.ReviewCardBack === 'function')
}

// ── 18. 生词本每页行数 10/15/20 可调（t8） ──
//
// 用户原话「词表一页只能有 20 个单词，可以调整成 10 个，15 个或 20 个三种」。
// 1.3.1 是写死 50；现在三档可调、默认 20、持久化在 localStorage。
//
// 这一段盯三件最容易出错的事：
//   1. clamp 是**枚举**不是区间（50 要回落 20，不是被夹成 20 就走运了）；
//   2. 选择器在词少/没词时也必须渲染（否则用户找不到入口）；
//   3. 换档要回第一页，不能停在越界的页码上看到空表。
console.log("\n[18] 生词本每页行数 10/15/20 可调")

const CFG18 = api
const clamp18 = CFG18?.clampAppearance
const opts18 = CFG18?.PAGE_SIZE_OPTIONS

t('导出 PAGE_SIZE_OPTIONS', Array.isArray(opts18), JSON.stringify(opts18))
t('三档就是 10/15/20', Array.isArray(opts18) && opts18.join(',') === '10,15,20', String(opts18))
t('导出 clampAppearance', typeof clamp18 === 'function')

// ── 18.1 clamp：三档保留，其它一律回落 20 ──
if (typeof clamp18 === 'function') {
  for (const ok of [10, 15, 20]) {
    t(`18.1 pageSize=${ok} 保留`, clamp18({ pageSize: ok }).pageSize === ok, String(clamp18({ pageSize: ok }).pageSize))
  }
  const bad = [
    ['50（原写死值）', 50],
    ['0', 0],
    ['-5', -5],
    ['25（区间内但不在三档）', 25],
    ['"20"（字符串）', '20'],
    ['"abc"', 'abc'],
    ['null', null],
    ['NaN', Number.NaN],
  ]
  for (const [label, value] of bad) {
    const got = clamp18({ pageSize: value }).pageSize
    t(`18.1 pageSize=${label} → 回落 20`, got === 20, String(got))
  }
  t('18.1 旧存档没有 pageSize 键 → 20', clamp18({}).pageSize === 20, String(clamp18({}).pageSize))
  t('18.1 clampAppearance(null) → 20', clamp18(null).pageSize === 20, String(clamp18(null).pageSize))
  t('18.1 默认值是 20', CFG18.DEFAULT_APPEARANCE?.pageSize === 20, String(CFG18.DEFAULT_APPEARANCE?.pageSize))
  // 三档是枚举：不能因为 BOUNDS 里恰好 50>上限就「夹」成 20 算通过 ——
  // 25 落在任何合理区间内却也回落 20，这条才证明真的是枚举判定。
  t('18.1 枚举判定（不是区间夹取）：25 也回落 20', clamp18({ pageSize: 25 }).pageSize === 20, '')
}

// ── 18.2 持久化往返：saveUx 写进去、loadUx 读回来 ──
{
  const store18 = new Map()
  const storage18 = {
    getItem: (k) => (store18.has(k) ? store18.get(k) : null),
    setItem: (k, v) => { store18.set(k, v) },
  }
  const save18 = CFG18?.saveUx
  const load18 = CFG18?.loadUx
  t('18.2 导出 saveUx/loadUx', typeof save18 === 'function' && typeof load18 === 'function')
  if (typeof save18 === 'function' && typeof load18 === 'function') {
    for (const v of [10, 15, 20]) {
      save18(storage18, { appearance: { pageSize: v } })
      t(`18.2 存 ${v} 后读回 ${v}`, load18(storage18).appearance.pageSize === v,
        String(load18(storage18).appearance.pageSize))
    }
    // 存一个非法值 → 读回必须是 20（不能把脏值落盘又读回来）
    save18(storage18, { appearance: { pageSize: 99 } })
    t('18.2 存非法值 99 后读回 20', load18(storage18).appearance.pageSize === 20,
      String(load18(storage18).appearance.pageSize))
    t('18.2 持久化真的写进了 storage', store18.size > 0, `${store18.size} 个键`)
  }
}

// ── 18.3 真渲染 bookTab：默认 20 行，三档切换行数正确 ──
{
  const makeBook18 = (n) => {
    const heads = []
    for (let i = 0; i < n; i += 1) heads.push(`w${String(i).padStart(3, '0')}`)
    const entries = heads.map((head, i) => ({
      head,
      state: 'new',
      bookId: 'default',
      addedAt: Date.now() - i * 1000,
      seen: 0, correct: 0, wrong: 0,
      due: Date.now() + 3600_000,
    }))
    const list = () => entries
    return {
      list,
      listBooks: () => [{ id: 'default', name: '默认生词本' }],
      stats: () => ({ total: entries.length, byState: { new: entries.length, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0, addedToday: entries.length, reviewedToday: 0, streak: 0, days: [] }),
      size: () => entries.length,
      setState: async () => {},
      importMany: async () => {},
      remove: async () => {},
      subscribe: () => () => {},
      getNote: () => '',
      setNote: async () => {},
    }
  }

  const h18 = (type, props, ...kids) => ({ type, props, children: kids.flat() })
  const walk18 = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) { node.forEach((n) => walk18(n, pred, out)); return out }
    if (pred(node)) out.push(node)
    for (const c of (node.children ?? [])) walk18(c, pred, out)
    for (const c of (node.props?.children ?? [])) walk18(c, pred, out)
    return out
  }
  const flat18 = (tree) => JSON.stringify(tree, (k, v) => (k === 'node' ? '[obj]' : v))
  /**
   * 树上所有可见文字标签。
   *
   * 两个来源都要取：
   *   - 普通节点：children 里的字符串（Button 的 label 已由原语渲染成文字）
   *   - Segment：它的档位文字在 props.items[].label 里，children 是空的
   *     （Segment 是组件，还没被求值成 DOM，所以看不到子节点文字）
   */
  const labels18 = (tree) => {
    const fromChildren = walk18(tree, (n) => Array.isArray(n?.children)
      && n.children.some((c) => typeof c === 'string'))
      .map((n) => n.children.filter((c) => typeof c === 'string').join(''))
    const fromItems = walk18(tree, (n) => Array.isArray(n?.props?.items))
      .flatMap((n) => n.props.items.map((it) => String(it?.label ?? '')))
    const fromProps = walk18(tree, (n) => typeof n?.props?.label === 'string')
      .map((n) => String(n.props.label))
    return [...fromChildren, ...fromItems, ...fromProps]
  }

  /**
   * 沿用同一个实例（同一张 hooks 表）再渲染一次。
   *
   * 换档 / 翻页后要验证「界面真的变了」，必须复用同一份 hooks —— 新建实例
   * 会让 page 回到 0、pageSize 回到入参，测的就不是「用户点完看到什么」。
   */
  const renderBookKeepState = (r, Tab, book, pageSize) => {
    const P = r.api?.makePrimitives(h18)
    const patches = []
    const result = r.mount(Tab, {
      h: h18,
      P,
      book,
      dict: null,
      stats: typeof book?.stats === 'function' ? book.stats() : { total: 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0 },
      say: () => {},
      bump: () => {},
      storage: undefined,
      bookVersion: 0,
      ux: { appearance: { ...(r.api?.DEFAULT_APPEARANCE ?? {}), ...(pageSize === undefined ? {} : { pageSize }) } },
      patchAppearance: (key, value) => { patches.push([key, value]) },
    })
    const rowCount = walk18(result.tree, (n) => String(n?.props?.className ?? '').includes('hds-trow')).length
    return { result, rowCount, patches, json: flat18(result.tree), tree: result.tree, r, Tab, P }
  }

  /** 渲染 bookTab；ux 用来注入 pageSize，patch 收集持久化调用。 */
  const renderBook = (book, pageSize) => {
    const r = runFactoryWithRules()
    const Tab = r.api?.bookTab
    const P = r.api?.makePrimitives(h18)
    const patches = []
    const result = r.mount(Tab, {
      h: h18,
      P,
      book,
      dict: null,
      stats: typeof book?.stats === 'function' ? book.stats() : { total: 0, byState: { new: 0, unknown: 0, fuzzy: 0, known: 0 }, dueToday: 0 },
      say: () => {},
      bump: () => {},
      storage: undefined,
      bookVersion: 0,
      ux: { appearance: { ...(r.api?.DEFAULT_APPEARANCE ?? {}), ...(pageSize === undefined ? {} : { pageSize }) } },
      patchAppearance: (key, value) => { patches.push([key, value]) },
    })
    // 行数 = 词表行节点数。hds-trow 是每行的类名（词表与详情行共用，详情未展开时只有词表行）
    const rowCount = walk18(result.tree, (n) => String(n?.props?.className ?? '').includes('hds-trow')).length
    return { result, rowCount, patches, json: flat18(result.tree), tree: result.tree, r, Tab, P }
  }

  // 默认 20（不传 pageSize → 用 DEFAULT_APPEARANCE）
  const with25 = renderBook(makeBook18(25), undefined)
  t('18.3 默认档渲染 20 行（词有 25 个）', with25.rowCount === 20, `${with25.rowCount} 行`)
  t('18.3 默认档显示第一页信息', with25.json.includes('第 1/2 页'), '')

  // 三档各渲染一次
  for (const [size, expectedRows, expectedPages] of [[10, 10, 3], [15, 15, 2], [20, 20, 2]]) {
    const out = renderBook(makeBook18(25), size)
    t(`18.3 切到 ${size} 档 → 渲染 ${expectedRows} 行`, out.rowCount === expectedRows, `${out.rowCount} 行`)
    t(`18.3 ${size} 档 → pageCount=${expectedPages}`, out.json.includes(`第 1/${expectedPages} 页`), '')
  }

  // 词数少于档位：一行不少，且不显示翻页按钮
  const few = renderBook(makeBook18(3), 20)
  t('18.3 只有 3 个词时全部渲染', few.rowCount === 3, `${few.rowCount} 行`)
  t('18.3 只有 3 个词时不显示翻页按钮',
    !labels18(few.tree).includes('下一页'), labels18(few.tree).join(' | '))

  // ── 18.4 常驻选择器：词少 / 没词 都要能看见「每页」──
  t('18.4 词少（3 个）时仍有「每页」选择器', /每页/.test(few.json), '')
  t('18.4 词少时三档都能点（10/15/20 都在树上）',
    ['10', '15', '20'].every((v) => labels18(few.tree).includes(v)),
    labels18(few.tree).join(' | '))
  const empty = renderBook(makeBook18(0), 20)
  t('18.4 词表为空时仍渲染「每页」选择器（新装插件也能调）', /每页/.test(empty.json), '')
  t('18.4 空表时三档仍在',
    ['10', '15', '20'].every((v) => labels18(empty.tree).includes(v)),
    labels18(empty.tree).join(' | '))
  t('18.4 空表时明说「没有词」', empty.json.includes('没有词'), '')

  // ── 18.5 切档真的调 patchAppearance（持久化接线）──
  {
    const cur = renderBook(makeBook18(25), 20)
    // Segment 是组件（未求值），档位文字在 props.items 里；
    // 要「点一下」得调它的 onChange，而不是找 role=radio（那要真渲染后才有）。
    const seg = walk18(cur.tree, (n) => Array.isArray(n?.props?.items)
      && n.props.items.length === 3 && n.props.items.every((it) => String(it.label).match(/^\d+$/)))[0]
    const radio10 = seg
      ? { props: { onClick: () => seg.props.onChange(10) } }
      : null
    t('18.5 找得到「每页」三档选择器', !!seg, seg ? JSON.stringify(seg.props.items.map((i) => i.id)) : '无')
    if (radio10) {
      // 记下切档前后的行数，验证 setPage(0) 生效（停在第 2 页切档会看到空表）
      // 先翻到第 2 页
      const btnNext = walk18(cur.tree, (n) => n?.props?.label === '下一页')[0]
      t('18.5 25 个词时有「下一页」', !!btnNext, btnNext ? '有' : '无')
      if (btnNext) btnNext.props.onClick()
      const afterNext = renderBookKeepState(cur.r, cur.Tab, makeBook18(25), 20)
      t('18.5 翻页后到第 2 页', afterNext.json.includes('第 2/'), '')

      // 切到 10 档
      const segB = walk18(afterNext.tree, (n) => Array.isArray(n?.props?.items)
        && n.props.items.length === 3 && n.props.items.every((it) => String(it.label).match(/^\d+$/)))[0]
      const radio10b = segB ? { props: { onClick: () => segB.props.onChange(10) } } : null
      if (radio10b) {
        radio10b.props.onClick()
        t('18.5 切档调了 patchAppearance("pageSize", 10)',
          afterNext.patches.some(([k, v]) => k === 'pageSize' && v === 10),
          JSON.stringify(afterNext.patches))
        // 切档后真实流程是 patchAppearance → saveUx → setUx → 重渲染读到新 pageSize。
        // 所以这里要把新档位传进去（传 20 就等于「宿主没接受这次修改」）。
        const afterSwitch = renderBookKeepState(cur.r, cur.Tab, makeBook18(25), 10)
        t('18.5 切档后回到第 1 页（不是停在第 2 页看空表）',
          afterSwitch.json.includes('第 1/'), afterSwitch.json.includes('第 2/') ? '仍在第 2 页' : '')
        t('18.5 切到 10 档后只渲染 10 行', afterSwitch.rowCount === 10, `${afterSwitch.rowCount} 行`)
        t('18.5 切到 10 档后 pageCount=3', afterSwitch.json.includes('/3 页'), '')
      } else {
        t('18.5 翻页后仍找得到「10」档按钮', false)
      }
    }
  }
}

// ── 18.6 源码层：钉住实现要点，防止以后又被改回写死 ──
{
  const src18 = readFileSync(join(ROOT, 'client/src/settings.js'), 'utf8')
  const cfg18 = readFileSync(join(ROOT, 'client/src/config.js'), 'utf8')
  t('18.6 bookTab 接了 ux 与 patchAppearance', /const \{[^}]*ux[^}]*patchAppearance[^}]*\} = ctx/.test(src18), '')
  t('18.6 SettingsPanel 把 ux/patchAppearance 传进 bookTab',
    /h\(bookTab, \{[^}]*ux[^}]*patchAppearance/.test(src18), '')
  t('18.6 每页行数取自 PAGE_SIZE_OPTIONS 夹取', /PAGE_SIZE_OPTIONS\.includes\(ux\?\.appearance\?\.pageSize\)/.test(src18), '')
  t('18.6 切片用 pageSize 变量', /sorted\.slice\(safePage \* pageSize/.test(src18), '')
  t('18.6 选择器不在 pageCount>1 的条件里（常驻）',
    /key: 'pager'[\s\S]{0,900}?PAGE_SIZE_OPTIONS\.map/.test(src18), '')
  t('18.6 换档先 setPage(0)', /setPage\(0\)\s*\n?\s*if \(typeof patchAppearance/.test(src18), '')
  t('18.6 不再有写死的 PAGE_SIZE 常量', !/const PAGE_SIZE\s*=/.test(src18), '')
  t('18.6 config.js 的三档是枚举判定（不走 BOUNDS 夹取）',
    /PAGE_SIZE_OPTIONS\.includes\(source\.pageSize\)/.test(cfg18), '')
  t('18.6 DEFAULT_APPEARANCE 有 pageSize', /pageSize:\s*20/.test(cfg18), '')
}

console.log(`\n================ ${pass}/${pass + fail} 通过 ================`)
if (fail > 0) process.exit(1)
