import { render } from "@react-email/render";
import { createElement } from "react";
import { NotificationEmail, notificationCopy, type NotificationEmailProps } from "./notification";
import { Invitation, ResetPassword, VerifyEmail } from "./templates";

export { notificationCopy, type NotificationEmailEvent, type NotificationEmailProps } from "./notification";

export type EmailMessage =
  | { kind: "verify_email"; to: string; props: { name: string; url: string } }
  | { kind: "reset_password"; to: string; props: { name: string; url: string } }
  | {
      kind: "invitation";
      to: string;
      props: { inviterName: string; organizationName: string; role: string; url: string };
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
  switch (message.kind) {
    case "verify_email":
      subject = "Confirm your email for FieldOps";
      element = createElement(VerifyEmail, message.props);
      break;
    case "reset_password":
      subject = "Reset your FieldOps password";
      element = createElement(ResetPassword, message.props);
      break;
    case "invitation":
      subject = `${message.props.inviterName} invited you to ${message.props.organizationName} on FieldOps`;
      element = createElement(Invitation, message.props);
      break;
    case "notification":
      subject = notificationCopy(message.props).subject;
      element = createElement(NotificationEmail, message.props);
      break;
  }
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
