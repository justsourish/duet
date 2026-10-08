# Contributing to Duet

Thank you for being here. Duet is built in the open and early, so your input counts for a lot.

## The easiest way to help

Use Duet for something real, then open an issue and tell us:

- what you were trying to do,
- what got in your way,
- what you expected to happen.

A screenshot or a short screen recording helps a lot. You do not need to know how to code.

## Ideas and design feedback

Open an issue. Say what you want in your own words, as a designer would. Mockups and sketches are welcome. Look in `mockups/` to see how the project has been thinking.

## Code

1. Fork the repo and create a branch.
2. `npm install`, then `npm run tauri dev` to run the app.
3. Make your change, small and focused.
4. Run `npm test`, `npx tsc --noEmit`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
5. Open a pull request and describe what changed and why, in plain words.

### Rules of the house

- **Every change to a design is a named command** in `src/commands/`. The interface and the AI both call them. Do not change the document any other way.
- **Commands are pure**: old document in, new document out. They never edit in place.
- **Designer language in the interface.** No words like commit, tag, JSON or id in front of a designer.
- **Only promise what is real.** If a feature is half built, it does not appear in the interface.
- **Nothing copied from other design tools.** Our own icons, colours, code and wording.
- Add a test when you add a command.

## Using an AI agent to help you contribute

Welcome. `AGENTS.md` tells an agent how this project is laid out.

## Be kind

Treat people the way you would want to be treated in a design review: honest about the work, generous about the person.
