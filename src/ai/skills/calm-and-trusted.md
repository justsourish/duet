# Calm and trusted
A bright, minimal interface with an off-white canvas, crisp thin lines, clear visual hierarchy, and purposeful colour.

## Core rules
- Sidebar background is pure white #ffffff. Main canvas background is light grey #fafafa.
- Dividers, card borders, and button outlines are 1px solid #e5e5e5. Active nav indicator is 1px solid #111111.
- Text colours: titles and headings #111111, body text #555555, muted labels and timestamps #888888.
- Typography uses a clean sans-serif: hero figure 28-32px bold, title 20px semi-bold, body and labels 13px regular, small metadata 11px regular.
- Corner radii: 16px for the outer window frame, 12px for cards and containers, 2px for buttons and zoom controls.
- Sidebar width is 180px to 200px. Nav items are 36px tall with 16px horizontal padding.
- Spacing follows an 8px scale: 4, 8, 16, 24, 32, 48 px.
- Icons are 16x16 px with a thin 1px outline stroke, monochrome only. No solid icon fills.
- Icons must be drawn as simple recognisable outline shapes made of circles, rounded rectangles and straight lines only (a profile icon is a circle head over a half-circle shoulders). Never draw a free curve for an icon.
- No drop shadows on any UI card, panel, or button.
- Never use gradients anywhere. All fills are flat solid colours.
- Never use heavy drop shadows or glow effects.
- Never use pill-shaped buttons or button corner radius over 4px.
- Never use line weights thicker than 1px for UI borders.

## Designer taste and hierarchy
- Every screen has ONE hero: the single thing the eye lands on first (for example the balance card). The hero is bigger and has more weight than everything else: larger type (28 to 32px bold), more padding, and the only place a filled dark (#111111) block or the accent may be used. Everything else is quieter.
- Never use dark panel backgrounds or filled black buttons, except on the single hero card.
- Colour carries meaning, never decoration: text that says money in or active uses a deep green #1f7a4f (passes contrast on white). #63eaaf may only appear as a faint tint behind something (e.g. #e6f6ee for a badge) and never as text. A single muted red #d4645c may mean a warning or money out only in text of amounts, nothing else. No other colours.
- Status dots and badge backgrounds may use a faint tint (e.g. #e6f6ee). Never use coloured icons or coloured text outside the amounts.
- Group related things with space instead of boxes. Do not put a border around every row: use rows with a 1px divider, and a card only for the hero and for grouped lists.
- Content never touches the edge of its container. Keep 16px padding inside every card and row, and make sure the longest text and number still fit with room to spare.
- Align every row to the same columns: icon, name on the left, amount right-aligned on the same right edge.
- Use empty space on purpose: do not leave a large empty hole in the middle of a screen; let the list use the height or place the bottom bar right after the content.
- Mobile screens: 360px wide, bottom bar 56px tall, content margin 16px. Desktop rules about sidebars apply only when asked.
