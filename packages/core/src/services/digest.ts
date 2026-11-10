import { DIGEST_LOCAL_HOUR } from "@fieldops/shared";
import { localDateOf, localMinutesOf, shiftDate } from "../domain/availability";
import type { DigestMailer } from "./recurrence-types";
import type { Store } from "./types";

// The owner's daily digest (NOT-04): yesterday's figures, overdue jobs and pending approvals, by email at 07:00
// in the organization's time zone. Email only; owners get it unless they turn it off, admins when they turn it
// on (notification settings).

/** Overdue jobs listed by name in the email; the rest are counted. */
export const DIGEST_OVERDUE_LIMIT = 10;

/**
 * Sends the digest of one organization if its local time is in the 07:00 hour. Runs hourly; each recipient gets
 * one digest per local date, recorded in the same transaction as the email, so a retried or doubled run sends
 * nothing twice. Returns the number of digests sent.
 */
export async function sendDailyDigests(deps: {
  store: Store;
  mailer?: DigestMailer;
  now: Date;
}): Promise<number> {
  const { store, mailer, now } = deps;
  if (!mailer) return 0;
  const org = await store.organization.get();
  if (Math.floor(localMinutesOf(now, org.timezone) / 60) !== DIGEST_LOCAL_HOUR) return 0;
  const date = localDateOf(now, org.timezone);
  const recipients = await store.digest.recipients(date);
  if (recipients.length === 0) return 0;
  const summary = await store.digest.summary(shiftDate(date, -1), DIGEST_OVERDUE_LIMIT);
  let sent = 0;
  for (const recipient of recipients) {
    if (!(await store.digest.record(recipient.userId, date, now))) continue;
    await mailer.send({ recipient, summary, date });
    sent += 1;
  }
  return sent;
}
