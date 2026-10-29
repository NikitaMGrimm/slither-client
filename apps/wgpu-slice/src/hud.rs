//! Shared, bounded corner HUD. Original bitmap glyphs, no host objects or text framework.
use crate::{Result, frame::MAX_EXTENT, materials::RgbaImage, scene::Resource};
use slither_client::presentation::{BodyAsset, BodyAssetStatus, BodyRect, LeaderboardRow};

/// Copied existing Rust projections. Row order, identity, own flag and score text are retained.
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub status: String,
    pub score: String,
    pub final_score: String,
    pub rank: String,
    pub population: String,
    pub rows: Vec<LeaderboardRow>,
    pub message: Option<String>,
}
impl View {
    /// Keep the platform's existing compact text readout; the GPU uses the full typed view.
    pub fn compact_text(&self) -> String {
        let top = self
            .rows
            .first()
            .map(|r| format!("{} {}", r.name_text, r.score_text))
            .unwrap_or_else(|| "--".into());
        format!(
            "{} | ENTER PLAY / ESC STOP\nLENGTH {}  RANK {} / {}\nFINAL {}  TOP {}\n{}",
            self.status,
            self.score,
            self.rank,
            self.population,
            self.final_score,
            top,
            self.message
                .as_deref()
                .unwrap_or("LOCAL AUTHORED BODY/PAIRED EYES; ARROWS/POINTER/SPACE")
        )
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Score,
    Leaderboard,
    Text,
}
#[derive(Clone, Debug, PartialEq)]
pub enum Line {
    Current(String),
    Status(String),
    Rank { rank: String, population: String },
    Final(String),
    Message(String),
    Heading,
    Row(LeaderboardRow),
}
#[derive(Clone, Debug, PartialEq)]
pub struct Panel {
    pub role: Role,
    pub origin: [u32; 2],
    pub size: [u32; 2],
    pub destination: BodyRect,
    pub lines: Vec<Line>,
}
impl Panel {
    pub fn source(&self) -> BodyRect {
        BodyRect {
            x: f64::from(self.origin[0]),
            y: f64::from(self.origin[1]),
            width: f64::from(self.size[0]),
            height: f64::from(self.size[1]),
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub extent: [u32; 2],
    pub glyph_scale: u32,
    pub panels: Vec<Panel>,
}
const PAD: u32 = 4;
pub const SCORE_CELLS: u32 = 17; // Full signed safe-integer decimal contract, including minus.
fn viewport(extent: [u32; 2], scale: f64) -> Result<[u32; 2]> {
    if extent.iter().any(|v| *v > MAX_EXTENT) || !scale.is_finite() || scale <= 0. {
        return Err("Invalid HUD viewport".into());
    }
    let logical = extent.map(|v| (f64::from(v) / scale).floor());
    if logical
        .iter()
        .any(|v| !v.is_finite() || *v > f64::from(MAX_EXTENT))
    {
        return Err("HUD logical extent budget".into());
    }
    Ok(logical.map(|v| v as u32))
}
fn corner_plan(lines: Vec<Line>, extent: [u32; 2], scale: f64) -> Result<Plan> {
    let [w, h] = viewport(extent, scale)?;
    let s = if w >= 260 && h >= 200 { 2 } else { 1 };
    let mut p = Plan {
        extent: [0, 0],
        glyph_scale: s,
        panels: Vec::new(),
    };
    if w < 48 || h < 40 {
        return Ok(p);
    }
    let margin = if w >= 260 && h >= 200 { 8 } else { 4 };
    let columns = ((w - 2 * margin - 2 * PAD) / (6 * s)).min(24);
    let count = ((h * 2 / 5).saturating_sub(2 * PAD) / (9 * s)).min(lines.len() as u32);
    if columns == 0 || count == 0 {
        return Ok(p);
    }
    let size = [columns * 6 * s + 2 * PAD, count * 9 * s + 2 * PAD];
    p.panels.push(Panel {
        role: Role::Score,
        origin: [0, 0],
        size,
        destination: BodyRect {
            x: f64::from(margin),
            y: f64::from(h - margin - size[1]),
            width: f64::from(size[0]),
            height: f64::from(size[1]),
        },
        lines: lines.into_iter().take(count as usize).collect(),
    });
    p.extent = size;
    Ok(p)
}
pub fn plan(view: &View, extent: [u32; 2], scale: f64) -> Result<Plan> {
    let mut lines = vec![
        Line::Current(view.score.clone()),
        Line::Status(view.status.clone()),
        Line::Rank {
            rank: view.rank.clone(),
            population: view.population.clone(),
        },
        Line::Final(view.final_score.clone()),
    ];
    if let Some(message) = &view.message {
        lines.push(Line::Message(message.clone()));
    }
    let mut p = corner_plan(lines, extent, scale)?;
    if p.panels.is_empty() || view.rows.is_empty() {
        return Ok(p);
    }
    let [w, h] = viewport(extent, scale)?;
    let s = p.glyph_scale;
    if w < 600 {
        return Ok(p);
    }
    let columns = ((w / 2).clamp(332, 452).saturating_sub(2 * PAD) / (6 * s)).min(38);
    let count = ((h * 9 / 20)
        .min(h.saturating_sub(32) / 2)
        .saturating_sub(2 * PAD)
        / (9 * s))
        .saturating_sub(1)
        .min(10)
        .min(view.rows.len() as u32);
    if columns < 27 || count == 0 {
        return Ok(p);
    }
    let size = [columns * 6 * s + 2 * PAD, (count + 1) * 9 * s + 2 * PAD];
    let y = p.extent[1] + 2;
    let mut lines = vec![Line::Heading];
    lines.extend(
        view.rows
            .iter()
            .take(count as usize)
            .cloned()
            .map(Line::Row),
    );
    p.panels.push(Panel {
        role: Role::Leaderboard,
        origin: [0, y],
        size,
        destination: BodyRect {
            x: f64::from(w - 8 - size[0]),
            y: 8.,
            width: f64::from(size[0]),
            height: f64::from(size[1]),
        },
        lines,
    });
    p.extent = [p.extent[0].max(size[0]), y + size[1]];
    Ok(p)
}
pub fn plan_text(text: &str, extent: [u32; 2], scale: f64) -> Result<Plan> {
    let mut p = corner_plan(
        text.lines()
            .take(4)
            .map(|s| Line::Message(s.into()))
            .collect(),
        extent,
        scale,
    )?;
    if let Some(panel) = p.panels.first_mut() {
        panel.role = Role::Text;
    }
    Ok(p)
}
pub fn resource() -> Resource {
    Resource {
        asset: BodyAsset {
            handle: 0x3000_0000_0000_0000,
            revision: 0,
            width: 1,
            height: 1,
            status: BodyAssetStatus::Ready,
        },
        image: RgbaImage {
            width: 1,
            height: 1,
            pixels: vec![0; 4],
        },
    }
}
fn glyph(c: char) -> [u8; 7] {
    match c.to_ascii_uppercase() {
        'A' => [14, 17, 17, 31, 17, 17, 17],
        'B' => [30, 17, 17, 30, 17, 17, 30],
        'C' => [14, 17, 16, 16, 16, 17, 14],
        'D' => [30, 17, 17, 17, 17, 17, 30],
        'E' => [31, 16, 16, 30, 16, 16, 31],
        'F' => [31, 16, 16, 30, 16, 16, 16],
        'G' => [14, 17, 16, 23, 17, 17, 14],
        'H' => [17, 17, 17, 31, 17, 17, 17],
        'I' => [14, 4, 4, 4, 4, 4, 14],
        'J' => [7, 2, 2, 2, 18, 18, 12],
        'K' => [17, 18, 20, 24, 20, 18, 17],
        'L' => [16, 16, 16, 16, 16, 16, 31],
        'M' => [17, 27, 21, 21, 17, 17, 17],
        'N' => [17, 25, 25, 21, 19, 19, 17],
        'O' => [14, 17, 17, 17, 17, 17, 14],
        'P' => [30, 17, 17, 30, 16, 16, 16],
        'Q' => [14, 17, 17, 17, 21, 18, 13],
        'R' => [30, 17, 17, 30, 20, 18, 17],
        'S' => [15, 16, 16, 14, 1, 1, 30],
        'T' => [31, 4, 4, 4, 4, 4, 4],
        'U' => [17, 17, 17, 17, 17, 17, 14],
        'V' => [17, 17, 17, 17, 17, 10, 4],
        'W' => [17, 17, 17, 21, 21, 21, 10],
        'X' => [17, 17, 10, 4, 10, 17, 17],
        'Y' => [17, 17, 10, 4, 4, 4, 4],
        'Z' => [31, 1, 2, 4, 8, 16, 31],
        '0' => [14, 17, 19, 21, 25, 17, 14],
        '1' => [4, 12, 4, 4, 4, 4, 14],
        '2' => [14, 17, 1, 2, 4, 8, 31],
        '3' => [30, 1, 1, 14, 1, 1, 30],
        '4' => [2, 6, 10, 18, 31, 2, 2],
        '5' => [31, 16, 16, 30, 1, 1, 30],
        '6' => [14, 16, 16, 30, 17, 17, 14],
        '7' => [31, 1, 2, 4, 8, 8, 8],
        '8' => [14, 17, 17, 14, 17, 17, 14],
        '9' => [14, 17, 17, 15, 1, 1, 14],
        // Core row text uses NBSP to preserve ordinary name spaces.
        ' ' | '\u{a0}' => [0; 7],
        '-' => [0, 0, 0, 31, 0, 0, 0],
        '/' => [1, 2, 2, 4, 8, 8, 16],
        '|' => [4; 7],
        '.' => [0, 0, 0, 0, 0, 6, 6],
        ':' => [0, 6, 6, 0, 6, 6, 0],
        '#' => [10, 31, 10, 10, 31, 10, 0],
        '>' => [16, 8, 4, 2, 4, 8, 16],
        _ => [31, 17, 1, 2, 4, 0, 4],
    }
}
struct Painter {
    width: u32,
    pixels: Vec<u8>,
    scale: u32,
}
impl Painter {
    fn number(&mut self, text: &str, at: [u32; 2], cells: u32, color: [u8; 4]) {
        // Never present a clipped decimal suffix as a different number on a tiny viewport.
        let visible = if text.chars().take(cells as usize + 1).count() > cells as usize {
            "..."
        } else {
            text
        };
        self.text(visible, at, cells, true, color);
    }
    fn rect(&mut self, x: u32, y: u32, w: u32, h: u32, color: [u8; 4]) {
        for row in y..y + h {
            for col in x..x + w {
                let i = ((row * self.width + col) * 4) as usize;
                self.pixels[i..i + 4].copy_from_slice(&color);
            }
        }
    }
    fn text(&mut self, text: &str, at: [u32; 2], cells: u32, right: bool, color: [u8; 4]) {
        // Clip scalar glyphs within this column, retaining the original projected string in Plan.
        let chars: Vec<_> = if right {
            text.chars()
                .rev()
                .take(cells as usize)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        } else {
            text.chars().take(cells as usize).collect()
        };
        let offset = if right { cells - chars.len() as u32 } else { 0 };
        for (x, c) in chars.into_iter().enumerate() {
            for (dy, bits) in glyph(c).into_iter().enumerate() {
                for dx in 0..5 {
                    if bits & (1 << (4 - dx)) != 0 {
                        self.rect(
                            at[0] + (offset + x as u32) * 6 * self.scale + dx * self.scale,
                            at[1] + dy as u32 * self.scale,
                            self.scale,
                            self.scale,
                            color,
                        );
                    }
                }
            }
        }
    }
}
/// Preflight and paint one immutable atlas; dimensions/content revisions change together.
pub fn rasterize(plan: &Plan, target: &mut Resource) -> Result<()> {
    if plan.panels.is_empty() {
        return Ok(());
    }
    if plan.panels.len() > 2
        || plan.extent.contains(&0)
        || plan.extent.iter().any(|v| *v > 512)
        || !(1..=2).contains(&plan.glyph_scale)
    {
        return Err("HUD atlas budget".into());
    }
    for p in &plan.panels {
        if p.size.iter().any(|v| *v < 2 * PAD)
            || p.origin
                .iter()
                .zip(p.size)
                .zip(plan.extent)
                .any(|((&o, n), limit)| o.checked_add(n).is_none_or(|v| v > limit))
            || p.lines.len() as u32 * 9 * plan.glyph_scale + 2 * PAD > p.size[1]
        {
            return Err("Invalid HUD panel".into());
        }
        let cols = (p.size[0] - 2 * PAD) / (6 * plan.glyph_scale);
        if cols < 2
            || p.lines
                .iter()
                .any(|l| matches!(l, Line::Heading | Line::Row(_)))
                && cols < 27
        {
            return Err("Invalid HUD columns".into());
        }
    }
    let mut paint = Painter {
        width: plan.extent[0],
        pixels: vec![0; (plan.extent[0] * plan.extent[1] * 4) as usize],
        scale: plan.glyph_scale,
    };
    for p in &plan.panels {
        paint.rect(
            p.origin[0],
            p.origin[1],
            p.size[0],
            p.size[1],
            [9, 12, 17, 220],
        );
        let cols = (p.size[0] - 2 * PAD) / (6 * plan.glyph_scale);
        for (i, line) in p.lines.iter().enumerate() {
            let at = [
                p.origin[0] + PAD,
                p.origin[1] + PAD + i as u32 * 9 * plan.glyph_scale,
            ];
            let normal = [210, 218, 226, 255];
            let white = [248, 248, 248, 255];
            match line {
                Line::Current(value) | Line::Final(value) => {
                    let current = matches!(line, Line::Current(_));
                    let label_cols = if cols >= 24 { 7 } else { 2 };
                    let label = match (current, label_cols) {
                        (true, 7) => "LENGTH ",
                        (false, 7) => "FINAL  ",
                        (true, _) => "L ",
                        _ => "F ",
                    };
                    paint.text(label, at, label_cols, false, normal);
                    paint.number(
                        value,
                        [at[0] + label_cols * 6 * plan.glyph_scale, at[1]],
                        cols.saturating_sub(label_cols),
                        white,
                    );
                }
                Line::Status(s) | Line::Message(s) => paint.text(s, at, cols, false, normal),
                Line::Rank { rank, population } => {
                    if cols >= 15 {
                        paint.text("RANK ", at, 5, false, normal);
                        paint.number(rank, [at[0] + 5 * 6 * plan.glyph_scale, at[1]], 5, white);
                        paint.text(
                            " / ",
                            [at[0] + 10 * 6 * plan.glyph_scale, at[1]],
                            3,
                            false,
                            normal,
                        );
                        paint.number(
                            population,
                            [at[0] + 13 * 6 * plan.glyph_scale, at[1]],
                            cols - 13,
                            white,
                        );
                    } else {
                        let left = (cols - 1) / 2;
                        paint.number(rank, at, left, white);
                        paint.text(
                            "/",
                            [at[0] + left * 6 * plan.glyph_scale, at[1]],
                            1,
                            false,
                            normal,
                        );
                        paint.number(
                            population,
                            [at[0] + (left + 1) * 6 * plan.glyph_scale, at[1]],
                            cols - left - 1,
                            white,
                        );
                    }
                }
                Line::Heading => {
                    paint.text("LEADERS", at, cols - 18, false, white);
                    paint.text(
                        "LENGTH",
                        [at[0] + (cols - SCORE_CELLS) * 6 * plan.glyph_scale, at[1]],
                        SCORE_CELLS,
                        true,
                        normal,
                    );
                }
                Line::Row(row) => {
                    if row.own {
                        paint.rect(
                            p.origin[0] + 1,
                            at[1] - 1,
                            p.size[0] - 2,
                            9 * plan.glyph_scale,
                            [28, 40, 50, 235],
                        );
                        paint.text(">", at, 1, false, white);
                    }
                    let color = if row.own { white } else { normal };
                    paint.text(
                        &row.number_text,
                        [at[0] + 6 * plan.glyph_scale, at[1]],
                        3,
                        true,
                        color,
                    );
                    paint.text(
                        &row.name_text,
                        [at[0] + 5 * 6 * plan.glyph_scale, at[1]],
                        cols - 23,
                        false,
                        color,
                    );
                    paint.number(
                        &row.score_text,
                        [at[0] + (cols - SCORE_CELLS) * 6 * plan.glyph_scale, at[1]],
                        SCORE_CELLS,
                        color,
                    );
                }
            }
        }
    }
    if target.image.width != plan.extent[0]
        || target.image.height != plan.extent[1]
        || target.image.pixels != paint.pixels
    {
        let revision = target
            .asset
            .revision
            .checked_add(1)
            .ok_or("HUD revision exhausted")?;
        target.asset = BodyAsset {
            revision,
            width: plan.extent[0],
            height: plan.extent[1],
            ..target.asset
        };
        target.image = RgbaImage {
            width: plan.extent[0],
            height: plan.extent[1],
            pixels: paint.pixels,
        };
    }
    Ok(())
}
/// Legacy text-only caller; ordinary gameplay uses the full typed view and actual extent.
pub fn bitmap(text: &str, target: &mut Resource) -> Result<()> {
    rasterize(&plan_text(text, [480, 200], 1.)?, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn narrow_numeric_field_signals_overflow_instead_of_changing_the_value() {
        let make = || Painter {
            width: 18,
            pixels: vec![0; 18 * 9 * 4],
            scale: 1,
        };
        let color = [248, 248, 248, 255];
        let mut actual = make();
        actual.number("123456", [0, 0], 3, color);
        let mut dots = make();
        dots.text("...", [0, 0], 3, true, color);
        assert_eq!(actual.pixels, dots.pixels);
        let mut fits = make();
        fits.number("123", [0, 0], 3, color);
        let mut text = make();
        text.text("123", [0, 0], 3, true, color);
        assert_eq!(fits.pixels, text.pixels);
        assert_ne!(fits.pixels, dots.pixels);
    }
}
