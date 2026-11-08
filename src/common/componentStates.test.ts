import { expect, it } from 'vitest';
import { buildComponentStatesPrompt, validateComponentStatesRequest } from './componentStates';
const capture = { imageDataUrl: 'data:image/png;base64,aGVsbG8=', note: '未登录、已登录；说明变化', component: { name: 'Header [prd:cfd-f01-header]', selector: 'header' }, source: { title: 'CFD', url: 'http://localhost:51720/?p=cfd' } };
it('requires explicit state instructions, a valid screenshot and a bounded new prototype name', () => {
  const request = validateComponentStatesRequest({ capture, title: 'Header 状态说明', layout: 'overview', sourceHtml: '<header />' });
  expect(request.capture.note).toBe(capture.note);
  for (const patch of [{ title: '' }, { title: 'x'.repeat(101) }, { layout: 'unknown' }, { sourceHtml: 'x'.repeat(60001) }, { capture: { ...capture, note: '' } }]) expect(() => validateComponentStatesRequest({ ...request, ...patch })).toThrow();
});
it('scopes generation to the new prototype and describes states without inventing confirmed business rules', () => {
  const request = validateComponentStatesRequest({ capture, title: 'Header 状态说明', layout: 'overview' });
  const prompt = buildComponentStatesPrompt(request, { component: { suffix: 'part' } });
  expect(prompt).toContain('同页平铺');
  expect(prompt).toContain('触发条件');
  expect(prompt).toContain('待确认');
  expect(prompt).toContain('只写入新建原型');
  expect(prompt).toContain('cfd-f01-header-part-');
  expect(prompt).not.toContain(capture.imageDataUrl);
});
