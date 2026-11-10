import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@fieldops/db";
import { seedDemo, wipeAll } from "@fieldops/db/seed";
import { env } from "./env";
import { log } from "./log";

/** Deletes local uploads (ADR 015): every organization folder and unfinished temporary files. */
async function clearLocalUploads(dir: string): Promise<number> {
  let removed = 0;
  for (const sub of ["org", ".tmp"]) {
    const entries = await readdir(join(dir, sub)).catch(() => [] as string[]);
    for (const name of entries) {
      await rm(join(dir, sub, name), { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

/** Deletes every uploaded file under org/ (DEM-04: the nightly reset removes uploads). */
async function clearUploads(): Promise<number> {
  const { endpoint, bucket, accessKeyId, secretAccessKey, region } = env.s3;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return env.filesDir ? clearLocalUploads(env.filesDir) : 0;
  }
  const s3 = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "org/", ContinuationToken: token, MaxKeys: 1000 }),
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
      removed += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

/** Nightly demo reset (DEM-04): wipe everything, seed again relative to now, remove uploads. */
export async function resetDemo(db: Database) {
  const started = Date.now();
  await wipeAll(db);
  const result = await seedDemo(db, { password: env.demoPassword });
  const files = await clearUploads().catch((err) => {
    log.error({ err }, "upload cleanup failed");
    return 0;
  });
  log.info(
    {
      ms: Date.now() - started,
      orgs: result.organizations.map((o) => `${o.slug}:${o.jobs}`),
      filesRemoved: files,
    },
    "demo reset complete",
  );
}
