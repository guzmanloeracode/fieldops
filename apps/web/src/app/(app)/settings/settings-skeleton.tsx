import { LoadingPage, FormSkeleton } from "@/components/app/skeletons";

/**
 * A settings tab while it loads. The layout keeps the title and tabs on screen; this fills the tab's card. Each tab has
 * its own loading.tsx so a tab's guard (the demo outbox) still runs before any skeleton streams.
 */
export function SettingsSkeleton() {
  return (
    <LoadingPage>
      <FormSkeleton fields={5} />
    </LoadingPage>
  );
}
