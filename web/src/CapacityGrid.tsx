import { useEffect, useRef, useState } from 'react'

type Props = {
  from: string
  to: string
}

type CapacityResponse = {
  weeks: string[]
  people: {
    id: number
    name: string
    weeklyHours: number
    allocated: Record<string, number>
  }[]
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Flashes an input red + shakes it for a moment. Pure DOM, no React state,
// no re-render — safe to call from any input in a 500-row table without
// touching render performance.
function flashInvalid(el: HTMLInputElement) {
  el.classList.remove('field-invalid')
  void el.offsetWidth // restart the animation if it's already mid-flash
  el.classList.add('field-invalid')
}

function formatWeek(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00Z')
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 4)
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// It owns its own visible date range (seeded from props, then moved by the
// week-nav buttons or the date pickers), and fetches from
// GET /api/capacity?from=&to= whenever that range changes.
export function CapacityGrid({ from: initialFrom, to: initialTo }: Props) {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const fromInputRef = useRef<HTMLInputElement>(null)
  const toInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)

    fetch(`/api/capacity?from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json() as Promise<CapacityResponse>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })

    return () => {
      cancelled = true
    }
  }, [from, to])

  function shiftWeek(direction: 1 | -1) {
    setFrom((f) => addDays(f, 7 * direction))
    setTo((t) => addDays(t, 7 * direction))
  }

  // Nothing in the date fields takes effect until this is clicked —
  // opening the calendar to browse, or leaving a field mid-edit, must
  // never silently change what the grid shows. Reads straight off the
  // DOM via refs instead of state, since the inputs are intentionally
  // uncontrolled (see the comment on the inputs below for why).
  function applyRange() {
    const nextFrom = fromInputRef.current?.value
    const nextTo = toInputRef.current?.value
    let ok = true

    if (!nextFrom || (nextTo && nextFrom > nextTo)) {
      if (fromInputRef.current) flashInvalid(fromInputRef.current)
      ok = false
    }
    if (!nextTo || (nextFrom && nextTo < nextFrom)) {
      if (toInputRef.current) flashInvalid(toInputRef.current)
      ok = false
    }
    if (!ok || !nextFrom || !nextTo) return

    setFrom(nextFrom)
    setTo(nextTo)
  }

  async function saveWeeklyHours(personId: number, weeklyHours: number) {
    setSavingId(personId)
    try {
      const res = await fetch(`/api/people/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyHours }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const updated = (await res.json()) as { id: number; weeklyHours: number }

      // Editing capacity never changes allocated hours, so patch the one
      // field locally instead of refetching /api/capacity.
      setData((current) =>
        current
          ? {
              ...current,
              people: current.people.map((p) =>
                p.id === personId ? { ...p, weeklyHours: updated.weeklyHours } : p,
              ),
            }
          : current,
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div className="controls">
        <button type="button" onClick={() => shiftWeek(-1)}>
          &larr; Previous week
        </button>
        <button type="button" onClick={() => shiftWeek(1)}>
          Next week &rarr;
        </button>
        <label>
          From{' '}
          <input
            // key forces a clean remount when from changes from outside
            // (the week-nav buttons, or a successful Apply) — an
            // uncontrolled input can't otherwise pick up an external
            // change. Uncontrolled is deliberate: a controlled `value`
            // re-renders the input mid-typing, which corrupts a native
            // date widget's segment state (verified: produces garbage
            // like "12026-12-29" while typing digit by digit). Nothing
            // commits until Apply is clicked — see applyRange.
            key={from}
            ref={fromInputRef}
            type="date"
            defaultValue={from}
            max={to}
            onKeyDown={(e) => e.key === 'Enter' && applyRange()}
            onBlur={(e) => {
              // Browsing the calendar (changing months, etc.) without
              // explicitly picking a day still changes .value natively —
              // there's no way to tell "looked around" apart from
              // "picked a date" at the DOM level. So: leaving the field
              // without clicking Apply always snaps back to whatever the
              // grid is actually showing, silently, no flash — this
              // isn't an error, just "you didn't confirm it."
              if (e.target.value !== from) e.target.value = from
            }}
          />
        </label>
        <label>
          To{' '}
          <input
            key={to}
            ref={toInputRef}
            type="date"
            defaultValue={to}
            min={from}
            onKeyDown={(e) => e.key === 'Enter' && applyRange()}
            onBlur={(e) => {
              if (e.target.value !== to) e.target.value = to
            }}
          />
        </label>
        <button
          type="button"
          // Clicking this button shifts focus away from whichever date
          // input is focused, which fires that input's onBlur BEFORE
          // this button's onClick runs — and that onBlur would revert
          // the very value we're about to apply. preventDefault on
          // mousedown stops the focus shift (and thus the blur) from
          // happening at all, so onClick below sees the real, intended
          // value.
          onMouseDown={(e) => e.preventDefault()}
          onClick={applyRange}
        >
          Apply range
        </button>
      </div>

      {error && <p className="error">Failed to load: {error}</p>}
      {!data && !error && <p>Loading…</p>}

      {data && (
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Weekly capacity</th>
              {data.weeks.map((week) => (
                <th key={week}>{formatWeek(week)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.people.map((person) => (
              <tr key={person.id}>
                <td>{person.name}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={person.weeklyHours}
                    disabled={savingId === person.id}
                    onBlur={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isNaN(next) || next < 0) {
                        e.target.value = String(person.weeklyHours) // reject: bounce back, never leave it lying
                        flashInvalid(e.target)
                        return
                      }
                      if (next !== person.weeklyHours) {
                        saveWeeklyHours(person.id, next)
                      }
                    }}
                  />
                  h
                </td>
                {data.weeks.map((week) => {
                  const allocated = person.allocated[week] ?? 0
                  const over = allocated > person.weeklyHours
                  return (
                    <td key={week} className={over ? 'over' : undefined}>
                      {allocated}h
                      {person.weeklyHours > 0 && (
                        <span className="pct"> ({Math.round((allocated / person.weeklyHours) * 100)}%)</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
