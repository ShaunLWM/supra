import { describe, it, expect } from "vitest";
import { Supra } from "../src";

describe("should", () => {
  it("search by license plate", async () => {
    const bot = new Supra();
    try {
      const results = await bot.search("SNU2913B");
      console.log(results);
      expect(results.carMake).toBe("KIA / STINGER 2.0A 2WD SUNROOF");
    } finally {
      await bot.close();
    }
  }, 30000);
});
