// 区域判定测试：模拟 DOM 祖先链，验证哪些位置会触发查词
import { SELECTORS } from '../src/hit.js'

// 复刻 app.js 的判定逻辑（保持同步）
const inChatRegion = (node) => {
  if (!node || typeof node.closest !== 'function') return false
  return node.closest(SELECTORS.chatRegion) !== null
}
const MARKERS = [
  SELECTORS.composerRegion, '[data-composer-seat]', '[data-composer-stat]',
  '[data-composer-height]', 'form', 'textarea', 'input',
  '[contenteditable="true"]', '[contenteditable=""]', '[role="textbox"]',
]
const inComposer = (node) => {
  if (!node || typeof node.closest !== 'function') return false
  return MARKERS.some((sel) => node.closest(sel) !== null)
}
/** 完整判定：能不能在这个节点上查词 */
const shouldLookup = (node) => inChatRegion(node) && !inComposer(node)

function node(map) {
  return { closest: (sel) => (map[sel] !== undefined ? map[sel] : null) }
}

const CHAT = SELECTORS.chatRegion   // [data-conversation-region="chat"]
const COMP = SELECTORS.composerRegion

let pass=0, fail=0
const t=(name, got, want) => {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(38)} -> ${got}  ${ok?'':`want ${want}`}`)
}

// 对话正文里的字
t('正文字', shouldLookup(node({[CHAT]: {}})), true)
// 输入框里的字
t('输入框（composer 区域）', shouldLookup(node({[CHAT]: {}, [COMP]: {}})), false)
// 模型选择器（在 composer 子树里，且有 data-composer-stat）
t('模型选择器（composer-stat）', shouldLookup(node({[CHAT]: {}, '[data-composer-stat]': {}})), false)
// 右下角按钮（在 form 里）
t('发送按钮（form 内）', shouldLookup(node({[CHAT]: {}, form: {}})), false)
// 可编辑区
t('contenteditable', shouldLookup(node({[CHAT]: {}, '[contenteditable="true"]': {}})), false)
// textarea
t('textarea', shouldLookup(node({[CHAT]: {}, textarea: {}})), false)
// 完全不在对话区（侧栏）
t('侧栏（无 chat 标记）', shouldLookup(node({})), false)
// null
t('null 节点', shouldLookup(null), false)
// 无 closest 方法
t('无 closest 的对象', shouldLookup({}), false)

console.log(`\n${pass}/${pass+fail} passed`)
