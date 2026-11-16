"use client";

// "+ Custom launch site": a launch site on Earth typed in by the user, kept in
// localStorage and ranked with the listed sites. Also the hook the Navigator
// uses to mark the same site on the Earth view.

import { useId, useMemo, useState } from "react";
import { parseCoordinate } from "@/lib/anySite";
import {
  CUSTOM_LAUNCH_DEFAULT_NAME,
  CUSTOM_LAUNCH_KEY,
  CUSTOM_LAUNCH_MAX_LAT,
  DIRECTION_OPTIONS,
  customLaunchSite,
  parseHeading,
  readSpec,
  type CustomLaunchSpec,
  type LaunchDirections,
} from "@/lib/customLaunchSite";
import { formatAzimuthRanges } from "@/lib/launchWindow";
import type { LaunchSite } from "@/lib/launchSites";
import { fmtLatLon } from "@/lib/format";
import { useStored } from "@/state/stored";
import { ChevronMark, SelectField, buttonClass, fieldControl, fieldLabel } from "../ui";

/** The stored custom launch site, as a LaunchSite (null when none is set). */
export function useCustomLaunch(): {
  spec: CustomLaunchSpec | null;
  site: LaunchSite | null;
  setSpec: (s: CustomLaunchSpec | null) => void;
} {
  const [raw, setRaw] = useStored<unknown>(CUSTOM_LAUNCH_KEY, null);
  const spec = useMemo(() => readSpec(raw), [raw]);
  const site = useMemo(() => (spec ? customLaunchSite(spec) : null), [spec]);
  return { spec, site, setSpec: setRaw };
}

type Field = "lat" | "lon" | "from" | "to";
type Problem = { field: Field; message: string };

function check(name: string, latText: string, lonText: string, directions: LaunchDirections, fromText: string, toText: string): CustomLaunchSpec | Problem {
  const a = parseCoordinate(latText, "lat");
  if (!a.ok) return { field: "lat", message: a.message };
  if (Math.abs(a.value) > CUSTOM_LAUNCH_MAX_LAT) {
    return {
      field: "lat",
      message: `A heading has no meaning at the pole itself. Keep the latitude between ${CUSTOM_LAUNCH_MAX_LAT} S and ${CUSTOM_LAUNCH_MAX_LAT} N.`,
    };
  }
  const b = parseCoordinate(lonText, "lon");
  if (!b.ok) return { field: "lon", message: b.message };
  const spec: CustomLaunchSpec = {
    name: name.trim().slice(0, 60) || CUSTOM_LAUNCH_DEFAULT_NAME,
    lat: a.value,
    lon: b.value,
    directions,
  };
  if (directions !== "range") return spec;
  const f = parseHeading(fromText, "From");
  if (!f.ok) return { field: "from", message: f.message };
  const t = parseHeading(toText, "To");
  if (!t.ok) return { field: "to", message: t.message };
  if (f.value % 360 === t.value % 360) {
    return {
      field: "to",
      message: "From and To are the same heading, which leaves no direction. To allow every heading, choose Any direction.",
    };
  }
  return { ...spec, from: f.value, to: t.value };
}

export function CustomLaunchForm({ spec, onSave, onRemove }: { spec: CustomLaunchSpec | null; onSave: (s: CustomLaunchSpec) => void; onRemove: () => void }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [directions, setDirections] = useState<LaunchDirections>("any");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);

  const startEdit = () => {
    if (!spec) return;
    setName(spec.name === CUSTOM_LAUNCH_DEFAULT_NAME ? "" : spec.name);
    setLatText(String(spec.lat));
    setLonText(String(spec.lon));
    setDirections(spec.directions);
    setFromText(spec.from !== undefined ? String(spec.from) : "");
    setToText(spec.to !== undefined ? String(spec.to) : "");
    setProblem(null);
    setEditing(true);
  };

  const submit = () => {
    const r = check(name, latText, lonText, directions, fromText, toText);
    if ("message" in r) {
      setProblem(r);
      return;
    }
    setProblem(null);
    setEditing(false);
    onSave(r);
  };

  const errorId = `${id}-error`;
  const input = (field: Field) => ({
    "aria-invalid": problem?.field === field || undefined,
    "aria-describedby": problem?.field === field ? errorId : undefined,
  });
  const box = `${fieldControl} mt-1 tabular-nums placeholder:text-ink-2`;
  const site = spec ? customLaunchSite(spec) : null;

  return (
    <div className="border-t border-rule">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls={`${id}-body`}
        onClick={() => setShown(!shown)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-lead font-semibold text-ink transition-colors duration-150 hover:bg-paper-3"
      >
        <span>
          <span aria-hidden="true">+ </span>Custom launch site
          {site && !shown && <span className="ml-2 font-normal text-ink-2">{site.name}</span>}
        </span>
        <ChevronMark className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${shown ? "rotate-180" : ""}`} />
      </button>
      <div id={`${id}-body`} hidden={!shown} className="px-4 pb-4">
        {site && !editing ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 basis-64 text-body text-pretty text-ink-2 tabular-nums">
              <span className="font-semibold text-ink">{site.name}</span> at {fmtLatLon(site.lat, site.lon)}, launching {formatAzimuthRanges(site)}. Ranked with
              the listed sites and tagged Custom.
            </p>
            <div className="flex gap-2">
              <button type="button" className={buttonClass.secondary} onClick={startEdit}>
                Edit
              </button>
              <button type="button" className={buttonClass.secondary} onClick={onRemove}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="max-w-[70ch] text-body text-pretty text-ink-2">
              Any point on Earth, ranked with the listed sites. You choose which directions a rocket may fly from it; the estimate treats them as allowed, but
              they are not range-safety data. Sites far from the equator still get a steep, costly orbit.
            </p>
            <form
              noValidate
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="max-w-full">
                <label htmlFor={`${id}-name`} className={fieldLabel}>
                  Name (optional)
                </label>
                <input
                  id={`${id}-name`}
                  type="text"
                  autoComplete="off"
                  maxLength={60}
                  placeholder={CUSTOM_LAUNCH_DEFAULT_NAME}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${box} w-[13rem] max-w-full`}
                />
              </div>
              <div>
                <label htmlFor={`${id}-lat`} className={fieldLabel}>
                  Latitude
                </label>
                <input
                  id={`${id}-lat`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="28.5 N"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  {...input("lat")}
                  className={`${box} w-[6.5rem]`}
                />
              </div>
              <div>
                <label htmlFor={`${id}-lon`} className={fieldLabel}>
                  Longitude
                </label>
                <input
                  id={`${id}-lon`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="80.6 W"
                  value={lonText}
                  onChange={(e) => setLonText(e.target.value)}
                  {...input("lon")}
                  className={`${box} w-[6.5rem]`}
                />
              </div>
              <div className="max-w-full">
                <label htmlFor={`${id}-dir`} className={fieldLabel}>
                  Allowed launch directions
                </label>
                <SelectField
                  id={`${id}-dir`}
                  value={directions}
                  onChange={(e) => setDirections(e.target.value as LaunchDirections)}
                  wrapClassName="mt-1 w-[17rem] max-w-full"
                >
                  {DIRECTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectField>
              </div>
              {directions === "range" && (
                <>
                  <div>
                    <label htmlFor={`${id}-from`} className={fieldLabel}>
                      From, °
                    </label>
                    <input
                      id={`${id}-from`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 330"
                      value={fromText}
                      onChange={(e) => setFromText(e.target.value)}
                      {...input("from")}
                      className={`${box} w-[5rem]`}
                    />
                  </div>
                  <div>
                    <label htmlFor={`${id}-to`} className={fieldLabel}>
                      To, °
                    </label>
                    <input
                      id={`${id}-to`}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 20"
                      value={toText}
                      onChange={(e) => setToText(e.target.value)}
                      {...input("to")}
                      className={`${box} w-[5rem]`}
                    />
                  </div>
                </>
              )}
              <div className="flex gap-2">
                <button type="submit" className={buttonClass.primary}>
                  {editing ? "Save changes" : "Add launch site"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    onClick={() => {
                      setEditing(false);
                      setProblem(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
            {directions === "range" && (
              <p className="mt-2 max-w-[70ch] text-body text-pretty text-ink-2">
                Degrees clockwise from north: 90 is due east, 180 due south. A range may run through north, for example 330 to 20.
              </p>
            )}
            <div aria-live="polite">
              {problem && (
                <p id={errorId} className="mt-2 max-w-[60ch] text-body leading-snug font-medium text-ink">
                  {problem.message}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
