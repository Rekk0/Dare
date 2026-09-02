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
  it("超限文件在提交前拦下", async () => { const fetchMock = mockFetch(); vi.stubGlobal("fetch", fetchMock); render(<UploadEvidencePage />); const file = new File([new Uint8Array(MAX_BYTES.image + 1)], "big.jpg", { type: "image/jpeg" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); expect(await screen.findByText("文件太大了，换一份轻的")).not.toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("非白名单格式在提交前拦下", async () => { const fetchMock = mockFetch(); vi.stubGlobal("fetch", fetchMock); render(<UploadEvidencePage />); const file = new File(["x"], "note.txt", { type: "text/plain" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); expect(await screen.findByText("这个格式不收")).not.toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1); });
  it("上传完成后不渲染媒体预览", async () => { const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ assignmentId: "assignment-1" }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://upload.example/evidence", key: "key" }) }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }); vi.stubGlobal("fetch", fetchMock); const { container } = render(<UploadEvidencePage />); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); const file = new File(["photo"], "evidence.jpg", { type: "image/jpeg" }); fireEvent.change(screen.getByLabelText("上传证据文件"), { target: { files: [file] } }); await screen.findByLabelText("已上传"); expect(container.querySelector('img[src], video[src]')).toBeNull(); });
});
