/**
 * Pakistani FM stations, in one place.
 *
 * The homepage previously drew from three separate hand-written lists, so the
 * same handful of names - City FM89, Mast FM103, Apna Karachi - appeared in
 * the dial strip, the rate desk AND the demo plan at the same time. A page
 * claiming to cover the market read as though Arc knew four stations.
 *
 * This is the only list. Sections take slices of it and no station appears in
 * more than one place, except the dial, which is the "we cover the market"
 * strip and deliberately shows all twelve.
 *
 * Supplied and verified by the product owner. Do not add to it or edit the
 * entries without the same.
 */
export interface Station {
  freq: string
  name: string
  cities: string
  format: string
}

export const STATIONS: readonly Station[] = [
  { freq: "89.0", name: "CityFM89", cities: "Karachi · Lahore · Islamabad", format: "English music" },
  { freq: "91.0", name: "FM91", cities: "Karachi · Lahore · Islamabad", format: "CHR / pop" },
  { freq: "93.0", name: "FM93", cities: "nationwide network", format: "Radio Pakistan" },
  { freq: "96.0", name: "Karachi FM", cities: "Karachi", format: "music & talk" },
  { freq: "99.0", name: "Power99", cities: "Islamabad · Abbottabad", format: "news & entertainment" },
  { freq: "100.0", name: "FM100 Pakistan", cities: "9 cities incl. Khi/Lhr/Isb", format: "Urdu music" },
  { freq: "101.0", name: "FM101", cities: "18-station network", format: "Radio Pakistan" },
  { freq: "103.0", name: "Mast FM103", cities: "Lahore · Karachi · Multan", format: "music & shows" },
  { freq: "105.0", name: "Hot FM105", cities: "multi-city network", format: "music" },
  { freq: "106.2", name: "Hum FM 106.2", cities: "Karachi · Lahore · Isb", format: "music & entertainment" },
  { freq: "107.0", name: "Apna Karachi", cities: "Karachi", format: "community & music" },
  { freq: "107.4", name: "MERA FM 107.4", cities: "Karachi · Lahore · Isb", format: "Urdu entertainment" },
]
