import { expect, test, webkit, type Page } from '@playwright/test';

const folders = [
  { id: 1, name: 'Inbox', label: 'Входящие', kind: 'inbox', unread: 3, total: 24 },
  { id: 2, name: 'Sent', label: 'Отправленные', kind: 'sent', unread: 0, total: 0 },
  { id: 3, name: 'Drafts', label: 'Черновики', kind: 'drafts', unread: 0, total: 0 },
];
const mails = Array.from({ length: 24 }, (_, index) => ({
  id: index + 1, folder: 1, sender: `Отправитель ${index + 1}`,
  email: `sender${index + 1}@example.test`, to: 'demo@example.test',
  subject: `Тестовое письмо ${String(index + 1).padStart(2, '0')}`,
  preview: 'Синтетическое письмо для проверки прокрутки.',
  date: '2026-10-14T12:00:00Z', unread: index < 3, flagged: false,
  draft: false, messageID: `fixture-${index + 1}`, cc: '', bcc: '',
  replyTo: '', attachments: [],
}));

async function openFixture(page: Page) {
  await page.route('**/api/mail/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/events')) {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '\n' });
      return;
    }
    const body = path.endsWith('/session')
      ? { authenticated: true, csrfToken: 'fixture', username: 'demo@example.test' }
      : path.endsWith('/snapshot')
        ? { folders, mails, hasMore: false, cursor: 0, address: 'demo@example.test', name: 'Тестовый ящик', settings: { Signature: '' }, version: 'fixture' }
        : { error: 'Unknown fixture endpoint' };
    await route.fulfill({ status: 'error' in body ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/mail');
  await expect(page.locator('.mail-row')).toHaveCount(24);
}

async function verifyMobileToolbar(page: Page, screenshot: string) {
  await openFixture(page);
  const toolbar = page.locator('.global-toolbar');
  const list = page.locator('.mail-list');
  const initial = await toolbar.boundingBox();
  expect(initial).not.toBeNull();
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(300);
  const scrolled = await toolbar.boundingBox();
  expect(scrolled).not.toBeNull();
  expect(Math.abs(scrolled!.y - initial!.y)).toBeLessThan(1);
  expect((await page.locator('.list-heading').boundingBox())!.y).toBeLessThan(scrolled!.y);
  expect((await page.locator('.list-toolbar').boundingBox())!.y).toBeLessThan(scrolled!.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await toolbar.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');

  await page.getByRole('button', { name: 'Открыть папки' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('.sidebar-close').click();
  await expect(page.locator('.sidebar')).toBeHidden();

  const search = page.getByRole('searchbox', { name: 'Поиск в почте' });
  await search.fill('пример');
  await expect(search).toBeFocused();
  await page.setViewportSize({ width: 390, height: 500 });
  const compact = await toolbar.boundingBox();
  expect(compact).not.toBeNull();
  expect(compact!.y).toBeGreaterThanOrEqual(0);
  expect(compact!.y + compact!.height).toBeLessThan(500);

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(search).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill('');
  await search.blur();
  await page.locator('.mail-row').nth(6).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: screenshot });
}

test('mobile menu and search stay visible while mailbox heading scrolls away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await verifyMobileToolbar(page, 'test-results/sticky-toolbar-chromium.png');
});

test('WebKit mobile toolbar remains usable after scrolling and rotation', async () => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      baseURL: process.env.TEST_ORIGIN || 'http://127.0.0.1:3100',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2,
    });
    try {
      await verifyMobileToolbar(await context.newPage(), 'test-results/sticky-toolbar-webkit.png');
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

async function verifyMobileSelection(page: Page) {
  await openFixture(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const row = page.locator('.mail-row').first();
    const checkbox = row.getByRole('checkbox', { name: 'Выбрать: Тестовое письмо 01' });
    await expect(checkbox).toBeVisible();
    const hit = await row.locator('.row-check-hit').boundingBox();
    expect(hit).not.toBeNull();
    expect(hit!.width).toBeGreaterThanOrEqual(44);
    expect(hit!.height).toBeGreaterThanOrEqual(44);
    await row.locator('.row-check-hit').click({ position: { x: 4, y: 4 } });
    await expect(checkbox).toBeChecked();
    await expect(page.getByRole('button', { name: 'Архивировать выбранные' })).toBeVisible();
    await expect(page.locator('.message-pane')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/mobile-selection-${width}.png` });
    await checkbox.uncheck();
    await expect(page.getByRole('button', { name: 'Архивировать выбранные' })).toHaveCount(0);
  }
}

test('mobile row selection remains visible and usable at narrow widths', async ({ page }) => {
  await verifyMobileSelection(page);
});

test('WebKit mobile row selection remains usable', async () => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      baseURL: process.env.TEST_ORIGIN || 'http://127.0.0.1:3100',
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2,
    });
    try {
      await verifyMobileSelection(await context.newPage());
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
