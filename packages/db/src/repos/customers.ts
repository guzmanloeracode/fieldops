import type {
  CustomerListFilters,
  CustomerListRow,
  CustomerRecord,
  CustomerRepo,
  Page,
} from "@fieldops/core";
import { decodeCursor, encodeCursor } from "@fieldops/core";
import type { Address, CustomerType, Locale } from "@fieldops/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { contact, customer, job, jobAssignment, site } from "../schema";
import { definedOnly, likeEscape } from "./util";

type CustomerRow = typeof customer.$inferSelect;

export function toCustomer(r: CustomerRow): CustomerRecord {
  return {
    id: r.id,
    type: r.type as CustomerType,
    name: r.name,
    billingAddress: (r.billingAddress as Address | null) ?? null,
    tags: r.tags,
    notes: r.notes,
    locale: (r.locale as Locale | null) ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Customers linked to a member through at least one assigned job (technician scoping). */
function linkedToMember(orgId: string, memberId: string): SQL {
  return sql`exists (
    select 1 from ${job} j join ${jobAssignment} ja on ja.job_id = j.id and ja.organization_id = j.organization_id
    where j.organization_id = ${orgId} and j.customer_id = "customer"."id" and j.deleted_at is null and ja.member_id = ${memberId}
  )`;
}

export function customerRepo(tx: Tx, orgId: string): CustomerRepo {
  const scope = and(eq(customer.organizationId, orgId), isNull(customer.deletedAt));

  return {
    async list(f: CustomerListFilters): Promise<Page<CustomerListRow>> {
      const where: (SQL | undefined)[] = [scope];
      if (f.q) {
        const q = `%${likeEscape(f.q)}%`;
        // Phone numbers are matched on digits only, and only when the search contains at least 3 digits.
        const digits = f.q.replace(/\D/g, "");
        const phoneMatch = digits.length >= 3 ? sql` or c.phone_norm like ${`%${digits}%`}` : sql``;
        where.push(
          or(
            ilike(customer.name, q),
            sql`exists (select 1 from ${contact} c where c.organization_id = ${orgId} and c.customer_id = "customer"."id"
              and (c.email_norm ilike ${q} or c.name ilike ${q}${phoneMatch}))`,
          ),
        );
      }
      if (f.type) where.push(eq(customer.type, f.type));
      if (f.tag) where.push(sql`${f.tag} = any(${customer.tags})`);
      if (f.assignedMemberId) where.push(linkedToMember(orgId, f.assignedMemberId));

      const descending = f.sort.startsWith("-");
      const field = f.sort.replace("-", "") as "name" | "created_at";
      const col = field === "name" ? customer.name : customer.createdAt;
      const order = descending ? [desc(col), desc(customer.id)] : [asc(col), asc(customer.id)];

      if (f.cursor && !f.page) {
        const c = decodeCursor(f.cursor, f.sort);
        const [v, id] = c.v as [string, string];
        const value = field === "name" ? v : new Date(v);
        where.push(
          descending
            ? sql`(${col}, ${customer.id}) < (${value}, ${id})`
            : sql`(${col}, ${customer.id}) > (${value}, ${id})`,
        );
      }

      const condition = and(...where);
      const offset = f.page ? (f.page - 1) * f.limit : 0;
      const rows = await tx
        .select({
          c: customer,
          primaryContact: sql<{ name: string; email: string | null; phone: string | null } | null>`(
            select json_build_object('name', c.name, 'email', c.email, 'phone', c.phone) from ${contact} c
            where c.organization_id = ${orgId} and c.customer_id = "customer"."id"
            order by c.is_primary desc, c.created_at limit 1)`,
          siteCount: sql<number>`(select count(*)::int from ${site} s where s.organization_id = ${orgId} and s.customer_id = "customer"."id" and s.deleted_at is null)`,
          openJobCount: sql<number>`(select count(*)::int from ${job} j where j.organization_id = ${orgId} and j.customer_id = "customer"."id" and j.deleted_at is null and j.status not in ('completed','canceled'))`,
          lastJobAt: sql<
            string | null
          >`(select max(coalesce(j.scheduled_start, j.created_at)) from ${job} j where j.organization_id = ${orgId} and j.customer_id = "customer"."id" and j.deleted_at is null)`,
        })
        .from(customer)
        .where(condition)
        .orderBy(...order)
        .limit(f.limit + 1)
        .offset(offset);

      const hasMore = rows.length > f.limit;
      const pageRows = rows.slice(0, f.limit);
      const last = pageRows.at(-1);
      let total: number | null = null;
      if (f.page) {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(customer)
          .where(condition);
        total = t?.n ?? 0;
      }
      return {
        rows: pageRows.map((r) => ({
          ...toCustomer(r.c),
          primaryContact: r.primaryContact,
          siteCount: r.siteCount,
          openJobCount: r.openJobCount,
          lastJobAt: r.lastJobAt ? new Date(r.lastJobAt) : null,
        })),
        nextCursor:
          hasMore && last && !f.page
            ? encodeCursor({
                s: f.sort,
                v: [field === "name" ? last.c.name : last.c.createdAt.toISOString(), last.c.id],
              })
            : null,
        total,
      };
    },

    async get(id) {
      const [r] = await tx
        .select()
        .from(customer)
        .where(and(scope, eq(customer.id, id)));
      return r ? toCustomer(r) : null;
    },

    async create(data) {
      const [r] = await tx
        .insert(customer)
        .values({
          organizationId: orgId,
          type: data.type,
          name: data.name,
          billingAddress: data.billingAddress,
          tags: data.tags,
          notes: data.notes,
          locale: data.locale ?? null,
        })
        .returning();
      return toCustomer(r!);
    },

    async update(id, patch) {
      const [r] = await tx
        .update(customer)
        .set(definedOnly({ ...patch, updatedAt: new Date() }))
        .where(and(scope, eq(customer.id, id)))
        .returning();
      return r ? toCustomer(r) : null;
    },

    async softDelete(id) {
      const r = await tx
        .update(customer)
        .set({ deletedAt: new Date() })
        .where(and(scope, eq(customer.id, id)))
        .returning({ id: customer.id });
      return r.length > 0;
    },

    async contacts(customerId) {
      const rows = await tx
        .select()
        .from(contact)
        .where(and(eq(contact.organizationId, orgId), eq(contact.customerId, customerId)))
        .orderBy(desc(contact.isPrimary), asc(contact.createdAt));
      return rows.map((c) => ({
        id: c.id,
        customerId: c.customerId,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        isPrimary: c.isPrimary,
      }));
    },

    async addContact(customerId, data) {
      const [c] = await tx
        .insert(contact)
        .values({ organizationId: orgId, customerId, ...data })
        .returning();
      return {
        id: c!.id,
        customerId,
        name: c!.name,
        role: c!.role,
        email: c!.email,
        phone: c!.phone,
        isPrimary: c!.isPrimary,
      };
    },

    async findDuplicates({ emails, phones, excludeCustomerId }) {
      const matches: SQL[] = [];
      if (emails.length) matches.push(inArray(contact.emailNorm, emails));
      if (phones.length) matches.push(inArray(contact.phoneNorm, phones));
      if (!matches.length) return [];
      const rows = await tx
        .selectDistinct({
          id: customer.id,
          name: customer.name,
          emailNorm: contact.emailNorm,
          phoneNorm: contact.phoneNorm,
        })
        .from(contact)
        .innerJoin(customer, and(eq(customer.id, contact.customerId), eq(customer.organizationId, orgId)))
        .where(
          and(
            eq(contact.organizationId, orgId),
            isNull(customer.deletedAt),
            or(...matches),
            excludeCustomerId ? sql`${customer.id} <> ${excludeCustomerId}` : undefined,
          ),
        )
        .limit(10);
      const seen = new Map<string, { id: string; name: string; matchedOn: "email" | "phone" }>();
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.set(r.id, {
          id: r.id,
          name: r.name,
          matchedOn: r.emailNorm && emails.includes(r.emailNorm) ? "email" : "phone",
        });
      }
      return [...seen.values()];
    },

    async isLinkedToMember(customerId, memberId) {
      const [r] = await tx
        .select({ id: customer.id })
        .from(customer)
        .where(and(scope, eq(customer.id, customerId), linkedToMember(orgId, memberId)));
      return Boolean(r);
    },

    async stats(customerId) {
      const [r] = await tx
        .select({
          jobCount: sql<number>`count(*)::int`,
          openJobCount: sql<number>`count(*) filter (where ${job.status} not in ('completed','canceled'))::int`,
          completedJobCount: sql<number>`count(*) filter (where ${job.status} = 'completed')::int`,
          lastJobAt: sql<string | null>`max(coalesce(${job.scheduledStart}, ${job.createdAt}))`,
        })
        .from(job)
        .where(and(eq(job.organizationId, orgId), eq(job.customerId, customerId), isNull(job.deletedAt)));
      return {
        jobCount: r?.jobCount ?? 0,
        openJobCount: r?.openJobCount ?? 0,
        completedJobCount: r?.completedJobCount ?? 0,
        lastJobAt: r?.lastJobAt ? new Date(r.lastJobAt) : null,
      };
    },
  };
}
