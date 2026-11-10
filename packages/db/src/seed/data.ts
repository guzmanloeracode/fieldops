// Static content for the two fictional demo organizations (PRD §19). Every person, company and address
// is invented; emails use the reserved .example domain.

export interface OrgSpec {
  key: "acme-air" | "acme-teknik";
  name: string;
  slug: string;
  locale: "en" | "id";
  fakerLocale: "en_US" | "id_ID";
  timezone: string;
  utcOffsetHours: number;
  currency: "USD" | "IDR";
  country: "US" | "ID";
  city: string;
  region: string;
  center: [number, number];
  brandColor: string;
  emailDomain: string;
  team: { name: string; role: "owner" | "admin" | "dispatcher" | "technician"; skills?: string[]; demo?: boolean }[];
  customers: number;
  sites: number;
  equipment: number;
  jobs: number;
  serviceTypes: { name: string; duration: number; priceMajor: number; color: string; seasonal: number; titles: string[] }[];
  tags: string[];
  descriptions: string[];
  notes: string[];
  holdNotes: string[];
  equipmentTypes: { type: string; brands: string[] }[];
  taxRates: { name: string; rate_bps: number; default: boolean }[];
  /** Relative demand per month (Jan..Dec); AC work peaks in summer in Texas, in the dry season in Jakarta. */
  monthly: number[];
}

export const ORGS: OrgSpec[] = [
  {
    key: "acme-air",
    name: "Acme Air & Clean",
    slug: "acme-air",
    locale: "en",
    fakerLocale: "en_US",
    timezone: "America/Chicago",
    utcOffsetHours: -6,
    currency: "USD",
    country: "US",
    city: "Austin",
    region: "TX",
    center: [30.2672, -97.7431],
    brandColor: "#0EA5E9",
    emailDomain: "acme-air.example",
    team: [
      { name: "Olivia Carter", role: "owner", demo: true },
      { name: "Marcus Webb", role: "admin" },
      { name: "Dan Brooks", role: "dispatcher", demo: true },
      { name: "Priya Shah", role: "dispatcher" },
      { name: "Tom Reyes", role: "technician", skills: ["ac", "electrical"], demo: true },
      { name: "Rina Patel", role: "technician", skills: ["ac", "refrigerant"] },
      { name: "Luis Moreno", role: "technician", skills: ["ac", "refrigerant", "install"] },
      { name: "Grace Kim", role: "technician", skills: ["cleaning"] },
      { name: "Jamal Wright", role: "technician", skills: ["cleaning", "duct"] },
      { name: "Hannah Olsen", role: "technician", skills: ["ac", "duct"] },
      { name: "Ethan Cole", role: "technician", skills: ["ac", "install", "electrical"] },
      { name: "Sofia Alvarez", role: "technician", skills: ["cleaning"] },
    ],
    customers: 300,
    sites: 380,
    equipment: 500,
    jobs: 2500,
    serviceTypes: [
      { name: "AC tune-up", duration: 90, priceMajor: 129, color: "#0EA5E9", seasonal: 1.4, titles: ["Seasonal AC tune-up", "AC tune-up, {n} units", "Pre-summer AC check"] },
      { name: "AC repair", duration: 120, priceMajor: 189, color: "#F97316", seasonal: 1.6, titles: ["AC not cooling", "Indoor unit leaking water", "AC making a loud noise", "Thermostat not responding", "AC trips the breaker"] },
      { name: "AC installation", duration: 240, priceMajor: 1450, color: "#8B5CF6", seasonal: 1.1, titles: ["Install new split system", "Replace old condenser", "Install mini-split in {room}"] },
      { name: "Refrigerant recharge", duration: 60, priceMajor: 159, color: "#14B8A6", seasonal: 1.5, titles: ["Refrigerant recharge", "Low refrigerant, ice on coil"] },
      { name: "Duct cleaning", duration: 180, priceMajor: 349, color: "#64748B", seasonal: 0.9, titles: ["Duct cleaning, whole house", "Musty smell from vents"] },
      { name: "Commercial cleaning", duration: 240, priceMajor: 480, color: "#22C55E", seasonal: 0.8, titles: ["Office deep clean", "Weekly office cleaning", "Post-renovation cleaning"] },
      { name: "Deep cleaning", duration: 180, priceMajor: 299, color: "#84CC16", seasonal: 0.8, titles: ["Move-out deep clean", "Kitchen and bathroom deep clean"] },
      { name: "Filter replacement", duration: 30, priceMajor: 59, color: "#EAB308", seasonal: 1, titles: ["Filter replacement", "Quarterly filter change"] },
    ],
    tags: ["VIP", "Maintenance plan", "Property manager", "Pets on site", "Gate code", "Net 30"],
    descriptions: [
      "Customer reports the bedroom unit is dripping water onto the floor. Smells musty.",
      "Unit runs but the air isn't cold. Started after last week's heat.",
      "Annual maintenance under the service plan. Check refrigerant levels and clean coils.",
      "Tenant says the thermostat screen is blank. Property manager will provide access.",
      "Loud rattling noise from the outdoor unit when it starts up.",
      "Please call 30 minutes before arriving. Parking in the back lot.",
      "Office of 12 people, cleaning after hours only. Alarm code with the front desk.",
      "Second visit this season for the same unit. Check the drain line carefully.",
      "Quote approved last week. Bring the new 2-ton condenser.",
      "Air is weak in the upstairs rooms. Possible duct leak.",
    ],
    notes: [
      "Called ahead, customer confirmed the window.",
      "Drain line was clogged; flushed and treated.",
      "Customer asked for a quote on a second unit.",
      "Replaced the capacitor. Unit cooling normally.",
      "Filters were very dirty. Recommended a 3-month replacement cycle.",
      "Gate code changed, updated the site access notes.",
      "Left a door hanger, nobody home at first attempt.",
      "Parts on the van were enough, no order needed.",
    ],
    holdNotes: ["Waiting for a replacement fan motor.", "Customer not home, will call back.", "Waiting for building access."],
    equipmentTypes: [
      { type: "Split AC", brands: ["Carrier", "Trane", "Lennox", "Goodman", "Rheem"] },
      { type: "Mini-split", brands: ["Daikin", "Mitsubishi", "Fujitsu", "LG"] },
      { type: "Furnace", brands: ["Carrier", "Lennox", "Rheem"] },
      { type: "Thermostat", brands: ["Honeywell", "Ecobee", "Nest"] },
    ],
    taxRates: [{ name: "Texas sales tax", rate_bps: 825, default: true }],
    monthly: [0.55, 0.6, 0.75, 0.9, 1.1, 1.35, 1.5, 1.45, 1.2, 0.95, 0.75, 0.6],
  },
  {
    key: "acme-teknik",
    name: "Acme Teknik Nusantara",
    slug: "acme-teknik",
    locale: "id",
    fakerLocale: "id_ID",
    timezone: "Asia/Jakarta",
    utcOffsetHours: 7,
    currency: "IDR",
    country: "ID",
    city: "Jakarta",
    region: "DKI Jakarta",
    center: [-6.2088, 106.8456],
    brandColor: "#16A34A",
    emailDomain: "acme-teknik.example",
    team: [
      { name: "Siti Rahmawati", role: "owner", demo: true },
      { name: "Budi Santoso", role: "dispatcher", demo: true },
      { name: "Agus Prasetyo", role: "technician", skills: ["ac", "refrigerant"], demo: true },
      { name: "Dewi Lestari", role: "technician", skills: ["ac"] },
      { name: "Rizky Ramadhan", role: "technician", skills: ["ac", "install"] },
      { name: "Fajar Nugroho", role: "technician", skills: ["ac", "electrical"] },
      { name: "Wahyu Hidayat", role: "technician", skills: ["ac", "install", "refrigerant"] },
    ],
    customers: 120,
    sites: 150,
    equipment: 180,
    jobs: 900,
    serviceTypes: [
      { name: "Cuci AC", duration: 60, priceMajor: 85_000, color: "#0EA5E9", seasonal: 1.3, titles: ["Cuci AC {n} unit", "Cuci AC rutin", "AC kurang dingin, minta dicuci"] },
      { name: "Perbaikan AC", duration: 120, priceMajor: 250_000, color: "#F97316", seasonal: 1.2, titles: ["AC bocor air", "AC tidak dingin", "Remote AC tidak berfungsi", "AC berisik"] },
      { name: "Pasang AC baru", duration: 180, priceMajor: 450_000, color: "#8B5CF6", seasonal: 1.1, titles: ["Pasang AC baru 1 PK", "Pasang AC di kamar {room}"] },
      { name: "Isi freon", duration: 60, priceMajor: 200_000, color: "#14B8A6", seasonal: 1.2, titles: ["Isi freon R32", "Tambah freon"] },
      { name: "Bongkar pasang AC", duration: 150, priceMajor: 350_000, color: "#64748B", seasonal: 0.9, titles: ["Bongkar pasang AC pindahan", "Relokasi unit outdoor"] },
      { name: "Perawatan gedung", duration: 240, priceMajor: 1_500_000, color: "#22C55E", seasonal: 0.8, titles: ["Perawatan AC kantor bulanan", "Servis berkala ruko"] },
    ],
    tags: ["Pelanggan tetap", "Kontrak perawatan", "Kantor", "Apartemen", "Bayar tempo"],
    descriptions: [
      "AC di kamar tidur meneteskan air dan baunya apek.",
      "AC menyala tapi tidak dingin sejak kemarin.",
      "Jadwal perawatan rutin sesuai kontrak. Cek tekanan freon dan bersihkan filter.",
      "Mohon telepon dulu sebelum datang. Parkir di basement.",
      "Unit outdoor berisik saat mulai menyala.",
      "Kantor 3 lantai, pengerjaan hanya Sabtu pagi.",
      "Pemasangan unit baru, pipa sudah disiapkan pelanggan.",
    ],
    notes: [
      "Sudah konfirmasi jadwal dengan pelanggan.",
      "Saluran pembuangan tersumbat, sudah dibersihkan.",
      "Pelanggan minta penawaran untuk unit kedua.",
      "Kapasitor diganti, AC dingin normal.",
      "Filter sangat kotor, disarankan cuci tiap 3 bulan.",
    ],
    holdNotes: ["Menunggu kiriman kapasitor.", "Pelanggan tidak di rumah, dijadwalkan ulang.", "Menunggu izin pengelola gedung."],
    equipmentTypes: [
      { type: "AC split", brands: ["Daikin", "Panasonic", "Sharp", "LG", "Gree"] },
      { type: "AC kaset", brands: ["Daikin", "Mitsubishi"] },
      { type: "AC standing", brands: ["Panasonic", "Samsung"] },
    ],
    taxRates: [{ name: "PPN", rate_bps: 1200, default: true }],
    monthly: [0.85, 0.85, 0.95, 1.05, 1.15, 1.2, 1.2, 1.25, 1.2, 1.1, 0.95, 0.85],
  },
];

export const ROOMS = ["the master bedroom", "the living room", "the office", "the nursery", "the garage"];
export const ROOMS_ID = ["utama", "anak", "tamu", "kerja"];

/** One-click demo sign-in accounts (AUTH-09). */
export const DEMO_LOGINS = {
  "acme-air": { owner: "olivia@acme-air.example", dispatcher: "dan@acme-air.example", technician: "tom@acme-air.example" },
  "acme-teknik": { owner: "siti@acme-teknik.example", dispatcher: "budi@acme-teknik.example", technician: "agus@acme-teknik.example" },
} as const;
export type DemoOrg = keyof typeof DEMO_LOGINS;
export type DemoRole = keyof (typeof DEMO_LOGINS)["acme-air"];
