#!/usr/bin/env python3
"""Hand one small task to a helper agent (Antigravity) and get back a short summary.

    scripts/helper.py run 16 fold-layers --task "three lines of what to do"
    scripts/helper.py keep 16 fold-layers     bring its work onto main, clear up
    scripts/helper.py drop 16 fold-layers     throw its work away, clear up
    scripts/helper.py status                  is a helper working right now

The helper works in its own copy of the code, beside this folder in duet-helpers/, on its own
branch, so it cannot disturb the work here. Everything it does is written, as it happens, to
duet-helpers/logs/<issue>-<words>.log. Watch it with: tail -f <that file>.
The rules it follows are in AGENTS.md ("If you are a helper agent"), so a task stays short.
Two helpers at most at a time, each with a time limit, so they cannot use up a day of the subscription.
Give two helpers that work side by side different files, or keeping the second will clash with the first.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip())
HOME = ROOT.parent / "duet-helpers"
LOGS = HOME / "logs"
LOCK = HOME / "working.json"
RESEARCH = ROOT / "docs" / "helper-agent-research.md"
# the same list the check in .githooks/pre-commit refuses on a helper branch
BLOCKED = re.compile(r"^(src-tauri/|src/project/|src/memory/|src/state/|src/document/serialize|src/ai/tools\.ts|\.github/|\.githooks/|AGENTS\.md|LICENSE|package\.json|package-lock\.json)")

PROMPT = """You are a helper agent on the Duet project. Read AGENTS.md first, the part called "If you are a helper agent". Those rules are yours.
You are already in your own copy of the code, on the branch {branch}. Stay on it. Do not make or switch branches. Do not push.

Task (issue {issue}):
{task}

Must pass before you save: npx tsc --noEmit and npm test.
Save once, with a message a designer would understand. Then end with a report of at most eight lines: the files you changed, whether the checks passed the first time or after fixes, and anything you could not do."""


def git(*args, cwd=ROOT, check=True):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=check).stdout.strip()


def names(issue, words):
    slug = f"{issue}-{words}"
    return f"helper/{slug}", HOME / slug, LOGS / f"{slug}.log"


AT_ONCE = 2


def working():
    """The runs that are going on now. Each has its own note beside the logs, cleared when it ends."""
    runs = []
    for note in sorted(HOME.glob("working*.json")):
        try:
            run = json.loads(note.read_text())
            os.kill(run["pid"], 0)
            runs.append(run)
        except (OSError, ValueError, KeyError):
            note.unlink(missing_ok=True)
    return runs


def passes(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True).returncode == 0


def follow(proc, log):
    """Write what the helper does to the log as it happens. Returns its last words and what it used."""
    said, last, used, status = "", "", {"input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0}, "no answer"
    for line in proc.stdout:
        try:
            event = json.loads(line)
        except ValueError:
            log.write(line)
            continue
        if event.get("event") == "step_update":
            step = event["step_update"]
            if step.get("step_type") == "tool":
                info = step.get("tool_info", {})
                if step.get("state") == "ACTIVE":
                    what = json.dumps(info.get("parameters", {}))
                    log.write(f"  > {step.get('tool_name')} {what[:300]}\n")
                elif "output" in info and step.get("tool_name") == "run_command":
                    tail = str(info["output"]).replace("\r", "").strip().splitlines()[-6:]
                    log.write("".join(f"      {t[:200]}\n" for t in tail))
            elif step.get("step_type") == "agent_response":
                said += step.get("text_delta", "")
                if step.get("state") == "DONE" and said.strip():
                    log.write(f"\n{said.strip()}\n\n")
                    last, said = said.strip(), ""
        elif event.get("event") == "result":
            result = event["result"]
            status = result.get("status", status)
            last = (result.get("response") or last).strip()
            for key in used:
                used[key] = result.get("usage", {}).get(key, 0)
        log.flush()
    return last, used, status


def add_row(row):
    text = RESEARCH.read_text()
    head, runs = text.split("## Runs", 1)
    lines = runs.split("\n")
    at = max(i for i, l in enumerate(lines) if l.startswith("|"))
    lines.insert(at + 1, row)
    RESEARCH.write_text(head + "## Runs" + "\n".join(lines))


def run(a):
    task = (a.task or sys.stdin.read()).strip()
    if not task:
        sys.exit("No task. Give --task, or pipe it in.")
    busy = working()
    if len(busy) >= AT_ONCE:
        sys.exit(f"{len(busy)} helpers are already working: {', '.join(b['branch'] for b in busy)}. No more than {AT_ONCE} at a time.")
    branch, copy, logfile = names(a.issue, a.words)
    lock = HOME / f"working-{a.issue}-{a.words}.json"
    if copy.exists() or git("branch", "--list", branch):
        sys.exit(f"{branch} is already there. Keep it or drop it first.")
    LOGS.mkdir(parents=True, exist_ok=True)
    git("worktree", "add", "-q", "-b", branch, str(copy), "main")
    # the copy shares the installed packages, and never saves the link to them
    (copy / "node_modules").symlink_to(ROOT / "node_modules")
    exclude = (ROOT / git("rev-parse", "--git-common-dir")) / "info" / "exclude"
    if "node_modules" not in exclude.read_text().split():
        exclude.write_text(exclude.read_text() + "node_modules\n")

    start = time.time()
    with logfile.open("w") as log:
        log.write(f"{branch}, {a.model}, started {datetime.datetime.now():%H:%M}\nTask: {task}\n\n")
        log.flush()
        proc = subprocess.Popen(
            ["agy", "--print", PROMPT.format(branch=branch, issue=a.issue, task=task), "--model", a.model, "--mode", "accept-edits", "--print-timeout", f"{a.minutes}m", "--output-format", "stream-json"],
            cwd=copy, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        lock.write_text(json.dumps({"pid": proc.pid, "branch": branch, "log": str(logfile)}))
        try:
            last, used, status = follow(proc, log)
            proc.wait()
        finally:
            lock.unlink(missing_ok=True)

        minutes = max(1, round((time.time() - start) / 60))
        saves = git("log", "--format=%an <%ae>", f"main..{branch}").splitlines()
        files = git("diff", "--name-only", f"main...{branch}").splitlines()
        out_of_lane = [f for f in files if BLOCKED.search(f)]
        left = git("status", "--porcelain", cwd=copy).splitlines()
        me = f"{git('config', 'user.name')} <{git('config', 'user.email')}>"
        checks = bool(saves) and passes(["npx", "tsc", "--noEmit"], copy) and passes(["npm", "test", "--silent"], copy)
        tokens = used["input_tokens"] + used["output_tokens"] + used["thinking_tokens"]

        summary = [
            f"{branch}: {status}, {minutes} min, {a.model}, {tokens:,} tokens of the helper's own",
            f"saves: {len(saves)}" + ("" if all(s == me for s in saves) else "  WRONG AUTHOR") + (f"  NOT SAVED: {len(left)} files left loose" if left else ""),
            f"checks: {'pass' if checks else 'FAIL' if saves else 'not run, nothing was saved'}",
            f"files ({len(files)}): {', '.join(files[:12])}{' ...' if len(files) > 12 else ''}",
            f"in its lane: {'yes' if not out_of_lane else 'NO: ' + ', '.join(out_of_lane)}",
            f"its report: {last[-700:]}",
            f"log: {logfile}",
        ]
        log.write("\n--- summary ---\n" + "\n".join(summary) + "\n")
    print("\n".join(summary))
    check = "Passed" if checks else "Failed" if saves else "Nothing saved"
    lane = "Yes" if not out_of_lane else "No: " + ", ".join(out_of_lane)
    add_row(f"| {datetime.date.today():%-d %b %Y} | {a.issue}, {a.words.replace('-', ' ')} | {a.model} | {minutes} min | {check} | {lane} | Not tested yet | None | Not decided | Started by the main AI with `scripts/helper.py`. {tokens:,} helper tokens. Branch `{branch}`. |")


def clear(branch, copy):
    if copy.exists():
        git("worktree", "remove", "--force", str(copy))
    git("branch", "-D", branch, check=False)


def keep(a):
    branch, copy, _ = names(a.issue, a.words)
    # the row this run added to the research file is the one thing that may be waiting
    if [l for l in git("status", "--porcelain", "--untracked-files=no").splitlines() if not l.endswith("docs/helper-agent-research.md")]:
        sys.exit("There is unsaved work on main. Save it first.")
    if git("branch", "--show-current") != "main":
        sys.exit("Go to main first.")
    saves = git("rev-list", "--reverse", f"main..{branch}").split()
    if not saves:
        sys.exit("There is nothing saved on that branch.")
    for save in saves:
        subprocess.run(["git", "cherry-pick", save], cwd=ROOT, check=True, capture_output=True)
    clear(branch, copy)
    print(f"Kept {len(saves)} save(s) from {branch} on main. Nothing pushed.")


def drop(a):
    branch, copy, _ = names(a.issue, a.words)
    clear(branch, copy)
    print(f"Dropped {branch}.")


def status(_):
    busy = working()
    for b in busy:
        print(f"Working on {b['branch']}. Watch: tail -f {b['log']}")
    if not busy:
        print("No helper is working.")
    waiting = [b.strip() for b in git("branch", "--list", "helper/*").splitlines()]
    if waiting:
        print("Waiting to be kept or dropped: " + ", ".join(waiting))


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sub = parser.add_subparsers(dest="what", required=True)
for name, job in (("run", run), ("keep", keep), ("drop", drop)):
    p = sub.add_parser(name)
    p.add_argument("issue", type=int)
    p.add_argument("words", help="two words with a dash, such as fold-layers")
    p.set_defaults(job=job)
    if name == "run":
        p.add_argument("--task", help="what to do, which files, how we know it is done. Read from the pipe if left out.")
        p.add_argument("--model", default="gemini-3.8-flash-high", help="one of: agy models")
        p.add_argument("--minutes", type=int, default=20, help="the time limit")
sub.add_parser("status").set_defaults(job=status)
args = parser.parse_args()
args.job(args)
