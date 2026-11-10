import { LoadingPage, HeaderSkeleton, BoardSkeleton } from "@/components/app/skeletons";

/** Dispatch board: toolbar, lanes and the unscheduled queue. */
export default function Loading() {
  return (
    <LoadingPage className="space-y-4">
      <HeaderSkeleton action />
      <BoardSkeleton />
    </LoadingPage>
  );
}
