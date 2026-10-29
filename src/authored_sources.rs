//! Numeric plans for the existing authored local source artwork.
//!
//! No Canvas, image, source identity, randomness, clocks or loading live here.

/// One ordered paint operation. The browser only binds these copied operands.
#[derive(Clone, Debug, PartialEq)]
pub enum PaintCommand {
    /// Select a literal authored CSS color.
    FillStyle(String),
    /// Select the authored source opacity.
    GlobalAlpha(f64),
    /// Begin an independent path.
    BeginPath,
    /// Circle center, radius and start/end angles.
    Arc([f64; 5]),
    /// Move to a source-pixel point.
    MoveTo([f64; 2]),
    /// Append a source-pixel point.
    LineTo([f64; 2]),
    /// Close the current path.
    ClosePath,
    /// Fill the current path.
    Fill,
    /// Fill a source-pixel rectangle.
    FillRect([f64; 4]),
    /// Create a radial gradient, add its ordered stops, then select it for filling.
    RadialGradient {
        /// Inner circle followed by outer circle.
        circles: [f64; 6],
        /// Exact offset and authored CSS color in submission order.
        stops: Vec<(f64, String)>,
    },
}

/// One source's native dimensions and complete ordered painting plan.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasRecipe {
    /// Native backing width.
    pub width: u32,
    /// Native backing height.
    pub height: u32,
    /// Source-center metadata used by food/prey factories.
    pub half_width: f64,
    /// Source-center metadata used by food/prey factories.
    pub half_height: f64,
    /// Browser operations, without source allocation or readback.
    pub commands: Vec<PaintCommand>,
}

impl CanvasRecipe {
    fn new(width: u32, height: u32, commands: Vec<PaintCommand>) -> Self {
        Self {
            width,
            height,
            half_width: f64::from(width) / 2.,
            half_height: f64::from(height) / 2.,
            commands,
        }
    }
}

/// Seven shaded body variants and their existing boost source.
#[derive(Clone, Debug, PartialEq)]
pub struct BodySourcePalette {
    /// Ordered first through seventh source variant.
    pub variants: Vec<CanvasRecipe>,
    /// One existing boost-glow source.
    pub boost_glow: CanvasRecipe,
}

/// Complete authored body source families; geometry selection remains `resolve_local_skin`.
#[derive(Clone, Debug, PartialEq)]
pub struct BodySourceRecipes {
    /// Three authored families in their existing order.
    pub palettes: Vec<BodySourcePalette>,
    /// Early body outline.
    pub outline: CanvasRecipe,
    /// Body shadow.
    pub shadow: CanvasRecipe,
    /// Death highlight.
    pub death_highlight: CanvasRecipe,
}

/// One food or prey source family, before browser object binding.
#[derive(Clone, Debug, PartialEq)]
pub struct EntitySourcePalette {
    /// Creation-selected authored family ID.
    pub color: u32,
    /// Existing body-family count; food exposes this separately.
    pub count: usize,
    /// Ordered body sources.
    pub bodies: Vec<CanvasRecipe>,
    /// Ordered outline sources (empty for prey).
    pub outlines: Vec<CanvasRecipe>,
    /// Ordered glow sources.
    pub glows: Vec<CanvasRecipe>,
}

/// Fresh numeric source data for one authored local source pool.
#[derive(Clone, Debug, PartialEq)]
pub struct AuthoredSourceRecipes {
    /// Existing authored body colors, also used as nickname tint bases.
    pub palette_rgb: [[u8; 3]; 3],
    /// Three legacy flat source canvases.
    pub palettes: Vec<CanvasRecipe>,
    /// Repeating hexagon tile; remains distinct from the backdrop.
    pub tile: CanvasRecipe,
    /// Existing whole-scene backdrop.
    pub backdrop: CanvasRecipe,
    /// Existing shaded body/effect sources.
    pub body_sources: BodySourceRecipes,
    /// Ten authored food families.
    pub food: Vec<EntitySourcePalette>,
    /// Nine authored prey families.
    pub prey: Vec<EntitySourcePalette>,
}

fn css_hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn circle(width: u32, height: u32, color: &str, alpha: Option<f64>, radius: f64) -> CanvasRecipe {
    let mut commands = vec![PaintCommand::FillStyle(color.into())];
    if let Some(alpha) = alpha {
        commands.push(PaintCommand::GlobalAlpha(alpha));
    }
    commands.extend([
        PaintCommand::BeginPath,
        PaintCommand::Arc([
            f64::from(width) / 2.,
            f64::from(height) / 2.,
            radius,
            0.,
            std::f64::consts::PI * 2.,
        ]),
        PaintCommand::Fill,
    ]);
    CanvasRecipe::new(width, height, commands)
}

fn hexagon(commands: &mut Vec<PaintCommand>, x: f64, y: f64, radius: f64, color: &str) {
    let x = x * 3.;
    let y = y * 3.;
    let radius = radius * 3.;
    commands.extend([
        PaintCommand::FillStyle(color.into()),
        PaintCommand::BeginPath,
        PaintCommand::MoveTo([x + radius, y + radius / 4.]),
        PaintCommand::LineTo([x + radius / 4., y + radius]),
        PaintCommand::LineTo([x - radius * 3. / 4., y + radius * 3. / 4.]),
        PaintCommand::LineTo([x - radius, y - radius / 4.]),
        PaintCommand::LineTo([x - radius / 4., y - radius]),
        PaintCommand::LineTo([x + radius * 3. / 4., y - radius * 3. / 4.]),
        PaintCommand::ClosePath,
        PaintCommand::Fill,
    ]);
}

fn radial(stops: &[(f64, String)], light_x: f64, light_y: f64) -> CanvasRecipe {
    CanvasRecipe::new(
        64,
        64,
        vec![
            PaintCommand::RadialGradient {
                circles: [light_x, light_y, 0., 32., 32., 31.],
                stops: stops.to_vec(),
            },
            PaintCommand::FillRect([0., 0., 64., 64.]),
        ],
    )
}

fn shade(rgb: [u8; 3], amount: f64, alpha: f64) -> String {
    let channels = rgb.map(|channel| {
        let channel = f64::from(channel);
        // All authored inputs yield positive channels: Rust round matches Math.round.
        if amount < 0. {
            (channel * (1. + amount)).round() as u32
        } else {
            (channel + (255. - channel) * amount).round() as u32
        }
    });
    format!(
        "rgba({},{},{},{alpha})",
        channels[0], channels[1], channels[2]
    )
}

fn literal_stops(stops: &[(f64, &str)]) -> Vec<(f64, String)> {
    stops
        .iter()
        .map(|&(offset, color)| (offset, color.into()))
        .collect()
}

/// Plan exactly the existing authored source pool, without allocating browser resources.
pub fn authored_source_recipes() -> AuthoredSourceRecipes {
    let palette_rgb = [[0x83, 0xd5, 0xb0], [0xef, 0xbb, 0x62], [0x76, 0xb9, 0xed]];
    let palettes = palette_rgb
        .map(|rgb| circle(32, 32, &css_hex(rgb), None, 16.))
        .into();
    let mut tile_commands = Vec::new();
    for column in 0..=4 {
        for row in -1..=2 {
            let x = f64::from(column * 27);
            let y = f64::from(row * 32 + (column % 2) * 16);
            hexagon(&mut tile_commands, x, y, 15., "#09131d");
            hexagon(&mut tile_commands, x, y - 0.5, 13.5, "#26384a");
            hexagon(&mut tile_commands, x, y + 0.5, 13., "#1c2b3b");
        }
    }
    let body_palettes = palette_rgb
        .into_iter()
        .map(|rgb| BodySourcePalette {
            variants: (0..7)
                .map(|index| {
                    let tone = f64::from(index - 3) * 0.045;
                    radial(
                        &[
                            (0., shade(rgb, tone + 0.3, 1.)),
                            (0.42, shade(rgb, tone, 1.)),
                            (0.82, shade(rgb, tone - 0.28, 1.)),
                            (0.96, shade(rgb, tone - 0.48, 0.9)),
                            (1., shade(rgb, tone - 0.48, 0.)),
                        ],
                        25.,
                        23.,
                    )
                })
                .collect(),
            boost_glow: radial(
                &[
                    (0., shade(rgb, 0.2, 0.68)),
                    (0.2, shade(rgb, 0.2, 0.55)),
                    (0.58, shade(rgb, 0.1, 0.2)),
                    (0.85, shade(rgb, 0., 0.04)),
                    (1., shade(rgb, 0., 0.)),
                ],
                32.,
                32.,
            ),
        })
        .collect();
    let food = [
        "#ffd35a", "#74dd9a", "#a9a4f2", "#ee9276", "#68c9e8", "#ed92cb", "#c0d476", "#e9b78b",
        "#8ba9e9", "#d6dde3",
    ]
    .into_iter()
    .enumerate()
    .map(|(palette, color)| {
        let family = |kind| {
            (0..8)
                .map(|index| {
                    let width = 15 + 4 * index;
                    let height = 13 + 2 * index;
                    let radius = (f64::from(height) / 2. - if kind == 0 { 2. } else { 0. }).max(1.);
                    circle(
                        width,
                        height,
                        if kind == 1 { "#17202a" } else { color },
                        Some(if kind == 2 { 0.25 } else { 1. }),
                        radius,
                    )
                })
                .collect()
        };
        EntitySourcePalette {
            color: palette as u32,
            count: 8,
            bodies: family(0),
            outlines: family(1),
            glows: family(2),
        }
    })
    .collect();
    let prey = [
        "#ffcf62", "#82d5aa", "#b2a3ef", "#ec957c", "#79c9e4", "#df9bc8", "#c3d87a", "#e1b991",
        "#94b4ea",
    ]
    .into_iter()
    .enumerate()
    .map(|(palette, color)| {
        let family = |count, glow| {
            (0..count)
                .map(|index| {
                    let width = if glow { 57 + index * 8 } else { 21 + index * 4 };
                    let height = if glow { 53 + index * 6 } else { 19 + index * 4 };
                    circle(
                        width,
                        height,
                        color,
                        Some(if glow { 0.18 } else { 1. }),
                        f64::from(height) / if glow { 2. } else { 3. },
                    )
                })
                .collect()
        };
        EntitySourcePalette {
            color: palette as u32,
            count: 4,
            bodies: family(4, false),
            outlines: vec![],
            glows: family(3, true),
        }
    })
    .collect();
    AuthoredSourceRecipes {
        palette_rgb,
        palettes,
        tile: CanvasRecipe::new(108 * 3, 64 * 3, tile_commands),
        backdrop: CanvasRecipe::new(
            512,
            512,
            vec![
                PaintCommand::FillStyle("#34475b".into()),
                PaintCommand::FillRect([0., 0., 512., 512.]),
            ],
        ),
        body_sources: BodySourceRecipes {
            palettes: body_palettes,
            outline: radial(
                &literal_stops(&[
                    (0., "rgba(23,34,45,1)"),
                    (0.88, "rgba(23,34,45,1)"),
                    (0.95, "rgba(23,34,45,0.7)"),
                    (1., "rgba(23,34,45,0)"),
                ]),
                32.,
                32.,
            ),
            shadow: radial(
                &literal_stops(&[
                    (0., "rgba(0,0,0,0.55)"),
                    (0.52, "rgba(0,0,0,0.42)"),
                    (0.8, "rgba(0,0,0,0.16)"),
                    (1., "rgba(0,0,0,0)"),
                ]),
                32.,
                32.,
            ),
            death_highlight: radial(
                &literal_stops(&[
                    (0., "rgba(255,255,255,0.9)"),
                    (0.45, "rgba(255,255,255,0.48)"),
                    (0.9, "rgba(255,255,255,0.15)"),
                    (1., "rgba(255,255,255,0)"),
                ]),
                25.,
                23.,
            ),
        },
        food,
        prey,
    }
}
