/* global console, process, document, getComputedStyle */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
await page.goto('http://127.0.0.1:4173/Zpevnik/');
await page.getByLabel('Jméno nebo přezdívka').fill('Zkušební hudebník');
await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
await page.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor();
await page.goto('http://127.0.0.1:4173/Zpevnik/offline');
await page.locator('.offline-readiness .primary-button').waitFor();
// Measure settled state colors, without sampling an in-flight CSS transition.
await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
function ratio(a,b) {
  const luminance = c => { const channels = c.match(/[\d.]+/g).slice(0,3).map(Number).map(n => { if (!c.startsWith('color(srgb ')) n/=255; return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4; }); return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722; };
  const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
const results=[];
for (const theme of ['dark','light','monochrome']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
  for (const state of ['default','hover','focus','active','disabled']) {
    const button=page.locator('.offline-readiness .primary-button');
    await button.evaluate((node,state)=>{ node.disabled=state==='disabled'; },state);
    await page.mouse.move(0,0);
    if(state==='hover') await button.hover();
    if(state==='focus') await button.focus();
    if(state==='active') { await button.hover(); await page.mouse.down(); }
    const colors=await button.evaluate(node=>{ const css=getComputedStyle(node); return { color:css.color, background:css.backgroundColor, outline:css.outlineColor, outlineStyle:css.outlineStyle }; });
    const contrast=ratio(colors.color,colors.background); results.push({ theme,state,...colors,contrast:Number(contrast.toFixed(2)) });
    if(contrast<4.5) throw new Error(theme+' '+state+' contrast '+contrast);
    await page.mouse.move(0,0); await page.mouse.up();
  }
  const palette=await page.evaluate(()=>{
    const root=getComputedStyle(document.documentElement);
    const probe=document.createElement('span'); document.body.append(probe);
    const color=name=>{probe.style.setProperty('color',root.getPropertyValue(name).trim(),'important'); return getComputedStyle(probe).color;};
    const values=Object.fromEntries(['--bg','--surface','--surface-strong','--text','--muted','--primary','--success','--warning','--danger','--control-border'].map(name=>[name,color(name)]));probe.remove();return values;
  });
  for(const foreground of ['--text','--muted','--primary','--success','--warning','--danger','--control-border']){
    const minimum=Math.min(...['--bg','--surface','--surface-strong'].map(background=>ratio(palette[foreground],palette[background])));
    results.push({theme,foreground,minimum:Number(minimum.toFixed(2))});
    if(minimum<(foreground==='--control-border'?3:4.5))throw new Error(theme+' '+foreground+' palette contrast '+minimum+' '+JSON.stringify(palette));
  }
}
await page.getByRole('navigation', {name:'Hlavní navigace'}).getByRole('button', {name:'Domů',exact:true}).click();
await page.locator('.home-shortcuts').waitFor();
for (const theme of ['dark','light','monochrome']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
  for (const button of await page.locator('.home-shortcuts button').all()) {
    for (const state of ['default','hover','focus','active']) {
      await page.mouse.move(0,0);
      if(state==='hover') await button.hover();
      if(state==='focus') await button.focus();
      if(state==='active') { await button.hover(); await page.mouse.down(); }
      const colors=await button.evaluate(node=>({ name:node.getAttribute('aria-label'), background:getComputedStyle(node).backgroundColor, foregrounds:[...node.querySelectorAll('strong,small,svg')].map(child=>({ element:child.tagName,color:getComputedStyle(child).color,fontFamily:getComputedStyle(child).fontFamily })) }));
      for(const foreground of colors.foregrounds) {
        const contrast=ratio(foreground.color,colors.background);
        results.push({theme,state,shortcut:colors.name,...foreground,background:colors.background,contrast:Number(contrast.toFixed(2))});
        if(contrast<(foreground.element==='svg'?3:4.5)) throw new Error(theme+' '+colors.name+' '+state+' contrast '+contrast);
      }
      await page.mouse.move(0,0); await page.mouse.up();
    }
  }
}
await writeFile('docs/ui-redesign/contrast-results.json', JSON.stringify(results,null,2)+'\n');
console.log('PASS: computed button states and theme palette contrast; this is not a full WCAG audit.');
await browser.close();
process.exitCode=0;
