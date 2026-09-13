package main

import (
	"net/http"
	"sort"
	"time"
)

// capacityQuery buckets assignments into Mon-Fri weeks and sums allocated
// hours per person per week, entirely in SQL:
//
//  1. weeks: one row per week (Monday..Friday) covering the requested range,
//     snapped to week boundaries so an arbitrary from/to still yields whole
//     weeks.
//  2. overlap: for every (assignment, week) pair that actually overlaps,
//     count the weekdays in the intersection and multiply by hours_per_day.
//     Weekends never count, even if the assignment's date range spans them.
//  3. final SELECT: every person x every week (LEFT JOIN so weeks with no
//     assignment still show 0), summed and grouped in the database.
//
// Nothing here pulls assignment rows into Go — with 126k+ rows that matters.
const capacityQuery = `
WITH weeks AS (
	SELECT gs::date AS week_start, (gs::date + 4) AS week_end
	FROM generate_series(
		date_trunc('week', $1::date)::date,
		date_trunc('week', $2::date)::date,
		interval '1 week'
	) AS gs
),
overlap AS (
	SELECT
		a.person_id,
		w.week_start,
		a.hours_per_day * bd.days AS hours
	FROM assignments a
	JOIN weeks w
		ON a.start_date <= w.week_end
		AND a.end_date >= w.week_start
	CROSS JOIN LATERAL (
		SELECT count(*) AS days
		FROM generate_series(
			GREATEST(a.start_date, w.week_start),
			LEAST(a.end_date, w.week_end),
			interval '1 day'
		) AS d
		WHERE extract(isodow FROM d) < 6
	) bd
)
SELECT
	p.id,
	p.name,
	p.weekly_hours,
	w.week_start,
	COALESCE(SUM(o.hours), 0) AS allocated_hours
FROM people p
CROSS JOIN weeks w
LEFT JOIN overlap o
	ON o.person_id = p.id
	AND o.week_start = w.week_start
GROUP BY p.id, p.name, p.weekly_hours, w.week_start
ORDER BY p.id, w.week_start
`

type capacityPerson struct {
	ID          int                `json:"id"`
	Name        string             `json:"name"`
	WeeklyHours float64            `json:"weeklyHours"`
	Allocated   map[string]float64 `json:"allocated"`
}

type capacityResponse struct {
	Weeks  []string         `json:"weeks"`
	People []capacityPerson `json:"people"`
}

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	fromParam := r.URL.Query().Get("from")
	toParam := r.URL.Query().Get("to")
	if fromParam == "" || toParam == "" {
		http.Error(w, "from and to query params are required (YYYY-MM-DD)", http.StatusBadRequest)
		return
	}

	from, err := time.Parse("2006-01-02", fromParam)
	if err != nil {
		http.Error(w, "invalid from date, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	to, err := time.Parse("2006-01-02", toParam)
	if err != nil {
		http.Error(w, "invalid to date, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}
	if to.Before(from) {
		http.Error(w, "to must not be before from", http.StatusBadRequest)
		return
	}

	rows, err := s.db.Query(r.Context(), capacityQuery, from, to)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	people := map[int]*capacityPerson{}
	var order []int
	weekSet := map[string]struct{}{}

	for rows.Next() {
		var (
			id          int
			name        string
			weeklyHours float64
			weekStart   time.Time
			allocated   float64
		)
		if err := rows.Scan(&id, &name, &weeklyHours, &weekStart, &allocated); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		p, ok := people[id]
		if !ok {
			p = &capacityPerson{ID: id, Name: name, WeeklyHours: weeklyHours, Allocated: map[string]float64{}}
			people[id] = p
			order = append(order, id)
		}

		week := weekStart.Format("2006-01-02")
		p.Allocated[week] = allocated
		weekSet[week] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	weeks := make([]string, 0, len(weekSet))
	for week := range weekSet {
		weeks = append(weeks, week)
	}
	sort.Strings(weeks)

	resp := capacityResponse{Weeks: weeks, People: make([]capacityPerson, 0, len(order))}
	for _, id := range order {
		resp.People = append(resp.People, *people[id])
	}

	writeJSON(w, http.StatusOK, resp)
}
