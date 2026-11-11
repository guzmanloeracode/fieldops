import type { Locale } from "./locales";

// Domain errors (packages/core) and shared schema checks (packages/shared) speak English: it is the language of the
// REST API's problem details. Server actions show those messages to people, so the web app translates them here, by
// their English text. A message with no entry stays in English. Keep this list in step with new error messages.

const ID: Record<string, string> = {
  // packages/core: defaults
  "You don't have permission to do that": "Anda tidak memiliki izin untuk melakukannya",
  "The record changed since you loaded it. Reload and try again.":
    "Data ini sudah berubah sejak Anda membukanya. Muat ulang, lalu coba lagi.",
  "This action is disabled in the public demo": "Tindakan ini tidak tersedia di demo publik",
  "Invalid input": "Masukan tidak valid",
  // packages/core: jobs and their lifecycle
  "A reason is required for this change": "Perubahan ini memerlukan alasan",
  "Assign a technician first": "Tugaskan teknisi terlebih dahulu",
  "Set a scheduled time first": "Atur waktu jadwal terlebih dahulu",
  "Choose what the job is waiting for": "Pilih apa yang sedang ditunggu pekerjaan ini",
  "Finish the required checklist items first": "Selesaikan dulu item wajib di daftar periksa",
  "Capture the customer's signature first": "Ambil tanda tangan pelanggan terlebih dahulu",
  "Completed or canceled jobs can't be reassigned":
    "Pekerjaan yang selesai atau dibatalkan tidak dapat ditugaskan ulang",
  "Choose a site of the selected customer": "Pilih lokasi milik pelanggan yang dipilih",
  "The site doesn't belong to this customer": "Lokasi ini bukan milik pelanggan tersebut",
  "The equipment isn't at this site": "Peralatan ini tidak berada di lokasi tersebut",
  "Not at this site": "Tidak berada di lokasi ini",
  "Unknown service type": "Jenis layanan tidak dikenal",
  "A visit can last at most 24 hours": "Satu kunjungan paling lama 24 jam",
  "Invalid date": "Tanggal tidak valid",
  "Unknown member": "Anggota tidak dikenal",
  "Lead technician must be one of the assigned members":
    "Teknisi utama harus salah satu anggota yang ditugaskan",
  "Set both start and end, or neither": "Isi waktu mulai dan selesai, atau kosongkan keduanya",
  "End must be after start": "Waktu selesai harus setelah waktu mulai",
  "Preferred end must be after preferred start": "Waktu paling lambat harus setelah waktu paling awal",
  // checklists, signatures, files, time
  "The checklist of a completed or canceled job can't be changed":
    "Daftar periksa pekerjaan yang selesai atau dibatalkan tidak dapat diubah",
  "Unknown checklist item": "Item daftar periksa tidak dikenal",
  "Not an item of this job": "Bukan item dari pekerjaan ini",
  "A completed or canceled job can't be signed":
    "Pekerjaan yang selesai atau dibatalkan tidak dapat ditandatangani",
  "The upload hasn't finished yet": "Unggahan belum selesai",
  "This upload isn't a signature image": "Unggahan ini bukan gambar tanda tangan",
  "The file is too large": "Ukuran file terlalu besar",
  "This file type isn't allowed": "Jenis file ini tidak diizinkan",
  "A finished entry needs an end time": "Catatan yang sudah selesai memerlukan waktu selesai",
  "Enter when it ended": "Masukkan kapan selesainya",
  "Time can't be in the future": "Waktu tidak boleh di masa depan",
  "Can't be in the future": "Tidak boleh di masa depan",
  // customers and equipment
  "Warranty can't end before the install date": "Garansi tidak boleh berakhir sebelum tanggal pemasangan",
  "Must be on or after the install date": "Harus pada atau setelah tanggal pemasangan",
  // parts and expenses
  "Parts and expenses can only be requested on open jobs":
    "Suku cadang dan biaya hanya dapat diajukan untuk pekerjaan aktif",
  "Only approved parts can be recorded as used":
    "Hanya suku cadang yang disetujui yang dapat dicatat sebagai terpakai",
  "This request has already been decided": "Pengajuan ini sudah diputuskan",
  "The receipt isn't an uploaded file of this job": "Nota ini bukan file yang diunggah ke pekerjaan ini",
  "Upload the receipt to this job first": "Unggah notanya ke pekerjaan ini terlebih dahulu",
  "Say why the request is rejected": "Tuliskan alasan pengajuan ditolak",
  "Say why the requests are rejected": "Tuliskan alasan pengajuan-pengajuan ini ditolak",
  "At most two decimals": "Maksimal dua angka desimal",
  "The dispatcher limit can't be lower than the auto-approve threshold":
    "Batas dispatcher tidak boleh lebih rendah dari batas persetujuan otomatis",
  // organization, members, settings
  "An organization needs at least one owner": "Organisasi harus memiliki minimal satu pemilik",
  "You can't remove yourself": "Anda tidak dapat menghapus diri sendiri",
  "Demo accounts keep their roles": "Peran akun demo tidak dapat diubah",
  "Demo accounts can't be removed": "Akun demo tidak dapat dihapus",
  "Use a hex color like #0EA5E9": "Gunakan warna heksadesimal seperti #0EA5E9",
  "2–40 letters, numbers, spaces or hyphens": "2–40 huruf, angka, spasi, atau tanda hubung",
  "3–48 lowercase letters, numbers or hyphens": "3–48 huruf kecil, angka, atau tanda hubung",
  "The response target must be shorter than the resolution target":
    "Target respons harus lebih singkat dari target penyelesaian",
  "Give one policy per priority": "Isi satu kebijakan untuk setiap prioritas",
  "You don't receive this notification": "Anda tidak menerima notifikasi ini",
  "Not available for your role": "Tidak tersedia untuk peran Anda",
  "These filters can't be saved": "Filter ini tidak dapat disimpan",
  "Delete a view first": "Hapus salah satu tampilan terlebih dahulu",
  "Choose a valid role": "Pilih peran yang valid",
  "The request was rejected": "Permintaan ditolak",
  // Better Auth (invitations)
  "User is already a member of this organization": "Pengguna ini sudah menjadi anggota organisasi",
  "User is already invited to this organization": "Pengguna ini sudah diundang ke organisasi",
  // AI
  "AI features are turned off for this organization": "Fitur AI dinonaktifkan untuk organisasi ini",
  "AI isn't configured on this server": "AI belum dikonfigurasi di server ini",
  "This month's AI quota is used up": "Kuota AI bulan ini sudah habis",
  "There is no AI draft to apply": "Tidak ada draf AI untuk diterapkan",
  "No AI draft": "Tidak ada draf AI",
  "This draft was already used": "Draf ini sudah dipakai",
  "This request was already reviewed": "Permintaan ini sudah ditinjau",
  "Work on the checklist has started; add items from the checklist itself":
    "Daftar periksa sudah mulai dikerjakan; tambahkan item langsung dari daftar periksa",
  "Paste the customer's message (at least 10 characters)": "Tempel pesan pelanggan (minimal 10 karakter)",
  // customer portal
  "Choose one of your addresses": "Pilih salah satu alamat Anda",
  "Choose one of your addresses or enter a new one": "Pilih salah satu alamat Anda atau masukkan alamat baru",
  "Enter the street address": "Masukkan alamat jalan",
  "Enter the city": "Masukkan kota",
  "Enter a valid email": "Masukkan email yang valid",
  "Tell us a little more (at least 10 characters)": "Ceritakan sedikit lebih banyak (minimal 10 karakter)",
  "Pick at least one time that suits you": "Pilih minimal satu waktu yang cocok untuk Anda",
  "Pick up to three times": "Pilih maksimal tiga waktu",
  "Pick a day from today up to two months ahead": "Pilih hari mulai hari ini hingga dua bulan ke depan",
  "Photos must be JPEG, PNG or WebP": "Foto harus berformat JPEG, PNG, atau WebP",
  "Photos can be up to 5 MB": "Ukuran foto maksimal 5 MB",
  "A photo hasn't finished uploading": "Ada foto yang belum selesai diunggah",
  "A photo couldn't be attached": "Ada foto yang tidak dapat dilampirkan",
  "Upload the photo again": "Unggah ulang fotonya",
  "Photo uploads aren't available right now": "Unggah foto sedang tidak tersedia",
  // 0.4: quotes, invoices, payments and the catalog
  "1–10 letters or digits": "1–10 huruf atau angka",
  "A job can be invoiced once it's completed": "Pekerjaan baru bisa difakturkan setelah selesai",
  "A part or expense appears twice": "Suku cadang atau biaya ini muncul dua kali",
  "A part or expense can only be billed once": "Suku cadang atau biaya hanya bisa ditagihkan sekali",
  "A part or expense on this invoice is already billed on another invoice":
    "Ada suku cadang atau biaya di faktur ini yang sudah ditagihkan di faktur lain",
  "A payment can't be in the future": "Tanggal pembayaran tidak boleh di masa depan",
  "A percentage can't exceed 100%": "Persentase tidak boleh lebih dari 100%",
  "Add at least one line before sending the quote": "Tambahkan minimal satu baris sebelum mengirim penawaran",
  "Add at least one line with a price": "Tambahkan minimal satu baris dengan harga",
  "Add at least one line": "Tambahkan minimal satu baris",
  "Already used by another item": "Sudah dipakai item lain",
  "Choose a contact of this customer": "Pilih kontak milik pelanggan ini",
  "Choose a contact with an email address": "Pilih kontak yang memiliki alamat email",
  "Choose a customer or a job": "Pilih pelanggan atau pekerjaan",
  "Choose a customer": "Pilih pelanggan",
  "Choose a date from today on": "Pilih tanggal mulai hari ini",
  "Choose one of the organization's tax rates": "Pilih salah satu tarif pajak organisasi",
  "Not an approved part or expense of this job":
    "Bukan suku cadang atau biaya yang disetujui untuk pekerjaan ini",
  "Only approved parts and expenses of this job can be billed":
    "Hanya suku cadang dan biaya yang disetujui untuk pekerjaan ini yang bisa ditagihkan",
  "Only draft invoices can be edited": "Hanya faktur draf yang bisa diubah",
  "Only draft quotes can be edited. Revise the quote first.":
    "Hanya penawaran draf yang bisa diubah. Revisi penawarannya terlebih dahulu.",
  "Say why the customer declined": "Tuliskan alasan pelanggan menolak",
  "Say why the invoice is void": "Tuliskan alasan faktur dibatalkan",
  "The amounts are too large": "Nominalnya terlalu besar",
  "The contact doesn't belong to this customer": "Kontak ini bukan milik pelanggan tersebut",
  "The customer needs a site before the quote can become a job":
    "Pelanggan memerlukan lokasi sebelum penawaran bisa menjadi pekerjaan",
  "The invoice changed meanwhile. Reload it and try again.":
    "Faktur ini sudah berubah. Muat ulang, lalu coba lagi.",
  "The invoice needs at least one line and a total above zero":
    "Faktur memerlukan minimal satu baris dan total di atas nol",
  "The job belongs to another customer": "Pekerjaan ini milik pelanggan lain",
  "The payment is more than the balance": "Pembayaran melebihi sisa tagihan",
  "The quote's validity date has passed": "Masa berlaku penawaran sudah lewat",
  "This quote has already been decided": "Penawaran ini sudah diputuskan",
  "This quote has expired. Revise it and send it again.":
    "Penawaran ini sudah kedaluwarsa. Revisi, lalu kirim lagi.",
  "Unknown catalog item": "Item katalog tidak dikenal",
  "Unknown customer": "Pelanggan tidak dikenal",
  "Use a different prefix for quotes and invoices": "Gunakan awalan yang berbeda untuk penawaran dan faktur",
  // 0.4: online payments and the customer portal
  "This invoice is already paid": "Faktur ini sudah lunas",
  "Online payments aren't set up": "Pembayaran online belum disiapkan",
  "This checkout has expired. Go back to the invoice to pay.":
    "Sesi pembayaran ini sudah kedaluwarsa. Kembali ke faktur untuk membayar.",
  // 0.4: service reports
  "Describe the work performed before sending": "Jelaskan pekerjaan yang dilakukan sebelum mengirim",
  "Enter a valid email address": "Masukkan alamat email yang valid",
  "Not a contact of this customer": "Bukan kontak pelanggan ini",
  Required: "Wajib diisi",
  "Send the report to one of the customer's contacts": "Kirim laporan ke salah satu kontak pelanggan",
  "The job isn't completed yet": "Pekerjaan ini belum selesai",
  // 0.4: maintenance plans
  "Choose a site of this customer": "Pilih lokasi milik pelanggan ini",
  "Give the window's start and its length, or neither":
    "Isi jam mulai dan durasinya, atau kosongkan keduanya",
  "No visit date is left before this end date":
    "Tidak ada jadwal kunjungan tersisa sebelum tanggal berakhir ini",
  "On or after the start date": "Pada atau setelah tanggal mulai",
  "The end date must be on or after the start": "Tanggal berakhir harus pada atau setelah tanggal mulai",
  "The interval is too long": "Intervalnya terlalu panjang",
  "The plan ends before its next visit": "Rencana ini berakhir sebelum kunjungan berikutnya",
  // 0.4: the assistant
  "Revenue is only for owners and admins": "Data pendapatan hanya untuk pemilik dan admin",
  "You don't approve parts and expenses": "Anda tidak menyetujui suku cadang dan biaya",
  // 0.5: webhooks
  "Webhooks aren't configured on this server": "Webhook belum disiapkan di server ini",
  "Relay can't be reached right now. Try again in a minute.":
    "Relay sedang tidak dapat dihubungi. Coba lagi sebentar lagi.",
  "Turn on webhooks first": "Nyalakan webhook terlebih dahulu",
  "An organization can have at most 10 endpoints": "Satu organisasi paling banyak memiliki 10 endpoint",
  "Turn the endpoint on first": "Nyalakan endpoint terlebih dahulu",
  "In the public demo, endpoints can only point at https://webhook.site or the demo's test receiver":
    "Di demo publik, endpoint hanya boleh mengarah ke https://webhook.site atau penerima uji demo",
  "Only deliveries that ran out of attempts can be redelivered":
    "Hanya pengiriman yang sudah kehabisan percobaan yang dapat dikirim ulang",
  "This delivery was already redelivered": "Pengiriman ini sudah dikirim ulang",
  "url must point to a public address": "URL harus mengarah ke alamat publik",
};

/** Names of records in "… not found". */
const ENTITY_ID: Record<string, string> = {
  "AI draft": "Draf AI",
  Attachment: "Lampiran",
  Customer: "Pelanggan",
  Equipment: "Peralatan",
  Expense: "Pengajuan",
  Job: "Pekerjaan",
  Member: "Anggota",
  "Service type": "Jenis layanan",
  Site: "Lokasi",
  "Time entry": "Catatan waktu",
  "Time off": "Cuti",
  View: "Tampilan",
  "Catalog item": "Item katalog",
  Conversation: "Percakapan",
  Invoice: "Faktur",
  "Maintenance plan": "Rencana perawatan",
  Quote: "Penawaran",
  "Service report": "Laporan servis",
  Checkout: "Sesi pembayaran",
  "Webhook endpoint": "Endpoint webhook",
  "Webhook delivery": "Pengiriman webhook",
};

const INVOICE_STATUS_ID: Record<string, string> = {
  draft: "draf",
  sent: "terkirim",
  paid: "lunas",
  overdue: "terlambat",
  void: "dibatalkan",
};

const STATUS_ID: Record<string, string> = {
  New: "Baru",
  Scheduled: "Terjadwal",
  "En route": "Dalam perjalanan",
  "In progress": "Sedang dikerjakan",
  "On hold": "Ditunda",
  Completed: "Selesai",
  Canceled: "Dibatalkan",
};

/** Messages built from values: [English pattern, Indonesian]. */
const PATTERNS_ID: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^(.+) not found$/, (m) => `${ENTITY_ID[m[1]!] ?? m[1]} tidak ditemukan`],
  [
    /^A job can't move from (.+) to (.+)$/,
    (m) =>
      `Status pekerjaan tidak dapat diubah dari ${STATUS_ID[m[1]!] ?? m[1]} menjadi ${STATUS_ID[m[2]!] ?? m[2]}`,
  ],
  [/^Add up to (\d+) photos$/, (m) => `Tambahkan maksimal ${m[1]} foto`],
  [/^You can keep up to (\d+) views$/, (m) => `Anda dapat menyimpan maksimal ${m[1]} tampilan`],
  [/^Maximum (\d+) MB$/, (m) => `Maksimal ${m[1]} MB`],
  [/^(.+) is already billed on another invoice$/, (m) => `${m[1]} sudah ditagihkan di faktur lain`],
  [/^SKU (.+) is already used by (.+)$/, (m) => `SKU ${m[1]} sudah dipakai oleh ${m[2]}`],
  [/^At most the balance of (.+)$/, (m) => `Maksimal sebesar sisa tagihan ${m[1]}`],
  [/^At most (\d+) for this unit$/, (m) => `Maksimal ${m[1]} untuk satuan ini`],
  [
    /^A (\w+) invoice can't be paid online$/,
    (m) => `Faktur ${INVOICE_STATUS_ID[m[1]!] ?? m[1]} tidak dapat dibayar online`,
  ],
];

/** A server message in the reader's language; English (and anything unknown) is returned as is. */
export function translateServerMessage(message: string, locale: Locale): string {
  if (locale !== "id") return message;
  const exact = ID[message];
  if (exact) return exact;
  for (const [pattern, to] of PATTERNS_ID) {
    const m = pattern.exec(message);
    if (m) return to(m);
  }
  return message;
}
