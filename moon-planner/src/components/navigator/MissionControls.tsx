"use client";

import { useId, useState } from "react";
import { bestStart, covers, missionScore, type MissionScore, type SiteData } from "@/lib/sky";
import { HOUR, MONTHS, MONTHS_LONG, fmtLength, fmtMonth, fmtShift, fmtSpell, fmtWhen, pct } from "@/lib/format";
import { DATA_END_MS, DATA_START_MS, DATA_YEAR, MAX_HOURS, MIN_HOURS, SLIP_STEPS } from "@/lib/mission";
import { ArrowMark, ErrorMark, SelectField, buttonClass, fieldControl, fieldLabel } from "../ui";

const two = (n: number) => String(n).padStart(2, "0");
const trim = (v: number, digits: number) => String(Number(v.toFixed(digits)));

function daysInMonth(month: number): number {
  return new Date(Date.UTC(DATA_YEAR, month + 1, 0)).getUTCDate();
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** Day and month (0-11) of a YYYY-MM-DD draft. */
function dayMonth(date: string): { day: number; month: number } {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? { day: Number(m[2]), month: Number(m[1]) - 1 } : { day: 1, month: 0 };
}

function isoOf(day: number, month: number): string {
  return `${DATA_YEAR}-${two(month + 1)}-${two(Math.min(day, daysInMonth(month)))}`;
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
      <p className="text-body leading-snug text-ink">
        <strong className="font-semibold">
          {change.reason}, {fmtShift(shift)}.
        </strong>{" "}
        Planned start was {fmtWhen(change.fromStartMs)} UTC.
      </p>
      {before && after && (
        <>
          <p className="mt-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-2">{siteName}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-body tabular-nums">
            {rankBefore !== null && rankAfter !== null && (
              <Delta label="Rank" from={`${rankBefore} of ${total}`} to={`${rankAfter} of ${total}`} />
            )}
            <Delta label="Sun up" from={pct(before.sunlit)} to={pct(after.sunlit)} />
            <Delta label="Earth in view" from={pct(before.earthVisible)} to={pct(after.earthVisible)} />
            <Delta label="Longest dark" from={fmtSpell(before.longestDarkHours)} to={fmtSpell(after.longestDarkHours)} />
          </dl>
        </>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={onUndo} className={buttonClass.primary}>
          Undo<span className="sr-only">: back to the planned start</span>
        </button>
        <button type="button" onClick={onDismiss} className={buttonClass.secondary}>
          Keep new start
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
  /** Selected site, the one "Best start for … in" searches. */
  site: SiteData | null;
  siteName: string;
  /** reason is null for a typed change, or names a slip or search (shown in the change note). */
  onApply: (startMs: number, durationHours: number, reason: string | null) => void;
  /** Called after a search or slip moved the start, e.g. to close the popover. */
  onDone?: () => void;
  /** "row" lays the fields out side by side; "stack" one above another (the window popover). */
  layout?: "row" | "stack";
  className?: string;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function MissionControls({ startMs, durationHours, site, siteName, onApply, onDone, layout = "row", className = "" }: Props) {
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
      return { ok: false, error: { field: "start", message: "Pick a start day and month in 2027." } };
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

  function pickDate(date: string) {
    setDateDraft(date);
    edit(date, hourDraft, lenDraft, unit, true);
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
    const name = fmtMonth(month);
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
    const current = inMonth ? missionScore(site, startMs, startMs + durationHours * HOUR) : null;
    if (current && best.score <= current.score + 1e-9) {
      setInfo(`${fmtWhen(startMs)} UTC is already the best ${fmtLength(durationHours)} start in ${name} for ${siteName}.`);
      return;
    }
    setInfo(null);
    onApply(best.startMs, durationHours, `Best start in ${name}`);
    onDone?.();
  }

  function slip(ms: number) {
    setError(null);
    setInfo(null);
    onApply(startMs + ms, durationHours, "Slip");
    onDone?.();
  }

  const start = dayMonth(dateDraft);
  const startInvalid = error?.field === "start" || error?.field === "window";
  const lengthInvalid = error?.field === "length" || error?.field === "window";
  const describedBy = [error ? errorId : null, info ? infoId : null].filter(Boolean).join(" ") || undefined;
  const slipBlocked = (ms: number) => startMs + ms + durationHours * HOUR > DATA_END_MS;
  const stack = layout === "stack";

  return (
    <div className={className}>
      <form
        className={stack ? "grid gap-4" : "flex flex-wrap items-end gap-x-5 gap-y-3"}
        onSubmit={(e) => {
          e.preventDefault();
          edit(dateDraft, hourDraft, lenDraft, unit, true);
        }}
        noValidate
      >
        <fieldset className="min-w-0">
          <legend className={fieldLabel}>Start, UTC</legend>
          {/* Day, month, year, hour: the order the bulletin prints dates in (14 Nov 2027, 00:00). */}
          <div className="mt-1 flex items-center">
            <label htmlFor={`${id}-day`} className="sr-only">
              Start day
            </label>
            <SelectField
              id={`${id}-day`}
              value={start.day}
              aria-invalid={startInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => pickDate(isoOf(Number(e.target.value), start.month))}
              wrapClassName="w-[3.75rem]"
              className="tabular-nums"
            >
              {Array.from({ length: daysInMonth(start.month) }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </SelectField>
            <label htmlFor={`${id}-month`} className="sr-only">
              Start month, {DATA_YEAR}
            </label>
            <SelectField
              id={`${id}-month`}
              value={start.month}
              aria-invalid={startInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => pickDate(isoOf(start.day, Number(e.target.value)))}
              wrapClassName="-ml-px w-[4.5rem]"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </SelectField>
            <span className="px-2 text-lead text-ink tabular-nums" aria-hidden="true">
              {DATA_YEAR}
            </span>
            <label htmlFor={`${id}-hour`} className="sr-only">
              Start hour, UTC
            </label>
            <SelectField
              id={`${id}-hour`}
              value={hourDraft}
              aria-invalid={startInvalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => {
                const h = Number(e.target.value);
                setHourDraft(h);
                edit(dateDraft, h, lenDraft, unit, false);
              }}
              wrapClassName="w-[5.75rem]"
              className="tabular-nums"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {two(h)}:00
                </option>
              ))}
            </SelectField>
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
            <SelectField
              id={`${id}-unit`}
              value={unit}
              onChange={(e) => changeUnit(e.target.value as Unit)}
              wrapClassName="-ml-px w-[5.5rem]"
            >
              <option value="days">days</option>
              <option value="hours">hours</option>
            </SelectField>
          </div>
        </fieldset>

        <div role="group" aria-labelledby={`${id}-find`} className="min-w-0">
          <span id={`${id}-find`} className={fieldLabel}>
            Best start for <span className="normal-case tracking-normal">{siteName}</span> in
          </span>
          <div className="mt-1 flex">
            <label htmlFor={`${id}-search`} className="sr-only">
              Month to search
            </label>
            <SelectField
              id={`${id}-search`}
              value={month}
              onChange={(e) => {
                setMonth(Number(e.target.value));
                setInfo(null);
              }}
              wrapClassName="w-[10rem]"
            >
              {MONTHS_LONG.map((m, i) => (
                <option key={m} value={i}>
                  {fmtMonth(i)}
                </option>
              ))}
            </SelectField>
            <button
              type="button"
              onClick={search}
              disabled={!site}
              aria-describedby={info ? infoId : undefined}
              className={`${buttonClass.primary} -ml-px`}
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
            {SLIP_STEPS.filter((s) => s.ms > 0).map((s, i) => (
              <button
                key={s.label}
                type="button"
                onClick={() => slip(s.ms)}
                disabled={slipBlocked(s.ms)}
                title={slipBlocked(s.ms) ? `A ${s.label.slice(1)} slip would run past the end of the 2027 tracks` : undefined}
                className={`${buttonClass.secondary} ${i ? "-ml-px" : ""}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </form>

      <div aria-live="polite">
        {error && (
          <p id={errorId} className="mt-2 flex max-w-[68ch] gap-1.5 text-body font-medium leading-snug text-ink">
            <ErrorMark />
            <span>{error.message}</span>
          </p>
        )}
        {!error && info && (
          <p id={infoId} className="mt-2 max-w-[68ch] text-body leading-snug text-ink-2">
            {info}
          </p>
        )}
      </div>
    </div>
  );
}
