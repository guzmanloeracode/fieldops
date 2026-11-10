import { CardSkeleton, FormSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";

/** New quote: details and the line editor. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-4xl">
      <HeaderSkeleton />
      <CardSkeleton>
        <FormSkeleton fields={6} submit={false} />
      </CardSkeleton>
      <CardSkeleton>
        <FormSkeleton fields={3} />
      </CardSkeleton>
    </LoadingPage>
  );
}
