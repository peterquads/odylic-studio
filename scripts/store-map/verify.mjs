import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
const ok = (c, m, extra='') => { console.log((c?'  PASS  ':'  FAIL  ')+m+(extra?'  '+extra:'')); if(!c) fails.push(m); };
const URL = 'file://' + process.cwd() + '/us-store-map.html';

async function open(vp, theme='light') {
  const ctx = await b.newContext({ viewport:vp, colorScheme:theme, deviceScaleFactor:2, hasTouch:true });
  const p = await ctx.newPage();
  p.on('pageerror', e => fails.push('pageerror: ' + e.message));
  await p.goto(URL); await p.waitForTimeout(600);
  return p;
}
const V = p => p.evaluate(() => ({k, tx, ty, sel}));
const pos = (p, nm) => p.evaluate(n => {
  const d = DATA.pts.find(q => q.n === n);
  const r = document.querySelector('#mapwrap').getBoundingClientRect();
  const ox = (r.width - DATA.W*fit)/2, oy = (r.height - DATA.H*fit)/2;
  return [ r.left + ox + (tx + d.x*k)*fit, r.top + oy + (ty + d.y*k)*fit ];
}, nm);

console.log('\n— iPhone 390x844 —');
const p = await open({width:390,height:844});

// the map band should be filled by the map, not letterboxed into dead space
const band = await p.evaluate(() => {
  const r = document.querySelector('#mapwrap').getBoundingClientRect();
  return { wrapH:+r.height.toFixed(0), mapH:+(DATA.H*fit).toFixed(0), mapW:+(DATA.W*fit).toFixed(0), wrapW:+r.width.toFixed(0) };
});
ok(band.wrapH - band.mapH < 60, 'map fills its band (little dead space)', JSON.stringify(band));
ok(Math.abs(band.mapW - band.wrapW) < 2, 'map spans the full width');

// order on screen: header, chips, map, list
const order = await p.evaluate(() => ['.top','.chips','#mapwrap','.sheet']
  .map(s => +document.querySelector(s).getBoundingClientRect().top.toFixed(0)));
ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'map sits above the list', JSON.stringify(order));
ok(await p.evaluate(() => document.querySelector('.sheet').getBoundingClientRect().height) > 250, 'list panel has usable height');

let v0 = await V(p);
await p.click('#zin'); await p.waitForTimeout(200);
ok((await V(p)).k > v0.k, 'zoom-in button works over the map');
await p.click('#zout'); await p.waitForTimeout(150);
await p.evaluate(() => { k=6; tx=-120; ty=-40; apply(); });
await p.click('#zreset'); await p.waitForTimeout(200);
let vr = await V(p);
ok(vr.k===1 && vr.tx===0 && vr.ty===0, 'reset restores the US view');

let [x,y] = await pos(p,'Apple Fifth Avenue');
await p.mouse.click(x,y); await p.waitForTimeout(400);
ok((await V(p)).sel != null, 'tapping a pin selects it');
ok(await p.evaluate(() => document.querySelector('#detail h2').textContent) === 'Apple Fifth Avenue', 'detail shows the tapped store');
ok(await p.evaluate(() => {
  const d = DATA.pts[sel], r = document.querySelector('#mapwrap').getBoundingClientRect();
  const ox=(r.width-DATA.W*fit)/2, oy=(r.height-DATA.H*fit)/2;
  const sx=ox+(tx+d.x*k)*fit, sy=oy+(ty+d.y*k)*fit;
  return sx>0 && sx<r.width && sy>0 && sy<r.height;
}), 'selected pin stays inside the map band');
ok(await p.evaluate(() => document.querySelectorAll('.act').length) === 2, 'detail offers both map links');
ok(await p.evaluate(() => !!document.querySelector('#detail a[href^="tel:"]')), 'Apple detail exposes a tel: link');

await p.click('#back'); await p.waitForTimeout(200);
ok(await p.evaluate(() => document.querySelectorAll('.row').length) === 331, 'back returns to the full list');

await p.fill('#q','brooklyn'); await p.waitForTimeout(600);
const bk = await p.evaluate(() => ({n:document.querySelectorAll('.row').length, k}));
ok(bk.n>0 && bk.n<20, 'search narrows the list', bk.n+' rows');
ok(bk.k>1, 'search zooms to the matches', 'k='+bk.k.toFixed(1));
await p.fill('#q','aesop nolita'); await p.waitForTimeout(600);
ok(await p.evaluate(() => document.querySelectorAll('.row').length) === 1, 'search finds a single Aesop store by name');
await p.fill('#q','zzzz'); await p.waitForTimeout(500);
ok(await p.evaluate(() => !!document.querySelector('.empty')), 'no-match search shows an empty state');
await p.click('#clear'); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelectorAll('.row').length) === 331, 'clear restores every store');

await p.click('#t1'); await p.waitForTimeout(250);
ok(await p.evaluate(() => document.querySelectorAll('#pins circle:not(.off)').length) === 272, 'Aesop off leaves 272 Apple');
await p.click('#t1'); await p.click('#t0'); await p.waitForTimeout(250);
ok(await p.evaluate(() => document.querySelectorAll('#pins circle:not(.off)').length) === 59, 'Apple off leaves 59 Aesop');
await p.click('#t0'); await p.waitForTimeout(200);

await p.click('#info'); await p.waitForTimeout(300);
ok(await p.evaluate(() => document.querySelector('#dlg').open), 'info dialog opens');
await p.click('#dlgx'); await p.waitForTimeout(200);
ok(!(await p.evaluate(() => document.querySelector('#dlg').open)), 'info dialog closes');

const kb = (await V(p)).k;
await p.evaluate(() => {
  const w = document.querySelector('#mapwrap'); w.setPointerCapture = () => {};
  const mk=(id,x,y,t)=>w.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,bubbles:true,pointerType:'touch'}));
  mk(1,150,300,'pointerdown'); mk(2,250,300,'pointerdown');
  mk(1,100,300,'pointermove'); mk(2,300,300,'pointermove');
  mk(1,100,300,'pointerup');   mk(2,300,300,'pointerup');
});
await p.waitForTimeout(200);
ok((await V(p)).k > kb, 'pinch zooms in', `k ${kb.toFixed(2)} -> ${(await V(p)).k.toFixed(2)}`);
await p.click('#zreset'); await p.waitForTimeout(300);
await p.screenshot({ path:'shot-mobile-light.png' });

const sp = await open({width:390,height:844},'dark');
ok(await sp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(20, 23, 26)', 'dark theme paints its own ground');
await sp.click('.row'); await sp.waitForTimeout(400);
await sp.screenshot({ path:'shot-mobile-dark.png' });
await sp.evaluate(() => document.documentElement.setAttribute('data-theme','light'));
await sp.waitForTimeout(150);
ok(await sp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(239, 241, 238)', 'explicit light beats a dark OS');
await sp.evaluate(() => document.documentElement.setAttribute('data-theme','dark'));
await sp.waitForTimeout(150);
ok(await sp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(20, 23, 26)', 'explicit dark beats a light OS');

console.log('\n— small phone 360x640 —');
const sm = await open({width:360,height:640});
const sb = await sm.evaluate(() => {
  const r=document.querySelector('#mapwrap').getBoundingClientRect();
  const s=document.querySelector('.sheet').getBoundingClientRect();
  return { map:+r.height.toFixed(0), list:+s.height.toFixed(0), dead:+(r.height-DATA.H*fit).toFixed(0) };
});
ok(sb.list > 180 && sb.map > 150, 'small screen keeps both map and list usable', JSON.stringify(sb));
await sm.screenshot({ path:'shot-small.png' });

console.log('\n— desktop 1280x800 —');
const wp = await open({width:1280,height:800});
ok(await wp.evaluate(() => document.querySelector('.side').getBoundingClientRect().width) === 372, 'desktop shows the sidebar');
await wp.click('.row'); await wp.waitForTimeout(400);
ok(await wp.evaluate(() => sel != null), 'desktop row selects a store');
await wp.evaluate(() => select(null)); await wp.waitForTimeout(200);
await wp.screenshot({ path:'shot-desktop.png' });

for (const [nm,pg] of [['mobile',p],['small',sm],['desktop',wp]]) {
  const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(o === 0, nm + ' has no horizontal overflow');
}
await b.close();
const real = fails.filter(f => !/ERR_CONNECTION_RESET/.test(f));
console.log(real.length ? '\n'+real.length+' FAILURES:\n'+real.join('\n') : '\nall checks passed');
process.exit(real.length?1:0);
