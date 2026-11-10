import { LoadingPage } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Test checkout: the badge, title and notice, the amount, then the two buttons. */
export default function Loading() {
  return (
    <div className="bg-muted/40 min-h-dvh px-4 py-10">
      <div className="bg-card mx-auto max-w-md rounded-xl border p-6">
        <LoadingPage>
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
        </LoadingPage>
      </div>
    </div>
  );
}
