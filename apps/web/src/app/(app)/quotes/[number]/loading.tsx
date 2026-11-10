import {
  CardSkeleton,
  HeaderSkeleton,
  ListSkeleton,
  LoadingPage,
  TableSkeleton,
} from "@/components/app/skeletons";

/** Quote detail: header with actions, details and the lines. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-5xl">
      <HeaderSkeleton action eyebrow />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardSkeleton>
            <TableSkeleton rows={4} columns={5} />
          </CardSkeleton>
        </div>
        <CardSkeleton>
          <ListSkeleton rows={4} />
        </CardSkeleton>
      </div>
    </LoadingPage>
  );
}
