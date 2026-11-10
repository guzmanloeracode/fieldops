import {
  FiltersSkeleton,
  HeaderSkeleton,
  LoadingPage,
  TableSkeleton,
  TilesSkeleton,
} from "@/components/app/skeletons";

/** Invoices list: receivables, filters and the table. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action />
      <TilesSkeleton count={2} className="grid-cols-1 sm:grid-cols-2" />
      <FiltersSkeleton search count={3} />
      <TableSkeleton rows={10} columns={8} />
    </LoadingPage>
  );
}
