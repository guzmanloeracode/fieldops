import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/i18n/path-header";

// Fast redirect for signed-out visitors. Real authorization happens on the server for every page,
// action and API call; this only checks that a session cookie exists.
const APP_PREFIXES = [
  "/dashboard",
  "/jobs",
  "/schedule",
  "/approvals",
  "/customers",
  "/equipment",
  "/settings",
  "/notifications",
  "/onboarding",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Next.js's own requests (such as the dev server's HMR websocket) pass untouched.
  if (pathname.startsWith("/_next/")) return NextResponse.next();
  // The request config picks the language by the part of the site (the customer portal has its own rules).
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  };
  if (!APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return next();
  if (getSessionCookie(request, { cookiePrefix: "fieldops" })) return next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
