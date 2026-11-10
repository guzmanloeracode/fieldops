import { CardSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Notification settings: one row per event with two channel switches. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <CardSkeleton>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1">
            <Skeleton className="h-4 w-64 max-w-full" />
            <div className="flex gap-8">
              <Skeleton className="size-5" />
              <Skeleton className="size-5" />
            </div>
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <Skeleton className="h-9 w-28" />
        </div>
      </CardSkeleton>
    </LoadingPage>
  );
}
