import {
  LoadingPage,
  HeaderSkeleton,
  FiltersSkeleton,
  TilesSkeleton,
  CardSkeleton,
} from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Home: greeting, tabs, filters, KPI tiles and charts (the overview, the largest of the three homes). */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <div className="flex gap-6 border-b pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-14" />
      </div>
      <FiltersSkeleton count={3} />
      <TilesSkeleton count={6} tall className="sm:grid-cols-2 xl:grid-cols-3" />
      <div className="grid gap-6 xl:grid-cols-2">
        <CardSkeleton description>
          <Skeleton className="h-64 w-full" />
        </CardSkeleton>
        <CardSkeleton description>
          <Skeleton className="h-64 w-full" />
        </CardSkeleton>
      </div>
    </LoadingPage>
  );
}
