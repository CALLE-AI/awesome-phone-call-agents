export interface TimeSlot {
  id: string;
  label: string;
  time: string;
  startHour: number;
  endHour: number;
  priceBase: number;
  isPrime: boolean;
  availability: "available" | "limited" | "full";
  slotsLeft?: number;
}

/* `name` and `host` are gone. They carried an invented show title and an
   invented presenter, attributed to a real, named radio station - the same
   objection that deleted the Review type above: a person said to work
   somewhere did not say so. What a media buyer books is the DAYPART, which is
   `genre` plus the hours, and that is a category rather than a claim about
   anybody's staff. */
export interface Show {
  time: string;
  genre: string;
  startHour: number;
  endHour: number;
  type: "prime" | "standard" | "offpeak";
}

/* The Review type is gone. It held testimonials attributed to named brands -
   Khaadi and others, with quoted text and dates - for campaigns that never ran.
   A rating can at least be argued about as an estimate; a quote is a statement
   someone is said to have made, and they did not make it. There is no review
   system in this product and nothing to estimate from. */

/* `about` is gone. Each station carried three paragraphs we wrote about a real
   company - superlatives about its standing, claims about which
   neighbourhoods and demographics it dominates, and how its programmes rank
   nationally - with no source for any of it. Same objection as the
   presenters and the reviews before them: a claim about a real business is a
   statement, and nobody made it.

   The station page now states what the catalogue actually holds - frequency,
   cities, format, language, and figures labelled as estimates - assembled at
   render time. There is no field for free prose to come back into. */
export interface Station {
  id: string;
  name: string;
  city: string;
  allCities: string[];
  frequency: string;
  genre: string;
  genreKeys: string[];
  language: string[];
  dailyListeners: number;
  peakTimes: string[];
  ageRange: string;
  genderFemale: number;
  socioeconomic: string;
  priceMin: number;
  priceMax: number;
  initials: string;
  bestFor: string[];
  slotsAvailable: number;
  slotStatus: "available" | "filling" | "limited";
  demographics: {
    age: { label: string; value: number }[];
    genderFemale: number;
    income: string;
    cityBreakdown: { city: string; pct: number }[];
    topLanguages: string[];
  };
  shows: Show[];
  slots: TimeSlot[];
}

export const STATIONS: Station[] = [
  {
    id: "city-fm-89-khi",
    name: "City FM 89",
    city: "Karachi",
    allCities: ["Karachi"],
    frequency: "89.0 MHz",
    genre: "Pop / Contemporary",
    genreKeys: ["music", "entertainment"],
    language: ["Urdu", "English"],
    dailyListeners: 2100000,
    peakTimes: ["7–9am", "5–7pm"],
    ageRange: "18–35",
    genderFemale: 60,
    socioeconomic: "ABC1",
    priceMin: 8000,
    priceMax: 22000,
    initials: "89",
    bestFor: ["FMCG", "Consumer Brands", "Telecom", "Fashion"],
    slotsAvailable: 15,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "18–24", value: 28 },
        { label: "25–34", value: 41 },
        { label: "35–44", value: 22 },
        { label: "45+", value: 9 },
      ],
      genderFemale: 60,
      income: "Upper-middle to high income (SEC A/B)",
      cityBreakdown: [
        { city: "DHA / Clifton", pct: 38 },
        { city: "Gulshan-e-Iqbal", pct: 24 },
        { city: "North Karachi", pct: 18 },
        { city: "Other Karachi", pct: 20 },
      ],
      topLanguages: ["Urdu", "English", "Sindhi"],
    },
    shows: [
      { time: "6:00–9:00 AM", genre: "Breakfast / Morning Drive", startHour: 6, endHour: 9, type: "prime" },
      { time: "9:00 AM–12:00 PM", genre: "Music / Requests", startHour: 9, endHour: 12, type: "standard" },
      { time: "12:00–2:00 PM", genre: "Talk / Entertainment", startHour: 12, endHour: 14, type: "standard" },
      { time: "2:00–5:00 PM", genre: "Music / Lifestyle", startHour: 14, endHour: 17, type: "standard" },
      { time: "5:00–7:00 PM", genre: "Evening Drive / Top 10", startHour: 17, endHour: 19, type: "prime" },
      { time: "9:00–11:00 PM", genre: "Electronic / Chill", startHour: 21, endHour: 23, type: "offpeak" },
    ],
    slots: [
      { id: "s1-morning-drive", label: "⚡ Morning Drive", time: "7–9am", startHour: 7, endHour: 9, priceBase: 22000, isPrime: true, availability: "available" },
      { id: "s1-mid-morning", label: "Mid Morning", time: "9am–12pm", startHour: 9, endHour: 12, priceBase: 14000, isPrime: false, availability: "available" },
      { id: "s1-afternoon", label: "Afternoon", time: "12–3pm", startHour: 12, endHour: 15, priceBase: 10000, isPrime: false, availability: "limited", slotsLeft: 2 },
      { id: "s1-late-afternoon", label: "Late Afternoon", time: "3–5pm", startHour: 15, endHour: 17, priceBase: 12000, isPrime: false, availability: "available" },
      { id: "s1-evening-drive", label: "⚡ Evening Drive", time: "5–7pm", startHour: 17, endHour: 19, priceBase: 20000, isPrime: true, availability: "available" },
      { id: "s1-night", label: "Night", time: "7–10pm", startHour: 19, endHour: 22, priceBase: 8000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "fm-101-national",
    name: "FM 101",
    city: "Karachi",
    allCities: ["Karachi", "Lahore", "Islamabad"],
    frequency: "101.0 MHz",
    genre: "Music / Entertainment",
    genreKeys: ["music", "entertainment"],
    language: ["Urdu"],
    dailyListeners: 1800000,
    peakTimes: ["7–9am", "5–8pm"],
    ageRange: "15–28",
    genderFemale: 50,
    socioeconomic: "B/C",
    priceMin: 6000,
    priceMax: 18000,
    initials: "101",
    bestFor: ["FMCG", "Telecom", "Entertainment", "Youth Brands"],
    slotsAvailable: 22,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "15–18", value: 22 },
        { label: "19–24", value: 38 },
        { label: "25–34", value: 28 },
        { label: "35+", value: 12 },
      ],
      genderFemale: 50,
      income: "Middle income (SEC B/C)",
      cityBreakdown: [
        { city: "Karachi", pct: 42 },
        { city: "Lahore", pct: 35 },
        { city: "Islamabad", pct: 23 },
      ],
      topLanguages: ["Urdu"],
    },
    shows: [
      { time: "6:00–9:00 AM", genre: "Breakfast Show", startHour: 6, endHour: 9, type: "prime" },
      { time: "9:00 AM–1:00 PM", genre: "Pop Hits / Countdown", startHour: 9, endHour: 13, type: "standard" },
      { time: "1:00–4:00 PM", genre: "Talk / Listener Requests", startHour: 13, endHour: 16, type: "standard" },
      { time: "5:00–8:00 PM", genre: "Evening Drive / Top 20", startHour: 17, endHour: 20, type: "prime" },
      { time: "10:00 PM–12:00 AM", genre: "Late Night / Chill", startHour: 22, endHour: 24, type: "offpeak" },
    ],
    slots: [
      { id: "s2-morning-drive", label: "⚡ Morning Drive", time: "7–9am", startHour: 7, endHour: 9, priceBase: 18000, isPrime: true, availability: "available" },
      { id: "s2-mid-morning", label: "Mid Morning", time: "9am–12pm", startHour: 9, endHour: 12, priceBase: 10000, isPrime: false, availability: "available" },
      { id: "s2-afternoon", label: "Afternoon", time: "12–3pm", startHour: 12, endHour: 15, priceBase: 8000, isPrime: false, availability: "available" },
      { id: "s2-late-afternoon", label: "Late Afternoon", time: "3–5pm", startHour: 15, endHour: 17, priceBase: 9000, isPrime: false, availability: "available" },
      { id: "s2-evening-drive", label: "⚡ Evening Drive", time: "5–8pm", startHour: 17, endHour: 20, priceBase: 16000, isPrime: true, availability: "limited", slotsLeft: 3 },
      { id: "s2-night", label: "Night", time: "8–11pm", startHour: 20, endHour: 23, priceBase: 6000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "fm-100-khi",
    name: "FM 100",
    city: "Karachi",
    allCities: ["Karachi"],
    frequency: "100.0 MHz",
    genre: "Talk / News / Entertainment",
    genreKeys: ["news", "entertainment"],
    language: ["Urdu"],
    dailyListeners: 1400000,
    peakTimes: ["7–9am", "12–2pm"],
    ageRange: "25–45",
    genderFemale: 45,
    socioeconomic: "A/B",
    priceMin: 7500,
    priceMax: 20000,
    initials: "100",
    bestFor: ["Banking", "Real Estate", "Automotive", "B2B"],
    slotsAvailable: 9,
    slotStatus: "filling",
    demographics: {
      age: [
        { label: "18–24", value: 12 },
        { label: "25–34", value: 35 },
        { label: "35–44", value: 33 },
        { label: "45+", value: 20 },
      ],
      genderFemale: 45,
      income: "Upper income (SEC A/B)",
      cityBreakdown: [
        { city: "Clifton / DHA", pct: 45 },
        { city: "PECHS / Gulshan", pct: 30 },
        { city: "Other Karachi", pct: 25 },
      ],
      topLanguages: ["Urdu", "English"],
    },
    shows: [
      { time: "6:00–9:00 AM", genre: "Morning News & Talk", startHour: 6, endHour: 9, type: "prime" },
      { time: "9:00 AM–12:00 PM", genre: "Current Affairs", startHour: 9, endHour: 12, type: "standard" },
      { time: "12:00–2:00 PM", genre: "Lifestyle / Talk", startHour: 12, endHour: 14, type: "standard" },
      { time: "4:00–7:00 PM", genre: "Evening Drive / Analysis", startHour: 16, endHour: 19, type: "prime" },
      { time: "9:00–11:00 PM", genre: "Entertainment / Celeb", startHour: 21, endHour: 23, type: "offpeak" },
    ],
    slots: [
      { id: "s3-morning-drive", label: "⚡ Morning Drive", time: "7–9am", startHour: 7, endHour: 9, priceBase: 20000, isPrime: true, availability: "available" },
      { id: "s3-mid-morning", label: "Mid Morning", time: "9am–12pm", startHour: 9, endHour: 12, priceBase: 12000, isPrime: false, availability: "available" },
      { id: "s3-lunch", label: "Lunch Hour", time: "12–2pm", startHour: 12, endHour: 14, priceBase: 13000, isPrime: false, availability: "limited", slotsLeft: 2 },
      { id: "s3-afternoon", label: "Afternoon", time: "2–4pm", startHour: 14, endHour: 16, priceBase: 9000, isPrime: false, availability: "available" },
      { id: "s3-evening-drive", label: "⚡ Evening Drive", time: "4–7pm", startHour: 16, endHour: 19, priceBase: 18000, isPrime: true, availability: "limited", slotsLeft: 1 },
      { id: "s3-night", label: "Night", time: "7–10pm", startHour: 19, endHour: 22, priceBase: 7500, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "mast-fm-103-lhr",
    name: "Mast FM 103",
    city: "Lahore",
    allCities: ["Lahore"],
    frequency: "103.0 MHz",
    genre: "Punjabi / Regional",
    genreKeys: ["music", "punjabi"],
    language: ["Punjabi", "Urdu"],
    dailyListeners: 1900000,
    peakTimes: ["7–10am", "5–8pm"],
    ageRange: "25–50",
    genderFemale: 52,
    socioeconomic: "B/C",
    priceMin: 9000,
    priceMax: 25000,
    initials: "103",
    bestFor: ["FMCG", "Food & Beverage", "Pharma", "Local Brands"],
    slotsAvailable: 8,
    slotStatus: "filling",
    demographics: {
      age: [
        { label: "18–24", value: 18 },
        { label: "25–34", value: 32 },
        { label: "35–44", value: 31 },
        { label: "45+", value: 19 },
      ],
      genderFemale: 52,
      income: "Middle income (SEC B/C)",
      cityBreakdown: [
        { city: "Lahore Metro", pct: 71 },
        { city: "Sheikhupura", pct: 14 },
        { city: "Gujranwala", pct: 15 },
      ],
      topLanguages: ["Punjabi", "Urdu"],
    },
    shows: [
      { time: "6:00–10:00 AM", genre: "Punjabi Morning Show", startHour: 6, endHour: 10, type: "prime" },
      { time: "10:00 AM–1:00 PM", genre: "Punjabi Hits / Folk", startHour: 10, endHour: 13, type: "standard" },
      { time: "1:00–3:00 PM", genre: "Women / Lifestyle", startHour: 13, endHour: 15, type: "standard" },
      { time: "5:00–8:00 PM", genre: "Evening Drive / Punjabi Pop", startHour: 17, endHour: 20, type: "prime" },
      { time: "10:00 PM–12:00 AM", genre: "Chill / Acoustic", startHour: 22, endHour: 24, type: "offpeak" },
    ],
    slots: [
      { id: "s4-morning-drive", label: "⚡ Morning Drive", time: "7–10am", startHour: 7, endHour: 10, priceBase: 25000, isPrime: true, availability: "limited", slotsLeft: 2 },
      { id: "s4-mid-morning", label: "Mid Morning", time: "10am–1pm", startHour: 10, endHour: 13, priceBase: 15000, isPrime: false, availability: "available" },
      { id: "s4-afternoon", label: "Afternoon", time: "1–5pm", startHour: 13, endHour: 17, priceBase: 11000, isPrime: false, availability: "available" },
      { id: "s4-evening-drive", label: "⚡ Evening Drive", time: "5–8pm", startHour: 17, endHour: 20, priceBase: 22000, isPrime: true, availability: "limited", slotsLeft: 3 },
      { id: "s4-night", label: "Night", time: "8–11pm", startHour: 20, endHour: 23, priceBase: 9000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "radio-pakistan-national",
    name: "Radio Pakistan",
    city: "Islamabad",
    allCities: ["Islamabad", "Karachi", "Lahore", "Peshawar", "Quetta", "Faisalabad"],
    frequency: "Multiple",
    genre: "News / Public Affairs",
    genreKeys: ["news"],
    language: ["Urdu", "Regional"],
    dailyListeners: 4200000,
    peakTimes: ["7–9am", "1–2pm"],
    ageRange: "30–60",
    genderFemale: 48,
    socioeconomic: "All segments",
    priceMin: 4000,
    priceMax: 12000,
    initials: "RP",
    bestFor: ["Government", "Pharma", "Agriculture", "Banking"],
    slotsAvailable: 41,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "18–24", value: 14 },
        { label: "25–34", value: 26 },
        { label: "35–44", value: 31 },
        { label: "45+", value: 29 },
      ],
      genderFemale: 48,
      income: "All income segments",
      cityBreakdown: [
        { city: "Small cities / towns", pct: 48 },
        { city: "Karachi", pct: 18 },
        { city: "Lahore", pct: 16 },
        { city: "Other majors", pct: 18 },
      ],
      topLanguages: ["Urdu", "Punjabi", "Sindhi", "Pashto"],
    },
    shows: [
      { time: "7:00–9:00 AM", genre: "News & Analysis", startHour: 7, endHour: 9, type: "prime" },
      { time: "9:00 AM–12:00 PM", genre: "Talk / Current Affairs", startHour: 9, endHour: 12, type: "standard" },
      { time: "1:00–2:00 PM", genre: "News", startHour: 13, endHour: 14, type: "standard" },
      { time: "5:00–7:00 PM", genre: "Culture / Drama", startHour: 17, endHour: 19, type: "standard" },
      { time: "9:00–10:00 PM", genre: "News", startHour: 21, endHour: 22, type: "offpeak" },
    ],
    slots: [
      { id: "s5-morning-drive", label: "⚡ Morning Drive", time: "7–9am", startHour: 7, endHour: 9, priceBase: 12000, isPrime: true, availability: "available" },
      { id: "s5-mid-morning", label: "Mid Morning", time: "9am–12pm", startHour: 9, endHour: 12, priceBase: 7000, isPrime: false, availability: "available" },
      { id: "s5-midday", label: "Midday", time: "12–2pm", startHour: 12, endHour: 14, priceBase: 8000, isPrime: false, availability: "available" },
      { id: "s5-afternoon", label: "Afternoon", time: "2–5pm", startHour: 14, endHour: 17, priceBase: 5000, isPrime: false, availability: "available" },
      { id: "s5-evening", label: "Evening", time: "5–8pm", startHour: 17, endHour: 20, priceBase: 9000, isPrime: false, availability: "available" },
      { id: "s5-night", label: "Night", time: "8–10pm", startHour: 20, endHour: 22, priceBase: 4000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "fm-91-lhr",
    name: "FM 91 Lahore",
    city: "Lahore",
    allCities: ["Lahore"],
    frequency: "91.0 MHz",
    genre: "Music / Entertainment",
    genreKeys: ["music", "entertainment"],
    language: ["Urdu"],
    dailyListeners: 1100000,
    peakTimes: ["8–10am", "6–8pm"],
    ageRange: "18–32",
    genderFemale: 54,
    socioeconomic: "B/C",
    priceMin: 5000,
    priceMax: 15000,
    initials: "91",
    bestFor: ["Fashion", "Beauty", "Youth Brands", "Music"],
    slotsAvailable: 18,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "15–18", value: 19 },
        { label: "19–24", value: 42 },
        { label: "25–32", value: 28 },
        { label: "33+", value: 11 },
      ],
      genderFemale: 54,
      income: "Middle income (SEC B/C)",
      cityBreakdown: [
        { city: "Gulberg / Model Town", pct: 41 },
        { city: "Johar Town / Bahria", pct: 33 },
        { city: "Old Lahore", pct: 26 },
      ],
      topLanguages: ["Urdu", "Punjabi"],
    },
    shows: [
      { time: "7:00–10:00 AM", genre: "Youth Morning", startHour: 7, endHour: 10, type: "prime" },
      { time: "10:00 AM–2:00 PM", genre: "Music Countdown", startHour: 10, endHour: 14, type: "standard" },
      { time: "6:00–8:00 PM", genre: "Evening Drive", startHour: 18, endHour: 20, type: "prime" },
      { time: "10:00 PM–12:00 AM", genre: "Late Night Chill", startHour: 22, endHour: 24, type: "offpeak" },
    ],
    slots: [
      { id: "s6-morning-drive", label: "⚡ Morning Drive", time: "8–10am", startHour: 8, endHour: 10, priceBase: 15000, isPrime: true, availability: "available" },
      { id: "s6-mid-morning", label: "Mid Morning", time: "10am–2pm", startHour: 10, endHour: 14, priceBase: 8000, isPrime: false, availability: "available" },
      { id: "s6-afternoon", label: "Afternoon", time: "2–6pm", startHour: 14, endHour: 18, priceBase: 6000, isPrime: false, availability: "available" },
      { id: "s6-evening-drive", label: "⚡ Evening Drive", time: "6–8pm", startHour: 18, endHour: 20, priceBase: 13000, isPrime: true, availability: "available" },
      { id: "s6-night", label: "Night", time: "8–11pm", startHour: 20, endHour: 23, priceBase: 5000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "samaa-fm",
    name: "Samaa FM",
    city: "Karachi",
    allCities: ["Karachi", "Lahore", "Islamabad"],
    frequency: "107.4 MHz",
    genre: "News / Current Affairs",
    genreKeys: ["news"],
    language: ["Urdu"],
    dailyListeners: 800000,
    peakTimes: ["7–9am", "1–2pm"],
    ageRange: "30–55",
    genderFemale: 40,
    socioeconomic: "A/B",
    priceMin: 5000,
    priceMax: 16000,
    initials: "SF",
    bestFor: ["Banking", "Insurance", "Pharma", "B2B", "Government"],
    slotsAvailable: 26,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "18–24", value: 8 },
        { label: "25–34", value: 28 },
        { label: "35–44", value: 38 },
        { label: "45+", value: 26 },
      ],
      genderFemale: 40,
      income: "Upper-middle to high income",
      cityBreakdown: [
        { city: "Karachi", pct: 48 },
        { city: "Lahore", pct: 32 },
        { city: "Islamabad", pct: 20 },
      ],
      topLanguages: ["Urdu", "English"],
    },
    shows: [
      { time: "6:00–9:00 AM", genre: "Morning News", startHour: 6, endHour: 9, type: "prime" },
      { time: "9:00 AM–11:00 AM", genre: "Business News", startHour: 9, endHour: 11, type: "standard" },
      { time: "1:00–2:00 PM", genre: "News", startHour: 13, endHour: 14, type: "standard" },
      { time: "5:00–7:00 PM", genre: "Evening Drive", startHour: 17, endHour: 19, type: "prime" },
    ],
    slots: [
      { id: "s7-morning-drive", label: "⚡ Morning Drive", time: "7–9am", startHour: 7, endHour: 9, priceBase: 16000, isPrime: true, availability: "available" },
      { id: "s7-business-hour", label: "Business Hour", time: "9–11am", startHour: 9, endHour: 11, priceBase: 12000, isPrime: false, availability: "available" },
      { id: "s7-midday", label: "Midday", time: "12–2pm", startHour: 12, endHour: 14, priceBase: 10000, isPrime: false, availability: "available" },
      { id: "s7-afternoon", label: "Afternoon", time: "2–5pm", startHour: 14, endHour: 17, priceBase: 7000, isPrime: false, availability: "available" },
      { id: "s7-evening-drive", label: "⚡ Evening Drive", time: "5–7pm", startHour: 17, endHour: 19, priceBase: 14000, isPrime: true, availability: "available" },
      { id: "s7-night", label: "Night", time: "7–10pm", startHour: 19, endHour: 22, priceBase: 5000, isPrime: false, availability: "available" },
    ],
  },

  {
    id: "fm-89-lhr",
    name: "FM 89 Lahore",
    city: "Lahore",
    allCities: ["Lahore"],
    frequency: "89.0 MHz",
    genre: "Urban Contemporary",
    genreKeys: ["music", "entertainment"],
    language: ["Urdu", "English"],
    dailyListeners: 950000,
    peakTimes: ["8–10am", "5–7pm"],
    ageRange: "20–38",
    genderFemale: 56,
    socioeconomic: "B",
    priceMin: 5500,
    priceMax: 16000,
    initials: "89L",
    bestFor: ["Fashion", "Food & Beverage", "Retail", "Entertainment"],
    slotsAvailable: 20,
    slotStatus: "available",
    demographics: {
      age: [
        { label: "18–24", value: 31 },
        { label: "25–34", value: 40 },
        { label: "35–44", value: 21 },
        { label: "45+", value: 8 },
      ],
      genderFemale: 56,
      income: "Middle income (SEC B)",
      cityBreakdown: [
        { city: "Gulberg / MM Alam", pct: 38 },
        { city: "DHA Lahore", pct: 29 },
        { city: "Cantt / Johar Town", pct: 33 },
      ],
      topLanguages: ["Urdu", "English"],
    },
    shows: [
      { time: "7:00–10:00 AM", genre: "Morning Drive", startHour: 7, endHour: 10, type: "prime" },
      { time: "12:00–3:00 PM", genre: "Music Mix", startHour: 12, endHour: 15, type: "standard" },
      { time: "5:00–7:00 PM", genre: "Evening Drive", startHour: 17, endHour: 19, type: "prime" },
      { time: "9:00–11:00 PM", genre: "Lounge / Chill", startHour: 21, endHour: 23, type: "offpeak" },
    ],
    slots: [
      { id: "s8-morning-drive", label: "⚡ Morning Drive", time: "8–10am", startHour: 8, endHour: 10, priceBase: 16000, isPrime: true, availability: "available" },
      { id: "s8-mid-morning", label: "Mid Morning", time: "10am–12pm", startHour: 10, endHour: 12, priceBase: 9000, isPrime: false, availability: "available" },
      { id: "s8-midday", label: "Midday", time: "12–3pm", startHour: 12, endHour: 15, priceBase: 8000, isPrime: false, availability: "available" },
      { id: "s8-afternoon", label: "Afternoon", time: "3–5pm", startHour: 15, endHour: 17, priceBase: 7000, isPrime: false, availability: "available" },
      { id: "s8-evening-drive", label: "⚡ Evening Drive", time: "5–7pm", startHour: 17, endHour: 19, priceBase: 14000, isPrime: true, availability: "available" },
      { id: "s8-night", label: "Night", time: "7–10pm", startHour: 19, endHour: 22, priceBase: 5500, isPrime: false, availability: "available" },
    ],
  },
];

export function getStation(id: string): Station | undefined {
  return STATIONS.find(s => s.id === id);
}
