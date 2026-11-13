export function normalizeRoutePath(input: string): string {
  let path = input.trim();

  try {
    if (/^https?:\/\//i.test(path)) {
      path = new URL(path).pathname;
    }
  } catch {
    // Keep the original text; a malformed URL is still useful evidence.
  }

  path = path.split("?")[0]?.split("#")[0] ?? path;
  path = path.replace(/\{[^/{}]+\}/g, "{}");
  path = path.replace(/\/+/g, "/");

  if (!path.startsWith("/")) path = `/${path}`;
  return path;
}

export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeRoutePath(path)}`;
}
