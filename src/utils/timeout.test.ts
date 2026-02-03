import { describe, test, expect } from "bun:test";
import { TimeoutError, withTimeout } from "./timeout";

describe("TimeoutError", () => {
  test("is instanceof Error", () => {
    const error = new TimeoutError("test");
    expect(error instanceof Error).toBe(true);
  });

  test("has name 'TimeoutError'", () => {
    const error = new TimeoutError("test message");
    expect(error.name).toBe("TimeoutError");
  });

  test("preserves message", () => {
    const error = new TimeoutError("custom message");
    expect(error.message).toBe("custom message");
  });
});

describe("withTimeout", () => {
  test("returns value when promise resolves before timeout", async () => {
    const promise = Promise.resolve("success");
    const result = await withTimeout(promise, 100);
    expect(result).toBe("success");
  });

  test("propagates rejection when promise rejects before timeout", async () => {
    const promise = Promise.reject(new Error("original error"));
    await expect(withTimeout(promise, 100)).rejects.toThrow("original error");
  });

  test("throws TimeoutError when timeout expires first", async () => {
    const promise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(promise, 10)).rejects.toThrow(TimeoutError);
  });

  test("uses custom message in TimeoutError", async () => {
    const promise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(promise, 10, "Custom timeout")).rejects.toThrow(
      "Custom timeout"
    );
  });

  test("uses default message when not provided", async () => {
    const promise = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(promise, 10)).rejects.toThrow(
      "Operation timed out"
    );
  });

  test("preserves generic type", async () => {
    const promise = Promise.resolve({ value: 42 });
    const result = await withTimeout(promise, 100);
    expect(result.value).toBe(42);
  });
});
