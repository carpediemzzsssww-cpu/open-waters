// Usage: npm run build:minitool. Point MINITOOL_SKILL_DIR at the unpacked official skill.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const artifact = 'open-waters-minitool-v1';
const dist = 'dist-minitool';
const zip = path.join('release', artifact + '.zip');
const roots = [process.env.MINITOOL_SKILL_DIR, '.codex/minitool-zip-builder', '../.codex/minitool-zip-builder',
  '.claude/minitool-zip-builder', '.skill/minitool-zip-builder'];
const official = roots.find(dir => dir && fs.existsSync(path.join(dir, 'scripts/audit_artifact.py')));
if (!official) throw new Error('Set MINITOOL_SKILL_DIR to the extracted minitool-zip-builder 1.11.1 directory.');
const skill = fs.readFileSync(path.join(official, 'SKILL.md'), 'utf8');
const version = skill.match(/^\s+version:\s*["']?([\d.]+)/m)?.[1];
if (version !== '1.11.1') throw new Error('This release uses minitool-zip-builder 1.11.1.');
for (const file of ['index.html', 'poster.webp']) fs.copyFileSync('minitool/static/' + file, path.join(dist, file));
fs.writeFileSync(path.join(dist, 'licenses.json'), JSON.stringify({
  'Open Waters': fs.readFileSync('LICENSE','utf8'), 'Three.js': fs.readFileSync('public/three-LICENSE.txt','utf8'),
}, null, 2));
const python = process.env.PYTHON || 'python3';
const audit = path.join(official, 'scripts/audit_artifact.py');
function run(bin, args) {
  const out = execFileSync(bin, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
  process.stdout.write(out);
  return out.trim().replaceAll(path.resolve(dist), dist).replaceAll(path.resolve(zip), zip);
}
const staticChecks = run(process.execPath, ['scripts/minitool/check-minitool.mjs', dist]);
const directoryAudit = run(python, [audit, dist]);
fs.mkdirSync('release', {recursive:true});
const pending = path.join('release',artifact + '.partial.zip');
const writeZip = [
  'import pathlib, sys, zipfile',
  'root = pathlib.Path(sys.argv[1])',
  'with zipfile.ZipFile(sys.argv[2], "w") as archive:',
  '    for source in sorted(root.rglob("*")):',
  '        if source.is_file():',
  '            name = source.relative_to(root).as_posix()',
  '            entry = zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))',
  '            entry.external_attr = 0o100644 << 16',
  '            archive.writestr(entry, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)',
].join('\n');
let zipAudit;
try {
  run(python, ['-c', writeZip, dist, pending]);
  zipAudit = run(python, [audit, pending]).replaceAll(pending, zip).replaceAll(path.resolve(zip), zip);
  fs.renameSync(pending, zip);
} finally { fs.rmSync(pending, {force:true}); }
const bytes = fs.readFileSync(zip);
const validation = {
  artifact: zip, skillVersion: version, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  files: fs.readdirSync(dist).sort(), staticChecks, directoryAudit, zipAudit,
  pending: ['创服平台模拟器', 'Android 真机扫码', 'iOS 真机扫码'],
};
fs.writeFileSync(zip.replace('.zip','.validation.json'), JSON.stringify(validation, null, 2) + '\n');
fs.writeFileSync(zip.replace('.zip','.validation.md'), [
  '# 小工具校验', '', '产物 `' + zip + '`（' + bytes.length + ' bytes）', '',
  'SHA-256 `' + validation.sha256 + '`', '',
  '官方 skill ' + version + '。离线文件清单、Chrome 61 目标脚本和样式检查通过。', '',
  '构建目录与 ZIP 通过官方 Python 审计。', '', ...validation.files.map(f => '- `' + f + '`'), '',
  '同一 ZIP 待创服平台模拟器、Android 与 iOS 真机扫码验证。', '',
].join('\n'));
console.log(zip, validation.sha256);
