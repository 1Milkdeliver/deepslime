declare module "node:assert/strict" {
  interface AssertStrict {
    (actual: unknown, message?: string | Error): asserts actual;
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): asserts value;
  }

  const assert: AssertStrict;
  export default assert;
}

declare module "node:test" {
  type TestBody = () => void | Promise<void>;
  export default function test(name: string, body: TestBody): void;
}
