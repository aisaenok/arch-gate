export function register<T extends (...args: any[]) => unknown>(
  callback: T
): T {
  return callback;
}
