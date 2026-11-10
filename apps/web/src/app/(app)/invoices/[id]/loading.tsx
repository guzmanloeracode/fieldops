import {
  CardSkeleton,
  HeaderSkeleton,
  ListSkeleton,
  LoadingPage,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Invoice detail: header with actions, lines and totals, details and payments. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-5xl">
      <HeaderSkeleton action eyebrow />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardSkeleton>
            <TableSkeleton rows={5} columns={5} />
          </CardSkeleton>
        </div>
        <CardSkeleton>
          <ListSkeleton rows={4} />
        </CardSkeleton>
      </div>
    </LoadingPage>
  );
}
