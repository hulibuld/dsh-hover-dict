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

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUTPUT = readFileSync(join(ROOT, 'client.js'), 'utf8')

let pass = 0
let fail = 0
const t = (name, ok, detail) => {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —— ${detail}` : ''}`)
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
  const { react } = makeReact()
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
  return { api, doc }
}

console.log('\n[1] 产物装载')

const { api, doc } = runFactory()
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
t('注册了 shell.overlay 与 settings 两个 slot', registerCalls.length === 2, `${registerCalls.length} 次`)
t('第一个是 shell.overlay', registerCalls[0]?.options?.name === 'shell.overlay',
  registerCalls[0]?.options?.name)
t('第二个是 plugins.bundle.config', registerCalls[1]?.options?.name === 'plugins.bundle.config',
  registerCalls[1]?.options?.name)
t('注册带 id（宿主必需）', typeof registerCalls[0]?.options?.id === 'string',
  registerCalls[0]?.options?.id)
t('注册只用了宿主登记的字段',
  Object.keys(registerCalls[0]?.options ?? {}).every((k) => ['name', 'id', 'order', 'label', 'locale', 'inject'].includes(k)),
  Object.keys(registerCalls[0]?.options ?? {}).join(','))
t('inject 请求了两个 slot', injectCalls.length === 2
  && injectCalls.includes('shell.overlay')
  && injectCalls.includes('plugins.bundle.config'), JSON.stringify(injectCalls))
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

console.log(`\n================ ${pass}/${pass + fail} 通过 ================`)
if (fail > 0) process.exit(1)
