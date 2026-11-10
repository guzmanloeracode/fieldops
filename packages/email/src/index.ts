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

export { notificationCopy, type NotificationEmailEvent, type NotificationEmailProps } from "./notification";
export { EMAIL_LOCALES, emailLocale, type EmailLocale } from "./i18n";

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
  | { kind: "notification"; to: string; props: NotificationEmailProps };

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
  }
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
