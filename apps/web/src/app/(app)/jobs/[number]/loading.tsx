import { LoadingPage, CardSkeleton, FieldsSkeleton } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Job detail: number and badges, title, actions; details and checklist on the left, schedule and site on the right. */
export default function Loading() {
  return (
    <LoadingPage>
      <div className="space-y-3">
        <Skeleton className="h-4 w-16" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-14" />
            </div>
            <Skeleton className="h-8 w-80 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="size-9" />
          </div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CardSkeleton>
            <Skeleton className="h-4 w-1/3" />
            <FieldsSkeleton count={6} className="pt-2" />
          </CardSkeleton>
          <CardSkeleton lines={5} />
        </div>
        <div className="space-y-6">
          <CardSkeleton lines={2} />
          <CardSkeleton>
            <Skeleton className="h-44 w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardSkeleton>
        </div>
      </div>
    </LoadingPage>
  );
}
