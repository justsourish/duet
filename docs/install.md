# Install Duet

Duet is free. It is not signed with a paid developer certificate yet, so your computer will ask you to confirm the first time. That is normal for a young free app, and it takes ten seconds.

Download from the [Releases page](https://github.com/justsourish/duet/releases).

## Mac

1. Download the `.dmg` that matches your Mac.
   - Apple Silicon (M1, M2, M3, M4): the file with `aarch64` in its name.
   - Older Intel Macs: the file with `x64` in its name.
   - Not sure? Apple menu, then About This Mac. If it says "Chip", pick Apple Silicon.
2. Open the `.dmg` and drag **Duet** into **Applications**.
3. Open Duet from Applications. macOS will say it cannot check the app for malware. Click **Done**.
4. Open **System Settings**, then **Privacy & Security**. Scroll down to the message about Duet and click **Open Anyway**. Confirm with your password.
5. Duet opens. You will not be asked again.

If macOS says Duet is "damaged and can't be opened", that is the same warning in different words. Open the Terminal app and run this once, then open Duet again:

```sh
xattr -dr com.apple.quarantine /Applications/Duet.app
```

Duet needs macOS 13 or newer.

## Windows

1. Download the `.exe` setup file (or the `.msi`).
2. Open it. Windows may show **Windows protected your PC**. Click **More info**, then **Run anyway**.
3. Follow the installer. Duet appears in your Start menu.

Windows builds are new. If something is broken, please open an issue and say what Windows version you use.

## Connect your AI (optional)

Duet works without an AI. For the chat, install [Claude Code](https://claude.com/claude-code) or [Gemini CLI](https://github.com/google-gemini/gemini-cli) and sign in once in a terminal. Then open Duet. The chat finds them by itself, and a switch at the top of the chat lets you choose. Antigravity, Codex and OpenCode are planned.

## Your projects

A project is a folder whose name ends in `.duet`, with your design and its history inside. Keep it anywhere you like. Duet saves as you work, so there is nothing to remember to save. Press Cmd or Ctrl + S to be sure. Press Cmd or Ctrl + Shift + S to name a version you can come back to.
