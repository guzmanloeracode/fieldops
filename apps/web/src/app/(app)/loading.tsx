import { LoadingPage, HeaderSkeleton, CardSkeleton } from "@/components/app/skeletons";

/** Fallback for app pages without a loading state of their own. */
export default function Loading() {
  return (
    <LoadingPage>
      <HeaderSkeleton />
      <CardSkeleton description lines={5} />
    </LoadingPage>
  );
}
