# Translation glossary

FieldOps ships in English (`en`) and Bahasa Indonesia (`id`). Each namespace is one JSON file per language
(`messages/<locale>/<namespace>.json`); a key missing in `id` falls back to English, and a unit test keeps the keys
and ICU arguments of both languages in step.

## Voice

- Professional and friendly, for the staff and customers of a small service business. Address people as **Anda**
  (never _kamu_); instructions use the plain verb: _Pilih pelanggan_, _Masukkan email_. Don't stack _silakan_.
- Natural Indonesian, not word-for-word English. Short labels stay short (buttons, columns, badges).
- Sentence case, like the English: only the first word and names are capitalized (_Jenis layanan_, not _Jenis
  Layanan_).
- Keep product and brand names as they are: FieldOps, Acme, Google, CSV, API, SLA, AI, JPEG, PNG.
- Keep record numbers and codes untouched: `JOB-000123`, `QUO-2026-0001`, `HH:MM`, `⌘K`, `Ctrl K`.

## Formatting

- Dates: `5 Nov 2026`, with a weekday `Kam, 5 Nov`. Times use the 24-hour clock with a period: `14.30` (PUEBI),
  ranges `08.00–10.00`. The app formats dates and numbers itself; translations only move the placeholders.
- Numbers and money come formatted (`Rp85.000`, `1.250`); never rewrite a placeholder's value.
- ICU: keep every `{argument}` name, every `select` key and the `#` in plurals. Indonesian has no plural
  forms, so a plural becomes `{count, plural, other {# pekerjaan}}` (an `=0` branch may stay when the English has
  one). Keep rich-text tags such as `<b>…</b>` around the matching words.

## Terms

| English                                 | Bahasa Indonesia                        | Notes                                                                                 |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| job, work order                         | pekerjaan                               | "New job" → _Pekerjaan baru_; the number stays `JOB-000123`                           |
| jobs list                               | daftar pekerjaan                        |                                                                                       |
| customer                                | pelanggan                               |                                                                                       |
| residential / commercial                | rumah tangga / komersial                | customer types                                                                        |
| contact, primary contact                | kontak, kontak utama                    |                                                                                       |
| contact role (job title)                | jabatan                                 | _peran_ stays for member roles                                                        |
| site                                    | lokasi                                  | a customer's address where work happens                                               |
| equipment, unit                         | peralatan, unit                         | "a unit of equipment" → _unit_                                                        |
| warranty                                | garansi                                 |                                                                                       |
| service type                            | jenis layanan                           |                                                                                       |
| technician                              | teknisi                                 |                                                                                       |
| dispatcher                              | dispatcher                              | role name, widely used as is                                                          |
| owner, admin                            | pemilik, admin                          | role names                                                                            |
| member, team                            | anggota, tim                            |                                                                                       |
| role                                    | peran                                   |                                                                                       |
| invitation                              | undangan                                |                                                                                       |
| organization                            | organisasi                              |                                                                                       |
| schedule (noun / verb)                  | jadwal / jadwalkan                      |                                                                                       |
| scheduling                              | penjadwalan                             |                                                                                       |
| dispatch board                          | papan jadwal                            |                                                                                       |
| visit                                   | kunjungan                               |                                                                                       |
| visit window                            | waktu kunjungan                         |                                                                                       |
| assign                                  | tugaskan                                | "assigned to you" → _ditugaskan kepada Anda_                                          |
| lead technician                         | teknisi utama                           |                                                                                       |
| queue                                   | antrean                                 |                                                                                       |
| lane (dispatch board)                   | jalur                                   |                                                                                       |
| scheduling conflict                     | bentrok jadwal                          | "No conflicts" → _Tidak ada bentrok_                                                  |
| My day                                  | Jadwal saya                             | the technician's page                                                                 |
| En route (button) / Start               | Berangkat / Mulai                       | the status stays _dalam perjalanan_                                                   |
| unscheduled                             | belum dijadwalkan                       |                                                                                       |
| working hours / business hours          | jam kerja / jam operasional             |                                                                                       |
| time off                                | cuti                                    |                                                                                       |
| availability                            | ketersediaan                            |                                                                                       |
| skill                                   | keahlian                                |                                                                                       |
| status: new                             | baru                                    |                                                                                       |
| status: scheduled                       | terjadwal                               |                                                                                       |
| status: en route                        | dalam perjalanan                        |                                                                                       |
| status: in progress                     | sedang dikerjakan                       |                                                                                       |
| status: on hold                         | ditunda                                 |                                                                                       |
| status: completed                       | selesai                                 |                                                                                       |
| status: canceled                        | dibatalkan                              |                                                                                       |
| reopen                                  | buka kembali                            |                                                                                       |
| priority: low / normal / high / urgent  | rendah / normal / tinggi / mendesak     |                                                                                       |
| checklist                               | daftar periksa                          |                                                                                       |
| notes                                   | catatan                                 |                                                                                       |
| timeline                                | riwayat                                 |                                                                                       |
| attachment, photo                       | lampiran, foto                          |                                                                                       |
| signature                               | tanda tangan                            |                                                                                       |
| time entry                              | catatan waktu                           |                                                                                       |
| travel time / work time                 | waktu perjalanan / waktu kerja          |                                                                                       |
| part, parts and expenses                | suku cadang, suku cadang dan biaya      |                                                                                       |
| part or expense request, request (verb) | pengajuan, ajukan                       | "Requested by {name}" → _Diajukan oleh {name}_                                        |
| expense                                 | biaya                                   |                                                                                       |
| receipt                                 | nota                                    |                                                                                       |
| approval, approve, reject               | persetujuan, setujui, tolak             | "Approvals" (page) → _Persetujuan_                                                    |
| threshold, auto-approve                 | batas, disetujui otomatis               |                                                                                       |
| quote                                   | penawaran                               |                                                                                       |
| invoice                                 | faktur                                  |                                                                                       |
| payment                                 | pembayaran                              |                                                                                       |
| tax                                     | pajak                                   |                                                                                       |
| service report                          | laporan servis                          |                                                                                       |
| request (from a customer)               | permintaan                              |                                                                                       |
| customer portal                         | portal pelanggan                        |                                                                                       |
| needs review                            | perlu ditinjau                          |                                                                                       |
| SLA, response, resolution               | SLA, respons, penyelesaian              |                                                                                       |
| on track / at risk / breached / met     | aman / berisiko / terlewati / terpenuhi |                                                                                       |
| due                                     | tenggat                                 | "Due {when}" → _Tenggat {when}_                                                       |
| dashboard, Home                         | dasbor, Beranda                         |                                                                                       |
| overview, Today                         | ringkasan, Hari ini                     |                                                                                       |
| KPI, chart                              | KPI, grafik                             |                                                                                       |
| report, export                          | laporan, ekspor                         |                                                                                       |
| notification                            | notifikasi                              |                                                                                       |
| settings                                | pengaturan                              |                                                                                       |
| audit log                               | log audit                               |                                                                                       |
| AI draft, draft with AI                 | draf AI, buat draf dengan AI            |                                                                                       |
| smart intake                            | intake AI                               | the 0.3 feature name                                                                  |
| quota                                   | kuota                                   |                                                                                       |
| sign in / sign out / sign up            | masuk / keluar / daftar                 | "Create an account" → _Buat akun_                                                     |
| password                                | kata sandi                              |                                                                                       |
| email                                   | email                                   |                                                                                       |
| demo inbox / demo outbox                | kotak masuk demo / kotak keluar demo    |                                                                                       |
| save, cancel, delete, edit              | simpan, batal, hapus, ubah              |                                                                                       |
| add, create, remove                     | tambah, buat, hapus                     |                                                                                       |
| search, filter                          | cari, filter                            |                                                                                       |
| optional                                | opsional                                |                                                                                       |
| default (setting)                       | bawaan                                  |                                                                                       |
| open jobs                               | pekerjaan aktif                         |                                                                                       |
| record (audit) / actor / action         | data / pelaku / tindakan                |                                                                                       |
| billing (settings tab)                  | penagihan                               |                                                                                       |
| loading                                 | memuat                                  |                                                                                       |
| language                                | bahasa                                  | English → _English_, Bahasa Indonesia → _Bahasa Indonesia_ (each in its own language) |

## Terms added in 0.4

| English                                                          | Bahasa Indonesia                                                 | Notes                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| quote, quote status draft / sent / approved / declined / expired | penawaran: draf / terkirim / disetujui / ditolak / kedaluwarsa   |                                                               |
| invoice, invoice status draft / sent / paid / overdue / void     | faktur: draf / terkirim / lunas / jatuh tempo lewat / dibatalkan | "Overdue" as a badge → _Terlambat_                            |
| payment, record a payment                                        | pembayaran, catat pembayaran                                     |                                                               |
| payment method: card / bank transfer / cash                      | kartu / transfer bank / tunai                                    |                                                               |
| due date, due                                                    | jatuh tempo                                                      | "Due {date}" → _Jatuh tempo {date}_ (for SLAs keep _tenggat_) |
| balance, amount due                                              | sisa tagihan                                                     |                                                               |
| paid, partially paid                                             | lunas, dibayar sebagian                                          |                                                               |
| payment terms                                                    | termin pembayaran                                                | "Net 14" → _14 hari_                                          |
| valid until                                                      | berlaku hingga                                                   |                                                               |
| line item, line                                                  | baris                                                            | "Add line" → _Tambah baris_                                   |
| catalog, catalog item                                            | katalog, item katalog                                            |                                                               |
| labor                                                            | jasa                                                             | "Labor rate" → _Tarif jasa per jam_                           |
| discount, subtotal, tax, total                                   | diskon, subtotal, pajak, total                                   |                                                               |
| reminder                                                         | pengingat                                                        |                                                               |
| receipt (for a payment)                                          | bukti pembayaran                                                 | a part's receipt stays _nota_                                 |
| revenue, invoiced, collected                                     | pendapatan, ditagihkan, diterima                                 |                                                               |
| maintenance plan                                                 | rencana perawatan                                                | recurring visits under a contract                             |
| recurring, occurrence                                            | berulang, jadwal kunjungan                                       |                                                               |
| paused (plan or SLA)                                             | dijeda                                                           | "SLA paused" → _SLA dijeda_                                   |
| daily digest                                                     | ringkasan harian                                                 |                                                               |
| service report                                                   | laporan servis                                                   |                                                               |
| findings, recommendations, work performed                        | temuan, rekomendasi, pekerjaan yang dilakukan                    |                                                               |
| next service date                                                | tanggal servis berikutnya                                        |                                                               |
| Ask FieldOps (assistant)                                         | Tanya FieldOps                                                   | the product name of the assistant                             |
| conversation                                                     | percakapan                                                       |                                                               |
