import {createRequire} from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {chromium}=require('playwright');
const out=process.argv[2];
const log=(...a)=>console.log(...a);
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2});
const page=await context.newPage();
await page.goto('http://127.0.0.1:4173/');
const btn=page.getByRole('button',{name:'Guides'});
await btn.waitFor();
const state=async()=>page.evaluate(()=>{const svg=document.querySelector('.preview-guides svg');const surf=document.querySelector('.preview-surface').getBoundingClientRect();const s=svg?.getBoundingClientRect();return {lines:svg?svg.querySelectorAll('g:last-child line').length:0,surface:[surf.x,surf.y,surf.width,surf.height].map(Math.round),svg:s?[s.x,s.y,s.width,s.height].map(Math.round):null,pe:svg?getComputedStyle(document.querySelector('.preview-guides')).pointerEvents:null,active:document.querySelector('[title="Guides"]').className.includes('active-tool'),stored:localStorage.getItem('opensekai.scene.guides')};});
log('initial',JSON.stringify(await state()));
// mouse: open menu, choose Thirds
await btn.click();
const items=page.getByRole('menuitemcheckbox');
log('items',await items.count(),JSON.stringify(await items.evaluateAll(e=>e.map(x=>[x.textContent,x.getAttribute('aria-checked')]))));
await page.getByRole('menuitemcheckbox',{name:'Thirds'}).click();
log('after mouse thirds',JSON.stringify(await state()));
// keyboard: focus button, Enter, ArrowUp? first item focused = Center mark, Enter
await btn.focus();await page.keyboard.press('Enter');
log('focused',await page.evaluate(()=>document.activeElement?.textContent));
await page.keyboard.press('Enter');
log('after keyboard center',JSON.stringify(await state()));
await page.screenshot({path:out+'/guides-16x9.png'});
// keyboard: open, ArrowDown to Thirds, Space toggles off
await btn.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');
log('focused',await page.evaluate(()=>document.activeElement?.textContent));
await page.keyboard.press('Space');
log('after keyboard thirds off',JSON.stringify(await state()));
// escape closes
await btn.click();await page.keyboard.press('Escape');log('menu after escape',await page.getByRole('menu').count());
// resize
await page.setViewportSize({width:900,height:900});await page.waitForTimeout(200);
log('after resize',JSON.stringify(await state()));
// reload persistence
await page.reload();await btn.waitFor();await page.waitForTimeout(200);
log('after reload',JSON.stringify(await state()));
// forced aspect ratios on the surface
for(const [w,h,name] of [[360,640,'9x16'],[640,480,'4x3']]){
 await page.evaluate(([w,h])=>{const s=document.querySelector('.preview-surface');s.style.width=w+'px';s.style.height=h+'px';},[w,h]);
 await btn.click();await page.getByRole('menuitemcheckbox',{name:'Thirds'}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.waitForTimeout(100);
 const lines=await page.evaluate(()=>[...document.querySelectorAll('.preview-guides g:last-child line')].map(l=>[l.getAttribute('x1'),l.getAttribute('y1'),l.getAttribute('x2'),l.getAttribute('y2')].map(Number)));
 log(name,JSON.stringify(await state()),JSON.stringify(lines));
 await page.screenshot({path:out+`/guides-${name}.png`});
 await btn.click();await page.getByRole('menuitemcheckbox',{name:'Thirds'}).click();
}
// a second click on the button closes its menu
await btn.click();log('menu open',await page.getByRole('menu').count());await btn.click();log('menu after second click',await page.getByRole('menu').count(),'expanded',await btn.getAttribute('aria-expanded'));
// pointer passes through: element at the center of the surface
log('hit at center',await page.evaluate(()=>{const r=document.querySelector('.preview-surface').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/3)?.tagName;}));
await browser.close();
