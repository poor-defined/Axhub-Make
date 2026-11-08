import { describe, expect, it } from 'vitest';
import { isOpaqueReferenceStaticRequest } from './referenceStaticCors';
describe('opaque reference bootstrap CORS', () => {
  it('allows only public built assets, never source modules, APIs or writes', () => {
    const request = (url: string, method = 'GET', origin = 'null') => ({
      url,
      method,
      headers: { origin },
    });
    expect(isOpaqueReferenceStaticRequest(request('/assets/html-template-bootstrap.js'))).toBe(
      true,
    );
    expect(isOpaqueReferenceStaticRequest(request('/assets/font.woff2?v=1'))).toBe(true);
    for (const url of [
      '/src/html-template/index.tsx',
      '/node_modules/.vite/deps/react.js',
      '/@fs/fake-project/.local/config.json?import',
      '/api/config',
      '/assets/settings.json?import',
      '/assets/..%2f.local/fixture.js',
      '/assets/%2e%2e/.local/fixture.js',
      '/assets/../src/app.js',
      '/assets/%5c..%5cfixture.js',
    ])
      expect(isOpaqueReferenceStaticRequest(request(url))).toBe(false);
    expect(isOpaqueReferenceStaticRequest(request('/assets/runtime.js', 'POST'))).toBe(false);
    expect(
      isOpaqueReferenceStaticRequest(request('/assets/runtime.js', 'GET', 'https://evil.test')),
    ).toBe(false);
  });
});
