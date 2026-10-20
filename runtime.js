// Resolve from this module rather than the current page, including project
// sites such as https://user.github.io/HyperLuna/advanced/.
const root = new URL('./', import.meta.url);
export function assetUrl(path = '', base = root) {
  return new URL(path.replace(/^\/+/, ''), base).href;
}
