import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME,
  MAX_BYTES,
  MAX_EVIDENCE_PER_ASSIGNMENT,
  buildStorageKey,
  checkUpload,
} from "../upload-policy";
import type { UploadRequest } from "../upload-policy";
import type { ActivityStatus } from "../visibility";

const validRequest: UploadRequest = {
  mime: "image/jpeg",
  bytes: 1,
  requesterPid: "assignee-pid",
  assigneePid: "assignee-pid",
  activityStatus: "running",
  existingEvidenceCount: 0,
};

describe("上传策略", () => {
  it("拒绝非执行者上传，避免其他参与者伪造任务证据", () => {
    expect(checkUpload({ ...validRequest, requesterPid: "other-pid" })).toEqual({
      ok: false,
      denial: { reason: "not_assignee" },
    });
  });

  it.each(["draft", "recruiting", "locked", "voting", "settled"] as ActivityStatus[])(
    "%s 阶段拒绝上传",
    (activityStatus) => {
      expect(checkUpload({ ...validRequest, activityStatus })).toEqual({
        ok: false,
        denial: { reason: "wrong_phase" },
      });
    },
  );

  it.each(["text/plain", "application/pdf", "image/gif"])("拒绝非法 mime: %s", (mime) => {
    expect(checkUpload({ ...validRequest, mime })).toEqual({
      ok: false,
      denial: { reason: "bad_mime", mime },
    });
  });

  it.each(Object.entries(ALLOWED_MIME).flatMap(([kind, mimes]) => mimes.map((mime) => [kind, mime])))
    ("允许白名单 mime: %s / %s", (kind, mime) => {
      expect(checkUpload({ ...validRequest, mime })).toEqual({ ok: true, kind });
    });

  it.each(Object.entries(MAX_BYTES))(
    "%s 正好上限允许，超出 1 字节拒绝",
    (kind, limit) => {
      const mime = ALLOWED_MIME[kind as keyof typeof ALLOWED_MIME][0];
      expect(checkUpload({ ...validRequest, mime, bytes: limit })).toEqual({ ok: true, kind });
      expect(checkUpload({ ...validRequest, mime, bytes: limit + 1 })).toEqual({
        ok: false,
        denial: { reason: "too_large", limit },
      });
    },
  );

  it("证据达到上限后拒绝上传", () => {
    expect(
      checkUpload({ ...validRequest, existingEvidenceCount: MAX_EVIDENCE_PER_ASSIGNMENT }),
    ).toEqual({
      ok: false,
      denial: { reason: "too_many", limit: MAX_EVIDENCE_PER_ASSIGNMENT },
    });
  });

  it("非执行者优先于 mime 校验", () => {
    expect(checkUpload({ ...validRequest, requesterPid: "other-pid", mime: "text/plain" })).toEqual({
      ok: false,
      denial: { reason: "not_assignee" },
    });
  });

  it("存储 key 每次随机，且不含可推测的身份信息", () => {
    const activityId = "activity-secret-id";
    const assignmentId = "assignment-secret-id";
    const participantId = "participant-secret-id";
    const first = buildStorageKey("image/jpeg");
    const second = buildStorageKey("image/jpeg");

    expect(first).not.toBe(second);
    expect(first).not.toContain(activityId);
    expect(first).not.toContain(assignmentId);
    expect(first).not.toContain(participantId);
    expect(second).not.toContain(activityId);
    expect(second).not.toContain(assignmentId);
    expect(second).not.toContain(participantId);
  });
});

describe("buildStorageKey 的路径穿越防护", () => {
  it("扩展名从 mime 推导，调用方无法传入路径片段", () => {
    // 自由传扩展名的话，`../../../evil` 就能把 key 指到存储目录之外。
    // 取消这个输入比事后清洗它可靠。
    const key = buildStorageKey("image/jpeg");

    expect(key).toMatch(/^[0-9a-f]{32}\.jpg$/);
    expect(key).not.toContain("..");
    expect(key).not.toContain("/");
    expect(key).not.toContain("\\");
  });

  it("每种白名单 mime 都能推导出安全的扩展名", () => {
    for (const mimes of Object.values(ALLOWED_MIME)) {
      for (const mime of mimes) {
        expect(buildStorageKey(mime)).toMatch(/^[0-9a-f]{32}\.[a-z0-9]{2,4}$/);
      }
    }
  });

  it("非白名单 mime 抛错而不是生成无扩展名的 key", () => {
    expect(() => buildStorageKey("application/x-sh")).toThrow(/不支持的 mime/);
    expect(() => buildStorageKey("../../evil")).toThrow(/不支持的 mime/);
  });
});

describe("bytes 的边界校验", () => {
  const base = {
    mime: "image/jpeg",
    requesterPid: "p1",
    assigneePid: "p1",
    activityStatus: "running" as const,
    existingEvidenceCount: 0,
  };

  it("负数和 NaN 被拒", () => {
    // 这两个都会绕过上限比较：`-1 > limit` 和 `NaN > limit` 都是 false
    expect(checkUpload({ ...base, bytes: -1 }).ok).toBe(false);
    expect(checkUpload({ ...base, bytes: Number.NaN }).ok).toBe(false);
    expect(checkUpload({ ...base, bytes: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("零字节被拒", () => {
    expect(checkUpload({ ...base, bytes: 0 }).ok).toBe(false);
  });

  it("1 字节通过", () => {
    expect(checkUpload({ ...base, bytes: 1 }).ok).toBe(true);
  });
});
