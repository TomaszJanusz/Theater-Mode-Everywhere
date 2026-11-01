# Player UI in the top layer

The player UI host (`#theater-everywhere-ui`, owned by `src/ui/root.ts`) is a manual popover, so
page content cannot cover it with z-index. `src/ui/top-layer.ts` holds the contract. The browser
minimums are Chromium 114 (`minimum_chrome_version`) and Firefox 140; without `showPopover` the host
keeps its fixed-position, z-index rules, which stay in `src/host-frame.css` for that fallback and for
the `--theater-chrome-z` offset used by native chat.

The top layer orders by entry time, and `documentElement` joins it when fullscreen is requested, so
the host re-enters after `fullscreenchange`, after something else closes it, and after a page popover
opens (once per frame).

Fullscreen of an element that does not contain the host (a site's own player, any page element) takes
the host **out** of the top layer until fullscreen ends. Pointer input goes to the fullscreen element,
so a host painted over it would look usable and not be. Out of the top layer the fullscreen element
covers the host; on the `fullscreenchange` that ends it, the host re-enters. Document fullscreen (the
extension's own) contains the host and keeps it. The theater toggle is not gated on fullscreen: [T] in
a site player's fullscreen starts theater, and the UI shows once fullscreen ends
(`top-layer.browser.test.ts`).

Stacking rules that stay, and why (audited against the top layer):

- **Host `z-index` and `--theater-chrome-z`** (`src/host-frame.css`): needed where the host is out of the
  top layer and must still sit above the page: while native chat is active (`src/native-chat.css` lowers
  it below service popups) and in browsers without `showPopover`. In the top layer it is inert.
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
- A page **modal** dialog makes the rest of the document inert while it is open, the player UI included,
  whether it opened before or after theater (Chromium and Firefox, `src/ui/surfaces.component.test.ts`).
  Re-entering the top layer cannot undo that: pointer input reaches the dialog, not the UI. The host
  still stays in the top layer, so the controls paint above the dialog's backdrop at full brightness.
  Keyboard shortcuts still act (M mutes, T enters theater), and Escape exits theater while the dialog
  stays open. The UI works again once the page closes the dialog. (Z-index never beat a modal dialog
  either.)
- While native chat is active (`data-theater-chat-active`) the host leaves the top layer and uses
  z-index again: service popups (Twitch, YouTube) rely on z-index to sit above the chrome, which the
  top layer would defeat. Those pages do not get the top-layer benefit. That includes a chat the user
  has hidden: the attribute means the service chat exists (`data-theater-chat-visible` means it is
  shown), the YouTube popup lifts in `src/native-chat.css` key on it, and those popups (menus, the
  "continue watching?" dialog) still open while the column is hidden.
- A page that removes and re-attaches the host is re-shown on the next UI mount, not immediately.
