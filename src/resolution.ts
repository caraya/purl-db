export interface PurlMapping {
  path: string;
  targetUrl: string;
  isActive: boolean;
}

export function selectBestMapping<T extends PurlMapping>(
  requestPath: string,
  mappings: T[],
): T | undefined {
  return mappings
    .filter(({ path, isActive }) => {
      if (!isActive) return false;
      if (path === '/') return requestPath.startsWith('/');
      return requestPath === path || requestPath.startsWith(`${path}/`);
    })
    .sort((left, right) => right.path.length - left.path.length)[0];
}

export function resolveTargetUrl(targetUrl: string, mappingPath: string, requestPath: string): string {
  const target = new URL(targetUrl);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new TypeError('PURL targets must use HTTP or HTTPS.');
  }

  const remainder = mappingPath === '/' ? requestPath : requestPath.slice(mappingPath.length);
  if (!remainder) return target.toString();

  const basePath = target.pathname.replace(/\/+$/, '');
  target.pathname = `${basePath}/${remainder.replace(/^\/+/, '')}`;
  return target.toString();
}