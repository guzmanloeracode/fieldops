import { HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Portal home: greeting and request button, then job cards. */
export default function Loading() {
  return (
    <LoadingPage className="space-y-8">
      <HeaderSkeleton action />
      {[3, 2].map((n, s) => (
        <div key={s} className="space-y-3">
          <Skeleton className="h-5 w-28" />
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="bg-card space-y-2 rounded-xl border p-4">
              <div className="flex gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ))}
    </LoadingPage>
  );
}
