import { NextResponse, type NextRequest } from "next/server";

// Only a fast presence check; the server validates the session on every call.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("ac_session")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/onboarding/:path*", "/dashboard/:path*", "/callback/:path*"],
};
