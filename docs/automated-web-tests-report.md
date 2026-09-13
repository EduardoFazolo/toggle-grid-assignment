# Automated web tests report

10 stress tests run against the live app (`localhost:3000` + `localhost:8080`)
using a scripted headless browser, separate from manual click-through
testing. Goal was to find things that only show up under repeated
interaction, edge-case input, or ranges far from the default window.

Environment note: the test browser's timezone was `America/Sao_Paulo`
(UTC-3). That's directly relevant to finding #1.

## Findings

### 1. Week labels are off by one calendar day (timezone bug)

`formatWeek()` in `CapacityGrid.tsx` builds a UTC-midnight `Date` from the
week-start string, then calls `.toLocaleDateString()` without pinning a
timezone. `toLocaleDateString` renders in the *browser's local* timezone,
so in any timezone behind UTC the displayed date rolls back a day.

Confirmed: after navigating forward, the API returned week start
`2026-03-09` (a real Monday), but the column header showed **"Mar 8 – Mar
12"**. Verified the API/query is correct; only the display is wrong.

Affects every timezone west of UTC (all of the Americas). Doesn't affect
the numbers, only what week they appear to be for.

**Fix direction**: format with an explicit `timeZone: 'UTC'` option, or
build the display string directly from the `YYYY-MM-DD` parts instead of
going through a `Date` + locale formatter.

### 2. Week headers never show a year

`formatWeek()` only renders month + day ("Mar 23 – Mar 27"). Navigate far
enough (via "Previous week"/"Next week", or a manual date-range pick) and
you cross a year boundary with no visual indicator. During testing this
caused a real mix-up: a March-2025 range and a March-2026 range were
briefly indistinguishable in the header text.

**Fix direction**: show the year, at least when it differs from the
other visible weeks, or always show it for clarity.

### 3. A rejected date-range edit leaves the picker showing a stale/blank value — FIXED

Setting `From` to a date after the current `To` is correctly rejected
(the app's `handleRangeChange` returns early, table doesn't change, no
crash). But since no state update happens, React never re-asserts the
input's controlled `value`, so the native `<input type="date">` is left
showing whatever the browser rendered from the rejected input, in
testing this came out as a **blank field**, not the last-valid date.

Net effect: the date picker visibly shows nothing, the table still shows
the old (correct) range, and there's no error message tying the two
together. A user would reasonably think something broke.

**Fix applied**: input is now uncontrolled (`defaultValue` + `key` so the
week-nav buttons can still force it to a new value from outside),
validated on blur, reverts to the real value and flashes red if rejected.
Note: an earlier attempt made it a controlled input that reverted
`.value` on every keystroke, that made it worse — see `.notes/worklog.md`
for why.

### 4. Rejected capacity edits give zero feedback — FIXED

Typing a negative number into a capacity cell and tabbing away is
correctly blocked client-side (confirmed no network request fires), but
the input is uncontrolled (`defaultValue`) and never resets. It's left
showing the invalid number indefinitely, no error, no revert, nothing
distinguishing "saved" from "rejected" from "never touched".

**Fix applied**: reverts to the last known-good value and flashes red on
rejection, same pattern as #3.

### 5. Wide date ranges scroll the whole page, not just the table

Set the range to ~4 months (Dec 29 → May 1): the grid rendered fine at
500 rows × 20 week-columns, no crash, no real slowdown (query stayed
fast). But there's no scroll container around the table, so the whole
document became wider than the viewport (1525px content in a 1280px
viewport) and the page scrolls sideways. The "Person" column isn't
sticky either, so scrolling right to see later weeks loses track of
which row is which person.

**Fix direction**: wrap the table in an `overflow-x: auto` container and
consider `position: sticky` on the first column.

## What held up

- Week-navigation math: Previous/Next week correctly shifts by 7 days,
  including across year boundaries (the underlying dates were right,
  only the label was wrong — see #1/#2).
- A non-Monday `From` date (tested a Wednesday) snaps to the correct
  Mon-Fri week, matching the `date_trunc('week', ...)` behavior in the
  SQL.
- Navigating far outside the seeded data range (both directions) shows
  clean zeros, no errors, no crash.
- Editing the same person's capacity twice in a row, and editing right
  after a previous save, both work.
- A capacity edit persists correctly across a full page reload; the
  visible date range correctly resets to the hardcoded default (it's
  not persisted, by design).
- 500 people × 20 week columns rendered and fetched in ~1.2s, no
  performance concern found at this scale.

## Not a bug, but worth restating here

Eli Nakamura (person id 5) has `weekly_hours = 0` but real allocated
hours some weeks. The grid does correctly flag this as over-allocated
(same red background as any other over-allocation), it just doesn't show
a percentage next to it, since `allocated / 0` isn't a number worth
displaying. Already covered in `.notes/worklog.md`; this is a modeling
question for `DECISIONS.md`, not a defect found by these tests.

## Cleanup note

Two people's `weekly_hours` were mutated as part of this test pass (Cem
Aydin during PATCH validation testing, Bo Lindqvist during the
large-value test). Both were restored to their seeded values
(20 and 40 respectively) after testing.
