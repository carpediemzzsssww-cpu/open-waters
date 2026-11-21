// Host mocks only exercise our UI and arguments. Real container permissions need on-device testing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve-csp.mjs';

const out = path.resolve(process.argv[2] || 'artifacts/minitool-qa');
await fs.mkdir(out, {recursive:true});
const {url,server} = await serve(process.env.MINITOOL_DIST || 'dist-minitool');
const errors = [], resources = [], sizes = [], samples = [];
let browser;
try {
  browser = await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',
    args:['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio']});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await context.addInitScript(() => {
    // Chrome 61 has WebGL2 but predates ES2021 weak references.
    window.WeakRef = undefined;
    window.FinalizationRegistry = undefined;
    window.auditCalls = [];
    window.xhs = {launchOptions:{miniToolEnv:{buildVersion:9550001}},miniTool:{
      getWindowInfo: async () => ({windowHeight:innerHeight,safeArea:{top:34,bottom:innerHeight-25},
        menuButtons:{capsule:{left:220,top:34,bottom:74,width:128,height:40}}}),
      writeTempFile: async args => {window.auditCalls.push(['temp',args.data.startsWith('data:image/jpeg;base64,')]);return {filePath:'local-postcard.jpg'};},
      saveImageToPhotosAlbum: async args => window.auditCalls.push(['album',args.filePath]),
      postNote: async args => window.auditCalls.push(['note',args.mediaInfo.image_resources[0].url]),
      share: async args => window.auditCalls.push(['share',args.type,args.image_resource]),
      onGyroscopeChange: fn => {window.gyroSample=fn;},
      offGyroscopeChange: fn => {if(window.gyroSample===fn)delete window.gyroSample;},
      startGyroscope: async args => window.auditCalls.push(['gyroStart',args.interval]),
      stopGyroscope: async () => window.auditCalls.push(['gyroStop']),
      vibrateShort: async args => window.auditCalls.push(['haptic',args.type]),
    }};
    document.addEventListener('securitypolicyviolation',e=>window.auditCalls.push(['CSP',e.violatedDirective]));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('console',m=>{if(m.type()==='error' || /INVALID_OPERATION/.test(m.text()))errors.push(m.text());});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(!r.url().startsWith('data:'))resources.push(r.url());});
  page.on('response',r=>{if(r.status()>=400)errors.push('HTTP '+r.status()+' '+r.url());});
  await page.goto(url+'?perf&flow=0');
  await page.waitForSelector('body.boot-done:not(.fallback)',{timeout:60000});

  const measure = async id => {
    const data=await page.evaluate(()=>{
      const w=window.__openWaters;
      // Complete one frame after the forced environment preparation on each route change.
      w.step(16);
      const {fps: simulatedFps, ...rendered} = w.info();
      return {route:JSON.parse(window.render_game_to_text()).voyage, ...rendered, ...w.renderer.info.memory,
        colliders:w.colliders.length, sun:w.env.sunDir.toArray(), objects:w.scene.children.length};
    });
    assert.equal(data.route,id); assert.ok(data.tris>0); samples.push(data);
    console.log(id,JSON.stringify(data));
  };
  const visit = async id=>{
    await page.locator('.atlas').tap();
    await page.locator('[data-voyage="'+id+'"]').tap();
    await page.waitForFunction(id=>!document.querySelector('#hud').classList.contains('loading-route') &&
      JSON.parse(window.render_game_to_text()).voyage===id,id);
    assert.equal(await page.locator('body.fallback').count(),0);
  };
  await measure('seine');
  await visit('fjord'); // Switching also works before boarding.
  await page.locator('.begin').tap();
  await page.locator('.clock').tap();
  await page.locator('[data-dusk="1"]').tap();
  await page.locator('[data-season="winter"]').tap();
  await page.evaluate(()=>window.advanceTime(4500));
  assert.equal(await page.evaluate(()=>JSON.parse(window.render_game_to_text()).time.season),'winter');
  assert.ok(await page.evaluate(()=>window.__openWaters.env.dusk>.95));
  await page.locator('.time-close').tap();
  await page.locator('.title').waitFor({state:'detached'});
  await page.screenshot({path:path.join(out,'fjord-blue.png')});
  await page.locator('.gyro').tap();
  const look=await page.evaluate(()=>{
    const w=window.__openWaters, start=w.player.lookYaw;
    window.gyroSample({x:0,y:1,z:0});w.step(50);return [start,w.player.lookYaw];
  });
  assert.notEqual(look[0],look[1]);
  await page.locator('.mode').tap();
  await page.evaluate(()=>window.advanceTime(20));
  const before=await page.evaluate(()=>window.__openWaters.player.throttle);
  const button=await page.locator('[aria-label="加速"]').boundingBox();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:button.x+12,y:button.y+12}]});
  await page.evaluate(()=>window.advanceTime(360));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok(await page.evaluate(()=>window.__openWaters.player.throttle)>before);
  await page.locator('.sound').tap();
  await page.locator('.shutter').tap();
  await page.waitForFunction(()=>document.querySelector('.postcard img')?.naturalWidth===1080);
  assert.equal(await page.locator('.postcard img').evaluate(img=>img.naturalHeight),1440);
  await page.screenshot({path:path.join(out,'mobile-postcard.png')});
  await page.locator('.save').tap();
  await page.locator('.post').tap();
  await page.locator('.share').tap();
  await page.locator('.close-photo').tap();
  const calls=await page.evaluate(()=>window.auditCalls);
  assert.deepEqual(calls.filter(v=>v[0]==='album'||v[0]==='note'),[['album','local-postcard.jpg'],['note','local-postcard.jpg']]);
  assert.equal(calls.filter(v=>v[0]==='temp').length,3);
  assert.ok(calls.every(v=>v[0]!=='CSP'));
  assert.ok(calls.some(v=>v[0]==='share' && v[1]==='image' && v[2]==='local-postcard.jpg'));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--mt-top').trim()),'84px');
  // Hold a common dusk, pose and season when comparing repeated visits.
  await page.evaluate(()=>{const a=window.__openWaters.api;a.setSeason('summer');a.scrubDusk(.03);});
  for(const id of ['seto','seine','fjord','seto','seine','fjord','seto','seine']){
    await visit(id); await measure(id);
  }
  assert.ok(await page.evaluate(()=>!window.gyroSample && window.auditCalls.some(v=>v[0]==='gyroStop')));
  for(const route of ['seine','fjord','seto']){
    const rounds=samples.filter(s=>s.route===route).slice(-2);
    assert.equal(rounds.length,2);
    for (const k of ['geometries','textures','colliders','objects']) assert.equal(rounds[0][k],rounds[1][k],route+' '+k);
  }
  const lowPower = await page.evaluate(() => {
    const w=window.__openWaters;
    w.state.renderScale=.6;
    w.step(16);
    const sample={calls:w.info().calls, tris:w.info().tris, dynamicReflection:w.water.uniforms.uLiveReflection.value, bloom:w.post.mFinal.uniforms.uBloom.value};
    w.state.renderScale=1; w.step(16);
    return sample;
  });
  assert.equal(lowPower.dynamicReflection,0); assert.equal(lowPower.bloom,0);
  assert.ok(lowPower.calls<samples[0].calls);
  for (const [width,height] of [[320,568],[390,844],[430,932],[568,320]]) {
    await page.setViewportSize({width,height});
    await page.locator('.clock').tap();
    const box=await page.locator('.time-panel').boundingBox();
    assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('.time-close').tap();
    sizes.push({width,height});
  }
  await page.evaluate(()=>{delete window.xhs;});
  await page.locator('.shutter').tap();
  assert.equal(await page.locator('.save').isVisible(),false);
  assert.equal(await page.locator('.post').isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('.postcard img').naturalWidth===1080);
  await page.locator('.close-photo').tap();
  // Use the platform's actual WebGL context loss / restore events.
  await page.evaluate(()=>{const gl=window.__openWaters.renderer.getContext();window.qaLose=gl.getExtension('WEBGL_lose_context');window.qaLose.loseContext();});
  await page.waitForSelector('body.gl-lost',{state:'attached'});
  await page.evaluate(()=>window.qaLose.restoreContext());
  await page.waitForFunction(()=>!window.__openWaters.state.lost);
  await page.evaluate(()=>window.advanceTime(16));
  await visit('fjord');
  await visit('seine');
  await page.evaluate(()=>window.qaLose.loseContext());
  await page.waitForSelector('body.fallback',{state:'attached'});
  await context.close();
  // Exercise the normal RAF path separately from deterministic navigation input.
  const live=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const livePage=await live.newPage();
  livePage.on('pageerror',e=>errors.push(e.message));
  await livePage.goto(url);
  await livePage.waitForFunction(()=>window.__openWaters?.state.fade > .8,{},{timeout:60000});
  await livePage.waitForFunction(()=>document.body.classList.contains('boot-done') && getComputedStyle(document.querySelector('.begin')).opacity==='1');
  await livePage.screenshot({path:path.join(out,'mobile-start.png')});
  await livePage.locator('.begin').tap();
  const start=await livePage.evaluate(()=>window.__openWaters.player.z);
  await livePage.waitForFunction(z=>window.__openWaters.player.z<z-.2,start,{timeout:30000});
  await livePage.locator('.title').waitFor({state:'detached'});
  const liveFrame=await livePage.screenshot({path:path.join(out,'seine-sailing.png')});
  const contrast=await livePage.evaluate(async data=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,32,32);
    const rgba=ctx.getImageData(0,0,32,32).data;
    const l=[];for(let n=0;n<rgba.length;n+=4)l.push(rgba[n]*.2126+rgba[n+1]*.7152+rgba[n+2]*.0722);
    l.sort((a,b)=>a-b);return l[Math.floor(l.length*.9)]-l[Math.floor(l.length*.1)];
  },liveFrame.toString('base64'));
  assert.ok(contrast>28,'Real-frame luminance range: '+contrast);
  await live.close();
  const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  const staticPage=await noJS.newPage();await staticPage.goto(url);
  assert.ok(await staticPage.locator('#boot').isVisible());
  await staticPage.screenshot({path:path.join(out,'offline-first-paint.png')});await noJS.close();
  const noGL=await browser.newContext();
  await noGL.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(name,...rest){return name==='webgl2'?null:get.call(this,name,...rest);};});
  const fallback=await noGL.newPage();await fallback.goto(url);
  await fallback.waitForSelector('body.fallback #boot');await noGL.close();
  assert.ok(resources.every(r=>r.startsWith(url)),JSON.stringify(resources));
  assert.deepEqual(errors,[]);
  const report={result:'pass',browser:browser.version(),realFrameLuminanceRange:contrast,lowPower,sizes,samples,hostCalls:calls,
    offline:{outsidePackageRequests:0,errors},pending:['创服平台模拟器','Android 真机','iOS 真机']};
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Mobile strict-CSP browser regression passed.',out);
} finally {await browser?.close();server.close();}
