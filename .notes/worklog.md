# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

- Weeks are Mon-Fri, snapped to the Monday of whatever `from`/`to` land on
  (`date_trunc('week', ...)` in Postgres already starts weeks on Monday).
  Assignments in the seed data do span weekends (e.g. `2025-12-29 Mon ->
  2026-01-04 Sun`), and `weekly_hours` values are clean multiples of 4, both
  pointed at a 5-day work-week model rather than a 7-day one.
- `GET /api/capacity` does the week-bucketing and business-day overlap count
  entirely in one SQL query (weeks CTE + per-assignment LATERAL
  generate_series filtered to isodow < 6). Nothing pulls the 126k assignment
  rows into Go — verified by hand against `psql` for person 1's first week
  (14 rows at 0.5h/day + 1 at 1.0h/day, each fully inside a 5-weekday week =
  40h, matches the API output exactly).
- `PATCH /api/people/{id}` only ever changes `weekly_hours`, never allocated
  hours. So the frontend applies the PATCH response directly to local state
  instead of refetching `/api/capacity` — correct because those two numbers
  are independent, not just a shortcut.
- Noticed in the data: person id 5 (Eli Nakamura) has `weekly_hours = 0` but
  20 allocated hours in one week. Left it as-is and let the grid flag it as
  over-allocated rather than special-casing zero-capacity people — that's
  the kind of thing a manager should see, not something to hide.
- JSON shape: `{ weeks: string[], people: [{ id, name, weeklyHours,
  allocated: { [weekStart]: hours } }] }`. Week keys are the Monday date so
  the frontend can index straight into `allocated[week]`.
- Fixed: rejected edits (negative capacity, From-after-To) used to leave
  the input showing the bad value forever with no feedback. First attempt
  made the date inputs controlled and reverted `.value` on every keystroke
  — broke worse: re-rendering a native `<input type="date">` mid-typing
  (a controlled `value` prop update while a segment is still being edited)
  corrupts its internal segment state, produced literal garbage like
  `"12026-12-29"`. Fix: both date inputs are uncontrolled (`defaultValue`
  + `key={from}`/`key={to}` so the week-nav buttons can still force a
  remount from outside). Never touch a date input's `.value` while it
  might still be mid-edit.
- Revised again after actually using it: committing on blur meant just
  opening the calendar to look around, then clicking elsewhere, silently
  changed the grid. Moved to an explicit "Apply range" button (+ Enter as
  a shortcut) — nothing commits until it's clicked. Added `min`/`max` on
  the date inputs too, so the calendar popup itself grays out impossible
  dates instead of only catching it after the fact.
- One more round: navigating months in the native date picker moves the
  highlighted day and Chrome commits that as `.value`, even with no
  explicit day click — there's no DOM signal that distinguishes "browsed
  past" from "picked." So: blurring a date field without clicking Apply
  now silently reverts it to whatever `from`/`to` currently is (that
  state only changes on a successful Apply, so it's always "the real
  current range" already, no extra bookkeeping). Had to add
  `onMouseDown={preventDefault}` on the Apply button — clicking it
  otherwise blurs the focused date input first (reverting it) before the
  button's own onClick runs, which would silently undo the very value
  you're trying to apply. Verified with focus genuinely held on the
  input (not `fill()`, which turned out to blur internally and made an
  earlier test of this look broken when it wasn't).
