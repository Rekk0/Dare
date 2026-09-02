import { describe, expect, it } from "vitest";

import { LocalStorage, verifyLocalSignature } from "../local";

describe("本地存储签名", () => {
  it("签出的上传 URL 能验证通过", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", 60_000);

    const url = new URL(signed.url, "http://localhost");
    expect(url.pathname).toBe("/api/storage/activities/a/file.jpg");
    expect(verifyLocalSignature("upload", "activities/a/file.jpg", url.searchParams.get("exp"), "image/jpeg", url.searchParams.get("sig"))).toBe(true);
  });

  it("过期签名验证失败", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", -1);

    const url = new URL(signed.url, "http://localhost");
    expect(verifyLocalSignature("upload", "activities/a/file.jpg", url.searchParams.get("exp"), "image/jpeg", url.searchParams.get("sig"))).toBe(false);
  });

  it("篡改 key 后验证失败", async () => {
    const storage = new LocalStorage();
    const signed = await storage.signUpload("activities/a/file.jpg", "image/jpeg", 60_000);
    const url = new URL(signed.url, "http://localhost");
    url.pathname = "/api/storage/activities/a/other.jpg";

    expect(verifyLocalSignature("upload", "activities/a/other.jpg", url.searchParams.get("exp"), "image/jpeg", url.searchParams.get("sig"))).toBe(false);
  });

  it("上传和下载签名不能互用", async () => {
    const storage = new LocalStorage();
    const upload = await storage.signUpload("activities/a/file.jpg", "image/jpeg", 60_000);
    const url = new URL(upload.url, "http://localhost");

    expect(verifyLocalSignature("download", "activities/a/file.jpg", url.searchParams.get("exp"), "", url.searchParams.get("sig"))).toBe(false);
  });
});
