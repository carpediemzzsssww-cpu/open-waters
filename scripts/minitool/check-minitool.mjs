// Audit this project's fixed, offline release layout, its script and its stylesheet.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import postcss from 'postcss';

const root = process.argv[2] || 'dist-minitool';
const files = ['app.css','app.js','index.html','licenses.json','poster.webp'];
assert.deepEqual(readdirSync(root).sort(), files);
const read = name => readFileSync(join(root, name), 'utf8');
const html = read('index.html'), css = read('app.css'), js = read('app.js');
const scripts = [...html.matchAll(/<script\b([^>]*)>\s*<\/script>/gi)];
assert.equal(scripts.length, 1);
assert.ok(/\bsrc="\.\/app\.js"/.test(scripts[0][1]));
assert.ok(/\bdefer\b/.test(scripts[0][1]) || scripts[0].index > html.indexOf('id="hud"'));
assert.ok(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/app\.css"[^>]*>/.test(html));
assert.ok(html.includes('./poster.webp') && html.includes('id="boot"'));
assert.ok(!/<(?:iframe|audio|video|object)\b/i.test(html));
assert.ok(!/url\(\s*['"]?(?:https?:|\/)/i.test(html + css));
const sheet = postcss.parse(css);
const enhanced = /(?:^|[^-\w])(?:min|max|clamp)\(/i;
sheet.walkDecls(decl => {
  assert.ok(!['gap', 'inset'].includes(decl.prop), 'Use explicit edges or grid-gap for Chrome 61: ' + decl.prop);
  if (!enhanced.test(decl.value)) return;
  for (let rule = decl.parent; rule; rule = rule.parent) {
    if (rule.type === 'atrule' && rule.name === 'supports') return;
  }
  const fallback = decl.parent.nodes.slice(0, decl.parent.index(decl))
    .some(prior => prior.type === 'decl' && prior.prop === decl.prop && !enhanced.test(prior.value));
  assert.ok(fallback, 'Chrome 61 fallback needed for ' + decl.prop + ': ' + decl.value);
});
assert.deepEqual(Object.keys(JSON.parse(read('licenses.json'))), ['Open Waters', 'Three.js']);

const ast = parseAst(js, {sourceType:'script'});
const later = new Set(['ImportExpression','ImportDeclaration','ExportNamedDeclaration','ExportDefaultDeclaration',
  'ChainExpression','PrivateIdentifier','PropertyDefinition','StaticBlock','BigIntLiteral']);
function walk(node) {
  if (!node || typeof node !== 'object') return;
  assert.ok(!later.has(node.type), 'Classic WebView syntax: ' + node.type);
  if (node.type === 'CatchClause') assert.ok(node.param, 'Catch parameter required');
  if (node.type === 'LogicalExpression' || node.type === 'AssignmentExpression') assert.ok(!['??','??=','||=','&&='].includes(node.operator));
  if (node.type === 'ObjectExpression') assert.ok(node.properties.every(p=>p.type !== 'SpreadElement'));
  if (node.type === 'ObjectPattern') assert.ok(node.properties.every(p=>p.type !== 'RestElement'));
  if (node.type === 'Literal' && node.regex) assert.ok(!/[sdv]/.test(node.regex.flags) && !/\(\?<|\\[Pp]\{/.test(node.regex.pattern));
  Object.values(node).forEach(walk);
}
walk(ast);
for (const pattern of [
  /\b(?:XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|localStorage|sessionStorage|indexedDB|WebAssembly)\b/,
  /\b(?:fetch|eval|requestFullscreen|requestPictureInPicture|getUserMedia|createObjectURL|sendBeacon|openDatabase)\s*\(/,
  /\bnew\s+(?:Function|Worker|SharedWorker)\s*\(/,
  /navigator\.(?:geolocation|clipboard|bluetooth|usb|hid|credentials|serviceWorker)/,
  /\.location\.(?:href\s*=|replace\(|assign\(|reload\()/,
]) assert.ok(!pattern.test(js), 'Offline bundle contains: ' + pattern);
console.log('PASS: 5 local files, poster, licenses, classic script, restricted APIs and CSS baseline.');
