"use client";

// The working start control: region, start date as day, month and year (the
// order the bulletin prints dates in), and the action that opens the
// Navigator on that window. Used in the plate and again at the close.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { sites } from "@/lib/sites";
import { ArrowRight, ChevronDown } from "./icons";
import { useLanding } from "./LandingState";
import {
  DATA_YEAR,
  DEFAULT_DATE,
  LAST_DATE,
  MONTHS,
  STAY_HOURS,
  dateValue,
  dayMonthOf,
  daysInMonth,
  fmtDay,
  navigatorHref,
  parseDate,
} from "./model";

const label = "text-[0.79rem] font-semibold uppercase tracking-[0.08em] text-ink-2";
const control =
  "h-11 w-full cursor-pointer appearance-none rounded-none border border-ink bg-paper pl-3 text-[1rem] font-medium text-ink [color-scheme:light] " +
  "transition-colors duration-150 hover:bg-paper-3/50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--color-ink)]";
const chevron = "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink";

const STAY_DAYS = STAY_HOURS / 24;
const LAST_START = fmtDay(parseDate(LAST_DATE) as number);

/** What is wrong with an out-of-range start, and what to pick instead. */
function dateError(date: string): string {
  const dm = dayMonthOf(date);
  if (dm && dm.month === 11) {
    return (
      `${dm.day} Dec is too late. A stay is ${STAY_DAYS} days, and the data ends at midnight on 1 Jan ${DATA_YEAR + 1}. Pick ${LAST_START} or earlier.`
    );
  }
  return `Pick a date from 1 Jan to ${LAST_START} ${DATA_YEAR}. A stay is ${STAY_DAYS} days, and the data covers ${DATA_YEAR}.`;
}

export function StartForm({ idPrefix, framed = false }: { idPrefix: string; framed?: boolean }) {
  const { siteId, date, startMs, dateValid, setSiteId, setDate } = useLanding();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Only the form being used announces a new error; the other copy shows it quietly.
  const [touched, setTouched] = useState(false);
  const dayRef = useRef<HTMLSelectElement>(null);

  const { day, month } = dayMonthOf(date) ?? dayMonthOf(DEFAULT_DATE) ?? { day: 1, month: 0 };
  const days = daysInMonth(month);
  const ids = {
    label: `${idPrefix}-start-label`,
    day: `${idPrefix}-day`,
    dayName: `${idPrefix}-day-name`,
    month: `${idPrefix}-month`,
    monthName: `${idPrefix}-month-name`,
    error: `${idPrefix}-date-error`,
  };
  const invalid = !dateValid;

  useEffect(() => {
    router.prefetch("/tool");
  }, [router]);

  function pickDay(d: number) {
    setTouched(true);
    setDate(dateValue(d, month));
  }

  function pickMonth(m: number) {
    setTouched(true);
    // 31 Mar to April lands on 30 Apr rather than a day that does not exist.
    setDate(dateValue(Math.min(day, daysInMonth(m)), m));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid) {
      setTouched(true);
      dayRef.current?.focus();
      return;
    }
    startTransition(() => router.push(navigatorHref(siteId, startMs)));
  }

  const dateProps = {
    "aria-invalid": invalid,
    "aria-describedby": invalid ? ids.error : undefined,
    className: `${control} pr-9 tabular-nums`,
  };

  return (
    <form
      action="/tool"
      method="get"
      onSubmit={onSubmit}
      noValidate
      className={`bg-paper-2 px-4 py-4 sm:px-5 ${framed ? "border border-ink" : "border-b border-ink"}`}
    >
      <input type="hidden" name="start" value={date} />
      <input type="hidden" name="hours" value={STAY_HOURS} />

      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:items-end lg:gap-4">
        <div className="flex flex-col gap-1.5 lg:w-[17.5rem]">
          <label htmlFor={`${idPrefix}-site`} className={label}>
            Region
          </label>
          <div className="relative">
            <select
              id={`${idPrefix}-site`}
              name="site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className={`${control} pr-10`}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown className={chevron} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label id={ids.label} htmlFor={ids.day} className={label}>
            Start date, UTC
          </label>
          <div className="grid grid-cols-[minmax(0,4fr)_minmax(0,5fr)_auto] items-center gap-2 lg:grid-cols-[4.5rem_5.5rem_auto]">
            <span id={ids.dayName} className="sr-only">
              day
            </span>
            <span id={ids.monthName} className="sr-only">
              month, {DATA_YEAR}
            </span>
            <div className="relative">
              <select
                ref={dayRef}
                id={ids.day}
                aria-labelledby={`${ids.label} ${ids.dayName}`}
                value={day}
                onChange={(e) => pickDay(Number(e.target.value))}
                {...dateProps}
              >
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <ChevronDown className={chevron} />
            </div>
            <div className="relative">
              <select
                id={ids.month}
                aria-labelledby={`${ids.label} ${ids.monthName}`}
                value={month}
                onChange={(e) => pickMonth(Number(e.target.value))}
                {...dateProps}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i}>
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown className={chevron} />
            </div>
            <span aria-hidden="true" className="pr-1 pl-0.5 text-[1rem] font-medium text-ink tabular-nums">
              {DATA_YEAR}
            </span>
          </div>
        </div>

        <p className="text-[0.889rem] leading-snug text-ink-2 sm:col-span-2 lg:hidden xl:block xl:flex-1 xl:self-center xl:pt-6">
          A 6.5-day stay, from midnight UTC.
        </p>

        <button
          type="submit"
          aria-disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2.5 bg-ink px-5 text-[1rem] font-semibold text-paper transition-colors duration-150 select-none hover:bg-ink-2 active:bg-ink aria-disabled:cursor-progress sm:col-span-2 lg:ml-auto lg:shrink-0 xl:ml-0"
        >
          {pending ? "Opening" : "Open this window"}
          <ArrowRight className={pending ? "opacity-60" : ""} />
        </button>
      </div>

      {invalid && (
        <p
          id={ids.error}
          role={touched ? "alert" : undefined}
          className="mt-3 max-w-[72ch] text-[0.889rem] leading-snug font-semibold text-ink"
        >
          {dateError(date)}
        </p>
      )}
    </form>
  );
}
