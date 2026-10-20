# Player UI in the top layer

The player UI host (`#theater-everywhere-ui`, owned by `src/ui/root.ts`) is a manual popover, so
page content cannot cover it with z-index. `src/ui/top-layer.ts` holds the contract. The browser
minimums are Chromium 114 (`minimum_chrome_version`) and Firefox 140; without `showPopover` the host
keeps its fixed-position, z-index rules, which stay in `src/host-frame.css` for that fallback and for
the `--theater-chrome-z` offset used by native chat.

The top layer orders by entry time, and `documentElement` joins it when fullscreen is requested, so
the host re-enters after `fullscreenchange`, after something else closes it, and after a page popover
opens (once per frame).

Stacking rules that stay, and why (audited against the top layer):

- **Host `z-index` and `--theater-chrome-z`** (`src/host-frame.css`): needed whenever the host is not in the
  top layer, i.e. while native chat is active (`src/native-chat.css` lowers it below service popups) and in
  browsers without `showPopover`. In the top layer it is inert.
- **Host `contain: layout`** is not a stacking leftover. It makes the host the containing block of every
  `position: fixed` descendant, so captions, HUDs and pinned controls follow the host box, which
  `--theater-video-width` narrows when chat shares the stage, not the viewport. Removing it widens them to
  the viewport (covered by `top-layer.browser.test.ts`). It also makes the host a stacking context.
- **Z-index in `src/ui/shadow.css` and `src/ui/modal.css`** orders the UI's own surfaces inside the host's
  stacking context. The top layer does not change that ordering, so none of it is redundant.
- **Page-level z-index** (video, stage, ancestors, provider lifts) orders page elements against the page and
  the chat column; the top layer only moves the host.

Limits:

- A page element that entered the top layer **before** the host stays below it; one that enters
  **after** covers it unless the host hears an event. Page popovers fire `toggle`, so they are handled.
  `dialog.showModal()` fired none in the Chromium and Firefox builds tested, so a modal dialog shown after theater
  starts covers the UI. Detecting it needs an attribute observer on every dialog, which was not worth
  its cost. (Z-index never beat a modal dialog either.)
- While native chat is active (`data-theater-chat-active`) the host leaves the top layer and uses
  z-index again: service popups (Twitch, YouTube) rely on z-index to sit above the chrome, which the
  top layer would defeat. Those pages do not get the top-layer benefit.
- A page that removes and re-attaches the host is re-shown on the next UI mount, not immediately.
