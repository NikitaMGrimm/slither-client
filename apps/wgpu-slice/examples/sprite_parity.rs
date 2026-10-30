//! Sprite parity score: rasterizes every authored body/food/prey recipe on the
//! CPU and compares it with a private capture of the original client's sprites.
//!
//! The capture pack lives outside the repository and is read only at runtime:
//! `cargo run --example sprite_parity -- <pack-dir>`, where `<pack-dir>` holds
//! `catalog.json` and the `r*.png` rasters. Nothing from the pack is written back.
#![forbid(unsafe_code)]
use serde_json::Value;
use slither_client::authored_sources::{CanvasRecipe, authored_source_recipes};
use slither_wgpu_slice::{Result, materials::materialize};
use std::path::{Path, PathBuf};

/// A sprite is treated as visually identical when its mean premultiplied
/// channel error is below 1/255 and no channel is off by more than 16/255.
const MEAN_LIMIT: f64 = 1.0;
const MAX_LIMIT: u8 = 16;

struct Pair<'a> {
    family: &'static str,
    label: String,
    ours: &'a CanvasRecipe,
    raster: String,
}

#[derive(Default)]
struct Family {
    total: usize,
    identical: usize,
    size_mismatch: usize,
    failed: usize,
    mean_sum: f64,
    compared: usize,
    worst: Option<(f64, String)>,
}

struct Image {
    width: u32,
    height: u32,
    /// Premultiplied RGBA8.
    rgba: Vec<u8>,
}

fn load_png(path: &Path) -> Result<Image> {
    let decoder = png::Decoder::new(std::io::BufReader::new(
        std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?,
    ));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("png size")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return Err(format!("{}: expected RGBA8", path.display()));
    }
    buf.truncate(info.buffer_size());
    // Canvas PNGs are unpremultiplied; compare in premultiplied space, which is
    // what actually gets composited.
    for px in buf.as_chunks_mut::<4>().0 {
        let a = u32::from(px[3]);
        for c in &mut px[..3] {
            *c = ((u32::from(*c) * a + 127) / 255) as u8;
        }
    }
    Ok(Image {
        width: info.width,
        height: info.height,
        rgba: buf,
    })
}

fn compare(ours: &Image, theirs: &Image) -> Option<(f64, u8)> {
    if ours.width != theirs.width || ours.height != theirs.height {
        return None;
    }
    let mut sum = 0u64;
    let mut max = 0u8;
    for (a, b) in ours.rgba.iter().zip(&theirs.rgba) {
        let d = a.abs_diff(*b);
        sum += u64::from(d);
        max = max.max(d);
    }
    Some((sum as f64 / ours.rgba.len() as f64, max))
}

fn add<'a>(
    pairs: &mut Vec<Pair<'a>>,
    unmatched: &mut Vec<String>,
    family: &'static str,
    label: String,
    ours: Option<&'a CanvasRecipe>,
    raster: &str,
) {
    match ours {
        Some(ours) => pairs.push(Pair {
            family,
            label,
            ours,
            raster: raster.to_owned(),
        }),
        None => unmatched.push(format!("{family} {label}")),
    }
}

/// Raster IDs in palette `p` under `key`. Entries stay positional, so a
/// malformed one is an error rather than silently shifting later sprites.
fn rasters<'a>(palette: &'a Value, p: usize, key: &str) -> Result<Vec<&'a str>> {
    let items = match palette.get(key) {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(id @ Value::String(_)) => vec![id],
        None => return Ok(Vec::new()),
        Some(_) => return Err(format!("catalog palette {p} {key}: invalid raster field")),
    };
    items
        .into_iter()
        .enumerate()
        .map(|(i, item)| {
            item.as_str()
                // Raster IDs are plain file stems inside the pack directory.
                .filter(|id| {
                    !id.is_empty()
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                })
                .ok_or_else(|| format!("catalog palette {p} {key}[{i}]: invalid raster id"))
        })
        .collect()
}

fn run() -> Result<()> {
    let pack = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("usage: sprite_parity <private-pack-dir>")?,
    );
    let catalog: Value = serde_json::from_slice(
        &std::fs::read(pack.join("catalog.json")).map_err(|e| format!("catalog.json: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    let palettes = catalog["palettes"].as_array().ok_or("catalog palettes")?;
    let recipes = authored_source_recipes();

    let mut pairs = Vec::new();
    let mut unmatched = Vec::new();
    let mut push = |family, label: String, ours, raster: &str| {
        add(&mut pairs, &mut unmatched, family, label, ours, raster)
    };
    for (p, palette) in palettes.iter().enumerate() {
        let body = recipes.body_sources.palettes.get(p);
        for (v, id) in rasters(palette, p, "kmcs")?.into_iter().enumerate() {
            push(
                "body segment",
                format!("palette {p} variant {v}"),
                body.and_then(|b| b.variants.get(v)),
                id,
            );
        }
        for id in rasters(palette, p, "kfmc")? {
            push(
                "boost glow",
                format!("palette {p}"),
                body.map(|b| &b.boost_glow),
                id,
            );
        }
        let food = recipes.food.get(p);
        for (family, key, pick) in [
            ("food body", "imgs", 0),
            ("food outline", "oimgs", 1),
            ("food glow", "gimgs", 2),
        ] {
            for (s, id) in rasters(palette, p, key)?.into_iter().enumerate() {
                let ours = food.and_then(|f| match pick {
                    0 => f.bodies.get(s),
                    1 => f.outlines.get(s),
                    _ => f.glows.get(s),
                });
                push(family, format!("palette {p} size {s}"), ours, id);
            }
        }
        for (s, id) in rasters(palette, p, "pr_imgs")?.into_iter().enumerate() {
            push(
                "prey body",
                format!("palette {p} size {s}"),
                recipes.prey.get(p).and_then(|f| f.bodies.get(s)),
                id,
            );
        }
    }

    if pairs.is_empty() {
        return Err("catalog lists no sprites to compare".into());
    }
    let mut families: Vec<(&'static str, Family)> = Vec::new();
    for pair in &pairs {
        let index = match families.iter().position(|(name, _)| *name == pair.family) {
            Some(i) => i,
            None => {
                families.push((pair.family, Family::default()));
                families.len() - 1
            }
        };
        let family = &mut families[index].1;
        family.total += 1;
        let theirs = load_png(&pack.join(format!("{}.png", pair.raster)))?;
        let ours = match materialize(pair.ours) {
            Ok(image) => Image {
                width: image.width,
                height: image.height,
                rgba: image.pixels,
            },
            Err(_) => {
                family.failed += 1;
                continue;
            }
        };
        match compare(&ours, &theirs) {
            None => family.size_mismatch += 1,
            Some((mean, max)) => {
                family.compared += 1;
                family.mean_sum += mean;
                if mean < MEAN_LIMIT && max <= MAX_LIMIT {
                    family.identical += 1;
                }
                if family.worst.as_ref().is_none_or(|(worst, _)| mean > *worst) {
                    family.worst = Some((mean, format!("{} (max {max})", pair.label)));
                }
            }
        }
    }

    println!(
        "{:<14} {:>6} {:>10} {:>9} {:>7} {:>10}  worst",
        "family", "total", "identical", "size-diff", "failed", "mean-err"
    );
    let (mut total, mut identical) = (0, 0);
    for (name, f) in &families {
        total += f.total;
        identical += f.identical;
        let mean = if f.compared > 0 {
            format!("{:.2}", f.mean_sum / f.compared as f64)
        } else {
            "-".into()
        };
        let worst = f
            .worst
            .as_ref()
            .map_or(String::new(), |(m, l)| format!("{m:.2} at {l}"));
        println!(
            "{name:<14} {:>6} {:>10} {:>9} {:>7} {mean:>10}  {worst}",
            f.total, f.identical, f.size_mismatch, f.failed
        );
    }
    println!(
        "\nsprite parity: {identical}/{total} visually identical (mean error < {MEAN_LIMIT}/255, max <= {MAX_LIMIT}/255)"
    );
    if !unmatched.is_empty() {
        println!(
            "{} captured sprites have no authored counterpart, e.g. {}",
            unmatched.len(),
            unmatched[0]
        );
    }
    Ok(())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
