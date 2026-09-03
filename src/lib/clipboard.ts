/**
 * 复制到剪贴板。
 *
 * **不能只用 `navigator.clipboard`。** 它只在安全上下文里存在，
 * 局域网真机测试走的是 http://10.x.x.x，那边 `navigator.clipboard`
 * 直接是 undefined - 写成 `navigator.clipboard?.writeText(x)` 的话
 * 点了没反应也不报错，比报错还难查。
 *
 * 所以退回老办法：塞一个屏幕外的 textarea，选中，execCommand。
 * 这个 API 已经废弃但所有浏览器都还支持，而且不挑安全上下文。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 有的浏览器在没有用户手势时会拒绝，掉到下面的兜底
    }
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
