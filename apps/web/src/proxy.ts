import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

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
  if (!APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (getSessionCookie(request, { cookiePrefix: "fieldops" })) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
