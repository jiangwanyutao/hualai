<h2 align="center">hualai: A Project-Aware Prompt Enhancer Plugin for Claude Code</h2>

<p align="center">
  <b>English</b> | <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="https://github.com/jiangwanyutao/hualai"><img src="https://img.shields.io/badge/Project%20Page-GitHub-blue" alt="Project Page"></a>
  <a href="https://docs.claude.com/en/docs/claude-code/skills"><img src="https://img.shields.io/badge/Claude%20Code-Skill-D97757" alt="Claude Code Skill"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  <a href="https://github.com/jiangwanyutao/hualai/stargazers"><img src="https://img.shields.io/github/stars/jiangwanyutao/hualai?style=flat" alt="Stars"></a>
</p>

hualai is a **Claude Code plugin**: jot down a rough draft, and it first **explores your current project read-only** (tech stack, relevant files, global style overrides, shared usages), then rewrites the draft into a **clear, specific, actionable** prompt. It only outputs the rewritten prompt — it never executes the task or edits files. You review it and send it yourself.

The name comes from the Chinese「话来」(*huà lái*, "here come the words") — one sentence in, a solid prompt out.

### ✨ Key Features

- 🔍 **Project-aware** — Detects the tech stack, locates the pages / components / APIs the draft mentions, and puts real file paths and line numbers into the prompt
- 🧭 **Index acceleration** — Uses the [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) index when the project has one, falls back to Grep otherwise, or lets you choose
- ⚡ **Skips exploration for clear drafts** — If the draft already names the files and the change, or has nothing to do with code (e.g. a weekly report), it rewrites directly in ~12s
- 🛡️ **Anti-hallucination** — Cites only paths it actually saw; negative claims like "not used" / "not affected" must come from a real Grep result, otherwise they are marked *unconfirmed*
- 📖 **Term definitions** — Team jargon and internal module names get a one-line definition from the exploration; unknown terms are marked *needs clarification*
- ✂️ **Multi-goal splitting** — A draft mixing several goals is split into numbered sub-tasks, each with its own completion check, done and verified one at a time
- 🎨 **Two styles** — Concise mode (~800 chars) for daily use; creative mode fully develops requirements, boundaries, and acceptance criteria
- 🌐 **Keeps your language** — Chinese in, Chinese out; code, paths, and error messages are preserved verbatim
- 🤖 **Auto-enhance (optional)** — After you send `hualai on`, every message is rewritten by hualai before it runs, no command needed; off by default

### News

* **[2026.09]** 🔥 Now a Claude Code plugin, with an auto-enhance switch (`hualai on` / `hualai off`, off by default)
* **[2026.09]** 🔥 Clear drafts now skip project exploration — about 3× faster for pure rewrites
* **[2026.09]** 🎉 Added term-definition and multi-goal splitting rules
* **[2026.09]** 🎉 First release: project exploration + codegraph index + three scan modes

---

## Contents

- [Quick Start](#-quick-start)
  - [Installation](#installation)
  - [Usage](#usage)
  - [Auto-enhance](#auto-enhance)
- [Options](#%EF%B8%8F-options)
- [How It Works](#-how-it-works)
- [Benchmarks](#-benchmarks)
- [Related Projects](#-related-projects)
- [Limitations](#%EF%B8%8F-limitations)
- [License](#-license)
- [Acknowledgements](#-acknowledgements)

---

## 🚀 Quick Start

### Installation

**Let Claude install it (recommended, includes the codegraph dependency)**. Send this in Claude Code:

```text
Install hualai by following https://raw.githubusercontent.com/jiangwanyutao/hualai/main/AGENTS.md
```

**Manual install (Claude Code plugin):**

```bash
claude plugin marketplace add jiangwanyutao/hualai
claude plugin install hualai@hualai
```

> Upgrading from the old install (`git clone` into `~/.claude/skills/hualai`): delete that directory first, or the two copies clash on the same name.
>
> **Requirements:** [Claude Code](https://docs.claude.com/en/docs/claude-code) + Node.js (for the auto-enhance hook). Restart Claude Code after installing, then type `/hualai:hualai`. Optionally install codegraph and index your project to enable index acceleration (if it is missing, hualai adds an install tip at the end of its output):
>
> ```bash
> npm i -g @colbymchenry/codegraph   # 1. install the CLI
> codegraph install --target claude --location global --yes   # 2. wire it into Claude Code, then restart
> codegraph init --index             # 3. build the index in your project root
> ```

### Usage

```text
/hualai:hualai the login button on the login page looks too faint, fix it
/hualai:hualai --creative build a pomodoro timer web page
/hualai:hualai --grep improve timeout handling in the model inference API
/hualai:hualai --no-scan write my weekly report
```

#### 🗣️ Example Output

Draft: `the login button on the login page looks too faint, fix it`

```text
Make the "Login" button on the login page darker and more prominent.

Project context:
- Frontend web/ (Vue 3 + TypeScript + Element Plus)
- Button: src/views/login/LoginForm.vue:106, class login-btn
- The color actually comes from the global !important gradient in src/styles/login.scss:311
- login-btn is also used in MobileLogin.vue:36, so changing the global style affects it too

Requirements:
1. Confirm why it looks faint before changing anything...
```


### Auto-enhance

Off by default. Send these in Claude Code as plain messages (no slash):

```text
hualai on    # on: every message is first rewritten by hualai; the result is shown to you, injected into the session, then carried out
hualai off   # off
```

- The switch applies to all sessions; its state is the file `~/.claude/hualai-auto-on` (present = on). These two messages are intercepted and never reach the model.
- Not rewritten: replies of 6 characters or fewer ("ok", "go on"), `/` commands, and 「照上面的提示词执行」.
- The rewrite runs in a separate `claude -p` child process, adding 30–50s and one extra call per message; on failure the original message runs and you are told why.
- If the enhanced prompt conflicts with your own words, your words win.

---

## ⚙️ Options

Flags can be combined and placed before the draft in any order.

| Flag | Effect |
|---|---|
| (default) | **Concise mode**, ~800 chars + project context |
| `--creative` | **Creative mode**, fully develops requirements, boundaries, and acceptance criteria |
| (default scan `auto`) | Skips exploration for clear drafts; otherwise uses the codegraph index if present, else Grep |
| `--grep` | Force Grep / Glob / Read exploration (even for clear drafts) |
| `--no-scan` | No exploration, pure rewrite, fastest (`--grep` wins if both are given) |

---

## 📖 How It Works

```text
draft ─→ parse flags ─→ is it clear?
                         ├─ yes ────────────────────────────────┐
                         └─ no ─→ codegraph_status               │
                                   ├─ indexed → codegraph_context
                                   └─ no index → Grep / Glob     │
                                          ↓                      │
                          project-wide Grep of class / identifier │
                          (global overrides + shared usages)     │
                                          ↓                      ↓
                  rewrite: project context + term definitions + sub-tasks + completion checks
```

- Exploration uses read-only tools only (Read / Glob / Grep / codegraph) and finishes within ~10 calls.
- Keeps the draft's intent and task stage: it won't turn "implement" into "plan only", or "analyze first" into "just change it".

---

## 📊 Benchmarks

<details>
<summary><b>Time and tool calls by scan mode (click to expand)</b></summary>

Environment: a mid-to-large Vue 3 + Spring Boot project (~9,800 files), Claude Code headless mode `claude -p`.

| Draft | Scan mode | Tool calls | Time |
|---|---|---|---|
| Write this week's work report | auto (clear, skipped) | 0 | 16s |
| Change #3b82f6 to #2563eb on line 312 of login.scss, nothing else | auto (clear, skipped) | 0 | 12s |
| The login button on the login page looks too faint | auto (codegraph) | 10 | 41s |
| The login button on the login page looks too faint | `--grep` | 9 | 42s |
| The login button on the login page looks too faint | `--no-scan` | 0 | 15s |

</details>

<details>
<summary><b>Where the anti-hallucination rules came from (click to expand)</b></summary>

| Problem | Fix |
|---|---|
| Only checked component styles, missed a global `!important` override | After finding the target, Grep its class / identifier project-wide |
| Claimed "file X doesn't use this class" without checking | Negative claims must come from a real Grep result, otherwise marked *unconfirmed* |
| "Use codegraph if indexed" was skipped by the model | Made it a hard step: the first codegraph call must be `codegraph_status` |

</details>

---

## 🌟 Related Projects

| Project | Description |
|---|---|
| [**zcode-plus**](https://github.com/Llliao1113/zcode-plus) | One-click prompt enhancement for the ZCode desktop app (CDP injection); source of this project's rewrite templates |
| [**claude-code-prompt-improver**](https://github.com/severity1/claude-code-prompt-improver) | Hook + Skill that checks prompt clarity automatically, researching and asking questions when vague |
| [**prompt-improver**](https://github.com/ndpvt-web/prompt-improver) | Clarifies assumptions through questions before rewriting; includes a first-principles mode |
| [**flowkit**](https://github.com/FrizzleFur/flowkit) | AI workflow orchestration toolkit; its prompt module inspired the term-definition and multi-goal splitting rules |
| [**codegraph**](https://www.npmjs.com/package/@colbymchenry/codegraph) | Code knowledge graph MCP; the optional index backend for this project |

---

## ⚠️ Limitations

- Model output varies; the same draft may produce slightly different results across runs, so review before sending.
- Exploration takes 30–50 seconds; use `--no-scan` if you only want wording polished.
- For CSS class names and style overrides, codegraph is not faster than Grep; it shines on backend call-chain queries.
- No need to copy the result: just reply "run the prompt above". Copy it only if you want to edit it first.
- Auto-enhance works only in Claude Code (it relies on the UserPromptSubmit hook); other coding tools are not supported.
- Read-only is enforced by the prompt: `allowed-tools` only pre-approves tools and does not block others, so take care in permission-bypass modes.

---

## 📄 License

Released under the [MIT](LICENSE) License. Parts of the rewrite templates are ported from zcode-plus (MIT, Copyright (c) 2026 Llliao1113).

## 🙏 Acknowledgements

- [zcode-plus](https://github.com/Llliao1113/zcode-plus) for the concise / creative enhancement templates
- [flowkit](https://github.com/FrizzleFur/flowkit) whose prompt module inspired term completion and single-task splitting
- [codegraph](https://www.npmjs.com/package/@colbymchenry/codegraph) for code indexing

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jiangwanyutao/hualai&type=Date)](https://star-history.com/#jiangwanyutao/hualai&Date)
