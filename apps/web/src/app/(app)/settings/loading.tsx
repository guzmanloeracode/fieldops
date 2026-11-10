import { LoadingPage, FormSkeleton } from "@/components/app/skeletons";

/** Settings tabs. The layout keeps the title and tabs on screen; this fills the tab's card. */
export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton fields={5} />
    </LoadingPage>
  );
}
