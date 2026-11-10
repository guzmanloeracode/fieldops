import type { SearchHits, SearchRepo } from "@fieldops/core";
import { parseJobNumber } from "@fieldops/core";
import type { JobStatus } from "@fieldops/shared";
import { sql } from "drizzle-orm";
import type { Tx } from "../client";
import { likeEscape } from "./util";

// Command palette search (JOB-11). Titles and customer names use the trigram indexes; technicians only get
// rows linked to a job they're assigned to (TEC-05).

export function searchRepo(tx: Tx, orgId: string): SearchRepo {
  return {
    async search(q, opts): Promise<SearchHits> {
      const like = `%${likeEscape(q)}%`;
      const number = parseJobNumber(q) ?? -1;
      const me = opts.assignedMemberId ?? null;
      const assignedJob = (jobAlias: string) =>
        me
          ? sql`exists (select 1 from job_assignment ja where ja.organization_id = ${orgId} and ja.job_id = ${sql.raw(jobAlias)}.id and ja.member_id = ${me})`
          : sql`true`;
      const linked = (column: string) =>
        me
          ? sql`exists (select 1 from job lj join job_assignment ja on ja.job_id = lj.id and ja.organization_id = ${orgId}
                          where lj.organization_id = ${orgId} and lj.deleted_at is null and ja.member_id = ${me}
                            and lj.${sql.raw(column)})`
          : sql`true`;

      const [jobs, customers, sites] = await Promise.all([
        tx.execute<{
          id: string;
          number: number;
          title: string;
          status: JobStatus;
          customer_name: string;
        }>(sql`
          select j.id, j.number, j.title, j.status, c.name as customer_name
            from job j join customer c on c.id = j.customer_id
           where j.organization_id = ${orgId} and j.deleted_at is null
             and (j.number = ${number} or j.title ilike ${like})
             and ${assignedJob("j")}
           order by (j.number = ${number}) desc, j.created_at desc
           limit ${opts.limit}`),
        tx.execute<{ id: string; name: string; type: string; city: string | null }>(sql`
          select c.id, c.name, c.type,
                 (select s.city from site s where s.customer_id = c.id and s.organization_id = ${orgId}
                    and s.deleted_at is null order by s.created_at limit 1) as city
            from customer c
           where c.organization_id = ${orgId} and c.deleted_at is null and c.name ilike ${like}
             and ${linked("customer_id = c.id")}
           order by lower(c.name)
           limit ${opts.limit}`),
        tx.execute<{
          id: string;
          customer_id: string;
          customer_name: string;
          label: string;
          line1: string;
          city: string;
        }>(sql`
          select s.id, s.customer_id, c.name as customer_name, s.label, s.line1, s.city
            from site s join customer c on c.id = s.customer_id and c.deleted_at is null
           where s.organization_id = ${orgId} and s.deleted_at is null
             and (s.line1 ilike ${like} or s.label ilike ${like} or s.city ilike ${like}
                  or s.postal_code ilike ${like} or c.name ilike ${like})
             and ${linked("site_id = s.id")}
           order by lower(c.name), s.label
           limit ${opts.limit}`),
      ]);
      return {
        jobs: jobs.rows.map((r) => ({
          id: r.id,
          number: Number(r.number),
          title: r.title,
          status: r.status,
          customerName: r.customer_name,
        })),
        customers: customers.rows.map((r) => ({ id: r.id, name: r.name, type: r.type, city: r.city })),
        sites: sites.rows.map((r) => ({
          id: r.id,
          customerId: r.customer_id,
          customerName: r.customer_name,
          label: r.label,
          line1: r.line1,
          city: r.city,
        })),
      };
    },
  };
}
