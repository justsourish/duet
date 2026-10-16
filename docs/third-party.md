# Third-party software inside Duet

## ffmpeg

Duet's installers carry ffmpeg, which Duet runs as a separate program for video work: reading clips, making light preview copies, and making finished videos. Duet does not change ffmpeg or build it into its own code.

- Mac: FFmpeg 8.1.2, LGPL 2.1, from serversideup/ffmpeg-lgpl-builds (release v8.1.2-27). It includes OpenSSL 3.5.7 under the Apache 2.0 licence.
- Windows: FFmpeg n8.1.3, LGPL 3, from BtbN/FFmpeg-Builds (win64-lgpl-8.1).
- Linux: Duet carries no ffmpeg. It uses the one your system provides, which the `.deb` and `.rpm` install as a requirement.

The licence texts and the exact source for each build are installed with Duet in its `ffmpeg-licences` folder, and are on the `tools-ffmpeg-8.1` release of this repository. FFmpeg's source is at https://ffmpeg.org/releases/. You may replace the ffmpeg that sits next to the Duet app with your own build.

The pinned files and their checksums are in `scripts/fetch-ffmpeg`.
