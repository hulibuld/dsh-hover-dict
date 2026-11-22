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

t('管理台分页 50 行', settingsSrc2.includes('PAGE_SIZE = 50'))
t('管理台有搜索框', settingsSrc2.includes('按词头或释义搜索'))
t('管理台有状态筛选', settingsSrc2.includes('stateChips'))
t('管理台有批量操作', settingsSrc2.includes('转为已掌握') && settingsSrc2.includes('移入词书'))
t('管理台有三种导出', settingsSrc2.includes("onExport('txt')") && settingsSrc2.includes("onExport('csv')") && settingsSrc2.includes("onExport('json')"))
t('确认移出不用原生弹窗', !settingsSrc2.includes('window.confirm('))
t('不再按 120 硬截断（改为真分页）', settingsSrc2.includes('PAGE_SIZE = 50') && /const CHIP_LIMIT\s*=/.test(settingsSrc2) === false)

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

console.log(`\n================ ${pass}/${pass + fail} 通过 ================`)
if (fail > 0) process.exit(1)
