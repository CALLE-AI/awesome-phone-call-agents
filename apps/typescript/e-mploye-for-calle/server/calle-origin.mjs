export const OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com";

const isOfficialUrl = (value) => {
  try {
    const url = new URL(String(value || OFFICIAL_CALLE_ORIGIN).trim());
    return url.origin === OFFICIAL_CALLE_ORIGIN
      && url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.pathname === "" || url.pathname === "/")
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};

export const isOfficialCalleOrigin = (value) => isOfficialUrl(value);

export const pinCalleBaseUrl = (value = OFFICIAL_CALLE_ORIGIN) => {
  if (!isOfficialUrl(value)) throw new Error(`CALLE_BASE_URL must be the official HTTPS CALL-E origin (${OFFICIAL_CALLE_ORIGIN})`);
  return OFFICIAL_CALLE_ORIGIN;
};
