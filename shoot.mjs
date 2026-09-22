import { chromium } from 'playwright';
const B = 'http://localhost:8901';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `/home/user/audit/shots/${n}.png`, fullPage: false });
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text().slice(0,160)); });
page.on('pageerror', e => console.log('PAGE ERR:', String(e).slice(0,200)));

await page.goto(B + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot('01-onboard');

await page.goto(B + '/?demo=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await shot('02-home');

await page.evaluate(() => App.go('stats'));
await page.waitForTimeout(1000);
await shot('03-stats');

await page.evaluate(() => App.go('calendar'));
await page.waitForTimeout(600);
await page.evaluate(() => { const t = new Date(); const ds = t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0'); Cal.selDay(ds); });
await page.waitForTimeout(500);
await shot('04-calendar');

await page.evaluate(() => Detail.open(Object.keys(Store.s.emis)[0]));
await page.waitForTimeout(600);
await shot('05-detail');
await page.evaluate(() => UI.closeOv('ov-detail'));

await page.evaluate(() => App.go('profile'));
await page.waitForTimeout(500);
await shot('06-profile');

await page.evaluate(() => Sheet.openAdd());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector('#ov-edit .sheet').scrollTo(0, 300));
await page.waitForTimeout(300);
await shot('07-add-sheet');

await page.evaluate(() => { UI.closeOv('ov-edit'); Store.s.meta.theme='dark'; applyTheme(); App.go('home'); });
await page.waitForTimeout(800);
await shot('08-home-dark');
await page.evaluate(() => App.go('stats'));
await page.waitForTimeout(700);
await shot('09-stats-dark');

await browser.close();
console.log('SHOTS DONE');
