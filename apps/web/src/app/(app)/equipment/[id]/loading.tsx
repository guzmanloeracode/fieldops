import {
  LoadingPage,
  HeaderSkeleton,
  CardSkeleton,
  FieldsSkeleton,
  ListSkeleton,
} from "@/components/app/skeletons";

/** Equipment detail: the unit's fields, then its service history. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton eyebrow action />
      <div className="grid gap-6 lg:grid-cols-3">
        <CardSkeleton>
          <FieldsSkeleton count={8} className="grid-cols-2 sm:grid-cols-2" />
        </CardSkeleton>
        <CardSkeleton className="lg:col-span-2" description>
          <ListSkeleton rows={6} />
        </CardSkeleton>
      </div>
    </LoadingPage>
  );
}
