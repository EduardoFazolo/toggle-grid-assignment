# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

There are things this brief doesn't specify. Which ones did you hit, what did you decide,
and why?

1.  The shape of the JSON returned from the API. Weeks listed once instead of repeated per person, and each person's allocated hours are a map keyed by week-start date instead of an array, so the frontend can just do person.allocated[week] instead of searching through a list every time it draws a cell.
    The shape ended up being (for example): `{ "weeks": ["2025-12-29", ...], "people": [{ "id", "name", "weeklyHours", "allocated": { "<weekStart>": hours } }] }`

2.  What about the exceptions?: exceptions like: negative hours on inputs and From ahead of To have no effects in the UI, and specs don't really mention I should handle exceptions if they were found. I decided to build these exceptions anyways so the screen doesn't look sloppy.

## What did you notice that looked wrong?

Anything in the output that didn't match what you expected. Whether you fixed it or left
it, we want to know you saw it.

- Eli Nakamura: 0 hours available, 20h scheduled for one week. The spec doesn't leave it clear what should happen in cases like this. Should it show some kind of warning saying that person's scheduled needs realocation? I'm not sure.
- I can select a "From" date that is ahead of the current "To" and nothing happens. This should be blocked by default

## What did the AI get wrong that you caught?

One concrete example. Every real session has one.

I like implementing feature by feature, understanding exactly what I'm doing, testing and questioning.
I separated my tasks into 3 todos. Asked Claude to explain me the first one. He explained me, then I said "ok, let's build it, part by part"... He built everything. He understood that HE needed to do the "part by part", and not that I wanted to validate part by part.
That was on me with my wording, but still not a very common mistake for him, and would've been quite annoying if the implementation was way larger.

One other minor thing: when I made Claude fix the issue with user being able to select From date ahead of the To date, it basically just made the From date invalid if you picked it instead of just disabling invalid dates AND it was picking dates on blur, which was horrible and confusing UX. I caught this and fixed it.

## What would you do differently with a week?

- Implement more in-depth e2e tests. I ran an extensive UI validation/testing by letting my agent "stress-test" and cause weird behaviors. This is good for this test, but what I usually do when I have more hours is:

1.  I write e2e for all the happy paths of how the app should work
2.  Then I find these issues exactly by using my iframer.sh browser automation tool, performing a "real human" usage stress test and write them somewhere in a "/docs/" folder
3.  Validate these bugs are real by implementing the biased e2e tests, confirming the bugs exist.
4.  If they exist, fix them, run all e2e again to make sure the fixes didn't break previous
5.  Rinse and repeat. This has proven to be EXTREMELY valuable to keep prod-working workflows bug-free when new big features, changes and refactors are implemented.
