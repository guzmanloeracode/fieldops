# ADR 020: English and Bahasa Indonesia, with an English API

**Status:** accepted · 2026-11-10 · implemented in 0.4

**Context.** SET-05 asks for English and Bahasa Indonesia, chosen per user. The demo's second company works in
Jakarta, and its staff and customers read Indonesian, while the same deployment serves English-speaking businesses.
Strings have lived in message files since 0.1, but every page, email and PDF needs a language, and the people
involved differ: a signed-in member, a shared demo account used by many visitors, a customer in the portal, someone
not signed in, the recipient of an email. Some outputs are read by programs, not people: the REST API, CSV exports.
A translation that lags behind a new English string must never show a raw key.

**Decision.**

- next-intl in the web app, with one message file per namespace and language (`apps/web/messages/<locale>/`).
  Indonesian is merged over English key by key when the server starts, so a key missing in Indonesian shows the
  English text, and keys English doesn't have are dropped. A unit test keeps both languages' keys and ICU arguments
  in step; `messages/GLOSSARY.md` fixes the terms ("job" is _pekerjaan_) and the voice (_Anda_).
- The request's language (`src/server/locale.ts`):
  - **App:** the signed-in user's `user.locale`, changed in the user menu and saved on the account. Shared demo
    accounts never save it: a visitor's choice lives in a cookie in their browser, and without one the demo
    account's own language applies.
  - **Customer portal:** the cookie, else the signed-in contact's customer `locale`, else the organization's
    customer language (`settings.locale`).
  - **Signed-out pages:** the cookie, else `Accept-Language`, else English. A new account starts in that language.
- `<html lang>` and page titles follow the request's language. Dates are formatted in the organization's time
  zone by `src/lib/format.ts`, in the reader's language: Indonesian is day-first with a 24-hour clock written
  `14.30`. Numbers and money use `Intl` with the reader's locale.
- Emails are rendered in the recipient's language: a staff member's own, a customer's or else their
  organization's. Invitations use the inviter's, since the invitee has no account yet. `packages/email` keeps a dictionary per template
  instead of using next-intl, so the web app and the worker render emails the same way, outside any page request.
  PDFs take the customer's language (a service report, its own).
- What stays English: the REST API, including the domain errors in its problem details, and CSV exports (column
  names and values). Both are read by programs, and a language that changed with the caller would break their
  scripts. Server actions, which people read, translate domain errors by their English text
  (`src/i18n/server-messages.ts`); a message without an entry stays English.
- Zod's messages for form checks are set in the browser only. Its configuration is global, and on the server
  requests in both languages share one process.

**Consequences.** A partly translated release still reads well: the untranslated keys show in English, never as
keys. API clients and exports get stable English text whatever the caller's language, at the cost of an Indonesian
user seeing English in a downloaded CSV. Every new domain error needs an entry in the server message list to be
translated in forms, and every new email needs copy in both dictionaries; tests check that each notification event
has Indonesian copy. A user's language can only be changed in the app for now; there is no API for it. A third
language means a new message folder, email dictionaries, date patterns and a value in `LOCALES`.
