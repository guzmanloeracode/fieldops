import { apiRoute } from "@/server/api/handler";

/** The signed-in user, their active organization and role. */
export const GET = apiRoute(async ({ actor }) => ({
  body: {
    user: { id: actor.userId, name: actor.name, email: actor.email },
    organization: {
      id: actor.organization.id,
      name: actor.organization.name,
      slug: actor.organization.slug,
      timezone: actor.organization.timezone,
      currency: actor.organization.currency,
    },
    role: actor.role,
  },
}));
