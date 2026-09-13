package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type updatePersonRequest struct {
	WeeklyHours float64 `json:"weeklyHours"`
}

type person struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weeklyHours"`
}

// handleUpdatePerson serves PATCH /api/people/{id}
//
// It only changes capacity (weekly_hours) — it never touches allocated
// hours, so the frontend can apply the returned person directly to its
// state instead of refetching /api/capacity.
func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var req updatePersonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.WeeklyHours < 0 {
		http.Error(w, "weeklyHours must not be negative", http.StatusBadRequest)
		return
	}

	var p person
	err = s.db.QueryRow(
		r.Context(),
		`UPDATE people SET weekly_hours = $1 WHERE id = $2 RETURNING id, name, weekly_hours`,
		req.WeeklyHours, id,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)

	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "person not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, p)
}
