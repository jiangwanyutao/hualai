#!/usr/bin/env node
/*
 * merge-spec.js —— 把用户在浏览器里改过的需求说明，合并回原型原文件（方案 A：导出回传）
 *
 * 用法：
 *   node merge-spec.js <用户导出的 html> <原型 index.html> [--dry-run] [--force]
 *
 * 做了什么：
 *   1. 危险内容检查：导出文件的说明区里有脚本、iframe 或白名单之外的事件属性 → 中止（--force 也不放行）
 *   2. 缺失检查：原文件有、导出文件没有的菜单 / 功能点 → 说明用户是拿旧版改的，默认中止
 *   3. 导出后改动检查：导出文件记下的基线 key 与原文件当前 PROTO_KEY 不一致 → 原文件在导出之后被改过；
 *      原文件里带 data-agent-edited、导出文件里找不到的内容会被冲掉，有这类内容时默认中止
 *   4. 抽取「导出文件」的 #specBody，整体替换「原文件」的 #specBody —— 左侧原型一字不动
 *   5. 自动备份原文件到 <原文件目录>/_archive/（同类备份只留最近 20 份）
 *   6. 换 PROTO_KEY，防止用户浏览器里的旧缓存把合并结果盖回去
 *   7. 输出差异报告：新增章节、人工定稿标记数、菜单清单
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BACKUP_KEEP = 20;
// 说明区里允许出现的事件属性取值（模板自带的卡片联动、章节删除、表格行增删）
const ALLOWED_HANDLER = /^(flashAllNoScroll\('[^'"<>]*'\)|delSection\(this\)|addRow\(this\)|delRow\(this\))$/;

/* ---------------- 提取工具 ---------------- */

/** 精确定位 #specBody 的起止位置（用 div 深度配平，避免正则贪婪吞错；注释里的 div 文字不计数） */
function findSpecBody(html) {
  const start = html.indexOf('<div id="specBody"');
  if (start < 0) return null;
  const re = /<!--[\s\S]*?-->|<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, end = -1, m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].slice(0, 4) === '<!--') continue;
    if (m[0].slice(0, 2) === '</') {
      depth--;
      if (depth === 0) { end = m.index + m[0].length; break; }
    } else {
      depth++;
    }
  }
  if (end < 0) return null;
  return { start, end, content: html.slice(start, end) };
}

function stripComments(html) { return html.replace(/<!--[\s\S]*?-->/g, ''); }
function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }

/** 按 menu-pane 切分（注释里的示例不算） */
function splitPanes(html) {
  const re = /<div class="menu-pane[^"]*"\s+data-menu="([^"]+)"(?:\s+data-label="([^"]*)")?/g;
  const marks = [];
  let m;
  while ((m = re.exec(html)) !== null) marks.push({ i: m.index, menu: m[1], label: m[2] || m[1] });
  return marks.map((x, idx) => ({
    menu: x.menu,
    label: x.label,
    html: html.slice(x.i, idx + 1 < marks.length ? marks[idx + 1].i : html.length)
  }));
}

/** 功能点清单：菜单 id + 编号 + 名称，避免不同菜单里的同名功能点互相掩盖 */
function listFnKeys(panes) {
  const out = [];
  panes.forEach(p => {
    const re = /<div class="fn item"\s+data-k="([^"]+)"[\s\S]*?<span class="fn-name">([\s\S]*?)<\/span>/g;
    let m;
    while ((m = re.exec(p.html)) !== null) out.push(p.menu + '/' + m[1] + ' ' + stripTags(m[2]));
  });
  return out;
}

/** 危险内容：脚本类标签、javascript: 地址、白名单之外的事件属性 */
function findUnsafe(html) {
  const out = [];
  const tagRe = /<(script|iframe|object|embed)\b/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) out.push('<' + m[1] + '> 标签');
  if (/javascript:/i.test(html)) out.push('javascript: 地址');
  const onRe = /\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  while ((m = onRe.exec(html)) !== null) {
    const val = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]).trim();
    if (!ALLOWED_HANDLER.test(val)) out.push(m[1] + '="' + val.slice(0, 60) + '"');
  }
  return out;
}

/** 带 data-agent-edited 的单元格文字（Agent 在场景 C 改过的内容） */
function agentEditedTexts(html) {
  const out = [];
  const re = /<(td|th|div|h3)\b[^>]*\bdata-agent-edited\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = stripTags(m[2]);
    if (t) out.push(t);
  }
  return out;
}

function countUserSections(html) {
  return (html.match(/class="mb-4 user-section"/g) || []).length;
}
function countUserEdited(html) {
  return (html.match(/data-user-edited/g) || []).length;
}
function pad(n) { return String(n).length < 2 ? '0' + n : '' + n; }
function stamp() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function diffOf(a, b) { return a.filter(x => b.indexOf(x) < 0); }

/** 备份到 _archive/，同一前缀只留最近 BACKUP_KEEP 份（文件名带时间戳，按名称排序即按时间排序） */
function backup(file, prefix) {
  const archiveDir = path.join(path.dirname(file), '_archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  const backupPath = path.join(archiveDir, prefix + stamp() + '.html');
  fs.copyFileSync(file, backupPath);
  const same = fs.readdirSync(archiveDir).filter(f => f.indexOf(prefix) === 0 && f.endsWith('.html')).sort();
  same.slice(0, Math.max(same.length - BACKUP_KEEP, 0)).forEach(f => fs.unlinkSync(path.join(archiveDir, f)));
  return backupPath;
}

/* ---------------- 主流程 ---------------- */

const argv = process.argv.slice(2);
const flags = argv.filter(a => a.indexOf('--') === 0);
const files = argv.filter(a => a.indexOf('--') !== 0);
const dryRun = flags.indexOf('--dry-run') >= 0;
const force = flags.indexOf('--force') >= 0;

if (files.length < 2) {
  console.error('用法：node merge-spec.js <用户导出的 html> <原型 index.html> [--dry-run] [--force]');
  process.exit(1);
}

const srcPath = path.resolve(files[0]);
const dstPath = path.resolve(files[1]);

for (const p of [srcPath, dstPath]) {
  if (!fs.existsSync(p)) { console.error('找不到文件：' + p); process.exit(1); }
}

const src = fs.readFileSync(srcPath, 'utf8');
const dst = fs.readFileSync(dstPath, 'utf8');

const srcBody = findSpecBody(src);
const dstBody = findSpecBody(dst);

if (!srcBody) { console.error('导出文件里找不到 <div id="specBody">，它可能不是本原型导出的 HTML。' + '\n  文件：' + srcPath); process.exit(1); }
if (!dstBody) { console.error('目标文件里找不到 <div id="specBody">，它可能不是本 skill 生成的原型。' + '\n  文件：' + dstPath); process.exit(1); }
if (!dst.includes('id="protoTpl"')) {
  console.error('目标文件缺少 id="protoTpl"，看起来不是 page-prd 生成的原型：' + dstPath);
  process.exit(1);
}

// 导出基线只在导出文件里有意义，比对和写回原型时都去掉
const srcContent = srcBody.content.replace(/^(<div id="specBody"[^>]*?)\s+data-base-key="[^"]*"/, '$1');
const srcSpec = stripComments(srcContent), dstSpec = stripComments(dstBody.content);

console.log('');
console.log('=== 合并报告 ===');
console.log('来源（你导出的）：' + srcPath);
console.log('目标（原型原文件）：' + dstPath);

/* --- 危险内容检查（--force 也不放行） --- */
const unsafe = findUnsafe(srcSpec);
if (unsafe.length) {
  console.log('');
  console.log('[中止] 导出文件的说明区里有脚本或不认识的事件属性，可能被改过或来源不明：');
  unsafe.slice(0, 20).forEach(x => console.log('    ' + x));
  console.log('  请从原型页面重新点「导出 HTML」，再用新的导出文件合并。此项 --force 也不放行。');
  process.exit(2);
}

/* --- 结构对比 --- */
const srcPanes = splitPanes(srcSpec), dstPanes = splitPanes(dstSpec);
const srcMenus = srcPanes.map(p => p.menu), dstMenus = dstPanes.map(p => p.menu);
const srcFn = listFnKeys(srcPanes), dstFn = listFnKeys(dstPanes);

const missMenus = diffOf(dstMenus, srcMenus);
const missFn = diffOf(dstFn, srcFn);
const newMenus = diffOf(srcMenus, dstMenus);
const newFn = diffOf(srcFn, dstFn);

/* --- 导出后改动检查 --- */
const srcBase = (srcBody.content.match(/^<div id="specBody"[^>]*\sdata-base-key="([^"]*)"/) || [])[1];
const dstKey = (dst.match(/var PROTO_KEY = "([^"]*)"/) || [])[1];
const srcText = stripTags(srcSpec);
const lostAgent = agentEditedTexts(dstSpec).filter(t => srcText.indexOf(t) < 0);

console.log('');
console.log('[结构检查]');
console.log('  菜单一致：' + (missMenus.length === 0 && newMenus.length === 0 ? '是' : '有差异'));
console.log('    目标：' + (dstMenus.join(', ') || '（无）'));
console.log('    来源：' + (srcMenus.join(', ') || '（无）'));
console.log('');
console.log('[导出后改动检查]');
if (!srcBase) {
  console.log('  导出文件没有导出基线（旧版模板导出），无法判断原型文件在导出之后有没有被改过。');
} else if (srcBase === dstKey) {
  console.log('  ✅ 原型文件在导出之后没有被改过（导出基线 ' + srcBase + ' = 当前 key）');
} else {
  console.log('  ⚠️ 原型文件在导出之后被改过（导出基线 ' + srcBase + '，当前 key ' + (dstKey || '（无）') + '）');
}

let abort = false;
if (missMenus.length || missFn.length) {
  abort = true;
  console.log('');
  console.log('  [中止] 检测到「目标有、来源没有」的内容，说明你可能是基于旧版修改的：');
  if (missMenus.length) console.log('    缺失菜单：' + missMenus.join(', '));
  if (missFn.length) console.log('    缺失功能点：' + missFn.join(', '));
  console.log('  直接合并会丢掉这些内容。请二选一：');
  console.log('    1) 重新打开最新版的原型页面再改一次，然后重新导出；');
  console.log('    2) 确认就是要这么改，加 --force 强制执行。');
}
if (lostAgent.length) {
  abort = true;
  console.log('');
  console.log('  [中止] 目标里有 Agent 改写过（data-agent-edited）、导出文件里找不到的内容，合并会把它们冲掉：');
  lostAgent.slice(0, 20).forEach(t => console.log('    - ' + (t.length > 60 ? t.slice(0, 60) + '…' : t)));
  console.log('  请二选一：');
  console.log('    1) 打开最新版的原型页面，把浏览器里的改动重做一遍再导出；');
  console.log('    2) 确认这些 Agent 改写可以丢掉，加 --force 强制执行。');
}
if (abort) {
  if (!force) process.exit(2);
  console.log('');
  console.log('  （--force 已指定，强制执行）');
}

if (srcSpec === dstSpec) {
  console.log('');
  console.log('  两份说明完全一致，没有需要合并的改动。');
  console.log('  （如果确实改过，多半是没点「导出 HTML」，改动还在浏览器缓存里）');
  process.exit(0);
}

console.log('');
console.log('[本次改动]');
const userSectionsSrc = countUserSections(srcSpec);
const userSectionsDst = countUserSections(dstSpec);
const editedCells = countUserEdited(srcSpec);
console.log('  自定义章节：' + userSectionsSrc + ' 个' + (userSectionsDst !== userSectionsSrc ? '（原文件 ' + userSectionsDst + ' 个）' : ''));
console.log('  人工定稿标记（你改过的单元格）：' + editedCells + ' 处');
if (newFn.length) console.log('  新增功能点条目：' + newFn.join(', '));
console.log('  说明区体积：' + dstBody.content.length + ' → ' + srcContent.length + ' 字符');

if (dryRun) {
  console.log('');
  console.log('[--dry-run] 未写入任何文件。确认无误后去掉 --dry-run 再跑一次。');
  process.exit(0);
}

const backupPath = backup(dstPath, 'index-before-merge-');

/* --- 替换说明区 --- */
let merged = dst.slice(0, dstBody.start) + srcContent + dst.slice(dstBody.end);

/* --- 换 key --- */
const newKey = 'proto-' + Math.random().toString(36).slice(2, 10);
merged = merged.replace(/var PROTO_KEY = "[^"]*"/, 'var PROTO_KEY = "' + newKey + '"');

fs.writeFileSync(dstPath, merged, 'utf8');

console.log('');
console.log('[已写入]');
console.log('  原文件备份：' + backupPath);
console.log('  PROTO_KEY：' + (dstKey || '（无）') + ' → ' + newKey + '（防止浏览器旧缓存盖回来）');
console.log('  左侧原型：未改动（只替换了 #specBody 说明区）');
console.log('');
console.log('完成。请在浏览器刷新 ' + path.basename(dstPath) + ' 查看结果。');
console.log('后续迭代注意：带 data-user-edited 标记的内容是你的定稿，Agent 不得覆盖。');
console.log('');
