import { describe, it, expect } from "vitest";
import { crc32c } from "../src/crc32c";

describe("crc32c", () => {
  it("matches the standard test vector for '123456789'", () => {
    expect(crc32c(Buffer.from("123456789"))).toBe(0xe3069283);
  });

  it("is 0 for empty input and deterministic", () => {
    expect(crc32c(new Uint8Array())).toBe(0);
    const data = Buffer.from("the quick brown fox");
    expect(crc32c(data)).toBe(crc32c(data));
  });
});
