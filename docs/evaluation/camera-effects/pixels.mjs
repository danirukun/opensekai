// The pixel tests of the camera effects checks (B37 operation 7, HC1 to HC7). headless-check.mjs and editor-check.mjs
// use them on 1920 x 1080 images with straight alpha (a page screenshot or a camera screenshot), against a baseline image
// of the same scene without effects.
export const W = 1920, H = 1080;
/** The test screen: a 64 x 32 opaque #808080 image, 1.8 m high at [0, 1.2, 0]. Seen from camera_wide at [0, 1.2, 3] with a 45° field
 * of view, it covers the frame except a strip of about 177 px on the left and right and 149 px at the top and bottom. */
export const SCREEN_SCALE = 1.8;
export function grayPng(PNG) {
    const png = new PNG({width: 64, height: 32});
    for (let i = 0; i < 64 * 32; i++) png.data.set([128, 128, 128, 255], i * 4);
    return PNG.sync.write(png);
}
/** The dirt image: 64 x 64, an opaque white top-left quadrant, alpha 0 elsewhere. */
export function dirtPng(PNG) {
    const png = new PNG({width: 64, height: 64});
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) png.data.set(x < 32 && y < 32 ? [255, 255, 255, 255] : [0, 0, 0, 0], (y * 64 + x) * 4);
    return PNG.sync.write(png);
}
const at = (image, x, y) => { const i = (y * image.width + x) * 4; return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]]; };
const each = (fn) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(x, y); };
const sum = c => c[0] + c[1] + c[2];
/** The largest channel difference of two pixels. */
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
// An 8-bit premultiplied canvas gives a straight colour with an error of up to 0.5 * 255 / alpha.
const quantum = alpha => 128 / Math.max(alpha, 1);

/** The bounding box of the pixels with alpha > 0. */
export function coverage(image) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1, covered = 0;
    each((x, y) => { if (at(image, x, y)[3] > 0) { covered++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } });
    return {x0, y0, x1, y1, covered};
}
/** HC0: the baseline has transparent space around the screen and an opaque screen. */
export function hc0(base) {
    const box = coverage(base);
    const outside = [[5, 5], [W - 6, 5], [5, H - 6], [W - 6, H - 6], [W / 2, 5]].map(([x, y]) => at(base, x, y));
    return [
        ['HC0: the screen is opaque in the middle and transparent around it', box.covered > 0 && at(base, W / 2, H / 2)[3] === 255 && outside.every(p => p[3] === 0) && box.x0 > 20 && box.y0 > 20 && box.x1 < W - 20 && box.y1 < H - 20, {box, centre: at(base, W / 2, H / 2), outside}],
    ];
}
function stayTransparent(base, image) {
    let bad = 0, first = null;
    each((x, y) => { if (at(base, x, y)[3] === 0 && at(image, x, y)[3] !== 0) { bad++; first ??= [x, y, at(image, x, y)]; } });
    return {pass: bad === 0, detail: {changed: bad, first}};
}
function keepAlpha(base, image) {
    let bad = 0, first = null;
    each((x, y) => { const a = at(base, x, y)[3], b = at(image, x, y)[3]; if (Math.abs(a - b) > 1) { bad++; first ??= [x, y, a, b]; } });
    return {pass: bad === 0, detail: {changed: bad, first}};
}
/** HC1, part 1: Vignetting #000000, alpha 1, Fade Out 0, Blink 0. */
export function hc1(base, image) {
    const box = coverage(base);
    const inset = 12;
    const corners = [[box.x0 + inset, box.y0 + inset], [box.x1 - inset, box.y0 + inset], [box.x0 + inset, box.y1 - inset], [box.x1 - inset, box.y1 - inset]];
    const darker = corners.map(([x, y]) => ({at: [x, y], base: at(base, x, y), image: at(image, x, y)}));
    let centre = 0;
    for (let y = H / 2 - 4; y <= H / 2 + 4; y++) for (let x = W / 2 - 4; x <= W / 2 + 4; x++) centre = Math.max(centre, diff(at(base, x, y), at(image, x, y)));
    const outside = stayTransparent(base, image), alpha = keepAlpha(base, image);
    return [
        ['HC1: outside pixels stay alpha 0', outside.pass, outside.detail],
        ['HC1: each covered pixel keeps its baseline alpha (±1)', alpha.pass, alpha.detail],
        ['HC1: covered pixels near the frame corners are darker than the baseline', darker.every(d => d.base[3] === 255 && sum(d.image) + 30 < sum(d.base)), darker],
        ['HC1: the frame centre is equal (±2)', centre <= 2, {largest: centre}],
    ];
}
/** HC1, part 2: Vignetting #4c4c4c with Blink 1. */
export function hc1Blink(base, image) {
    let bad = 0, first = null, checked = 0;
    each((x, y) => {
        const a = at(base, x, y)[3];
        if (a === 0) return;
        checked++;
        const p = at(image, x, y), tolerance = 3 + quantum(a);
        if (p.slice(0, 3).some(v => Math.abs(v - 76) > tolerance) || Math.abs(p[3] - a) > 1) { bad++; first ??= [x, y, a, p]; }
    });
    const outside = stayTransparent(base, image);
    return [
        ['HC1 Blink 1: each covered pixel is 76 (±3) in each channel with its baseline alpha (±1)', bad === 0 && checked > 0, {checked, bad, first, sample: at(image, W / 2, H / 2)}],
        ['HC1 Blink 1: outside pixels stay alpha 0', outside.pass, outside.detail],
    ];
}
/** HC2: Night Vision at its defaults. */
export function hc2(base, image) {
    let bad = 0, first = null;
    each((x, y) => { if (at(base, x, y)[3] < 255) return; const p = at(image, x, y); if (!(p[1] > p[0] && p[1] > p[2])) { bad++; first ??= [x, y, p]; } });
    const outside = stayTransparent(base, image), alpha = keepAlpha(base, image);
    return [
        ['HC2: alpha equals the baseline everywhere (±1)', alpha.pass, alpha.detail],
        ['HC2: covered pixels have G > R and G > B', bad === 0, {bad, first, sample: at(image, W / 2, H / 2)}],
        ['HC2: outside pixels stay alpha 0', outside.pass, outside.detail],
    ];
}
/** HC3: Blur 4. A run of partly covered pixels at the screen edge, with no colour fringe, and no change far from the screen. */
export function hc3(base, image) {
    const box = coverage(base), screen = at(base, W / 2, H / 2);
    const run = (points) => points.map(([x, y]) => ({at: [x, y], p: at(image, x, y)})).filter(({p}) => p[3] >= 1 && p[3] <= 254);
    const top = run(Array.from({length: 120}, (_, i) => [W / 2, box.y0 - 60 + i]));
    const left = run(Array.from({length: 120}, (_, i) => [box.x0 - 60 + i, H / 2]));
    const fringe = [...top, ...left].filter(({p}) => p.slice(0, 3).some((v, i) => Math.abs(v - screen[i]) > 8 + quantum(p[3])));
    const margin = 48;
    let far = 0, first = null;
    each((x, y) => { const outsideBox = x < box.x0 - margin || x > box.x1 + margin || y < box.y0 - margin || y > box.y1 + margin; if (outsideBox && at(image, x, y)[3] !== 0) { far++; first ??= [x, y, at(image, x, y)]; } });
    return [
        ['HC3: the top and the left screen edges each have a run of pixels with alpha from 1 to 254', top.length >= 3 && left.length >= 3, {top: top.length, left: left.length, topAlphas: top.map(t => t.p[3])}],
        ['HC3: their straight colour is the screen colour (±8, and the 8-bit error of a low alpha)', fringe.length === 0, {screen, fringe: fringe.slice(0, 5)}],
        ['HC3: pixels more than 48 px from the screen stay alpha 0', far === 0, {far, first}],
    ];
}
/** HC4: Pixelate 64 at 1080 lines. Each 64 x 64 block from one frame corner has one colour (±2). */
export function hc4(base, image, block = 64) {
    const blocks = (fromTop) => {
        let mixed = 0, first = null, edges = 0;
        for (let by = 0; by * block < H; by++) for (let bx = 0; bx * block < W; bx++) {
            const x0 = bx * block, x1 = Math.min(W, x0 + block);
            const y0 = fromTop ? by * block : Math.max(0, H - (by + 1) * block), y1 = fromTop ? Math.min(H, (by + 1) * block) : H - by * block;
            const ref = at(image, x0, y0);
            let one = true, baseOne = true;
            for (let y = y0; y < y1 && one; y++) for (let x = x0; x < x1; x++) { if (diff(at(image, x, y), ref) > 2) { one = false; break; } }
            for (let y = y0; y < y1 && baseOne; y++) for (let x = x0; x < x1; x++) { if (diff(at(base, x, y), at(base, x0, y0)) > 2) { baseOne = false; break; } }
            if (!baseOne) edges++;
            if (!one) { mixed++; first ??= {x0, y0}; }
        }
        return {mixed, first, edges};
    };
    const top = blocks(true), bottom = blocks(false);
    const origin = top.mixed === 0 ? 'top-left' : bottom.mixed === 0 ? 'bottom-left' : 'none';
    return [
        ['HC4: each 64 x 64 block from the frame origin has one colour (±2)', origin !== 'none' && top.edges > 0, {origin, fromTopLeft: top, fromBottomLeft: bottom}],
    ];
}
/** HC5: Lens Dirt with the quadrant image, Intensity 1, Threshold 0. A 40 px band at the centre lines is not tested (texture filter). */
export function hc5(base, image) {
    const band = 40;
    let brighter = 0, notBrighter = 0, firstDim = null, other = 0, firstOther = null;
    each((x, y) => {
        if (Math.abs(x - W / 2) < band || Math.abs(y - H / 2) < band) return;
        const b = at(base, x, y), p = at(image, x, y);
        if (x < W / 2 && y < H / 2) { if (b[3] === 255) { if (sum(p) > sum(b)) brighter++; else { notBrighter++; firstDim ??= [x, y, b, p]; } } return; }
        if (diff(b, p) > 2) { other++; firstOther ??= [x, y, b, p]; }
    });
    return [
        ['HC5: covered pixels in the top-left quadrant are brighter than the baseline', brighter > 0 && notBrighter === 0, {brighter, notBrighter, firstDim, sample: [at(base, W / 4, H / 4), at(image, W / 4, H / 4)]}],
        ['HC5: the three other quadrants equal the baseline (±2), so the outside pixels change only in the top-left quadrant', other === 0, {changed: other, first: firstOther}],
    ];
}
/** HC7: equal to the baseline (±1). */
export function same(base, image, name) {
    let bad = 0, first = null;
    each((x, y) => { if (diff(at(base, x, y), at(image, x, y)) > 1) { bad++; first ??= [x, y, at(base, x, y), at(image, x, y)]; } });
    return [[name, bad === 0, {changed: bad, first}]];
}
/** A 960 x 540 copy (2 x 2 box) for the owner. */
export function half(PNG, image) {
    const out = new PNG({width: image.width / 2, height: image.height / 2});
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
        const c = [0, 0, 0, 0];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = at(image, 2 * x + dx, 2 * y + dy); for (let i = 0; i < 4; i++) c[i] += p[i]; }
        out.data.set(c.map(v => Math.round(v / 4)), (y * out.width + x) * 4);
    }
    return PNG.sync.write(out);
}
