export async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function cleanText(str: string) {
  return str.replace(/\s\s+/g, ' ').trim();
}
