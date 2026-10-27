//! Read-only planning of ordered standard-body image draws.

use std::{error::Error, f64::consts::PI, fmt};

use crate::{math, state::Point};

use super::AntennaBarrierEffect;

/// Maximum active head-to-tail samples accepted by the painter.
pub const MAX_BODY_PAINT_SAMPLES: usize = super::MAX_CURVE_SAMPLES;
/// Maximum image commands, including overlapping fades and all effect passes.
pub const MAX_BODY_PAINT_COMMANDS: usize = 8 * MAX_BODY_PAINT_SAMPLES + 16;

/// Stored geometry and retained, effective flags; culled samples keep their ordinal.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyPaintSample {
    /// Original index in the uncompacted head-to-tail active sample prefix.
    pub ordinal: usize,
    /// Absolute horizontal position after the sampler's f32 store.
    pub x: f32,
    /// Absolute vertical position after the sampler's f32 store.
    pub y: f32,
    /// Stored tailward tangent, not recomputed from rounded positions.
    pub tangent: f32,
    /// Zero skips draws, one permits body/fades, two permits all effects.
    pub flag: u8,
}

/// A sampler snapshot. Only the active prefix is consumed or validated.
#[derive(Clone, Copy, Debug)]
pub struct BodyPaintGeometry<'a> {
    /// Head-to-tail storage, possibly followed by inactive cached records.
    pub samples: &'a [BodyPaintSample],
    /// Authoritative active prefix length, independently of cache length.
    pub active_count: usize,
    /// Actual f64 post-sampling scratch coordinates, not a rounded tail position.
    pub distance_cursor_seed: Point,
    /// Caller-resolved whole-snake visibility and standard-body eligibility.
    pub eligible: bool,
}

/// A rectangle in source pixels or local destination coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyRect {
    /// Horizontal origin.
    pub x: f64,
    /// Vertical origin.
    pub y: f64,
    /// Width; source widths are positive, destination widths may be signed.
    pub width: f64,
    /// Height; source heights are positive, destination heights may be signed.
    pub height: f64,
}

/// Caller-established readiness; this module never loads or inspects pixels.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodyAssetStatus {
    /// Source exists and its supplied dimensions are usable.
    Ready,
    /// Source is not ready; planning fails explicitly.
    Pending,
    /// Source cannot support the advertised recipe.
    Unsupported,
}

/// Opaque caller-owned source identity and coherent revision/dimension snapshot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BodyAsset {
    /// Caller token identifying the exact source object, including aliases.
    pub handle: u64,
    /// Caller token changed whenever the coherent source snapshot changes.
    pub revision: u64,
    /// Intrinsic/backing width, in 1 through 65535 pixels.
    pub width: u32,
    /// Intrinsic/backing height, in 1 through 65535 pixels.
    pub height: u32,
    /// Explicit readiness at this revision.
    pub status: BodyAssetStatus,
}

/// One whole-source or cropped use of a catalog source.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyAssetUse {
    /// Index into the input asset catalog; unrelated to palette or skin identity.
    pub asset: usize,
    /// None means whole-source drawImage semantics, not an inferred crop.
    pub source_rect: Option<BodyRect>,
}

/// Ordered shading images and an optional palette-specific boost source.
#[derive(Clone, Copy, Debug)]
pub struct BodyPalette<'a> {
    /// Ordered spatial variants; at most 256.
    pub variants: &'a [BodyAssetUse],
    /// Required for each drawn palette when the boost speed gate is open.
    pub boost_glow: Option<BodyAssetUse>,
}

/// One positive run in a repeating palette pattern.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BodyRun {
    /// Index into the recipe's palettes.
    pub palette: usize,
    /// Number of consecutive original ordinals using this palette.
    pub count: usize,
}

/// Spatial shading policy supplied by the resolved base palette family.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodyVariantMode {
    /// Always select variant zero.
    First,
    /// Repeat the declared period in forward order.
    Cycle,
    /// Both endpoints repeat: 0, 1, 2, 2, 1, 0 for period three.
    PingPong,
}

/// Immediate color overlay using variant zero of the selected palette.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyFade {
    /// Index into the recipe's palettes.
    pub palette: usize,
    /// Positive length in original sample ordinals; may be fractional.
    pub length: f64,
}

/// Explicit provider metadata; no skin dispatch or special-style defaults.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyStyle {
    /// Selects the longer boost phase divisor; effective flags remain untouched.
    pub detailed_segments: bool,
    /// Finite signed swell coefficient, without skin-specific inference.
    pub swell: f64,
    /// Whether body and fade images rotate by each stored tangent.
    pub rotate_segments: bool,
    /// Optional overlay on the original head prefix, for mixed-run recipes.
    pub head_fade: Option<BodyFade>,
    /// Optional overlay on the strict original tail suffix, for mixed runs.
    pub tail_fade: Option<BodyFade>,
}

/// Resolved recipe. The base family's mode/period applies to every run palette.
#[derive(Clone, Copy, Debug)]
pub struct BodyPaintRecipe<'a> {
    /// Base palette index; supplies the family policy even in mixed runs.
    pub base_palette: usize,
    /// Bounded resolved palette table, with no embedded skin recipes.
    pub palettes: &'a [BodyPalette<'a>],
    /// Empty means a single base palette; otherwise repeat these positive runs.
    pub runs: &'a [BodyRun],
    /// Base family's spatial policy, independent of the current run palette.
    pub variant_mode: BodyVariantMode,
    /// Base family's positive period, at most 256.
    pub variant_period: usize,
    /// Accepted custom data overrides spatial shading with variant zero.
    pub custom: bool,
    /// Required explicit style; absent metadata fails without a guessed default.
    pub style: Option<BodyStyle>,
    /// Shared outline source; required for this planner's advertised scope.
    pub outline: Option<BodyAssetUse>,
    /// Shared shadow source; required for this planner's advertised scope.
    pub shadow: Option<BodyAssetUse>,
    /// Shared death source; required for this planner's advertised scope.
    pub death: Option<BodyAssetUse>,
}

/// Frozen view coordinates. Center and world-to-view translations stay separate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyPaintView {
    /// Absolute camera position.
    pub camera: Point,
    /// Positive finite world-to-view scale.
    pub zoom: f64,
    /// Positive finite horizontal center of the backing canvas.
    pub half_width: f64,
    /// Positive finite vertical center of the backing canvas.
    pub half_height: f64,
}

/// Applied quality flag and independently interpolated quality blend.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyPaintQuality {
    /// Opens quality passes even when blend is zero.
    pub high_quality: bool,
    /// Finite value in zero through one.
    pub blend: f64,
}

/// Frozen dynamic state. The planner advances no clock, phase or quality state.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyPaintVisual {
    /// Positive finite snake scale.
    pub scale: f64,
    /// Spawn lifecycle progress, zero through one.
    pub spawn: f64,
    /// Death lifecycle progress, zero through one.
    pub death: f64,
    /// Independently gates death highlighting.
    pub dead: bool,
    /// Smoothed visual speed, not raw movement speed.
    pub smoothed_speed: f64,
    /// Boost passes require smoothed speed strictly greater than this value.
    pub boost_threshold: f64,
    /// Nonnegative cruise speed for boost interpolation.
    pub cruise_speed: f64,
    /// Finite maximum speed, strictly above cruise speed.
    pub maximum_speed: f64,
    /// Explicit finite animation phase; no clock is read or advanced.
    pub boost_phase: f64,
}

/// Complete borrowed inputs for one atomic standard-body planning operation.
#[derive(Clone, Copy, Debug)]
pub struct BodyPaintInput<'a> {
    /// Original stored samples, effective flags and actual sampler scratch seed.
    pub geometry: BodyPaintGeometry<'a>,
    /// Externally resolved metadata, without image ownership or host names.
    pub recipe: BodyPaintRecipe<'a>,
    /// Coherent bounded asset snapshot; at most 4096 entries. All recipe-referenced
    /// entries must be ready; unrelated catalog entries are not consumed.
    pub assets: &'a [BodyAsset],
    /// Camera and backing-canvas center.
    pub view: BodyPaintView,
    /// Frozen applied quality values.
    pub quality: BodyPaintQuality,
    /// Frozen lifecycle, size and speed values.
    pub visual: BodyPaintVisual,
    /// Valid Canvas alpha on entry, retained by ignored outer-boost assignments.
    pub entry_alpha: f64,
    /// Caller budget, at most MAX_BODY_PAINT_COMMANDS. Checked before allocation.
    pub command_limit: usize,
}

/// Painter stage; commands must retain their returned order across these stages.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodyPaintPass {
    /// First additive boost halo.
    OuterBoost,
    /// Quality-gated outline traversal.
    Outline,
    /// Shadow immediately following a near-head outline.
    NearHeadShadow,
    /// Repeated outline on the last four original ordinals.
    TailOutline,
    /// Shadow immediately following extra tail coverage.
    TailShadow,
    /// Shadow four ordinals ahead of the immediately following body image.
    BodyShadow,
    /// Spatially shaded base image.
    Body,
    /// Immediate head color overlay.
    HeadFade,
    /// Immediate tail color overlay, after any head overlay.
    TailFade,
    /// Quality-gated additive boost shimmer.
    InnerBoost,
    /// Additive death highlight after the antenna insertion barrier.
    Death,
}

/// Canvas compositing operation for an image command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodyBlend {
    /// Standard source-over composition.
    SourceOver,
    /// Additive lighter composition.
    Lighter,
}

/// Canvas globalAlpha assignment semantics, including ignored invalid requests.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyAlpha {
    /// Last relevant assignment; may be out of range or nonfinite.
    pub requested: f64,
    /// Stored Canvas value after accepting or ignoring that assignment.
    pub effective: f64,
    /// False means the previous value survived; no clamping is applied.
    pub accepted: bool,
}

impl BodyAlpha {
    fn assign(requested: f64, previous: f64) -> Self {
        let accepted = (0. ..=1.).contains(&requested);
        Self {
            requested,
            effective: if accepted { requested } else { previous },
            accepted,
        }
    }
}

/// Flattened image draw with exact f64 arguments; no matrix recomputation needed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BodyImageCommand {
    /// Zero-based image-call index in the complete plan.
    pub sequence: usize,
    /// Painter stage, retained for diagnostics rather than regrouping.
    pub pass: BodyPaintPass,
    /// Original active sample ordinal.
    pub ordinal: usize,
    /// Input catalog index, including when distinct entries alias one handle.
    pub asset_index: usize,
    /// Exact identity, revision, readiness and intrinsic dimensions snapshot.
    pub asset: BodyAsset,
    /// Preserved whole-source versus cropped draw semantics.
    pub source_rect: Option<BodyRect>,
    /// Apply translate(center), translate(translation), then optional rotate.
    pub center: Point,
    /// Local view translation, calculated directly in f64.
    pub translation: Point,
    /// Optional stored f32 tangent promoted to f64, applied after translations.
    pub rotation: Option<f64>,
    /// Local signed destination rectangle; independent of image aspect ratio.
    pub destination: BodyRect,
    /// Requested and effective alpha within the original save/restore scope.
    pub alpha: BodyAlpha,
    /// Effective composition mode for this draw.
    pub blend: BodyBlend,
}

/// Complete ordered output. No partial output escapes on failure.
#[derive(Clone, Debug, PartialEq)]
pub struct BodyPaintPlan {
    /// Ordered image draws, including zero-alpha commands.
    pub commands: Vec<BodyImageCommand>,
    /// Insertion index before death highlighting. Use the additive antenna planner
    /// to apply its scratch effect before calculating the death suffix.
    pub antenna_barrier: usize,
    /// Scratch cursor after all passes, including any supplied antenna effect.
    pub final_distance_cursor: Point,
}

/// Explicit unsupported, validation, resource and arithmetic failures.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BodyPaintError {
    /// Ineligible, fewer than two active samples, or coincident stored geometry.
    UnsupportedGeometry,
    /// Bad active prefix, ordinal, retained flag or nonfinite geometry.
    InvalidGeometry,
    /// Required explicit body-style metadata is absent.
    MissingStyle,
    /// Invalid bounded palette, run, variant, fade or style metadata.
    InvalidRecipe,
    /// A required asset use or catalog entry is absent.
    MissingAsset,
    /// A referenced source is pending or unsupported.
    AssetNotReady,
    /// Source dimensions or source-use rectangle are invalid.
    InvalidAsset,
    /// Camera, zoom or canvas center is invalid.
    InvalidView,
    /// Lifecycle, size, speed, phase, quality or entry alpha is invalid.
    InvalidVisual,
    /// The exact command count exceeds the caller or hard limit.
    CommandLimit,
    /// Reserving the complete command allocation failed.
    Allocation,
    /// Nonfinite geometry, dimensions or distance arithmetic was produced.
    Arithmetic,
}

impl fmt::Display for BodyPaintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "standard body paint input failed: {self:?}")
    }
}

impl Error for BodyPaintError {}

fn all_finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}

fn validate_use(input: &BodyPaintInput<'_>, usage: BodyAssetUse) -> Result<(), BodyPaintError> {
    let asset = input
        .assets
        .get(usage.asset)
        .ok_or(BodyPaintError::MissingAsset)?;
    if asset.status != BodyAssetStatus::Ready {
        return Err(BodyPaintError::AssetNotReady);
    }
    if asset.width == 0 || asset.height == 0 || asset.width > 65_535 || asset.height > 65_535 {
        return Err(BodyPaintError::InvalidAsset);
    }
    if let Some(r) = usage.source_rect
        && (!all_finite(&[r.x, r.y, r.width, r.height])
            || r.x < 0.
            || r.y < 0.
            || r.width <= 0.
            || r.height <= 0.
            || r.x + r.width > f64::from(asset.width)
            || r.y + r.height > f64::from(asset.height))
    {
        return Err(BodyPaintError::InvalidAsset);
    }
    Ok(())
}

fn validate(input: &BodyPaintInput<'_>) -> Result<BodyStyle, BodyPaintError> {
    use BodyPaintError::*;
    let g = input.geometry;
    if !g.eligible || g.active_count < 2 {
        return Err(UnsupportedGeometry);
    }
    if g.active_count > MAX_BODY_PAINT_SAMPLES
        || g.active_count > g.samples.len()
        || !all_finite(&[g.distance_cursor_seed.x, g.distance_cursor_seed.y])
    {
        return Err(InvalidGeometry);
    }
    let samples = &g.samples[..g.active_count];
    for (i, s) in samples.iter().enumerate() {
        if s.ordinal != i || s.flag > 2 || !all_finite(&[s.x.into(), s.y.into(), s.tangent.into()])
        {
            return Err(InvalidGeometry);
        }
    }
    if samples
        .iter()
        .all(|s| s.x == samples[0].x && s.y == samples[0].y)
    {
        return Err(UnsupportedGeometry);
    }
    let v = input.view;
    if !all_finite(&[v.camera.x, v.camera.y, v.zoom, v.half_width, v.half_height])
        || v.zoom <= 0.
        || v.half_width <= 0.
        || v.half_height <= 0.
    {
        return Err(InvalidView);
    }
    let v = input.visual;
    if !all_finite(&[
        v.scale,
        v.spawn,
        v.death,
        v.smoothed_speed,
        v.boost_threshold,
        v.cruise_speed,
        v.maximum_speed,
        v.boost_phase,
        input.quality.blend,
        input.entry_alpha,
    ]) || v.scale <= 0.
        || !(0. ..=1.).contains(&v.spawn)
        || !(0. ..=1.).contains(&v.death)
        || v.smoothed_speed < 0.
        || v.boost_threshold < 0.
        || v.cruise_speed < 0.
        || v.maximum_speed <= v.cruise_speed
        || !(0. ..=1.).contains(&input.quality.blend)
        || !(0. ..=1.).contains(&input.entry_alpha)
    {
        return Err(InvalidVisual);
    }
    let r = input.recipe;
    let style = r.style.ok_or(MissingStyle)?;
    if !style.swell.is_finite()
        || r.palettes.is_empty()
        || r.palettes.len() > 256
        || r.base_palette >= r.palettes.len()
        || r.runs.len() > 256
        || !(1..=256).contains(&r.variant_period)
        || input.assets.len() > 4096
        || input.assets.is_empty()
    {
        return Err(InvalidRecipe);
    }
    let mut run_count = 0usize;
    for run in r.runs {
        if run.palette >= r.palettes.len() || run.count == 0 || run.count > 65_535 {
            return Err(InvalidRecipe);
        }
        run_count += run.count;
    }
    if run_count > 65_535 {
        return Err(InvalidRecipe);
    }
    for fade in [style.head_fade, style.tail_fade].into_iter().flatten() {
        if r.runs.is_empty()
            || fade.palette >= r.palettes.len()
            || !fade.length.is_finite()
            || fade.length <= 0.
            || fade.length > 65_535.
        {
            return Err(InvalidRecipe);
        }
    }
    for (i, palette) in r.palettes.iter().enumerate() {
        if palette.variants.is_empty() || palette.variants.len() > 256 {
            return Err(InvalidRecipe);
        }
        let drawn = if r.runs.is_empty() {
            i == r.base_palette
        } else {
            r.runs.iter().any(|run| run.palette == i)
        };
        if (drawn || i == r.base_palette) && palette.variants.len() < r.variant_period {
            return Err(InvalidRecipe);
        }
        for usage in palette.variants {
            validate_use(input, *usage)?;
        }
        if let Some(glow) = palette.boost_glow {
            validate_use(input, glow)?;
        } else if drawn && v.smoothed_speed > v.boost_threshold {
            return Err(MissingAsset);
        }
    }
    for effect in [r.outline, r.shadow, r.death] {
        validate_use(input, effect.ok_or(MissingAsset)?)?;
    }
    Ok(style)
}

fn has_quality(input: &BodyPaintInput<'_>) -> bool {
    input.quality.high_quality || input.quality.blend > 0.
}

fn fade_progress(fade: BodyFade, i: usize, n: usize, head: bool) -> Option<f64> {
    let i = i as f64;
    let n = n as f64;
    if head && i < fade.length {
        Some(1. - i / fade.length)
    } else if !head && i > n - fade.length {
        Some(1. - (n - i) / fade.length)
    } else {
        None
    }
}

fn command_count(input: &BodyPaintInput<'_>, style: BodyStyle) -> Result<usize, BodyPaintError> {
    let n = input.geometry.active_count;
    let samples = &input.geometry.samples[..n];
    let quality = has_quality(input);
    let boost = input.visual.smoothed_speed > input.visual.boost_threshold;
    let mut count = 0;
    for (i, s) in samples.iter().enumerate() {
        if s.flag == 2 {
            count +=
                usize::from(boost) + usize::from(boost && quality) + usize::from(input.visual.dead);
            if quality {
                count += 1 + usize::from(i < 9) + 2 * usize::from(i >= n.saturating_sub(4));
            }
        }
        if s.flag >= 1 {
            count += 1 + usize::from(i >= 4 && samples[i - 4].flag == 2);
            count += [
                style.head_fade.map(|f| (f, true)),
                style.tail_fade.map(|f| (f, false)),
            ]
            .into_iter()
            .flatten()
            .filter(|(f, head)| fade_progress(*f, i, n, *head).is_some())
            .count();
        }
    }
    if input.command_limit > MAX_BODY_PAINT_COMMANDS || count > input.command_limit {
        return Err(BodyPaintError::CommandLimit);
    }
    Ok(count)
}

struct Painter<'a> {
    input: BodyPaintInput<'a>,
    style: BodyStyle,
    commands: Vec<BodyImageCommand>,
    cursor: Point,
}

impl Painter<'_> {
    fn sample(&self, i: usize) -> BodyPaintSample {
        self.input.geometry.samples[i]
    }

    fn move_cursor(&mut self, i: usize) {
        let s = self.sample(i);
        self.cursor = Point {
            x: s.x.into(),
            y: s.y.into(),
        };
    }

    fn visit(&mut self, i: usize) -> Result<f64, BodyPaintError> {
        let s = self.sample(i);
        let next = Point {
            x: s.x.into(),
            y: s.y.into(),
        };
        // Conditional subtraction preserves the original equal/signed-zero case.
        let mut d = if next.x > self.cursor.x {
            next.x - self.cursor.x
        } else {
            self.cursor.x - next.x
        };
        d += if next.y > self.cursor.y {
            next.y - self.cursor.y
        } else {
            self.cursor.y - next.y
        };
        d /= 6.;
        if !d.is_finite() {
            return Err(BodyPaintError::Arithmetic);
        }
        if d > 1. {
            d = 1.;
        }
        self.cursor = next;
        Ok(d)
    }

    fn swell(&self, i: usize, size: f64) -> f64 {
        if i < 4 {
            size * (1. + (4 - i) as f64 * self.style.swell)
        } else {
            size
        }
    }

    fn palette(&self, i: usize) -> usize {
        let r = self.input.recipe;
        if r.runs.is_empty() {
            return r.base_palette;
        }
        let total: usize = r.runs.iter().map(|run| run.count).sum();
        let mut offset = i % total;
        for run in r.runs {
            if offset < run.count {
                return run.palette;
            }
            offset -= run.count;
        }
        unreachable!("validated nonempty positive runs")
    }

    fn variant(&self, i: usize) -> usize {
        let r = self.input.recipe;
        if r.custom || r.variant_mode == BodyVariantMode::First {
            return 0;
        }
        match r.variant_mode {
            BodyVariantMode::First => 0,
            BodyVariantMode::Cycle => i % r.variant_period,
            BodyVariantMode::PingPong => {
                let v = i % (2 * r.variant_period);
                if v >= r.variant_period {
                    2 * r.variant_period - (v + 1)
                } else {
                    v
                }
            }
        }
    }

    fn glow(&self, i: usize) -> BodyAssetUse {
        self.input.recipe.palettes[self.palette(i)]
            .boost_glow
            .expect("validated boost asset")
    }

    fn draw(
        &mut self,
        i: usize,
        pass: BodyPaintPass,
        usage: BodyAssetUse,
        rect: BodyRect,
        alpha: BodyAlpha,
    ) -> Result<(), BodyPaintError> {
        let s = self.sample(i);
        let v = self.input.view;
        let translation = Point {
            x: (f64::from(s.x) - v.camera.x) * v.zoom,
            y: (f64::from(s.y) - v.camera.y) * v.zoom,
        };
        if !all_finite(&[
            translation.x,
            translation.y,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
        ]) {
            return Err(BodyPaintError::Arithmetic);
        }
        self.commands.push(BodyImageCommand {
            sequence: self.commands.len(),
            pass,
            ordinal: i,
            asset_index: usage.asset,
            asset: self.input.assets[usage.asset],
            source_rect: usage.source_rect,
            center: Point {
                x: v.half_width,
                y: v.half_height,
            },
            translation,
            rotation: (self.style.rotate_segments
                && matches!(
                    pass,
                    BodyPaintPass::Body | BodyPaintPass::HeadFade | BodyPaintPass::TailFade
                ))
            .then(|| f64::from(s.tangent)),
            destination: rect,
            alpha,
            blend: if matches!(
                pass,
                BodyPaintPass::OuterBoost | BodyPaintPass::InnerBoost | BodyPaintPass::Death
            ) {
                BodyBlend::Lighter
            } else {
                BodyBlend::SourceOver
            },
        });
        Ok(())
    }
}

fn square(half: f64) -> BodyRect {
    BodyRect {
        x: -half,
        y: -half,
        width: 2. * half,
        height: 2. * half,
    }
}

fn body_square(zoom: f64, size: f64) -> BodyRect {
    BodyRect {
        x: -zoom * size,
        y: -zoom * size,
        width: zoom * 2. * size,
        height: zoom * 2. * size,
    }
}

/// Plan one eligible nondegenerate standard body, atomically and without side effects.
/// Geometry, style, recipe readiness and the complete command budget validate before
/// allocation. Arithmetic failure drops the private partial plan. All image calls,
/// including zero-alpha calls, survive. Output assumes source-over at lane entry;
/// effective per-image state accounts for the painter's local save/restore scopes.
pub fn plan_standard_body(input: BodyPaintInput<'_>) -> Result<BodyPaintPlan, BodyPaintError> {
    plan_standard_body_with_antenna(input, AntennaBarrierEffect::Disabled)
}

/// Plan a standard body with the antenna's draw-time scratch effect inserted
/// before death commands. The caller submits the corresponding antenna commands
/// at the returned image barrier; disabled retains the legacy plan exactly.
pub fn plan_standard_body_with_antenna(
    input: BodyPaintInput<'_>,
    effect: AntennaBarrierEffect,
) -> Result<BodyPaintPlan, BodyPaintError> {
    use BodyPaintPass::*;
    match effect {
        AntennaBarrierEffect::Disabled => {}
        AntennaBarrierEffect::Rejected { cursor }
        | AntennaBarrierEffect::Eligible { cursor, .. } => {
            if !all_finite(&[cursor.x, cursor.y]) {
                return Err(BodyPaintError::InvalidGeometry);
            }
        }
    }
    if let AntennaBarrierEffect::Eligible { scoped_alpha, .. } = effect
        && !(0. ..=1.).contains(&scoped_alpha)
    {
        return Err(BodyPaintError::InvalidVisual);
    }
    let style = validate(&input)?;
    let count = command_count(&input, style)?;
    let mut commands = Vec::new();
    commands
        .try_reserve_exact(count)
        .map_err(|_| BodyPaintError::Allocation)?;
    let mut p = Painter {
        input,
        style,
        commands,
        cursor: input.geometry.distance_cursor_seed,
    };
    let n = input.geometry.active_count;
    let v = input.visual;
    let zoom = input.view.zoom;
    let line = (29. * v.scale) * 0.5;
    let mut opacity = v.spawn * (1. - v.death);
    opacity *= opacity;
    let boosted = v.smoothed_speed > v.boost_threshold;
    let boost = if boosted {
        v.spawn
            * (1. - v.death)
            * ((v.smoothed_speed - v.cruise_speed) / (v.maximum_speed - v.cruise_speed))
                .clamp(0., 1.)
    } else {
        0.
    };
    let divisor = if style.detailed_segments { 12. } else { 4. };
    let outer_alpha = BodyAlpha::assign(input.entry_alpha, input.entry_alpha);
    if boosted {
        let expansion = math::pow(boost, 0.5);
        let size = 1.5 * zoom * line * (1. + (62. / 32. - 1.) * expansion);
        for i in (0..n)
            .rev()
            .filter(|&i| input.geometry.samples[i].flag == 2)
        {
            let d = p.visit(i)?;
            let alpha = BodyAlpha::assign(
                d * opacity
                    * expansion
                    * 0.38
                    * (0.6 + 0.4 * math::cos(i as f64 / divisor - 1.15 * v.boost_phase)),
                outer_alpha.effective,
            );
            p.draw(i, OuterBoost, p.glow(i), square(p.swell(i, size)), alpha)?;
        }
    }
    let root_alpha = BodyAlpha::assign(opacity * (1. - boost), outer_alpha.effective);
    let outline_size = zoom * line * 52. / 32.;
    let shadow_size = zoom * line * 62. / 32.;
    let outline = input.recipe.outline.expect("validated effect");
    let shadow = input.recipe.shadow.expect("validated effect");
    if has_quality(&input) {
        let request = if input.quality.blend != 1. {
            root_alpha.requested * input.quality.blend
        } else {
            root_alpha.requested
        };
        let outline_alpha = BodyAlpha::assign(request, outer_alpha.effective);
        for i in (0..n)
            .rev()
            .filter(|&i| input.geometry.samples[i].flag == 2)
        {
            let d = p.visit(i)?;
            p.draw(i, Outline, outline, square(outline_size), outline_alpha)?;
            if i < 9 {
                let alpha =
                    BodyAlpha::assign(d * opacity * (1. - i as f64 / 9.), outline_alpha.effective);
                p.draw(
                    i,
                    NearHeadShadow,
                    shadow,
                    square(p.swell(i, shadow_size)),
                    alpha,
                )?;
            }
        }
        for i in (n.saturating_sub(4)..n)
            .rev()
            .filter(|&i| input.geometry.samples[i].flag == 2)
        {
            let d = p.visit(i)?;
            p.draw(i, TailOutline, outline, square(outline_size), outline_alpha)?;
            let alpha = BodyAlpha::assign(d * opacity * (i as f64 / 9.), outline_alpha.effective);
            p.draw(
                i,
                TailShadow,
                shadow,
                square(p.swell(i, shadow_size)),
                alpha,
            )?;
        }
    }
    for i in (0..n)
        .rev()
        .filter(|&i| input.geometry.samples[i].flag >= 1)
    {
        if i >= 4 && p.sample(i - 4).flag == 2 {
            let j = i - 4;
            let request = if j < 9 {
                p.move_cursor(j);
                opacity * (j as f64 / 9.)
            } else {
                opacity * p.visit(j)?
            };
            let alpha = BodyAlpha::assign(request, root_alpha.effective);
            p.draw(
                j,
                BodyShadow,
                shadow,
                square(p.swell(j, shadow_size)),
                alpha,
            )?;
        }
        let usage = input.recipe.palettes[p.palette(i)].variants[p.variant(i)];
        let mut alpha = BodyAlpha::assign(opacity, root_alpha.effective);
        p.draw(i, Body, usage, body_square(zoom, p.swell(i, line)), alpha)?;
        for (fade, pass, head) in [
            (style.head_fade, HeadFade, true),
            (style.tail_fade, TailFade, false),
        ] {
            if let Some(fade) = fade
                && let Some(progress) = fade_progress(fade, i, n, head)
            {
                alpha = BodyAlpha::assign(opacity * progress, alpha.effective);
                let size = (1. + 0.05 * progress) * line * (1. + (4. - i as f64) * style.swell);
                p.draw(
                    i,
                    pass,
                    input.recipe.palettes[fade.palette].variants[0],
                    body_square(zoom, size),
                    alpha,
                )?;
            }
        }
    }
    if boosted && has_quality(&input) {
        let glow_opacity = boost * 0.37;
        let size = line * 2.;
        for i in (0..n)
            .rev()
            .filter(|&i| input.geometry.samples[i].flag == 2)
        {
            let d = p.visit(i)?;
            let alpha = BodyAlpha::assign(
                d * opacity
                    * glow_opacity
                    * input.quality.blend
                    * (0.5 + 0.5 * math::cos(i as f64 / divisor - v.boost_phase)),
                root_alpha.effective,
            );
            p.draw(
                i,
                InnerBoost,
                p.glow(i),
                body_square(zoom, p.swell(i, size)),
                alpha,
            )?;
        }
    }
    let antenna_barrier = p.commands.len();
    let death_scope_alpha = match effect {
        AntennaBarrierEffect::Disabled => root_alpha.effective,
        AntennaBarrierEffect::Rejected { cursor } => {
            p.cursor = cursor;
            root_alpha.effective
        }
        AntennaBarrierEffect::Eligible {
            cursor,
            scoped_alpha,
        } => {
            p.cursor = cursor;
            scoped_alpha
        }
    };
    if v.dead {
        let envelope = (0.15 + 0.15 * math::sin(5. * PI * v.death).abs()) * math::sin(PI * v.death);
        let size = zoom * line;
        for i in (0..n)
            .rev()
            .filter(|&i| input.geometry.samples[i].flag == 2)
        {
            let d = p.visit(i)?;
            let alpha = BodyAlpha::assign(
                d * envelope * (0.6 + 0.4 * math::cos(i as f64 / 4. - 15. * v.death)),
                death_scope_alpha,
            );
            p.draw(
                i,
                Death,
                input.recipe.death.expect("validated effect"),
                square(p.swell(i, size)),
                alpha,
            )?;
        }
    }
    debug_assert_eq!(p.commands.len(), count);
    Ok(BodyPaintPlan {
        commands: p.commands,
        antenna_barrier,
        final_distance_cursor: p.cursor,
    })
}
