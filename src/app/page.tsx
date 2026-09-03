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
        <p className="mt-8 max-w-[22ch] text-[17px] leading-8 text-body">
          给朋友留一道暗任务。
          <br />
          做成了拿走一份，被猜中就归零。
        </p>
      </div>

      <nav className="grid gap-3 pb-2">
        <a
          href="/new"
          className="flex min-h-14 items-center justify-center rounded-full bg-mark text-[16px] font-bold text-ground"
        >
          攒一局
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
          我参加的局
        </a>
      </nav>
    </main>
  );
}
