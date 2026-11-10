import { problemResponse } from "@/server/api/handler";
import { problemType } from "@/server/api/problem";

/** Unknown /api/v1 paths answer with a problem document instead of the HTML 404 page. */
function notFound(req: Request) {
  const path = new URL(req.url).pathname;
  return problemResponse(
    {
      type: problemType("not_found"),
      title: "Not found",
      status: 404,
      detail: `No API route matches ${path}`,
      instance: path,
    },
    crypto.randomUUID(),
  );
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
