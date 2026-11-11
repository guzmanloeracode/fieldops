"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** "Pay (test)": a plain form post, disabled once sent so it goes once. */
export function PayForm({
  action,
  label,
  pendingLabel,
}: {
  action: string;
  label: string;
  pendingLabel: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form method="post" action={action} onSubmit={() => setPending(true)}>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="test-checkout-pay">
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {pending ? pendingLabel : label}
      </Button>
    </form>
  );
}
