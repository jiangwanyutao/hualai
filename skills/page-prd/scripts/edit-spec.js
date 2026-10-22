#!/usr/bin/env node
/*
 * edit-spec.js —— Agent 维护原型需求说明的辅助脚本
 *
 * 用法（每次选一个参数，都指向原型原文件 index.html）：
 *   node edit-spec.js <index.html> --list      列出说明区结构（菜单 / 功能点 / 子项 / 表格列权限），用于定位改哪里
 *   node edit-spec.js <index.html> --bump-key  备份改动前的文件 + 换 PROTO_KEY（改说明之前跑，备份是 --verify 的比对基线）
 *   node edit-spec.js <index.html> --verify    与最近一次 --bump-key 的备份比对：确认左侧原型零改动 + 报告说明区差异
 *   node edit-spec.js <index.html> --check     自检原型结构（生成或迭代原型后跑）
 *   node edit-spec.js <index.html> --to-md     把说明区导出成 Markdown
 *   node edit-spec.js <index.html> --norm      CRLF 归一化成 LF（多行 Edit 匹配失败时先跑它，写之前先备份）
 *
 * 设计要点：
 *   - 本脚本**不替你改内容**，内容用编辑工具精确改 #specBody 里的单元格 / 子项
 *   - --bump-key 与 --verify 成对使用：先 --bump-key 备份再改，改完 --verify 校验「原型没被动」
 *   - 解析说明区前先去掉 HTML 注释，注释里的示例卡片不算数
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------------- 通用工具 ---------------- */

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
}
function pad(n) { return String(n).length < 2 ? '0' + n : '' + n; }
function stamp() {
  const d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function brief(s, n) {
  const t = stripTags(s);
  return t.length > n ? t.slice(0, n) + '…' : (t || '（空）');
}
function stripComments(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }

const BACKUP_KEEP = 20;
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

/** 精确定位 #specBody 起止（div 深度配平；注释里的 div 文字不计数） */
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
    } else { depth++; }
  }
  if (end < 0) return null;
  return { start, end, content: stripComments(html.slice(start, end)) };
}

/** 左侧原型区 = protoTpl 模板 + 所有 <script> 代码块（改说明时这两块必须字节不变） */
function extractProto(html) {
  const tplKey = html.indexOf('<script type="text/x-template" id="protoTpl">');
  let tpl = '';
  if (tplKey >= 0) {
    const end = html.indexOf('</script>', tplKey);
    tpl = html.slice(tplKey, end >= 0 ? end + 9 : html.length);
  }
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/type="text\/x-template"/.test(m[1])) continue; // 已在 tpl 里
    scripts.push(m[2]);
  }
  // PROTO_KEY 每次改动都会变，比对原型逻辑时必须排除，否则必报假差异
  const scriptsJoined = scripts.join('\n/*----*/\n').replace(/var PROTO_KEY = "[^"]*"/g, '');
  return { tpl, scripts: scriptsJoined };
}

/** 按 menu-pane 切分说明区 */
function splitPanes(specHtml) {
  const re = /<div class="menu-pane[^"]*"\s+data-menu="([^"]+)"(?:\s+data-label="([^"]*)")?/g;
  const marks = [];
  let m;
  while ((m = re.exec(specHtml)) !== null) marks.push({ i: m.index, menu: m[1], label: m[2] || m[1] });
  if (!marks.length) return [];
  return marks.map((x, idx) => ({
    menu: x.menu,
    label: x.label,
    html: specHtml.slice(x.i, idx + 1 < marks.length ? marks[idx + 1].i : specHtml.length)
  }));
}

/** 表格信息：列名 + 权限 + 行数 */
function tablesOf(html) {
  const out = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1];
    const head = (inner.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '';
    const cols = [];
    const thRe = /<th\b([^>]*)>([\s\S]*?)<\/th>/g;
    let t;
    while ((t = thRe.exec(head)) !== null) {
      const name = stripTags(t[2]);
      cols.push({
        name: name,
        // 锁定列的两种写法：th 带 class="lock"，或表头文字自带 🔒
        lock: /class="[^"]*\block\b/.test(t[1]) || /🔒/.test(name)
      });
    }
    const rows = (inner.match(/<tr\b/g) || []).length - (head ? 1 : 0);
    out.push({ cols, rows: Math.max(rows, 0) });
  }
  return out;
}

/** 功能点卡片 */
function fnCardsOf(html) {
  const out = [];
  const re = /<div class="fn item"\s+data-k="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="fn item"|$)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const k = m[1], body = m[2];
    const name = (body.match(/<span class="fn-name">([\s\S]*?)<\/span>/) || [])[1] || '';
    const subs = [];
    const sRe = /<div class="sub"><div class="sub-k">([\s\S]*?)<\/div><div class="sub-v([^"]*)"([^>]*)>([\s\S]*?)<\/div><\/div>/g;
    let s;
    while ((s = sRe.exec(body)) !== null) {
      const hasTable = /<table\b/.test(s[4]);
      subs.push({
        key: stripTags(s[1]),
        classes: s[2].trim(),
        editable: /data-edit/.test(s[3]),
        text: hasTable ? '（表格，见下方列信息）' : brief(s[4], 46),
        empty: !hasTable && stripTags(s[4]).length === 0
      });
    }
    out.push({ k, name: stripTags(name), subs, tables: tablesOf(body), body });
  }
  return out;
}

/** 锁定单元格文本集合（用于 verify 判定「原型绑定项有没有被改」） */
function lockTexts(html) {
  const out = [];
  const re = /<(?:td|th)\b[^>]*class="[^"]*\block\b[^"]*"[^>]*>([\s\S]*?)<\/(?:td|th)>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(stripTags(m[1]));
  return out;
}
function countOf(html, re) { return (html.match(re) || []).length; }

/* ---------------- 命令实现 ---------------- */

function cmdList(file) {
  const html = fs.readFileSync(file, 'utf8');
  const body = findSpecBody(html);
  if (!body) { console.error('找不到 <div id="specBody">，这不是本 skill 生成的原型：' + file); process.exit(1); }
  const key = (html.match(/var PROTO_KEY = "([^"]*)"/) || [])[1] || '（无）';
  const panes = splitPanes(body.content);

  console.log('');
  console.log('=== 需求说明结构（场景 C 定位用）===');
  console.log('文件：' + file);
  console.log('PROTO_KEY：' + key);
  console.log('菜单数：' + panes.length + '　功能点数：' + countOf(body.content, /class="fn item"/g) +
              '　表格数：' + tablesOf(body.content).length);
  console.log('人工定稿标记：' + countOf(body.content, /data-user-edited/g) +
              '　Agent 改写标记：' + countOf(body.content, /data-agent-edited/g));
  console.log('');

  panes.forEach((p, i) => {
    console.log('[' + (i + 1) + '] 菜单：' + p.label + '　(data-menu="' + p.menu + '")');
    // 一、页面概述
    const overview = p.html.slice(0, p.html.indexOf('二、功能说明') >= 0 ? p.html.indexOf('二、功能说明') : p.html.length);
    const ovSubs = [];
    const sRe = /<div class="sub"><div class="sub-k">([\s\S]*?)<\/div><div class="sub-v([^"]*)"([^>]*)>([\s\S]*?)<\/div><\/div>/g;
    let s;
    while ((s = sRe.exec(overview)) !== null) {
      ovSubs.push({ key: stripTags(s[1]), editable: /data-edit/.test(s[3]), text: brief(s[4], 40) });
    }
    console.log('  一、页面概述');
    ovSubs.forEach(x => console.log('    · ' + x.key + (x.editable ? ' [可改]' : ' [锁定]') + '：' + x.text));
    tablesOf(overview).forEach(t => {
      console.log('    · 权限说明表 ' + t.rows + ' 行　列：' +
        t.cols.map(c => (/[🔒✏]/.test(c.name) ? c.name : c.name + ' ✏')).join(' | '));
    });
    // 二、功能说明
    console.log('  二、功能说明');
    fnCardsOf(p.html).forEach(f => {
      console.log('    ' + f.k + ' ' + f.name + (f.tables.length ? '（含 ' + f.tables.length + ' 张表）' : ''));
      f.subs.forEach(x => {
        console.log('        - ' + x.key + (x.editable ? ' [可改]' : ' [锁定]') +
          (x.empty ? '（当前留空）' : '：' + x.text));
      });
      f.tables.forEach(t => {
        console.log('        - 表格 ' + t.rows + ' 行　列：' +
          t.cols.map(c => (/[🔒✏]/.test(c.name) ? c.name : c.name + ' ✏')).join(' | '));
      });
    });
    console.log('');
  });
  console.log('提示：改内容之前先跑 --bump-key（备份改动前的文件当比对基线），再精确改 #specBody 里的 <td>/<div class="sub-v">，改完跑 --verify。');
  console.log('');
}

function cmdBumpKey(file) {
  const html = fs.readFileSync(file, 'utf8');
  const backupPath = backup(file, 'index-before-edit-');

  const oldKey = (html.match(/var PROTO_KEY = "([^"]*)"/) || [])[1];
  const newKey = 'proto-' + Math.random().toString(36).slice(2, 10);
  const out = html.replace(/var PROTO_KEY = "[^"]*"/, 'var PROTO_KEY = "' + newKey + '"');
  fs.writeFileSync(file, out, 'utf8');

  console.log('');
  console.log('[已备份] ' + backupPath);
  console.log('[已换 key] ' + (oldKey || '（无）') + ' → ' + newKey);
  console.log('');
  console.log('⚠️  换 key 会让用户浏览器里的旧缓存失效。如果用户在浏览器里改过说明但还没导出，');
  console.log('    那些改动会在他下次刷新时消失。执行场景 C 前必须先确认这一点。');
  console.log('');
  console.log('下一步：改说明内容，改完跑 node edit-spec.js "' + file + '" --verify');
  console.log('');
}

function cmdVerify(file) {
  const dir = path.dirname(file);
  const archiveDir = path.join(dir, '_archive');
  if (!fs.existsSync(archiveDir)) {
    console.error('没有 _archive/ 备份目录，无法比对。请先跑 --bump-key 再改。');
    process.exit(1);
  }
  // 只认 --bump-key 留下的备份；合并备份是合并前的状态，不能当场景 C 的基线
  const backups = fs.readdirSync(archiveDir)
    .filter(f => /^index-before-edit-.*\.html$/.test(f))
    .sort();
  if (!backups.length) {
    console.error('_archive/ 里没有 --bump-key 留下的备份（index-before-edit-*.html）。请先跑 --bump-key 再改。');
    process.exit(1);
  }
  const basePath = path.join(archiveDir, backups[backups.length - 1]);
  const cur = fs.readFileSync(file, 'utf8');
  const base = fs.readFileSync(basePath, 'utf8');

  const pc = extractProto(cur), pb = extractProto(base);
  const cb = findSpecBody(cur), bb = findSpecBody(base);
  if (!cb || !bb) { console.error('有一份文件找不到 #specBody，中止。'); process.exit(1); }

  const tplSame = md5(pc.tpl) === md5(pb.tpl);
  const jsSame = md5(pc.scripts) === md5(pb.scripts);

  console.log('');
  console.log('=== 场景 C 改动校验 ===');
  console.log('当前：' + file);
  console.log('基线：' + basePath);
  console.log('');
  console.log('[左侧原型区]');
  console.log('  protoTpl 模板：' + (tplSame ? '✅ 未改动' : '❌ 有改动（场景 C 默认不该动原型，确认是否用户已同意）'));
  console.log('  脚本逻辑：' + (jsSame ? '✅ 未改动' : '❌ 有改动'));

  console.log('');
  console.log('[右侧说明区]');
  // 比对键带上菜单名，避免不同菜单里的同名功能点互相掩盖
  const fnKeys = (spec) => [].concat.apply([], splitPanes(spec).map(p =>
    fnCardsOf(p.html).map(f => p.label + '/' + f.k + f.name)));
  const curFn = fnKeys(cb.content);
  const baseFn = fnKeys(bb.content);
  const addFn = curFn.filter(x => baseFn.indexOf(x) < 0);
  const delFn = baseFn.filter(x => curFn.indexOf(x) < 0);
  console.log('  功能点：' + baseFn.length + ' → ' + curFn.length +
    (addFn.length ? '　新增：' + addFn.join('、') : '') +
    (delFn.length ? '　删除：' + delFn.join('、') : ''));

  const cl = lockTexts(cb.content), bl = lockTexts(bb.content);
  const addLock = cl.filter(x => bl.indexOf(x) < 0);
  const delLock = bl.filter(x => cl.indexOf(x) < 0);
  console.log('  锁定单元格（🔒 与原型强绑定）：' + bl.length + ' → ' + cl.length);
  if (addLock.length || delLock.length) {
    console.log('  ⚠️  锁定内容变了 —— 说明与左侧原型已经不匹配，必须让用户确认是否同步改原型：');
    addLock.slice(0, 12).forEach(x => console.log('      + ' + x));
    delLock.slice(0, 12).forEach(x => console.log('      - ' + x));
  } else {
    console.log('  ✅ 锁定内容未变（说明与原型仍匹配）');
  }

  const stat = (h) => ({
    edit: countOf(h, /\sdata-edit\b/g),
    lock: countOf(h, /class="[^"]*\block\b/g),
    user: countOf(h, /data-user-edited/g),
    agent: countOf(h, /data-agent-edited/g)
  });
  const sc = stat(cb.content), sb = stat(bb.content);
  console.log('  可编辑单元格：' + sb.edit + ' → ' + sc.edit + '　锁定单元格：' + sb.lock + ' → ' + sc.lock);
  console.log('  人工定稿标记：' + sb.user + ' → ' + sc.user +
    (sc.user < sb.user ? '　⚠️ 减少了，可能覆盖了用户定稿，请复查' : ''));
  console.log('  Agent 改写标记：' + sb.agent + ' → ' + sc.agent);
  console.log('  说明区体积：' + bb.content.length + ' → ' + cb.content.length + ' 字符');
  console.log('');

  const ok = tplSame && jsSame && !addLock.length && !delLock.length && sc.user >= sb.user;
  console.log(ok ? '✅ 校验通过：只改了说明，原型未动，未覆盖用户定稿。'
                 : '⚠️ 有需要人工确认的项，见上方 ⚠️/❌ 行。');
  console.log('');
  process.exit(ok ? 0 : 3);
}

/* ---- 生成说明 Markdown（替代页面上已删除的「导出 Markdown」按钮） ---- */

/** 从 startIdx 处的 <div ...> 开始做 div 深度配平，返回整块内容 */
function extractBlock(html, startIdx) {
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = startIdx;
  let depth = 0, end = -1, m, started = false;
  while ((m = re.exec(html)) !== null) {
    if (!started) { started = true; depth = 1; continue; }
    if (m[0].slice(0, 2) === '</') {
      depth--;
      if (depth === 0) { end = m.index + m[0].length; break; }
    } else { depth++; }
  }
  if (end < 0) return null;
  return { start: startIdx, end, html: html.slice(startIdx, end) };
}
function allBlocks(html, cls) {
  const out = [];
  const re = new RegExp('<div class="' + cls + '[\\s"]', 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const b = extractBlock(html, m.index);
    if (b) { out.push(b); re.lastIndex = b.end; }
  }
  return out;
}
function tableToMd(inner) {
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const cells = [];
    const cRe = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g;
    let c;
    while ((c = cRe.exec(m[1])) !== null) cells.push(stripTags(c[1]).replace(/\|/g, '\\|'));
    rows.push(cells);
  }
  if (!rows.length) return '';
  let out = '| ' + rows[0].join(' | ') + ' |\n| ' + rows[0].map(() => '---').join(' | ') + ' |\n';
  rows.slice(1).forEach(r => { out += '| ' + r.join(' | ') + ' |\n'; });
  return out;
}
function subToMd(blockHtml) {
  const k = (blockHtml.match(/<div class="sub-k">([\s\S]*?)<\/div>/) || [])[1] || '';
  const key = stripTags(k);
  const vRe = /<div class="sub-v([^"]*)"([^>]*)>/;
  const vm = vRe.exec(blockHtml);
  if (!vm) return '';
  const vb = extractBlock(blockHtml, vm.index);
  if (!vb) return '';
  const cls = vm[1].trim();
  const inner = vb.html.slice(vm[0].length, vb.html.length - 6); // 去掉自身 <div...> 与末尾 </div>
  if (/<table\b/.test(inner)) return '**' + key + '**：\n\n' + tableToMd(inner) + '\n';
  const rules = /\brules\b/.test(cls);
  const items = [];
  const dRe = /<div\b[^>]*>([\s\S]*?)<\/div>/g;
  let d;
  while ((d = dRe.exec(inner)) !== null) {
    const t = stripTags(d[1]);
    if (t) items.push(t);
  }
  if (!items.length) {
    const plain = stripTags(inner);
    if (!plain) return '- **' + key + '**：（待补充）\n';
    items.push(plain);
  }
  if (rules) return '- **' + key + '**：\n' + items.map(x => '  - ' + x).join('\n') + '\n';
  return '- **' + key + '**：' + items.join(' ') + '\n';
}
function cmdToMd(file) {
  const html = fs.readFileSync(file, 'utf8');
  const body = findSpecBody(html);
  if (!body) { console.error('找不到 <div id="specBody">：' + file); process.exit(1); }
  const moduleName = (html.match(/<body[^>]*data-module="([^"]*)"/) || [])[1] || '原型';
  let md = '# 需求说明\n\n';
  splitPanes(body.content).forEach(p => {
    md += '# ' + p.label + '\n\n';
    // section 标题
    const secRe = /<h3[^>]*>([\s\S]*?)<\/h3>/g;
    const secs = [];
    let sm;
    while ((sm = secRe.exec(p.html)) !== null) secs.push({ i: sm.index, title: stripTags(sm[1]) });
    const fns = allBlocks(p.html, 'fn item');
    // 按文档顺序取所有 sub（含功能点卡片内的）
    const allSubs = [];
    const sRe = /<div class="sub"/g;
    let s;
    while ((s = sRe.exec(p.html)) !== null) {
      const b = extractBlock(p.html, s.index);
      if (b) { allSubs.push(b); sRe.lastIndex = b.end; }
    }
    const inFn = (idx) => fns.some(f => idx >= f.start && idx < f.end);
    // 输出：按文档顺序，遇 section 标题输出，遇 fn 输出卡片头，其余 sub 输出子项
    const events = [];
    secs.forEach(x => events.push({ i: x.i, type: 'sec', title: x.title }));
    fns.forEach(f => events.push({ i: f.start, type: 'fn', block: f }));
    allSubs.forEach(b => { if (!inFn(b.start)) events.push({ i: b.start, type: 'sub', block: b }); });
    events.sort((a, b) => a.i - b.i);
    events.forEach(e => {
      if (e.type === 'sec') { md += '## ' + e.title + '\n\n'; return; }
      if (e.type === 'fn') {
        const num = (e.block.html.match(/class="num"[^>]*>([\s\S]*?)<\//) || [])[1] || '';
        const name = (e.block.html.match(/class="fn-name">([\s\S]*?)<\//) || [])[1] || '';
        md += '### ' + stripTags(num) + ' ' + stripTags(name) + '\n\n';
        allBlocks(e.block.html, 'sub').forEach(sb => { md += subToMd(sb.html); });
        md += '\n';
        return;
      }
      md += subToMd(e.block.html);
    });
    md += '\n';
  });
  const outPath = path.join(path.dirname(file), moduleName.replace(/[\\/:*?"<>|]/g, '') + '-需求说明-' + stamp() + '.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log('');
  console.log('[已生成需求说明 Markdown]');
  console.log('  ' + outPath);
  console.log('  字数：' + md.length + ' 字符');
  console.log('');
}

function cmdNorm(file) {
  const s = fs.readFileSync(file, 'utf8');
  if (s.indexOf('\r\n') < 0) { console.log('已经是 LF，无需处理。'); return; }
  const backupPath = backup(file, 'index-before-norm-');
  fs.writeFileSync(file, s.replace(/\r\n/g, '\n'), 'utf8');
  console.log('已把 CRLF 归一化为 LF：' + file);
  console.log('原文件备份：' + backupPath);
}

/* ---- 自检原型结构（生成或迭代原型后跑） ---- */

/** 去掉 HTML 注释和 JS 注释后的代码，用于查残留的 ★ 占位（行注释不匹配 http:// 里的 //） */
function stripAllComments(html) {
  return stripComments(html).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}
/** 每个菜单 pane：权限说明表第 1 列的功能点 + 功能点卡片名称 */
function paneFnCheck(p) {
  const cut = p.html.indexOf('二、功能说明');
  const overview = cut >= 0 ? p.html.slice(0, cut) : p.html;
  const perm = [];
  const re = /<tr>\s*<td class="lock">([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(overview)) !== null) perm.push(stripTags(m[1]));
  const cards = fnCardsOf(p.html).map(f => f.name);
  return { onlyPerm: perm.filter(x => cards.indexOf(x) < 0), onlyCard: cards.filter(x => perm.indexOf(x) < 0) };
}
function cmdCheck(file) {
  const html = fs.readFileSync(file, 'utf8');
  const body = findSpecBody(html);
  if (!body) { console.error('找不到 <div id="specBody">：' + file); process.exit(1); }
  const panes = splitPanes(body.content);
  const paneMenus = panes.map(p => p.menu);
  const tplStart = html.indexOf('id="protoTpl"');
  const tpl = tplStart >= 0 ? html.slice(tplStart, html.indexOf('</script>', tplStart)) : '';
  const navMenus = [];
  const navRe = /switchMenu\('([^']+)'\)/g;
  let m;
  while ((m = navRe.exec(tpl)) !== null) if (navMenus.indexOf(m[1]) < 0) navMenus.push(m[1]);
  const moduleName = (html.match(/<body[^>]*\sdata-module="([^"]*)"/) || [])[1];
  const activeMenu = (html.match(/<body[^>]*\sdata-active-menu="([^"]*)"/) || [])[1];
  const key = (html.match(/var PROTO_KEY = "([^"]*)"/) || [])[1];
  const stars = stripAllComments(html).split('\n').filter(l => l.indexOf('★') >= 0).map(l => l.trim());
  const fnIssues = [];
  panes.forEach(p => {
    const r = paneFnCheck(p);
    if (r.onlyPerm.length) fnIssues.push(p.label + '：权限表有、卡片没有 → ' + r.onlyPerm.join('、'));
    if (r.onlyCard.length) fnIssues.push(p.label + '：卡片有、权限表没有 → ' + r.onlyCard.join('、'));
  });
  const scripts = (html.match(/<script\b[^>]*\ssrc="[^"]*"/g) || []).join('\n');
  const visible = stripAllComments(html);
  // emoji 不能当图标；🔒 ✏ 是说明表头的编辑权限标记，★ 是模板占位（由占位检查负责），不算
  const emojis = (visible.match(/\p{Extended_Pictographic}/gu) || []).filter(e => ['🔒', '✏', '★'].indexOf(e) < 0);
  const tplVisible = stripComments(tpl);
  const nativeControls = tplVisible.match(/<select\b|<input[^>]*type="(checkbox|radio)"/g) || [];

  const checks = [
    ['data-module 已填', !!moduleName && moduleName.indexOf('★') < 0, moduleName || '（缺失）'],
    ['data-active-menu 指向已有菜单', paneMenus.indexOf(activeMenu) >= 0, activeMenu || '（缺失）'],
    ['protoTpl 模板', !!tpl, ''],
    ['PROTO_KEY 已换成真实值', !!key && key.indexOf('★') < 0, key || '（缺失）'],
    ['fileStamp 时间戳函数', html.indexOf('function fileStamp()') >= 0, ''],
    ['导出时写导出基线 data-base-key', html.indexOf("setAttribute('data-base-key'") >= 0, ''],
    ['结尾 </html> 闭合', html.trim().endsWith('</html>'), ''],
    ['没有「导出 Markdown」按钮', !/<button[^>]*>[^<]*导出 Markdown/.test(stripComments(html)), ''],
    ['没有残留的 ★ 占位', !stars.length, stars.slice(0, 5).join(' ｜ ')],
    ['左侧菜单都有说明 pane', navMenus.every(x => paneMenus.indexOf(x) >= 0),
      '左侧：' + navMenus.join(', ') + '；pane：' + paneMenus.join(', ')],
    ['说明 pane 都有左侧菜单', paneMenus.every(x => navMenus.indexOf(x) >= 0), ''],
    ['权限表功能点 = 功能点卡片', !fnIssues.length, fnIssues.join('；')],
    ['卡片没有类型标签', !/class="fn-type/.test(body.content), ''],
    ['CDN 带版本号', !/cdn\.tailwindcss\.com"/.test(scripts) && !/vue@3\//.test(scripts), ''],
    ['加载 HeroUI 官方样式（带版本号）', /@heroui\/styles@\d+\.\d+\.\d+\/dist\/heroui\.min\.css/.test(html), ''],
    ['Tailwind 用 v4 浏览器版', /@tailwindcss\/browser@4\.\d+\.\d+/.test(scripts) && !/cdn\.tailwindcss\.com/.test(scripts), ''],
    ['没有用 emoji 当图标（图标用 lucide）', !emojis.length, [...new Set(emojis)].join(' ')],
    ['左侧原型没有原生下拉框、复选框、单选框', !nativeControls.length, nativeControls.slice(0, 3).join(' ')],
    ['编号气泡用 num-badge（badge 是 HeroUI 的组件类）', !/class="badge(-in)?[\s"]/.test(visible), ''],
    ['工具条有「导出给 AI」', html.indexOf('onclick="openAiPrompt()"') >= 0 && html.indexOf('function aiPrompt()') >= 0, ''],
    ['没有 document 级 .item 点击监听', !/closest\('\.item'\)/.test(html), '']
  ];

  console.log('');
  console.log('=== 原型结构自检 ===');
  console.log('文件：' + file);
  checks.forEach(c => console.log('  ' + (c[1] ? '✅' : '❌') + ' ' + c[0] + (c[1] || !c[2] ? '' : '：' + c[2])));
  const failed = checks.filter(c => !c[1]).length;
  console.log('');
  console.log(failed ? '❌ 有 ' + failed + ' 项没通过，按上方提示修好后再跑。' : '✅ 自检通过。');
  console.log('');
  process.exit(failed ? 1 : 0);
}

/* ---------------- 入口 ---------------- */

const argv = process.argv.slice(2);
const flags = argv.filter(a => a.indexOf('--') === 0);
const files = argv.filter(a => a.indexOf('--') !== 0);

if (!files.length || !flags.length) {
  console.error('用法：node edit-spec.js <index.html> [--list | --bump-key | --verify | --check | --to-md | --norm]');
  process.exit(1);
}
const file = path.resolve(files[0]);
if (!fs.existsSync(file)) { console.error('找不到文件：' + file); process.exit(1); }

if (flags.indexOf('--list') >= 0) cmdList(file);
else if (flags.indexOf('--bump-key') >= 0) cmdBumpKey(file);
else if (flags.indexOf('--verify') >= 0) cmdVerify(file);
else if (flags.indexOf('--check') >= 0) cmdCheck(file);
else if (flags.indexOf('--to-md') >= 0) cmdToMd(file);
else if (flags.indexOf('--norm') >= 0) cmdNorm(file);
else { console.error('未知参数：' + flags.join(' ')); process.exit(1); }
