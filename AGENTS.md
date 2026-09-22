# Agent install guide

This file is for AI agents (Claude Code, etc.) asked to install [hualai](https://github.com/jiangwanyutao/hualai). Follow the steps in order and report the result of each step's check to the user.

Read repo files via raw URLs (e.g. `https://raw.githubusercontent.com/jiangwanyutao/hualai/main/skills/hualai/SKILL.md`); do not clone into the current directory just to read them.

hualai = one Claude Code plugin (the `hualai` skill + an auto-enhance hook, off by default) + one optional dependency: the **codegraph** MCP server (code index that speeds up project discovery). Without codegraph the skill still works and falls back to Grep.

## 1. Install the plugin

Old install check: if `~/.claude/skills/hualai` exists and is a git clone of this repo, it is the pre-plugin install and clashes with the plugin's name. Tell the user in one line, then delete it. If it exists but is not this repo, stop and ask.

```bash
claude plugin marketplace add jiangwanyutao/hualai
claude plugin install hualai@hualai
```

Already installed → `claude plugin marketplace update hualai`, then `claude plugin update hualai@hualai`.

Check: `claude plugin list` shows `hualai@hualai` as enabled.

## 2. Install codegraph (dependency)

Check first: `codegraph --version`.

- Prints a version → skip to step 3.
- Command not found → install it globally. Tell the user in one line before running, since this installs a global package:
  - Node available: `npm i -g @colbymchenry/codegraph`
  - No Node, macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh`
  - No Node, Windows PowerShell: `irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex`

The installer does not update the current shell's PATH. If `codegraph --version` still fails, run it via its full path or ask the user to open a new terminal.

Check: `codegraph --version` prints a version.

## 3. Wire codegraph into Claude Code

Check first: `claude mcp list` shows `codegraph ... Connected` → skip to step 4.

Otherwise run (non-interactive; the default `codegraph install` waits for keyboard input):

```bash
codegraph install --target claude --location global --yes
```

Check: `claude mcp list` lists `codegraph`.

## 4. Index the user's project (optional, per project)

Only if the user names a project to use hualai in. In that project's root:

```bash
codegraph init --index
```

This creates `.codegraph/` in the project. Suggest adding `.codegraph/` to that project's `.gitignore`; do not edit it without asking.

Check: `codegraph status` shows index statistics.

## 5. Finish

Tell the user:

1. Restart Claude Code so the plugin and the MCP server load.
2. Try: `/hualai:hualai 改下登录页的登录按钮，颜色太淡了`
3. After the rewritten prompt appears, reply "照上面的提示词执行" to run it; no copy-paste needed.
4. Optional auto-enhance: send `hualai on` (plain message, no slash) to have every message rewritten before it runs; `hualai off` turns it off. It is off by default and adds 30–50s per message.

## Notes

- `SKILL.md` sets `disable-model-invocation: true`, so hualai does not appear in the model's skill list. That is expected; users invoke it with `/hualai:hualai`.
- Testing in Git Bash on Windows: `claude -p "/hualai:hualai ..."` gets the slash command rewritten into a file path. Set `MSYS_NO_PATHCONV=1` first.
- Uninstall: `claude plugin uninstall hualai@hualai`, and delete `~/.claude/hualai-auto-on` if present; `codegraph uninstall` removes codegraph from every agent it configured.
