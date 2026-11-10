import { FiltersSkeleton, HeaderSkeleton, LoadingPage, TableSkeleton } from "@/components/app/skeletons";

/** Quotes list: filters and the table. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <FiltersSkeleton search count={3} />
      <TableSkeleton rows={10} columns={7} />
    </LoadingPage>
  );
}
