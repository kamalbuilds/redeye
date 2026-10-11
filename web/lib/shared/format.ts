export const usd = (n: number, d = 2) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const tokens = (n: number) => Number(n.toFixed(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });

const stamp = (ms: number, timeZone: string, withDate: boolean) =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone,
    ...(withDate ? { weekday: "short", day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

/** "Mon, 12 Oct, 5:35 am" in Mumbai time. Callers append the zone name. */
export const istTime = (ms: number) => stamp(ms, "Asia/Kolkata", true);

/** "5:35 am IST (8:05 am SGT)": the date once, then both clocks. */
export const istAndSgt = (ms: number) => `${istTime(ms)} IST (${stamp(ms, "Asia/Singapore", false)} SGT)`;
