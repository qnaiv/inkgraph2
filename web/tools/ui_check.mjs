// Real-interaction UI checks. Called from screenshots.mjs; each check uses its own browser context.
export async function runUiChecks(browser, U, ms) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([true, name]); console.log('PASS', name); }
    catch (e) { results.push([false, name]); console.log('FAIL', name, '-', String(e.message).split('\n')[0]); }
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg); };
  const open = async hash => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.route('https://fonts.**/**', r => r.abort());
    page.on('dialog', d => d.accept());
    await page.goto(U + '#live');
    if (ms) await page.evaluate(async ms => { await window.inkgraph.db.importAll(ms); }, ms);
    await page.goto(U + hash);
    await page.reload();
    await page.waitForTimeout(800);
    return { ctx, page };
  };

  await check('live idle: 「録画ファイルを選ぶ」 opens file chooser', async () => {
    const { ctx, page } = await open('#live');
    try {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        page.getByRole('button', { name: '録画ファイルを選ぶ' }).click(),
      ]);
      assert(fc, 'no file chooser');
    } finally { await ctx.close(); }
  });

  await check('detail timeline hover shows tooltip (局面/カウント差/勝率)', async () => {
    assert(ms && ms.length, 'no test data');
    const { ctx, page } = await open('#match/' + encodeURIComponent((ms[1] || ms[0]).id));
    try {
      const svg = page.locator('.timeline-svg').first();
      await svg.waitFor({ timeout: 5000 });
      const box = await svg.boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
      await page.mouse.move(box.x + box.width * 0.5 + 5, box.y + box.height * 0.4);
      const tip = page.locator('.tl-tooltip');
      await tip.waitFor({ state: 'visible', timeout: 3000 });
      const txt = await tip.innerText();
      assert(/カウント差/.test(txt) && /勝率/.test(txt) && /(抑え|打開|互角)/.test(txt), 'tooltip text: ' + txt);
    } finally { await ctx.close(); }
  });

  await check('match list: ⋯ → 削除 → confirm accepted → rows -1', async () => {
    assert(ms && ms.length, 'no test data');
    const { ctx, page } = await open('#list');
    try {
      const rows = page.locator('.match-row');
      const before = await rows.count();
      assert(before > 0, 'no rows');
      await rows.first().locator('summary.btn-dots').click();
      await rows.first().getByRole('button', { name: '削除' }).click();
      await page.waitForFunction(n => document.querySelectorAll('.match-row').length === n, before - 1, { timeout: 5000 });
    } finally { await ctx.close(); }
  });

  const failed = results.filter(r => !r[0]).length;
  console.log(`UI CHECKS: ${results.length - failed}/${results.length} passed`);
  return failed;
}
