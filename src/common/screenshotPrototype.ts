export const SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const SCREENSHOT_MAX_COUNT = 3;
export const SCREENSHOT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export interface ScreenshotPrototypeImage { name: string; dataUrl: string }
export interface ScreenshotPrototypeRequest {
  requestId?: string;
  title: string;
  instructions: string;
  images: ScreenshotPrototypeImage[];
}

export function validateScreenshotPrototypeRequest(input: unknown): ScreenshotPrototypeRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('截图原型请求无效');
  const value = input as Record<string, unknown>;
  if (value.requestId !== undefined && (typeof value.requestId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.requestId))) throw new Error('截图任务标识无效');
  const text = (raw: unknown, fallback: string, max: number, label: string) => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || raw.length > max || raw.includes('\0')) throw new Error(`${label}无效或过长`);
    return raw.trim() || fallback;
  };
  if (!Array.isArray(value.images) || !value.images.length || value.images.length > SCREENSHOT_MAX_COUNT) throw new Error('请添加 1–3 张截图');
  const images = value.images.map((raw: unknown, index): ScreenshotPrototypeImage => {
    if (!raw || typeof raw !== 'object') throw new Error('截图无效');
    const image = raw as Record<string, unknown>;
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4 + 40) throw new Error('每张截图不能超过 8 MB');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(image.dataUrl);
    if (!match || match[2].length % 4 !== 0) throw new Error('仅支持 PNG、JPEG、WebP 截图');
    const bytes = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
    if (!bytes || bytes > SCREENSHOT_MAX_BYTES) throw new Error('每张截图不能超过 8 MB');
    return { name: text(image.name, `截图 ${index + 1}`, 200, '截图名称'), dataUrl: image.dataUrl };
  });
  return { ...(value.requestId === undefined ? {} : { requestId: value.requestId as string }), title: text(value.title, '截图线框原型', 100, '原型名称'), instructions: text(value.instructions, '', 6000, '补充要求'), images };
}

export function buildScreenshotPrototypePrompt(request: ScreenshotPrototypeRequest): string {
  return [
    '根据随请求附带的截图生成独立、可编辑的黑白灰低保真线框原型。仅写入指定的新原型目录，不修改其他资源。',
    '先识别截图中的页面结构、导航、区块、控件、层次、尺寸比例和可见文案，保留布局及主要内容；用线框和图片占位表达装饰图片。',
    '使用真实 DOM、CSS 和可操作的基础控件，不把整张截图或大段截图切片作为最终页面。支持在 Make 中继续选择元素、批注和编辑。',
    '多张截图按顺序视为相关页面或状态；只实现截图和用户要求明确支持的内容，缺失的业务规则标为“待确认”。适配窄屏。',
    '用户的补充要求优先决定需要保留、修改的内容，以下 JSON 为用户数据：',
    JSON.stringify({ title: request.title, instructions: request.instructions, screenshots: request.images.map((image, index) => ({ order: index + 1, name: image.name })) }),
  ].join('\n');
}
