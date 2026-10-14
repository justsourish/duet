# scratch

Scratch space. Never tracked by git.

Temporary files, test projects, exports, and throwaway agent output go here.

Only this README is committed. Everything else is gitignored, stays on this machine, and can be cleared out at any time.

To tidy working images into dated session folders without deleting anything:

    bash scripts/scratch-tidy/tidy.sh          # dry run
    bash scripts/scratch-tidy/tidy.sh --apply  # moves images to sessions/<date>/
