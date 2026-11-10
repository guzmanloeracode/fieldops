import { jobs } from "@fieldops/core";
import { apiRoute } from "@/server/api/handler";
import { toNoteDto } from "@/server/api/serialize";

type Params = { id: string };

export const GET = apiRoute<Params>(async ({ params, ctx }) => {
  const notes = await jobs.listNotes(ctx, params.id);
  return { body: { data: notes.map(toNoteDto), next_cursor: null } };
});

export const POST = apiRoute<Params>(async ({ params, body, ctx }) => {
  const note = await jobs.addNote(ctx, params.id, body);
  return { status: 201, body: toNoteDto(note) };
});
