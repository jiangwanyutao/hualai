#!/usr/bin/env node
// hualai auto mode: Claude Code UserPromptSubmit hook.
// Rewrites the user's prompt with a child `claude -p "/hualai:hualai ..."`, then injects the result into the
// current session (additionalContext) and shows it to the user (systemMessage).
// `hualai on` / `hualai off` toggle it; off by default, on = existence of ON_FLAG.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ON_FLAG = path.join(os.homedir(), '.claude', 'hualai-auto-on');
const CHILD_ENV = 'HUALAI_AUTO_CHILD'; // set on the child so its own hook run is skipped (no recursion)
const MIN_CHARS = 6; // shorter prompts (好 / 继续 / 继续修) are replies, not drafts
const CHILD_TIMEOUT_MS = 150000; // keep below the hook `timeout` in hooks/hooks.json (180s)

/** Decide what to do with a prompt without side effects. Returns {toggle?, rewrite?, out?}. */
function decide(prompt, isOn, isChild = false) {
  const p = prompt.trim();
  const cmd = p.toLowerCase();
  if (cmd === 'hualai on' || cmd === 'hualai off') {
    const on = cmd === 'hualai on';
    return { toggle: on ? 'on' : 'off', out: { decision: 'block', reason: on ? 'hualai 自动增强：已开启（发 hualai off 关闭）' : 'hualai 自动增强：已关闭（发 hualai on 开启）' } };
  }
  if (isChild || !isOn || p.length < MIN_CHARS || p.startsWith('/') || p.includes('照上面的提示词执行')) return {};
  return { rewrite: true };
}

/** Build the hook output from the child's rewrite; the trailing INSTALL TIP is shown but not injected. */
function inject(enhanced) {
  const text = enhanced.trim();
  const m = text.match(/\n---\n((（给你的提示|\(Note for you)[\s\S]*)$/);
  const prompt = m ? text.slice(0, m.index).trim() : text;
  return {
    systemMessage: `【hualai 增强后的提示词】\n${text}`,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext:
        "[hualai auto] The user's message was enhanced by the hualai skill into the prompt below. Carry it out; " +
        "if it conflicts with the user's own words, the user's words win.\n\n<hualai-enhanced>\n" + prompt + '\n</hualai-enhanced>',
    },
  };
}

function rewrite(prompt, cwd) {
  const r = spawnSync('claude', ['-p'], {
    input: `/hualai:hualai ${prompt}`,
    cwd: cwd || process.cwd(),
    env: { ...process.env, [CHILD_ENV]: '1' },
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    shell: process.platform === 'win32', // resolves claude.cmd; no user text on the command line
  });
  if (r.error || r.status !== 0 || !r.stdout.trim()) {
    throw new Error(r.error ? r.error.message : `exit ${r.status}: ${(r.stderr || '').slice(0, 300)}`);
  }
  return r.stdout;
}

function main() {
  let input = '';
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => {
    let hook;
    try {
      hook = JSON.parse(input);
    } catch (e) {
      process.stderr.write(`hualai auto: bad hook input: ${e.message}\n`);
      process.exit(0); // never block the user's prompt because of the hook
    }
    const prompt = String(hook.prompt || '');
    const { toggle, rewrite: needsRewrite, out } = decide(prompt, fs.existsSync(ON_FLAG), process.env[CHILD_ENV] === '1');
    if (toggle === 'on') fs.writeFileSync(ON_FLAG, '');
    if (toggle === 'off') fs.rmSync(ON_FLAG, { force: true });
    if (out) return process.stdout.write(JSON.stringify(out));
    if (!needsRewrite) return;
    try {
      process.stdout.write(JSON.stringify(inject(rewrite(prompt, hook.cwd))));
    } catch (e) {
      // fall back to the raw prompt; tell the user why it was not enhanced
      process.stdout.write(JSON.stringify({ systemMessage: `hualai 自动增强失败，按原话执行：${e.message}` }));
    }
  });
}

if (require.main === module) main();
module.exports = { decide, inject };
