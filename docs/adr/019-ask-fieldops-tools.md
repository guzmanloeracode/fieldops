# ADR 019: Ask FieldOps answers through read-only tools bound to the session

**Status:** accepted · 2026-11-10 · implemented in 0.4

**Context.** _Ask FieldOps_ (AI-02) answers any staff member's questions about the organization's own data in a
side panel, streaming the answer as the model writes it. The model must never see data the user couldn't see in
the app, never change anything, and never follow instructions planted in records: job descriptions, notes and
portal requests are typed by customers and staff. One answer can take several lookups and up to a minute of model
time, and holding a database transaction (with its row-level security context) open that long would tie up a
pooled connection per question.

**Decision.**

- Seven read-only tools in `packages/core/src/services/assistant-tools.ts`, written against the same repositories
  and access checks as the app. There is no SQL from the model and no write tool. The organization and role come
  from the session when the tools are bound; the model only supplies filter arguments, validated with Zod and
  sent to the API as strict schemas.
- Tools are offered by role: revenue only with `dashboard.financial`, pending approvals only to members who can
  approve. Tools a role can't use aren't sent to the model at all. Inside the tools, results are filtered by role:
  technicians only reach their assigned jobs, those jobs' customers and their own schedule.
- Each tool call opens its own short tenant transaction (row-level security on) and closes it before returning.
  The question is saved in one transaction before the stream opens and the answer in another after it ends.
  Nothing stays open while the model writes.
- Caps: 50 rows per result, with the total still reported so counts stay right; text fields clipped to 400
  characters; 8 tool calls per question, after which a tool answers with an error asking the model to answer with
  what it has; and at most 10 model requests per question.
- Results go back to the model as JSON inside `<tool_result name="…">` with `<` and `>` escaped (`\u003c`,
  `\u003e`), so text from a record can't close the element or open another. The system prompt says everything
  inside is data and only the user's messages are instructions. Names in the context block lose their angle
  brackets. The panel renders the answer as a Markdown subset of plain text nodes, and links come only from the
  records the tools returned, never from the model.
- `POST /api/v1/ai/assistant` answers with `text/event-stream`: server-sent events over POST, read in the browser
  with `fetch` and a stream reader, since `EventSource` only sends GET. Permission, quota, rate-limit and
  validation failures are ordinary problem responses before the stream starts; a refusal or failure after that is
  an `error` event. Stopping an answer or dropping the connection aborts the model call. `X-Accel-Buffering: no`
  and `Cache-Control: no-transform` keep proxies from buffering the stream.
- `AI_PROVIDER=fixture` replaces Claude with a deterministic model that picks tools from keywords in the question
  and runs the real bound tools. The E2E suite uses it to test role filtering, the data wrapper, streaming and
  saved conversations without an API key or network. Answer quality is measured separately by the 25-question
  evaluation set, run on demand against the real model.

**Consequences.** The assistant can only say what the app would show the same person; an instruction planted in a
record can at worst change the wording of an answer, not its scope or any data. Many short transactions cost a
little more than one long one but never hold a connection during a model call. Some answers are partial because of
the row cap; the tools return totals and the prompt tells the model to say so. For questions the seven tools can't
answer, the model says so and points to the right page instead of guessing; each new kind of question needs a new
tool. The fixture proves the plumbing, not the quality of answers; the evaluation set hasn't been run against
Claude yet.
