declare module "node:fs/promises" {
  export function lstat(path: string): Promise<unknown>;
  export function realpath(path: string): Promise<string>;
}

declare module "node:path" {
  interface PathFlavor {
    isAbsolute(path: string): boolean;
  }

  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
  export const posix: PathFlavor;
  export const win32: PathFlavor;
}
