import { HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Portal invoices: title, then invoice cards. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-card space-y-2 rounded-xl border p-4">
            <div className="flex gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24 rounded-full" />
            </div>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
