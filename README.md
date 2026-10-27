# Theater Mode Everywhere

**One player to rule them all.**

Theater Mode Everywhere is a Chromium and Firefox extension that expands HTML5 players to fill the browser and adds shared playback controls. Optional Rich Theater Experience (RTE) integrations add service-specific features on supported video sites.

## Install

- [Chrome Web Store](https://chromewebstore.google.com/detail/theater-mode-everywhere/cncfdfheagoagmoeiaecfpbcljncoepe)
- [Mozilla Add-ons (Firefox)](https://addons.mozilla.org/firefox/addon/theater-mode-everywhere/)
- [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/daammcppiohibmlfnaafaeaggbmlhlik)

## Highlights

- Press `T` to enlarge the active video to the browser window; press `T` or `Escape` to leave. `Shift+T` switches between several videos on a page.
- Works with standard HTML5 video, including players in the Shadow DOM and embedded frames.
- Custom control bar with volume and speed panels, subtitle selection and styling, audio track selection with a remembered language per service, Video Fit (Fit, Fill, Stretch), frame stepping and configurable keyboard shortcuts.
- Audio settings: Volume boost, Voice boost, Reduce loud sounds and Bass, where the media allows audio processing.
- Centered or Raised picture layout (Raised, with subtitles only, by default), always-visible controls, and double-click for fullscreen inside theater mode.
- Rich Theater Experience integrations for YouTube, Vimeo, Patreon, Twitch, Disney+, Netflix, Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and iQIYI (iq.com). Depending on the service: titles, subtitles, audio tracks (YouTube), chapters, timeline previews, previous/next navigation, skip buttons, native chat (Twitch, YouTube) and SponsorBlock markers on YouTube. Each service can be switched off in Settings → Features.
- Website exclusions, AutoTheater, 13 interface languages, and High contrast, Reduce transparency and Reduce motion options.

See the [changelog](CHANGELOG.md) for details.

## Privacy

The extension sends no information about you or what you watch to the developer, and has no analytics or telemetry. See [PRIVACY.md](PRIVACY.md) or the [online policy](https://theater.tomaszjanusz.dev/privacy-policy/).

## Development

Requires Node.js 22 and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm build          # writes dist/ packages for Chromium and Firefox
pnpm typecheck
pnpm test
```

Browser tests need Playwright browsers (`pnpm exec playwright install chromium firefox`). See [docs/building.md](docs/building.md) for reproducible release builds and [docs/browser-tests.md](docs/browser-tests.md) for tests and smoke runs. Architecture and contribution guidance live in [AGENTS.md](AGENTS.md) and [docs/](docs/).

## Feedback and contributing

Report bugs and suggest features in [GitHub issues](https://github.com/TomaszJanusz/Theater-Mode-Everywhere/issues).

## License

[MIT](LICENSE) © Tomasz Janusz
