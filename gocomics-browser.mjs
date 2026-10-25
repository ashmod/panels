import { chromium, firefox, webkit } from 'playwright';
import process from 'node:process';
import readline from 'node:readline';

const NAV_TIMEOUT_MS = 15000;
const CHALLENGE_TIMEOUT_MS = 20000;
const RATE_LIMIT_RETRY_MS = 3000;

const browserCandidates = process.env.PANELS_GOCOMICS_BROWSER
  ? [{ type: chromium, launch: { executablePath: process.env.PANELS_GOCOMICS_BROWSER } }]
  : [
      { type: chromium, launch: { channel: 'chromium' } },
      { type: firefox, launch: {} },
      { type: webkit, launch: {} },
    ];

class ChallengeBlockedError extends Error {}

let candidateIndex = 0;
let contextPromise = null;

async function launchContext(candidate) {
  const launchOptions = { headless: true, ...candidate.launch };
  if (candidate.type === chromium) {
    launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage'];
  }
  const browser = await candidate.type.launch(launchOptions);
  browser.on('disconnected', () => {
    contextPromise = null;
  });
  try {
    if (candidate.type !== chromium) return await browser.newContext();
    const probe = await browser.newPage();
    const userAgent = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
    await probe.close();
    return await browser.newContext({ userAgent });
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async function dropContext() {
  const context = await contextPromise?.catch(() => null);
  contextPromise = null;
  await context?.browser()?.close().catch(() => {});
}

const isChallengePage = () => document.body?.hasAttribute('data-pow') ?? false;

async function fetchWithContext(context, url) {
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
        try {
          await page.waitForFunction(() => !document.body?.hasAttribute('data-pow'), undefined, {
            timeout: CHALLENGE_TIMEOUT_MS,
          });
        } catch {
          throw new ChallengeBlockedError('Bunny Shield challenge did not clear');
        }
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

async function fetchPage(url) {
  let launchError;
  let blockedError;
  for (let tried = 0; tried < browserCandidates.length; tried++) {
    let context;
    try {
      contextPromise ??= launchContext(browserCandidates[candidateIndex]);
      context = await contextPromise;
    } catch (error) {
      launchError = error;
      contextPromise = null;
      candidateIndex = (candidateIndex + 1) % browserCandidates.length;
      continue;
    }

    try {
      return await fetchWithContext(context, url);
    } catch (error) {
      if (!(error instanceof ChallengeBlockedError)) throw error;
      blockedError = error;
      await dropContext();
      candidateIndex = (candidateIndex + 1) % browserCandidates.length;
    }
  }
  throw blockedError || launchError || new Error('no Playwright browser could be launched');
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
