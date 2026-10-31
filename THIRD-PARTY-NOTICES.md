# 第三方数据来源

本插件分发**词库数据**，不包含任何第三方代码。数据来源如下。

## ECDICT

- 用途：词条、词性、中文释义、英英释义、考纲标签、柯林斯星级、词形变化
- 来源：https://github.com/skywind3000/ECDICT
- 许可证：MIT
- 本项目从中筛选出约 2 万条考纲核心词，做了格式转换与裁剪

ECDICT 收词约 76 万条，本项目只保留带考纲标签（中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE）
或属高频、柯林斯星级、牛津 3000 的词。

## Tatoeba

- 用途：双语例句
- 来源：https://tatoeba.org/
- 许可证：CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/）
- 本项目取其中英句对约 7.8 万组，按词匹配挑出约 9 千条词的例句

Tatoeba 是众包例句库，句子由志愿者贡献。

---

两处数据均允许再分发，条件是保留署名。这份文件就是署名。

要重新生成词库，见 [`scripts/build-data.mjs`](scripts/build-data.mjs)。
