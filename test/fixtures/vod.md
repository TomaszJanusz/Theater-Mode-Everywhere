`vod.webm` is a generated, silent two-second VP8 clip: 160×90 neutral RGB
frames at 10 fps. It has finite-duration metadata so the extension smoke test
can exercise VOD controls in the real browser media pipeline. It has no
external source or copyright dependency.

To regenerate with a full FFmpeg installation:

```sh
ffmpeg -f lavfi -i 'color=c=0x1b1b1b:s=160x90:r=10:d=2' -c:v libvpx -b:v 64k -an -y test/fixtures/vod.webm
```
