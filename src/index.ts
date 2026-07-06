import { Camoufox, type LaunchOptions } from "camoufox-js";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { cleanText } from "./lib/Helper";

const PAGE_URL = 'https://vrl.lta.gov.sg/vrls/app/ao/enq-rtx-exp-dt-proxy';

export type ConstructorOptions = {
  closeAfterEachRequest?: boolean;
  headless?: boolean;
  screenshotDebugDirectory?: string;
  camoufoxOptions?: Partial<LaunchOptions>;
}

export type Result = {
  license: string;
  carMake: string;
  roadTaxExpiry?: string;
}

export class Supra {
  private _closeAfterEachRequest: boolean;
  private _page: Page | null = null;
  private _browser: Browser | null = null;
  private _context: BrowserContext | null = null;
  private _headless: boolean;
  private _screenshotDebugDirectory: string | null = null;
  private _camoufoxOptions: Partial<LaunchOptions>;

  constructor(options: ConstructorOptions = {}) {
    this._closeAfterEachRequest = options?.closeAfterEachRequest || false;
    this._headless = options?.headless ?? true;
    this._screenshotDebugDirectory = options?.screenshotDebugDirectory || null;
    this._camoufoxOptions = options?.camoufoxOptions || {};
  }

  public async close() {
    if (!this._browser) {
      return;
    }

    await this._browser.close();
    this._browser = null;
    this._context = null;
    this._page = null;
  }

  public async search(licensePlate: string) {
    if (!this._browser) {
      this._browser = await Camoufox({
        headless: this._headless,
        ...this._camoufoxOptions,
      });
    }

    if (this._closeAfterEachRequest && this._context) {
      await this._context.close();
      this._context = null;
      this._page = null;
    }

    this._context = await this._browser!.newContext({ viewport: null });
    this._page = await this._context.newPage();

    await this._page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    await this._page.fill('#vehicleNo', licensePlate);
    await this._page.evaluate(() => document.querySelector<HTMLInputElement>('#checkboxId_agreeTC_true')?.click());

    if (this._screenshotDebugDirectory) {
      await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${licensePlate}_1.png` });
    }

    await this._page.evaluate(() => document.querySelector<HTMLButtonElement>('#submitWithRecaptchaBtn')?.click());

    const result = await Promise.race([
      this._page.waitForSelector('#vehicleMakeModelFieldDisplay').then(() => 'success' as const),
      this._page.waitForSelector('.alert-error').then(() => 'error' as const),
    ]);

    if (this._screenshotDebugDirectory) {
      await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${licensePlate}_2.png` });
    }

    if (result === 'error') {
      const reason = await this._page.textContent('.alert-error .message-container');
      throw new Error(cleanText(reason || 'No results for car license plate'));
    }

    const carMake = await this._page.textContent('#vehicleMakeModelFieldDisplay span');
    const roadTaxExpiry = await this._page.textContent('#expiryDateFieldDisplay span');

    const response: Result = {
      license: licensePlate,
      carMake: cleanText(carMake || ''),
      roadTaxExpiry: cleanText(roadTaxExpiry || ''),
    };

    return response;
  }
}
