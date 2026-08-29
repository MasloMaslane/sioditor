import { expect, test, type Page } from '@playwright/test';
import { createApp } from '../server/src/app.js';
import { SessionStore } from '../server/src/store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { setSource } from './helpers.js';
import { verifyChain } from '../packages/integrity/src/chain.js';

/**
 * Supervised sessions, against a real ingest server.
 *
 * The behaviour these exist to prove is the one an organiser has to be able to rely on:
 * a contest happens on flaky hotel wifi and a server that may fall over, and no recorded
 * event may be lost to either.
 */
let server: Server;
let endpoint: string;
let root: string;
let store: SessionStore;
let accepting = true;

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sioditor-e2e-'));
  store = new SessionStore(root);
  const app = createApp({ store });
  // A switch to simulate the server falling over mid-round.
  server = (await import('node:http')).createServer((req, res) => {
    if (!accepting) {
      res.socket?.destroy();
      return;
    }
    app.emit('request', req, res);
  });
  accepting = true;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

const join_ = (page: Page, participant = 'kowalski') =>
  page.goto(`/?session=round1&participant=${participant}&ingest=${encodeURIComponent(endpoint)}`);

const acknowledge = (page: Page) =>
  page.getByRole('button', { name: 'Przeczytalem i rozpoczynam' }).click();

const eventsFor = async (participant = 'kowalski') => {
  const chunks = await store.read('round1', participant);
  return chunks.flatMap((chunk) => chunk.events);
};

test('records nothing at all in ordinary practice use', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.invig')).toBeHidden();
  await setSource(page, 'print("just practising")');
  await page.waitForTimeout(1500);
  expect(await store.sessions()).toEqual([]);
});

test('shows the notice before anything is recorded, and says what it captures', async ({
  page,
}) => {
  await join_(page);
  await expect(page.locator('.notice')).toBeVisible();
  // The editor is not reachable until the notice has been read.
  await expect(page.locator('.cm-content')).toBeHidden();
  await expect(page.locator('.notice')).toContainText('Kazda zmiana w kodzie');
  await expect(page.locator('.notice')).toContainText('Czego nie zapisujemy');
  expect(await store.sessions()).toEqual([]);
});

test('records and delivers once the round is joined', async ({ page }) => {
  await join_(page);
  await acknowledge(page);
  await expect(page.locator('.invig')).toBeVisible();

  await setSource(page, 'print("recorded")');
  await expect.poll(async () => (await eventsFor()).length, { timeout: 30_000 }).toBeGreaterThan(0);

  const events = await eventsFor();
  expect(events.some((e) => e.t === 'session')).toBe(true);
  expect(events.some((e) => e.t === 'edit')).toBe(true);
});

test('marks a pasted solution as text the session has never seen', async ({ page }) => {
  await join_(page);
  await acknowledge(page);
  await setSource(page, 'print("x")');
  await page.waitForTimeout(500);

  const solution = '# a solution from somewhere else\n'.repeat(6);
  await setSource(page, solution);

  await expect
    .poll(async () => (await eventsFor()).filter((e) => e.t === 'paste').length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // The largest arrival, not the first: setting up the test pastes too.
  const pastes = (await eventsFor()).filter((e) => e.t === 'paste');
  const biggest = pastes.reduce((a, b) => (a.len >= b.len ? a : b));
  expect(biggest).toMatchObject({ novel: true });
  // Long enough to carry its text, so a reviewer can see what arrived.
  expect(biggest).toHaveProperty('text');
});

test('loses nothing while the server is down, and catches up when it returns', async ({ page }) => {
  await join_(page);
  await acknowledge(page);
  await setSource(page, 'print("before the outage")');
  await expect.poll(async () => (await eventsFor()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const before = (await eventsFor()).length;

  accepting = false;
  await setSource(page, 'print("written during the outage")');
  await page.waitForTimeout(4000);

  // The badge tells the contestant, rather than failing silently.
  await expect(page.locator('.invig.warn')).toBeVisible({ timeout: 30_000 });
  expect((await eventsFor()).length).toBe(before);

  accepting = true;
  await expect
    .poll(async () => (await eventsFor()).length, { timeout: 60_000 })
    .toBeGreaterThan(before);

  // And the record is still a verifiable chain, not a set of holes.
  await expect(verifyChain(await store.read('round1', 'kowalski'))).resolves.toMatchObject({
    ok: true,
  });
});

test('survives the client going offline and reloading mid-round', async ({ page, context }) => {
  await join_(page);
  await acknowledge(page);
  await setSource(page, 'print("first")');
  await expect.poll(async () => (await eventsFor()).length, { timeout: 30_000 }).toBeGreaterThan(0);

  // The reload below is served by the service worker, which has to be controlling the
  // page before the network is taken away.
  await page.evaluate(() => navigator.serviceWorker.ready);

  await context.setOffline(true);
  await setSource(page, 'print("written while offline")');
  await page.waitForTimeout(3000);

  // A reload during a round is normal; the chain must continue rather than restart.
  await page.reload();
  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const chunks = await store.read('round1', 'kowalski');
        return chunks.filter((c) => c.events.some((e) => e.t === 'session')).length;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  const verdict = await verifyChain(await store.read('round1', 'kowalski'));
  expect(verdict.ok).toBe(true);
});

test('keeps participants apart', async ({ page }) => {
  await join_(page, 'nowak');
  await acknowledge(page);
  await setSource(page, 'print("nowak")');
  await expect
    .poll(async () => (await eventsFor('nowak')).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  expect(await store.participants('round1')).toEqual(['nowak']);
});
