import { LoadingPage, FormSkeleton } from "@/components/app/skeletons";

/** Invitation: the organization and role, and the accept form. */
export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton fields={3} />
    </LoadingPage>
  );
}
