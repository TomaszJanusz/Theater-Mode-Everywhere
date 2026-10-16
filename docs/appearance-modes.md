# Appearance modes

Settings → Appearance offers independent High contrast, Reduce transparency and Reduce motion dropdowns
in the same labeled Settings rows as Language:
Auto follows the corresponding system media query; On and Off override it. Missing or
invalid storage and unsupported queries resolve to Auto/off. See the shared
[preferences](../src/appearance-preferences.ts), [observer](../src/appearance-runtime.ts)
and [tokens](../src/appearance-tokens.css).

Each document/shadow root owns its observer. Subscribing before hydration and tracking
changed keys prevents a late storage snapshot from undoing a newer choice. Document
observers stop on pagehide and reconnect on a persisted pageshow; the player disposes
its observer with its shadow root. No playback polling or provider branch is added.
Forced colors retains browser ownership: appearance overrides apply only when it is inactive.

## Surface inventory

| Surface | Treatment and reason |
| --- | --- |
| Settings: all five tabs, Language and appearance comboboxes/listboxes, Highlight new features, SponsorBlock row, exclusions, shortcuts and About | Shared text, panel, border, selected and focus tokens; solid hover/tint surfaces in either accessibility mode. Disabled content is readable; high contrast uses a dashed boundary. |
| RTE tiles, switches, capability/filter badges and expanded details | Both modes remove the single `te-animated-border::before` layer, including its orbit, boost and gradient interior. Resting tiles and switches retain their meaning. Current main uses `--te-*`; there are no remaining `--rte-*` decoration layers. Capability badge fills become solid. |
| New pill/dot, Settings gear marker | Pill uses shared solid tint and high-contrast text/border; dot keeps the checked accent and separating ring. Dropdown selection has a checkmark. High contrast underlines selected options/tiles and outlines tiles; focus has a separate 3px ring. |
| Settings dialogs, including Update highlights and shortcut conflicts | Opaque panels/backdrop without blur in both modes; high-contrast text, buttons and boundaries. |
| Popup status, website control, buttons, shortcut tip and credits | Live document tokens, opaque cards/tints, readable high-contrast status text and boundaries. |
| Shadow player toolbar, notched menus, settings/audio/chat rows, subtitle list/options, tooltips, preview labels, HUDs, help/dialogs, home/title pills and service actions | Shared solid surface, hover, ink, border and marker tokens. Frost/noise and backdrop blur disappear. High contrast also strengthens track/focus boundaries, accent indicators and countdown progress. |

Deliberately preserved:

| Surface/property | Reason |
| --- | --- |
| Video, host/native controls, native chat documents, provider-native captions and SponsorBlock segment colors | Host or user ownership. These preferences restyle extension chrome, without changing playback, provider integrations or host presentation. |
| Subtitle colors, backgrounds/opacity, swatches, raised-caption background and karaoke word emphasis | Explicit viewer preferences and caption content; modes must not overwrite them. The surrounding subtitle controls/dialog and high-contrast status notification still use readable UI text tokens. |
| Timeline buffer/progress/heatmap, thumbnails and service countdown progress | Data layered over the track or image, rather than a glass UI surface. Buffer/progress must remain distinguishable. High contrast outlines the enclosing track and uses a visible solid countdown fill (`#71717a`, 3.67:1 against the panel; white text is 4.83:1). |
| Transparent structural wrappers, notches/masks and the WASM pointer catcher | They expose an owned plate or the video and must not become solid rectangles. |
| Visibility/fade transitions, loaders, shadows and image/marquee edge masks | They express lifecycle/depth or clip media. Reduce transparency does not change Reduce motion. Decorative RTE animation is removed because its layer is removed. |
| Native system accent in normal mode, browser themes and forced colors | Browser ownership. Normal system/theme colors cannot promise a fixed contrast on every OS; high contrast replaces these with the checked dark palette and a safe accent. |

## Contrast evidence

Ratios below come from **computed styles**, using the real stylesheet cascade and
`applyAccentColorPreset`, in [the browser test](../src/appearance.browser.test.ts).
Chromium and Firefox exercise all 40 combinations. The unit test independently
checks the palette tokens and WCAG 2 sRGB luminance calculation. Ratios are rounded
only for display; assertions use unrounded values. This is palette evidence, not a
claim of a complete WCAG audit of every host page.

| CSS token pair | Normal | High contrast | Minimum |
| --- | ---: | ---: | ---: |
| Primary ink / page background | 18.10:1 | 19.90:1 | 7:1 |
| Secondary ink / panel | 6.91:1 | 11.99:1 | 4.5:1 |
| Boundary / panel | 1.19:1 | 6.91:1 | 3:1 in high contrast |

Primary/page: `#f4f4f5` / `#09090b` normally and `#ffffff` / `#09090b` in high
contrast. Secondary/panel: `#a1a1aa` / `#18181b` normally and `#d4d4d8` / `#18181b`
in high contrast. High-contrast boundary: `#a1a1aa`. Solid hover: `#27272a`.

Each cell below is **accent indicator / panel · foreground / accent fill**.
Normal preserves the browser's native system pair; Chromium's measured normal
system fill is 4.21:1, so it is explicitly excluded from the 4.5:1 custom-preset
assertion. High contrast uses the safe purple fallback for System on both engines.
All custom fills (including their hovered fills) meet 4.5:1. High-contrast accents
meet 7:1 against the panel; boundaries and focus meet 3:1. Reduced transparency
changes alpha/decorations, not the contrast palette.

| Accent | Normal | Normal + reduced | High contrast | High + reduced |
| --- | ---: | ---: | ---: | ---: |
| system | 4.21 · 4.21 | 4.21 · 4.21 | 7.08 · 7.95 | 7.08 · 7.95 |
| teal | 6.99 · 7.85 | 6.99 · 7.85 | 7.30 · 8.20 | 7.30 · 8.20 |
| blue | 7.24 · 8.13 | 7.24 · 8.13 | 7.24 · 8.13 | 7.24 · 8.13 |
| green | 8.51 · 9.55 | 8.51 · 9.55 | 8.51 · 9.55 | 8.51 · 9.55 |
| yellow | 11.64 · 13.07 | 11.64 · 13.07 | 11.64 · 13.07 | 11.64 · 13.07 |
| orange | 8.61 · 9.67 | 8.61 · 9.67 | 8.61 · 9.67 | 8.61 · 9.67 |
| red | 5.93 · 6.66 | 5.93 · 6.66 | 7.03 · 7.89 | 7.03 · 7.89 |
| pink | 6.09 · 6.84 | 6.09 · 6.84 | 7.14 · 8.01 | 7.14 · 8.01 |
| purple | 4.49 · 5.04 | 4.49 · 5.04 | 7.08 · 7.95 | 7.08 · 7.95 |
| gray | 4.25 · 4.77 | 4.25 · 4.77 | 7.11 · 7.99 | 7.11 · 7.99 |

| Accent | High-contrast accent | Fill foreground |
| --- | --- | --- |
| system | `#db7dff` | `#09090b` |
| teal | `#04bc98` | `#09090b` |
| blue | `#37adff` | `#09090b` |
| green | `#51cd00` | `#09090b` |
| yellow | `#ffcb00` | `#09090b` |
| orange | `#ff9f00` | `#09090b` |
| red | `#ff7d59` | `#09090b` |
| pink | `#ff66f4` | `#09090b` |
| purple | `#db7dff` | `#09090b` |
| gray | `#a4a4a5` | `#09090b` |

## Verification boundaries

The browser suite covers live system contrast, live storage across Settings/popup/
shadow player, per-key stale hydration, cleanup, restoration, caption preference
preservation, focus/selection and forced-colors precedence. Chromium also emulates
reduced transparency through CDP; Firefox uses explicit On/Off because that media
feature is not generally enabled there. The installed Chromium smoke additionally
covers the real options entrypoint, popup, cross-tab settings, RTE/dialogs and
exit/reentry; captures use `THEATER_APPEARANCE_SCREENSHOT_DIR`.

Playback/provider commands, MAIN/isolated messaging, shortcuts and frame protocols
are unchanged. The full smoke retains its existing iframe checks. Appearance on
authenticated RTE hosts and an installed Firefox extension still needs live host/
release qualification; browser fixtures do not establish those paths. Translation
key parity is tested for all 13 catalogs; native-speaker review is separate.

## Reduce motion

Reduce motion uses the same Auto / On / Off resolution (`reduceMotion`, Auto follows
`prefers-reduced-motion`). Every observed root gets `data-motion`; one rule in
[the tokens](../src/appearance-tokens.css) collapses animation and transition durations
to 0.01ms for all extension content in Settings, the popup and the player shadow root.
Durations collapse rather than becoming `none`, so `transitionend`/`animationend`
listeners still settle. Stylesheets must not add their own
`prefers-reduced-motion` blocks, which would ignore the On/Off override; a test enforces this.

- **Page-level styles and script.** The player mirrors the resolved state to
  `data-theater-everywhere-motion` on the host `<html>` while it is mounted (removed on
  destroy). Extension-owned page transitions (picture move, caption dock, provider
  caption lifts) read it, and script timing uses `isMotionReduced()`. Host animations and
  native player UI are untouched.
- **Marquee title.** Overflow is detected in script as before (on title change, header resize
  and a Reduce motion change, coalesced to one frame; no per-frame work). With Reduce motion the
  scroll is replaced by a static head…tail: [title-truncation](../src/ui/title-truncation.ts)
  keeps the last ~28 characters from a word boundary and CSS ellipsizes the head, so the browser
  decides how much fits and nothing is measured in script. Hover or keyboard focus (the title
  becomes focusable only in this state) shows the whole title wrapped over up to three lines,
  without motion; the first Escape closes a keyboard reveal before theater exit. The full text
  node stays in the accessibility tree throughout; the head…tail copy is `aria-hidden`. RTL
  follows logical flex order.
- **Kept deliberately.** Service-action countdown progress is data, not decoration.
