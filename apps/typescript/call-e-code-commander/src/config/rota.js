/**
 * Server-side on-call rota configuration.
 *
 * A rota is real contact data: the names and mobile numbers of people who will
 * be woken by a phone call. That belongs in configuration, not in source. A
 * number written into a source file is published to whatever repository the
 * project is pushed to and stays there, which is a poor fate for somebody's
 * mobile number, so the checked-in tree carries none and a fresh clone opens
 * onto empty fields.
 *
 * Unlike the API key, a rota is not a credential, so the dev server does send
 * it to the page. It is only ever prefilled into fields the operator can read
 * and change before anything is dialled.
 *
 * The parsing is kept here, separate from the Vite config, so it can be tested
 * without starting a server.
 */

/** The rungs the rota dialog renders, in the order they are dialled. */
export const ROTA_RUNGS = [
  { id: 'primary', envPrefix: 'CALLE_ROTA_PRIMARY' },
  { id: 'backup', envPrefix: 'CALLE_ROTA_BACKUP' },
  { id: 'manager', envPrefix: 'CALLE_ROTA_MANAGER' }
];

/**
 * Builds the seeded rota from a flat environment object.
 *
 * A rung with neither a name nor a number is dropped rather than sent as an
 * empty row, so an unconfigured checkout seeds nothing at all.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Array<{id: string, name: string, phone: string}>}
 */
export function readRotaFromEnv(env = {}) {
  const read = (key) => {
    const value = env[key];
    return typeof value === 'string' ? value.trim() : '';
  };

  return ROTA_RUNGS
    .map(({ id, envPrefix }) => ({
      id,
      name: read(`${envPrefix}_NAME`),
      phone: read(`${envPrefix}_PHONE`)
    }))
    .filter((contact) => contact.name || contact.phone);
}
