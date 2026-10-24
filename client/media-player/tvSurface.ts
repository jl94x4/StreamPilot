/** TV page colour shared by Home's billboard fade and title pages, so one flows into the other. */
export const TV_FLOOR_RGB = '6 10 16';
/** TV artwork tint stays darker than web so white copy and focus rings keep their contrast. */
const TV_TINT_LUMA_CAP = 60;
/** Keep most of the edge's hue on TV; the web 0.48 read as plain grey on a dark screen. */
const TV_TINT_SATURATION = 0.8;

export const softenSurfaceRgb = (rgb: string, cap = 86, sat = 0.48) => {
    const parts = rgb.trim().split(/\s+/).map((part) => Number(part));
    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) return rgb;
    let [r, g, b] = parts;
    // Keep the poster hue, but drop most of the saturation and cap brightness
    // so a red or yellow still does not flood the whole page.
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * sat;
    g = avg + (g - avg) * sat;
    b = avg + (b - avg) * sat;
    const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    if (luma > cap) {
        const scale = cap / luma;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
    return `${channel(r)} ${channel(g)} ${channel(b)}`;
};

/** Sampled art colour → the TV page colour (the floor when there is none). */
export const tvTintSurfaceRgb = (rgb?: string | null) => (
    rgb && rgb !== TV_FLOOR_RGB ? softenSurfaceRgb(rgb, TV_TINT_LUMA_CAP, TV_TINT_SATURATION) : TV_FLOOR_RGB
);
