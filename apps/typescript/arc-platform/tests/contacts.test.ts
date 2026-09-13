import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The contact book is parsed once at module load, so every case needs a fresh
 * module registry. That is the behaviour under test as much as the parsing is:
 * a malformed ARC_CONTACTS must be a boot-time complaint, not an exception
 * thrown on every call that happens to be placed afterwards.
 */
async function load(value?: string) {
  vi.resetModules();
  if (value === undefined) delete process.env.ARC_CONTACTS;
  else process.env.ARC_CONTACTS = value;
  return import("@/lib/contacts");
}

afterEach(() => {
  delete process.env.ARC_CONTACTS;
  vi.restoreAllMocks();
});

describe("the contact book decides who can actually be dialled", () => {
  it("returns a number for a known catalogue id", async () => {
    const { contactFor, contactCount } = await load(
      '{"city-fm-89-khi":"+923001234567","fm-101-national":"+923009876543"}'
    );
    expect(contactFor("city-fm-89-khi")).toBe("+923001234567");
    expect(contactCount()).toBe(2);
  });

  it("returns undefined for a target we hold no number for", async () => {
    const { contactFor } = await load('{"city-fm-89-khi":"+923001234567"}');
    // Not an empty string: "no number" has to be distinguishable downstream
    // from "a number that happens to be blank".
    expect(contactFor("mast-fm-103-lhr")).toBeUndefined();
    expect(contactFor(undefined)).toBeUndefined();
    expect(contactFor("")).toBeUndefined();
  });

  it("drops entries that are not valid E.164 instead of dialling them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { contactFor, contactCount } = await load(
      '{"good":"+923001234567","local-format":"0300-1234567","empty":""}'
    );
    expect(contactFor("good")).toBe("+923001234567");
    expect(contactFor("local-format")).toBeUndefined();
    expect(contactCount()).toBe(1);
  });

  it("treats malformed JSON as an empty book rather than throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { contactFor, contactCount } = await load("{not json");
    expect(contactCount()).toBe(0);
    expect(contactFor("anything")).toBeUndefined();
  });

  it("is empty when unset, which is the default deployment", async () => {
    const { contactCount } = await load(undefined);
    expect(contactCount()).toBe(0);
  });
});

describe("resolving one target's number reports which source produced it", () => {
  const BOOK = '{"city-fm-89-khi":"+923001111111","fm-100-khi":"+923002222222"}';
  const DEMO = "+923005550000";
  const station = (name: string, externalId?: string, phone?: string) => ({ name, externalId, phone });

  it("prefers the contact book, and says so", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    const r = resolveTargetNumber(station("City FM 89", "city-fm-89-khi"), DEMO);
    expect(r).toEqual({ phone: "+923001111111", source: "contacts" });
    // No note: a row that is what it looks like should not carry a warning.
    expect(r.note).toBeUndefined();
  });

  it("flags the demo fallback by name rather than reporting a plain success", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    const r = resolveTargetNumber(station("Mast FM 103", "mast-fm-103-lhr"), DEMO);
    expect(r.phone).toBe(DEMO);
    expect(r.source).toBe("demo-fallback");
    // The failure this guards against is a silent one, so the note has to
    // name the target that was NOT called and the id that was missing.
    expect(r.note).toContain("mast-fm-103-lhr");
    expect(r.note).toContain("Mast FM 103");
  });

  it("does not dial at all when there is no fallback, which is production", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    // resolvePhone("") returns "" when NODE_ENV=production; that is the whole
    // of the production behaviour, so it is expressed as an empty fallback.
    expect(resolveTargetNumber(station("Samaa FM", "samaa-fm"), "")).toEqual({
      phone: "",
      source: "none",
    });
  });

  it("lets a number typed for this call beat the book", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    const r = resolveTargetNumber(station("City FM 89", "city-fm-89-khi", "+923009999999"), DEMO);
    expect(r).toEqual({ phone: "+923009999999", source: "typed" });
  });

  it("does not paper over a typed number that is malformed", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    // Falling back here would dial the demo handset while the caller believes
    // their own number was used - the same silent substitution, one level up.
    expect(resolveTargetNumber(station("City FM 89", "city-fm-89-khi", "0300 123 4567"), DEMO)).toEqual({
      phone: "",
      source: "none",
    });
  });

  it("marks every unmapped target, not just the first, when a book is half filled", async () => {
    const { resolveTargetNumber } = await load(BOOK);
    const targets = [
      station("City FM 89", "city-fm-89-khi"),
      station("Mast FM 103", "mast-fm-103-lhr"),
      station("FM 91", "fm-91-lhr"),
    ];
    const sources = targets.map((t) => resolveTargetNumber(t, DEMO).source);
    // The fan-out that looks like three calls and is really one desk plus two
    // calls to the same dev handset.
    expect(sources).toEqual(["contacts", "demo-fallback", "demo-fallback"]);
  });

  it("has no entry to find when ARC_CONTACTS is unset, and says fallback rather than contacts", async () => {
    const { resolveTargetNumber } = await load(undefined);
    expect(resolveTargetNumber(station("City FM 89", "city-fm-89-khi"), DEMO).source).toBe("demo-fallback");
  });
});
