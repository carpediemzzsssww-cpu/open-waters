type Rect = { top: number; bottom: number; left: number; width: number; height: number };
type WindowInfo = { windowHeight: number; safeArea?: Rect; menuButtons?: { capsule?: Rect; back?: Rect; me?: Rect; share?: Rect } };
type Launch = { miniToolEnv?: { buildVersion?: number | string } };
type FollowResult = { follow_status: number };
type PhotoAction = 'save' | 'post' | 'share';

interface Host {
  getLaunchOptions?(): Promise<Launch>;
  getWindowInfo?(): Promise<WindowInfo>;
  writeTempFile?(args: { data: string }): Promise<{ filePath: string }>;
  saveImageToPhotosAlbum?(args: { filePath: string }): Promise<unknown>;
  postNote?(args: { title: string; pageType?: 'photo_publish'; mediaInfo: { image_resources: { url: string }[] } }): Promise<unknown>;
  share?(args: { type: 'image'; image_resource: string }): Promise<unknown>;
  vibrateShort?(args: { type: 'light' | 'medium' }): Promise<unknown>;
  getFollowStatus?(): Promise<FollowResult>;
  followAuthor?(): Promise<FollowResult>;
}

function platform() {
  return (window as Window & {xhs?: {launchOptions?: Launch; miniTool?: Host}}).xhs;
}
function bounded<T>(work: Promise<T>, ms = 20000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('操作超时')), ms);
    work.then(x => { clearTimeout(timer); resolve(x); }, e => { clearTimeout(timer); reject(e); });
  });
}
let currentVersion = 0;
let layoutRevision = 0;

export async function layout() {
  const revision = ++layoutRevision;
  const style = document.documentElement.style;
  style.setProperty('--app-height', (window.visualViewport?.height || window.innerHeight) + 'px');
  const xhs = platform(), host = xhs?.miniTool;
  if (!host) return;
  try {
    const launch = xhs?.launchOptions?.miniToolEnv?.buildVersion ? xhs.launchOptions :
      host.getLaunchOptions && await bounded(host.getLaunchOptions(), 5000);
    currentVersion = Math.floor(Number(launch?.miniToolEnv?.buildVersion || 0) / 1000);
    if (currentVersion < 9490 || !host.getWindowInfo) return;
    const info = await bounded(host.getWindowInfo(), 5000);
    if (revision !== layoutRevision) return;
    const buttons = info.menuButtons || {};
    const visible = (r?: Rect) => !!r && r.width > 0 && r.height > 0 && Number.isFinite(r.bottom);
    const rects = currentVersion >= 9550 && visible(buttons.capsule) ? [buttons.capsule] : [buttons.back, buttons.share, buttons.me];
    const top = rects.reduce((n, r) => visible(r) ? Math.max(n, r!.bottom) : n, 0);
    const safeTop = info.safeArea?.top || 0;
    style.setProperty('--mt-top', Math.max(64, safeTop + 44, top + 10) + 'px');
    style.setProperty('--mt-safe-top', safeTop + 'px');
    if (info.safeArea && info.windowHeight) {
      style.setProperty('--mt-safe-bottom', Math.max(0, info.windowHeight - info.safeArea.bottom) + 'px');
    }
  } catch { /* The stylesheet supplies safe insets when the host cannot report its layout. */ }
}

export function photoActions() {
  const host = platform()?.miniTool;
  return {
    save: currentVersion >= 9420 && typeof host?.saveImageToPhotosAlbum === 'function',
    post: typeof host?.postNote === 'function',
    share: currentVersion >= 9530 && typeof host?.share === 'function',
  };
}
export async function sendPhoto(data: string, title: string, kind: PhotoAction) {
  const host = platform()?.miniTool;
  if (!host || !photoActions()[kind]) throw new Error('当前客户端暂不支持');
  const file = host.writeTempFile ? (await bounded(host.writeTempFile({data}))).filePath : data;
  if (!file) throw new Error('照片生成失败');
  if (kind === 'save') await bounded(host.saveImageToPhotosAlbum!({filePath: file}));
  if (kind === 'post') await bounded(host.postNote!({title: Array.from(title).slice(0, 20).join(''), pageType: currentVersion >= 9430 ? 'photo_publish' : undefined, mediaInfo: {image_resources: [{url: file}]}}));
  if (kind === 'share') await bounded(host.share!({type: 'image', image_resource: file}));
}
export async function haptic(type: 'light' | 'medium' = 'light') {
  const host = platform()?.miniTool;
  if (currentVersion < 9500 || !host?.vibrateShort) return;
  try { await bounded(host.vibrateShort({type}), 3000); } catch { /* Haptics are optional. */ }
}
export async function followStatus(): Promise<number | null> {
  const host = platform()?.miniTool;
  if (currentVersion < 9510 || !host?.getFollowStatus || !host.followAuthor) return null;
  try { return (await bounded(host.getFollowStatus(), 5000)).follow_status; } catch { return null; }
}
export async function follow(): Promise<number | null> {
  const host = platform()?.miniTool;
  if (currentVersion < 9510 || !host?.followAuthor) return null;
  try { return (await bounded(host.followAuthor())).follow_status; } catch { return null; }
}
