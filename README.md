<h2 align="center">hualai（话来）：会看项目的 Claude Code 提示词增强插件</h2>

<p align="center">
  <a href="./README_en.md">English</a> | <b>中文</b>
</p>

<p align="center">
  <a href="https://github.com/jiangwanyutao/hualai"><img src="https://img.shields.io/badge/Project%20Page-GitHub-blue" alt="Project Page"></a>
  <a href="https://docs.claude.com/en/docs/claude-code/skills"><img src="https://img.shields.io/badge/Claude%20Code-Skill-D97757" alt="Claude Code Skill"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  <a href="https://github.com/jiangwanyutao/hualai/stargazers"><img src="https://img.shields.io/github/stars/jiangwanyutao/hualai?style=flat" alt="Stars"></a>
</p>

hualai 是一个 **Claude Code 插件**：你随手写一句草稿，它先**只读探查当前项目**（技术栈、相关文件、全局样式覆盖、共用引用），再把草稿改写成**清晰、具体、可执行**的提示词。它只输出改写结果，不执行任务、不改文件，确认无误后再由你发送。

名字取自「话来」——就像「牛来」一样，一句话招来一个好提示词。

### ✨ 核心特性

- 🔍 **项目感知** — 自动识别技术栈，定位草稿提到的页面、组件、接口，把真实文件路径和行号写进提示词
- 🧭 **索引加速** — 项目有 [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) 索引时优先使用，没有则退回 Grep，也可手动指定
- ⚡ **清楚草稿跳过探查** — 草稿已写明文件与改动、或与代码无关（如写周报）时直接改写，约 12 秒
- 🛡️ **防编造** — 只引用真实看到的路径；「没用到 / 不受影响」这类否定结论必须有 Grep 结果，否则标注「未确认」
- 📖 **术语补全** — 草稿里的团队黑话、内部模块名，用探查结果补一行定义；查不到标注「需确认含义」
- ✂️ **多目标拆分** — 一句话混了几个目标时，拆成带各自完成标准的编号子任务，逐个完成验证
- 🎨 **两种风格** — 简洁模式（约 800 字）适合日常；创意模式充分展开需求、边界与验收标准
- 🌐 **保持原语言** — 中文草稿输出中文，代码、路径、报错原文逐字保留
- 🤖 **自动增强（可选）** — 发 `hualai on` 后，每条消息先经 hualai 改写再执行，不用再手敲命令；默认关闭

### 最新动态

* **[2026.09]** 💰 省额度：手动调用沿用会话模型并复用本会话已查过的结论；自动增强改用 Sonnet，并带上最近的对话作背景
* **[2026.09]** 🔥 改为 Claude Code 插件，新增自动增强开关（`hualai on` / `hualai off`，默认关）
* **[2026.09]** 🔥 清楚的草稿自动跳过项目探查，纯改写场景提速约 3 倍
* **[2026.09]** 🎉 新增术语定义补全与多目标拆分规则
* **[2026.09]** 🎉 首次发布：项目探查 + codegraph 索引 + 三种扫描方式

---

## 目录

- [快速开始](#-快速开始)
  - [安装](#安装)
  - [升级](#升级)
  - [使用](#使用)
  - [自动增强](#自动增强)
- [参数说明](#%EF%B8%8F-参数说明)
- [工作原理](#-工作原理)
- [实测数据](#-实测数据)
- [相关项目](#-相关项目)
- [局限性](#%EF%B8%8F-局限性)
- [许可证](#-许可证)
- [致谢](#-致谢)

---

## 🚀 快速开始

### 安装

**让 Claude 帮你装（推荐，连 codegraph 依赖一起装好）**，在 Claude Code 里发一句：

```text
安装 hualai，按 https://raw.githubusercontent.com/jiangwanyutao/hualai/main/AGENTS.md 操作
```

**手动装（Claude Code 插件）：**

```bash
claude plugin marketplace add jiangwanyutao/hualai
claude plugin install hualai@hualai
```

> 从旧版（`git clone` 到 `~/.claude/skills/hualai`）升级：先删掉那个目录再按上面装，否则两份同名会冲突。
>
> **环境要求：** [Claude Code](https://docs.claude.com/en/docs/claude-code) + Node.js（自动增强的 hook 用）。安装后重启 Claude Code，输入 `/hualai:hualai` 即可看到。可选安装 codegraph 并在项目中建立索引以启用索引加速（没装时 hualai 会在结果末尾提示安装方法）：
>
> ```bash
> npm i -g @colbymchenry/codegraph   # 1. 装 CLI
> codegraph install --target claude --location global --yes   # 2. 接入 Claude Code，之后重启
> codegraph init --index             # 3. 在项目根目录建索引
> ```

### 升级

```bash
claude plugin marketplace update hualai
claude plugin update hualai@hualai
```

然后重启 Claude Code，或在 Claude Code 里输入 `/reload-plugins`。也可以在 Claude Code 里用 `/plugin` 界面操作：在 Marketplaces 里更新 `hualai`，再到 Installed 里把插件更新到最新版。

`claude plugin list` 里 hualai 的 `Version` 与仓库 [`plugin.json`](.claude-plugin/plugin.json) 一致，就是最新版。

### 使用

```text
/hualai:hualai 改下登录页的登录按钮，颜色太淡了
/hualai:hualai --creative 做一个番茄钟网页
/hualai:hualai --grep 优化下模型推理接口的超时处理
/hualai:hualai --no-scan 帮我写个周报
```

#### 🗣️ 输出示例

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

### 自动增强

默认关闭。在 Claude Code 里直接发（不带斜杠）：

```text
hualai on    # 开启：之后每条消息先经 hualai 改写，改写结果显示给你并注入当前会话，再按它执行
hualai off   # 关闭
```

- 开关对所有会话生效，状态存在 `~/.claude/hualai-auto-on`（文件在 = 开）。这两句本身会被拦下，不会发给模型。
- 不改写：6 个字以内的短回复（「好」「继续」）、`/` 开头的命令、「照上面的提示词执行」。
- 改写由一个独立的 `claude -p` 子进程（Sonnet）完成，每条消息多等 30–60 秒、多一次调用费用；失败时按原话执行并提示原因。
- 子进程会带上当前会话最近约 6000 字的对话（只取文字，不含工具调用），用来理解「这个」「再试试」这类指代。
- 在已经聊了很多的会话里，手动 `/hualai:hualai` 更省：它就在当前会话里跑，直接复用已有上下文。
- 增强后的提示词与你的原话冲突时，以原话为准。

---

## ⚙️ 参数说明

参数可叠加，写在草稿前面，顺序不限。

| 参数 | 作用 |
|---|---|
| （默认） | **简洁模式**，约 800 字 + 项目上下文 |
| `--creative` | **创意模式**，充分展开需求、边界与验收标准 |
| （默认扫描 `auto`） | 草稿清楚时跳过探查；否则有 codegraph 索引就用，没有就退回 Grep |
| `--grep` | 强制用 Grep / Glob / Read 查项目（清楚的草稿也查） |
| `--no-scan` | 不查项目，纯改写，最快（与 `--grep` 同时给时以 `--grep` 为准） |

---

## 📖 工作原理

```text
草稿 ─→ 解析参数 ─→ 判断是否清楚
                      ├─ 清楚 ─────────────────────────────┐
                      └─ 模糊 ─→ codegraph_status           │
                                  ├─ 有索引 → codegraph_context
                                  └─ 无索引 → Grep / Glob    │
                                        ↓                    │
                              全项目 Grep 类名/标识符          │
                              （全局覆盖 + 共用引用）          │
                                        ↓                    ↓
                              改写：项目上下文 + 术语定义 + 子任务拆分 + 完成标准
```

- 探查只用只读工具（Read / Glob / Grep / codegraph），约 6 次调用内结束；本会话已经查过的文件直接复用，不重复探查。
- 保持草稿的原意图与任务阶段：不会把「实现」改成「只做计划」，也不会把「先分析」变成「直接改」。

---

## 📊 实测数据

<details>
<summary><b>扫描方式耗时与工具调用（点击展开）</b></summary>

测试环境：Vue 3 + Spring Boot 中大型项目（约 9800 文件），Claude Code 无头模式 `claude -p`。

| 草稿 | 扫描方式 | 工具调用 | 耗时 |
|---|---|---|---|
| 帮我写一份本周工作周报 | auto（判定清楚，跳过） | 0 | 16s |
| 把 login.scss 第 312 行的 #3b82f6 改成 #2563eb，其他都不动 | auto（判定清楚，跳过） | 0 | 12s |
| 改下登录页的登录按钮，颜色太淡了 | auto（codegraph） | 10 | 41s |
| 改下登录页的登录按钮，颜色太淡了 | `--grep` | 9 | 42s |
| 改下登录页的登录按钮，颜色太淡了 | `--no-scan` | 0 | 15s |

</details>

<details>
<summary><b>防编造规则的由来（点击展开）</b></summary>

| 问题 | 修复 |
|---|---|
| 只看组件内样式，漏掉全局 `!important` 覆盖 | 找到目标后必须全项目 Grep 其类名 / 标识符 |
| 未经查证就断言「某文件没用到这个类」 | 否定结论必须来自真实 Grep 结果，否则写「未确认」 |
| 「有索引就用 codegraph」被模型跳过 | 改为硬性步骤：第一个 codegraph 调用必须是 `codegraph_status` |

</details>

---

## 🌟 相关项目

| 项目 | 说明 |
|---|---|
| [**zcode-plus**](https://github.com/Llliao1113/zcode-plus) | ZCode 桌面版一键提示词增强（CDP 注入），本项目改写模板的来源 |
| [**claude-code-prompt-improver**](https://github.com/severity1/claude-code-prompt-improver) | Hook + Skill，自动判断提示词清晰度，模糊时调研并提问 |
| [**prompt-improver**](https://github.com/ndpvt-web/prompt-improver) | 改写前通过提问澄清前提，含第一性原理模式 |
| [**flowkit**](https://github.com/FrizzleFur/flowkit) | AI 工作流编排工具集，其 prompt 模块启发了术语定义与多目标拆分规则 |
| [**codegraph**](https://www.npmjs.com/package/@colbymchenry/codegraph) | 代码知识图谱 MCP，本项目的可选索引后端 |

---

## ⚠️ 局限性

- 模型输出存在波动，同一草稿多次运行结果可能略有不同，发送前请过目。
- 探查需要 30–50 秒；只想润色文字请用 `--no-scan`。
- 对 CSS 类名、样式覆盖这类需求，codegraph 并不比 Grep 快，其优势在后端调用链查询。
- 改写结果不用手动复制：直接回复「照上面的提示词执行」即可。想先改几句再发，仍需复制。
- 自动增强只支持 Claude Code（依赖其 UserPromptSubmit hook），其他编程工具未适配。
- 「只读」靠提示词约束：`allowed-tools` 只是免确认放行，并不禁用其他工具，在跳过权限确认的模式下尤其要留意。

---

## 📄 许可证

本项目基于 [MIT](LICENSE) 协议发布。改写模板部分移植自 zcode-plus（MIT，Copyright (c) 2026 Llliao1113）。

## 🙏 致谢

- [zcode-plus](https://github.com/Llliao1113/zcode-plus) 提供了简洁 / 创意两套增强模板
- [flowkit](https://github.com/FrizzleFur/flowkit) 的 prompt 模块提供了术语补全与单任务拆分的思路
- [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) 提供代码索引能力

## ⭐ Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=jiangwanyutao/hualai&type=Date)](https://star-history.com/#jiangwanyutao/hualai&Date)
