import { Camoufox, type LaunchOptions } from "camoufox-js";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { cleanText } from "./lib/Helper";

const PAGE_URL = 'https://vrl.lta.gov.sg/vrls/app/ao/enq-rtx-exp-dt-proxy';

export enum SupraErrorCode {
  MAINTENANCE = 'MAINTENANCE',
  UNAVAILABLE = 'UNAVAILABLE',
  SEARCH_ERROR = 'SEARCH_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_INPUT = 'INVALID_INPUT',
  CAPTCHA_FAILED = 'CAPTCHA_FAILED',
}

export class SupraError extends Error {
  public readonly code: SupraErrorCode;

  constructor(code: SupraErrorCode, message: string) {
    super(message);
    this.name = 'SupraError';
    this.code = code;
  }
}

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
    const plate = licensePlate.trim().toUpperCase();
    if (!plate) {
      throw new SupraError(SupraErrorCode.INVALID_INPUT, `Invalid license plate format: ${licensePlate}`);
    }

    if (!this._browser) {
      this._browser = await Camoufox({
        headless: this._headless,
        humanize: true,
        block_webrtc: true,
        geoip: true,
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

    const vehicleInput = await this._page.$('#vehicleNo');
    if (!vehicleInput) {
      const bodyText = await this._page.textContent('body') || '';
      if (/maintenance/i.test(bodyText)) {
        throw new SupraError(SupraErrorCode.MAINTENANCE, 'Service is currently under maintenance. Please try again later.');
      }
      throw new SupraError(SupraErrorCode.UNAVAILABLE, 'Service is currently unavailable. Please try again later.');
    }

    await this._page.fill('#vehicleNo', plate);
    await this._page.evaluate(() => document.querySelector<HTMLInputElement>('#checkboxId_agreeTC_true')?.click());

    if (this._screenshotDebugDirectory) {
      try {
        await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${plate}_1.png` });
      } catch {}
    }

    await this._page.evaluate(() => document.querySelector<HTMLButtonElement>('#submitWithRecaptchaBtn')?.click());

    const result = await Promise.race([
      this._page.waitForSelector('#vehicleMakeModelFieldDisplay').then(() => 'success' as const),
      this._page.waitForSelector('.alert-error').then(() => 'error' as const),
    ]);

    if (this._screenshotDebugDirectory) {
      try {
        await this._page.screenshot({ path: `${this._screenshotDebugDirectory}/${plate}_2.png` });
      } catch {}
    }

    if (result === 'error') {
      const reason = cleanText(await this._page.textContent('.alert-error .message-container') || '');
      throw this._classifyError(reason);
    }

    const carMake = await this._page.textContent('#vehicleMakeModelFieldDisplay span');
    const roadTaxExpiry = await this._page.textContent('#expiryDateFieldDisplay span');

    const response: Result = {
      license: plate,
      carMake: cleanText(carMake || ''),
      roadTaxExpiry: cleanText(roadTaxExpiry || ''),
    };

    return response;
  }

  private _classifyError(message: string): SupraError {
    if (/no record found/i.test(message)) {
      return new SupraError(SupraErrorCode.NOT_FOUND, message);
    }

    if (/security verification/i.test(message)) {
      this.close();
      return new SupraError(SupraErrorCode.CAPTCHA_FAILED, message);
    }

    if (/not valid/i.test(message)) {
      return new SupraError(SupraErrorCode.INVALID_INPUT, message);
    }

    return new SupraError(SupraErrorCode.SEARCH_ERROR, message);
  }
}
