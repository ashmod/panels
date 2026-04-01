import { chromium, firefox, webkit } from 'playwright';
import process from 'node:process';

const url = process.argv[2];

if (!url) {
  console.error('missing GoComics URL');
  process.exit(2);
}

const browserCandidates = process.env.PANELS_GOCOMICS_BROWSER
  ? [{ type: chromium, launch: { executablePath: process.env.PANELS_GOCOMICS_BROWSER } }]
  : [
      { type: firefox, launch: {} },
      { type: webkit, launch: {} },
      { type: chromium, launch: {} },
    ];

try {
  let lastError;

  for (const candidate of browserCandidates) {
    let browser;
    try {
      const launchOptions = {
        headless: true,
        ...candidate.launch,
      };

      if (candidate.type === chromium || candidate.launch.executablePath) {
        launchOptions.args = ['--no-sandbox', '--disable-dev-shm-usage'];
      }

      browser = await candidate.type.launch(launchOptions);
      const page = await browser.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      if (response && response.status() >= 400 && response.status() < 600) {
        continue;
      }

      try {
        await page.waitForFunction(
          () => document.body && !document.body.hasAttribute('data-pow'),
          undefined,
          { timeout: 20000 }
        );
      } catch {
        // Some browsers still land on the real page without the explicit wait succeeding.
      }

      const html = await page.content();
      if (html.includes('data-pow=') && html.includes('Establishing a secure connection')) {
        continue;
      }

      process.stdout.write(
        JSON.stringify({
          html,
          finalUrl: page.url(),
        })
      );

      await browser.close();
      process.exit(0);
    } catch (error) {
      lastError = error;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  throw lastError || new Error('all Playwright browser attempts stayed on Bunny Shield');
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
