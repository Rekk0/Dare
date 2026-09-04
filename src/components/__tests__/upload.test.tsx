// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UploadEvidencePage from "@/app/a/[id]/upload/page";
import { MAX_BYTES } from "@/core/upload-policy";
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "activity-1" }), useRouter: () => ({ replace }) }));
function mockFetch() { return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignmentId: "assignment-1" }) }); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined }); });
describe("证据上传页", () => {
  it("取景器不可用时显示文件兜底，不提 HTTPS", () => { vi.stubGlobal("fetch", mockFetch()); render(<UploadEvidencePage />); expect(screen.getByLabelText("上传证据文件")).not.toBeNull(); expect(screen.queryByText(/HTTPS/)).toBeNull(); });
  it("超限文件在提交前拦下", async () => { const fetchMock = mockFetch(); vi.stubGlobal("fetch", fetchMock); render(<UploadEvidencePage />); const file = new File([new Uint8Array(MAX_BYTES.image + 1)], "big.jpg", { type: "image/jpeg" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); expect(await screen.findByText("文件太大了，请压缩体积")).not.toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2); });
  it("非白名单格式在提交前拦下", async () => { const fetchMock = mockFetch(); vi.stubGlobal("fetch", fetchMock); render(<UploadEvidencePage />); const file = new File(["x"], "note.txt", { type: "text/plain" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); expect(await screen.findByText("这个格式不收")).not.toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2); });
  it("上传完成后显示已传证据", async () => { const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ assignmentId: "assignment-1" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ evidence: [] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://upload.example/evidence", key: "key" }) }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, json: async () => ({ evidence: [{ id: "e1", kind: "image", url: "/e1.jpg", mime: "image/jpeg" }] }) }); vi.stubGlobal("fetch", fetchMock); const { container } = render(<UploadEvidencePage />); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); const file = new File(["photo"], "evidence.jpg", { type: "image/jpeg" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); await screen.findByLabelText("已上传"); expect(container.querySelector('img[src="/e1.jpg"]')).not.toBeNull(); });
});

describe("取景器用不了的时候", () => {
  it("不摆一个永远点不动的拍照按钮，底部按钮直接变成上传", () => {
    // 之前 fallback 下照样渲染「拍下」，点了只说「镜头还没就位」，
    // 用户当然以为是坏了
    vi.stubGlobal("fetch", mockFetch());
    render(<UploadEvidencePage />);

    expect(screen.queryByRole("button", { name: "拍下" })).toBeNull();
    expect(screen.getByRole("button", { name: "从手机上传" })).not.toBeNull();
  });

  it("文件选择器不带 capture，交给系统给出完整的选择", () => {
    // capture="environment" 会让系统直接开相机而不是文件选择器，
    // 「选一份反而唤起相机」就是它造成的
    vi.stubGlobal("fetch", mockFetch());
    render(<UploadEvidencePage />);

    expect(screen.getByLabelText("上传证据文件").getAttribute("capture")).toBeNull();
  });
});
