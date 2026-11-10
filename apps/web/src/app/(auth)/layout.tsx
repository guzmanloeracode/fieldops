import Link from "next/link";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { Logo } from "@/components/app/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2 font-semibold">
        <Logo /> FieldOps
      </Link>
      <div className="w-full max-w-md">{children}</div>
      <LanguageSwitcher className="mt-6" />
    </div>
  );
}
