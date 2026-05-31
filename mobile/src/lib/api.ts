/**
 * API helper — talks to the existing basudrus.com edge functions.
 *
 * The mobile app hits the SAME backend as the web app. No new
 * endpoints, no second server. CORS is already configured server-side
 * to allow non-browser clients (the Authorization header survives).
 *
 * apiUrl() prepends the prod host so callers can write paths like
 * `/api/ai/tutor` without thinking about origin.
 *
 * authedFetch() pulls the current Supabase access token and adds the
 * Bearer header. This is the only fetch wrapper you should use for
 * authenticated routes — it keeps token handling in one place.
 */
import Constants from 'expo-constants';
import { getAccessToken } from './supabase';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBase?: string };
const API_BASE = (extra.apiBase ?? 'https://www.basudrus.com').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('/')) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

export async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(apiUrl(path), { ...init, headers });
}
