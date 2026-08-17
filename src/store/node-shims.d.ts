declare module "node:crypto" {
  export function randomUUID(): string;
}

declare module "node:fs/promises" {
  export interface FileHandle {
    close(): Promise<void>;
    sync(): Promise<void>;
    writeFile(data: string, encoding: "utf8"): Promise<void>;
  }

  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }

  export function access(path: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function open(path: string, flags: string): Promise<FileHandle>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  export function realpath(path: string): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function rm(path: string, options?: { force?: boolean }): Promise<void>;
  export function writeFile(
    path: string,
    data: string,
    options?: { encoding?: "utf8"; flag?: string },
  ): Promise<void>;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
  export const sep: string;
}

declare const process: {
  cwd(): string;
  platform: string;
};
