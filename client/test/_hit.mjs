import { isEligibleTarget, caretAt, isProgrammaticScroll, SELECTORS, HIT_BLOCKERS } from '../src/hit.js'

// 极简假 DOM：closest 按选择器映射返回祖先或 null
function fakeEl(map) {
  return { closest: (sel) => (map[sel] !== undefined ? map[sel] : null) }
}
let pass=0, fail=0
const t=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${name} -> ${JSON.stringify(got)}${ok?'':` want ${JSON.stringify(want)}`}`)}

// 正常助手正文
t('assistant body', isEligibleTarget(fakeEl({'[data-chat-flow-kind="assistant-step"]':{}})), {ok:true,reason:'ok'})
// 不在助手节点里
t('outside', isEligibleTarget(fakeEl({})), {ok:false,reason:'outside'})
// null
t('no-target', isEligibleTarget(null), {ok:false,reason:'no-target'})
// 禁用
t('disabled', isEligibleTarget(fakeEl({'[data-chat-flow-kind="assistant-step"]':{}}), {enabled:false}), {ok:false,reason:'disabled'})
// 代码块
t('code blocked', isEligibleTarget(fakeEl({'[data-chat-flow-kind="assistant-step"]':{},'pre, code, [data-code-block-content]':{}})), {ok:false,reason:'code'})
// 链接
t('link blocked', isEligibleTarget(fakeEl({'[data-chat-flow-kind="assistant-step"]':{},'a[href]':{}})), {ok:false,reason:'link'})
// 自己的覆盖层
t('self blocked', isEligibleTarget(fakeEl({'[data-chat-flow-kind="assistant-step"]':{},'[data-hover-dict-ui]':{}})), {ok:false,reason:'self'})

// 滚动判定
t('programmatic scroll (down, no pointer)', isProgrammaticScroll({lastScrollTop:100,nextScrollTop:140,sinceUserPointerMs:2000}), true)
t('user scroll (recent pointer)', isProgrammaticScroll({lastScrollTop:100,nextScrollTop:140,sinceUserPointerMs:50}), false)
t('scroll up is user', isProgrammaticScroll({lastScrollTop:140,nextScrollTop:100,sinceUserPointerMs:2000}), false)

// caretAt 无 API 时降级
t('caretAt no api', caretAt({}, 10, 10), null)
t('caretAt returns text node', (()=>{ const node={nodeType:3}; const d={caretRangeFromPoint:()=>({startContainer:node,startOffset:3})}; return caretAt(d,1,1); })(), {node:{nodeType:3},offset:3})
t('caretAt on element returns null', caretAt({caretRangeFromPoint:()=>({startContainer:{nodeType:1},startOffset:0})},1,1), null)

console.log(`\nSELECTORS keys: ${Object.keys(SELECTORS).length}, BLOCKERS: ${HIT_BLOCKERS.length}`)
console.log(`${pass}/${pass+fail} passed`)
