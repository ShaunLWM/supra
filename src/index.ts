import { GhostCursor, createCursor } from "ghost-cursor";
import { Browser, BrowserLaunchArgumentOptions, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { cleanText, wait } from "./lib/Helper";

const DISMISS_ALERT_MESSAGE = [
  "System is scheduled for maintenance from 00:00 to 06:00. Services will not be available during this period. Please complete your transaction and logout.",
  "You have opened a new active window. Use this window to navigate. Close all your previous windows as they have become inactive."
];

type ConstructorOptions = {
  genericSleepTime?: number;
  closeAfterEachRequest?: boolean;
  headless?: boolean;
  screenshotDebugDirectory?: string;
  puppeteerLaunchArgs?: string[];
  recaptchaKey: string;
}

type Result = {
  license: string;
  carMake: string;
  roadTaxExpiry?: string;
}

puppeteer.use(StealthPlugin());

export class Supra {
  private _genericSleepTime: number;
  private _closeAfterEachRequest: boolean;
  private _page: Page | null = null;
  private _browser: Browser | null = null;
  private _headless: BrowserLaunchArgumentOptions["headless"];
  private _screenshotDebugDirectory: string | null = null;
  private _puppeteerLaunchArgs: string[] = [];
  private _cursor: GhostCursor | null = null;

  constructor(options: ConstructorOptions) {
    this._genericSleepTime = options?.genericSleepTime || 500;
    this._closeAfterEachRequest = options?.closeAfterEachRequest || false;
    this._headless = options?.headless ?? true;
    this._screenshotDebugDirectory = options?.screenshotDebugDirectory || null;
    this._puppeteerLaunchArgs = [
      '--disable-features=IsolateOrigins,site-per-process,SitePerProcess',
      '--flag-switches-begin --disable-site-isolation-trials --flag-switches-end',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(options?.puppeteerLaunchArgs || [])
    ];

    puppeteer.use(RecaptchaPlugin({
      provider: {
        id: '2captcha',
        token: options.recaptchaKey,
      },
      visualFeedback: true,
      solveScoreBased: true,
    })
    )
  }

  private async getElementText(selector: string): Promise<false | string> {
    if (!this._page) {
      return false;
    }

    try {
      const node = await this._page.waitForSelector(selector, { timeout: 1500 });
      if (!node) {
        return false;
      }

      return node.evaluate(el => el.textContent as string)
    } catch (error) {
      return false;
    }
  }

  public async close() {
    if (!this._browser && !this._cursor) {
      return;
    }

    await this._browser?.close();
    this._cursor = null;
    this._browser = null;
    this._page = null;
  }

  public async search(licensePlate: string) {
    if (!this._browser) {
      this._browser = await puppeteer.launch({
        headless: this._headless || "shell",
        args: this._puppeteerLaunchArgs
      });
    }

    if (this._closeAfterEachRequest && this._page) {
      await this._page?.close();
      this._page = null;
    }

    this._page = await this._browser.newPage();
    this._cursor = createCursor(this._page);

    this._page.on('dialog', async dialog => {
      if (DISMISS_ALERT_MESSAGE.includes(dialog.message())) {
        await dialog.dismiss();
      }
    });

    await this._page.goto('https://vrl.lta.gov.sg/lta/vrl/action/enquireRoadTaxExpDtProxy?FUNCTION_ID=F0702025ET', { waitUntil: 'networkidle2' });
    await this._page.solveRecaptchas();
    await wait(this._genericSleepTime);
    await this._page.type('#vehNoField', licensePlate);
    await this._cursor.click('#agreeTCbox');

    if (this._screenshotDebugDirectory) {
      await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${licensePlate}_1.png` });
    }

    await wait(this._genericSleepTime);
    const navigationPromise = this._page.waitForNavigation();
    await this._cursor.click('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-btn-group > button');
    await navigationPromise;

    if (this._screenshotDebugDirectory) {
      await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${licensePlate}_2.png` });
    }

    const [carMake, notFound] = await Promise.allSettled([
      this.getElementText('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-payment-dtls > div > div.col-xs-5.separated > div:nth-child(2) > p'),
      this.getElementText('#backend-error > table > tbody > tr > td > p')
    ]);

    if ((notFound.status === "fulfilled" && notFound.value === "Please note the following:") || carMake.status === "rejected" || (carMake.status === "fulfilled" && !carMake.value)) {
      const reason = await this.getElementText('#backend-error > table > tbody > tr > td > ul > li');
      if (reason && reason.startsWith('reCAPTCHA verification unsuccessful')) {
        throw new Error('reCAPTCHA verification unsuccessful');
      }
      throw new Error('No results for car license plate');
    }

    const response: Result = { license: licensePlate, carMake: '' };

    response['carMake'] = cleanText(carMake.value || '');

    const roadTaxExpiryText = await this.getElementText("#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-detail-content.dt-usg-dt-wrpr > div > div > p.vrlDT-content-p");
    response['roadTaxExpiry'] = cleanText(roadTaxExpiryText || '');
    return response;
  }
}
