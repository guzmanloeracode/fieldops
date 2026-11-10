import type { NotificationEmailProps } from "./notification";

// Bahasa Indonesia copy of the notification emails (SET-05), kept in step with notificationCopy in notification.tsx.

const jobLabel = (n?: number) => (n === undefined ? "sebuah pekerjaan" : `JOB-${String(n).padStart(6, "0")}`);

function when(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

export function notificationCopyId(p: Pick<NotificationEmailProps, "event" | "payload" | "timeZone">) {
  const { payload: x, timeZone } = p;
  const job = jobLabel(x.job_number);
  const title = x.job_title ?? job;
  const customer = x.customer_name ? ` untuk ${x.customer_name}` : "";
  const start = when(x.scheduled_start, timeZone);
  const due = when(x.due_at, timeZone);
  const goal = x.target === "response" ? "dijadwalkan dengan teknisi" : "diselesaikan";
  switch (p.event) {
    case "job_assigned":
      return {
        subject: `Pekerjaan baru ${job}: ${title}`,
        heading: "Anda mendapat pekerjaan baru",
        body: `${x.actor_name ?? "Dispatcher"} menugaskan Anda ke ${title}${customer}${start ? ` pada ${start}` : ""}.`,
        cta: "Buka pekerjaan",
      };
    case "job_rescheduled":
      return {
        subject: `Jadwal diubah ${job}: ${title}`,
        heading: "Jadwal kunjungan diubah",
        body: `${title}${customer} sekarang dimulai ${start ? `pada ${start}` : "pada waktu yang baru"}.`,
        cta: "Lihat jadwal baru",
      };
    case "portal_request":
      return {
        subject: `Permintaan layanan baru ${job}: ${title}`,
        heading: "Permintaan baru dari portal pelanggan",
        body: `${x.customer_name ?? "Seorang pelanggan"} meminta layanan: ${title}. Tinjau lalu konfirmasi pekerjaannya.`,
        cta: "Tinjau permintaan",
      };
    case "sla_at_risk":
      return {
        subject: `SLA berisiko ${job}: ${title}`,
        heading: "Sebuah pekerjaan berisiko melewati SLA",
        body: `${title}${customer} harus ${goal} paling lambat ${due || "tenggat SLA-nya"}.`,
        cta: "Buka pekerjaan",
      };
    case "sla_breached":
      return {
        subject: `SLA terlewati ${job}: ${title}`,
        heading: "Sebuah pekerjaan melewati SLA",
        body: `${title}${customer} tidak ${goal} sebelum tenggat SLA-nya${due ? ` (${due})` : ""}.`,
        cta: "Buka pekerjaan",
      };
    case "expense_requested":
      return {
        subject: `Perlu persetujuan: ${x.item ?? "suku cadang"} pada ${job}`,
        heading: "Ada suku cadang atau biaya yang perlu disetujui",
        body: `${x.actor_name ?? "Seorang teknisi"} mengajukan ${x.item ?? "suku cadang"} untuk ${title}.`,
        cta: "Tinjau pengajuan",
      };
    case "expense_decided": {
      const rejected = x.decision === "rejected";
      return {
        subject: `${rejected ? "Ditolak" : "Disetujui"}: ${x.item ?? "pengajuan Anda"} pada ${job}`,
        heading: rejected ? "Pengajuan Anda ditolak" : "Pengajuan Anda disetujui",
        body: `${x.actor_name ?? "Pemberi persetujuan"} ${rejected ? "menolak" : "menyetujui"} ${x.item ?? "pengajuan Anda"} untuk ${title}.`,
        cta: "Buka pekerjaan",
      };
    }
    case "quote_decided": {
      const quote = x.quote_number ? `penawaran ${x.quote_number}` : "sebuah penawaran";
      const who = x.customer_name ?? "Pelanggan";
      const recorded = x.actor_name ? ` Keputusan dicatat oleh ${x.actor_name}.` : "";
      if (x.decision === "declined") {
        return {
          subject: `Ditolak: ${x.quote_number ?? "penawaran"}${customer}`,
          heading: "Sebuah penawaran ditolak",
          body: `${who} menolak ${quote}.${recorded}`,
          cta: "Buka penawaran",
        };
      }
      return {
        subject: `Disetujui: ${x.quote_number ?? "penawaran"}${customer}`,
        heading: "Sebuah penawaran disetujui",
        body: `${who} menyetujui ${quote}.${x.job_number !== undefined ? ` Sekarang menjadi ${job} dan siap dijadwalkan.` : ""}${recorded}`,
        cta: "Buka penawaran",
      };
    }
    case "payment_received":
      return {
        subject: `Pembayaran diterima: ${x.amount ?? "pembayaran"} untuk ${x.invoice_number ?? "faktur"}`,
        heading: "Pembayaran masuk",
        body: `${x.customer_name ?? "Seorang pelanggan"} membayar ${x.amount ?? "sejumlah dana"}${x.invoice_number ? ` untuk faktur ${x.invoice_number}` : ""}.${x.actor_name ? ` Dicatat oleh ${x.actor_name}.` : ""}`,
        cta: "Buka faktur",
      };
    case "daily_digest":
      return {
        subject: "Ringkasan harian Anda",
        heading: "Ringkasan harian Anda",
        body: "Angka kemarin, pekerjaan yang terlambat, dan persetujuan yang menunggu.",
        cta: "Buka FieldOps",
      };
  }
}
