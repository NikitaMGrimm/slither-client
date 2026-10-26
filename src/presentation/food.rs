//! Owned desktop food instances and fractional animation, without packet or asset loading.

use std::{error::Error, f64::consts::PI, fmt, num::NonZeroU64};

use crate::{math, state::Point};

use super::{BodyAsset, BodyAssetStatus, FrameStep};

/// Retained objects, including duplicate keys and consumed foods in flight.
pub const MAX_RETAINED_FOODS: usize = 65_536;

/// Stable parent-owned snake appearance identity, independent of wire IDs and indices.
/// The parent must not reuse a token while any retained food references it.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct SnakeObjectToken(NonZeroU64);

impl SnakeObjectToken {
    /// Check a nonzero object serial. Allocation and lifetime belong to the parent.
    pub fn new(serial: u64) -> Result<Self, FoodError> {
        NonZeroU64::new(serial)
            .map(Self)
            .ok_or(FoodError::InvalidToken)
    }

    /// Exact serial; JavaScript diagnostics must preserve its integer precision.
    pub fn serial(self) -> u64 {
        self.0.get()
    }
}

/// Monotonically allocated food identity, unrelated to the potentially duplicate key.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct FoodInstance(u64);

impl FoodInstance {
    /// Exact nonzero serial, never reset or reused by a world.
    pub fn serial(self) -> u64 {
        self.0
    }
}

/// A source's frozen identity and declared numeric destination/crop metadata.
///
/// Intrinsic dimensions and readiness use the existing asset type. Declared sizes
/// and halves remain independent f64 values: a provider must not round odd sizes
/// or substitute intrinsic dimensions for retained metadata. This value does not
/// own raster pixels; the parent retains the corresponding source object.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodSource {
    asset: BodyAsset,
    width: f64,
    height: f64,
    half_width: f64,
    half_height: f64,
}

impl FoodSource {
    /// Validate ready intrinsic dimensions and positive finite declared dimensions.
    /// Halves are explicit nonnegative finite metadata, not recomputed here.
    pub fn new(
        asset: BodyAsset,
        width: f64,
        height: f64,
        half_width: f64,
        half_height: f64,
    ) -> Result<Self, FoodError> {
        let source = Self {
            asset,
            width,
            height,
            half_width,
            half_height,
        };
        source.validate()?;
        Ok(source)
    }

    pub(crate) fn validate(self) -> Result<(), FoodError> {
        if self.asset.status != BodyAssetStatus::Ready {
            return Err(FoodError::SourceNotReady);
        }
        if self.asset.width == 0
            || self.asset.height == 0
            || self.asset.width > 65_535
            || self.asset.height > 65_535
            || !all_finite(&[self.width, self.height, self.half_width, self.half_height])
            || self.width <= 0.
            || self.height <= 0.
            || self.half_width < 0.
            || self.half_height < 0.
        {
            return Err(FoodError::InvalidSource);
        }
        Ok(())
    }

    /// Frozen exact source object identity, revision and intrinsic dimensions.
    pub fn asset(self) -> BodyAsset {
        self.asset
    }
    /// Declared full horizontal size, used by nine-argument draws.
    pub fn width(self) -> f64 {
        self.width
    }
    /// Declared full vertical size, used by nine-argument draws.
    pub fn height(self) -> f64 {
        self.height
    }
    /// Retained horizontal half size, including any fractional component.
    pub fn half_width(self) -> f64 {
        self.half_width
    }
    /// Retained vertical half size, including any fractional component.
    pub fn half_height(self) -> f64 {
        self.half_height
    }
}

/// One trusted effective palette, supplied at creation without stock recipes.
#[derive(Clone, Copy, Debug)]
pub struct FoodPalette<'a> {
    /// Effective palette number, zero through nine; checked against raw color.
    pub palette: u8,
    /// Nonzero, exactly f64-representable family count; every family contains this prefix.
    pub image_count: usize,
    /// Body sources, selected with the body index.
    pub bodies: &'a [FoodSource],
    /// Outline sources, selected with the same body index.
    pub outlines: &'a [FoodSource],
    /// Single glow family used for both independently selected glow indices.
    pub glows: &'a [FoodSource],
}

/// Independent numeric creation input; the parent converts its decoded event.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodSpawn {
    /// Packed sector/offset bit pattern; duplicate keys are retained.
    pub key: u32,
    /// Original sector, retained through flight and later configuration changes.
    pub sector: (u8, u8),
    /// Absolute decoded position, with the decoder's arithmetic already applied.
    pub position: Point,
    /// Decoded size, including zero. No quantization is introduced here.
    pub base_size: f64,
    /// Unnormalized stream color; only values greater than nine use modulo nine.
    pub raw_color: u8,
    /// Rapid creation uses spawn speed three; ordinary creation uses one.
    pub rapid: bool,
}

/// Exogenous factory inputs; no ID-derived or global random generator is used.
#[derive(Clone, Copy, Debug)]
pub struct FoodFactoryInput<'a> {
    /// First independent finite random unit in [0,1).
    pub random_phase_unit: f64,
    /// Second independent finite random unit in [0,1).
    pub random_wobble_unit: f64,
    /// Positive finite zoom at this creation event, frozen for source selection.
    pub creation_zoom: f64,
    /// Trusted family count and source metadata for the effective palette.
    pub palette: FoodPalette<'a>,
}

/// Frozen creation-time selections, including both uses of the same glow family.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodSources {
    /// Body/outline, inner glow, and outer glow indices, respectively.
    pub indices: [usize; 3],
    /// Selected body image.
    pub body: FoodSource,
    /// Selected outline image.
    pub outline: FoodSource,
    /// Selected inner glow image.
    pub inner: FoodSource,
    /// Selected outer glow image.
    pub outer: FoodSource,
}

/// Copied diagnostics; changing this snapshot cannot inject animation state.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodSnapshot {
    /// Unique retained food object identity.
    pub instance: FoodInstance,
    /// Potentially duplicate packed food key.
    pub key: u32,
    /// Creation sector, used by sector deletion even during flight.
    pub sector: (u8, u8),
    /// Original absolute position, unchanged during animation.
    pub position: Point,
    /// Unnormalized creation color.
    pub raw_color: u8,
    /// Effective zero-through-nine palette.
    pub effective_palette: u8,
    /// Original decoded size.
    pub base_size: f64,
    /// One or three, independent of animation rate.
    pub spawn_speed: f64,
    /// Current absolute render position.
    pub render_position: Point,
    /// Spawn fade; frozen during consumption.
    pub fade: f64,
    /// Current destination scale, including initial tiny scale and zero.
    pub scale: f64,
    /// Last uneaten scale; repeated consumption does not replace it.
    pub uneaten_scale: f64,
    /// Double-precision animation phase.
    pub animation_phase: f64,
    /// Size-derived phase speed.
    pub animation_rate: f64,
    /// Independent signed wobble speed.
    pub wobble_rate: f64,
    /// Whether a consume captured an eater request, possibly missing its object.
    pub eaten: bool,
    /// Fractional flight progress.
    pub consumption_progress: f64,
    /// Captured appearance token; missing-at-capture stays missing.
    pub eater: Option<SnakeObjectToken>,
    /// Zoom frozen at creation, not used to rescale destination dimensions.
    pub creation_zoom: f64,
    /// Frozen source selections and numeric metadata.
    pub sources: FoodSources,
}

/// One owned instance. All transitions occur through its FoodWorld.
#[derive(Clone, Debug, PartialEq)]
pub struct FoodPresentation {
    state: FoodSnapshot,
}

impl FoodPresentation {
    /// Copy all numeric state, identities and retained source metadata.
    pub fn snapshot(&self) -> FoodSnapshot {
        self.state
    }
}

/// Consumption distinguishes immediate deletion from a missing captured eater.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoodConsume {
    /// No eater was requested; delete the newest match immediately.
    Immediate,
    /// Retain the newest match as eaten; None expires on the next update.
    Eaten(Option<SnakeObjectToken>),
}

/// Raw parent-owned eater channels after that update's snake advancement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodEaterPose {
    /// Raw absolute head position, before correction offsets.
    pub head: Point,
    /// Stored head correction offsets, added independently on each axis.
    pub head_offset: Point,
    /// Raw head heading, without eye or curve substitution.
    pub heading: f64,
    /// Stored angular correction, added before sine/cosine.
    pub angle_offset: f64,
}

/// Invalid input, retained-resource exhaustion or nonfinite arithmetic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoodError {
    /// A snake object token must be nonzero.
    InvalidToken,
    /// Position, size, zoom, random units or delta is outside its finite domain.
    InvalidInput,
    /// Palette number, count or family prefix is inconsistent.
    InvalidPalette,
    /// A selected source's numeric metadata is invalid.
    InvalidSource,
    /// A selected source is not ready.
    SourceNotReady,
    /// Retained food count would exceed MAX_RETAINED_FOODS.
    Capacity,
    /// Monotonic food identity cannot be incremented without wrapping.
    SerialExhausted,
    /// Reserving bounded instance storage failed.
    Allocation,
    /// A captured object was lost; parents must retain referenced detached eaters.
    MissingEater(SnakeObjectToken),
    /// Nonfinite arithmetic or invalid resolved eater pose.
    Arithmetic,
}

impl fmt::Display for FoodError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "food presentation failed: {self:?}")
    }
}
impl Error for FoodError {}

pub(crate) fn all_finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}

/// Normalize only values strictly greater than nine, retaining palette nine.
pub fn food_palette(raw_color: u8) -> u8 {
    if raw_color > 9 {
        raw_color % 9
    } else {
        raw_color
    }
}

fn select_index(value: f64, count: usize) -> Result<usize, FoodError> {
    if !value.is_finite() {
        return Err(FoodError::Arithmetic);
    }
    let index = value.floor();
    Ok(if index < 0. {
        0
    } else if index >= count as f64 {
        count - 1
    } else {
        index as usize
    })
}

fn create(
    instance: FoodInstance,
    spawn: FoodSpawn,
    input: FoodFactoryInput<'_>,
) -> Result<FoodPresentation, FoodError> {
    if !all_finite(&[
        spawn.position.x,
        spawn.position.y,
        spawn.base_size,
        input.creation_zoom,
    ]) || spawn.base_size < 0.
        || input.creation_zoom <= 0.
        || !(0. ..1.).contains(&input.random_phase_unit)
        || !(0. ..1.).contains(&input.random_wobble_unit)
    {
        return Err(FoodError::InvalidInput);
    }
    let palette = input.palette;
    let n = palette.image_count;
    if palette.palette != food_palette(spawn.raw_color)
        || n == 0
        || n as u128 > 9_007_199_254_740_992
        || palette.bodies.len() < n
        || palette.outlines.len() < n
        || palette.glows.len() < n
    {
        return Err(FoodError::InvalidPalette);
    }
    let count = n as f64;
    let z = input.creation_zoom;
    let s = spawn.base_size;
    let body = select_index(count * z * s / 16.5, n)?;
    let inner = select_index(count * z * (0.25 + 0.75 * s / 16.5), n)?;
    let outer = select_index(count * z * 2. * (0.25 + 0.75 * s / 16.5), n)?;
    let sources = FoodSources {
        indices: [body, inner, outer],
        body: palette.bodies[body],
        outline: palette.outlines[body],
        inner: palette.glows[inner],
        outer: palette.glows[outer],
    };
    for source in [sources.body, sources.outline, sources.inner, sources.outer] {
        source.validate()?;
    }
    let animation_rate = 0.65 + 0.1 * s;
    if !animation_rate.is_finite() {
        return Err(FoodError::Arithmetic);
    }
    Ok(FoodPresentation {
        state: FoodSnapshot {
            instance,
            key: spawn.key,
            sector: spawn.sector,
            position: spawn.position,
            raw_color: spawn.raw_color,
            effective_palette: palette.palette,
            base_size: s,
            spawn_speed: if spawn.rapid { 3. } else { 1. },
            render_position: spawn.position,
            fade: 0.,
            scale: 0.00001,
            uneaten_scale: 0.00001,
            animation_phase: input.random_phase_unit * 64.,
            animation_rate,
            wobble_rate: (2. * input.random_wobble_unit - 1.) * 0.0225,
            eaten: false,
            consumption_progress: 0.,
            eater: None,
            creation_zoom: z,
            sources,
        },
    })
}

/// Dense insertion-ordered food objects with reverse scans and swap removal.
/// No connection, camera, quality or packet clock is owned by this world.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FoodWorld {
    foods: Vec<FoodPresentation>,
    last_instance_serial: u64,
}

impl FoodWorld {
    /// Create an empty world. Its serial sequence survives clear().
    pub fn new() -> Self {
        Self::default()
    }

    /// Borrow current dense order, including duplicate keys and eaten objects.
    pub fn foods(&self) -> &[FoodPresentation] {
        &self.foods
    }

    /// Append exactly one instance atomically, freezing source metadata and zoom.
    pub fn spawn(
        &mut self,
        spawn: FoodSpawn,
        input: FoodFactoryInput<'_>,
    ) -> Result<FoodInstance, FoodError> {
        if self.foods.len() >= MAX_RETAINED_FOODS {
            return Err(FoodError::Capacity);
        }
        let serial = self
            .last_instance_serial
            .checked_add(1)
            .ok_or(FoodError::SerialExhausted)?;
        let instance = FoodInstance(serial);
        let food = create(instance, spawn, input)?;
        self.foods
            .try_reserve(1)
            .map_err(|_| FoodError::Allocation)?;
        self.foods.push(food);
        self.last_instance_serial = serial;
        Ok(instance)
    }

    /// Affect the newest equal key, even if it was already eaten. Repeat consumes
    /// reset progress and capture a new token, retaining fade and uneaten scale.
    pub fn consume(&mut self, key: u32, consume: FoodConsume) -> Option<FoodInstance> {
        let index = self.foods.iter().rposition(|f| f.state.key == key)?;
        let instance = self.foods[index].state.instance;
        match consume {
            FoodConsume::Immediate => {
                self.foods.swap_remove(index);
            }
            FoodConsume::Eaten(eater) => {
                let food = &mut self.foods[index].state;
                food.eaten = true;
                food.eater = eater;
                food.consumption_progress = 0.;
            }
        }
        Some(instance)
    }

    /// Reverse-scan and remove every matching original sector, including flights.
    /// Swapped objects from the already visited tail are not processed twice.
    pub fn clear_sector(&mut self, sector: (u8, u8)) -> usize {
        let mut count = 0;
        for index in (0..self.foods.len()).rev() {
            if self.foods[index].state.sector == sector {
                self.foods.swap_remove(index);
                count += 1;
            }
        }
        count
    }

    /// Explicit world reset, releasing all source/token references. Caller-owned
    /// retained cull bounds and the serial sequence survive. Setup must not call this.
    pub fn clear(&mut self) {
        self.foods.clear();
    }

    /// Captured eater tokens for parent GC, including duplicates. Keep detached
    /// entries alive until no retained food references them.
    pub fn referenced_tokens(&self) -> impl Iterator<Item = SnakeObjectToken> + '_ {
        self.foods.iter().filter_map(|f| f.state.eater)
    }

    /// Advance atomically using only step.delta, including zero or disconnected
    /// updates. Call after all snakes advance. The resolver reads the captured
    /// object's current raw pose, never its current wire-ID lookup. A missing
    /// capture expires without calling the resolver; a lost captured token is an
    /// invariant error. Resolver side effects cannot be rolled back.
    pub fn advance<F>(&mut self, step: FrameStep, mut pose: F) -> Result<(), FoodError>
    where
        F: FnMut(SnakeObjectToken) -> Result<FoodEaterPose, FoodError>,
    {
        if !(0. ..=5.).contains(&step.delta) {
            return Err(FoodError::InvalidInput);
        }
        let mut next = self.clone();
        next.advance_in_place(step.delta, &mut pose)?;
        *self = next;
        Ok(())
    }

    fn advance_in_place<F>(&mut self, delta: f64, pose: &mut F) -> Result<(), FoodError>
    where
        F: FnMut(SnakeObjectToken) -> Result<FoodEaterPose, FoodError>,
    {
        for index in (0..self.foods.len()).rev() {
            let f = &mut self.foods[index].state;
            f.animation_phase += delta * f.animation_rate;
            if !f.animation_phase.is_finite() {
                return Err(FoodError::Arithmetic);
            }
            if f.eaten {
                f.consumption_progress += delta / 41.;
                if f.consumption_progress >= 1. || f.eater.is_none() {
                    self.foods.swap_remove(index);
                    continue;
                }
                let eater = pose(f.eater.expect("checked captured eater"))?;
                if !all_finite(&[
                    eater.head.x,
                    eater.head.y,
                    eater.head_offset.x,
                    eater.head_offset.y,
                    eater.heading,
                    eater.angle_offset,
                ]) {
                    return Err(FoodError::Arithmetic);
                }
                let p = f.consumption_progress;
                let k = p * p;
                f.scale = f.uneaten_scale * (1. - p * k);
                let heading = eater.heading + eater.angle_offset;
                if !heading.is_finite() {
                    return Err(FoodError::Arithmetic);
                }
                f.render_position.x = f.position.x
                    + (eater.head.x
                        + eater.head_offset.x
                        + math::cos(heading) * (43. - k * 24.) * (1. - k)
                        - f.position.x)
                        * k;
                f.render_position.y = f.position.y
                    + (eater.head.y
                        + eater.head_offset.y
                        + math::sin(heading) * (43. - k * 24.) * (1. - k)
                        - f.position.y)
                        * k;
                f.render_position.x += math::cos(f.wobble_rate * f.animation_phase) * 6. * (1. - p);
                f.render_position.y += math::sin(f.wobble_rate * f.animation_phase) * 6. * (1. - p);
            } else {
                if f.fade != 1. {
                    f.fade += f.spawn_speed * delta / 150.;
                    if f.fade >= 1. {
                        f.fade = 1.;
                        f.scale = 1.;
                    } else {
                        f.scale = 0.5 * (1. - math::cos(PI * f.fade));
                        f.scale += (0.5 * (1. - math::cos(PI * f.scale)) - f.scale) * 0.66;
                    }
                    f.uneaten_scale = f.scale;
                }
                f.render_position.x =
                    f.position.x + math::cos(f.wobble_rate * f.animation_phase) * 6.;
                f.render_position.y =
                    f.position.y + math::sin(f.wobble_rate * f.animation_phase) * 6.;
            }
            if !all_finite(&[f.render_position.x, f.render_position.y, f.scale]) {
                return Err(FoodError::Arithmetic);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_serial_never_wraps_even_after_clear() {
        let mut world = FoodWorld {
            foods: Vec::new(),
            last_instance_serial: u64::MAX,
        };
        world.clear();
        let before = world.clone();
        let result = world.spawn(
            FoodSpawn {
                key: 0,
                sector: (0, 0),
                position: Point { x: 0., y: 0. },
                base_size: 0.,
                raw_color: 0,
                rapid: false,
            },
            FoodFactoryInput {
                random_phase_unit: 0.,
                random_wobble_unit: 0.,
                creation_zoom: 1.,
                palette: FoodPalette {
                    palette: 0,
                    image_count: 0,
                    bodies: &[],
                    outlines: &[],
                    glows: &[],
                },
            },
        );
        assert_eq!(result, Err(FoodError::SerialExhausted));
        assert_eq!(world, before);
    }
}
