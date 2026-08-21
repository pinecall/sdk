// Keep one instance per process, across dev hot-reloads (Vite re-evaluates
// modules; globalThis survives). The same idea as @epic-web/remember.
export const remember = <T>(name: string, create: () => T): T =>
  ((globalThis as any)[`__${name}`] ??= create());
