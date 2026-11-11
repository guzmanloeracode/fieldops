# ADR 024: A stateless MCP server over the assistant's read-only tools

**Status:** accepted · 2026-11-11 · implemented in 0.5

**Context.** Owners want to ask their own AI client (Claude, or any MCP client) about FieldOps data (PLT-05,
AI-05). _Ask FieldOps_ already has seven read-only tools with role filtering, row caps and short transactions
(ADR 019). The MCP server must not become a second, weaker way to read the data, must fit the Next.js app
without long-lived processes, and must work behind nginx and Cloudflare like the rest of the API.

**Decision.**

- **Transport.** Streamable HTTP at `/api/mcp`, stateless: no session ids, each `POST` answered on its own with
  plain JSON (the official `@modelcontextprotocol/sdk`, its web-standard transport, a new server and transport per
  request). `GET` and `DELETE` answer `405`, since there is no server-initiated stream and no session to end. This
  survives restarts and any number of web replicas with nothing shared.
- **Authentication.** An API key with the `read` scope (ADR 023) as a bearer token; session cookies and tokens
  are refused with `401`. Requests count against the key's rate limit and carry the RateLimit headers. OAuth
  discovery for MCP isn't offered yet: clients add the header themselves (`claude mcp add --transport http …
--header "Authorization: Bearer fo_…"`).
- **Tools.** The assistant's tools, unchanged: the same descriptions, the same per-role offering (revenue only
  for owners and admins, pending approvals only for approvers) and the same execution, each call in its own short
  tenant transaction as the key's member, results capped at 50 rows. The strict inputs the assistant sends to
  Claude (every field present, `null` when unused) are relaxed for MCP clients: a field that accepts `null` may be
  left out and is filled with `null` before the real schema validates the call. Results are the tool's data as
  JSON text; domain errors (a job that doesn't exist) and invalid input come back as `isError` results. Every tool
  is annotated read-only, idempotent and closed-world.
- **No AI of ours.** The client's model does the reasoning, so MCP calls spend no AI quota and work while AI is
  turned off for the organization. Record contents reach the client as data; the server's instructions say so.

**Consequences.** One implementation of the read tools serves the panel and every MCP client, so a fix or a new
filter reaches both. A new server per request costs a few milliseconds, which is negligible next to the database
work. Write tools, resources, prompts and OAuth-based client registration are possible later without changing
the transport.
