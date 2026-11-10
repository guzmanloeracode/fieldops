import "server-only";
import { schema } from "@fieldops/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { bearer, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/env";
import { db } from "./db";
import { queueEmail } from "./mailer";

// Better Auth handles credentials, sessions, organizations and invitations. Business permissions are
// decided by @fieldops/core; these roles only gate Better Auth's own organization endpoints.
const ac = createAccessControl(defaultStatements);
const roles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  admin: ac.newRole({ organization: ["update"], member: ["create", "update", "delete"], invitation: ["create", "cancel"] }),
  dispatcher: ac.newRole({}),
  technician: ac.newRole({}),
};

/** Paths a demo account may not use: credentials and account deletion stay fixed until the nightly reset. */
const DEMO_BLOCKED_PATHS = ["/change-password", "/change-email", "/delete-user", "/organization/delete", "/organization/leave"];

async function isDemoUser(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const [u] = await db.select({ isDemo: schema.user.isDemo }).from(schema.user).where(eq(schema.user.id, userId));
  return Boolean(u?.isDemo);
}

export const auth = betterAuth({
  appName: "FieldOps",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      organization: schema.organization,
      member: schema.member,
      invitation: schema.invitation,
    },
  }),
  advanced: {
    cookiePrefix: "fieldops",
    database: { generateId: () => uuidv7() },
    ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
  },
  user: {
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "en", input: false },
      isDemo: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      await queueEmail({ kind: "reset_password", to: user.email, props: { name: user.name, url } });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      await queueEmail({ kind: "verify_email", to: user.email, props: { name: user.name, url } });
    },
  },
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 10 },
      "/request-password-reset": { window: 3600, max: 5 },
      "/send-verification-email": { window: 3600, max: 5 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!env.DEMO_MODE || !DEMO_BLOCKED_PATHS.some((p) => ctx.path.startsWith(p))) return;
      const session = ctx.context.session ?? null;
      if (await isDemoUser(session?.user.id)) {
        throw new APIError("FORBIDDEN", { message: "This action is disabled for demo accounts" });
      }
    }),
  },
  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      allowUserToCreateOrganization: true,
      invitationExpiresIn: 60 * 60 * 24 * 7,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      disableOrganizationDeletion: env.DEMO_MODE,
      schema: {
        organization: {
          additionalFields: {
            timezone: { type: "string", required: false, defaultValue: "UTC" },
            currency: { type: "string", required: false, defaultValue: "USD" },
            country: { type: "string", required: false, defaultValue: "US" },
            isDemo: { type: "boolean", required: false, defaultValue: false, input: false },
          },
        },
      },
      sendInvitationEmail: async (data) => {
        await queueEmail(
          {
            kind: "invitation",
            to: data.email,
            props: {
              inviterName: data.inviter.user.name,
              organizationName: data.organization.name,
              role: data.role,
              url: `${env.APP_URL}/invite/${data.id}`,
            },
          },
          data.organization.id,
        );
      },
    }),
    bearer(),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
