import { FormSkeleton, HeaderSkeleton, LoadingPage } from "@/components/app/skeletons";

/** Request form: heading, then the description, address, times and photos in one card. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <FormSkeleton fields={5} />
    </LoadingPage>
  );
}
