import { LoadingPage, CardSkeleton, ListSkeleton } from "@/components/app/skeletons";

/** Demo inbox: the list of captured emails. */
export default function Loading() {
  return (
    <LoadingPage>
      <CardSkeleton description>
        <ListSkeleton rows={4} action />
      </CardSkeleton>
    </LoadingPage>
  );
}
