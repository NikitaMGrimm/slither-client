//! Independently authored standard material plans from retained numeric interoperability facts.
//! No reference program, raster asset, browser object or source identity is retained here.

use super::{
    BodySourcePalette, BodySourceRecipes, CanvasRecipe, EntitySourcePalette, PaintCommand,
};

pub(super) const COLORS: [[u8; 3]; 42] = [
    [192, 128, 255],
    [144, 153, 255],
    [128, 208, 208],
    [128, 255, 128],
    [238, 238, 112],
    [255, 160, 96],
    [255, 144, 144],
    [255, 64, 64],
    [224, 48, 224],
    [255, 255, 255],
    [144, 153, 255],
    [80, 80, 80],
    [255, 192, 80],
    [40, 136, 96],
    [100, 117, 255],
    [120, 134, 255],
    [72, 84, 255],
    [160, 80, 255],
    [255, 224, 64],
    [56, 68, 255],
    [56, 68, 255],
    [78, 35, 192],
    [255, 86, 9],
    [101, 200, 232],
    [128, 132, 144],
    [60, 192, 72],
    [0, 255, 83],
    [217, 69, 69],
    [255, 64, 64],
    [144, 144, 144],
    [32, 32, 240],
    [240, 32, 32],
    [240, 240, 32],
    [240, 144, 32],
    [240, 32, 240],
    [32, 240, 32],
    [40, 60, 173],
    [104, 128, 255],
    [0, 0, 112],
    [104, 40, 170],
    [0, 0, 0],
    [128, 128, 255],
];

fn byte(value: f64) -> u8 {
    value.floor().clamp(0., 255.) as u8
}
fn blend(color: &mut [f64; 3], target: [f64; 3], amount: f64) {
    for (channel, target) in color.iter_mut().zip(target) {
        *channel += (target - *channel) * amount;
    }
}
fn raster(size: u32, sample: impl Fn(u32, u32) -> [u8; 4]) -> CanvasRecipe {
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    for y in 0..size {
        for x in 0..size {
            rgba.extend(sample(x, y));
        }
    }
    CanvasRecipe::new(
        size,
        size,
        vec![PaintCommand::Pixels {
            width: size,
            height: size,
            rgba,
        }],
    )
}
fn body_color(palette: usize, variant: usize, count: usize, x: f64, y: f64) -> [u8; 4] {
    let dx = x - 24.;
    let dy = y - 24.;
    let vertical = (1. - dy.abs() / 24.).clamp(0., 1.);
    let radial = (1. - (dx * dx + dy * dy).sqrt() / 34.).clamp(0., 1.);
    let mut light = vertical.powf(0.35);
    light += (radial - light) * 0.375;
    let gain = 1.22 - 0.44 * variant as f64 / (count - 1) as f64;
    let oval_radius = ((0.5 * dx).powi(2) + dy * dy).sqrt() / 24.;
    let oval = oval_radius.powi(2).min(1.);
    let mut color = COLORS[palette].map(f64::from);
    match palette {
        24 => {
            blend(
                &mut color,
                [255., 192., 64.].map(|c| c * 1.2),
                (oval_radius * 1.05).powi(4).min(1.),
            );
            light *= gain;
        }
        26 | 27 => {
            color = color.map(|c| c * (light * gain));
            let target = if palette == 26 {
                [128., 255., 136.].map(|c| c * 1.1)
            } else {
                [217., 69., 69.].map(|c| c * 1.1)
            };
            blend(&mut color, target, oval);
            light = 1.;
        }
        28 => {
            blend(
                &mut color,
                [128., 128., 255.],
                0.5 - 0.5 * (std::f64::consts::PI * variant as f64 / count as f64).cos(),
            );
            light = (light * 1.1).min(1.);
        }
        29 => {
            color = [light * (1.44 - 0.88 * variant as f64 / (count - 1) as f64) * 32.; 3];
            blend(&mut color, [255.; 3], oval);
            light = 1.;
        }
        30..=35 | 41 => {
            // Parametric material rows: interior offset/slope and luminous rim.
            let (offset, slope, rim, strength) = match palette {
                30 => (
                    [0., 0., 128.],
                    [80., 80., 160.],
                    [255., 255., 255. * 1.4],
                    0.3,
                ),
                31 => (
                    [128., 0., 0.],
                    [160., 80., 80.],
                    [255. * 1.4, 255., 255.],
                    0.3,
                ),
                32 => (
                    [96., 96., 0.],
                    [128., 128., 80.],
                    [255. * 1.2, 255. * 1.2, 255.],
                    0.6,
                ),
                33 => (
                    [96., 48., 0.],
                    [128., 80., 48.],
                    [255. * 1.2, 255. * 1.1, 255.],
                    0.6,
                ),
                34 => (
                    [96., 0., 96.],
                    [128., 80., 128.],
                    [255. * 1.2, 255., 255. * 1.2],
                    0.6,
                ),
                35 => (
                    [0., 96., 0.],
                    [80., 128., 80.],
                    [255., 255. * 1.2, 255.],
                    0.6,
                ),
                _ => (
                    [0., 0., 160.],
                    [240., 255., 255.],
                    [255., 255., 255. * 1.4],
                    0.3,
                ),
            };
            let phase = (0.1 + 0.9 * variant as f64 / count as f64).fract();
            color = std::array::from_fn(|i| offset[i] + phase * slope[i]);
            blend(&mut color, rim, strength * oval);
            light = 1.;
        }
        36 => {
            let phase = (variant as f64 / count as f64 + 0.6 + 0.25 * x / 48.).fract();
            // Two mirrored bands, with a narrow colored core and broader white rim.
            let branch = if phase < 0.5 { -1. } else { 1. };
            for sign in [1., -1.] {
                let band = |offset: f64, width: f64| {
                    ((1.3 * ((sign * dy + offset) / 48. - 1.3 * (phase - 0.5)) * 2.).abs() * width)
                        .min(1.)
                };
                blend(&mut color, [255. * 2.2; 3], 1. - band(0., 2.4));
                blend(
                    &mut color,
                    [255., 32., 64.],
                    1. - band(branch * sign * 24. * 0.055, 4.8),
                );
            }
            let across = dy / 48.;
            let amount = 1. - ((0.5 - phase).abs() / 0.5).powi(2);
            if (0.47..=0.53).contains(&phase) {
                color = [255., 32., 64.];
            } else if across.abs() <= 0.1 {
                blend(&mut color, [255., 32., 64.], amount);
            } else if (0.44..=0.56).contains(&phase) || across.abs() <= 0.15 {
                blend(&mut color, [255.; 3], amount);
            }
            light = vertical.powf(0.35);
            blend(
                &mut color,
                COLORS[palette].map(f64::from),
                1. - vertical.sqrt(),
            );
        }
        _ => light *= gain,
    }
    [
        byte(color[0] * light),
        byte(color[1] * light),
        byte(color[2] * light),
        255,
    ]
}
fn star(commands: &mut Vec<PaintCommand>, center: [f64; 2], inner: f64, outer: f64, alpha: f64) {
    commands.extend([
        PaintCommand::GlobalAlpha(alpha),
        PaintCommand::FillStyle("#ffffff".into()),
        PaintCommand::BeginPath,
    ]);
    for corner in 0..=11 {
        let angle = std::f64::consts::TAU * corner as f64 / 10.;
        let radius = if corner % 2 == 0 { inner } else { outer };
        let point = [
            center[0] + angle.cos() * radius,
            center[1] + angle.sin() * radius,
        ];
        commands.push(if corner == 0 {
            PaintCommand::MoveTo(point)
        } else {
            PaintCommand::LineTo(point)
        });
    }
    commands.extend([PaintCommand::Fill, PaintCommand::GlobalAlpha(1.)]);
}
fn body(palette: usize, variant: usize, count: usize) -> CanvasRecipe {
    let mut result = raster(48, |x, y| {
        body_color(palette, variant, count, f64::from(x), f64::from(y))
    });
    // Native Canvas supplies its own antialiased disk coverage. Rust supplies all color samples.
    result.commands.extend([
        PaintCommand::Composite("destination-in"),
        PaintCommand::FillStyle("#ffffff".into()),
        PaintCommand::BeginPath,
        PaintCommand::Arc([24., 24., 24., 0., std::f64::consts::TAU]),
        PaintCommand::Fill,
        PaintCommand::Composite("source-over"),
    ]);
    let decoration = match palette {
        10 => Some((-1., 1., 8., 1.8, 4.65, 1.)),
        19 => Some((-2., 2., 15., 0.9, 2.325, 0.7)),
        20 => Some((-1.5, 1.5, 15., 1.05, 2.7, 0.7)),
        _ => None,
    };
    if let Some((start, end, divisor, inner, outer, alpha)) = decoration {
        let mut index = start;
        while index <= end {
            let angle = std::f64::consts::TAU * index / divisor;
            star(
                &mut result.commands,
                [24. + angle.cos() * 19.5, 24. + angle.sin() * 19.5],
                inner,
                outer,
                alpha,
            );
            index += 1.;
        }
    }
    result
}
fn boost(palette: usize) -> CanvasRecipe {
    let family = match palette {
        26 | 35 => 3,
        29 => 9,
        30 | 41 => 15,
        31 | 36 => 7,
        32 => 4,
        33 => 5,
        34 => 0,
        _ => palette,
    };
    let rgb = COLORS[family].map(f64::from);
    let mean = (rgb[0] + rgb[1] + rgb[2]) / 3.;
    let rgb = if mean <= 24. {
        [90.; 3]
    } else {
        rgb.map(|c| (c * (120. / mean)).floor().min(255.))
    };
    raster(62, |x, y| {
        let d = ((31. - f64::from(x)).powi(2) + (31. - f64::from(y)).powi(2)).sqrt();
        let falloff = 1. - d / 32.;
        let alpha = if falloff < 0. {
            0.
        } else {
            0.5 * (1. - (std::f64::consts::PI * falloff).cos())
        };
        [byte(rgb[0]), byte(rgb[1]), byte(rgb[2]), byte(255. * alpha)]
    })
}
pub(super) fn bodies() -> BodySourceRecipes {
    let outline = raster(52, |x, y| {
        let d = ((26. - f64::from(x)).powi(2) + (26. - f64::from(y)).powi(2)).sqrt();
        [
            0,
            0,
            0,
            byte(255. * 0.8 * (1. - (d - 16.).abs() / 4.).max(0.)),
        ]
    });
    let shadow = raster(62, |x, y| {
        let d = ((31. - f64::from(x)).powi(2) + (34. - f64::from(y)).powi(2)).sqrt();
        [
            0,
            0,
            0,
            byte(255. * 0.25 * (1. - ((d - 15.) * 0.1).abs().min(1.))),
        ]
    });
    BodySourceRecipes {
        palettes: (0..42)
            .map(|p| {
                let count = if p == 36 { 60 } else { 7 };
                BodySourcePalette {
                    variants: (0..count).map(|v| body(p, v, count)).collect(),
                    boost_glow: boost(p),
                }
            })
            .collect(),
        outline,
        shadow,
        death_highlight: super::circle(32, 32, "#ff9966", None, 16.),
    }
}
fn rgba(rgb: [u8; 3], alpha: f64) -> String {
    format!("rgba({},{},{},{alpha})", rgb[0], rgb[1], rgb[2])
}
fn gradient(size: u32, inner: f64, outer: f64, stops: Vec<(f64, String)>) -> CanvasRecipe {
    let c = f64::from(size) / 2.;
    CanvasRecipe::new(
        size,
        size,
        vec![
            PaintCommand::RadialGradient {
                circles: [c, c, inner, c, c, outer],
                stops,
            },
            PaintCommand::FillRect([0., 0., f64::from(size), f64::from(size)]),
        ],
    )
}
pub(super) fn food() -> Vec<EntitySourcePalette> {
    (0..10)
        .map(|p| {
            let rgb = COLORS[p];
            let body_rgb = if p == 9 { [160; 3] } else { rgb };
            let mut bodies = Vec::new();
            let mut glows = Vec::new();
            let mut outlines = Vec::new();
            for index in 0..17 {
                let scale = 2.8 + f64::from(index);
                let size = (2. * (scale * 0.65)).ceil() as u32;
                bodies.push(gradient(
                    size,
                    0.,
                    f64::from(size) / 2.,
                    vec![
                        (0., rgba(body_rgb, 1.)),
                        (0.99, rgba(body_rgb, 0.2)),
                        (1., rgba(body_rgb, 0.)),
                    ],
                ));
                let size = (scale * 8. + 6.).ceil() as u32;
                glows.push(gradient(
                    size,
                    1.,
                    scale * 4.,
                    vec![(0., rgba(rgb, 1.)), (1., rgba(rgb, 0.))],
                ));
                let disk = (2. * (scale * 0.7)).ceil() + 2.;
                let size = disk as u32 + 20;
                let mut outline = super::circle(size, size, "#000000", None, disk / 2.);
                outline.commands.splice(
                    0..0,
                    [PaintCommand::Shadow {
                        blur: 6.,
                        offset_y: 1. + 2. * scale / 18.8,
                        color: "#000000".into(),
                    }],
                );
                outlines.push(outline);
            }
            EntitySourcePalette {
                color: p as u32,
                count: bodies.len(),
                bodies,
                outlines,
                glows,
            }
        })
        .collect()
}
pub(super) fn prey() -> Vec<EntitySourcePalette> {
    let food = food();
    (0..9)
        .map(|p| {
            let rgb = COLORS[p];
            let bodies = (3..=24)
                .map(|size| {
                    let extent = (size * 2 + 38) as u32;
                    let mut recipe = super::circle(
                        extent,
                        extent,
                        &super::css_hex(rgb),
                        None,
                        f64::from(size) / 2.,
                    );
                    recipe.commands.splice(
                        0..0,
                        [PaintCommand::Shadow {
                            blur: 22.,
                            offset_y: 0.,
                            color: super::css_hex(rgb),
                        }],
                    );
                    recipe.commands.push(PaintCommand::Fill);
                    recipe
                })
                .collect();
            EntitySourcePalette {
                color: p as u32,
                count: 22,
                bodies,
                outlines: vec![],
                glows: food[p].glows.clone(),
            }
        })
        .collect()
}
