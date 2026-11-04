/** A moment's words, for whatever writes a date in a name or a property. Pure. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (n: number): string => String(n).padStart(2, "0");

export function dateWords(d: Date): Record<"YYYY" | "YY" | "MMMM" | "MMM" | "MM" | "M" | "DD" | "D" | "dddd" | "ddd" | "HH" | "H" | "hh" | "h" | "mm" | "ss" | "A" | "a", string> {
  const h12 = d.getHours() % 12 || 12;
  return {
    YYYY: String(d.getFullYear()), YY: two(d.getFullYear() % 100),
    MMMM: MONTHS[d.getMonth()]!, MMM: MONTHS[d.getMonth()]!.slice(0, 3), MM: two(d.getMonth() + 1), M: String(d.getMonth() + 1),
    DD: two(d.getDate()), D: String(d.getDate()), dddd: DAYS[d.getDay()]!, ddd: DAYS[d.getDay()]!.slice(0, 3),
    HH: two(d.getHours()), H: String(d.getHours()), hh: two(h12), h: String(h12), mm: two(d.getMinutes()), ss: two(d.getSeconds()),
    A: d.getHours() < 12 ? "AM" : "PM", a: d.getHours() < 12 ? "am" : "pm",
  };
}
