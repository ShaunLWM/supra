import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { cleanText, wait } from "./lib/Helper";

const DISMISS_ALERT_MESSAGE = [
  "System is scheduled for maintenance from 00:00 to 06:00. Services will not be available during this period. Please complete your transaction and logout.",
  "You have opened a new active window. Use this window to navigate. Close all your previous windows as they have become inactive."
];

type ConstructorOptions = {
  genericSleepTime?: number;
  closeAfterEachRequest?: boolean;
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

  constructor(options: ConstructorOptions) {
    this._genericSleepTime = options?.genericSleepTime || 500;
    this._closeAfterEachRequest = options?.closeAfterEachRequest || false;
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
    if (!this._browser) {
      return;
    }

    await this._browser.close();
    this._browser = null;
    this._page = null;
  }

  public async search(licensePlate: string) {
    if (!this._browser) {
      this._browser = await puppeteer.launch({
        headless: process.env.NODE_ENV !== "dev",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    if (this._closeAfterEachRequest && this._page) {
      await this._page?.close();
      this._page = null;
    }

    this._page = await this._browser.newPage();

    this._page.on('dialog', async dialog => {
      if (DISMISS_ALERT_MESSAGE.includes(dialog.message())) {
        await dialog.dismiss();
      }
    });

    await this._page.goto('https://vrl.lta.gov.sg/lta/vrl/action/pubfunc?ID=EnquireRoadTaxExpDtProxy', { waitUntil: 'networkidle2' });
    await wait(this._genericSleepTime);
    await this._page.type('#vehNoField', licensePlate);
    await this._page.click('#agreeTCbox');

    const navigationPromise = this._page.waitForNavigation();
    await this._page.click('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-btn-group > button');
    await navigationPromise;

    const [carMake, notFound] = await Promise.allSettled([
      this.getElementText('#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-payment-dtls > div > div.col-xs-5.separated > div:nth-child(2) > p'),
      this.getElementText('#backend-error > table > tbody > tr > td > p')
    ]);

    if ((notFound.status === "fulfilled" && notFound.value === "Please note the following:") || carMake.status === "rejected" || (carMake.status === "fulfilled" && !carMake.value)) {
      throw new Error('No results for car license plate');
    }

    const response: Result = { license: licensePlate, carMake: '' };

    response['carMake'] = cleanText(carMake.value || '');

    const roadTaxExpiryText = await this.getElementText("#main-content > div.dt-container > div:nth-child(2) > form > div.dt-container > div.dt-detail-content.dt-usg-dt-wrpr > div > div > p.vrlDT-content-p");
    response['roadTaxExpiry'] = cleanText(roadTaxExpiryText || '');
    return response;
  }
}
