import { HeaderSkeleton, ListSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Notifications: header, the All / Unread filter and the list. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <div className="flex gap-1">
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="bg-card rounded-xl border p-4">
        <ListSkeleton rows={8} action />
      </div>
    </LoadingPage>
  );
}
