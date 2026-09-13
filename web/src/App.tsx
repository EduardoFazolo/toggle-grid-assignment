import { CapacityGrid } from './CapacityGrid'

// The range the grid loads. Widen it if you want to see more.
const FROM = '2025-12-29'
const TO = '2026-01-16'

export function App() {
  return (
    <main>
      <h1>Team capacity</h1>
      <CapacityGrid from={FROM} to={TO} />
    </main>
  )
}
