export function cleanText(str: string) {
  return str.replace(/\s\s+/g, ' ').trim();
}
