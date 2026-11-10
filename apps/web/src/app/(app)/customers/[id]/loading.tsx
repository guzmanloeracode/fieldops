import {
  LoadingPage,
  HeaderSkeleton,
  TilesSkeleton,
  CardSkeleton,
  ListSkeleton,
} from "@/components/app/skeletons";

/** Customer detail: totals, sites and recent jobs on the left, contacts on the right. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton action eyebrow />
      <TilesSkeleton count={5} className="grid-cols-2 sm:grid-cols-5" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CardSkeleton>
            <ListSkeleton rows={3} />
          </CardSkeleton>
          <CardSkeleton>
            <ListSkeleton rows={5} />
          </CardSkeleton>
        </div>
        <CardSkeleton>
          <ListSkeleton rows={3} />
        </CardSkeleton>
      </div>
    </LoadingPage>
  );
}
