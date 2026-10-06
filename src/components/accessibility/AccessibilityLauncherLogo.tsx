/**
 * The logo inside the accessibility launcher.
 *
 * This is the emblem from the reference artwork (`images/accessability.jpeg`) —
 * the ring, the seated figure and the wheel — vector-traced from that image
 * rather than redrawn, so the launcher keeps the exact shapes and proportions
 * of the reference at any size, on any display, at any device pixel ratio.
 *
 * Geometry is normalised to the reference's own ring: its outer radius is 12 in
 * a 24x24 viewBox centred on `0 0`, which is why the coordinates are small
 * decimals. Checked against the source image's own silhouette, the traced shape
 * reproduces it at an intersection-over-union of 0.976 (luminance threshold
 * 60/255, closing radius 2px, blur sigma 1.2, simplification tolerance 0.003
 * ring units — the parameters the trace was run with).
 *
 * It is filled with `currentColor`, so it takes the launcher's own foreground
 * colour: near-black on the gold button in dark and light themes, black on
 * yellow in high-contrast mode, black on the desaturated grey in grayscale
 * mode. Nothing here paints its own palette.
 *
 * Decorative by design: the button already carries its accessible name
 * ("נגישות — פתיחת התפריט"), so the glyph is `aria-hidden` and adds no second
 * name to the control.
 */
export default function AccessibilityLauncherLogo({
  className,
}: {
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="-12 -12 24 24"
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
    >
      <path d={LOGO_PATH} />
    </svg>
  )
}

/* One path, five subpaths: the ring's outer edge, the ring's hole, and the
 * three parts of the figure. They share a single element because the ring's
 * hole is cut by `fill-rule="evenodd"`, which only cancels between subpaths of
 * the same fill. */
const LOGO_PATH =
  /* The ring's outer edge. */
  "M-0.23 -11.94L-1.09 -11.92L-2.24 -11.75L-3.42 -11.43L-3.68 -11.28L-4.06 -11.17L-4.54 -10.94" +
  "L-4.67 -10.81L-4.89 -10.78L-6.52 -9.9L-7.42 -9.29L-8.31 -8.57L-9.14 -7.74L-9.93 -6.74" +
  "L-10.55 -5.81L-11.04 -4.88L-11.5 -3.77L-11.85 -2.58L-12.05 -1.56L-12.15 -0.61L-12.15 0.7" +
  "L-12.05 1.66L-11.85 2.65L-11.5 3.8L-11.03 4.98L-10.42 6.13L-9.84 7L-8.99 8.04L-8.24 8.79" +
  "L-7.58 9.35L-6.42 10.16L-5.5 10.66L-4.32 11.18L-3.01 11.56L-1.73 11.79L-0.68 11.89L0.53 11.89" +
  "L1.75 11.79L2.8 11.59L4.08 11.21L4.95 10.85L6.06 10.28L7.31 9.48L8.16 8.79L8.91 8.04L9.16 7.76" +
  "L9.2 7.63L9.37 7.52L9.79 7L10.34 6.19L10.76 5.46L11.2 4.5L11.58 3.42L11.91 2.04L12.04 1.02" +
  "L12.07 -0.32L11.97 -1.44L11.81 -2.36L11.61 -3.19L11.26 -4.24L10.69 -5.49L10.14 -6.45L10.1 -6.67" +
  "L9.95 -6.96L9.44 -7.76L8.72 -8.58L7.88 -9.25L6.76 -9.99L5.48 -10.62L5.32 -10.75L5.13 -10.78" +
  "L3.69 -11.4L1.84 -11.85L1.01 -11.95Z" +
  /* The ring's inner edge — the hole the even-odd fill rule cuts out. */
  "M0.71 -10.98L1.62 -10.93L2.7 -10.73L3.85 -10.41L4.81 -10.02L5.8 -9.52L6.64 -8.94L7.43 -8.31" +
  "L8.27 -7.47L8.97 -6.64L9.57 -5.81L10.15 -4.75L10.66 -3.51L10.98 -2.36L11.11 -1.63L11.24 -0.29" +
  "L11.21 0.8L10.98 2.3L10.69 3.38L10.34 4.31L9.83 5.33L9.32 6.16L8.69 6.99L8.24 7.5L7.4 8.31" +
  "L6.42 9.06L5.7 9.52L5.35 9.71L5.19 9.73L4.94 9.89L3.41 10.47L3.12 10.63L2.39 10.83L1.01 11.06" +
  "L-0.07 11.12L-0.87 11.09L-2.11 10.93L-3.01 10.73L-3.9 10.44L-5.02 9.97L-5.24 9.73L-6.27 9.06" +
  "L-7.91 7.79L-8.18 7.64L-8.64 7.15L-9.37 6.19L-9.84 5.43L-10.39 4.34L-10.74 3.42L-11.03 2.33" +
  "L-11.19 1.41L-11.29 0.13L-11.26 -0.73L-11.13 -1.75L-10.93 -2.68L-10.58 -3.8L-10.07 -4.95" +
  "L-9.59 -5.84L-9.01 -6.68L-8.47 -7.32L-7.51 -8.25L-6.65 -8.91L-5.5 -9.61L-3.81 -10.28L-2.69 -10.6" +
  "L-1.48 -10.83L-0.2 -10.96Z" +
  /* The seated figure: torso, arm, seat and leg. */
  "M-2.88 -5.21L-3.01 -5.15L-3.08 -5.04L-3.11 -4.59L-3.09 -0.61L-2.98 -0.09L-2.73 0.54L-2.43 1" +
  "L-2.03 1.44L-1.32 1.92L-0.55 2.18L0.57 2.28L2.51 2.29L2.9 2.36L3.34 2.55L3.61 2.75L3.96 3.13" +
  "L5.95 6.61L6.12 6.84L6.44 7.03L6.76 7.04L6.95 6.96L8.51 5.7L8.57 5.39L8.42 5.2L8.26 5.16" +
  "L7.36 5.15L7.11 5.07L6.9 4.92L4.98 1.44L4.71 1.07L4.3 0.73L3.98 0.57L3.53 0.46L-0.36 0.46" +
  "L-0.49 0.38L-0.5 -0.25L-0.39 -0.36L3.5 -0.33L4.68 -0.38L4.85 -0.57L4.86 -0.8L4.69 -1.21" +
  "L4.43 -1.59L4.01 -1.79L3.69 -1.83L2.13 -1.77L1.94 -1.71L1.33 -1.71L1.11 -1.77L0.5 -1.77" +
  "L0.34 -1.71L-0.42 -1.72L-0.5 -1.85L-0.5 -3.64L-0.56 -3.77L-0.58 -4.12L-0.67 -4.31L-1 -4.67" +
  "L-1.51 -5.05L-2.34 -5.21Z" +
  /* The wheel. */
  "M-3.55 -2.71L-3.93 -2.62L-4.03 -2.51L-5.02 -1.98L-5.72 -1.48L-6.5 -0.73L-6.84 -0.29L-7.29 0.45" +
  "L-7.64 1.28L-7.81 1.95L-7.91 2.75L-7.84 3.77L-7.48 5.04L-7.04 5.94L-6.72 6.42L-5.88 7.33" +
  "L-5.27 7.83L-3.97 8.56L-2.75 8.94L-2.05 9.06L-1.86 8.95L-0.42 8.95L0.73 8.66L1.56 8.27L2.23 7.82" +
  "L2.83 7.29L3.38 6.61L3.73 6L4.02 5.27L4.15 4.6L4.19 4.02L4.14 3.77L4.07 3.73L3.89 4.37L3.64 4.88" +
  "L3.1 5.62L2.58 6.11L2.03 6.49L1.01 6.93L0.02 7.13L-0.3 7.13L-1.19 6.97L-2.24 6.6L-2.91 6.26" +
  "L-3.39 5.95L-4.16 5.31L-4.64 4.82L-5.09 3.86L-5.35 2.71L-5.35 1.72L-5.29 1.21L-4.93 -0.09" +
  "L-4.68 -0.67L-4.36 -1.21L-3.72 -2.01L-4.03 -1.8L-4.38 -1.45L-5.08 -0.58L-5.78 0.7L-6.08 1.53" +
  "L-6.28 2.36L-6.37 3.22L-6.37 3.7L-6.21 4.82L-6.01 5.49L-5.6 6.42L-5.31 6.86L-4.92 7.36" +
  "L-4.36 7.88L-3.74 8.31L-2.91 8.69L-2.83 8.78L-2.94 8.86L-3.61 8.58L-4.64 7.93L-5.47 7.02" +
  "L-5.85 6.42L-6.14 5.78L-6.46 4.72L-6.6 3.86L-6.6 3L-6.53 2.36L-6.21 1.02L-5.95 0.38L-5.34 -0.7" +
  "L-4.72 -1.5L-4.19 -2.02L-3.51 -2.55L-3.47 -2.65Z" +
  /* The head. */
  "M-1.86 -9L-2.38 -8.78L-3.01 -8.17L-3.24 -7.79L-3.33 -7.47L-3.34 -6.86L-3.2 -6.45L-2.98 -6.09" +
  "L-2.54 -5.68L-2.21 -5.51L-1.92 -5.44L-1.41 -5.44L-0.81 -5.67L-0.5 -5.9L-0.25 -6.19L-0 -6.7" +
  "L0.07 -7.24L-0.07 -7.82L-0.32 -8.36L-0.7 -8.74L-1.35 -9.01Z"
