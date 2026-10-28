//! Numeric normal-gameplay selection from the authored `web/stock-skin-rules.mjs`.
//! Sources remain caller-owned; no cosmetic wire byte selects a static accessory.

use std::{error::Error, fmt};

use super::{
    AntennaBulbGeometry, BodyFade, BodyRect, BodyRun, BodyStyle, BodyVariantMode, FaceGeometry,
    MouthFaceGeometry, OrdinaryAntennaGeometry, PairedFaceGeometry, PairedSideGeometry,
    SingleEyeGeometry, StandardEyeGeometry,
};

/// Borrowed image role, independent of source identity, readiness and dimensions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SkinSourceRole {
    /// Single-image eye base (`jsebi`).
    SingleEyeBase,
    /// Single-image pupil (`jsepi`).
    SingleEyePupil,
    /// Mouth-family eye marks (`ecmc`).
    MouthEyeMarks,
    /// Mouth image (`jmou`).
    Mouth,
    /// Paired side images (`sest`).
    PairedSide,
    /// Ordinary antenna bulb (`acbulb`).
    AcBulb,
    /// Ordinary antenna bulb (`cdbulb`).
    CdBulb,
    /// Ordinary antenna bulb (`kwkbulb`).
    KwkBulb,
    /// Ordinary antenna bulb (`pwdbulb`).
    PwdBulb,
    /// Ordinary antenna bulb (`playbulb`).
    PlayBulb,
    /// Ordinary antenna bulb (`leafbulb`).
    LeafBulb,
    /// Ordinary antenna bulb (`swissbulb`).
    SwissBulb,
    /// Ordinary antenna bulb (`moldovabulb`).
    MoldovaBulb,
    /// Ordinary antenna bulb (`vietnambulb`).
    VietnamBulb,
    /// Ordinary antenna bulb (`argentinabulb`).
    ArgentinaBulb,
    /// Ordinary antenna bulb (`movbulb`).
    MovBulb,
    /// Ordinary antenna bulb (`bonkbulb`).
    BonkBulb,
}

impl SkinSourceRole {
    /// Existing authored slot name for a caller's borrowed-source binding.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SingleEyeBase => "jsebi",
            Self::SingleEyePupil => "jsepi",
            Self::MouthEyeMarks => "ecmc",
            Self::Mouth => "jmou",
            Self::PairedSide => "sest",
            Self::AcBulb => "acbulb",
            Self::CdBulb => "cdbulb",
            Self::KwkBulb => "kwkbulb",
            Self::PwdBulb => "pwdbulb",
            Self::PlayBulb => "playbulb",
            Self::LeafBulb => "leafbulb",
            Self::SwissBulb => "swissbulb",
            Self::MoldovaBulb => "moldovabulb",
            Self::VietnamBulb => "vietnambulb",
            Self::ArgentinaBulb => "argentinabulb",
            Self::MovBulb => "movbulb",
            Self::BonkBulb => "bonkbulb",
        }
    }
}

/// Numeric source use; `None` retains whole-source drawing semantics.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SkinImage {
    /// Caller-bound source role.
    pub source: SkinSourceRole,
    /// Explicit source-pixel crop, independent of destination geometry.
    pub source_rect: Option<BodyRect>,
}

/// Image roles selected alongside the matching [`FaceGeometry`] family.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SkinFaceSources {
    /// Ordinary geometric eyes require no image source.
    None,
    /// One whole source shared by both paired side images.
    PairedSide(SkinSourceRole),
    /// Base then pupil, with explicit crops.
    SingleImage {
        /// Eye-base use.
        base: SkinImage,
        /// Pupil use.
        pupil: SkinImage,
    },
    /// Whole sources for two shared eye marks, then the mouth.
    Mouth {
        /// Shared eye-mark source.
        eye_marks: SkinSourceRole,
        /// Mouth source.
        mouth: SkinSourceRole,
    },
}

/// Ordinary chain geometry and its whole-source bulb role.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SkinAntenna {
    /// Appearance-owned numeric geometry.
    pub geometry: OrdinaryAntennaGeometry,
    /// Caller-bound whole-source bulb.
    pub source: SkinSourceRole,
}

/// Backend-neutral selection, before source binding or palette-table remapping.
///
/// For [`resolve_skin`], `base_palette`, run palettes and fade palettes are stock
/// family IDs (0..42), not indices into a compact draw recipe; the binding must
/// remap them together. [`resolve_authored_local_skin`] instead selects one of
/// three authored local stand-in families, with no stock color mapping implied.
#[derive(Clone, Debug, PartialEq)]
pub struct SkinDescriptor {
    /// Requested skin byte, retained even when custom runs override it.
    pub skin: u8,
    /// At least one normal custom run was admitted.
    pub custom: bool,
    /// First run's family ID, in the selected resolver's palette namespace.
    pub base_palette: usize,
    /// Positive runs in head-to-tail cycle order; the cycle seam is preserved.
    pub runs: Vec<BodyRun>,
    /// Spatial shading mode of the base family.
    pub variant_mode: BodyVariantMode,
    /// Spatial shading period, including the custom override.
    pub variant_period: usize,
    /// Body geometry policy, with the selected resolver's family IDs in its fades.
    pub body_style: BodyStyle,
    /// Appearance-owned numeric face geometry.
    pub face: FaceGeometry,
    /// Image roles required by the selected face.
    pub face_sources: SkinFaceSources,
    /// Optional ordinary antenna; custom runs suppress it.
    pub antenna: Option<SkinAntenna>,
}

/// Custom data exceeds the existing 255-byte normal-gameplay limit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SkinError;

impl fmt::Display for SkinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("custom skin data exceeds 255 bytes")
    }
}

impl Error for SkinError {}

/// Preserve the current authored local three-color stand-in selection.
///
/// Without admitted custom runs, select `skin % 3` and seven ping-pong variants.
/// Otherwise reuse normal custom admission, projecting each admitted palette
/// modulo three without merging the resulting runs, with first-variant shading.
/// Both paths retain plain paired eyes, no antenna and the requested skin byte.
/// These authored family IDs do not claim stock 42-palette color equivalence.
pub fn resolve_authored_local_skin(
    skin: u8,
    custom_bytes: &[u8],
) -> Result<SkinDescriptor, SkinError> {
    let mut descriptor = resolve_skin(skin % 3, custom_bytes, false)?;
    descriptor.skin = skin;
    if descriptor.custom {
        for run in &mut descriptor.runs {
            run.palette %= 3;
        }
        descriptor.base_palette = descriptor.runs[0].palette;
    }
    Ok(descriptor)
}

/// Select the authored normal-gameplay recipe without inspecting any sources.
///
/// The first eight custom bytes are opaque. Subsequent complete count/palette
/// pairs admit positive normal runs, merging adjacent admitted equal palettes.
/// If none survive, selection falls back to the built-in skin, including its
/// special face and antenna. `no_segment_rotation` applies to both paths.
pub fn resolve_skin(
    skin: u8,
    custom_bytes: &[u8],
    no_segment_rotation: bool,
) -> Result<SkinDescriptor, SkinError> {
    if custom_bytes.len() > 255 {
        return Err(SkinError);
    }
    let mut runs: Vec<BodyRun> = Vec::new();
    for pair in custom_bytes.get(8..).unwrap_or_default().as_chunks::<2>().0 {
        let count = usize::from(pair[0]);
        let palette = usize::from(pair[1]);
        if count == 0 || !matches!(palette, 0..=35 | 37 | 39 | 41) {
            continue;
        }
        if let Some(previous) = runs.last_mut().filter(|run| run.palette == palette) {
            previous.count += count;
        } else {
            runs.push(BodyRun { palette, count });
        }
    }
    let custom = !runs.is_empty();
    if !custom {
        runs = builtin(skin);
    }
    let base_palette = runs[0].palette;
    let dense = !custom && skin == 60;
    let antenna = if custom { None } else { antenna(skin) };
    let mut eyes = StandardEyeGeometry::default();
    let mut decoration = None;
    let mut face_sources = SkinFaceSources::None;
    if !custom {
        if antenna.is_some() && skin != 24 {
            eyes.eye_alpha = 1.;
        }
        match skin {
            25 => eyes.eye_color = [255, 86, 9],
            41 => {
                eyes = StandardEyeGeometry {
                    forward: 34.,
                    separation: 14.,
                    eye_radius: 8.,
                    pupil_radius: 4.5,
                    pupil_travel: 3.,
                    outline_width: 3.,
                    eye_alpha: 1.,
                    ..eyes
                };
                decoration = Some(PairedSideGeometry {
                    forward: 13.,
                    lateral: 6.,
                    lateral_bias: 0.5,
                    rotation_offset: 0.4,
                    image_scale: 0.25,
                    pivot_x: 28.,
                    pivot_y: 44.,
                    width: 105.,
                    height: 88.,
                });
                face_sources = SkinFaceSources::PairedSide(SkinSourceRole::PairedSide);
            }
            44 => eyes.eye_color = [212; 3],
            63 => {
                eyes.eye_color = [0; 3];
                eyes.eye_alpha = 1.;
                eyes.pupil_color = [204; 3];
                eyes.pupil_radius = 2.5;
            }
            64 => {
                eyes.eye_color = [255, 255, 128];
                eyes.eye_alpha = 1.;
            }
            _ => {}
        }
    }
    let face = match (custom, skin) {
        (false, 27) => {
            face_sources = SkinFaceSources::SingleImage {
                base: SkinImage {
                    source: SkinSourceRole::SingleEyeBase,
                    source_rect: Some(BodyRect {
                        x: 0.,
                        y: 0.,
                        width: 64.,
                        height: 64.,
                    }),
                },
                pupil: SkinImage {
                    source: SkinSourceRole::SingleEyePupil,
                    source_rect: Some(BodyRect {
                        x: 0.,
                        y: 0.,
                        width: 48.,
                        height: 48.,
                    }),
                },
            };
            FaceGeometry::SingleImage(SingleEyeGeometry {
                base_size: 29.,
                pupil_size: 14.,
                pupil_travel: 4.,
            })
        }
        (false, 40) => {
            face_sources = SkinFaceSources::Mouth {
                eye_marks: SkinSourceRole::MouthEyeMarks,
                mouth: SkinSourceRole::Mouth,
            };
            FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 2.3 })
        }
        _ => FaceGeometry::Paired(PairedFaceGeometry { eyes, decoration }),
    };
    Ok(SkinDescriptor {
        skin,
        custom,
        base_palette,
        runs,
        variant_mode: if custom {
            BodyVariantMode::First
        } else if base_palette == 36 {
            BodyVariantMode::Cycle
        } else {
            BodyVariantMode::PingPong
        },
        variant_period: if custom {
            1
        } else if base_palette == 36 {
            60
        } else {
            7
        },
        body_style: BodyStyle {
            detailed_segments: dense,
            swell: if !custom && skin == 27 { 0.06 } else { 0. },
            rotate_segments: !no_segment_rotation,
            head_fade: dense.then_some(BodyFade {
                palette: 37,
                length: 30.,
            }),
            tail_fade: dense.then_some(BodyFade {
                palette: 38,
                length: 30.,
            }),
        },
        face,
        face_sources,
        antenna,
    })
}

fn builtin(skin: u8) -> Vec<BodyRun> {
    let pairs: &[(usize, usize)] = match skin {
        9 => &[
            (7, 1),
            (9, 1),
            (7, 1),
            (9, 1),
            (7, 1),
            (9, 1),
            (7, 1),
            (9, 1),
            (7, 1),
            (9, 1),
            (7, 1),
            (10, 9),
        ],
        10 => &[(9, 5), (1, 5), (7, 5)],
        11 => &[(11, 5), (7, 5), (12, 5)],
        12 => &[(7, 5), (9, 5), (13, 5)],
        13 => &[(14, 5), (9, 5), (7, 5)],
        14 => &[(9, 7), (7, 7)],
        15 => &[
            (0, 1),
            (1, 1),
            (2, 1),
            (3, 1),
            (4, 1),
            (5, 1),
            (6, 1),
            (7, 1),
            (8, 1),
        ],
        16 => &[(15, 7), (4, 7)],
        17 => &[(9, 7), (16, 7)],
        18 => &[(7, 7), (9, 7)],
        19 => &[(9, 1)],
        20 => &[(3, 5), (0, 5)],
        21 => &[
            (3, 7),
            (18, 6),
            (20, 1),
            (19, 1),
            (20, 1),
            (19, 1),
            (20, 1),
            (19, 1),
            (20, 1),
            (18, 6),
        ],
        22 => &[(5, 7), (9, 7), (13, 7)],
        23 => &[(16, 7), (18, 7), (7, 7)],
        24 => &[(23, 9), (18, 9)],
        25 => &[(21, 12), (22, 9)],
        26 => &[(24, 1)],
        27 => &[(25, 1)],
        28 => &[(18, 7), (25, 7), (7, 7)],
        29 => &[(11, 2), (4, 1), (11, 4), (4, 1), (11, 2)],
        30 => &[(10, 2), (19, 1), (20, 1), (10, 2), (20, 1), (19, 1)],
        31 => &[(10, 2)],
        32 => &[(20, 2)],
        33 => &[(12, 1), (11, 2)],
        34 => &[
            (7, 2),
            (9, 1),
            (13, 2),
            (9, 1),
            (16, 2),
            (9, 1),
            (12, 2),
            (9, 1),
            (7, 2),
            (9, 1),
            (16, 2),
            (9, 1),
        ],
        35 => &[(7, 2), (9, 2), (6, 2), (9, 2)],
        36 => &[(16, 2), (9, 2), (15, 2), (9, 2)],
        37 => &[(22, 1)],
        38 => &[(18, 1)],
        39 => &[(23, 1)],
        40 => &[(26, 1)],
        41 => &[(27, 1)],
        42 => &[(2, 8), (3, 8), (5, 8), (7, 8)],
        43 => &[(28, 1)],
        44 => &[(29, 1)],
        45 => &[(7, 3), (9, 8), (7, 3)],
        46 | 48 => &[(7, 1)],
        47 => &[(16, 3), (18, 9), (7, 8), (16, 4)],
        49 => &[(23, 5), (9, 8), (23, 2)],
        50 => &[(18, 14), (16, 8), (7, 8)],
        51 => &[(7, 3), (9, 2), (16, 6), (9, 2)],
        52 => &[(7, 4), (18, 9), (7, 5)],
        53..=58 => {
            return vec![BodyRun {
                palette: usize::from(skin - 23),
                count: 1,
            }];
        }
        59 => &[(18, 1)],
        60 => &[(36, 1)],
        61 => &[(30, 6), (35, 6), (33, 6), (31, 6), (32, 6), (34, 6)],
        62 => &[(17, 5), (39, 5)],
        63 => &[(7, 3), (11, 3)],
        64 => &[(16, 2), (11, 2)],
        65 => &[(4, 4), (9, 4)],
        _ => {
            return vec![BodyRun {
                palette: usize::from(skin % 9),
                count: 1,
            }];
        }
    };
    pairs
        .iter()
        .map(|&(palette, count)| BodyRun { palette, count })
        .collect()
}

fn antenna(skin: u8) -> Option<SkinAntenna> {
    use SkinSourceRole::*;
    // Preserve the authored binary64 multiplication, negation, subtraction order.
    let (
        nodes,
        outer_color,
        inner_color,
        inner_opacity,
        repeated_inner_strokes,
        rotate_bulb,
        source,
        offset_x,
        offset_y,
        width,
        height,
        scale,
        opacity,
    ) = match skin {
        24 => (
            8, 0x00688c, 0x64c8e7, 0.35, true, false, AcBulb, -10., -10., 20., 20., 1., 0.75,
        ),
        25 => (
            9, 0, 0x5630d7, 1., false, true, CdBulb, -5., -10., 20., 20., 1.6, 1.,
        ),
        37 => (
            9, 0x301400, 0xff6813, 0.5, true, true, KwkBulb, -39., -63., 172., 113., 0.42, 1.,
        ),
        39 => (
            9, 0x1d3245, 0x44d4ff, 0.43, true, true, PwdBulb, -36., -100., 190., 188., 0.25, 1.,
        ),
        42 => (
            9, 0x002828, 0x80d0d0, 0.5, true, true, PlayBulb, -29., -74., 142., 149., 0.36, 1.,
        ),
        45 => (
            9,
            0xc02020,
            0xff4040,
            0.5,
            true,
            true,
            LeafBulb,
            -(101. * 0.11) - 21.,
            -81.,
            143.,
            161.,
            0.33,
            1.,
        ),
        46 => (
            9,
            0xc02020,
            0xff4040,
            0.5,
            true,
            true,
            SwissBulb,
            -(98. * 0.11) - 21.,
            -70.,
            140.,
            140.,
            0.285,
            1.,
        ),
        47 => (
            9,
            0x3030ff,
            0x6060ff,
            0.5,
            true,
            true,
            MoldovaBulb,
            -(120. * 0.11) - 21.,
            -69.,
            162.,
            137.,
            0.33,
            1.,
        ),
        48 => (
            9,
            0xc02020,
            0xff4040,
            0.75,
            true,
            true,
            VietnamBulb,
            -(95. * 0.11) - 21.,
            -71.,
            137.,
            142.,
            0.3,
            1.,
        ),
        49 => (
            11,
            0x64accf,
            0x84dcff,
            0.7,
            true,
            true,
            ArgentinaBulb,
            -(110. * 0.11) - 21.,
            -76.,
            152.,
            152.,
            0.3,
            1.,
        ),
        59 => (
            11, 0x886818, 0xffe040, 0.55, true, true, MovBulb, -41., -91., 142., 163., 0.3, 1.,
        ),
        62 => (
            9, 0x402200, 0xffc20f, 0.5, true, true, BonkBulb, -29., -89., 173., 178., 0.25, 1.,
        ),
        _ => return None,
    };
    Some(SkinAntenna {
        source,
        geometry: OrdinaryAntennaGeometry {
            nodes,
            outer_color,
            inner_color,
            inner_opacity,
            repeated_inner_strokes,
            rotate_bulb,
            bulb: AntennaBulbGeometry {
                offset_x,
                offset_y,
                width,
                height,
                scale,
                opacity,
            },
        },
    })
}
