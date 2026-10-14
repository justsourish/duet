# scratch-tidy

`scratch/` is where working images pile up: renders an agent made to check its
own work, crops, screenshots dropped in mid conversation. They are useful on
the night and noise a week later, and when they sit in the root they bury the
documents that actually matter.

Same shape as `ref-tidy`, and the same promise: it never deletes, only moves.

## Run

    cd scripts/scratch-tidy
    bash tidy.sh              # dry run, prints the plan
    bash tidy.sh --apply      # actually move

## The rule

- Images go to `scratch/sessions/<date>/`, dated by when the file was written,
  renamed to lower case with dashes.
- Everything else stays: documents (.duet), folders, and design sources.
- Add filenames to `KEEP` in `tidy.sh` if a design source is an image that should stay in the root.

`scratch/` is gitignored, so nothing here is tracked. That is also why it is
worth tidying: git will not do it for you.
