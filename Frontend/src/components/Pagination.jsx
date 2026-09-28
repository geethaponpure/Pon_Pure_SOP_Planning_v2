import React, { useEffect, useState } from "react";

// Client-side pagination for already-fetched rows. Keeps the DOM small even with
// thousands of rows by rendering only the current slice.
//
//   const pg = usePagination(filteredRows, [q, seg, sort]);
//   ...
//   <tbody>{pg.pageRows.map(...)}</tbody>
//   <Pagination {...pg} />
//
// Pass every filter/sort value the row list depends on as `deps` so the view
// jumps back to page 1 when the data changes.
export function usePagination(rows, deps = [], initialSize = 100) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialSize);

  // reset to first page whenever the filters or page size change
  useEffect(() => { setPage(1); }, [...deps, pageSize]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pageCount);
  const start = (cur - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return { pageRows, page: cur, pageCount, pageSize, setPage, setPageSize, total, start };
}

// Minimal, center-aligned pagination (modeled on Untitled UI's PaginationCardMinimal):
// Previous · "Page X of Y" · Next, pinned to the bottom of the scroll area so it's
// always visible without scrolling to the end of a long table.
export default function Pagination({ page, pageCount, setPage, total, align = "center" }) {
  if (!total) return null;
  return (
    <div className={`pagination-bar align-${align}`}>
      <button
        type="button"
        className="pg-btn pg-prev"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        ‹ Previous
      </button>
      <span className="pg-indicator">Page {page} of {pageCount}</span>
      <button
        type="button"
        className="pg-btn pg-next"
        disabled={page >= pageCount}
        onClick={() => setPage(page + 1)}
      >
        Next ›
      </button>
    </div>
  );
}
