import { render } from "@react-email/render";
import { createElement } from "react";
import { Invitation, ResetPassword, VerifyEmail } from "./templates";
import { PortalSignIn } from "./portal";

export type EmailMessage =
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
    };

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
    case "portal.magic_link":
      subject = `Your sign-in link for ${message.props.organizationName}`;
      element = createElement(PortalSignIn, message.props);
      break;
  }
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}
