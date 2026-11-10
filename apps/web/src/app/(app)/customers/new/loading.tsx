import { FormSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";

/** New customer: the customer and the first contact, in a narrow column. */
export default function Loading() {
  return (
    <LoadingPage className="mx-auto max-w-3xl">
      <HeaderSkeleton eyebrow description={false} />
      <FormSkeleton fields={4} submit={false} />
      <FormSkeleton fields={4} />
    </LoadingPage>
  );
}
