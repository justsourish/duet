# 09 Drag a clip to another row (#160)

Who: Antigravity.

## What
In the Layers view of the timeline, dragging a clip's bar mostly up or down moves the layer above or below others, like dragging its name does (`pullRow`). Mostly sideways still moves it in time (`drag`). Decide by the first 6 pixels of movement.

## Where
`drag` and `pullRow` in `src/ui/TimeStrip.tsx`. Reuse `pullRow`'s drop line and its `reparent_elements` dispatch.

## Click list for him
Drag a clip bar down two rows. It moves behind those layers.
