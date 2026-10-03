import { chromium, firefox, webkit } from 'playwright';
import process from 'node:process';
import readline from 'node:readline';

const NAV_TIMEOUT_MS = 15000;
const CHALLENGE_TIMEOUT_MS = 20000;
const RATE_LIMIT_RETRY_MS = 3000;

const browserCandidates = process.env.PANELS_GOCOMICS_BROWSER
  ? [{ type: chromium, launch: { executablePath: process.env.PANELS_GOCOMICS_BROWSER } }]
  : [
      { type: firefox, launch: {} },
      { type: webkit, launch: {} },
      { type: chromium, launch: {} },
    ];

let contextPromise = null;

async function launchContext() {
  let lastError;
  for (const candidate of browserCandidates) {
    try {
      const launchOptions = { headless: true, ...candidate.launch };
      if (candidate.type === chromium || candidate.launch.executablePath) {
        launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage'];
      }
      const browser = await candidate.type.launch(launchOptions);
      browser.on('disconnected', () => {
        contextPromise = null;
      });
      return await browser.newContext();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('no Playwright browser could be launched');
}

function getContext() {
  contextPromise ??= launchContext().catch((error) => {
    contextPromise = null;
    throw error;
  });
  return contextPromise;
}

const isChallengePage = () => document.body?.hasAttribute('data-pow') ?? false;

async function fetchPage(url) {
  const context = await getContext();
  const page = await context.newPage();

  let status = 0;
  page.on('response', (response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      status = response.status();
    }
  });

  try {
    for (let attempt = 0; ; attempt++) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

      if (await page.evaluate(isChallengePage)) {
        await page.waitForFunction(() => !document.body?.hasAttribute('data-pow'), undefined, {
          timeout: CHALLENGE_TIMEOUT_MS,
        });
        await page.waitForLoadState('domcontentloaded');
      }

      if (status === 429 && attempt === 0) {
        await page.waitForTimeout(RATE_LIMIT_RETRY_MS);
        continue;
      }
      if (status === 404 || status === 429) return { status };
      if (status >= 400) throw new Error(`GoComics responded ${status}`);
      return { html: await page.content(), finalUrl: page.url(), status };
    }
  } finally {
    await page.close().catch(() => {});
  }
}

const lines = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();

lines.on('line', (line) => {
  queue = queue.then(async () => {
    let reply;
    try {
      reply = await fetchPage(JSON.parse(line).url);
    } catch (error) {
      reply = { error: String(error?.message || error).split('\n')[0] };
    }
    process.stdout.write(JSON.stringify(reply) + '\n');
  });
});

lines.on('close', async () => {
  await queue;
  const context = await contextPromise?.catch(() => null);
  await context?.browser()?.close().catch(() => {});
  process.exit(0);
});
