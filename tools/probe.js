// Prints the game's layout sizes at a given viewport, to check the field fills the frame.
const { chromium } = require('playwright-core');
(async () => {
  const [w, h] = (process.argv[2] || '390x693').split('x').map(Number);
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
  const p = await ctx.newPage();
  await p.goto('file:///C:/Users/mapab/Latern%20Rise/lantern-rise.html');
  await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => {
    const r = id => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return `${id}: ${Math.round(b.width)}x${Math.round(b.height)} @${Math.round(b.left)},${Math.round(b.top)}`; };
    return [r('stage'), r('field'), 'inner ' + innerWidth + 'x' + innerHeight].join('\n');
  }));
  await b.close();
})();
