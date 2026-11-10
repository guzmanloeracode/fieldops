import { CardSkeleton, FieldsSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Portal job: back link, number and status, title, then the visit, request and history cards. */
export default function Loading() {
  return (
    <LoadingPage>
      <Skeleton className="h-4 w-20" />
      <div className="space-y-2">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-80 max-w-full" />
      </div>
      <CardSkeleton>
        <FieldsSkeleton count={3} />
      </CardSkeleton>
      <CardSkeleton lines={3} />
      <CardSkeleton lines={4} />
    </LoadingPage>
  );
}
