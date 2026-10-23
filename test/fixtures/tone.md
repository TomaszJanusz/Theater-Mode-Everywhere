`tone.webm` is a generated, two-second stereo Opus clip (about 23 KB, audio only) for
tests that must hear the audio graph. Left carries 440 Hz at 0.3 amplitude, right carries
880 Hz at 0.3, and both channels carry 80 Hz at 0.15 (6 dB lower). Every frequency fits an
integer number of cycles in two seconds, so the clip loops without a click. The 80 Hz
component lies inside the bass shelf, the 440/880 Hz tones above it, and the hard-panned
tones make stereo leakage measurable. It has no external source or copyright dependency.

To regenerate with an FFmpeg build that includes libopus (the minimal build bundled
with Playwright does not):

```sh
ffmpeg -f lavfi -i 'aevalsrc=0.3*sin(2*PI*440*t)+0.15*sin(2*PI*80*t)|0.3*sin(2*PI*880*t)+0.15*sin(2*PI*80*t):s=48000:d=2' -c:a libopus -b:a 64k -application audio -map_metadata -1 -fflags +bitexact -flags:a +bitexact -y test/fixtures/tone.webm
```

The bit-exact flags make the output reproducible byte for byte with the same FFmpeg
and libopus. The committed file was produced with FFmpeg 7.0.2 (the static build from
the `imageio-ffmpeg` PyPI wheel, run through `uvx`; nothing was installed globally).
