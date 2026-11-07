/** One real component capture; the note is shared with the prototype action. */
export interface ComponentDocumentationCapture {
  imageDataUrl: string;
  note: string;
  component: { name: string; selector?: string; text?: string };
  source: { title: string; url: string };
}
export interface ComponentDocumentationDraft {
  title: string;
  description: string;
}
export interface ComponentDocumentationDocument {
  path: string;
  title: string;
}
export const MAX_COMPONENT_SCREENSHOT_BYTES = 8 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('组件图文数据格式无效');
  return value as Record<string, unknown>;
}
export function componentDocumentationText(
  value: unknown,
  name: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()))
    throw new Error(`${name}格式无效或超过长度限制`);
  return value.trim();
}
export function validateComponentDocumentationCapture(
  value: unknown,
): ComponentDocumentationCapture {
  const input = record(value);
  const component = record(input.component);
  const source = record(input.source);
  const imageDataUrl = componentDocumentationText(
    input.imageDataUrl,
    '组件截图',
    Math.ceil((MAX_COMPONENT_SCREENSHOT_BYTES * 4) / 3) + 100,
  );
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(imageDataUrl))
    throw new Error('组件截图必须是 PNG 图片');
  const url = componentDocumentationText(source.url, '来源地址', 4000);
  try {
    if (/[\r\n\0]/u.test(url) || !['http:', 'https:'].includes(new URL(url).protocol))
      throw new Error();
  } catch {
    throw new Error('来源地址必须是有效的 HTTP 或 HTTPS 页面');
  }
  return {
    imageDataUrl,
    note: componentDocumentationText(input.note ?? '', '批注', 8000, true),
    component: {
      name: componentDocumentationText(component.name, '组件名称', 200),
      ...(component.selector === undefined
        ? {}
        : { selector: componentDocumentationText(component.selector, '组件定位', 2000, true) }),
      ...(component.text === undefined
        ? {}
        : { text: componentDocumentationText(component.text, '组件文字', 20000, true) }),
    },
    source: { title: componentDocumentationText(source.title, '来源页面名称', 300), url },
  };
}
export function validateComponentDocumentationDraft(value: unknown): ComponentDocumentationDraft {
  const input = record(value);
  return {
    title: componentDocumentationText(input.title, '图文标题', 200),
    description: componentDocumentationText(input.description, '组件说明', 40000),
  };
}

export function parseComponentDocumentationDraft(text: string): ComponentDocumentationDraft {
  if (text.length > 200_000) throw new Error('AI 图文结果超过大小限制');
  // ACP can prepend this known benign startup diagnostic to the model text.
  // Do not discard arbitrary prose or warnings around a JSON-looking substring.
  const skillBudgetDiagnostic =
    'Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';
  let source = text.trim();
  if (source.startsWith(`${skillBudgetDiagnostic}\n`)) {
    source = source.slice(skillBudgetDiagnostic.length).trimStart();
  }
  source = source.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u, '$1');
  return validateComponentDocumentationDraft(JSON.parse(source));
}
