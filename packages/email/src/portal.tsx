import { Button, Link, Text } from "@react-email/components";
import { Layout, button, paragraph } from "./layout";

/** One-time sign-in link to a business's customer portal (POR-01). */
export function PortalSignIn({
  name,
  organizationName,
  url,
  minutes,
}: {
  name: string;
  organizationName: string;
  url: string;
  minutes: number;
}) {
  return (
    <Layout
      preview={`Your sign-in link for ${organizationName}`}
      title={`Sign in to ${organizationName}`}
      footer={`You asked to sign in to the ${organizationName} customer portal. If it wasn't you, you can ignore this email.`}
    >
      <Text style={paragraph}>Hi {name},</Text>
      <Text style={paragraph}>
        Use this link to request service and follow your jobs with {organizationName}. It works once, for{" "}
        {minutes} minutes.
      </Text>
      <Button href={url} style={button}>
        Open the customer portal
      </Button>
      <Text style={{ ...paragraph, fontSize: 13, color: "#64748b" }}>
        Or paste this link into your browser: <Link href={url}>{url}</Link>
      </Text>
    </Layout>
  );
}
