// Click-to-sort column headers for the dashboard card tables.
//
//   const grp = useSort(groupRows, { key: "kg", dir: "desc" });
//   <SortTh label="Items" k="items" {...grp.th} style={{ ...HCELL, textAlign: "right" }} />
//   {grp.rows.map(...)}
//
// A column reads row[k] unless the `get` map passed to useSort supplies a reader
// for that key — for columns that only exist on screen (a percentage worked out
// while rendering, say). Keep that map module-level or memoised: it is a sort
// dependency. Blank values always sink to the bottom, whichever way the column
// points, so an empty cell never buries the numbers you asked to see.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

const isBlank = (v) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

export function applySort(rows, { key, dir }, get) {
  if (!key) return rows;
  const read = (r) => (get && get[key] ? get[key](r) : r[key]);
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = read(a), vb = read(b);
    if (isBlank(va) || isBlank(vb)) {
      return isBlank(va) && isBlank(vb) ? 0 : isBlank(va) ? 1 : -1;
    }
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * s;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * s;
  });
}

// `initial` may be { key: null } — then the rows keep the order the backend sent
// (usually already ranked) until the user actually clicks a column.
export function useSort(rows, initial = { key: null, dir: "desc" }, get) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => applySort(rows || [], sort, get), [rows, sort, get]);
  return { rows: sorted, sort, setSort, th: { sort, setSort } };
}

// `dir0` is the direction the first click applies — descending for figures
// (biggest first is what you want to see), ascending for names.
export function SortTh({ label, k, sort, setSort, style, dir0 = "desc", title, children }) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
  const flip = () => setSort((s) => (s.key === k
    ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
    : { key: k, dir: dir0 }));
  return (
    <th className={`sort-th${active ? " is-sorted" : ""}`} style={style}
      onClick={flip} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      title={title || `Sort by ${typeof label === "string" ? label : k}`}>
      <span className="sort-th-in">
        {children || label}
        <Icon className="sort-th-ic" size={12} strokeWidth={2.25} aria-hidden />
      </span>
    </th>
  );
}
