import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { DialApiClient, ApiError } from '@dial/api-client';

/**
 * The mobile client.
 *
 * React Native has no cookie jar we can rely on, so the session is a bearer
 * token held in the platform keychain/keystore via expo-secure-store — not
 * AsyncStorage, which is plain text on disk. The API base URL is public
 * configuration (it is just an address); no secret is ever shipped in the
 * bundle.
 */

const TOKEN_KEY = 'dial.session.token';

export const API_URL =
  (Constants.expoConfig?.extra?.['apiUrl'] as string | undefined) ??
  process.env['EXPO_PUBLIC_API_URL'] ??
  'http://localhost:4000';

let cachedToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export async function setToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A keychain failure must not wedge the app; the session simply will not
    // persist across launches.
  }
}

export const api = new DialApiClient({
  baseUrl: API_URL,
  getToken,
});

export { ApiError };
