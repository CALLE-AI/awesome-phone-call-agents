// Matter types: what the client can pick on the form, what the call asks for each, and what it must return.
// Each type adds its own questions and result fields on top of the common intake (name, summary, other parties,
// urgency, best time, email, consent). Languages: en, es, id. Keep questions factual — never legal advice.

export const MATTERS = {
  real_estate: {
    icon: "🏠",
    label: { en: "Real estate", es: "Bienes raíces", id: "Properti" },
    blurb: {
      en: "Buying, selling, leasing, landlord–tenant, closings, title problems.",
      es: "Compra, venta, alquiler, arrendador–inquilino, cierres, problemas de título.",
      id: "Jual beli, sewa, pemilik–penyewa, penutupan transaksi, masalah sertifikat.",
    },
    questions: {
      en: `For this real-estate matter also learn: the property address (street and city is enough); whether they are buying, selling, renting out, renting, or something else; whether a contract or lease has already been signed; the other party (buyer, seller, landlord, tenant, agent, or company); and any closing date, move-out date, or deadline.`,
      es: `Para este asunto de bienes raíces averigua también: la dirección de la propiedad (calle y ciudad basta); si está comprando, vendiendo, alquilando como dueño, alquilando como inquilino, u otra cosa; si ya se firmó un contrato o arrendamiento; la otra parte (comprador, vendedor, arrendador, inquilino, agente o empresa); y cualquier fecha de cierre, de desalojo o plazo.`,
      id: `Untuk perkara properti ini cari tahu juga: alamat properti (jalan dan kota cukup); apakah ia membeli, menjual, menyewakan, menyewa, atau lainnya; apakah kontrak atau perjanjian sewa sudah ditandatangani; pihak lain (pembeli, penjual, pemilik, penyewa, agen, atau perusahaan); dan tanggal penutupan, tanggal pindah, atau tenggat waktu apa pun.`,
    },
    fields: {
      property_address: { type: "string", description: "Street and city, as stated, or 'unknown'" },
      role: { type: "string", enum: ["buyer", "seller", "landlord", "tenant", "other", "unknown"] },
      contract_signed: { type: "string", enum: ["yes", "no", "unknown"] },
      key_date: { type: "string", description: "Closing, move-out or other deadline, verbatim, or 'none'" },
    },
  },

  will: {
    icon: "📜",
    label: { en: "Will", es: "Testamento", id: "Surat wasiat" },
    blurb: {
      en: "Write or update a will, name an executor or guardian, plan for your family.",
      es: "Redactar o actualizar un testamento, nombrar albacea o tutor, planificar para su familia.",
      id: "Membuat atau memperbarui wasiat, menunjuk pelaksana atau wali, merencanakan untuk keluarga.",
    },
    questions: {
      en: `For this will also learn: whether it is for themselves or for someone else (and who); whether they already have a will that needs updating; whether they are married or have a partner, and whether they have children (how many, and whether any are minors); whether they own a home or a business; and whether they have someone in mind to serve as executor. Do not ask about the value of assets or about health.`,
      es: `Para este testamento averigua también: si es para sí mismo o para otra persona (y quién); si ya tiene un testamento que necesita actualizar; si está casado o tiene pareja, y si tiene hijos (cuántos y si alguno es menor de edad); si es dueño de una casa o un negocio; y si tiene a alguien en mente como albacea. No preguntes por el valor de los bienes ni por temas de salud.`,
      id: `Untuk wasiat ini cari tahu juga: apakah untuk dirinya sendiri atau orang lain (dan siapa); apakah sudah ada wasiat yang perlu diperbarui; apakah ia menikah atau memiliki pasangan, dan apakah memiliki anak (berapa, dan apakah ada yang masih di bawah umur); apakah ia memiliki rumah atau usaha; dan apakah sudah ada orang yang ingin ditunjuk sebagai pelaksana wasiat. Jangan menanyakan nilai aset atau kesehatan.`,
    },
    fields: {
      for_whom: { type: "string", description: "'self' or the relationship of the person it is for" },
      existing_will: { type: "string", enum: ["yes", "no", "unknown"] },
      family: { type: "string", description: "Married/partner and children count, minors noted, as stated" },
      owns_home_or_business: { type: "string", enum: ["home", "business", "both", "neither", "unknown"] },
      executor_in_mind: { type: "string", enum: ["yes", "no", "unknown"] },
    },
  },

  trust: {
    icon: "🛡️",
    label: { en: "Trust", es: "Fideicomiso", id: "Trust (perwalian aset)" },
    blurb: {
      en: "Set up or change a living trust, protect property, provide for a family member.",
      es: "Crear o modificar un fideicomiso en vida, proteger bienes, proveer para un familiar.",
      id: "Membuat atau mengubah trust, melindungi aset, menafkahi anggota keluarga.",
    },
    questions: {
      en: `For this trust also learn: what they hope the trust will do, in their words (for example avoid probate, protect a house, provide for a child or relative); who the beneficiaries would be, by relationship only; whether they already have a will or trust; and what kinds of property they want to place in it (home, savings, business, other) — categories only, never amounts.`,
      es: `Para este fideicomiso averigua también: qué espera que logre el fideicomiso, en sus palabras (por ejemplo evitar la sucesión, proteger una casa, proveer para un hijo o familiar); quiénes serían los beneficiarios, solo por relación; si ya tiene un testamento o fideicomiso; y qué tipo de bienes quiere incluir (casa, ahorros, negocio, otro) — solo categorías, nunca montos.`,
      id: `Untuk trust ini cari tahu juga: apa yang ia harapkan dari trust tersebut, dengan kata-katanya sendiri (misalnya menghindari probate, melindungi rumah, menafkahi anak atau kerabat); siapa penerima manfaatnya, cukup hubungannya saja; apakah sudah ada wasiat atau trust; dan jenis harta apa yang ingin dimasukkan (rumah, tabungan, usaha, lainnya) — kategori saja, jangan pernah nominal.`,
    },
    fields: {
      goal: { type: "string", description: "What they want the trust to accomplish, in their words" },
      beneficiaries: { type: "string", description: "Relationships only (e.g. 'two children, spouse')" },
      existing_plan: { type: "string", enum: ["will", "trust", "both", "none", "unknown"] },
      asset_types: { type: "string", description: "Categories only: home, savings, business, other" },
    },
  },

  lawsuit: {
    icon: "⚖️",
    label: { en: "Lawsuit", es: "Demanda", id: "Gugatan" },
    blurb: {
      en: "You want to sue, you've been sued, or you got court papers.",
      es: "Quiere demandar, lo demandaron, o recibió papeles de la corte.",
      id: "Ingin menggugat, digugat, atau menerima surat dari pengadilan.",
    },
    questions: {
      en: `For this lawsuit also learn: whether they want to sue someone or are being sued; who the other side is (person or company) — the firm needs this for a conflict check; what happened, briefly, and roughly when; whether they have received any court papers, and if so what the papers say the deadline is; and which court or county, if they know. If they have papers with a deadline, mark it urgent.`,
      es: `Para esta demanda averigua también: si quiere demandar a alguien o lo están demandando; quién es la otra parte (persona o empresa) — el despacho lo necesita para verificar conflictos; qué pasó, brevemente, y aproximadamente cuándo; si ha recibido papeles de la corte y, de ser así, qué plazo indican; y en qué corte o condado, si lo sabe. Si tiene papeles con un plazo, márcalo como urgente.`,
      id: `Untuk gugatan ini cari tahu juga: apakah ia ingin menggugat seseorang atau sedang digugat; siapa pihak lawan (orang atau perusahaan) — firma memerlukannya untuk pemeriksaan benturan kepentingan; apa yang terjadi, secara singkat, dan kira-kira kapan; apakah ia sudah menerima surat pengadilan, dan jika ya tenggat waktu apa yang tertulis; dan pengadilan atau wilayah mana, jika tahu. Jika ada surat dengan tenggat waktu, tandai sebagai mendesak.`,
    },
    fields: {
      side: { type: "string", enum: ["plaintiff", "defendant", "unknown"], description: "Suing = plaintiff; being sued = defendant" },
      incident_when: { type: "string", description: "Approximate date of what happened, verbatim, or 'unknown'" },
      court_papers_received: { type: "string", enum: ["yes", "no", "unknown"] },
      papers_deadline: { type: "string", description: "Deadline stated on the papers, verbatim, or 'none'" },
      court_or_county: { type: "string", description: "As stated, or 'unknown'" },
    },
  },

  other: {
    icon: "💬",
    label: { en: "Something else", es: "Otro asunto", id: "Hal lain" },
    blurb: {
      en: "Contracts, business, employment, family, or you're not sure — we'll ask.",
      es: "Contratos, negocios, laboral, familia, o no está seguro — le preguntaremos.",
      id: "Kontrak, bisnis, ketenagakerjaan, keluarga, atau belum yakin — kami akan bertanya.",
    },
    questions: { en: "", es: "", id: "" },
    fields: {},
  },
};

export const MATTER_IDS = Object.keys(MATTERS);
export function matter(id) { return MATTERS[MATTER_IDS.includes(id) ? id : "other"]; }

// Public, language-independent view for the form and the review page.
export function mattersForClient() {
  return Object.fromEntries(Object.entries(MATTERS).map(([id, m]) => [id, {
    icon: m.icon, label: m.label, blurb: m.blurb, fields: Object.keys(m.fields),
  }]));
}
