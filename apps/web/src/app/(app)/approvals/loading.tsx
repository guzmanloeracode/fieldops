import { LoadingPage, HeaderSkeleton, FiltersSkeleton } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Approvals inbox: filters and the list of requests with their decision buttons. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <FiltersSkeleton count={6} />
      <div className="bg-card divide-y rounded-xl border">
        <div className="px-4 py-3">
          <Skeleton className="h-4 w-24" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-64 max-w-full" />
              <Skeleton className="h-4 w-72 max-w-full" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-20" />
            </div>
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
