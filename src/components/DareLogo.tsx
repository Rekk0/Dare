/**
 * DARE 的标识。
 *
 * DESIGN.md 第 25 条说这个应用「不靠图形 logo 也认得出」，认出来的是**涂黑条**。
 * 所以标识就是涂黑条本身：一整条记号笔黄，四个字母从里面挖空，
 * 下面跟两条真涂黑的短条，读起来是一页被涂满的机密文件。
 *
 * **字母是手写路径，不是文字。** 得意黑的子集只收了 display 文案要的字，
 * A 和 R 都不在里面，源字体又不在仓库里没法重新裁 -
 * 用字体渲染的话会静默掉回系统字，每台设备长得都不一样。
 *
 * 挖空用 mask 而不是把字母填成底色：这样底色换了标识也不会露馅。
 *
 * 每个字母在自己的 translate 里用局部坐标画（字宽 56，字高 80，字距 14），
 * 不在路径里写绝对 x - 之前那版就是把 A 的起点从 90 手算成了 108，
 * 结果 D 和 A 之间的缝是别处的两倍。
 */
const LETTER_W = 56;
const GAP = 14;
const PAD = 20;
const SLAB_W = PAD * 2 + LETTER_W * 4 + GAP * 3; // 306

/** 字母的局部路径，原点在字的左上角，fillRule=evenodd 挖内部的洞 */
const GLYPHS = [
  // D
  "M0 0 H40 L56 16 V64 L40 80 H0 Z M17 17 V63 H33 L39 57 V23 L33 17 Z",
  // A
  "M0 80 L18 0 H38 L56 80 H39 L35 60 H21 L17 80 Z M24 44 H32 L28 22 Z",
  // R
  "M0 0 H38 L54 14 V32 L44 44 L56 80 H38 L28 48 H17 V80 H0 Z M17 17 V31 H33 L37 27 V21 L33 17 Z",
  // E
  "M0 0 H56 V17 H17 V31 H46 V48 H17 V63 H56 V80 H0 Z",
];

export default function DareLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`-6 -6 ${SLAB_W + 12} 162`}
      className={className}
      role="img"
      aria-label="DARE"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id="dare-cut">
        {/* 白的留下，黑的挖掉 */}
        <rect x="0" y="0" width={SLAB_W} height="112" fill="#fff" />
        <g fill="#000" fillRule="evenodd">
          {GLYPHS.map((d, i) => (
            <path key={d} d={d} transform={`translate(${PAD + i * (LETTER_W + GAP)} 16)`} />
          ))}
        </g>
      </mask>

      {/* 记号笔黄的整条，字母是挖穿的洞，底色透过去 */}
      <rect
        x="0"
        y="0"
        width={SLAB_W}
        height="112"
        rx="3"
        fill="var(--mark)"
        mask="url(#dare-cut)"
        transform={`rotate(-1.2 ${SLAB_W / 2} 56)`}
      />

      {/* 下面两条是真涂黑，什么都不露 */}
      <rect x="0" y="126" width="196" height="12" rx="2" fill="var(--redact)" />
      <rect x="206" y="126" width="74" height="12" rx="2" fill="var(--redact)" />
    </svg>
  );
}
