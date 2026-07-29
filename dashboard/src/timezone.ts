// Converts between a <input type="datetime-local"> value and a UTC unix
// timestamp, interpreted in an arbitrary IANA timezone -- needed because a
// plain `new Date(datetimeLocalValue)` implicitly uses the *browser's*
// timezone, which may differ from Beacon's configured host timezone (see
// worker/src/lib/maintenance.ts / host_settings). Used by
// MaintenancePolicyFormPage.vue's One-time schedule field, which must be
// interpreted in the host timezone regardless of which technician's browser
// is doing the editing -- unlike JobFormPage.vue's one-shot scheduling,
// which intentionally uses the browser's own local zone.

// Pure Intl, no date library. One correction pass is sufficient: guess the
// UTC instant by treating the input as if it were already UTC, read back
// what that guess looks like as wall-clock in `timeZone`, then correct by
// the difference. Real-world DST offsets are at most ~1-2h and this
// converges in a single pass outside the exact transition instant.
export function zonedTimeToUtc(localValue: string, timeZone: string): number {
  const [datePart, timePart] = localValue.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  const guessMs = Date.UTC(y, mo - 1, d, h, mi);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(guessMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const readBackMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  const diff = readBackMs - guessMs;

  return Math.round((guessMs - diff) / 1000);
}

// Inverse — populates the datetime-local input when editing an existing
// One-time policy, so the field shows the wall-clock time in the host
// timezone rather than the editing browser's own zone.
export function utcToZonedInputValue(unixSeconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const hour = (Number(get('hour')) % 24).toString().padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
