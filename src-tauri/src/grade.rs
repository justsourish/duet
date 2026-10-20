//! The colour of a picture or clip, worked out on full-quality frames in 32-bit floating point.
//! The preview shader (src/canvas/grade.ts) follows exactly the same steps, so what is seen while
//! grading is what the exported video gets. The steps, for each pixel:
//!
//! 1. Light is made linear (the sRGB curve undone), so it adds up the way real light does.
//! 2. White balance: the picture is adapted from a warmer or cooler white to daylight, in the eye's
//!    own cone space (Bradford). Worked out once per grade as one 3 by 3 matrix.
//! 3. Exposure in stops, then contrast around middle grey (0.18).
//! 4. Highlights, shadows, whites and blacks move the brightness of their own range, measured in
//!    stops from middle grey. Each pixel looks only at itself, so there are never halos.
//! 5. Back to display light, then the look (a .cube file), mixed by its strength.
//! 6. Curves (light, then red, green and blue), hue, and the colour curves read along the wheel.
//! 7. Saturation and vibrance, around Rec.709 brightness.
//! 8. Skin, found by its colour in the picture as it came: kept natural, turned, brightened.
//! 9. The vignette, by where the pixel is in the picture.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Grade {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32,
    pub tint: f32,
    pub saturation: f32,
    pub vibrance: f32,
    pub look: String,
    pub look_amount: f32,
    pub hue: f32,
    pub vignette: f32,
    pub curves: Curves,
    pub skin_keep: f32,
    pub skin_tone: f32,
    pub skin_light: f32,
}

/// Each curve is a list of points, x in and y out, 0 to 1. See src/document/grade.ts.
#[derive(Deserialize, Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Curves {
    pub light: Vec<[f32; 2]>,
    pub red: Vec<[f32; 2]>,
    pub green: Vec<[f32; 2]>,
    pub blue: Vec<[f32; 2]>,
    pub hue_hue: Vec<[f32; 2]>,
    pub hue_sat: Vec<[f32; 2]>,
    pub hue_light: Vec<[f32; 2]>,
    pub light_sat: Vec<[f32; 2]>,
}

/// How many steps a curve is worked out at. The same as CURVE_STEPS in grade.ts.
pub const CURVE_STEPS: usize = 256;

/// A curve as a table, worked out exactly as curveTable in grade.ts.
pub fn curve_table(pts: &[[f32; 2]], round: bool, middle: bool) -> Vec<f32> {
    (0..CURVE_STEPS)
        .map(|i| {
            let x = i as f32 / (CURVE_STEPS - 1) as f32;
            if pts.is_empty() {
                if middle { 0.5 } else { x }
            } else if round {
                round_at(pts, x)
            } else {
                tone_at(pts, x)
            }
        })
        .collect()
}

fn round_at(pts: &[[f32; 2]], x: f32) -> f32 {
    if pts.len() == 1 {
        return pts[0][1];
    }
    let j = pts.iter().position(|p| p[0] >= x).unwrap_or(0);
    let i = (j + pts.len() - 1) % pts.len();
    let ([x0, y0], [x1, y1]) = (pts[i], pts[j]);
    let span = (x1 - x0 + 1.0).rem_euclid(1.0);
    let span = if span == 0.0 { 1.0 } else { span };
    let t = (((x - x0 + 1.0).rem_euclid(1.0)) / span).clamp(0.0, 1.0);
    let e = (1.0 - (std::f32::consts::PI * t).cos()) / 2.0;
    y0 + (y1 - y0) * e
}

fn slope_at(pts: &[[f32; 2]], i: usize) -> f32 {
    let k = pts.len();
    let d = |a: usize| (pts[a + 1][1] - pts[a][1]) / (pts[a + 1][0] - pts[a][0]);
    if i == 0 {
        return d(0);
    }
    if i == k - 1 {
        return d(k - 2);
    }
    let (a, b) = (d(i - 1), d(i));
    if a * b <= 0.0 { 0.0 } else { 2.0 * a * b / (a + b) }
}

fn tone_at(pts: &[[f32; 2]], x: f32) -> f32 {
    let k = pts.len();
    // one point alone does not make a curve
    if k == 1 {
        return x;
    }
    if x <= pts[0][0] {
        return (pts[0][1] - (pts[0][0] - x) * slope_at(pts, 0)).clamp(0.0, 1.0);
    }
    if x >= pts[k - 1][0] {
        return (pts[k - 1][1] + (x - pts[k - 1][0]) * slope_at(pts, k - 1)).clamp(0.0, 1.0);
    }
    let mut i = 0;
    while pts[i + 1][0] < x {
        i += 1;
    }
    let ([x0, y0], [x1, y1]) = (pts[i], pts[i + 1]);
    let h = x1 - x0;
    let t = (x - x0) / h;
    let (m0, m1) = (slope_at(pts, i), slope_at(pts, i + 1));
    let (t2, t3) = (t * t, t * t * t);
    let y = (2.0 * t3 - 3.0 * t2 + 1.0) * y0 + (t3 - 2.0 * t2 + t) * h * m0 + (-2.0 * t3 + 3.0 * t2) * y1 + (t3 - t2) * h * m1;
    y.clamp(0.0, 1.0)
}

/// Read a curve table between its steps, as the shader's table() does.
fn table(t: &[f32], x: f32) -> f32 {
    let p = x.clamp(0.0, 1.0) * (CURVE_STEPS - 1) as f32;
    let i = p.floor().min((CURVE_STEPS - 2) as f32);
    let f = p - i;
    let i = i as usize;
    t[i] + (t[i + 1] - t[i]) * f
}

/// Colours turned round the wheel by some degrees, around the grey line, as turn() in the shader.
pub fn turn(v: [f32; 3], deg: f32) -> [f32; 3] {
    let (s, c) = deg.to_radians().sin_cos();
    let u = 0.577_350_27f32;
    let d = u * (v[0] + v[1] + v[2]);
    let cross = [u * (v[2] - v[1]), u * (v[0] - v[2]), u * (v[1] - v[0])];
    [0, 1, 2].map(|i| v[i] * c + cross[i] * s + u * d * (1.0 - c))
}

/// Hue 0 to 1 and how colourful, as in HSV, as hueSat() in the shader.
fn hue_sat(v: [f32; 3]) -> (f32, f32) {
    let hi = v[0].max(v[1]).max(v[2]);
    let d = hi - v[0].min(v[1]).min(v[2]);
    if d <= 1e-6 {
        return (0.0, 0.0);
    }
    let h = if hi == v[0] {
        ((v[1] - v[2]) / d).rem_euclid(6.0)
    } else if hi == v[1] {
        (v[2] - v[0]) / d + 2.0
    } else {
        (v[0] - v[1]) / d + 4.0
    };
    (h / 6.0, d / hi.max(1e-6))
}

/// How much a colour looks like skin, 0 to 1, as skin() in the shader.
pub fn skin(v: [f32; 3]) -> f32 {
    let (h, s) = hue_sat(v);
    let h = if h > 0.5 { h - 1.0 } else { h };
    let hi = v[0].max(v[1]).max(v[2]);
    smoothstep(-0.03, 0.0, h) * (1.0 - smoothstep(0.06, 0.09, h)) * smoothstep(0.2, 0.3, s) * (1.0 - smoothstep(0.65, 0.8, s)) * smoothstep(0.2, 0.35, hi)
}

const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];
const GREY: f32 = 0.18;

pub fn to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub fn to_display(v: f32) -> f32 {
    let v = v.clamp(0.0, 1.0);
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

type M3 = [[f64; 3]; 3];

fn mul(a: &M3, b: &M3) -> M3 {
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    m
}

fn apply(m: &M3, v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}

fn invert(m: &M3) -> M3 {
    let [[a, b, c], [d, e, f], [g, h, i]] = *m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
}

const RGB_TO_XYZ: M3 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]];
const BRADFORD: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
/// The daylight white that a temperature of 0 stands for.
const DAYLIGHT_K: f64 = 6504.0;

/// A white on the daylight line, by colour temperature in kelvin, as x and y.
fn daylight(k: f64) -> (f64, f64) {
    let k = k.clamp(4000.0, 25000.0);
    let x = if k <= 7000.0 {
        -4.6070e9 / k.powi(3) + 2.9678e6 / k.powi(2) + 0.09911e3 / k + 0.244063
    } else {
        -2.0064e9 / k.powi(3) + 1.9018e6 / k.powi(2) + 0.24748e3 / k + 0.237040
    };
    (x, -3.0 * x * x + 2.87 * x - 0.275)
}

/// The white balance as one matrix on linear RGB. Warmer means the picture is treated as if it was
/// lit by a bluer light and brought back to daylight; plus tint treats it as greener, so it turns magenta.
pub fn white_balance(temperature: f32, tint: f32) -> [[f32; 3]; 3] {
    let from_k = DAYLIGHT_K * 2f64.powf(temperature as f64 / 100.0 * 0.55);
    let (fx, fy) = daylight(from_k);
    let fy = fy + tint as f64 / 100.0 * 0.03;
    let (tx, ty) = daylight(DAYLIGHT_K);
    let cone = |x: f64, y: f64| apply(&BRADFORD, [x / y, 1.0, (1.0 - x - y) / y]);
    let (src, dst) = (cone(fx, fy), cone(tx, ty));
    let scale: M3 = [[dst[0] / src[0], 0.0, 0.0], [0.0, dst[1] / src[1], 0.0], [0.0, 0.0, dst[2] / src[2]]];
    let to_cone = mul(&BRADFORD, &RGB_TO_XYZ);
    let m = mul(&invert(&to_cone), &mul(&scale, &to_cone));
    m.map(|row| row.map(|v| v as f32))
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How far, in stops, each tone control moves a pixel that sits `s` stops from middle grey.
pub fn tone_shift(g: &Grade, s: f32) -> f32 {
    let shadows = 1.0 - smoothstep(-4.0, 0.5, s);
    let highlights = smoothstep(-0.5, 3.0, s);
    let whites = smoothstep(1.5, 3.5, s);
    let blacks = 1.0 - smoothstep(-6.0, -2.5, s);
    (g.shadows * shadows + g.highlights * highlights) / 100.0 * 1.5 + (g.whites * whites + g.blacks * blacks) / 100.0
}

/// A look read from a .cube file.
#[derive(Clone, Debug)]
pub struct Lut {
    /// 1 for a curve per channel, 3 for a cube.
    pub dim: u8,
    pub size: usize,
    pub min: [f32; 3],
    pub max: [f32; 3],
    /// r, g, b for each point, red changing fastest.
    pub data: Vec<f32>,
}

impl Lut {
    pub fn parse(text: &str) -> Result<Lut, String> {
        let (mut dim, mut size) = (0u8, 0usize);
        let (mut min, mut max) = ([0.0f32; 3], [1.0f32; 3]);
        let mut data = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut words = line.split_whitespace();
            let first = words.next().unwrap_or("");
            let three = |w: std::str::SplitWhitespace| -> Result<[f32; 3], String> {
                let v: Vec<f32> = w.map(|n| n.parse::<f32>().map_err(|_| format!("This look has a line it cannot read: {line}"))).collect::<Result<_, _>>()?;
                v.try_into().map_err(|_| format!("This look has a line it cannot read: {line}"))
            };
            match first {
                "TITLE" => {}
                "LUT_3D_SIZE" | "LUT_1D_SIZE" => {
                    dim = if first == "LUT_3D_SIZE" { 3 } else { 1 };
                    size = words.next().and_then(|n| n.parse().ok()).ok_or("The look does not say its size.")?;
                }
                "DOMAIN_MIN" => min = three(words)?,
                "DOMAIN_MAX" => max = three(words)?,
                "LUT_3D_INPUT_RANGE" | "LUT_1D_INPUT_RANGE" => {
                    let lo: f32 = words.next().and_then(|n| n.parse().ok()).unwrap_or(0.0);
                    let hi: f32 = words.next().and_then(|n| n.parse().ok()).unwrap_or(1.0);
                    (min, max) = ([lo; 3], [hi; 3]);
                }
                w if w.parse::<f32>().is_ok() => data.extend(three(line.split_whitespace())?),
                // other keywords from other programs carry nothing the look needs
                _ => {}
            }
        }
        if dim == 0 {
            return Err("This is not a .cube look: it has no LUT_3D_SIZE or LUT_1D_SIZE.".into());
        }
        let points = if dim == 3 { size.pow(3) } else { size };
        if size < 2 || (dim == 3 && size > 256) || data.len() != points * 3 {
            return Err(format!("This look should have {points} colours but has {}.", data.len() / 3));
        }
        Ok(Lut { dim, size, min, max, data })
    }

    fn at(&self, r: usize, g: usize, b: usize) -> [f32; 3] {
        let i = ((b * self.size + g) * self.size + r) * 3;
        [self.data[i], self.data[i + 1], self.data[i + 2]]
    }

    /// The look's colour for one colour. Cubes are read with tetrahedral interpolation, which keeps
    /// greys grey and does not shift hues between the grid points the way trilinear can.
    pub fn sample(&self, v: [f32; 3]) -> [f32; 3] {
        let n = (self.size - 1) as f32;
        let p: [f32; 3] = [0, 1, 2].map(|c| ((v[c] - self.min[c]) / (self.max[c] - self.min[c])).clamp(0.0, 1.0) * n);
        if self.dim == 1 {
            return [0, 1, 2].map(|c| {
                let i = (p[c].floor() as usize).min(self.size - 2);
                let f = p[c] - i as f32;
                let (a, b) = (self.data[i * 3 + c], self.data[(i + 1) * 3 + c]);
                a + (b - a) * f
            });
        }
        let i = p.map(|x| (x.floor() as usize).min(self.size - 2));
        let [fr, fg, fb] = [0, 1, 2].map(|c| p[c] - i[c] as f32);
        let c = |dr: usize, dg: usize, db: usize| self.at(i[0] + dr, i[1] + dg, i[2] + db);
        let (c000, c111) = (c(0, 0, 0), c(1, 1, 1));
        // the cell is split into six tetrahedra; the order of the three fractions picks one
        let (a, b, w) = if fr > fg {
            if fg > fb {
                (c(1, 0, 0), c(1, 1, 0), [fr, fg, fb])
            } else if fr > fb {
                (c(1, 0, 0), c(1, 0, 1), [fr, fb, fg])
            } else {
                (c(0, 0, 1), c(1, 0, 1), [fb, fr, fg])
            }
        } else if fb > fg {
            (c(0, 0, 1), c(0, 1, 1), [fb, fg, fr])
        } else if fb > fr {
            (c(0, 1, 0), c(0, 1, 1), [fg, fb, fr])
        } else {
            (c(0, 1, 0), c(1, 1, 0), [fg, fr, fb])
        };
        [0, 1, 2].map(|k| c000[k] + w[0] * (a[k] - c000[k]) + w[1] * (b[k] - a[k]) + w[2] * (c111[k] - b[k]))
    }
}

/// A grade made ready to run on many pixels: the matrix worked out and the look read once.
pub struct Ready {
    grade: Grade,
    balance: [[f32; 3]; 3],
    gain: f32,
    contrast: f32,
    look: Option<Lut>,
    /// light, red, green, blue, hue to hue, hue to colourfulness, hue to light, light to colourfulness
    tables: Vec<Vec<f32>>,
}

impl Ready {
    pub fn new(grade: Grade, look: Option<Lut>) -> Ready {
        let balance = white_balance(grade.temperature, grade.tint);
        let gain = 2f32.powf(grade.exposure);
        let contrast = contrast_power(grade.contrast);
        let c = &grade.curves;
        let tables = [(&c.light, false, false), (&c.red, false, false), (&c.green, false, false), (&c.blue, false, false), (&c.hue_hue, true, true), (&c.hue_sat, true, true), (&c.hue_light, true, true), (&c.light_sat, false, true)]
            .iter()
            .map(|(pts, round, middle)| curve_table(pts, *round, *middle))
            .collect();
        Ready { grade, balance, gain, contrast, look, tables }
    }

    /// One pixel, display light in and display light out, 0 to 1. x and y say where it is in the
    /// picture, 0 to 1, measured at the middle of the pixel.
    pub fn pixel(&self, v: [f32; 3], x: f32, y: f32) -> [f32; 3] {
        let (px, py) = (x, y);
        let g = &self.grade;
        let lin = v.map(to_linear);
        let m = &self.balance;
        let mut lin = [0, 1, 2].map(|i| (m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]) * self.gain);
        if self.contrast != 1.0 {
            lin = lin.map(|c| GREY * (c.max(0.0) / GREY).powf(self.contrast));
        }
        let y = dot(lin);
        if y > 1e-6 {
            let shift = tone_shift(g, (y / GREY).log2());
            if shift != 0.0 {
                let k = 2f32.powf(shift);
                lin = lin.map(|c| c * k);
            }
        }
        let mut out = lin.map(to_display);
        if let Some(lut) = &self.look {
            let amount = g.look_amount.clamp(0.0, 1.0);
            let looked = lut.sample(out);
            out = [0, 1, 2].map(|i| out[i] + (looked[i] - out[i]) * amount);
        }
        let t = &self.tables;
        out = out.map(|c| table(&t[0], c));
        out = [table(&t[1], out[0]), table(&t[2], out[1]), table(&t[3], out[2])];
        if g.hue != 0.0 {
            out = turn(out, g.hue);
        }
        let (h, _) = hue_sat(out);
        let chroma = out[0].max(out[1]).max(out[2]) - out[0].min(out[1]).min(out[2]);
        out = turn(out, (table(&t[4], h) - 0.5) * 120.0);
        let y = dot(out);
        let ks = table(&t[5], h) * 2.0 * table(&t[7], y) * 2.0;
        out = out.map(|c| y + (c - y) * ks);
        let kl = 2f32.powf((table(&t[6], h) - 0.5) * 2.0 * (chroma * 4.0).clamp(0.0, 1.0));
        out = out.map(|c| c * kl);
        let y = dot(out);
        let sat = out.iter().cloned().fold(f32::MIN, f32::max) - out.iter().cloned().fold(f32::MAX, f32::min);
        let k = (1.0 + g.saturation / 100.0) * (1.0 + g.vibrance / 100.0 * (1.0 - sat.clamp(0.0, 1.0)));
        out = out.map(|c| (y + (c - y) * k).clamp(0.0, 1.0));
        let m = skin(v);
        if m > 0.0 {
            if g.skin_keep > 0.0 {
                let r = dot(out) / dot(v).max(1e-4);
                let a = m * g.skin_keep / 100.0;
                out = [0, 1, 2].map(|i| out[i] + (v[i] * r - out[i]) * a);
            }
            if g.skin_tone != 0.0 {
                out = turn(out, g.skin_tone / 100.0 * 12.0 * m);
            }
            if g.skin_light != 0.0 {
                let k = 2f32.powf(g.skin_light / 100.0 * 0.5 * m);
                out = out.map(|c| c * k);
            }
        }
        if g.vignette != 0.0 {
            let d = (((px - 0.5) * 2.0).powi(2) + ((py - 0.5) * 2.0).powi(2)).sqrt() / std::f32::consts::SQRT_2;
            let k = 1.0 + g.vignette / 100.0 * 0.8 * smoothstep(0.35, 1.0, d);
            out = out.map(|c| c * k);
        }
        out.map(|c| c.clamp(0.0, 1.0))
    }
}

fn dot(v: [f32; 3]) -> f32 {
    LUMA[0] * v[0] + LUMA[1] * v[1] + LUMA[2] * v[2]
}

/// The power that contrast raises light to, around middle grey. 100 is a strong but usable push.
pub fn contrast_power(contrast: f32) -> f32 {
    if contrast >= 0.0 {
        1.0 + contrast / 100.0 * 0.6
    } else {
        1.0 + contrast / 100.0 * 0.5
    }
}

/// Grade a whole frame of 16-bit RGB, `width` pixels across, in place, on every core of the processor.
pub fn frame_rgb48(ready: &Ready, pixels: &mut [u16], width: usize) {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let width = width.max(1);
    let height = (pixels.len() / 3).div_ceil(width).max(1);
    // whole rows to each core, so every pixel knows where it is
    let rows = height.div_ceil(threads);
    std::thread::scope(|s| {
        for (part_i, part) in pixels.chunks_mut(rows * width * 3).enumerate() {
            s.spawn(move || {
                for (n, px) in part.chunks_exact_mut(3).enumerate() {
                    let at = part_i * rows * width + n;
                    let (x, y) = (((at % width) as f32 + 0.5) / width as f32, ((at / width) as f32 + 0.5) / height as f32);
                    let out = ready.pixel([px[0], px[1], px[2]].map(|c| c as f32 / 65535.0), x, y);
                    for i in 0..3 {
                        px[i] = (out[i] * 65535.0).round() as u16;
                    }
                }
            });
        }
    });
}

/// Where looks are kept: beside the projects, so a design opened again still finds its look.
fn looks_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(crate::default_projects_dir()?).join("Looks"))
}

/// Keep a copy of a .cube look in the Looks folder and say where it is. A look already kept is used again.
#[tauri::command(async)]
pub fn look_keep(path: String) -> Result<String, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Could not read the look: {e}"))?;
    Lut::parse(&text)?;
    let dir = looks_dir()?;
    if PathBuf::from(&path).parent() == Some(dir.as_path()) {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = PathBuf::from(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "look.cube".into());
    let (stem, ext) = name.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((name.clone(), String::new()));
    let mut to = dir.join(&name);
    let mut n = 2;
    while to.exists() {
        if std::fs::read_to_string(&to).is_ok_and(|t| t == text) {
            return Ok(to.to_string_lossy().to_string());
        }
        to = dir.join(format!("{stem} {n}{ext}"));
        n += 1;
    }
    std::fs::write(&to, &text).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

/// The looks kept so far, by full path.
#[tauri::command(async)]
pub fn looks_list() -> Result<Vec<String>, String> {
    let Ok(dir) = std::fs::read_dir(looks_dir()?) else { return Ok(vec![]) };
    let mut list: Vec<String> = dir
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("cube")))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    list.sort();
    Ok(list)
}

#[derive(Serialize)]
pub struct LookData {
    dim: u8,
    size: usize,
    min: [f32; 3],
    max: [f32; 3],
    /// The colours as 32-bit floats, in base64, red changing fastest.
    data: String,
}

/// A look read for the preview.
#[tauri::command(async)]
pub fn look_read(path: String) -> Result<LookData, String> {
    use base64::Engine;
    let text = std::fs::read_to_string(&path).map_err(|_| "The look file is missing. Load it again.".to_string())?;
    let lut = Lut::parse(&text)?;
    let bytes: Vec<u8> = lut.data.iter().flat_map(|f| f.to_le_bytes()).collect();
    Ok(LookData { dim: lut.dim, size: lut.size, min: lut.min, max: lut.max, data: base64::engine::general_purpose::STANDARD.encode(bytes) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f32; 3], b: [f32; 3], by: f32) -> bool {
        (0..3).all(|i| (a[i] - b[i]).abs() <= by)
    }

    /// The same pixels and answers are checked by the preview's tests (src/document/grade-fixtures.json).
    #[test]
    fn matches_the_shared_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../src/document/grade-fixtures.json")).unwrap();
        for case in fixtures["pixels"].as_array().unwrap() {
            let grade: Grade = serde_json::from_value(case["grade"].clone()).unwrap();
            let ready = Ready::new(Grade { look_amount: 1.0, ..grade }, None);
            let input: [f32; 3] = serde_json::from_value(case["in"].clone()).unwrap();
            let want: [f32; 3] = serde_json::from_value(case["out"].clone()).unwrap();
            let at: [f32; 2] = case.get("at").map(|a| serde_json::from_value(a.clone()).unwrap()).unwrap_or([0.5, 0.5]);
            let got = ready.pixel(input, at[0], at[1]);
            assert!(close(got, want, 0.002), "{}: got {got:?}, want {want:?}", case["name"]);
        }
        for case in fixtures["tables"].as_array().unwrap() {
            let pts: Vec<[f32; 2]> = serde_json::from_value(case["points"].clone()).unwrap();
            let t = curve_table(&pts, case["round"].as_bool().unwrap(), case["middle"].as_bool().unwrap());
            for (i, want) in case["at"].as_array().unwrap().iter().zip(case["values"].as_array().unwrap()) {
                assert!((t[i.as_u64().unwrap() as usize] - want.as_f64().unwrap() as f32).abs() < 1e-5, "curve {pts:?} at {i}");
            }
        }
        for case in fixtures["balance"].as_array().unwrap() {
            let m = white_balance(case["temperature"].as_f64().unwrap() as f32, case["tint"].as_f64().unwrap() as f32);
            let want: [[f32; 3]; 3] = serde_json::from_value(case["matrix"].clone()).unwrap();
            for i in 0..3 {
                assert!(close(m[i], want[i], 0.0005), "balance row {i}: got {:?}, want {:?}", m[i], want[i]);
            }
        }
    }

    #[test]
    fn a_neutral_grade_leaves_every_colour_alone() {
        let ready = Ready::new(Grade { look_amount: 1.0, ..Default::default() }, None);
        for v in [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.2, 0.5, 0.8], [0.9, 0.1, 0.3]] {
            assert!(close(ready.pixel(v, 0.5, 0.5), v, 0.0005), "{v:?} became {:?}", ready.pixel(v, 0.5, 0.5));
        }
    }

    #[test]
    fn warmer_adds_red_and_takes_blue_and_keeps_grey_grey_in_brightness() {
        let warm = Ready::new(Grade { temperature: 60.0, ..Default::default() }, None);
        let out = warm.pixel([0.5, 0.5, 0.5], 0.5, 0.5);
        assert!(out[0] > 0.5 && out[2] < 0.5, "{out:?}");
        let magenta = Ready::new(Grade { tint: 60.0, ..Default::default() }, None);
        let out = magenta.pixel([0.5, 0.5, 0.5], 0.5, 0.5);
        assert!(out[1] < out[0] && out[1] < out[2], "{out:?}");
    }

    #[test]
    fn one_stop_down_halves_the_light() {
        let ready = Ready::new(Grade { exposure: -1.0, ..Default::default() }, None);
        let out = ready.pixel([0.8, 0.8, 0.8], 0.5, 0.5);
        assert!((to_linear(out[0]) - to_linear(0.8) / 2.0).abs() < 1e-4);
    }

    #[test]
    fn shadows_lift_the_darks_and_leave_the_brights() {
        let ready = Ready::new(Grade { shadows: 80.0, ..Default::default() }, None);
        assert!(ready.pixel([0.1, 0.1, 0.1], 0.5, 0.5)[0] > 0.15);
        assert!((ready.pixel([0.95, 0.95, 0.95], 0.5, 0.5)[0] - 0.95).abs() < 0.01);
    }

    #[test]
    fn minus_100_saturation_is_black_and_white() {
        let ready = Ready::new(Grade { saturation: -100.0, ..Default::default() }, None);
        let out = ready.pixel([0.9, 0.2, 0.1], 0.5, 0.5);
        assert!(close([out[0]; 3], out, 1e-5), "{out:?}");
    }

    #[test]
    fn reads_a_cube_and_an_identity_look_changes_nothing() {
        let mut text = String::from("# made by hand\nTITLE \"same\"\nLUT_3D_SIZE 3\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n");
        for b in 0..3 {
            for g in 0..3 {
                for r in 0..3 {
                    text += &format!("{} {} {}\n", r as f32 / 2.0, g as f32 / 2.0, b as f32 / 2.0);
                }
            }
        }
        let lut = Lut::parse(&text).unwrap();
        for v in [[0.1, 0.7, 0.3], [0.9, 0.9, 0.2], [0.33, 0.66, 0.99]] {
            assert!(close(lut.sample(v), v, 1e-5), "{v:?}");
        }
        // a look that swaps red and blue, to prove red changes fastest
        let mut swap = String::from("LUT_3D_SIZE 2\n");
        for b in 0..2 {
            for g in 0..2 {
                for r in 0..2 {
                    swap += &format!("{b} {g} {r}\n");
                }
            }
        }
        let lut = Lut::parse(&swap).unwrap();
        assert!(close(lut.sample([1.0, 0.0, 0.0]), [0.0, 0.0, 1.0], 1e-5));
        assert!(Lut::parse("LUT_3D_SIZE 2\n0 0 0\n").is_err());
        assert!(Lut::parse("hello").is_err());
    }

    #[test]
    fn grades_a_16_bit_frame_on_every_core() {
        let ready = Ready::new(Grade { exposure: 1.0, ..Default::default() }, None);
        let mut px = vec![16384u16; 3 * 1000];
        frame_rgb48(&ready, &mut px, 1000);
        let want = (ready.pixel([16384.0 / 65535.0; 3], 0.5, 0.5)[0] * 65535.0).round() as u16;
        assert!(px.iter().all(|&p| p == want));
    }
}

#[cfg(test)]
mod make_fixtures {
    use super::*;
    /// Run by hand to write grade-fixtures.json: cargo test make_fixtures -- --ignored --nocapture
    #[test]
    #[ignore]
    fn print() {
        let cases: Vec<(&str, serde_json::Value, [f32; 3])> = vec![
            ("exposure down", serde_json::json!({"exposure": -1.5}), [0.8, 0.6, 0.4]),
            ("contrast up", serde_json::json!({"contrast": 50}), [0.3, 0.5, 0.7]),
            ("contrast down", serde_json::json!({"contrast": -60}), [0.1, 0.9, 0.5]),
            ("warm and magenta", serde_json::json!({"temperature": 40, "tint": 25}), [0.5, 0.5, 0.5]),
            ("cool and green", serde_json::json!({"temperature": -70, "tint": -40}), [0.7, 0.4, 0.2]),
            ("shadows and highlights", serde_json::json!({"shadows": 60, "highlights": -70}), [0.15, 0.2, 0.25]),
            ("bright highlights", serde_json::json!({"shadows": 60, "highlights": -70}), [0.95, 0.9, 0.85]),
            ("whites and blacks", serde_json::json!({"whites": -50, "blacks": 40}), [0.02, 0.98, 0.5]),
            ("saturation and vibrance", serde_json::json!({"saturation": 30, "vibrance": -40}), [0.8, 0.3, 0.2]),
            ("everything", serde_json::json!({"exposure": -0.7, "contrast": -20, "highlights": -40, "shadows": 20, "whites": -10, "blacks": 5, "temperature": -15, "tint": 8, "saturation": -10, "vibrance": 20}), [0.9, 0.85, 0.7]),
            ("hue", serde_json::json!({"hue": 60}), [0.8, 0.3, 0.2]),
            ("light curve", serde_json::json!({"curves": {"light": [[0, 0.05], [0.5, 0.6], [1, 0.95]]}}), [0.3, 0.5, 0.7]),
            ("red and blue curves", serde_json::json!({"curves": {"red": [[0, 0], [0.5, 0.4], [1, 1]], "blue": [[0, 0.1], [1, 1]]}}), [0.5, 0.5, 0.5]),
            ("one colour", serde_json::json!({"curves": {"hueHue": [[0.5, 0.5], [0.6, 0.7], [0.7, 0.5]], "hueSat": [[0.5, 0.5], [0.6, 0.8], [0.7, 0.5]], "hueLight": [[0.5, 0.5], [0.6, 0.3], [0.7, 0.5]]}}), [0.2, 0.5, 0.8]),
            ("light to colourfulness", serde_json::json!({"curves": {"lightSat": [[0, 0.2], [0.5, 0.5], [1, 0.5]]}}), [0.3, 0.1, 0.05]),
            ("skin kept", serde_json::json!({"temperature": -60, "saturation": 40, "skinKeep": 100}), [0.85, 0.62, 0.5]),
            ("skin turned and brighter", serde_json::json!({"skinTone": 80, "skinLight": 50}), [0.8, 0.55, 0.45]),
            ("sky is not skin", serde_json::json!({"skinTone": 80, "skinLight": 50, "skinKeep": 100}), [0.3, 0.5, 0.9]),
        ];
        let pixels: Vec<serde_json::Value> = cases
            .into_iter()
            .map(|(name, g, v)| {
                let grade: Grade = serde_json::from_value(g.clone()).unwrap();
                let out = Ready::new(Grade { look_amount: 1.0, ..grade }, None).pixel(v, 0.5, 0.5);
                serde_json::json!({"name": name, "grade": g, "in": v, "out": out.map(|c| (c * 100000.0).round() / 100000.0)})
            })
            .collect();
        let corners: Vec<serde_json::Value> = [(-80.0, [0.05, 0.05]), (60.0, [0.95, 0.5]), (-100.0, [0.5, 0.5])]
            .into_iter()
            .map(|(v, at): (f32, [f32; 2])| {
                let out = Ready::new(Grade { vignette: v, look_amount: 1.0, ..Default::default() }, None).pixel([0.6, 0.5, 0.4], at[0], at[1]);
                serde_json::json!({"name": format!("vignette {v}"), "grade": {"vignette": v}, "in": [0.6, 0.5, 0.4], "at": at, "out": out.map(|c| (c * 100000.0).round() / 100000.0)})
            })
            .collect();
        let pixels: Vec<serde_json::Value> = pixels.into_iter().chain(corners).collect();
        let pick = [0usize, 37, 64, 128, 170, 200, 255];
        let tables: Vec<serde_json::Value> = [
            (serde_json::json!([[0, 0.05], [0.5, 0.6], [1, 0.95]]), false, false),
            (serde_json::json!([[0.2, 0.1], [0.4, 0.8], [0.9, 0.85]]), false, false),
            (serde_json::json!([[0.5, 0.5], [0.6, 0.7], [0.7, 0.5]]), true, true),
            (serde_json::json!([[0.9, 0.2], [0.1, 0.8]]), true, true),
            (serde_json::json!([]), false, true),
        ]
        .into_iter()
        .map(|(pts, round, middle)| {
            let p: Vec<[f32; 2]> = serde_json::from_value(pts.clone()).unwrap();
            let t = curve_table(&p, round, middle);
            serde_json::json!({"points": pts, "round": round, "middle": middle, "at": pick, "values": pick.map(|i| (t[i] * 1000000.0).round() / 1000000.0)})
        })
        .collect();
        let turns: Vec<serde_json::Value> = [([0.8f32, 0.3, 0.2], 40.0f32), ([0.1, 0.6, 0.9], -120.0)]
            .into_iter()
            .map(|(v, d)| serde_json::json!({"in": v, "deg": d, "out": turn(v, d).map(|c| (c * 1000000.0).round() / 1000000.0)}))
            .collect();
        let balance: Vec<serde_json::Value> = [(40.0, 25.0), (-70.0, -40.0), (100.0, 0.0), (0.0, -100.0)]
            .into_iter()
            .map(|(t, n)| serde_json::json!({"temperature": t, "tint": n, "matrix": white_balance(t, n).map(|r| r.map(|c| (c * 1000000.0).round() / 1000000.0))}))
            .collect();
        println!("FIXTURES{}", serde_json::to_string_pretty(&serde_json::json!({"pixels": pixels, "balance": balance, "tables": tables, "turns": turns})).unwrap());
    }
}

#[cfg(test)]
mod check_export {
    use super::*;
    /// Run by hand: compares a frame of an exported video with the source frame graded here.
    /// GRADE_SRC, GRADE_OUT: raw rgb48le frames of the same size, GRADE_WIDTH pixels across. GRADE_JSON: the grade.
    #[test]
    #[ignore]
    fn compare() {
        let read = |k: &str| -> Vec<u16> { std::fs::read(std::env::var(k).unwrap()).unwrap().chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect() };
        let (mut src, out) = (read("GRADE_SRC"), read("GRADE_OUT"));
        let g: Grade = serde_json::from_str(&std::env::var("GRADE_JSON").unwrap()).unwrap();
        let look = (!g.look.is_empty()).then(|| Lut::parse(&std::fs::read_to_string(&g.look).unwrap()).unwrap());
        let ready = Ready::new(g, look);
        let width: usize = std::env::var("GRADE_WIDTH").unwrap().parse().unwrap();
        let mut spare = src.clone();
        let t = std::time::Instant::now();
        for _ in 0..10 {
            frame_rgb48(&ready, &mut spare, width);
        }
        println!("RESULT one frame takes {:.1} ms", t.elapsed().as_secs_f64() * 100.0);
        frame_rgb48(&ready, &mut src, width);
        let n = src.len() as f64;
        let mean = src.iter().zip(&out).map(|(a, b)| (*a as f64 - *b as f64).abs()).sum::<f64>() / n / 65535.0 * 255.0;
        let ungraded = read("GRADE_SRC").iter().zip(&out).map(|(a, b)| (*a as f64 - *b as f64).abs()).sum::<f64>() / n / 65535.0 * 255.0;
        println!("RESULT mean difference from the engine: {mean:.3} of 255; from the ungraded source: {ungraded:.3} of 255");
    }
}
