import { describe, expect, it } from 'vitest';
import {
  validateComponentDocumentationCapture,
  validateComponentDocumentationDraft,
  parseComponentDocumentationDraft,
} from './componentDocumentation';
const capture = {
  imageDataUrl: 'data:image/png;base64,aGVsbG8=',
  note: '',
  component: { name: '组件' },
  source: { title: '来源页', url: 'http://localhost:53818/' },
};
describe('component documentation contracts', () => {
  it('allows the shared comment input to be empty and normalizes descriptions', () => {
    expect(validateComponentDocumentationCapture(capture).note).toBe('');
    expect(validateComponentDocumentationDraft({ title: ' 标题 ', description: ' 说明 ' })).toEqual(
      { title: '标题', description: '说明' },
    );
  });
  it.each(['http://', 'https://\ninvalid host', 'javascript:alert(1)', 'file:///etc/passwd'])(
    'rejects invalid source URL %s',
    (url) => {
      expect(() =>
        validateComponentDocumentationCapture({ ...capture, source: { ...capture.source, url } }),
      ).toThrow();
    },
  );
  it.each([
    { title: '', description: 'a' },
    { title: 'a', description: '' },
    { title: 1, description: 'a' },
  ])('rejects invalid result %j', (value) => {
    expect(() => validateComponentDocumentationDraft(value)).toThrow();
  });
  it('parses actual Codex startup diagnostic followed by the JSON result and optional JSON fences', () => {
    const diagnostic =
      'Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';
    const draft = { title: '查询组件', description: '展示查询按钮。\n\n### 待确认\n查询权限。' };
    const json = JSON.stringify(draft);
    expect(parseComponentDocumentationDraft(`${diagnostic}\n\n${json}`)).toEqual(draft);
    expect(parseComponentDocumentationDraft(diagnostic + '\n\n```json\n' + json + '\n```')).toEqual(
      draft,
    );
    expect(parseComponentDocumentationDraft('```json\n' + json + '\n```')).toEqual(draft);
    expect(parseComponentDocumentationDraft(json)).toEqual(draft);
  });
  it.each([
    'This is your result:\n{"title":"x","description":"y"}',
    'Warning: Something unsafe happened\n{"title":"x","description":"y"}',
    '{"title":"x","description":"y"}\ntrailing prose',
    '```javascript\n{"title":"x","description":"y"}\n```',
  ])('does not strip arbitrary prose or warnings from model output %s', (text) => {
    expect(() => parseComponentDocumentationDraft(text)).toThrow();
  });
});
