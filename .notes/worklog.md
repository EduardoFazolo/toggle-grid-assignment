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
  remount from outside), validated only on `onBlur`, same pattern the
  capacity input already used safely. Never touch a date input's `.value`
  while it might still be mid-edit.
