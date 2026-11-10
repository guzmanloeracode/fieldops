import { CardSkeleton, FiltersSkeleton, ListSkeleton, LoadingPage } from "@/components/app/skeletons";

/** Audit log: the filter row, then a list of entries. */
export default function Loading() {
  return (
    <LoadingPage>
      <FiltersSkeleton count={5} />
      <CardSkeleton>
        <ListSkeleton rows={8} />
      </CardSkeleton>
    </LoadingPage>
  );
}
