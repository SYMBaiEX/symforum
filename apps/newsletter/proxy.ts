import rootProxy from "../../proxy";

export default rootProxy;

export const config = {
  matcher: [
    "/((?!.*\\..*|_next).*)",
    "/(.*)\\.md",
    "/",
    "/(api|trpc)(.*)",
    "/llms.txt",
    "/llms-full.txt",
    "/feed/:path*",
  ],
};
