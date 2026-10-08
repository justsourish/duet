# Install Duet

Duet is free. It is not signed with a paid developer certificate yet, so your computer will ask you to confirm the first time. That is normal for a young open source app, and it takes ten seconds.

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

Duet works without an AI. For the chat, install [Claude Code](https://claude.com/claude-code) and sign in once in a terminal. Then open Duet. The chat finds it by itself. Gemini and Antigravity are planned.

## Your projects

A project is a normal folder with a `design.json` inside. Keep it anywhere you like, except somewhere that gets cleaned out automatically. Duet saves as you work, and keeps your history inside the folder.
