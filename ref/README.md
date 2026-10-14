# ref

Private. Gitignored. Never leaves this machine.

Two folders, two lifespans:

    references/   durable. keep. this is memory.
    sessions/     disposable. dated working screenshots. this is not memory.

## The rule

Only `references/` is memory.

`references/` holds only material from outside Duet: design inspiration, competitor captures, reference art, video clips. Never a screenshot of Duet itself.

`sessions/` holds anything showing Duet: canvas bugs, UI states, chat captures, working tests. A file in `sessions/` shows what Duet looked like at one moment on one night. Reading it later as current is how you end up solving a problem that was already fixed three rounds ago. When a session or project closes, `sessions/` gets deleted. `references/` stays.

## Dropping things in

Drop files straight into `ref/`. No need to sort them by hand.

Then run:

    bash scripts/ref-tidy/tidy.sh          # dry run, shows the plan
    bash scripts/ref-tidy/tidy.sh --apply  # moves the files

Screenshots of Duet go to `sessions/<date>/` with a clean lowercase name. Outside reference files go to `references/`. Nothing is ever deleted, only moved.

## For agents

Read files here for context when pointed to. Never `git add` anything here except this README.
