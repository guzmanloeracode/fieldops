import { FormSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";

/** New job: customer and site, the work, and the customer's preferred time, in a narrow column. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-3xl">
      <HeaderSkeleton />
      <FormSkeleton fields={3} submit={false} />
      <FormSkeleton fields={5} submit={false} />
      <FormSkeleton fields={2} />
    </LoadingPage>
  );
}
