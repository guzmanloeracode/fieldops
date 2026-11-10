import { z } from "zod";
import { optionalText, trimmed } from "./fields";

// Customer portal (POR-01–03). Customers sign in with a one-time link, request service and follow their jobs.

/** Sign-in links expire after 15 minutes and work once; sessions last 30 days. */
export const PORTAL_LINK_TTL_MIN = 15;
export const PORTAL_SESSION_TTL_DAYS = 30;
/** At most this many photos per request, images only (POR-02). */
export const PORTAL_MAX_PHOTOS = 3;
export const PORTAL_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PORTAL_MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Preferred visit windows a customer can pick, in the organization's time zone. */
export const PORTAL_TIME_SLOTS = ["morning", "afternoon", "anytime"] as const;
export type PortalTimeSlot = (typeof PORTAL_TIME_SLOTS)[number];
/** Local start and end of each slot, in minutes after midnight. */
export const PORTAL_SLOT_MINUTES: Record<PortalTimeSlot, { start: number; end: number }> = {
  morning: { start: 8 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  anytime: { start: 8 * 60, end: 17 * 60 },
};
/** How far ahead a customer can ask for a visit. */
export const PORTAL_MAX_DAYS_AHEAD = 60;

export const portalLinkRequestSchema = z.object({
  email: z.email("Enter a valid email").max(254),
});

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const portalWindowSchema = z.object({
  date: localDate,
  slot: z.enum(PORTAL_TIME_SLOTS),
});
export type PortalWindowInput = z.infer<typeof portalWindowSchema>;

export const portalNewSiteSchema = z.object({
  line1: trimmed(200).min(1, "Enter the street address"),
  line2: optionalText(200),
  city: trimmed(120).min(1, "Enter the city"),
  postal_code: optionalText(20),
  access_notes: optionalText(500),
});

/**
 * A service request from the portal (POR-02). Either an existing site of the customer or a new address.
 * Photos are uploaded first through portal-scoped signed URLs and referenced here by their upload tokens.
 */
export const portalRequestSchema = z
  .object({
    description: trimmed(4000).min(10, "Tell us a little more (at least 10 characters)"),
    site_id: z.uuid().nullable().optional(),
    new_site: portalNewSiteSchema.nullable().optional(),
    windows: z
      .array(portalWindowSchema)
      .min(1, "Pick at least one time that suits you")
      .max(3, "Pick up to three times"),
  })
  .refine((v) => Boolean(v.site_id) !== Boolean(v.new_site), {
    path: ["site_id"],
    message: "Choose one of your addresses or enter a new one",
  });
export type PortalRequestInput = z.input<typeof portalRequestSchema>;

export const portalPhotoUploadSchema = z.object({
  file_name: trimmed(200).min(1),
  mime_type: z.enum(PORTAL_PHOTO_TYPES, { message: "Photos must be JPEG, PNG or WebP" }),
  size_bytes: z.number().int().positive().max(PORTAL_MAX_PHOTO_BYTES, "Photos can be up to 5 MB"),
  with_thumbnail: z.boolean().default(false),
});
export type PortalPhotoUploadInput = z.input<typeof portalPhotoUploadSchema>;
