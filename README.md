# CPU Scheduling Co-Op — Live Class Tournament

A gamified, real-time multiplayer web app for teaching CPU scheduling. Students join
in groups of up to 8, build a **shared** Gantt chart that syncs live across every
teammate's device, and compete across six progressively harder rounds.

Everything is one self-contained `index.html`. No build step, no npm, no server code.

---

## Status: configured and live

This copy is already pointed at the **`os-scheduling-27bcf`** Realtime Database
(`asia-southeast1`). Verified end to end: two students joined a room from separate
browsers, saw the same generated problem, shared one Gantt board in real time, scored
254 points, and the presence roster self-cleaned when a tab closed.

Just open `index.html` (or serve it — see hosting below) and press **Create Room**.

> **Before class, check your database rules.** If you created the database in *test
> mode*, Firebase auto-expires those rules ~30 days after creation and every read and
> write starts failing — which would take the app down mid-lecture. Paste the rules in
> the next section to remove that expiry.

**Offline Practice Mode.** If `apiKey` is ever reverted to a `PASTE_…` placeholder, the
app falls back to a BroadcastChannel stand-in that syncs across tabs on one machine —
useful for rehearsing without touching the live database. A purple badge marks it.

---

## Firebase configuration

The config lives near the top of the `<script>` block in `index.html`. The
`databaseURL` line is the one that actually matters — note it carries the
`asia-southeast1` region; the default `firebaseio.com` form will not connect.

To point this at a different project: Firebase console → **Project settings → General →
Your apps → Web (`</>`)**, copy the `firebaseConfig` object, and replace the existing one.

**Realtime Database → Rules.** These allow anonymous classroom play while blocking
   the obvious griefing — nobody can delete a whole room, and scores are bounded:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        "meta": {
          ".write": "newData.exists()"
        },
        "rounds": {
          ".write": "newData.exists()"
        },
        "teams": {
          "$team": {
            ".write": true,
            "name": {
              ".validate": "newData.isString() && newData.val().length <= 40"
            },
            "scores": {
              "$round": {
                ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 500"
              }
            },
            "members": {
              "$uid": {
                ".validate": "newData.hasChildren(['name'])"
              }
            }
          }
        }
      }
    }
  }
}
```

What these do: anyone with the room code can read it; nobody can delete a room's `meta`
or `rounds` wholesale (`newData.exists()` blocks null writes); round scores must be
numbers in 0–500 (the theoretical maximum is 440 — 100 + 100 + a 240s speed bonus); and
team names are capped at 40 characters.

**The 8-member cap is not in these rules**, because Realtime Database rules cannot count
child nodes — there is no `getChildren()` or equivalent. The cap is enforced client-side
by an atomic transaction on the members node, which is race-safe against a whole class
joining simultaneously (verified: members 3–8 admitted, the 9th rejected). If you need it
enforced server-side, maintain an explicit `memberCount` field and validate against that.

These rules are deliberately permissive so students need no accounts, and unlike test-mode
defaults they carry **no expiry date**. Scores are computed client-side, so treat the
exported CSV — not the live board — as the record of truth. If you want tamper
resistance, enable Firebase Anonymous Auth and restrict `teams/$team` writes to members
of that team.

**Hosting.** Anywhere static: GitHub Pages, a Netlify drop, or your LMS file upload. One
HTML file is all you need to distribute. Note the API key is visible in the page source —
that is normal and expected for Firebase web apps (the key identifies the project, it does
not grant access); your database rules are what actually control who can read and write.

---

## Running a class

**Teacher**

1. Open the app → **Create Room**. A code like `CPU-58` appears. Put it on the projector.
2. Wait for the lobby roster to fill, then **Start Round 1**.
3. During a round you can **Reveal Answer** to walk through the correct Gantt chart and
   averages on screen.
4. **Next Round** advances everyone simultaneously. After Round 6, **End Tournament**.
5. **Export All Scores to CSV** — available on the host console and the results screen.

**Students**

1. Enter the room code, pick their group, type their name. (`58` alone works as
   shorthand for `CPU-58`.)
2. Tap a process chip, then tap timeline slots to place it. Tap **Erase** then a slot to
   clear it. On a mouse you can also drag chips onto the timeline.
3. Any teammate can enter the average TAT and WT and hit **Submit** — it grades the
   whole team's shared board.

---

## Rounds and scoring

| # | Algorithm | Time |
|---|-----------|------|
| 1 | First-Come, First-Served | 90s |
| 2 | Priority (Non-Preemptive) | 120s |
| 3 | Shortest Job First | 150s |
| 4 | Priority (Preemptive) | 180s |
| 5 | Shortest Remaining Time First | 210s |
| 6 | Round Robin (quantum q) | 240s |

```
correct Gantt chart              +100
correct average TAT and WT       +100
speed bonus            +1 per whole second left (only on a fully correct answer)
wrong submission                  −20 each, 3 attempts max
```

Round scores never go below 0. Priority numbers use **1 = highest**.

---

## Design notes

**Every group gets the same problem.** Problems are generated from a seeded PRNG keyed
to `hash(roomCode) + roundIndex`, and the teacher writes the result to
`rooms/{code}/rounds/{n}/problem` when starting the round. Students read from the
database rather than generating locally, so the seed guarantees reproducibility and the
write guarantees a single source of truth.

**Every problem has exactly one correct answer.** Ties are where scheduling problems
become disputable — two students can apply different tiebreak conventions and both be
defensible. The generator replays each candidate problem and rejects it if any dispatch
decision has a non-unique winner on the deciding key. For Round Robin it additionally
rejects problems where a process arrives at the exact instant a quantum expires, since
arrival-vs-requeue ordering is genuinely convention-dependent. Roughly 37% of random
SRTF candidates are discarded this way.

**The board is wider than the answer.** Slot count is `max(arrival) + sum(bursts)`, an
upper bound on the true schedule length. Students must work out where the schedule ends
themselves — trailing empty slots are correct, and an empty slot inside the schedule
means CPU idle.

**Timers are server-anchored.** Clients render `startAt + duration − serverNow()` using
Firebase's `serverTimeOffset`, so a student who refreshes or joins late sees the correct
remaining time rather than a fresh countdown.

**Slot writes are transactional.** Placing a block paints optimistically, then commits
via a transaction. If a teammate won the slot, the cell snaps back with a shake and a
toast naming them.

---

## Verifying it yourself

Open `index.html?selftest=1`. This runs the scheduling solvers against the textbook
examples from Silberschatz *Operating System Concepts* Ch. 6 (FCFS, SJF, SRTF,
Priority, Round Robin), sweeps 400 generated problems per algorithm asserting none is
ambiguous, and checks determinism and the scoring formula. Expect **14 passed, 0 failed**.

For the deeper suite:

```
node test/run-tests.js     # 52 assertions
```

This sweeps 5,000 seeds per algorithm checking ambiguity, burst conservation, board-width
sufficiency and length bounds, plus determinism and grading edge cases. It does **not**
carry its own copy of the solvers — it slices the `§2 CORRECTNESS CORE` section out of
`index.html` and evaluates that, so the tests cannot pass against a stale duplicate while
the shipped app is broken. If you rename those section banners, the harness will tell you
rather than silently testing nothing.

---

## Accessibility

- Contrast: all text meets WCAG AA (4.5:1). The bright accent colors — notably gold
  `#FFD700`, which is ~1.2:1 on white — are used only as fills behind dark text or as
  borders and glows, never as text on the light background. Process block colors are
  darkened variants paired with verified text colors.
- Full keyboard path: arrow keys move along the timeline (roving tabindex), Home/End
  jump to the ends, Enter or Space places the selected process.
- Every tap target is at least 44×44px.
- `prefers-reduced-motion` disables confetti, the mascot float, the timer pulse, and all
  transform-based animation while keeping color and state feedback intact.
- The timeline scrolls inside its own container; the page never scrolls horizontally.
  Verified at 375, 768, 1024, and 1440px.

---

## Known limitations

- Scores are computed and written client-side. Fine for a supervised classroom; not
  tamper-proof. Use the CSV export as the record of truth.
- Offline Practice Mode is single-machine only.
- Group count is fixed at 8 (`TEAM_IDS`) with 8 members each — 64 students. Both are
  constants near the top of the script if you need more.
- The Firebase CDN is loaded at runtime, so the live mode needs internet access.
