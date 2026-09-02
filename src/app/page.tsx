import TaskCard from "@/components/TaskCard";
import type { MyAssignmentDto } from "@/core/visibility";

const assignment: MyAssignmentDto = {
  assignmentId: "demo-assignment",
  taskContent: "想办法让坐在你右边的人主动唱一首粤语歌，全程不能提到唱这个字。",
  busted: false,
  bustedByPid: null,
};

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[420px] items-center px-5 py-8">
      <TaskCard assignment={assignment} endAt={new Date(Date.now() + 45 * 60 * 1_000)} />
    </main>
  );
}
