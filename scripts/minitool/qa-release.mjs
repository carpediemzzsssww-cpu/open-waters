// Test the bytes intended for upload, including the ZIP layout, and bind the report to their digest.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = 'release/open-waters-minitool-v1';
const zip = base + '.zip';
const validationFile = base + '.validation.json';
const validation = JSON.parse(readFileSync(validationFile, 'utf8'));
const sha = createHash('sha256').update(readFileSync(zip)).digest('hex');
assert.equal(sha, validation.sha256, 'The ZIP differs from its official audit. Build it again.');
const directory = mkdtempSync(path.join(tmpdir(), 'open-waters-qa-'));
const reportDir = path.resolve(process.argv[2] || 'artifacts/minitool-qa');
try {
  const extract = [
    'import pathlib, sys, zipfile',
    'root = pathlib.Path(sys.argv[2])',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    '    for name in archive.namelist():',
    '        if pathlib.Path(name).name != name or name in (".", ".."): raise ValueError(name)',
    '        (root / name).write_bytes(archive.read(name))',
  ].join('\n');
  execFileSync(process.env.PYTHON || 'python3', ['-c', extract, zip, directory]);
  execFileSync(process.execPath, ['scripts/minitool/check-minitool.mjs', directory], {stdio: 'inherit'});
  execFileSync(process.execPath, ['scripts/minitool/qa.mjs', reportDir], {
    stdio: 'inherit', env: {...process.env, MINITOOL_DIST: directory},
  });
  const run = JSON.parse(readFileSync(path.join(reportDir, 'report.json'), 'utf8'));
  assert.equal(run.result, 'pass');
  validation.browserQA = {sha256: sha, ...run};
  writeFileSync(validationFile, JSON.stringify(validation, null, 2) + '\n');
  const md = base + '.validation.md';
  const heading = '\n## 离线交互回归';
  const summary = readFileSync(md, 'utf8').split(heading)[0].trimEnd();
  const table = Object.entries({seine:'塞纳河', fjord:'盖朗厄尔峡湾', seto:'濑户内海'}).map(([id,name]) => {
    const frame = run.samples.find(sample => sample.route === id);
    return '| ' + [name, frame.calls, frame.tris].join(' | ') + ' |';
  });
  writeFileSync(md, [
    summary, heading, '',
    '同一 ZIP 解压后在禁止外连的 CSP 下运行。桌面 Chrome ' + run.browser + '，测试画幅 ' +
      run.sizes.map(s => s.width + ' × ' + s.height).join('、') + '。', '',
    '- 三航区往返、手动掌舵、巡航、拨动黄昏和季节通过。重复换景后几何体、纹理和碰撞体计数稳定。',
    '- 1080 × 1440 明信片生成通过。模拟宿主核对了保存、发笔记、分享和陀螺仪的调用参数。',
    '- 验证了无脚本首屏、无 WebGL 兜底、上下文丢失与恢复。包外请求和运行报错均为 0。', '',
    '390 × 844 的航区起点采样，包含主画面、倒影和后期各遍。', '',
    '| 航区 | 绘制调用 | 三角形 |', '| --- | ---: | ---: |', ...table, '',
    '容器权限、真机帧率和内存峰值待创服平台模拟器及 Android、iOS 真机扫码验证。', '',
  ].join('\n'));
} finally {
  rmSync(directory, {recursive:true, force:true});
}
