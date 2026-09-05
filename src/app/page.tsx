import DareLogo from "@/components/DareLogo";

/**
 * 落地页。
 *
 * 只做一件事：把人分到三条路上去。建活动的表单挪到了 /new，
 * 首页直接铺一张表单会让第一次打开的人以为这就是全部功能，
 * 而大多数人来这里是要进别人开的局，不是开一局。
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] flex-col px-5 py-8">
      <div className="flex flex-1 flex-col justify-center">
        <DareLogo className="w-full max-w-[300px]" />
        {/* 不设 max-w：最长一句 13 个字，420px 的壳里放得下，
            限宽反而会把一句话折成两行 */}
        {/* leading 比正文松：三行里两行带笔画，行距不给够笔画会贴上一行 */}
        <p className="mt-8 text-[17px] leading-10 text-body">
          发布<mark className="hl"><span>秘密任务</span></mark>，悄悄完成任务
          <br />
          完成任务，领取<mark className="hl"><span>奖励</span></mark>
          <br />
          破解别人任务，夺取<mark className="hl"><span>奖励</span></mark>
        </p>
      </div>

      <nav className="grid gap-3 pb-2">
        <a
          href="/new"
          className="flex min-h-14 items-center justify-center rounded-full bg-mark text-[16px] font-bold text-ground"
        >
          新建活动
        </a>
        <a
          href="/join"
          className="flex min-h-14 items-center justify-center rounded-full border border-line text-[16px] font-bold text-bright"
        >
          输入邀请码
        </a>
        <a
          href="/mine"
          className="flex min-h-14 items-center justify-center rounded-full border border-line text-[16px] font-bold text-bright"
        >
          我的活动
        </a>
      </nav>
    </main>
  );
}
