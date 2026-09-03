// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidenceLightbox, EvidenceThumb } from "../EvidenceViewer";
import type { EvidenceDto } from "@/core/visibility";

afterEach(cleanup);

const image: EvidenceDto = { id: "e1", kind: "image", url: "/e1.png", mime: "image/png" };
const video: EvidenceDto = { id: "e2", kind: "video", url: "/e2.mp4", mime: "video/mp4" };
const audio: EvidenceDto = { id: "e3", kind: "audio", url: "/e3.m4a", mime: "audio/mp4" };

describe("证据缩略图", () => {
  it("图片和视频点得开，音频不需要放大", () => {
    // 声音没有大小之分，原地那个播放条已经够用
    const onOpen = vi.fn();
    const { rerender } = render(<EvidenceThumb item={image} label="第 1 份证据" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "放大看第 1 份证据" }));
    expect(onOpen).toHaveBeenCalledWith(image);

    rerender(<EvidenceThumb item={video} label="第 2 份证据" onOpen={onOpen} />);
    expect(screen.getByRole("button", { name: "放大看第 2 份证据" })).not.toBeNull();

    rerender(<EvidenceThumb item={audio} label="第 3 份证据" onOpen={onOpen} />);
    expect(screen.queryByRole("button", { name: /放大看/ })).toBeNull();
  });

  it("视频缩略图不带 controls，点一下是放大不是播放", () => {
    const { container } = render(<EvidenceThumb item={video} label="证据" onOpen={vi.fn()} />);
    expect(container.querySelector("video")?.hasAttribute("controls")).toBe(false);
  });
});

describe("证据放大层", () => {
  it("没选中东西时不渲染", () => {
    const { container } = render(<EvidenceLightbox item={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("音频不进放大层", () => {
    const { container } = render(<EvidenceLightbox item={audio} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("点背景关，点内容本身不关", () => {
    const onClose = vi.fn();
    render(<EvidenceLightbox item={image} onClose={onClose} />);

    fireEvent.click(screen.getByRole("img", { name: "放大的证据" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("按 Esc 关得掉", () => {
    // 少了这条在桌面上就变成「关不掉」
    const onClose = vi.fn();
    render(<EvidenceLightbox item={image} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭按钮能点", () => {
    const onClose = vi.fn();
    render(<EvidenceLightbox item={video} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "关掉" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("开着的时候锁住背后的滚动，关掉后还回去", () => {
    // 不锁的话手指一划，背后的列表跟着一起跑
    const { rerender, unmount } = render(<EvidenceLightbox item={null} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("");

    rerender(<EvidenceLightbox item={image} onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
