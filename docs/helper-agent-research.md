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
| 13 Oct 2026 | 16, fold layers | Gemini 3.8 Flash, high | 11 min | Passed after one fix, in its own test | Yes, the four files allowed | 5 of 5, tested in the browser preview by the main AI, not by hand | None | Kept | The hand test was dropped: the app opened a real project and the steps were hard to follow. Rows with no arrow sit a little left of rows with one. One save, right author. Branch `helper/16-fold-layers`. Prompt was the task text pasted in, with a line asking for its model and times. |
| 13 Oct 2026 | 16, arrow gap | gemini-3.8-flash-high | 5 min | Passed | Yes | Not clicked. The six changed lines were read by the main AI | None | Kept | Started by the main AI with `scripts/helper.py`. 206,179 helper tokens. Branch `helper/16-arrow-gap`. |
| 13 Oct 2026 | 12, video cut | gemini-3.8-flash-high | 9 min | Passed | Yes | Checked by the main AI in Duet dev: bring in, trim, reorder and export worked. Playing was not checked | None | Kept | 590 lines for a brief of about 350 words. Started by the main AI with `scripts/helper.py`. 398,220 helper tokens. Branch `helper/12-video-cut`. |
| 13 Oct 2026 | 44, settings screen | gemini-3.8-flash-high | 12 min | Passed | Yes | Not tested yet | None | Not decided | Started by the main AI with `scripts/helper.py`. 517,709 helper tokens. Branch `helper/44-settings-screen`. |
| 13 Oct 2026 | 45, mode switch | gemini-3.8-flash-high | 12 min | Passed | Yes | Not tested yet | None | Not decided | Started by the main AI with `scripts/helper.py`. 330,811 helper tokens. Branch `helper/45-mode-switch`. |
| 13 Oct 2026 | 50, cut look | gemini-3.8-flash-high | 17 min | Passed | Yes | Not tested yet | None | Not decided | Started by the main AI with `scripts/helper.py`. 455,799 helper tokens. Branch `helper/50-cut-look`. |

## What has been learned

Write short, dated findings here as they come, so they can become case studies later.

- 13 Oct 2026. Started from the terminal with no one clicking, Antigravity edits files, runs commands and saves. It reports its own tokens, so the cost of a run is a measured number.
- 13 Oct 2026. A six line fix cost the helper 206,179 tokens and 5 minutes. The main AI spent a task of about a hundred words and read a summary of a dozen lines. So the main AI saved, but the helper's subscription paid a lot for very little. Tiny fixes are better done directly. Hand over work that is big to write and easy to check.
- 13 Oct 2026. A task that asks the helper to run the app, or to check a drag on the canvas, cannot be handed over this way yet.
