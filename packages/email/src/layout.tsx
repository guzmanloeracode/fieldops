import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

export function Layout({
  preview,
  title,
  children,
  footer,
  lang = "en",
}: {
  preview: string;
  title: string;
  children: ReactNode;
  footer?: string;
  /** Language of the email's text. */
  lang?: string;
}) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: "#f4f6fa",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          margin: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 520,
            margin: "32px auto",
            backgroundColor: "#ffffff",
            borderRadius: 12,
            padding: "32px 28px",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: 700, color: "#0369a1", margin: "0 0 16px" }}>
            FieldOps
          </Text>
          <Heading as="h1" style={{ fontSize: 22, color: "#0b1220", margin: "0 0 16px" }}>
            {title}
          </Heading>
          <Section>{children}</Section>
          <Hr style={{ borderColor: "#e3e8ef", margin: "28px 0 16px" }} />
          <Text style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
            {footer ??
              "You received this email because of an action on FieldOps. If it wasn't you, you can ignore it."}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const button = {
  backgroundColor: "#0369a1",
  color: "#ffffff",
  borderRadius: 8,
  padding: "12px 20px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-block",
} as const;

export const paragraph = { fontSize: 15, lineHeight: "24px", color: "#1e293b" } as const;
