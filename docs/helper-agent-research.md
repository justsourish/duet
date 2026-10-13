# Which cheaper model can do real work on Duet

An open investigation, started 13 October 2026. Duet is built by one person with a small budget. The question: how much of the building can be handed to cheaper AI models, and which one does it best, when the tasks are written carefully by a stronger model and checked by a machine.

How the handover works is in `AGENTS.md` ("If you are a helper agent") and `docs/next-steps.md`.

## What is compared

Each run is one helper task, done by one model at one thinking level, in Antigravity.

- Gemini 3.1 Pro, high thinking. Older, bigger.
- Gemini Flash, high thinking. Newer, smaller. Write the exact version shown in Antigravity.
- Add others as they are tried.

Keep it fair: same task text, a fresh branch from the same starting point, no extra hints. To compare two models on one task, run it twice on two branches, such as `helper/16-fold-layers-pro` and `helper/16-fold-layers-flash`.

## What to write down for every run

| Field | What goes in it |
| --- | --- |
| Date | The day of the run |
| Task | Issue number and name |
| Model and thinking | Exactly as Antigravity names it |
| Time | Minutes from start to its report |
| Check | Did the automatic check pass the first time, after fixes, or never |
| Stayed in its lane | Did it change only the files it was allowed to |
| Click list | How many steps passed when tested by hand, out of how many |
| Help needed | How many times it had to be corrected, and what about |
| Kept or thrown away | Was the work merged |
| Notes | What went wrong, what surprised |

## Runs

| Date | Task | Model and thinking | Time | Check | In its lane | Click list | Help needed | Kept | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | |

## What has been learned

Nothing yet. Write short, dated findings here as they come, so they can become case studies later.
