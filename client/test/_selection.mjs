import { classifySelection, hanRatio, isTranslatable } from '../src/selection.js'

let pass=0, fail=0
const t=(name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok?'PASS':'FAIL'}  ${name.padEnd(44)} -> ${JSON.stringify(got)}${ok?'':`  want ${JSON.stringify(want)}`}`)
}

console.log('— 单词 —')
t('hello', classifySelection('hello')?.kind, 'word')
t('Hello', classifySelection('Hello')?.kind, 'word')
t("don't", classifySelection("don't")?.kind, 'word')
t('well-known', classifySelection('well-known')?.kind, 'word')
t('utf8', classifySelection('utf8')?.kind, 'word')
t('单个中文 "你好"', classifySelection('你好'), null)

console.log('\n— 纯英文句子：要翻译 —')
t('普通英文句', classifySelection('The quick brown fox jumps over the lazy dog.')?.kind, 'phrase')
t('带 8% 中文的英文', classifySelection('This is a test 测试 of the system')?.kind, 'phrase')
t('代码片段', classifySelection('const result = await fetch(url)')?.kind, 'phrase')

console.log('\n— 中英混排：不翻译（用户要求）—')
const skip = (x) => classifySelection(x)?.kind ?? null
t('中英各半 → skip', skip('这个 tokenizers 的分词是什么意思'), 'skip')
t('中文为主 → skip', skip('我觉得这个 approach 不太行，需要换个思路'), 'skip')
t('纯中文 → null', skip('今天天气不错'), null)
t('整段对话带英文 → skip', skip('好的，我这就去改。The plugin registers a lazy factory whose id equals the package name. 然后重启就行。'), 'skip')
t('skip 带原因', classifySelection('这个 tokenizers 的分词')?.reason, 'mixed-language')

console.log('\n— hanRatio —')
t('纯英文 = 0', hanRatio('Hello world'), 0)
t('纯中文 = 1', hanRatio('你好世界'), 1)
t('空串 = 1', hanRatio(''), 1)
t('各半 = 0.5', hanRatio('ab中文'), 0.5)

console.log('\n— isTranslatable —')
t('纯英文 true', isTranslatable('Hello world'), true)
t('混排 false', isTranslatable('你好 hello world'), false)
t('无字母 false', isTranslatable('12345'), false)

console.log(`\n${pass}/${pass+fail} passed`)
