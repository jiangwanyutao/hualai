// Run: node hooks/auto.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { decide, inject, recentContext, isUnattended, gitBashPath, skillPrompt, claudeArgs } = require('./auto');

const draft = '改下登录页的登录按钮，颜色太淡了';
assert.strictEqual(decide(draft, true).rewrite, true, 'vague draft gets rewritten when on');
assert.strictEqual(decide(draft, false).rewrite, undefined, 'off by default');
assert.strictEqual(decide(draft, true, true).rewrite, undefined, 'child process never recurses');
assert.strictEqual(decide('继续修', true).rewrite, undefined, 'short reply skipped');
assert.strictEqual(decide(' 继续 ', true).rewrite, undefined, '继续 skipped');
assert.strictEqual(decide('continue please', true).rewrite, undefined, 'short english reply skipped');
assert.strictEqual(decide('继续改登录页', true).rewrite, true, 'exactly 6 units rewritten');
assert.strictEqual(decide('继续改登录页面', true).rewrite, true, 'over 6 units rewritten');
assert.strictEqual(decide('继续改登录', true).rewrite, undefined, '5 units skipped');
assert.strictEqual(decide('fix the login page button color', true).rewrite, true, '6 english words rewritten');
assert.strictEqual(decide('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>', true).rewrite, undefined, 'background-task event skipped');

assert.strictEqual(isUnattended({ CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), false, 'interactive session');
assert.strictEqual(isUnattended({ CLAUDE_CODE_SESSION_ATTENDED: '0', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }), true, 'claude -p');
assert.strictEqual(isUnattended({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }), true, 'Agent SDK');
assert.strictEqual(isUnattended({ HUALAI_AUTO_CHILD: '1' }), true, "hualai's own child");

// headless session: the real hook prints nothing even when auto mode is on (ON_FLAG under a fake home)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hualai-home-'));
fs.mkdirSync(path.join(home, '.claude'));
fs.writeFileSync(path.join(home, '.claude', 'hualai-auto-on'), '');
const run = spawnSync(process.execPath, [path.join(__dirname, 'auto.js')], {
  input: JSON.stringify({ prompt: draft }),
  env: { ...process.env, HOME: home, USERPROFILE: home, HUALAI_AUTO_CHILD: '', CLAUDE_CODE_SESSION_ATTENDED: '0', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' },
  encoding: 'utf8',
});
fs.rmSync(home, { recursive: true, force: true });
assert.strictEqual(run.status, 0);
assert.strictEqual(run.stdout, '', 'headless session: no output, no child spawned');

// Exercise the hook entry point with a fake Codex executable, without a model request.
const fakeCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hualai-codex-e2e-'));
try {
  fs.mkdirSync(path.join(fakeCodexHome, '.claude'));
  fs.writeFileSync(path.join(fakeCodexHome, '.claude', 'hualai-auto-on'), '');
  const executable = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  fs.writeFileSync(path.join(fakeCodexHome, executable), process.platform === 'win32' ? '@echo enhanced-test\r\n' : '#!/bin/sh\nprintf enhanced-test\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [path.join(__dirname, 'auto.js')], {
    input: JSON.stringify({ prompt: draft, turn_id: 'test', cwd: fakeCodexHome }),
    env: { ...process.env, HOME: fakeCodexHome, USERPROFILE: fakeCodexHome, PATH: fakeCodexHome, HUALAI_AUTO_CHILD: '', CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_CODE_ENTRYPOINT: '' },
    encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(result.status, 0, 'Codex hook exits successfully');
  const event = JSON.parse(result.stdout);
  assert.ok(event.hookSpecificOutput.additionalContext.includes('enhanced-test'), 'Codex child result is injected');
  assert.ok(event.systemMessage.includes('enhanced-test'), 'rewrite is displayed');
} finally {
  fs.rmSync(fakeCodexHome, { recursive: true, force: true });
}

// Windows: bash.exe found from either git.exe location; other platforms never set it
const git = fs.mkdtempSync(path.join(os.tmpdir(), 'hualai-git-'));
for (const d of ['bin', 'cmd', 'mingw64/bin']) fs.mkdirSync(path.join(git, d), { recursive: true });
for (const f of ['bin/bash.exe', 'cmd/git.exe', 'mingw64/bin/git.exe']) fs.writeFileSync(path.join(git, f), '');
const bash = path.join(git, 'bin', 'bash.exe');
assert.strictEqual(gitBashPath({ PATH: path.join(git, 'mingw64', 'bin') }, 'win32'), bash, 'from mingw64\\bin');
assert.strictEqual(gitBashPath({ PATH: `C:\\nope;${path.join(git, 'cmd')}` }, 'win32'), bash, 'from cmd');
assert.strictEqual(gitBashPath({ PATH: path.join(git, 'cmd'), CLAUDE_CODE_GIT_BASH_PATH: 'X' }, 'win32'), undefined, 'user setting wins');
assert.strictEqual(gitBashPath({ PATH: path.join(git, 'cmd') }, 'darwin'), undefined, 'mac untouched');
fs.rmSync(git, { recursive: true, force: true });
assert.strictEqual(decide('/hualai:hualai 改下登录页', true).rewrite, undefined, 'slash command skipped');
assert.strictEqual(decide('照上面的提示词执行吧', true).rewrite, undefined, 'execute-reply skipped');
assert.deepStrictEqual([decide(' Hualai OFF ', true).toggle, decide('hualai on', false).toggle], ['off', 'on']);
assert.strictEqual(decide('hualai on', false).out.decision, 'block', 'toggle never reaches the model');

for (const [enabled, expected] of [[true, '已开启'], [false, '已关闭']]) {
  const status = decide('hualai status', enabled);
  assert.strictEqual(status.out.decision, 'block', 'status stays out of model prompt');
  assert.ok(status.out.reason.includes(expected), 'status reports the current state');
  assert.strictEqual(status.toggle, undefined, 'status does not change state');
}

const out = inject('把按钮调深。\n\n---\n（给你的提示，不属于提示词）当前项目没有 codegraph 索引。');
const ctx = out.hookSpecificOutput.additionalContext;
assert.ok(ctx.includes('把按钮调深。') && !ctx.includes('给你的提示'), 'install tip not injected');
assert.ok(out.systemMessage.includes('给你的提示'), 'install tip still shown to user');
assert.ok(inject('a\n---\nb').hookSpecificOutput.additionalContext.includes('---\nb'), 'ordinary --- kept');
const tp = path.join(os.tmpdir(), `hualai-test-${process.pid}.jsonl`);
fs.writeFileSync(tp, [
  { type: 'user', message: { content: '把 A、B、C 改上去' } },
  { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'A 是复用，B 是引用约束' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
  { type: 'user', isMeta: true, message: { content: 'meta' } },
  { type: 'user', message: { content: '<command-name>/plugin</command-name>' } },
  { type: 'system' },
  { type: 'user', message: { content: '再试试' } },
].map((e) => JSON.stringify(e)).join('\n') + '\nnot json\n');
const rc = recentContext(tp, '再试试');
fs.rmSync(tp);
assert.strictEqual(rc, 'User: 把 A、B、C 改上去\n\nAssistant: A 是复用，B 是引用约束', 'text turns only, draft dropped');
assert.strictEqual(recentContext(undefined, 'x'), '', 'no transcript → no context');

// Codex rollout: user/assistant messages only; injected AGENTS.md, environment and developer lines dropped
const msg = (role, type, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type, text }] } });
const cp = path.join(os.tmpdir(), `hualai-codex-${process.pid}.jsonl`);
fs.writeFileSync(cp, [
  { type: 'session_meta', payload: {} },
  msg('developer', 'input_text', 'You are Codex'),
  msg('user', 'input_text', '# AGENTS.md instructions\n<INSTRUCTIONS>x</INSTRUCTIONS>'),
  msg('user', 'input_text', '<environment_context>cwd</environment_context>'),
  msg('user', 'input_text', '把 A 改上去'),
  { type: 'response_item', payload: { type: 'function_call', name: 'exec' } },
  msg('assistant', 'output_text', 'A 是复用'),
  msg('user', 'input_text', '再试试'),
].map((e) => JSON.stringify(e)).join('\n'));
const crc = recentContext(cp, '再试试');
fs.rmSync(cp);
assert.strictEqual(crc, 'User: 把 A 改上去\n\nAssistant: A 是复用', 'codex rollout text turns only');

// Large transcripts: read a bounded tail, discard a partial leading JSONL record,
// preserve UTF-8 text and remove the current draft from the recent context.
const large = path.join(os.tmpdir(), `hualai-large-${process.pid}.jsonl`);
fs.writeFileSync(large, JSON.stringify(msg('user', 'input_text', '旧'.repeat(500000))) + '\n' + [
  msg('user', 'input_text', '请保留中文和🙂'),
  msg('assistant', 'output_text', '已理解，不联网'),
  msg('user', 'input_text', '继续处理这个问题'),
].map(JSON.stringify).join('\n'));
const originalReadFileSync = fs.readFileSync;
try {
  fs.readFileSync = function(file, ...args) {
    if (file === large) throw new Error('transcript must not be read entirely');
    return originalReadFileSync.call(this, file, ...args);
  };
  const tail = recentContext(large, '继续处理这个问题');
  assert.ok(tail.endsWith('User: 请保留中文和🙂\n\nAssistant: 已理解，不联网'), 'tail keeps UTF-8 records and removes draft');
  assert.ok(!tail.includes('�') && !tail.includes('继续处理这个问题'), 'no broken UTF-8 or duplicated draft');
  assert.ok(tail.length <= 6000, 'context is bounded');
} finally {
  fs.readFileSync = originalReadFileSync;
  fs.rmSync(large);
}

// Codex child gets the skill body with the draft filled in and no frontmatter
const sp = skillPrompt('改下登录页 $1 $&').replace(/\r\n/g, '\n'); // checkouts may be CRLF
assert.ok(sp.includes('<draft>\n改下登录页 $1 $&\n</draft>'), 'draft inserted verbatim');
assert.ok(!sp.includes('$ARGUMENTS') && !sp.startsWith('---') && !sp.includes('allowed-tools:'), 'placeholder and frontmatter gone');

// slim Claude child: user settings skipped, hualai loaded from the plugin dir, codegraph + apiKeyHelper carried over
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hualai-cfg-'));
fs.mkdirSync(path.join(fakeHome, '.claude'));
fs.writeFileSync(path.join(fakeHome, '.claude.json'), JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph' }, other: { command: 'x' } } }));
fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: 'get-key.sh', hooks: {} }));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
Object.assign(process.env, { HOME: fakeHome, USERPROFILE: fakeHome });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hualai-args-'));
const args = claudeArgs(tmp, 'ctx', fakeHome).join(' ');
const bare = claudeArgs(tmp, '', fakeHome).join(' ');
Object.assign(process.env, saved);
const unq = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
assert.ok(args.includes('--setting-sources project,local') && args.includes('--plugin-dir'), 'user settings skipped, plugin loaded directly');
assert.deepStrictEqual(unq('mcp.json'), { mcpServers: { codegraph: { command: 'codegraph' } } }, 'only codegraph kept');
assert.deepStrictEqual(unq('settings.json'), { apiKeyHelper: 'get-key.sh' }, 'apiKeyHelper carried over');
assert.ok(args.includes('--append-system-prompt-file') && !bare.includes('--append-system-prompt-file'), 'context file only when there is context');
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(fakeHome, { recursive: true, force: true });

console.log('ok');
