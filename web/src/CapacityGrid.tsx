import { useEffect, useState } from 'react'

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
            // (the week-nav buttons) — an uncontrolled input can't
            // otherwise pick up an external change. Uncontrolled +
            // validate-on-blur is deliberate: making this a controlled
            // input re-renders it mid-typing, which corrupts a native
            // date widget's segment state (verified: produces garbage
            // like "12026-12-29" while typing digit by digit).
            key={from}
            type="date"
            defaultValue={from}
            max={to}
            onBlur={(e) => {
              const next = e.target.value
              if (!next || next > to) {
                e.target.value = from
                flashInvalid(e.target)
                return
              }
              if (next !== from) setFrom(next)
            }}
          />
        </label>
        <label>
          To{' '}
          <input
            key={to}
            type="date"
            defaultValue={to}
            min={from}
            onBlur={(e) => {
              const next = e.target.value
              if (!next || next < from) {
                e.target.value = to
                flashInvalid(e.target)
                return
              }
              if (next !== to) setTo(next)
            }}
          />
        </label>
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
