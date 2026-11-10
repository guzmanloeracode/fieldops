"use client";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Nav } from "./nav";

export function MobileNav({
  role,
  header,
  counts,
  footer,
}: {
  role: string;
  header: ReactNode;
  counts?: Record<string, number>;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="bg-sidebar flex w-72 flex-col p-4">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="mb-6">{header}</div>
        <Nav role={role} counts={counts} onNavigate={() => setOpen(false)} />
        {footer ? <div className="mt-4">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
