import { render } from "@react-email/render";
import { createElement } from "react";
import { NotificationEmail, notificationCopy, type NotificationEmailProps } from "./notification";
import { emailLocale, type EmailLocale } from "./i18n";
import {
  Invitation,
  invitationSubject,
  ResetPassword,
  resetPasswordSubject,
  VerifyEmail,
  verifyEmailSubject,
} from "./templates";
import { PortalSignIn, portalSignInSubject } from "./portal";
import { BillingEmail, billingCopy, type BillingEmailProps } from "./billing";
import { DailyDigestEmail, digestSubject, type DailyDigestProps } from "./digest";
import { JobCompletedEmail, jobCompletedSubject, type JobCompletedEmailProps } from "./report";

export { notificationCopy, type NotificationEmailEvent, type NotificationEmailProps } from "./notification";
export { EMAIL_LOCALES, emailLocale, type EmailLocale } from "./i18n";
export { billingCopy, type BillingEmailProps } from "./billing";
export { digestDay, digestSubject, type DailyDigestProps } from "./digest";
export { formatEmailDate, type JobCompletedEmailProps } from "./report";

/** What to send, and the recipient's language (SET-05; English when left out). */
export type EmailMessage = { locale?: EmailLocale | string | null } & EmailBody;

type EmailBody =
  | { kind: "verify_email"; to: string; props: { name: string; url: string } }
  | { kind: "reset_password"; to: string; props: { name: string; url: string } }
  | {
      kind: "invitation";
      to: string;
      props: { inviterName: string; organizationName: string; role: string; url: string };
    }
  | {
      kind: "portal.magic_link";
      to: string;
      props: { name: string; organizationName: string; url: string; minutes: number };
    }
  | { kind: "notification"; to: string; props: NotificationEmailProps }
  | { kind: "daily_digest"; to: string; props: DailyDigestProps }
  | { kind: "report.job_completed"; to: string; props: JobCompletedEmailProps }
  /** Quotes, invoices, receipts and reminders to a customer's contact (0.4). */
  | { kind: "billing"; to: string; props: BillingEmailProps };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderEmail(message: EmailMessage): Promise<RenderedEmail> {
  let subject: string;
  let element;
  const locale = emailLocale(message.locale);
  switch (message.kind) {
    case "verify_email":
      subject = verifyEmailSubject(locale);
      element = createElement(VerifyEmail, { ...message.props, locale });
      break;
    case "reset_password":
      subject = resetPasswordSubject(locale);
      element = createElement(ResetPassword, { ...message.props, locale });
      break;
    case "invitation":
      subject = invitationSubject(message.props, locale);
      element = createElement(Invitation, { ...message.props, locale });
      break;
    case "portal.magic_link":
      subject = portalSignInSubject(message.props.organizationName, locale);
      element = createElement(PortalSignIn, { ...message.props, locale });
      break;
    case "notification":
      subject = notificationCopy({ ...message.props, locale }).subject;
      element = createElement(NotificationEmail, { ...message.props, locale });
      break;
    case "daily_digest":
      subject = digestSubject({ ...message.props, locale });
      element = createElement(DailyDigestEmail, { ...message.props, locale });
      break;
    case "report.job_completed":
      subject = jobCompletedSubject(message.props);
      element = createElement(JobCompletedEmail, message.props);
      break;
    case "billing":
      subject = billingCopy(message.props).subject;
      element = createElement(BillingEmail, message.props);
      break;
  }
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
