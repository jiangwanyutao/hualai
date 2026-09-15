# Agent install guide

This file is for AI agents (Claude Code, etc.) asked to install [hualai](https://github.com/jiangwanyutao/hualai). Follow the steps in order and report the result of each step's check to the user.

Read repo files via raw URLs (e.g. `https://raw.githubusercontent.com/jiangwanyutao/hualai/main/SKILL.md`); do not clone into the current directory just to read them. If you already cloned a temporary copy outside the target directory below, delete that copy (only the one you created) after step 1.

hualai = one Claude Code skill (`SKILL.md`) + one optional dependency: the **codegraph** MCP server (code index that speeds up project discovery). Without codegraph the skill still works and falls back to Grep.

## 1. Install the skill

Target directory: `~/.claude/skills/hualai` (Windows: `%USERPROFILE%\.claude\skills\hualai`).

- Not present → `git clone https://github.com/jiangwanyutao/hualai ~/.claude/skills/hualai`
- Already a git clone of this repo → `git -C ~/.claude/skills/hualai pull`
- Present but not this repo → stop and ask the user; do not overwrite.

Check: `~/.claude/skills/hualai/SKILL.md` exists.

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

1. Restart Claude Code so the skill and the MCP server load.
2. Try: `/hualai 改下登录页的登录按钮，颜色太淡了`
3. After the rewritten prompt appears, reply "照上面的提示词执行" to run it; no copy-paste needed.

## Notes

- `SKILL.md` sets `disable-model-invocation: true`, so hualai does not appear in the model's skill list. That is expected; users invoke it with `/hualai`.
- Testing in Git Bash on Windows: `claude -p "/hualai ..."` gets `/hualai` rewritten into a file path. Set `MSYS_NO_PATHCONV=1` first.
- Uninstall: delete `~/.claude/skills/hualai`; `codegraph uninstall` removes codegraph from every agent it configured.
