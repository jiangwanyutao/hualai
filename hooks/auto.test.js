// Run: node hooks/auto.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decide, inject, recentContext } = require('./auto');

const draft = '改下登录页的登录按钮，颜色太淡了';
assert.strictEqual(decide(draft, true).rewrite, true, 'vague draft gets rewritten when on');
assert.strictEqual(decide(draft, false).rewrite, undefined, 'off by default');
assert.strictEqual(decide(draft, true, true).rewrite, undefined, 'child process never recurses');
assert.strictEqual(decide('继续修', true).rewrite, undefined, 'short reply skipped');
assert.strictEqual(decide('/hualai:hualai 改下登录页', true).rewrite, undefined, 'slash command skipped');
assert.strictEqual(decide('照上面的提示词执行吧', true).rewrite, undefined, 'execute-reply skipped');
assert.deepStrictEqual([decide(' Hualai OFF ', true).toggle, decide('hualai on', false).toggle], ['off', 'on']);
assert.strictEqual(decide('hualai on', false).out.decision, 'block', 'toggle never reaches the model');

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

console.log('ok');
