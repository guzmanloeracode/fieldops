import { LoadingPage, HeaderSkeleton, FiltersSkeleton, TableSkeleton } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Jobs list: saved views, filters, table tools and the table. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <div className="space-y-3">
        <Skeleton className="h-9 w-24" />
        <FiltersSkeleton search count={4} />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        <TableSkeleton rows={10} columns={7} />
      </div>
    </LoadingPage>
  );
}
