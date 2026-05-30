/**
 * calendarSync — thin wrapper around expo-calendar for Bas Udrus
 * "Add to Calendar" and "Add to Reminders" flows.
 *
 * Why a wrapper:
 *   - expo-calendar's permission + default-source dance is annoying
 *     to repeat at every call site (iOS needs a `Source`, Android
 *     just needs an `accountName`). Hiding it here keeps the call
 *     site to `await addEvent({ title, start, end })`.
 *   - We persist a single `bas_udrus_calendar_id` in SecureStore so
 *     repeat "Add to Calendar" taps drop events into the same custom
 *     calendar named "Bas Udrus" — easy to toggle visibility on iOS
 *     without losing the events.
 *   - Same trick for Reminders: one list named "Bas Udrus" so a user
 *     can mute the whole study channel without surgery.
 *
 * All entry points return a discriminated union — caller does:
 *   const r = await addEvent(...);
 *   if (r.kind === 'ok') ...
 *   else if (r.kind === 'denied') /* prompt to open Settings *\/
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORE_KEY_CAL = 'bas_udrus_calendar_id';
const STORE_KEY_REM = 'bas_udrus_reminder_list_id';
const CALENDAR_NAME = 'Bas Udrus';

export type CalendarResult =
  | { kind: 'ok'; id: string }
  | { kind: 'denied' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────

export async function ensureCalendarPermission(): Promise<'granted' | 'denied'> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

export async function ensureReminderPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (Platform.OS !== 'ios') return 'unsupported'; // Reminders is iOS-only
  const { status } = await Calendar.requestRemindersPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

/** Cheap permission read — does NOT trigger a prompt. */
export async function getCalendarPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function getReminderPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  if (Platform.OS !== 'ios') return 'unsupported';
  const { status } = await Calendar.getRemindersPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

// ─────────────────────────────────────────────────────────────────────
// Default-source picking (iOS) + Bas Udrus calendar creation
// ─────────────────────────────────────────────────────────────────────

async function getOrCreateBasUdrusCalendar(): Promise<string> {
  // Cached path first — most callers hit this branch.
  const cached = await SecureStore.getItemAsync(STORE_KEY_CAL).catch(() => null);
  if (cached) {
    // Confirm it still exists (user may have deleted it).
    const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (all.some(c => c.id === cached)) return cached;
    // Stale — drop the cached id and fall through to recreate.
    await SecureStore.deleteItemAsync(STORE_KEY_CAL).catch(() => {});
  }

  // Pick the right source per platform. iOS needs a sourceId from an
  // existing source (iCloud, etc); Android creates a local account.
  let sourceId: string | undefined;
  if (Platform.OS === 'ios') {
    const sources = await Calendar.getSourcesAsync();
    // Prefer iCloud, then Default, then any writable local.
    const pick =
      sources.find(s => s.name === 'iCloud') ??
      sources.find(s => s.name === 'Default') ??
      sources.find(s => s.type === Calendar.SourceType.LOCAL) ??
      sources[0];
    if (!pick) throw new Error('No calendar source on this device');
    sourceId = pick.id;
  }

  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_NAME,
    color: '#5B4BF5', // brand violet — matches Tony icon
    entityType: Calendar.EntityTypes.EVENT,
    sourceId,
    source:
      Platform.OS === 'android'
        ? { isLocalAccount: true, name: 'Bas Udrus', type: 'LOCAL' }
        : undefined,
    name: CALENDAR_NAME,
    ownerAccount: 'Bas Udrus',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });

  await SecureStore.setItemAsync(STORE_KEY_CAL, id).catch(() => {});
  return id;
}

async function getOrCreateBasUdrusReminderList(): Promise<string> {
  if (Platform.OS !== 'ios') throw new Error('Reminders is iOS-only');
  const cached = await SecureStore.getItemAsync(STORE_KEY_REM).catch(() => null);
  if (cached) {
    const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    if (all.some(c => c.id === cached)) return cached;
    await SecureStore.deleteItemAsync(STORE_KEY_REM).catch(() => {});
  }
  const sources = await Calendar.getSourcesAsync();
  const pick =
    sources.find(s => s.name === 'iCloud') ??
    sources.find(s => s.name === 'Default') ??
    sources[0];
  if (!pick) throw new Error('No reminder source on this device');

  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_NAME,
    color: '#5B4BF5',
    entityType: Calendar.EntityTypes.REMINDER,
    sourceId: pick.id,
    name: CALENDAR_NAME,
    ownerAccount: 'Bas Udrus',
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  await SecureStore.setItemAsync(STORE_KEY_REM, id).catch(() => {});
  return id;
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export type AddEventInput = {
  title: string;
  start: Date;
  /** Defaults to start + 1h if omitted. */
  end?: Date;
  notes?: string;
  location?: string;
  /** Minutes before the event to alert (default 15). Set null for none. */
  alarmOffsetMin?: number | null;
};

export async function addEvent(input: AddEventInput): Promise<CalendarResult> {
  try {
    const perm = await ensureCalendarPermission();
    if (perm !== 'granted') return { kind: 'denied' };

    const calId = await getOrCreateBasUdrusCalendar();
    const end = input.end ?? new Date(input.start.getTime() + 60 * 60 * 1000);
    const alarms =
      input.alarmOffsetMin === null
        ? []
        : [{ relativeOffset: -1 * (input.alarmOffsetMin ?? 15) }];

    const id = await Calendar.createEventAsync(calId, {
      title: input.title,
      startDate: input.start,
      endDate: end,
      notes: input.notes,
      location: input.location,
      alarms,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return { kind: 'ok', id };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}

export type AddReminderInput = {
  title: string;
  /** Optional date — if set, the reminder triggers at that time. */
  dueDate?: Date | null;
  notes?: string;
};

export async function addReminder(input: AddReminderInput): Promise<CalendarResult> {
  try {
    if (Platform.OS !== 'ios') return { kind: 'unsupported' };
    const perm = await ensureReminderPermission();
    if (perm !== 'granted') return { kind: 'denied' };

    const listId = await getOrCreateBasUdrusReminderList();
    const id = await Calendar.createReminderAsync(listId, {
      title: input.title,
      dueDate: input.dueDate ?? undefined,
      startDate: input.dueDate ?? undefined,
      notes: input.notes,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return { kind: 'ok', id };
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
}
