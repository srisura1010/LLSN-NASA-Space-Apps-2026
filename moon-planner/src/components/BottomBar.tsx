type Props = {
  startDate: string; // yyyy-mm-dd
  onStartDateChange: (value: string) => void;
  hourOffset: number;
  onHourOffsetChange: (value: number) => void;
  currentTime: Date;
  sunElevation: number | null;
  earthElevation: number | null;
};

const HOURS_IN_LUNAR_DAY = 709;

export default function BottomBar(props: Props) {
  return (
    <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 px-4 py-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-zinc-400">Start</span>
        <input
          type="date"
          value={props.startDate}
          onChange={(e) => props.onStartDateChange(e.target.value)}
          className="rounded bg-zinc-800 px-2 py-1"
        />
      </label>

      <label className="flex flex-1 items-center gap-2">
        <span className="text-zinc-400">Time</span>
        <input
          type="range"
          min={0}
          max={HOURS_IN_LUNAR_DAY}
          value={props.hourOffset}
          onChange={(e) => props.onHourOffsetChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-44 font-mono text-xs">
          {props.currentTime.toISOString().slice(0, 16).replace("T", " ")} UTC
        </span>
      </label>

      <Readout label="Sun" value={props.sunElevation} goodWord="sunlit" badWord="dark" />
      <Readout label="Earth" value={props.earthElevation} goodWord="in view" badWord="hidden" />
    </footer>
  );
}

function Readout(props: { label: string; value: number | null; goodWord: string; badWord: string }) {
  if (props.value === null) {
    return <span className="text-zinc-500">{props.label}: pick a site</span>;
  }
  const up = props.value > 0;
  return (
    <span>
      {props.label}: <span className="font-mono">{props.value.toFixed(1)}°</span>{" "}
      <span className={up ? "text-emerald-400" : "text-rose-400"}>
        {up ? props.goodWord : props.badWord}
      </span>
    </span>
  );
}
