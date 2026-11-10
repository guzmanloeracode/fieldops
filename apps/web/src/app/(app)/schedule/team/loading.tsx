import { LoadingPage, HeaderSkeleton, CardSkeleton } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Team availability: one card per technician with working hours, skills and time off. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i} description>
            {[0, 1, 2, 3, 4].map((d) => (
              <div key={d} className="grid grid-cols-[8rem_1fr_1fr] items-center gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </CardSkeleton>
        ))}
      </div>
    </LoadingPage>
  );
}
