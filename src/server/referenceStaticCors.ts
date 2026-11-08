/** Sandboxed references use prebuilt, public assets rather than Vite source modules.
 * Never extend this allowance to project source, JSON modules, or write APIs. */
export function isOpaqueReferenceStaticRequest(request: {
  method?: string;
  url?: string;
  headers: { origin?: string };
}): boolean {
  if (request.method !== 'GET' || request.headers.origin !== 'null') return false;
  const rawPath = (request.url || '').split('?')[0];
  if (/%(?:2f|5c)/iu.test(rawPath)) return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (
    /[\\\0\r\n]/u.test(pathname) ||
    pathname.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return false;
  return (
    pathname.startsWith('/assets/') &&
    /\.(?:m?js|css|woff2?|ttf|wasm|png|jpe?g|svg|webp|gif|ico)$/iu.test(pathname)
  );
}
