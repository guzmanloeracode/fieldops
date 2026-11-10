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
  team: {
    name: string;
    role: "owner" | "admin" | "dispatcher" | "technician";
    skills?: string[];
    demo?: boolean;
  }[];
  customers: number;
  sites: number;
  equipment: number;
  jobs: number;
  serviceTypes: {
    name: string;
    duration: number;
    priceMajor: number;
    color: string;
    seasonal: number;
    /** Job titles ({n} and {room} are filled in), each with the request texts that go with it (two or more). */
    titles: { title: string; details: string[] }[];
    /** A fault the customer is waiting on: AI drafts may raise its priority. */
    fault?: boolean;
    /** Extra checks the AI suggests for this kind of job, and what it asks the customer. */
    checks: string[];
    questions: string[];
  }[];
  tags: string[];
  /** Access and billing notes on customers. */
  customerNotes: string[];
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
      {
        name: "AC tune-up",
        duration: 90,
        priceMajor: 129,
        color: "#0EA5E9",
        seasonal: 1.4,
        titles: [
          {
            title: "Seasonal AC tune-up",
            details: [
              "Annual maintenance under the service plan. Check refrigerant levels and clean the coils.",
              "Time for the yearly tune-up before it gets hot. No problems so far.",
              "Tune-up for the hallway unit. It runs fine but hasn't been serviced in two years.",
            ],
          },
          {
            title: "AC tune-up, {n} units",
            details: [
              "Every unit on the maintenance plan is due. Please do them in one visit.",
              "Tune-up for all the units in the house. Check the drain lines while you're there.",
            ],
          },
          {
            title: "Pre-summer AC check",
            details: [
              "We'd like the system checked before summer. It hummed a little at the end of last season.",
              "Pre-summer check, same as last year. The gate code is with the office.",
            ],
          },
        ],
        checks: [
          "Clean the condenser coil",
          "Check the condensate drain line",
          "Measure supply and return temperatures",
          "Replace the air filter",
        ],
        questions: [
          "When was the unit last serviced?",
          "Is the outdoor unit easy to reach?",
          "Is anyone home to let the technician in?",
        ],
      },
      {
        name: "AC repair",
        duration: 120,
        priceMajor: 189,
        color: "#F97316",
        seasonal: 1.6,
        fault: true,
        titles: [
          {
            title: "AC not cooling",
            details: [
              "Unit runs but the air isn't cold. Started after last week's heat.",
              "The house won't go below 80°F even with the AC on all day.",
            ],
          },
          {
            title: "Indoor unit leaking water",
            details: [
              "The bedroom unit is dripping water onto the floor. Smells musty.",
              "Water stain on the ceiling under the attic unit since yesterday.",
            ],
          },
          {
            title: "AC making a loud noise",
            details: [
              "Loud rattling noise from the outdoor unit when it starts up.",
              "Grinding sound from the indoor unit at night. It still cools.",
            ],
          },
          {
            title: "Thermostat not responding",
            details: [
              "Tenant says the thermostat screen is blank. Property manager will provide access.",
              "The thermostat shows the set temperature but the system never turns on.",
            ],
          },
          {
            title: "AC trips the breaker",
            details: [
              "The breaker trips a few minutes after the AC starts. We reset it twice.",
              "The AC shut off and the breaker won't stay on.",
            ],
          },
        ],
        checks: [
          "Check the outdoor unit's capacitor",
          "Measure supply and return temperatures",
          "Check the condensate drain line",
          "Photograph the unit's nameplate",
        ],
        questions: [
          "Is the unit still running?",
          "When did the problem start?",
          "Do you know the unit's brand or model?",
          "Is anyone home to let the technician in?",
        ],
      },
      {
        name: "AC installation",
        duration: 240,
        priceMajor: 1450,
        color: "#8B5CF6",
        seasonal: 1.1,
        titles: [
          {
            title: "Install new split system",
            details: [
              "Quote approved last week. Bring the new 3-ton system.",
              "New split system for the addition. The electrician already ran the circuit.",
            ],
          },
          {
            title: "Replace old condenser",
            details: [
              "Quote approved last week. Bring the new 2-ton condenser.",
              "The old condenser is 18 years old and failed. Replacement as quoted.",
            ],
          },
          {
            title: "Install mini-split in {room}",
            details: [
              "Mini-split as quoted. The customer wants the head unit above the window.",
              "Install as quoted. The wall is brick, so bring the right bits.",
            ],
          },
        ],
        checks: [
          "Confirm the circuit and breaker size",
          "Photograph the old unit's nameplate",
          "Check the pad and the line set route",
        ],
        questions: [
          "Has the quote been approved?",
          "Where should the indoor unit go?",
          "Is there parking for the van near the house?",
        ],
      },
      {
        name: "Refrigerant recharge",
        duration: 60,
        priceMajor: 159,
        color: "#14B8A6",
        seasonal: 1.5,
        fault: true,
        titles: [
          {
            title: "Refrigerant recharge",
            details: [
              "The last technician said the refrigerant was low. Please recharge and look for a leak.",
              "Second visit this season for the same unit. Check for a leak before recharging.",
            ],
          },
          {
            title: "Low refrigerant, ice on coil",
            details: [
              "Ice on the copper lines outside and the air is barely cool.",
              "The indoor coil is frozen. We turned the unit off this morning.",
            ],
          },
        ],
        checks: [
          "Leak-test the line set and coil",
          "Record pressures before and after",
          "Check the condensate drain line",
        ],
        questions: [
          "Is the unit turned off now?",
          "Has the unit been recharged before?",
          "Do you know the unit's brand or model?",
        ],
      },
      {
        name: "Duct cleaning",
        duration: 180,
        priceMajor: 349,
        color: "#64748B",
        seasonal: 0.9,
        titles: [
          {
            title: "Duct cleaning, whole house",
            details: [
              "Whole-house duct cleaning. We just finished a renovation and there's dust everywhere.",
              "Air is weak in the upstairs rooms and the vents are dusty. Possible duct leak.",
            ],
          },
          {
            title: "Musty smell from vents",
            details: [
              "Musty smell from the vents when the system starts.",
              "The smell gets worse after rain. Two kids with allergies in the house.",
            ],
          },
        ],
        checks: [
          "Inspect the return plenum",
          "Check the ducts for leaks and disconnections",
          "Photograph the vents before and after",
        ],
        questions: [
          "How many vents and returns are there?",
          "Is the attic easy to get into?",
          "Are there pets in the house?",
        ],
      },
      {
        name: "Commercial cleaning",
        duration: 240,
        priceMajor: 480,
        color: "#22C55E",
        seasonal: 0.8,
        titles: [
          {
            title: "Office deep clean",
            details: [
              "Office of 12 people, cleaning after hours only. Alarm code with the front desk.",
              "Deep clean of the break room, restrooms and carpets before a client visit.",
            ],
          },
          {
            title: "Weekly office cleaning",
            details: [
              "Weekly cleaning as agreed. Keys with building security.",
              "Regular weekly visit. Please empty the shredding bins too.",
            ],
          },
          {
            title: "Post-renovation cleaning",
            details: [
              "Construction dust on every surface after the remodel. Two floors.",
              "The contractors finish on Friday. Clean before the team moves back on Monday.",
            ],
          },
        ],
        checks: [
          "Confirm the access and alarm instructions",
          "Photograph the areas before and after",
          "Note any damage found before cleaning",
        ],
        questions: [
          "When can the team get in?",
          "How large is the space?",
          "Who holds the keys or the alarm code?",
        ],
      },
      {
        name: "Deep cleaning",
        duration: 180,
        priceMajor: 299,
        color: "#84CC16",
        seasonal: 0.8,
        titles: [
          {
            title: "Move-out deep clean",
            details: [
              "The tenant moved out on Friday. Full deep clean before the inspection.",
              "Move-out clean, including inside the oven and fridge. Lockbox on the front door.",
            ],
          },
          {
            title: "Kitchen and bathroom deep clean",
            details: [
              "Kitchen and both bathrooms. Grease build-up behind the stove.",
              "Deep clean of the kitchen and bathrooms before family visits next week.",
            ],
          },
        ],
        checks: [
          "Photograph the rooms before and after",
          "Note any damage found before cleaning",
          "Confirm the supplies needed on site",
        ],
        questions: [
          "How many rooms need cleaning?",
          "Are there pets in the house?",
          "Is anyone home to let the team in?",
        ],
      },
      {
        name: "Filter replacement",
        duration: 30,
        priceMajor: 59,
        color: "#EAB308",
        seasonal: 1,
        titles: [
          {
            title: "Filter replacement",
            details: [
              "The filter is due. The last one was very dirty.",
              "Please replace the filters. The size is written on the return grille.",
            ],
          },
          {
            title: "Quarterly filter change",
            details: [
              "Quarterly filter change under the maintenance plan.",
              "Quarterly visit. Two returns, one in the hallway and one upstairs.",
            ],
          },
        ],
        checks: [
          "Record the filter size and rating",
          "Check the condensate drain line",
          "Write the date on the new filter",
        ],
        questions: [
          "Do you know the filter size?",
          "How many returns does the house have?",
          "Is anyone home to let the technician in?",
        ],
      },
    ],
    tags: ["VIP", "Maintenance plan", "Property manager", "Pets on site", "Gate code", "Net 30"],
    customerNotes: [
      "Please call 30 minutes before arriving. Parking in the back lot.",
      "Gate code is with the office. Dog in the backyard.",
      "The property manager approves any work over $500.",
      "Prefers morning visits.",
      "Office of 12 people, after-hours access only. Alarm code with the front desk.",
      "Tenant-occupied. Contact the tenant for access.",
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
    holdNotes: [
      "Waiting for a replacement fan motor.",
      "Customer not home, will call back.",
      "Waiting for building access.",
    ],
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
      {
        name: "Cuci AC",
        duration: 60,
        priceMajor: 85_000,
        color: "#0EA5E9",
        seasonal: 1.3,
        titles: [
          {
            title: "Cuci AC {n} unit",
            details: [
              "Mohon cuci semua unit sekalian dalam satu kunjungan.",
              "Cuci AC di kamar dan ruang tamu. Terakhir dicuci enam bulan lalu.",
            ],
          },
          {
            title: "Cuci AC rutin",
            details: [
              "Jadwal perawatan rutin sesuai kontrak. Cek tekanan freon dan bersihkan filter.",
              "Cuci rutin tiga bulanan. Mohon telepon dulu sebelum datang.",
            ],
          },
          {
            title: "AC kurang dingin, minta dicuci",
            details: [
              "AC menyala tapi kurang dingin, sepertinya sudah lama tidak dicuci.",
              "Filter berdebu dan dinginnya berkurang sejak bulan lalu.",
            ],
          },
        ],
        checks: [
          "Periksa saluran pembuangan air",
          "Ukur suhu udara keluar",
          "Bersihkan filter dan evaporator",
        ],
        questions: [
          "Berapa unit yang perlu dicuci?",
          "Kapan terakhir AC dicuci?",
          "Apakah ada orang di rumah untuk membukakan pintu?",
        ],
      },
      {
        name: "Perbaikan AC",
        duration: 120,
        priceMajor: 250_000,
        color: "#F97316",
        seasonal: 1.2,
        fault: true,
        titles: [
          {
            title: "AC bocor air",
            details: [
              "AC di kamar tidur meneteskan air dan baunya apek.",
              "Air menetes dari unit indoor ke lantai sejak kemarin.",
            ],
          },
          {
            title: "AC tidak dingin",
            details: [
              "AC menyala tapi tidak dingin sejak kemarin.",
              "Sudah disetel 18 derajat tapi ruangan tetap panas.",
            ],
          },
          {
            title: "Remote AC tidak berfungsi",
            details: [
              "Baterai remote sudah diganti tapi AC tidak merespons.",
              "AC tidak bisa dinyalakan dari remote, lampu indikator berkedip.",
            ],
          },
          {
            title: "AC berisik",
            details: [
              "Unit outdoor berisik saat mulai menyala.",
              "Ada bunyi berderak dari unit indoor di malam hari.",
            ],
          },
        ],
        checks: [
          "Periksa kapasitor unit outdoor",
          "Ukur suhu udara keluar",
          "Periksa saluran pembuangan air",
          "Foto pelat nama unit",
        ],
        questions: [
          "Apakah unit masih menyala?",
          "Sejak kapan masalahnya terjadi?",
          "Apakah tahu merek atau tipe unitnya?",
        ],
      },
      {
        name: "Pasang AC baru",
        duration: 180,
        priceMajor: 450_000,
        color: "#8B5CF6",
        seasonal: 1.1,
        titles: [
          {
            title: "Pasang AC baru 1 PK",
            details: [
              "Pemasangan unit baru, pipa sudah disiapkan pelanggan.",
              "Unit sudah dibeli, mohon dipasang beserta bracket outdoor.",
            ],
          },
          {
            title: "Pasang AC di kamar {room}",
            details: [
              "Pasang AC baru sesuai penawaran. Dinding bata, jalur pipa lewat atas jendela.",
              "Unit baru sudah di lokasi, mohon bawa pipa tiga meter.",
            ],
          },
        ],
        checks: [
          "Pastikan daya listrik dan MCB cukup",
          "Cek jalur pipa dan posisi unit outdoor",
          "Foto posisi pemasangan",
        ],
        questions: [
          "Unit sudah dibeli atau perlu dibawakan?",
          "Di mana posisi unit indoor yang diinginkan?",
          "Berapa daya listrik rumah?",
        ],
      },
      {
        name: "Isi freon",
        duration: 60,
        priceMajor: 200_000,
        color: "#14B8A6",
        seasonal: 1.2,
        fault: true,
        titles: [
          {
            title: "Isi freon R32",
            details: [
              "AC tidak dingin, teknisi sebelumnya bilang freonnya habis.",
              "Isi freon R32 dan cek kebocoran, kunjungan kedua bulan ini.",
            ],
          },
          {
            title: "Tambah freon",
            details: [
              "Dinginnya berkurang, minta dicek tekanan freon.",
              "Ada bunga es di pipa unit outdoor.",
            ],
          },
        ],
        checks: [
          "Cek kebocoran pada pipa dan sambungan",
          "Catat tekanan freon sebelum dan sesudah",
          "Periksa saluran pembuangan air",
        ],
        questions: [
          "Apakah AC sudah pernah diisi freon?",
          "Apakah tahu jenis freon unitnya?",
          "Apakah ada orang di rumah untuk membukakan pintu?",
        ],
      },
      {
        name: "Bongkar pasang AC",
        duration: 150,
        priceMajor: 350_000,
        color: "#64748B",
        seasonal: 0.9,
        titles: [
          {
            title: "Bongkar pasang AC pindahan",
            details: [
              "Pindah rumah minggu depan. Bongkar dua unit dan pasang di alamat baru.",
              "Bongkar AC di apartemen lama, pasang di rumah baru di Bekasi.",
            ],
          },
          {
            title: "Relokasi unit outdoor",
            details: [
              "Unit outdoor perlu dipindah karena renovasi teras.",
              "Pindahkan unit outdoor ke dak belakang, pipanya perlu ditambah.",
            ],
          },
        ],
        checks: [
          "Vakum freon sebelum dibongkar",
          "Cek panjang pipa yang dibutuhkan",
          "Foto posisi lama dan baru",
        ],
        questions: [
          "Berapa unit yang dipindahkan?",
          "Apakah lokasi baru sudah siap?",
          "Apakah ada akses tangga ke unit outdoor?",
        ],
      },
      {
        name: "Perawatan gedung",
        duration: 240,
        priceMajor: 1_500_000,
        color: "#22C55E",
        seasonal: 0.8,
        titles: [
          {
            title: "Perawatan AC kantor bulanan",
            details: [
              "Kantor tiga lantai, pengerjaan hanya Sabtu pagi.",
              "Perawatan bulanan sesuai kontrak, 14 unit split.",
            ],
          },
          {
            title: "Servis berkala ruko",
            details: [
              "Servis berkala ruko dua lantai, toko buka jam 9.",
              "Jadwal servis berkala. Kunci ruang mesin ada di satpam.",
            ],
          },
        ],
        checks: ["Catat kondisi tiap unit", "Periksa saluran pembuangan air", "Bersihkan filter semua unit"],
        questions: [
          "Berapa unit yang perlu diservis?",
          "Jam berapa tim bisa mulai bekerja?",
          "Siapa yang memegang kunci ruang mesin?",
        ],
      },
    ],
    tags: ["Pelanggan tetap", "Kontrak perawatan", "Kantor", "Apartemen", "Bayar tempo"],
    customerNotes: [
      "Mohon telepon dulu sebelum datang. Parkir di basement.",
      "Kunci pagar dititipkan ke tetangga sebelah.",
      "Kantor tiga lantai, pengerjaan hanya Sabtu pagi.",
      "Pembayaran lewat transfer setelah pekerjaan selesai.",
      "Ada anjing di halaman belakang.",
    ],
    notes: [
      "Sudah konfirmasi jadwal dengan pelanggan.",
      "Saluran pembuangan tersumbat, sudah dibersihkan.",
      "Pelanggan minta penawaran untuk unit kedua.",
      "Kapasitor diganti, AC dingin normal.",
      "Filter sangat kotor, disarankan cuci tiap 3 bulan.",
    ],
    holdNotes: [
      "Menunggu kiriman kapasitor.",
      "Pelanggan tidak di rumah, dijadwalkan ulang.",
      "Menunggu izin pengelola gedung.",
    ],
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
  "acme-air": {
    owner: "olivia@acme-air.example",
    dispatcher: "dan@acme-air.example",
    technician: "tom@acme-air.example",
  },
  "acme-teknik": {
    owner: "siti@acme-teknik.example",
    dispatcher: "budi@acme-teknik.example",
    technician: "agus@acme-teknik.example",
  },
} as const;
export type DemoOrg = keyof typeof DEMO_LOGINS;
export type DemoRole = keyof (typeof DEMO_LOGINS)["acme-air"];
