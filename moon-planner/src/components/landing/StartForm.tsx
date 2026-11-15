"use client";

// The working start control: region, start date, and the action that opens
// the Navigator on that window. Used in the plate and again at the close.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { sites } from "@/lib/sites";
import { ArrowRight, ChevronDown } from "./icons";
import { useLanding } from "./LandingState";
import { FIRST_DATE, LAST_DATE, navigatorHref } from "./model";

const label = "text-[0.79rem] font-semibold uppercase tracking-[0.08em] text-ink-2";
const control =
  "h-11 w-full rounded-none border border-ink bg-paper text-[1rem] font-medium text-ink [color-scheme:light] " +
  "transition-colors duration-150 hover:bg-paper-3/50 aria-[invalid=true]:shadow-[inset_0_0_0_1px_#121a22]";

export function StartForm({ idPrefix, framed = false }: { idPrefix: string; framed?: boolean }) {
  const { siteId, date, startMs, dateValid, setSiteId, setDate } = useLanding();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const showError = !dateValid && touched;
  const errorId = `${idPrefix}-date-error`;

  useEffect(() => {
    router.prefetch("/tool");
  }, [router]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dateValid) {
      setTouched(true);
      dateRef.current?.focus();
      return;
    }
    startTransition(() => router.push(navigatorHref(siteId, startMs)));
  }

  return (
    <form
      action="/tool"
      method="get"
      onSubmit={onSubmit}
      noValidate
      className={`bg-paper-2 px-4 py-4 sm:px-5 ${framed ? "border border-ink" : "border-b border-ink"}`}
    >
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
              className={`${control} cursor-pointer appearance-none pr-10 pl-3`}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 lg:w-[12.5rem]">
          <label htmlFor={`${idPrefix}-start`} className={label}>
            Start date, UTC
          </label>
          <input
            ref={dateRef}
            id={`${idPrefix}-start`}
            name="start"
            type="date"
            required
            min={FIRST_DATE}
            max={LAST_DATE}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError}
            aria-describedby={showError ? errorId : undefined}
            className={`${control} px-3 tabular-nums [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 hover:[&::-webkit-calendar-picker-indicator]:opacity-100`}
          />
        </div>

        <p className="text-[0.889rem] leading-snug text-ink-2 sm:col-span-2 lg:hidden xl:block xl:flex-1 xl:self-center xl:pt-6">
          A 6.5-day stay from 00:00 UTC, measured hour by hour.
        </p>

        <button
          type="submit"
          aria-disabled={pending}
          className="inline-flex h-11 items-center justify-center gap-2.5 bg-ink px-5 text-[1rem] font-semibold text-paper transition-colors duration-150 select-none hover:bg-ink-2 active:bg-ink aria-disabled:cursor-progress sm:col-span-2 lg:ml-auto lg:shrink-0 xl:ml-0"
        >
          {pending ? "Opening the Navigator" : "Open in the Navigator"}
          <ArrowRight className={pending ? "opacity-60" : ""} />
        </button>
      </div>

      {showError && (
        <p id={errorId} role="alert" className="mt-3 text-[0.889rem] font-semibold text-ink">
          Pick a start date from 1 Jan to 25 Dec 2027: the tracks cover 2027, and a stay runs 6.5 days.
        </p>
      )}
    </form>
  );
}
