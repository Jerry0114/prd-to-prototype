#!/usr/bin/env node
// Optional integration suite: npm install --no-save --package-lock=false playwright
// Then npx playwright install chromium && npm run test:browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');
const { createPrototypeProjectServer } = require('../scripts/serve_prototype_project.js');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-viewer-browser-'));
const output = path.join(root, 'test-results/viewer');
fs.cpSync(path.join(root, 'examples/task-board/prototype'), fixture, { recursive: true });
fs.rmSync(path.join(fixture, 'annotations'), { force: true, recursive: true });
fs.mkdirSync(output, { recursive: true });
let browser;
const server = createPrototypeProjectServer(fixture);
let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator('#activePageTitle')).toHaveText('任务列表');
  await expect(page.locator('.statusbar .annotation-storage-status')).toHaveAttribute('data-state', 'saved');
  const canvasFrame = () => page.frameLocator('.page-node iframe');
  const annotationTab = () => page.locator('#inspector [data-handoff-tab="annotations"]');
  const save = async () => {
    await page.locator('.annotation-edit-form button[type="submit"]').click();
    await expect(page.locator('.statusbar .annotation-storage-status')).toHaveAttribute('data-state', 'saved');
  };
  await test('右侧默认标注，仅两个入口，无空背景和无待确认占位', async () => {
    await expect(annotationTab()).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#inspector [role="tab"]')).toHaveCount(2);
    await expect(page.locator('#inspector [data-handoff-tab="overview"], #inspector [data-handoff-tab="states"], #inspector [data-handoff-tab="delivery"]')).toHaveCount(0);
    await expect(page.locator('#inspector .tab-question-count')).not.toBeVisible();
    await page.locator('#inspector [data-handoff-tab="page-info"]').click();
    await expect(page.locator('#inspector .page-purpose')).toHaveText('搜索和筛选团队任务，进入对应任务详情。');
    await expect(page.locator('#inspector [data-info-section="context"], #inspector .page-open-questions')).toHaveCount(0);
    await expect(page.locator('#inspector')).not.toContainText('当前没有待确认事项');
    await page.locator('#inspector [data-info-section="acceptance"] > summary').click();
    await expect(page.locator('#inspector .acceptance-row')).toHaveCount(4);
    await expect(page.locator('#inspector .info-note')).toContainText('不代表已执行通过');
    await annotationTab().click();
  });
  await test('列表分割线开合不跳动，两面板标题行与嵌套层级稳定', async () => {
    const same = (a, b) => assert(Math.abs(a - b) < 1);
    try {
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 960 });
        if (width === 375) {
          await expect(page.locator('#toggleInspector')).toHaveAttribute('aria-expanded', 'false');
          await page.locator('#toggleInspector').click();
        }
        await annotationTab().click();
        const item = page.locator('#inspector .annotation-item').first();
        const toggle = item.locator('.annotation-disclosure');
        if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
        const closed = await item.boundingBox();
        const title = await item.locator('.annotation-title-row').boundingBox();
        await toggle.click();
        const expanded = await item.boundingBox();
        same(closed.x, expanded.x); same(closed.width, expanded.width);
        same(title.height, (await item.locator('.annotation-title-row').boundingBox()).height);
        await page.locator('#inspector [data-handoff-tab="page-info"]').click();
        const group = page.locator('#inspector [data-info-section="rules"]');
        const summary = group.locator(':scope > summary');
        if (await group.getAttribute('open') !== null) await summary.click();
        const groupClosed = await group.boundingBox();
        const summaryClosed = await summary.boundingBox();
        same(closed.x, groupClosed.x); same(closed.width, groupClosed.width);
        same(closed.height, groupClosed.height);
        await summary.click();
        const groupOpen = await group.boundingBox();
        same(groupClosed.x, groupOpen.x); same(groupClosed.width, groupOpen.width);
        same(summaryClosed.height, (await summary.boundingBox()).height);
        const nested = group.locator('[data-info-section="applicability"]');
        assert((await nested.locator(':scope > summary').boundingBox()).x > groupOpen.x);
        assert((await nested.locator(':scope > summary').boundingBox()).height < summaryClosed.height);
        await nested.locator(':scope > summary').click();
        same(groupOpen.width, (await group.boundingBox()).width);
        assert(await page.locator('#inspector .handoff-panel.is-active').evaluate(e => e.scrollWidth <= e.clientWidth));
      }
    } finally {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(base);
    }
  });
  await test('标注分段可读且不改原文，自由文本与长标题安全显示', async () => {
    const file = path.join(fixture, 'intermediate/page-specs/task-list.json');
    const original = fs.readFileSync(file, 'utf8');
    const content = '展示内容\n<img src=x onerror=alert(1)> 保持文字\n\n自由补充\n保留自定义段落\n\n交互逻辑\n点击后查看结果';
    try {
      const spec = JSON.parse(original);
      spec.annotations[0].content = content;
      spec.annotations[0].title = '长标题与层级验证'.repeat(10);
      fs.writeFileSync(file, JSON.stringify(spec));
      await page.reload();
      const item = page.locator('#inspector .annotation-item').first();
      const toggle = item.locator('.annotation-disclosure');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      await expect(item.locator('.annotation-section-heading')).toHaveText(['展示内容', '交互逻辑']);
      await expect(item.locator('.annotation-prose')).toHaveText('自由补充\n保留自定义段落');
      await expect(item.locator('.annotation-description img')).toHaveCount(0);
      await expect(item.locator('.annotation-description')).toContainText('<img src=x onerror=alert(1)>');
      assert(await item.evaluate(e => e.scrollWidth <= e.clientWidth));
      const openHeader = await item.locator('.annotation-title-row').boundingBox();
      await toggle.click();
      assert.equal((await item.locator('.annotation-title-row').boundingBox()).height, openHeader.height);
      await item.locator('[data-marker-action="edit"]').click();
      await expect(page.locator('.annotation-edit-form textarea')).toHaveValue(content);
      await page.locator('[data-marker-action="cancel"]').click();
      assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(spec));
    } finally {
      fs.writeFileSync(file, original);
      await page.goto(base);
    }
  });
  await test('待确认计数可发现、已处理项不计数，背景与问题按需保留', async () => {
    const file = path.join(fixture, 'intermediate/page-specs/task-list.json');
    const original = fs.readFileSync(file, 'utf8');
    try {
      const spec = JSON.parse(original);
      spec.openQuestions = [{ id: 'Q1', question: '筛选是否需要保存到下次会话？', impact: '影响保存范围', status: 'open', currentAssumption: '当前仅在本次会话保存' }, { id: 'Q2', question: '旧版来源已核对', impact: '不再影响本轮', status: 'confirmed' }];
      spec.handoff.pageOverview = { roles: [{ label: '受邀成员' }], preconditions: [{ label: '已获得当前项目访问权限' }] };
      fs.writeFileSync(file, JSON.stringify(spec));
      await page.reload();
      await expect(annotationTab()).toHaveAttribute('aria-selected', 'true');
      const tab = page.locator('#inspector [data-handoff-tab="page-info"]');
      await expect(tab).toHaveAttribute('aria-label', '页面说明，有 1 项待确认');
      await expect(tab.locator('.tab-question-count')).toBeVisible();
      await tab.click();
      await expect(page.locator('#inspector .page-open-questions')).toBeInViewport();
      await expect(page.locator('#inspector .page-open-questions')).toContainText('当前仅在本次会话保存');
      const contextGroup = page.locator('#inspector [data-info-section="context"]');
      await contextGroup.locator(':scope > summary').click();
      await expect(contextGroup).toContainText('已获得当前项目访问权限');
      await page.screenshot({ path: path.join(output, 'page-info-pending.png') });
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.locator('#toggleInspector')).toHaveAttribute('aria-expanded', 'false');
      await page.locator('#toggleInspector').click();
      await expect(tab).toBeInViewport();
      await expect(tab.locator('.tab-question-count')).toBeVisible();
      assert(await tab.evaluate(element => element.scrollWidth <= element.clientWidth));
      await page.screenshot({ path: path.join(output, 'page-info-pending-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 960 });
      await expect(page.locator('#toggleInspector')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#pageNav [data-page="task-detail"]').click();
      await expect(page.locator('#inspector .tab-question-count')).not.toBeVisible();
    } finally {
      fs.writeFileSync(file, original);
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto(base);
    }
  });
  await test('规格优先于过期镜像，镜像已删点位不复活，模块正文不串台', async () => {
    const file = path.join(fixture, 'prototype.json');
    const original = fs.readFileSync(file, 'utf8');
    try {
      const manifest = JSON.parse(original);
      manifest.pages[0].markers[0].content = '过期镜像：完成任务并返回';
      manifest.pages[0].markers.push({ ...manifest.pages[0].markers[0], id: 'obsolete-note' });
      fs.writeFileSync(file, JSON.stringify(manifest));
      await page.reload();
      await annotationTab().click();
      await expect(page.locator('.annotation-item')).toHaveCount(2);
      await expect(page.locator('.annotation-item').first()).toContainText('输入或切换进度后立即更新列表');
      await expect(page.locator('.annotation-item').first()).not.toContainText('过期镜像');
      await page.screenshot({ path: path.join(output, 'annotation-v22.png') });
    } finally {
      fs.writeFileSync(file, original);
      await page.goto(base);
    }
  });
  await test('单行顶栏整合工具，删除重复标题，右下角可打开快捷键', async () => {
    await expect(page.locator('#projectName, .contextbar, .sidebar-heading, .sidebar-footer, .inspector-title')).toHaveCount(0);
    await expect(page.locator('#previousPage, #nextPage, #resetButton, #pageStateSelect, .state-button')).toHaveCount(0);
    await expect(page.locator('header #copyLinkButton')).toBeInViewport();
    assert.equal((await page.locator('#workspace').boundingBox()).y, 64);
    assert.equal(await page.locator('#zoomMenuButton').evaluate(element => Boolean(element.closest('header'))), true);
    const folderFont = await page.locator('.nav-folder').first().evaluate(element => getComputedStyle(element).fontSize);
    assert.equal(await page.locator('.nav-title').first().evaluate(element => getComputedStyle(element).fontSize), folderFont);
    await page.locator('footer #shortcutsButton').click();
    await expect(page.locator('#shortcutsDialog')).toBeVisible();
    await page.locator('#closeShortcuts').click();
  });
  await test('自动适应画布，说明面板不随缩放改变宽度', async () => {
    await expect(canvasFrame().locator('#keyword')).toBeVisible();
    const workspace = await page.locator('#workspace').boundingBox();
    const frame = await page.locator('.screen-frame').boundingBox();
    assert(frame.x >= workspace.x && frame.x + frame.width <= workspace.x + workspace.width + 1);
    assert(frame.y >= workspace.y && frame.y + frame.height <= workspace.y + workspace.height - 40);
    const before = await page.locator('#inspector').boundingBox();
    await page.locator('#zoomMenuButton').click();
    await page.locator('[data-zoom-level="1.25"]').click();
    const after = await page.locator('#inspector').boundingBox();
    assert.equal(after.width, before.width);
    assert(Math.abs((await page.locator('.screen-frame').boundingBox()).width - 1280 * 1.25) < 2);
    await page.locator('#fitButton').click();
  });
  await test('顶部提示快速出现，切换按钮更新内容，支持键盘与 Esc 关闭', async () => {
    const tooltip = page.locator('#controlTooltip');
    assert.equal(await page.locator('#fitButton').getAttribute('title'), null);
    await page.mouse.move(400, 300);
    await page.locator('#fitButton').hover();
    await expect(tooltip).toBeVisible({ timeout: 500 });
    await expect(tooltip).toHaveText('适应画布（0）');
    await page.screenshot({ path: path.join(output, 'quick-tooltip.png') });
    await page.locator('#copyLinkButton').hover();
    await expect(tooltip).toHaveText('复制当前页面链接', { timeout: 500 });
    await page.keyboard.press('Escape');
    await expect(tooltip).not.toBeVisible();
    await page.mouse.move(400, 300);
    await page.locator('#workspace').focus();
    await page.keyboard.press('Tab');
    await page.locator('#fitButton').focus();
    await expect(tooltip).toBeVisible({ timeout: 300 });
    await expect(page.locator('#fitButton')).toHaveAttribute('aria-describedby', 'controlTooltip');
    await page.locator('#fitButton').click();
    await expect(tooltip).not.toBeVisible();
    await expect(page.locator('#fitButton')).not.toHaveAttribute('aria-describedby', 'controlTooltip');
  });
  await test('页面树切换、搜索、快捷键与页签键盘操作', async () => {
    await page.locator('#pageNav [data-page="task-detail"]').click();
    await expect(page.locator('#activePageTitle')).toHaveText('任务详情');
    await page.locator('#pageNav [data-page="task-list"]').click();
    await page.locator('#workspace').focus();
    await page.keyboard.press('/');
    await expect(page.locator('#pageSearch')).toBeFocused();
    await page.locator('#pageSearch').fill('不存在');
    await expect(page.locator('#pageNav')).toContainText('未找到');
    await page.locator('#pageSearch').fill('详情');
    await expect(page.locator('#pageNav .nav-item')).toHaveCount(1);
    await page.locator('#pageSearch').fill('');
    await page.locator('#inspector [data-handoff-tab="page-info"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(annotationTab()).toBeFocused();
    await expect(page.locator('#activePageTitle')).toHaveText('任务列表');
    await page.locator('#workspace').focus();
    await page.keyboard.press('?');
    await expect(page.locator('#shortcutsDialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcutsDialog')).not.toBeVisible();
  });
  await test('右侧保留状态规则，业务筛选自然展示无结果与正常内容', async () => {
    await page.locator('[data-handoff-tab="page-info"]').click();
    const rules = page.locator('#inspector [data-info-section="rules"]');
    await expect(rules).not.toHaveAttribute('open', '');
    await rules.locator(':scope > summary').click();
    await expect(rules.locator(':scope > .page-info-content > .state-summary')).toHaveCount(3);
    await expect(rules).toContainText('列表区域显示失败和重试入口');
    const record = rules.locator('[data-info-section="applicability"]');
    await expect(record.locator('.state-summary.is-inapplicable').first()).not.toBeVisible();
    await record.locator(':scope > summary').click();
    await expect(record.locator('.state-summary')).toHaveCount(6);
    await expect(record.locator('.state-summary.is-inapplicable')).toHaveCount(2);
    for (const select of [canvasFrame().locator('#status')]) {
      const geometry = await select.evaluate(element => {
        const style = getComputedStyle(element);
        return { appearance: style.appearance, start: style.paddingInlineStart, end: style.paddingInlineEnd, position: style.backgroundPosition, size: style.backgroundSize, image: style.backgroundImage, width: element.clientWidth };
      });
      assert.equal(geometry.appearance, 'none');
      assert.equal(geometry.start, '12px');
      assert.equal(geometry.end, '36px');
      assert(geometry.position.includes('12px') && geometry.size === '12px 12px');
      assert(geometry.image.includes('data:image/svg+xml') && geometry.width > 48);
    }
    await canvasFrame().locator('#keyword').fill('不存在的任务');
    await expect(canvasFrame().locator('#task-rows')).toContainText('没有找到');
    await canvasFrame().locator('#keyword').fill('');
    await expect(canvasFrame().locator('[data-task]')).toHaveCount(3);
    await canvasFrame().locator('#status').selectOption('doing');
    await expect(canvasFrame().locator('[data-task]')).toHaveCount(1);
    await canvasFrame().locator('#status').selectOption('all');
    await annotationTab().click();
  });
  await test('运行预览传参、标记完成、返回恢复筛选与关闭回到审阅', async () => {
    await page.locator('#runPrototypeButton').click();
    const preview = page.frameLocator('#previewFrame');
    await preview.locator('#keyword').fill('帮助');
    await expect(preview.locator('[data-task]')).toHaveCount(1);
    await preview.locator('[data-task]').click();
    await expect(preview.locator('#complete')).toBeVisible();
    await preview.locator('#complete').click();
    await expect(preview.locator('#complete')).toHaveText('已完成');
    await preview.locator('#back').click();
    await expect(preview.locator('#keyword')).toHaveValue('帮助');
    await expect(preview.locator('.status.done')).toHaveCount(1);
    await page.locator('#closePreview').click();
    await expect(page.locator('#previewDialog')).not.toBeVisible();
    await expect(canvasFrame().locator('#keyword')).toHaveValue('帮助');
    await canvasFrame().locator('#keyword').fill('');
  });
  await test('未保存标注切页保护，编辑写入文件并在刷新后保留', async () => {
    await annotationTab().click();
    await page.locator('[data-marker-action="edit"]').first().click();
    await page.locator('.annotation-edit-form input').fill('浏览器验证备注');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#pageNav [data-page="task-detail"]').click();
    await expect(page.locator('#activePageTitle')).toHaveText('任务列表');
    await expect(page.locator('.annotation-edit-form input')).toHaveValue('浏览器验证备注');
    await save();
    assert(fs.readFileSync(path.join(fixture, 'annotations/manual-annotations.json'), 'utf8').includes('浏览器验证备注'));
    await page.reload();
    await annotationTab().click();
    await expect(page.locator('.annotation-list')).toContainText('浏览器验证备注');
  });
  await test('新建标注、重定位保留草稿、删除与恢复系统备注', async () => {
    await page.locator('.annotation-add-button').click();
    await page.locator('.marker-placement-layer').click({ position: { x: 120, y: 100 } });
    await page.locator('.annotation-edit-form input').fill('手动定位');
    await page.locator('.annotation-edit-form textarea').fill('重定位后仍然保留这一段内容。');
    await page.locator('[data-marker-action="relocate"]').click();
    await page.locator('.marker-placement-layer').click({ position: { x: 180, y: 140 } });
    await expect(page.locator('.annotation-edit-form input')).toHaveValue('手动定位');
    await expect(page.locator('.annotation-edit-form textarea')).toHaveValue('重定位后仍然保留这一段内容。');
    await save();
    const manual = page.locator('.annotation-item').filter({ hasText: '手动定位' });
    page.once('dialog', dialog => dialog.accept());
    await manual.locator('[data-marker-action="delete"]').click();
    await expect(manual).toHaveCount(0);
    await page.locator('[data-marker-action="restore"]').click();
    await expect(page.locator('.annotation-list')).not.toContainText('浏览器验证备注');
  });
  await test('保存失败明确反馈，刷新后从本机缓存恢复并补写文件', async () => {
    await page.route('**/api/manual-annotations', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.continue());
    await page.locator('[data-marker-action="edit"]').first().click();
    await page.locator('.annotation-edit-form input').fill('离线缓存验证');
    await page.locator('.annotation-edit-form button[type="submit"]').click();
    await expect(page.locator('.statusbar .annotation-storage-status')).toHaveAttribute('data-state', 'error');
    await page.unroute('**/api/manual-annotations');
    await page.reload();
    await annotationTab().click();
    await expect(page.locator('.annotation-list')).toContainText('离线缓存验证');
    await expect(page.locator('.statusbar .annotation-storage-status')).toHaveAttribute('data-state', 'saved');
  });
  await test('关联 Markdown 在统一阅读页打开', async () => {
    await page.locator('[data-handoff-tab="page-info"]').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-handoff-panel="page-info"] .handoff-docs a').first().click()]);
    await expect(popup.locator('.document-content h1')).toBeVisible();
    await expect(popup.locator('.document-content')).toContainText('任务');
    await popup.close();
  });
  await test('标注点击与画布联动，M 快捷键切换编号显隐', async () => {
    await annotationTab().click();
    await page.locator('.annotation-item').nth(1).click();
    await expect(page.locator('.annotation-marker.is-active')).toHaveAttribute('data-marker', 'task-list-note-2');
    await page.locator('#workspace').focus();
    await page.keyboard.press('m');
    await expect(page.locator('.annotation-marker').first()).not.toBeVisible();
    await page.keyboard.press('m');
    await expect(page.locator('.annotation-marker').first()).toBeVisible();
  });
  await test('流程总览键盘进入页面，父窗口伪造导航消息被忽略', async () => {
    await page.locator('#overviewNav').click();
    await expect(page.locator('.page-node')).toHaveCount(2);
    await expect(page.locator('.connection-label')).toHaveCount(2);
    const labels = await page.locator('.connection-label').evaluateAll(items => items.map(item => ({ x: item.getBBox().x, y: item.getBBox().y, width: item.getBBox().width })));
    assert(Math.abs(labels[0].x - labels[1].x) >= Math.min(labels[0].width, labels[1].width), '双向连接的标签不得重叠');
    await page.locator('.page-node').last().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#activePageTitle')).toHaveText('任务详情');
    await page.evaluate(() => window.postMessage({ type: 'prototype:navigate', target: 'task-list' }, location.origin));
    await page.waitForTimeout(80);
    await expect(page.locator('#activePageTitle')).toHaveText('任务详情');
    await page.locator('#pageNav [data-page="task-list"]').click();
  });
  await test('标注重复点击与键盘可展开收起，画布编号打开标注，编辑按钮独立响应', async () => {
    await annotationTab().click();
    const first = page.locator('#inspector .annotation-item').first();
    const second = page.locator('#inspector .annotation-item').nth(1);
    const firstToggle = first.locator('.annotation-disclosure');
    const secondToggle = second.locator('.annotation-disclosure');
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(first.locator('.annotation-description')).not.toBeVisible();
    await firstToggle.press('Enter');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(first.locator('.annotation-description')).toBeVisible();
    await firstToggle.press('Space');
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.annotation-add-button').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#inspector .annotation-item.is-active')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'annotations-collapsed.png') });
    await page.locator('.annotation-marker').nth(1).click();
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.annotation-marker').nth(1).click();
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    await firstToggle.click();
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
    await first.locator('[data-marker-action="edit"]').click();
    await expect(page.locator('.annotation-edit-form')).toBeVisible();
    await page.locator('[data-marker-action="cancel"]').click();
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: path.join(output, 'annotations-expanded.png') });
  });
  await test('375–1440px 响应式无页面溢出，窄屏抽屉和运行预览可操作', async () => {
    for (const width of [1280, 1176, 1024, 1000, 855, 768, 390, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('#runPrototypeButton')).toBeInViewport();
      for (const selector of ['#pageModeButton', '#overviewNav', '#toggleSidebar', '#toggleInspector', '#copyLinkButton', '#shortcutsButton']) await expect(page.locator(selector)).toBeInViewport();
      if (width <= 1000) await expect(page.locator('#moreToolsButton')).toBeInViewport();
      else await expect(page.locator('#moreToolsButton')).not.toBeVisible();
      if (width === 855) {
        await page.locator('#moreToolsButton').click();
        await page.locator('#zoomMenuButton').click();
        await page.locator('[data-zoom-level="0.75"]').click();
        await expect(page.locator('#zoomValue')).toHaveText('75%');
        await page.locator('#fitButton').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#moreToolsButton')).toBeFocused();
      }
      if (width === 390) {
        await page.locator('#toggleSidebar').click();
        await expect(page.locator('#pageSearch')).toBeVisible();
        await page.keyboard.press('Shift+Tab');
        assert(await page.locator('#sidebar').evaluate(element => element.contains(document.activeElement)));
        await page.locator('#closeSidebar').click();
        await expect(page.locator('#toggleSidebar')).toBeFocused();
        await page.locator('#toggleInspector').click();
        await expect(page.locator('#inspector')).toBeInViewport();
        await page.locator('.close-inspector').click();
        await page.locator('#runPrototypeButton').click();
        await expect(page.locator('#closePreview')).toBeInViewport();
        await page.locator('#closePreview').click();
        await page.screenshot({ path: path.join(output, 'mobile.png') });
      }
    }
  });
  await page.locator('[data-handoff-tab="page-info"]').click();
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  await test('独立状态页在审阅和运行时保持自身画面，不被强制重置为正常态', async () => {
    const manifestPath = path.join(fixture, 'prototype.json');
    const mapPath = path.join(fixture, 'intermediate/page-map.json');
    const originalManifest = fs.readFileSync(manifestPath, 'utf8');
    const originalMap = fs.readFileSync(mapPath, 'utf8');
    const manifest = JSON.parse(originalManifest), map = JSON.parse(originalMap);
    const variant = { id: 'task-list-empty', title: '任务列表 · 无结果', path: 'pages/task-list-empty.html', viewport: { kind: 'web', width: 1280, height: 800 } };
    manifest.pages.push(variant);
    map.navigation.push({ id: 'empty-variant', type: 'page', pageId: variant.id });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(mapPath, JSON.stringify(map));
    fs.writeFileSync(path.join(fixture, variant.path), '<!doctype html><html lang="zh-CN"><h1 id="stateProof">暂无匹配任务</h1><script>addEventListener("message", event => { if (["prototype:setState", "prototype:set-state"].includes(event.data?.type) && event.data.state === "normal") document.querySelector("#stateProof").textContent = "错误：状态被覆盖"; });</script></html>');
    await page.reload();
    await page.locator('#pageNav [data-page="task-list-empty"]').click();
    await expect(canvasFrame().locator('#stateProof')).toHaveText('暂无匹配任务');
    await page.locator('#runPrototypeButton').click();
    await expect(page.frameLocator('#previewFrame').locator('#stateProof')).toHaveText('暂无匹配任务');
    await page.locator('#closePreview').click();
    await expect(canvasFrame().locator('#stateProof')).toHaveText('暂无匹配任务');
    fs.writeFileSync(manifestPath, originalManifest);
    fs.writeFileSync(mapPath, originalMap);
    await page.goto(base);
    await expect(page.locator('#activePageTitle')).toHaveText('任务列表');
  });
  await test('多层目录的展开、折叠、搜索和页面切换保持一致', async () => {
    const mapPath = path.join(fixture, 'intermediate/page-map.json');
    const originalMap = fs.readFileSync(mapPath, 'utf8');
    const map = JSON.parse(originalMap);
    map.navigation = [{ id: 'workspace', type: 'folder', title: '产品原型', children: [{ id: 'tasks', type: 'folder', title: '任务管理', children: [{ id: 'list', type: 'page', pageId: 'task-list', children: [{ id: 'detail', type: 'page', pageId: 'task-detail' }] }] }] }];
    fs.writeFileSync(mapPath, JSON.stringify(map));
    await page.reload();
    await expect(page.locator('.nav-folder')).toHaveCount(2);
    await expect(page.locator('.nav-item')).toHaveCount(2);
    await page.locator('.nav-page-toggle').click();
    await expect(page.locator('.nav-item')).toHaveCount(1);
    await page.locator('.nav-page-toggle').click();
    await expect(page.locator('.nav-item')).toHaveCount(2);
    await page.locator('#pageSearch').fill('详情');
    await page.locator('[data-page="task-detail"]').click();
    await expect(page.locator('#activePageTitle')).toHaveText('任务详情');
    assert(await page.locator('#pageNav').evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.screenshot({ path: path.join(output, 'nested-navigation.png') });
    fs.writeFileSync(mapPath, originalMap);
    await page.goto(base);
    await expect(page.locator('#activePageTitle')).toHaveText('任务列表');
  });
  await test('移动端业务视口保持 375px，运行设备缩放适应手机工作台', async () => {
    const manifestPath = path.join(fixture, 'prototype.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.pages[0].viewport = { kind: 'mobile', width: 375, height: 812 };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(canvasFrame().locator('#keyword')).toBeVisible();
    assert.equal(await canvasFrame().locator('body').evaluate(() => innerWidth), 375);
    await page.locator('#runPrototypeButton').click();
    await expect.poll(async () => {
      const device = await page.locator('#previewDevice').boundingBox();
      const viewport = await page.locator('#previewViewport').boundingBox();
      return device.width <= viewport.width && device.height <= viewport.height;
    }).toBe(true);
    assert.equal(await page.frameLocator('#previewFrame').locator('body').evaluate(() => innerWidth), 375);
    await page.locator('#closePreview').click();
  });
  await test('纯静态服务降级为浏览器保存，并在刷新后保留备注', async () => {
    const staticContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const staticPage = await staticContext.newPage();
    staticPage.on('pageerror', error => errors.push(error.message));
    await staticPage.route('**/api/manual-annotations', route => route.fulfill({ status: 404, body: '' }));
    await staticPage.route('**/annotations/manual-annotations.json', route => route.fulfill({ status: 404, body: '' }));
    await staticPage.goto(base);
    await expect(staticPage.locator('.statusbar .annotation-storage-status')).toHaveAttribute('data-state', 'local');
    await staticPage.locator('[data-handoff-tab="annotations"]').click();
    await staticPage.locator('[data-marker-action="edit"]').first().click();
    await staticPage.locator('.annotation-edit-form input').fill('静态部署缓存验证');
    await staticPage.locator('.annotation-edit-form button[type="submit"]').click();
    await staticPage.reload();
    await staticPage.locator('[data-handoff-tab="annotations"]').click();
    await expect(staticPage.locator('.annotation-list')).toContainText('静态部署缓存验证');
    await expect(staticPage.locator('.statusbar .annotation-storage-status')).toHaveText('仅浏览器保存');
    await staticContext.close();
  });
  assert.deepEqual(errors, [], '浏览器不得出现未捕获异常');
  console.log(`PASS ${count} browser integration checks; screenshots: test-results/viewer/`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(fixture, { recursive: true, force: true });
});
