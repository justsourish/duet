# 03 Mask settings in the right panel (#154)

Who: Antigravity. Needs task 02 merged first.

## What
When the picked thing is a mask group (`el.mask` true), the right panel shows a small "Mask" section: Soft edge (number, px), Grow or shrink (number, px, can be negative), Invert (switch). Each change is one `set_props` dispatch with a label, e.g. "Soft edge".

## Where
`src/ui/PropertiesPanel.tsx`. Copy how the Opacity or Shadow section is built there. Designer words only. No new packages.

## Done when
The section shows only for a mask, values change the canvas, Undo takes each back.

## Click list for him
1. Draw a rectangle over a picture, pick both, Cmd Option M.
2. Soft edge 40. The edge goes soft.
3. Invert on. The picture shows outside the shape.
