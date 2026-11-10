import { CardSkeleton, FormSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";

/** New invoice: bill-to and the line editor. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-4xl">
      <HeaderSkeleton />
      <CardSkeleton>
        <FormSkeleton fields={4} submit={false} />
      </CardSkeleton>
      <CardSkeleton>
        <FormSkeleton fields={4} />
      </CardSkeleton>
    </LoadingPage>
  );
}
