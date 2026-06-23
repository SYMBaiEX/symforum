import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextResponse } from "next/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export default convexConfigured
  ? convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
      if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
        return nextjsMiddlewareRedirect(request, "/");
      }
    })
  : function middleware() {
      return NextResponse.next();
    };

export const config = {
  // The following matcher runs middleware on all routes
  // except static assets.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
