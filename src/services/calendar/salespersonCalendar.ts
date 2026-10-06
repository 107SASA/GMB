import { decrypt, encrypt } from '@/lib/crypto';
import { classifyTokenRefreshFailure } from '@/services/calendar/demoScheduling';
import type { ISalespersonCalendarConnection } from '@/models/SalespersonCalendarConnection';

/**
 * Per-salesperson Google Calendar calls. Uses the same OAuth client as GBP
 * (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) and a separate redirect URI.
 * Tokens are decrypted only inside this module and are never logged.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export class CalendarAuthError extends Error {
  constructor(message: string, public readonly revoked: boolean) {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export function calendarRedirectUri(): string {
  if (process.env.GOOGLE_CALENDAR_REDIRECT_URI) return process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${base.replace(/\/$/, '')}/api/auth/google/calendar/callback`;
}

export async function exchangeCalendarCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  email: string;
}> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: calendarRedirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token || !json.access_token) {
    throw new CalendarAuthError('Google did not return a calendar refresh token.', classifyTokenRefreshFailure(res.status, json.error || '') === 'revoked');
  }
  const email = await googleAccountEmail(json.access_token);
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000),
    email,
  };
}

async function googleAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return '';
  const json = await res.json().catch(() => ({}));
  return typeof json.email === 'string' ? json.email : '';
}

export async function accessTokenFor(connection: ISalespersonCalendarConnection): Promise<string> {
  const expires = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  if (connection.accessTokenEnc && expires > Date.now() + 60_000) {
    return decrypt(connection.accessTokenEnc);
  }
  const refreshToken = decrypt(connection.refreshTokenEnc);
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const revoked = classifyTokenRefreshFailure(res.status, String(json.error || '')) === 'revoked';
    connection.status = revoked ? 'revoked' : 'error';
    connection.lastError = revoked ? 'Google authorization was revoked or expired.' : 'Calendar token refresh failed.';
    await connection.save();
    throw new CalendarAuthError(connection.lastError, revoked);
  }
  connection.accessTokenEnc = encrypt(json.access_token);
  connection.accessTokenExpiresAt = new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000);
  connection.status = 'active';
  connection.lastError = '';
  connection.lastCheckedAt = new Date();
  await connection.save();
  return json.access_token;
}

export async function queryFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<Array<{ start: Date; end: Date }>> {
  const res = await fetch(`${CALENDAR_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
  });
  if (!res.ok) {
    throw new CalendarAuthError('Calendar availability check failed.', res.status === 401);
  }
  const json = await res.json();
  const busy = json.calendars?.[calendarId]?.busy || [];
  return busy
    .filter((row: { start?: string; end?: string }) => row.start && row.end)
    .map((row: { start: string; end: string }) => ({ start: new Date(row.start), end: new Date(row.end) }));
}

export async function insertMeetEvent(input: {
  accessToken: string;
  calendarId: string;
  title: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail?: string;
  requestId: string;
}): Promise<{ eventId: string; meetingLink: string }> {
  const res = await fetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events?conferenceDataVersion=1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start.toISOString() },
      end: { dateTime: input.end.toISOString() },
      attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
      conferenceData: {
        createRequest: {
          requestId: input.requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CalendarAuthError('Calendar event creation failed.', res.status === 401);
  const meetingLink = json.hangoutLink
    || json.conferenceData?.entryPoints?.find((entry: { entryPointType?: string; uri?: string }) => entry.entryPointType === 'video')?.uri;
  if (!json.id || !meetingLink) {
    if (json.id) {
      await deleteCalendarEvent(input.accessToken, input.calendarId, json.id).catch(() => {});
    }
    throw new CalendarAuthError('Calendar event was created without a Meet link.', false);
  }
  return { eventId: json.id, meetingLink };
}

export async function deleteCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const res = await fetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) throw new CalendarAuthError('Calendar event cancellation failed.', res.status === 401);
}
