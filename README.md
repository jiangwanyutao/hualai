# hualai（话来）

Claude Code 提示词增强 skill：先只读探查当前项目（技术栈、相关文件），再把随手写的草稿改写成清晰、具体、可执行的提示词。只输出改写结果，不执行任务、不改文件。

## 安装

```bash
git clone https://github.com/jiangwanyutao/hualai ~/.claude/skills/hualai
```

重启 Claude Code 后输入 `/hualai` 即可使用。

## 用法

```text
/hualai 改下登录页的登录按钮，颜色太淡了
/hualai --creative 做一个番茄钟网页
/hualai --grep 优化下模型推理接口的超时处理
/hualai --no-scan 帮我写个周报
```

| 参数 | 作用 |
|---|---|
| （默认） | 简洁模式，约 800 字 + 项目上下文 |
| `--creative` | 创意模式，充分展开需求、边界与验收标准 |
| （默认扫描 auto） | 有 [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) 索引就用它，否则退回 Grep |
| `--grep` | 强制用 Grep / Glob / Read 查项目 |
| `--no-scan` | 不查项目，纯改写，最快 |

## 输出示例

草稿：`改下登录页的登录按钮，颜色太淡了`

```text
把登录页「登录」按钮颜色调深，更醒目。

项目上下文：
- 前端 web/（Vue 3 + TypeScript + Element Plus）
- 按钮：src/views/login/LoginForm.vue:106，class 为 login-btn
- 颜色实际来自全局 src/styles/login.scss:311 的 !important 渐变
- login-btn 还用于 MobileLogin.vue:36，改全局样式会一起生效

要求：
1. 先确认"淡"的原因再改……
```

## 设计要点

- 探查只用只读工具（Read / Glob / Grep / codegraph），约 10 次调用内结束。
- 只引用真实看到的路径；"没用到 / 不受影响"这类否定结论必须有 Grep 结果，否则标注「未确认」。
- 保持草稿原语言、原意图、原任务阶段；代码、路径、报错原文逐字保留。

## 致谢

改写模板移植自 [zcode-plus](https://github.com/Llliao1113/zcode-plus)（MIT），在其基础上增加了项目探查与扫描方式选项。
