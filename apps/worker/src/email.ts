import type { Pool } from "pg";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "./env";
import { log } from "./log";

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  html: string;
  text: string;
  attempts: number;
}

type Sender = (m: OutboxRow) => Promise<void>;

function createSender(): Sender | null {
  if (env.resendApiKey) {
    const resend = new Resend(env.resendApiKey);
    return async (m) => {
      const { error } = await resend.emails.send({ from: env.emailFrom, to: m.to_email, subject: m.subject, html: m.html, text: m.text });
      if (error) throw new Error(error.message);
    };
  }
  if (env.smtpUrl) {
    const transport = nodemailer.createTransport(env.smtpUrl);
    return async (m) => {
      await transport.sendMail({ from: env.emailFrom, to: m.to_email, subject: m.subject, html: m.html, text: m.text });
    };
  }
  return null;
}

const MAX_ATTEMPTS = 5;

/**
 * Sends queued emails from the outbox. Rows are claimed with FOR UPDATE SKIP LOCKED, so several workers
 * can run without sending a message twice. Failed sends retry with backoff up to 5 attempts.
 */
export async function drainOutbox(pool: Pool): Promise<number> {
  const send = createSender();
  const { rows } = await pool.query<OutboxRow>(`
    update email_outbox set status = 'sending', attempts = attempts + 1
    where id in (
      select id from email_outbox
      where (status = 'queued' or (status = 'failed' and attempts < ${MAX_ATTEMPTS}
             and created_at > now() - interval '1 day'
             and coalesce(sent_at, created_at) < now() - (attempts * interval '1 minute')))
      order by created_at
      limit 20
      for update skip locked
    )
    returning id, to_email, subject, html, text, attempts`);
  for (const m of rows) {
    if (!send) {
      await pool.query(`update email_outbox set status = 'failed', error = $2 where id = $1`, [m.id, "No email provider configured"]);
      continue;
    }
    try {
      await send(m);
      await pool.query(`update email_outbox set status = 'sent', sent_at = now(), error = null where id = $1`, [m.id]);
    } catch (err) {
      log.warn({ err, id: m.id, attempt: m.attempts }, "email send failed");
      await pool.query(`update email_outbox set status = 'failed', error = $2, sent_at = now() where id = $1`, [m.id, String((err as Error).message).slice(0, 500)]);
    }
  }
  return rows.length;
}

/** Recovers rows left in "sending" by a crashed worker. */
export async function releaseStuck(pool: Pool) {
  await pool.query(`update email_outbox set status = 'queued' where status = 'sending' and created_at < now() - interval '10 minutes'`);
}
