# SponsorBlock view compatibility

The integration copies already-rendered SponsorBlock views into the shared
scrubber. It makes no segment API requests, reads no extension storage and
implements no skip, mute, category-selection or voting rules. It remains usable
with Rich Theater Experience disabled. The Features preference controls markers;
native notice visibility is a CSS presentation fix.

SponsorBlock's `sponsorTimes`, `PreviewBar` and configuration live in its isolated
content-script world. At upstream revision
[`914e2c88`](https://github.com/ajayyy/SponsorBlock/tree/914e2c88d4f80be9bcf3b3299f155c703ee99061),
there is no page-visible segment/color event or JS API. Its runtime segment
messages are internal; its external handler only shares limited configuration
with allowlisted sibling extensions. Its popup-frame `postMessage` calls carry
initialization/styles. The documented API is a network API, outside this
integration's privacy boundary.

The [YouTube source](../src/providers/youtube/sponsorblock.ts) owns discovery,
identity, observation and palette reads. It observes only direct child-list
changes: upstream `PreviewBar.update()` clears and rebuilds `li` elements, rather
than editing their geometry in place. While waiting for a late bar, the same
observer watches only the progress-bar parent's direct children. Existing
YouTube navigation/media events rebind it; no document observer or polling is
added. Hidden documents, theater exit and disablement disconnect it. Epochs
reject queued reads and content keys suppress unchanged publications.

Geometry, category and opacity unavoidably come from the bar's direct children.
Colors and text colors come from one computed root-style snapshot per rebuild,
cached per category. Explicit view colors win over upstream default fallbacks.
The renderer uses the existing chapter-marker layer and tooltip, preserving
chapters and heatmaps. Chapter actions that SponsorBlock renders only in its
separate chapter bar are not imported; no view is invented from hidden data.

The [presentation stylesheet](../src/providers/youtube/presentation.css) is the
single owner of notice selectors. SponsorBlock's absolute notices sit behind the
fixed theater picture. Viewport positioning and a higher sibling stacking level
keep the existing notices visible and clickable without moving them, inspecting
their contents or bridging their actions. No notice appearance is restyled.

This compatibility depends on upstream DOM, attach points and rebuild behavior.
A color-only stylesheet change is picked up on the next rebuild or host lifecycle
notification; it does not justify another observer. A replaced progress subtree
is rediscovered on the next native navigation/player/media signal. Chromium and
Firefox fixture tests prove our rendering/lifecycle, not installed SponsorBlock
behavior on authenticated YouTube. Requalify those boundaries when upstream
changes.
