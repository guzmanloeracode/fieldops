import { LoadingPage, HeaderSkeleton, FiltersSkeleton, TableSkeleton } from "@/components/app/skeletons";

/** Customers list: search, filters and the table. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <FiltersSkeleton search count={4} />
      <TableSkeleton rows={10} columns={5} />
    </LoadingPage>
  );
}
