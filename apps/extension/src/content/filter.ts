// Which captured requests can belong to a submit: app API traffic only.
const HMR = [/\/@vite\//, /\/@react-refresh/, /__webpack_hmr/, /\/_next\/webpack-hmr/, /\.hot-update\./, /sockjs-node/, /\/_next\/static\//];
const STATIC = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|m?js|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)$/i;
const HELPER_HOST = "127.0.0.1:7777";

export function isCandidateRequest(url: string, _method: string): boolean {
  let u: URL;
  try {
    u = new URL(url, location.href);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.host === HELPER_HOST) return false;
  const path = u.pathname;
  if (HMR.some((re) => re.test(path))) return false;
  if (STATIC.test(path)) return false;
  return true;
}
