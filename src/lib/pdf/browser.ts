import { existsSync } from 'fs';

const DEV_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

/**
 * Launches a Puppeteer browser instance.
 *
 * Development: resolves a locally-installed Chrome via PUPPETEER_EXECUTABLE_PATH
 *   or by scanning common OS paths.
 * Production:  uses @sparticuz/chromium (works on VPS; for Vercel swap to
 *   @sparticuz/chromium-min and supply the S3 executablePath).
 */
export async function launchBrowser() {
  const { default: puppeteer } = await import('puppeteer-core');

  if (process.env.NODE_ENV === 'production') {
    const { default: chromium } = await import('@sparticuz/chromium');
    // This @sparticuz/chromium version no longer exposes defaultViewport /
    // headless statics — puppeteer's defaults (headless, 800x600) apply.
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    DEV_CHROME_PATHS.find(existsSync);

  if (!executablePath) {
    throw new Error(
      'No local Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH in .env.local ' +
      '(e.g. PUPPETEER_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")',
    );
  }

  return puppeteer.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
}
