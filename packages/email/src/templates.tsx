import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

export function VerifyEmail({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Confirm your email to start using FieldOps" title="Confirm your email">
      <Text style={paragraph}>Hi {name},</Text>
      <Text style={paragraph}>Confirm your email address to finish creating your FieldOps account.</Text>
      <Button href={url} style={button}>
        Confirm email
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        Or paste this link into your browser: <Link href={url}>{url}</Link>
      </Text>
    </Layout>
  );
}

export function ResetPassword({ name, url }: { name: string; url: string }) {
  return (
    <Layout preview="Reset your FieldOps password" title="Reset your password">
      <Text style={paragraph}>Hi {name},</Text>
      <Text style={paragraph}>
        Someone asked to reset the password for your FieldOps account. The link works for one hour.
      </Text>
      <Button href={url} style={button}>
        Choose a new password
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        If you didn't ask for this, you can ignore this email.
      </Text>
    </Layout>
  );
}

export function Invitation({
  inviterName,
  organizationName,
  role,
  url,
}: {
  inviterName: string;
  organizationName: string;
  role: string;
  url: string;
}) {
  return (
    <Layout
      preview={`${inviterName} invited you to ${organizationName} on FieldOps`}
      title={`Join ${organizationName}`}
    >
      <Text style={paragraph}>
        {inviterName} invited you to join <strong>{organizationName}</strong> on FieldOps as a{" "}
        <strong>{role}</strong>.
      </Text>
      <Button href={url} style={button}>
        Accept invitation
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>The invitation expires in 7 days.</Text>
    </Layout>
  );
}
