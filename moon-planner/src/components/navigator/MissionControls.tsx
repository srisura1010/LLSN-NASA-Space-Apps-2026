"use client";

import { useId, useState } from "react";
import { bestStart, scoreWindow, windowStats, type MissionScore, type SiteData } from "@/lib/sky";
import { fmtDuration } from "./plot/format";
import {
  ArrowMark,
  covers,
  fieldControl,
  fieldLabel,
  pct,
  primaryButton,
  smallButton,
  spell,
} from "./SiteBulletin";

// ---------- Time ----------

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** The precomputed Horizons tracks run hourly through 2027. */
export const DATA_START_MS = Date.UTC(2027, 0, 1);
export const DATA_END_MS = Date.UTC(2028, 0, 1);
export const DEFAULT_START_MS = Date.UTC(2027, 5, 1);
export const DEFAULT_HOURS = 156; // 6.5 days
export const MIN_HOURS = 1;
export const MAX_HOURS = 60 * 24;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const two = (n: number) => String(n).padStart(2, "0");

/** "1 Jun 2027, 00:00" in UTC (the caller adds "UTC" where it is not already clear). */
export function fmtWhen(ms: number, withYear = true): string {
  const d = new Date(ms);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
  return `${day}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** "1 Jun 2027, 00:00 to 7 Jun, 12:00 UTC". */
export function fmtSpan(startMs: number, endMs: number): string {
  const sameYear = new Date(startMs).getUTCFullYear() === new Date(endMs).getUTCFullYear();
  return `${fmtWhen(startMs)} to ${fmtWhen(endMs, !sameYear)} UTC`;
}

const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));

/** "6.5 days", "36 hours", "1 day". */
export function fmtLength(hours: number): string {
  const d = hours / 24;
  if (hours >= 24 && Math.abs(d * 2 - Math.round(d * 2)) < 1e-9) return `${trim(d, 1)} ${d === 1 ? "day" : "days"}`;
  if (hours < 48) return `${trim(hours, 1)} ${hours === 1 ? "hour" : "hours"}`;
  return fmtDuration(hours);
}

/** "+1 week", "+2 weeks", "+19 d 23 h", "−3 d". */
export function fmtShift(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  const abs = Math.abs(ms);
  if (abs > 0 && abs % (7 * DAY) === 0) {
    const w = abs / (7 * DAY);
    return `${sign}${w} ${w === 1 ? "week" : "weeks"}`;
  }
  return `${sign}${fmtDuration(abs / HOUR)}`;
}

export function monthLabel(month: number): string {
  return `${MONTHS_LONG[month]} 2027`;
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

function parseStart(date: string, hour: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, hour);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

type Unit = "days" | "hours";

function parseLength(text: string, unit: Unit): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return unit === "days" ? n * 24 : n;
}

function unitFor(hours: number): Unit {
  return hours >= 24 && Math.abs(hours / 12 - Math.round(hours / 12)) < 1e-9 ? "days" : "hours";
}

function lengthText(hours: number, unit: Unit): string {
  return unit === "days" ? trim(hours / 24, 3) : trim(hours, 2);
}

// ---------- Change note ----------

export type WindowChange = {
  /** The plan the change is measured against. */
  fromStartMs: number;
  fromHours: number;
  /** What moved the start, e.g. "Slip" or "Best start in July 2027". */
  reason: string;
};

type ChangeNoteProps = {
  change: WindowChange;
  startMs: number;
  siteName: string;
  before: MissionScore | null;
  after: MissionScore | null;
  rankBefore: number | null;
  rankAfter: number | null;
  total: number;
  onUndo: () => void;
  onDismiss: () => void;
  className?: string;
};

function Delta({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <>
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right whitespace-nowrap text-ink">
        {from === to ? (
          <span>
            {to} <span className="text-ink-2">no change</span>
          </span>
        ) : (
          <>
            <span className="sr-only">from </span>
            {from} <ArrowMark className="mx-0.5 size-3 text-ink-2" />
            <span className="sr-only"> to </span>
            <span className="font-semibold">{to}</span>
          </>
        )}
      </dd>
    </>
  );
}

export function ChangeNote({
  change,
  startMs,
  siteName,
  before,
  after,
  rankBefore,
  rankAfter,
  total,
  onUndo,
  onDismiss,
  className = "",
}: ChangeNoteProps) {
  const shift = startMs - change.fromStartMs;
  return (
    <div role="status" className={`border border-ink bg-paper px-3 py-2.5 ${className}`}>
      <p className="text-[0.844rem] leading-snug text-ink">
        <strong className="font-semibold">
          {change.reason}, {fmtShift(shift)}.
        </strong>{" "}
        Planned start was {fmtWhen(change.fromStartMs)} UTC.
      </p>
      {before && after && (
        <>
          <p className="mt-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-ink-2">{siteName}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.844rem] tabular-nums">
            {rankBefore !== null && rankAfter !== null && (
              <Delta label="Rank" from={`${rankBefore} of ${total}`} to={`${rankAfter} of ${total}`} />
            )}
            <Delta label="Sun up" from={pct(before.sunlit)} to={pct(after.sunlit)} />
            <Delta label="Earth in view" from={pct(before.earthVisible)} to={pct(after.earthVisible)} />
            <Delta label="Longest dark" from={spell(before.longestDarkHours)} to={spell(after.longestDarkHours)} />
          </dl>
        </>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={onUndo} className={smallButton}>
          Back to the plan
        </button>
        <button type="button" onClick={onDismiss} className={smallButton}>
          Keep the new start
        </button>
      </div>
    </div>
  );
}

// ---------- Controls ----------

type FieldError = { field: "start" | "length" | "window"; message: string };

type Props = {
  startMs: number;
  durationHours: number;
  /** Selected site, searched by "Find best start in". */
  site: SiteData | null;
  siteName: string;
  /** reason is null for a typed change, or names a slip or search (shown in the change note). */
  onApply: (startMs: number, durationHours: number, reason: string | null) => void;
  className?: string;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function ErrorMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" className="mt-[0.15em] size-3.5 shrink-0">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

export default function MissionControls({ startMs, durationHours, site, siteName, onApply, className = "" }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const infoId = `${id}-info`;

  const [seen, setSeen] = useState({ startMs, durationHours });
  const [dateDraft, setDateDraft] = useState(() => isoDate(startMs));
  const [hourDraft, setHourDraft] = useState(() => new Date(startMs).getUTCHours());
  const [unit, setUnit] = useState<Unit>(() => unitFor(durationHours));
  const [lenDraft, setLenDraft] = useState(() => lengthText(durationHours, unitFor(durationHours)));
  const [month, setMonth] = useState(() => new Date(startMs).getUTCMonth());
  const [error, setError] = useState<FieldError | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Follow changes made elsewhere (slips, searches, undo) without fighting the user's typing.
  if (seen.startMs !== startMs || seen.durationHours !== durationHours) {
    if (seen.startMs !== startMs) {
      if (parseStart(dateDraft, hourDraft) !== startMs) {
        setDateDraft(isoDate(startMs));
        setHourDraft(new Date(startMs).getUTCHours());
      }
      setMonth(new Date(startMs).getUTCMonth());
    }
    if (seen.durationHours !== durationHours && parseLength(lenDraft, unit) !== durationHours) {
      const u = unitFor(durationHours);
      setUnit(u);
      setLenDraft(lengthText(durationHours, u));
    }
    setSeen({ startMs, durationHours });
    setError(null);
  }

  function check(date: string, hour: number, len: string, u: Unit): { ok: true; start: number; hours: number } | { ok: false; error: FieldError } {
    const start = parseStart(date, hour);
    if (start === null)
      return { ok: false, error: { field: "start", message: "Enter a start date in 2027, for example 2027-06-01." } };
    if (start < DATA_START_MS || start >= DATA_END_MS)
      return {
        ok: false,
        error: {
          field: "start",
          message: "The Sun and Earth tracks cover 2027 only. Pick a start between 1 Jan and 31 Dec 2027.",
        },
      };
    const hours = parseLength(len, u);
    if (hours === null)
      return {
        ok: false,
        error: { field: "length", message: "Enter the mission length as a number, for example 6.5 days or 156 hours." },
      };
    if (hours < MIN_HOURS) return { ok: false, error: { field: "length", message: "A mission has to last at least 1 hour." } };
    if (hours > MAX_HOURS)
      return { ok: false, error: { field: "length", message: "Missions up to 60 days are supported. Enter 60 days or less." } };
    if (start + hours * HOUR > DATA_END_MS) {
      const latest = Math.floor((DATA_END_MS - hours * HOUR) / HOUR) * HOUR;
      const room = (DATA_END_MS - start) / HOUR;
      return {
        ok: false,
        error: {
          field: "window",
          message: `This window would end ${fmtWhen(start + hours * HOUR)} UTC, after the tracks end (1 Jan 2028, 00:00 UTC). Start by ${fmtWhen(latest)} or shorten the mission to ${fmtLength(room)}.`,
        },
      };
    }
    return { ok: true, start, hours };
  }

  function edit(date: string, hour: number, len: string, u: Unit, showEmpty: boolean) {
    setInfo(null);
    const r = check(date, hour, len, u);
    if (r.ok) {
      setError(null);
      if (r.start !== startMs || r.hours !== durationHours) onApply(r.start, r.hours, null);
      return;
    }
    // Half-typed values (an empty date or length) are reported on blur, not mid-keystroke.
    const empty = date.trim() === "" || len.trim() === "";
    if (!empty || showEmpty) setError(r.error);
  }

  function changeUnit(next: Unit) {
    const hours = parseLength(lenDraft, unit);
    const text = hours === null ? lenDraft : lengthText(hours, next);
    setUnit(next);
    setLenDraft(text);
    edit(dateDraft, hourDraft, text, next, false);
  }

  function search() {
    setError(null);
    if (!site) return;
    const from = Date.UTC(2027, month, 1);
    const to = Date.UTC(2027, month + 1, 1) - HOUR;
    const name = monthLabel(month);
    if (!covers(site, from, Math.min(DATA_END_MS, to + durationHours * HOUR))) {
      setInfo(`${siteName} only has tracks for the current window, so a month search needs one of the nine regions.`);
      return;
    }
    const best = bestStart(site, from, to, durationHours, durationHours > 14 * 24 ? 3 : 1);
    if (!best) {
      setInfo(
        `No ${fmtLength(durationHours)} mission starting in ${name} ends before the tracks end on 1 Jan 2028. Pick an earlier month or a shorter mission.`,
      );
      return;
    }
    const inMonth = startMs >= from && startMs <= to;
    const current = inMonth ? scoreWindow(site.sky.siteId, windowStats(site, startMs, startMs + durationHours * HOUR)) : null;
    if (current && best.score <= current.score + 1e-9) {
      setInfo(`${fmtWhen(startMs)} UTC is already the best ${fmtLength(durationHours)} start in ${name} for ${siteName}.`);
      return;
    }
    setInfo(null);
    onApply(best.startMs, durationHours, `Best start in ${name}`);
  }

  function slip(days: number) {
    setError(null);
    setInfo(null);
    onApply(startMs + days * DAY, durationHours, "Slip");
  }

  const startInvalid = error?.field === "start" || error?.field === "window";
  const lengthInvalid = error?.field === "length" || error?.field === "window";
  const describedBy = [error ? errorId : null, info ? infoId : null].filter(Boolean).join(" ") || undefined;
  const slipBlocked = (days: number) => startMs + days * DAY + durationHours * HOUR > DATA_END_MS;

  return (
    <div className={className}>
      <form
        className="flex flex-wrap items-end gap-x-5 gap-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          edit(dateDraft, hourDraft, lenDraft, unit, true);
        }}
        noValidate
      >
        <fieldset className="min-w-0">
          <legend className={fieldLabel}>Start, UTC</legend>
          <div className="mt-1 flex">
            <label htmlFor={`${id}-date`} className="sr-only">
              Start date, UTC
            </label>
            <input
              id={`${id}-date`}
              type="date"
              min="2027-01-01"
              max="2027-12-31"
              value={dateDraft}
              aria-invalid={startInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setDateDraft(e.target.value);
                edit(e.target.value, hourDraft, lenDraft, unit, false);
              }}
              onBlur={() => edit(dateDraft, hourDraft, lenDraft, unit, true)}
              className={`${fieldControl} w-[9.5rem] tabular-nums`}
            />
            <label htmlFor={`${id}-hour`} className="sr-only">
              Start hour, UTC
            </label>
            <select
              id={`${id}-hour`}
              value={hourDraft}
              aria-invalid={startInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                const h = Number(e.target.value);
                setHourDraft(h);
                edit(dateDraft, h, lenDraft, unit, false);
              }}
              className={`${fieldControl} -ml-px w-[5.25rem] tabular-nums`}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {two(h)}:00
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={fieldLabel}>Mission length</legend>
          <div className="mt-1 flex">
            <label htmlFor={`${id}-len`} className="sr-only">
              Mission length in {unit}
            </label>
            <input
              id={`${id}-len`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={lenDraft}
              aria-invalid={lengthInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                setLenDraft(e.target.value);
                edit(dateDraft, hourDraft, e.target.value, unit, false);
              }}
              onBlur={() => edit(dateDraft, hourDraft, lenDraft, unit, true)}
              className={`${fieldControl} w-[4.5rem] text-right tabular-nums`}
            />
            <label htmlFor={`${id}-unit`} className="sr-only">
              Unit
            </label>
            <select
              id={`${id}-unit`}
              value={unit}
              onChange={(e) => changeUnit(e.target.value as Unit)}
              className={`${fieldControl} -ml-px w-[5.5rem]`}
            >
              <option value="days">days</option>
              <option value="hours">hours</option>
            </select>
          </div>
        </fieldset>

        <div role="group" aria-labelledby={`${id}-find`} className="min-w-0">
          <span id={`${id}-find`} className={fieldLabel}>
            Find best start in
          </span>
          <div className="mt-1 flex">
            <label htmlFor={`${id}-month`} className="sr-only">
              Month to search
            </label>
            <select
              id={`${id}-month`}
              value={month}
              onChange={(e) => {
                setMonth(Number(e.target.value));
                setInfo(null);
              }}
              className={`${fieldControl} w-[9.5rem]`}
            >
              {MONTHS_LONG.map((m, i) => (
                <option key={m} value={i}>
                  {monthLabel(i)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={search}
              disabled={!site}
              aria-describedby={info ? infoId : undefined}
              className={`${primaryButton} -ml-px`}
            >
              Search
            </button>
          </div>
        </div>

        <div role="group" aria-labelledby={`${id}-slip`} className="min-w-0">
          <span id={`${id}-slip`} className={fieldLabel}>
            Slip start
          </span>
          <div className="mt-1 flex">
            <button
              type="button"
              onClick={() => slip(7)}
              disabled={slipBlocked(7)}
              title={slipBlocked(7) ? "A one-week slip would run past the end of the 2027 tracks" : undefined}
              className={smallButton}
            >
              +1 week
            </button>
            <button
              type="button"
              onClick={() => slip(14)}
              disabled={slipBlocked(14)}
              title={slipBlocked(14) ? "A two-week slip would run past the end of the 2027 tracks" : undefined}
              className={`${smallButton} -ml-px`}
            >
              +2 weeks
            </button>
          </div>
        </div>
      </form>

      <div aria-live="polite">
        {error && (
          <p id={errorId} className="mt-2 flex max-w-[68ch] gap-1.5 text-[0.844rem] font-medium leading-snug text-ink">
            <ErrorMark />
            <span>{error.message}</span>
          </p>
        )}
        {!error && info && (
          <p id={infoId} className="mt-2 max-w-[68ch] text-[0.844rem] leading-snug text-ink-2">
            {info}
          </p>
        )}
      </div>
    </div>
  );
}
