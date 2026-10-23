# CI image for the browser lanes: the Playwright image (browsers, Xvfb, system libraries) plus the
# PulseAudio daemon that native Firefox Web Audio tests need. Playwright ships no audio server.
# BASE is the Playwright image of the version in pnpm-lock.yaml, pinned by digest at build time
# (scripts/ci-image.mjs, .github/actions/ci-image); never build this file by hand.
ARG BASE
FROM ${BASE}

RUN apt-get update \
    && apt-get install --no-install-recommends -y pulseaudio \
    && rm -rf /var/lib/apt/lists/*
