//! Opt-in image binding. The resolver receives relative paths, never remote URLs.
//! Artwork stays outside Git; numeric layouts remain in the shared presentation core.
use crate::{Result, materials::RgbaImage, scene::Resource};
use slither_client::{presentation::*, state::Appearance};
use std::{collections::BTreeMap, io::Cursor};

pub const MAX_ENCODED_BYTES: usize = 4 * 1024 * 1024;
pub const COSMETIC_PIXEL_BUDGET: usize = 16 * 1024 * 1024;

// Public resource identifiers and attachment metadata, independently transcribed
// as data. This is not a copy of the external loader or drawing implementation.
pub const ACCESSORIES: [(&str, f64, f64, f64); 32] = [
    ("oakley", 0.205, 66., 87.),
    ("graduation", 0.2, 205., 101.),
    ("funkystar", 0.205, 83., 87.),
    ("headphones", 0.25, 130., 97.),
    ("eyebrows", 0.25, 64., 82.),
    ("spikecollar", 0.25, 94., 79.),
    ("disguise", 0.25, 64., 90.),
    ("cape", 0.32, 170., 86.),
    ("crown", 0.18, 180., 75.),
    ("antlers", 0.3, 120., 100.),
    ("unicorn", 0.3, 201., 40.),
    ("angel", 0.3, 152., 125.),
    ("bat", 0.25, 132., 150.),
    ("dragon", 0.25, 145., 140.),
    ("bear", 0.165, 115., 90.),
    ("rabbit", 0.19, 172., 125.),
    ("cat", 0.19, 127., 90.),
    ("dreadlocks", 0.25, 114., 80.),
    ("blonde", 0.225, 144., 85.),
    ("ginger", 0.225, 154., 89.),
    ("blackhair", 0.215, 159., 91.),
    ("mohawk", 0.215, 184., 47.),
    ("catglass", 0.19, 88., 106.),
    ("swirly", 0.19, 63., 106.),
    ("nerdglass", 0.19, 93., 105.),
    ("3dglass", 0.17, 94., 122.),
    ("heartglass", 0.153, 54., 113.),
    ("monocle", 0.175, 60., 22.),
    ("deerstalker", 0.19, 195., 77.),
    ("visor", 0.21, 77., 92.),
    ("cap", 0.19, 194., 80.),
    ("hardhat", 0.16, 223., 90.),
];
// role, relative path, retained canvas size, inset, black shadow
const IMAGES: [(SkinSourceRole, &str, u32, u32, u32); 12] = {
    use SkinSourceRole::*;
    [
        (Mouth, "s/jmou3.png", 79, 130, 0),
        (PairedSide, "s2/sest5.png", 105, 88, 0),
        (KwkBulb, "s/kwk6.png", 172, 113, 21),
        (PwdBulb, "s/pewd.png", 190, 188, 21),
        (PlayBulb, "s/play.png", 142, 149, 21),
        (LeafBulb, "s/leaf.png", 143, 161, 21),
        (SwissBulb, "s/swiss.png", 140, 140, 21),
        (MoldovaBulb, "s/moldova.png", 162, 137, 21),
        (VietnamBulb, "s/vietnam.png", 137, 142, 21),
        (ArgentinaBulb, "s/argentina.png", 152, 152, 21),
        (MovBulb, "s/mov2.png", 142, 163, 21),
        (BonkBulb, "s/bonkers2.png", 173, 178, 21),
    ]
};

pub fn paths() -> Vec<String> {
    IMAGES
        .iter()
        .map(|v| v.1.to_owned())
        .chain(ACCESSORIES.iter().map(|v| format!("s/a_{}.png", v.0)))
        .collect()
}

/// PNG/JPEG only, with limits installed before decoding and RGBA allocation.
pub fn decode(bytes: &[u8]) -> Result<RgbaImage> {
    if bytes.is_empty() || bytes.len() > MAX_ENCODED_BYTES {
        return Err("Cosmetic encoded image budget".into());
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg)
    ) {
        return Err("Cosmetic image must be PNG or JPEG".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(16 * 1024 * 1024);
    reader.limits(limits);
    let rgba = reader.decode().map_err(|e| e.to_string())?.into_rgba8();
    let (width, height) = rgba.dimensions();
    let mut pixels = rgba.into_raw();
    for p in pixels.as_chunks_mut::<4>().0.iter_mut() {
        for i in 0..3 {
            p[i] = ((u16::from(p[i]) * u16::from(p[3]) + 127) / 255) as u8;
        }
    }
    Ok(RgbaImage {
        width,
        height,
        pixels,
    })
}

#[derive(Default)]
pub struct Images {
    images: BTreeMap<String, RgbaImage>,
    bytes: usize,
}
impl Images {
    pub fn add(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        if !paths().iter().any(|p| p == path) || self.images.contains_key(path) {
            return Err("Unknown or duplicate cosmetic path".into());
        }
        let image = decode(bytes)?;
        let charge = image.pixels.len();
        if self.bytes + charge > COSMETIC_PIXEL_BUDGET {
            return Err("Cosmetic pixel budget".into());
        }
        self.images.insert(path.into(), image);
        self.bytes += charge;
        Ok(())
    }
}

pub struct Cosmetics {
    roles: BTreeMap<&'static str, Resource>,
    accessories: BTreeMap<u8, Resource>,
    pub own_accessory: Option<u8>,
}
impl Cosmetics {
    /// The only byte-source seam. Native and browser bind it to local development inputs.
    pub fn load(mut resolve: impl FnMut(&str) -> Result<Vec<u8>>, own: Option<u8>) -> Result<Self> {
        let mut images = Images::default();
        for path in paths() {
            if let Err(error) = resolve(&path).and_then(|bytes| images.add(&path, &bytes)) {
                eprintln!("Cosmetic {path} unavailable: {error}");
            }
        }
        Self::from_images(images, own)
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn directory(directory: &std::path::Path, own: Option<u8>) -> Result<Self> {
        use std::io::Read;
        let root = match directory.canonicalize() {
            Ok(root) => root,
            Err(error) => {
                eprintln!("Cosmetics directory unavailable: {error}");
                return Self::from_images(Images::default(), own);
            }
        };
        Self::load(
            |path| {
                let file = root.join(path).canonicalize().map_err(|e| e.to_string())?;
                if !file.starts_with(&root) {
                    return Err("Cosmetic path escaped directory".into());
                }
                let mut bytes = Vec::new();
                std::fs::File::open(file)
                    .map_err(|e| e.to_string())?
                    .take(MAX_ENCODED_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                Ok(bytes)
            },
            own,
        )
    }
    pub fn from_images(mut images: Images, own: Option<u8>) -> Result<Self> {
        if own.is_some_and(|v| usize::from(v) >= ACCESSORIES.len()) {
            return Err("Accessory must be 0..31".into());
        }
        let mut next = 0x4000_0000_0000_0000_u64;
        let mut bytes = 0;
        let mut resource = |image: RgbaImage, name: &str| {
            if bytes + image.pixels.len() > COSMETIC_PIXEL_BUDGET {
                eprintln!("Cosmetic {name} unavailable: pixel budget");
                return None;
            }
            bytes += image.pixels.len();
            next += 1;
            Some(Resource {
                asset: BodyAsset {
                    handle: next,
                    revision: 1,
                    width: image.width,
                    height: image.height,
                    status: BodyAssetStatus::Ready,
                },
                image,
            })
        };
        let mut roles = BTreeMap::new();
        for (role, path, w, h, inset) in IMAGES {
            if let Some(image) = images.images.remove(path)
                && let Some(source) = resource(canvas_image(image, w, h, inset, inset != 0), path)
            {
                roles.insert(role.as_str(), source);
            }
        }
        for role in [
            SkinSourceRole::SingleEyeBase,
            SkinSourceRole::SingleEyePupil,
            SkinSourceRole::MouthEyeMarks,
            SkinSourceRole::AcBulb,
            SkinSourceRole::CdBulb,
        ] {
            match procedural(role) {
                Ok(image) => {
                    if let Some(source) = resource(image, role.as_str()) {
                        roles.insert(role.as_str(), source);
                    }
                }
                Err(error) => eprintln!("Cosmetic {} unavailable: {error}", role.as_str()),
            }
        }
        let accessories = ACCESSORIES
            .iter()
            .enumerate()
            .filter_map(|(id, v)| {
                let path = format!("s/a_{}.png", v.0);
                let image = images.images.remove(&path)?;
                resource(image, &path).map(|source| (id as u8, source))
            })
            .collect();
        let result = Self {
            roles,
            accessories,
            own_accessory: own,
        };
        Ok(result)
    }
    pub fn role(&self, role: SkinSourceRole) -> Option<BodyAsset> {
        self.roles.get(role.as_str()).map(|r| r.asset)
    }
    fn selected_accessory(&self, own: bool) -> Option<(u8, &Resource)> {
        let id = self.own_accessory.filter(|_| own)?;
        self.accessories.get(&id).map(|source| (id, source))
    }
    pub fn accessory(&self, own: bool) -> Option<&Resource> {
        self.selected_accessory(own).map(|(_, source)| source)
    }
    /// Resource readiness and retained geometry must agree before appearance publication.
    pub fn skin(&self, skin: u8, custom: &[u8]) -> std::result::Result<SkinDescriptor, SkinError> {
        let mut skin = resolve_skin(skin, custom, false)?;
        let ready = |role| self.role(role).is_some();
        let face_ready = match skin.face_sources {
            SkinFaceSources::None => true,
            SkinFaceSources::PairedSide(role) => ready(role),
            SkinFaceSources::SingleImage { base, pupil } => {
                ready(base.source) && ready(pupil.source)
            }
            SkinFaceSources::Mouth { eye_marks, mouth } => ready(eye_marks) && ready(mouth),
        };
        if !face_ready {
            skin.face = match skin.face {
                FaceGeometry::Paired(face) => FaceGeometry::Paired(PairedFaceGeometry {
                    decoration: None,
                    ..face
                }),
                _ => FaceGeometry::default(),
            };
            skin.face_sources = SkinFaceSources::None;
        }
        skin.antenna = skin.antenna.filter(|a| ready(a.source));
        Ok(skin)
    }
    pub fn appearance(&self, a: &Appearance, own: bool) -> Result<AccessoryPresentation> {
        let skin = self
            .skin(a.skin, &a.custom_skin)
            .map_err(|e| e.to_string())?;
        // Single-image eyes bypass the entire accessory branch in the stock painter.
        let accessory = if matches!(skin.face, FaceGeometry::SingleImage(_)) {
            None
        } else {
            self.selected_accessory(own).map(|(id, _)| {
                let v = ACCESSORIES[usize::from(id)];
                StaticHeadAccessoryGeometry {
                    forward: match skin.face {
                        FaceGeometry::Paired(face) => face.eyes.forward,
                        _ => StandardEyeGeometry::default().forward,
                    },
                    image_scale: v.1,
                    pivot_x: v.2,
                    pivot_y: v.3,
                }
            })
        };
        Ok(AccessoryPresentation {
            presentation: FacePresentation {
                face: skin.face,
                antenna: skin.antenna.map(|a| a.geometry),
            },
            accessory,
        })
    }
    pub fn resources(&self) -> impl Iterator<Item = &Resource> {
        self.roles.values().chain(self.accessories.values())
    }
}

fn canvas_image(image: RgbaImage, width: u32, height: u32, inset: u32, shadow: bool) -> RgbaImage {
    let mut pixels = vec![0; width as usize * height as usize * 4];
    for y in 0..image.height.min(height.saturating_sub(inset)) {
        for x in 0..image.width.min(width.saturating_sub(inset)) {
            let src = (y as usize * image.width as usize + x as usize) * 4;
            let dst = ((y + inset) as usize * width as usize + (x + inset) as usize) * 4;
            pixels[dst..dst + 4].copy_from_slice(&image.pixels[src..src + 4]);
        }
    }
    if shadow {
        let alpha = image::GrayImage::from_fn(width, height, |x, y| {
            image::Luma([pixels[(y as usize * width as usize + x as usize) * 4 + 3]])
        });
        let blurred = image::imageops::blur(&alpha, 10.);
        for (p, a) in pixels
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(blurred.into_raw())
        {
            p[3] = (u16::from(p[3]) + (u16::from(a) * (255 - u16::from(p[3])) + 127) / 255) as u8;
        }
    }
    RgbaImage {
        width,
        height,
        pixels,
    }
}

fn procedural(role: SkinSourceRole) -> Result<RgbaImage> {
    use SkinSourceRole::*;
    use slither_client::authored_sources::{CanvasRecipe, PaintCommand as P};
    let size = match role {
        SingleEyeBase | AcBulb => 64,
        SingleEyePupil | MouthEyeMarks => 48,
        CdBulb => 84,
        _ => return Err("Not a procedural cosmetic".into()),
    };
    if role == AcBulb {
        return crate::materials::materialize(&CanvasRecipe {
            width: size,
            height: size,
            half_width: 32.,
            half_height: 32.,
            commands: vec![
                P::RadialGradient {
                    circles: [32., 32., 1., 32., 32., 31.],
                    stops: vec![
                        (0., "rgba(255,128,128,1)".into()),
                        (0.5, "rgba(222,3,3,1)".into()),
                        (0.96, "rgba(157,18,18,1)".into()),
                        (1., "rgba(0,0,0,0)".into()),
                    ],
                },
                P::FillRect([0., 0., 64., 64.]),
            ],
        });
    }
    let mut pixels = vec![0; size as usize * size as usize * 4];
    for y in 0..size {
        for x in 0..size {
            let p = &mut pixels[((y * size + x) * 4) as usize..][..4];
            let half = f64::from(size) / 2.;
            let radius = (f64::from(x) - half).hypot(f64::from(y) - half);
            match role {
                SingleEyeBase => {
                    let v = ((half - radius).abs() / half * 1.06 - 0.06).max(0.);
                    let v = if v == 0. {
                        0.25
                    } else {
                        let v = v.powf(0.35) * 1.35;
                        v + (1. - v) * 0.25
                    };
                    // The retained source's alpha samples the following pixel position.
                    let nx = (x + 1) % size;
                    let ny = y + u32::from(x + 1 == size);
                    let coverage = ((half - (f64::from(nx) - half).hypot(f64::from(ny) - half))
                        / 3.)
                        .clamp(0., 1.);
                    let a = (coverage * 255.).round() as u8;
                    for (c, base) in p[..3].iter_mut().zip([72., 255., 116.]) {
                        *c = ((base * v).round().clamp(0., 255.) * f64::from(a) / 255.).round()
                            as u8;
                    }
                    p[3] = a;
                }
                SingleEyePupil => {
                    let v = ((1. - ((half - radius).abs() / half) / 0.5).max(0.)) * 0.8;
                    let a = ((half - radius + 0.5).clamp(0., 1.) * 255.).round() as u8;
                    for (c, (lo, hi)) in
                        p[..3]
                            .iter_mut()
                            .zip([(28., 87.), (83., 168.), (128., 238.)])
                    {
                        *c = if v == 0. {
                            0
                        } else {
                            ((lo + (hi - lo) * v).round() * f64::from(a) / 255.).round() as u8
                        };
                    }
                    p[3] = a;
                }
                MouthEyeMarks | CdBulb => {
                    let mut covered: f64 = 0.;
                    for sy in 0..4 {
                        for sx in 0..4 {
                            let px = f64::from(x) + (f64::from(sx) + 0.5) / 4.;
                            let py = f64::from(y) + (f64::from(sy) + 0.5) / 4.;
                            let inside = if role == CdBulb {
                                (13. ..71.).contains(&px)
                                    && (10. ..76.).contains(&py)
                                    && (px < 42. || py < 32. || py >= 54.)
                            } else {
                                let t = (py - 6.) / 36.;
                                let q = 2. * t * (1. - t);
                                (0. ..=1.).contains(&t)
                                    && px >= 30. * (1. - q)
                                    && px <= 36. - 22. * q
                            };
                            if inside {
                                covered += 1.;
                            }
                        }
                    }
                    p[3] = (covered / 16. * 255.).round() as u8;
                    if role == CdBulb {
                        p[0] = p[3];
                        p[1] = (f64::from(p[3]) * 86. / 255.).round() as u8;
                        p[2] = (f64::from(p[3]) * 9. / 255.).round() as u8;
                    }
                }
                _ => unreachable!(),
            }
        }
    }
    let image = RgbaImage {
        width: size,
        height: size,
        pixels,
    };
    if role == CdBulb {
        let first = canvas_image(image, size, size, 0, true);
        // The source is painted twice, each with the same shadow.
        let mut twice = first.clone();
        for (out, p) in twice
            .pixels
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(first.pixels.as_chunks::<4>().0.iter())
        {
            for i in 0..4 {
                out[i] = (u16::from(p[i]) + (u16::from(p[i]) * (255 - u16::from(p[3])) + 127) / 255)
                    as u8;
            }
        }
        Ok(twice)
    } else {
        Ok(image)
    }
}
