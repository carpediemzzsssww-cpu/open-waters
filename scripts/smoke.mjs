// Run against a local production preview with Chrome installed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:5197';
const output = resolve(process.env.OUTPUT_DIR || 'artifacts/smoke');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
});
const errors = [];
function observe(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
}
const ready = page => page.waitForFunction(() => window.__openWaters?.ready, null, { timeout: 60000 });
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function switchTo(page, selector, voyage) {
  await Promise.all([
    page.waitForURL(u => u.searchParams.get('voyage') === voyage),
    page.locator(selector + ' [data-voyage="' + voyage + '"]').click(),
  ]);
  await ready(page);
  assert.equal((await state(page)).voyage, voyage);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observe(page);
  await page.goto(base);
  await ready(page);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: resolve(output, 'departure.png') });
  assert.equal((await state(page)).voyage, 'seine');
  await switchTo(page, '.title', 'fjord');
  await page.locator('.begin').click();
  for (const voyage of ['fjord', 'seto', 'seine']) {
    if (voyage !== 'fjord') {
      await page.locator('.atlas-trigger').click();
      await switchTo(page, '#voyage-atlas', voyage);
    }
    const start = await state(page);
    assert.ok(start.started && start.player.auto);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => window.advanceTime(1400));
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    const driven = await state(page);
    assert.ok(!driven.player.auto && Math.abs(driven.player.heading - start.player.heading) > 0.02);
    assert.ok(Math.hypot(driven.player.x - start.player.x, driven.player.z - start.player.z) > 0.4);
    await page.keyboard.press('Space');
    assert.ok((await state(page)).player.auto);
    console.log(voyage, 'boarding, throttle, steering, cruise OK');
  }
  for (const [name, query] of [
    ['seine', 'voyage=seine'],
    ['fjord', 'voyage=fjord'],
    ['seto', 'voyage=seto'],
    ['fjord-quay', 'voyage=fjord&z=30&x=28&yaw=-48'],
    ['seto-port', 'voyage=seto&z=-20&x=60&yaw=-42'],
  ]) {
    await page.goto(base + '/?' + query + '&ui=0&perf&flow=0');
    await ready(page);
    await page.screenshot({ path: resolve(output, name + '.png') });
    if (name === 'seto') {
      const traffic = await page.evaluate(() => {
        const world = window.__openWaters;
        const ferry = world.parts.flatMap(part => part.boats || [])[0];
        const before = ferry.z;
        window.advanceTime(2000);
        return { travelled: Math.abs(ferry.z - before), wake: world.water.uniforms.uBoats.value[0].w };
      });
      assert.ok(traffic.travelled > 0.1 && traffic.wake > 0, 'ferry moves and contributes a wake');
    }
  }
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  observe(mobile);
  await mobile.goto(base + '/?voyage=seto');
  await ready(mobile);
  await mobile.locator('.begin').tap();
  await mobile.locator('.pad .r').waitFor({ state: 'visible' });
  const cdp = await mobile.context().newCDPSession(mobile);
  const pad = await mobile.locator('.pad .r').boundingBox();
  const touchPoints = [{ x: pad.x + pad.width / 2, y: pad.y + pad.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await mobile.evaluate(() => window.advanceTime(650));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal((await state(mobile)).player.auto, false);
  await mobile.locator('.mode').tap();
  assert.equal((await state(mobile)).player.auto, true);
  await mobile.locator('.clock').tap();
  await mobile.locator('[data-season="winter"]').tap();
  assert.equal((await state(mobile)).time.season, 'winter');
  await mobile.locator('.time-close').tap();
  await mobile.locator('.atlas-trigger').tap();
  await mobile.screenshot({ path: resolve(output, 'mobile-atlas.png') });
  await switchTo(mobile, '#voyage-atlas', 'fjord');
  assert.ok((await state(mobile)).started);
  await mobile.close();
  assert.deepEqual(errors, [], 'browser console and runtime errors');
  console.log('Touch controls, clock, winter and mobile voyage switching OK');
} finally {
  await browser.close();
}
