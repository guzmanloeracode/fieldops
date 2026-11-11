import { CardSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Portal invoice: back link, number and status, dates, then the balance, lines and payments cards. */
export default function Loading() {
  return (
    <LoadingPage>
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-56" />
      </div>
      <CardSkeleton lines={2} />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={1} />
    </LoadingPage>
  );
}
