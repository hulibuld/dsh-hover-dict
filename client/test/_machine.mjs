import { createHoverMachine } from '../src/app.js'
let pass=0,fail=0
const t=(n,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);ok?pass++:fail++;console.log(`${ok?'PASS':'FAIL'}  ${n} -> ${JSON.stringify(got)}${ok?'':` want ${JSON.stringify(want)}`}`)}

const m=createHoverMachine({onChange:()=>{}})
t('初始 idle', m.getState(), 'idle')
m.feed({kind:'select'})
t('选中 → shown', m.getState(), 'shown')
m.feed({kind:'select'})
t('再选中仍 shown', m.getState(), 'shown')
m.feed({kind:'dismiss'})
t('关闭 → idle', m.getState(), 'idle')
m.feed({kind:'dismiss'})
t('重复关闭仍是 idle', m.getState(), 'idle')
m.feed({kind:'nonsense'})
t('未知事件忽略', m.getState(), 'idle')
// 旧版悬停事件全部无效
m.feed({kind:'select'})
for (const ev of [{kind:'pointermove'},{kind:'popoverleave'},{kind:'blur'},{kind:'scroll'},{kind:'stream'}]) m.feed(ev)
t('悬停类事件不再生效（结果不消失）', m.getState(), 'shown')
m.dispose()
m.feed({kind:'dismiss'})
t('dispose 后 status 冻结', m.getState(), 'shown')
console.log(`\n${pass}/${pass+fail} passed`)
