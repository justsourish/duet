# Auto layout
Frames that line up their children neatly and adapt when content changes.

- Put auto layout on every screen, card, list, and button row you build. Never leave a container frame with loose, manually positioned children.
- Always set the layout property on frames: dir ("column" for vertical stacks, "row" for horizontal rows), gap, padX, padY, and align ("start", "center", "end", or "stretch").
- Screens and lists use column direction, with a gap between sections or items and padding from the screen edge.
- Cards use column direction, even padding (such as padX: 16, padY: 16), and a gap between elements.
- Button rows and toolbars use row direction, align: "center", and a gap between items.
- Set grow: 1 on items that fill space along the layout direction, and grow: 0 for items that keep their size.
- Check that the side panel does not show "Add auto layout" on any screen, card, list, or button row you build.
- Layout follows the order of the layers, so put things in the order they should appear, top to bottom. For a bottom bar or a footer button, give the content above it grow: 1, so the bar is pushed to the bottom edge instead of sitting right under the title.
