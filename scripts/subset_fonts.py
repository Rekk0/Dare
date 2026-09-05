#!/usr/bin/env python3
"""
字体子集化 - Spike B

得意黑（Smiley Sans）全量 woff2 约 1.1MB，作为 display 字体给移动端首屏用太重。
但它只需要渲染几十个固定的字：「暴露了」「猜中了」这类情绪节点文案 + 数字。

所以把 display 字体按一份显式的字符清单裁剪。清单是显式维护的文件，
新增 display 文案时必须同步更新 fonts/display-charset.txt，否则会掉字。

用法：
    python scripts/subset_fonts.py

依赖：fonttools[woff]  (pip install "fonttools[woff]" brotli)
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "fonts" / "src" / "SmileySans-Oblique.ttf"
CHARSET = ROOT / "fonts" / "display-charset.txt"
OUT = ROOT / "public" / "fonts" / "smiley-sans-subset.woff2"

# 上限。超过说明 display 字体被滥用到正文上了，应该改用普惠体而不是放宽这个数。
MAX_BYTES = 100 * 1024


def load_charset() -> str:
    if not CHARSET.exists():
        sys.exit(f"缺少字符清单: {CHARSET}")
    raw = CHARSET.read_text(encoding="utf-8")
    # 清单文件里以 # 开头的行是注释
    lines = [ln for ln in raw.splitlines() if not ln.lstrip().startswith("#")]
    chars = set("".join(lines))
    chars.discard("\n")
    chars.discard("\r")
    return "".join(sorted(chars))


def main() -> None:
    try:
        from fontTools import subset
    except ImportError:
        sys.exit('缺少 fonttools。运行: pip install "fonttools[woff]" brotli')

    if not SRC.exists():
        sys.exit(
            f"缺少源字体: {SRC}\n"
            "先下载 https://github.com/atelier-anchor/smiley-sans/releases 并解压到 fonts/src/"
        )

    chars = load_charset()
    OUT.parent.mkdir(parents=True, exist_ok=True)

    args = [
        str(SRC),
        f"--text={chars}",
        "--flavor=woff2",
        f"--output-file={OUT}",
        # 只保留渲染必需的表，layout feature 对这个用途没用
        "--layout-features=",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
        "--name-IDs=*",
        "--notdef-outline",
    ]
    subset.main(args)

    src_size = SRC.stat().st_size
    out_size = OUT.stat().st_size
    print(f"字符数     : {len(chars)}")
    print(f"源字体     : {src_size / 1024:.0f} KB  ({SRC.name})")
    print(f"子集 woff2 : {out_size / 1024:.1f} KB  ({OUT.relative_to(ROOT)})")
    print(f"压缩比     : {out_size / src_size * 100:.2f}%")

    if out_size > MAX_BYTES:
        sys.exit(
            f"\n子集超过上限 {MAX_BYTES / 1024:.0f} KB。"
            "display 字体可能被用到正文上了，正文应该用普惠体。"
        )
    print(f"\n通过：低于 {MAX_BYTES / 1024:.0f} KB 上限")


if __name__ == "__main__":
    main()
