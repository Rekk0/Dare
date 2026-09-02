import { describe, expect, it } from "vitest";

import { LocalStorage, verifyLocalSignature } from "../local";

describe("本地存储签名", () => {
  it("签出的上传 URL 能验证通过", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", 60_000);

    expect(verifyLocalSignature(signed.url)).toBe(true);
  });

  it("过期签名验证失败", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", -1);

    expect(verifyLocalSignature(signed.url)).toBe(false);
  });

  it("篡改 key 后验证失败", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", 60_000);
    const url = new URL(signed.url);
    url.searchParams.set("key", "activities/a/other.jpg");

    expect(verifyLocalSignature(url.toString())).toBe(false);
  });
});
