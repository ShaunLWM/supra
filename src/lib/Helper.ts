export function cleanText(str: string) {
  return str.replace(/\s\s+/g, ' ').trim();
}

export function sleep(min: number, max: number) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
