//! Retained prey objects, raw motion and position corrections. No asset loading or clock.

use std::{error::Error, f64::consts::PI, fmt};

use crate::{
    math,
    state::{Direction, Point, PreyMotionInput, PreySpawnInput},
};

use super::{CorrectionRing, FoodEaterPose, FoodSource, FrameStep, HEAD_SAMPLES, SnakeObjectToken};

/// Retained appearances, including duplicates and captured flights.
pub const MAX_RETAINED_PREYS: usize = 4096;
/// Independently bounded body and glow family lengths.
pub const MAX_PREY_FAMILY_SOURCES: usize = 4096;
/// Shared numeric raster metadata; source ownership remains with the caller.
pub type PreySource = FoodSource;
/// The captured snake's raw head, offsets and heading channels.
pub type PreyEaterPose = FoodEaterPose;

/// Nonzero serial in a prey-specific namespace, surviving explicit world clears.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct PreyInstance(u64);
impl PreyInstance {
    /// Exact serial; JavaScript diagnostics must use BigInt.
    pub fn serial(self) -> u64 {
        self.0
    }
}

/// Independent body and glow families for one effective palette.
#[derive(Clone, Copy, Debug)]
pub struct PreyPalette<'a> {
    /// Must equal the raw color modulo nine.
    pub palette: u8,
    /// All entries are validated, including unselected ones.
    pub bodies: &'a [PreySource],
    /// Its final entry is selected, independently of the body count.
    pub glows: &'a [PreySource],
}

/// Borrowed entropy, source metadata and creation-time zoom.
#[derive(Clone, Copy, Debug)]
pub struct PreyFactoryInput<'a> {
    /// First independent random unit, finite in [0,1).
    pub random_phase_unit: f64,
    /// Second independent random unit, finite in [0,1).
    pub random_rate_unit: f64,
    /// Positive finite zoom at the appearance event.
    pub creation_zoom: f64,
    /// Trusted palette and independently sized families.
    pub palette: PreyPalette<'a>,
}

/// Owned synchronous factory result; neither update nor draw requests more entropy.
#[derive(Clone, Debug, PartialEq)]
pub struct PreyFactory {
    /// First random unit.
    pub random_phase_unit: f64,
    /// Second random unit.
    pub random_rate_unit: f64,
    /// Effective palette, raw color modulo nine.
    pub palette: u8,
    /// Body family.
    pub bodies: Vec<PreySource>,
    /// Glow family.
    pub glows: Vec<PreySource>,
}
impl PreyFactory {
    /// Borrow without copying or reselecting sources.
    pub fn input(&self, creation_zoom: f64) -> PreyFactoryInput<'_> {
        PreyFactoryInput {
            random_phase_unit: self.random_phase_unit,
            random_rate_unit: self.random_rate_unit,
            creation_zoom,
            palette: PreyPalette {
                palette: self.palette,
                bodies: &self.bodies,
                glows: &self.glows,
            },
        }
    }
}

/// Frozen body/glow selection and independent source metadata.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PreySources {
    /// Body and glow indices, respectively.
    pub indices: [usize; 2],
    /// Independent body and glow family lengths at creation.
    pub family_counts: [usize; 2],
    /// Selected body.
    pub body: PreySource,
    /// Selected glow, shared by the inner and outer lobes.
    pub glow: PreySource,
}

/// Two position channels, with Float32 stores and deferred positive-step cleanup.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreyCorrections {
    ring: CorrectionRing<HEAD_SAMPLES, 2>,
}
impl PreyCorrections {
    /// Current displayed x/y offsets, promoted from Float32 storage.
    pub fn offset(&self) -> [f64; 2] {
        self.ring.offset
    }
    /// Next physical slot to consume.
    pub fn index(&self) -> usize {
        self.ring.index
    }
    /// Samples remaining, zero awaiting cleanup, or -1 after cleanup.
    pub fn pending(&self) -> i32 {
        self.ring.pending
    }
    /// Physical x/y channel samples.
    pub fn samples(&self) -> &[[f32; HEAD_SAMPLES]; 2] {
        &self.ring.samples
    }
    /// Creation-time Float32 weights.
    pub fn weights(&self) -> &[f32; HEAD_SAMPLES] {
        &self.ring.weights
    }
}

/// Copied numeric state. Mouth interpolation is intentionally absent.
#[derive(Clone, Debug, PartialEq)]
pub struct PreySnapshot {
    /// Stable prey identity.
    pub instance: PreyInstance,
    /// Wire ID, including duplicates and zero.
    pub id: u16,
    /// Raw absolute position before correction and mouth interpolation.
    pub position: Point,
    /// Original size byte.
    pub size_byte: u8,
    /// Decoded size.
    pub base_size: f64,
    /// Original color byte.
    pub raw_color: u8,
    /// Raw color modulo nine.
    pub palette: u8,
    /// Active turn.
    pub direction: Direction,
    /// Raw heading, retaining full-turn endpoints and signed zero.
    pub heading: f64,
    /// Target heading.
    pub wanted_heading: f64,
    /// Retained speed scalar.
    pub speed_per_32ms: f64,
    /// Spawn or flight draw scale.
    pub scale: f64,
    /// Spawn/flight fade, including values above one.
    pub fade: f64,
    /// Glow phase.
    pub glow_phase: f64,
    /// Per-unit phase rate.
    pub glow_rate: f64,
    /// Retained independent entropy inputs, including signed zero.
    pub random_phase_unit: f64,
    /// Retained second entropy input.
    pub random_rate_unit: f64,
    /// Source-selection zoom, unchanged by future draws or Setup.
    pub creation_zoom: f64,
    /// Whether capture has occurred.
    pub eaten: bool,
    /// Captured object identity, independent of current wire lookup.
    pub eater: Option<SnakeObjectToken>,
    /// Flight progress, reset by every capture.
    pub consumption_progress: f64,
    /// Frozen selections.
    pub sources: PreySources,
    /// Complete position correction snapshot.
    pub corrections: PreyCorrections,
}

/// A retained appearance; mutation goes through the transactional world.
#[derive(Clone, Debug, PartialEq)]
pub struct PreyPresentation {
    state: PreySnapshot,
}
impl PreyPresentation {
    /// Freeze all scalars, identities, source metadata and correction samples.
    pub fn snapshot(&self) -> PreySnapshot {
        self.state.clone()
    }
    pub(super) fn state(&self) -> &PreySnapshot {
        &self.state
    }
}

/// Invalid input, resource exhaustion or invalid derived arithmetic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreyError {
    /// Nonfinite or out-of-domain packet, timing or entropy input.
    InvalidInput,
    /// Wrong palette or a family outside 1..=4096.
    InvalidPalette,
    /// Invalid, unready or incoherent source metadata.
    InvalidSource,
    /// Retained instance ceiling.
    Capacity,
    /// Nonzero serial allocation cannot advance.
    SerialExhausted,
    /// Bounded fallible reservation failed.
    Allocation,
    /// Parent lost a captured object that must remain retained.
    MissingEater(SnakeObjectToken),
    /// Nonfinite derived arithmetic or resolved pose.
    Arithmetic,
}
impl fmt::Display for PreyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "prey presentation failed: {self:?}")
    }
}
impl Error for PreyError {}

fn finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}
fn validate_motion(input: PreyMotionInput) -> Result<(), PreyError> {
    if !finite(&[input.absolute_position.x, input.absolute_position.y])
        || input.heading.is_some_and(|v| !v.is_finite())
        || input.wanted_heading.is_some_and(|v| !v.is_finite())
        || input
            .speed_per_32ms
            .is_some_and(|v| !v.is_finite() || v < 0.)
    {
        return Err(PreyError::InvalidInput);
    }
    Ok(())
}

fn create(
    instance: PreyInstance,
    s: PreySpawnInput,
    input: PreyFactoryInput<'_>,
) -> Result<PreyPresentation, PreyError> {
    validate_motion(PreyMotionInput {
        id: s.id,
        absolute_position: s.absolute_position,
        direction: Some(s.direction),
        heading: Some(s.heading),
        wanted_heading: Some(s.wanted_heading),
        speed_per_32ms: Some(s.speed_per_32ms),
    })?;
    if !finite(&[s.base_size, input.creation_zoom])
        || s.base_size < 0.
        || s.base_size.to_bits() != (f64::from(s.size_byte) / 5.).to_bits()
        || input.creation_zoom <= 0.
        || !(0. ..1.).contains(&input.random_phase_unit)
        || !(0. ..1.).contains(&input.random_rate_unit)
    {
        return Err(PreyError::InvalidInput);
    }
    let p = input.palette;
    if p.palette != s.raw_color % 9
        || p.bodies.is_empty()
        || p.glows.is_empty()
        || p.bodies.len() > MAX_PREY_FAMILY_SOURCES
        || p.glows.len() > MAX_PREY_FAMILY_SOURCES
    {
        return Err(PreyError::InvalidPalette);
    }
    let mut assets = Vec::new();
    assets
        .try_reserve_exact(p.bodies.len() + p.glows.len())
        .map_err(|_| PreyError::Allocation)?;
    for source in p.bodies.iter().chain(p.glows) {
        source.validate().map_err(|_| PreyError::InvalidSource)?;
        assets.push(source.asset());
    }
    assets.sort_unstable_by_key(|a| a.handle);
    if assets
        .windows(2)
        .any(|pair| pair[0].handle == pair[1].handle && pair[0] != pair[1])
    {
        return Err(PreyError::InvalidSource);
    }
    let index = (p.bodies.len() as f64 * input.creation_zoom * s.base_size / 9.).floor();
    let glow_phase = input.random_phase_unit * 64.;
    let glow_rate = 0.5 + input.random_rate_unit * 0.15 + 0.1 * s.base_size;
    if !finite(&[index, glow_phase, glow_rate]) {
        return Err(PreyError::Arithmetic);
    }
    let body_index = index.max(0.).min((p.bodies.len() - 1) as f64) as usize;
    let glow_index = p.glows.len() - 1;
    Ok(PreyPresentation {
        state: PreySnapshot {
            instance,
            id: s.id,
            position: s.absolute_position,
            size_byte: s.size_byte,
            base_size: s.base_size,
            raw_color: s.raw_color,
            palette: p.palette,
            direction: s.direction,
            heading: s.heading,
            wanted_heading: s.wanted_heading,
            speed_per_32ms: s.speed_per_32ms,
            scale: 1e-5,
            fade: 0.,
            glow_phase,
            glow_rate,
            random_phase_unit: input.random_phase_unit,
            random_rate_unit: input.random_rate_unit,
            creation_zoom: input.creation_zoom,
            eaten: false,
            eater: None,
            consumption_progress: 0.,
            sources: PreySources {
                indices: [body_index, glow_index],
                family_counts: [p.bodies.len(), p.glows.len()],
                body: p.bodies[body_index],
                glow: p.glows[glow_index],
            },
            corrections: PreyCorrections::default(),
        },
    })
}

/// Insertion-order vector with stable erase and newest-match packet selection.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PreyWorld {
    preys: Vec<PreyPresentation>,
    last_instance_serial: u64,
}
impl PreyWorld {
    /// Empty world with a fresh identity sequence.
    pub fn new() -> Self {
        Self::default()
    }
    /// Insertion order; update and paint traverse this slice in reverse.
    pub fn preys(&self) -> &[PreyPresentation] {
        &self.preys
    }
    /// Owned snapshots in insertion order.
    pub fn snapshots(&self) -> impl Iterator<Item = PreySnapshot> + '_ {
        self.preys.iter().map(PreyPresentation::snapshot)
    }
    /// Captured identities, suitable for chaining with food GC roots.
    pub fn referenced_eaters(&self) -> impl Iterator<Item = SnakeObjectToken> + '_ {
        self.preys.iter().filter_map(|p| p.state.eater)
    }
    /// Clear live objects while preserving serial allocation.
    pub fn clear(&mut self) {
        self.preys.clear();
    }
    /// Append without collapsing duplicate IDs. Validation precedes mutation.
    pub fn spawn(
        &mut self,
        spawn: PreySpawnInput,
        input: PreyFactoryInput<'_>,
    ) -> Result<PreyInstance, PreyError> {
        if self.preys.len() >= MAX_RETAINED_PREYS {
            return Err(PreyError::Capacity);
        }
        let serial = self
            .last_instance_serial
            .checked_add(1)
            .ok_or(PreyError::SerialExhausted)?;
        let instance = PreyInstance(serial);
        let prey = create(instance, spawn, input)?;
        self.preys
            .try_reserve(1)
            .map_err(|_| PreyError::Allocation)?;
        self.preys.push(prey);
        self.last_instance_serial = serial;
        Ok(instance)
    }
    /// Immediately erase the newest matching ID, preserving survivor order.
    pub fn remove(&mut self, id: u16) -> Option<PreyInstance> {
        let index = self.preys.iter().rposition(|p| p.state.id == id)?;
        Some(self.preys.remove(index).state.instance)
    }
    /// Capture the newest match, resetting only progress and captured identity.
    /// An absent event-time eater erases immediately.
    pub fn consume(&mut self, id: u16, eater: Option<SnakeObjectToken>) -> Option<PreyInstance> {
        let Some(eater) = eater else {
            return self.remove(id);
        };
        let p = &mut self.preys.iter_mut().rfind(|p| p.state.id == id)?.state;
        p.eaten = true;
        p.eater = Some(eater);
        p.consumption_progress = 0.;
        Some(p.instance)
    }
    /// Normal packet reanchor: elapsed receive headers never supply extrapolation.
    pub fn motion(
        &mut self,
        input: PreyMotionInput,
        lag: f64,
    ) -> Result<Option<PreyInstance>, PreyError> {
        self.motion_with_extrapolation(input, 0., lag)
    }
    /// Controlled primitive: old speed determines travel before new heading/speed.
    /// Explicit nonzero extrapolation is not normal packet execution.
    pub fn motion_with_extrapolation(
        &mut self,
        input: PreyMotionInput,
        extrapolation_ms: f64,
        lag: f64,
    ) -> Result<Option<PreyInstance>, PreyError> {
        validate_motion(input)?;
        if !finite(&[extrapolation_ms, lag]) || extrapolation_ms < 0. || !(0.2..=1.).contains(&lag)
        {
            return Err(PreyError::InvalidInput);
        }
        let Some(index) = self.preys.iter().rposition(|p| p.state.id == input.id) else {
            return Ok(None);
        };
        let mut next = self.preys[index].clone();
        let p = &mut next.state;
        let mut travel = p.speed_per_32ms * (extrapolation_ms / 8.) / 4.;
        travel *= lag;
        if let Some(v) = input.direction {
            p.direction = v;
        }
        if let Some(v) = input.heading {
            p.heading = v;
        }
        if let Some(v) = input.wanted_heading {
            p.wanted_heading = v;
        }
        if let Some(v) = input.speed_per_32ms {
            p.speed_per_32ms = v;
        }
        let position = Point {
            x: input.absolute_position.x + math::cos(p.heading) * travel,
            y: input.absolute_position.y + math::sin(p.heading) * travel,
        };
        if !finite(&[travel, position.x, position.y]) {
            return Err(PreyError::Arithmetic);
        }
        p.corrections
            .ring
            .inject([position.x - p.position.x, position.y - p.position.y], true)
            .map_err(|_| PreyError::Arithmetic)?;
        p.position = position;
        let instance = p.instance;
        self.preys[index] = next;
        Ok(Some(instance))
    }
    /// Advance in reverse order after snakes, even on a zero-delta update.
    /// Resolver errors preserve every prey; callback side effects cannot roll back.
    pub fn advance<F>(
        &mut self,
        step: FrameStep,
        mamu2: f64,
        mut resolve_eater: F,
    ) -> Result<(), PreyError>
    where
        F: FnMut(SnakeObjectToken) -> Result<PreyEaterPose, PreyError>,
    {
        if !(0. ..=5.).contains(&step.delta) || !mamu2.is_finite() || mamu2 < 0. {
            return Err(PreyError::InvalidInput);
        }
        let mut preys = Vec::new();
        preys
            .try_reserve_exact(self.preys.len())
            .map_err(|_| PreyError::Allocation)?;
        preys.extend(self.preys.iter().cloned());
        for index in (0..preys.len()).rev() {
            let p = &mut preys[index].state;
            let turn = mamu2 * step.delta;
            let travel = p.speed_per_32ms * step.delta / 4.;
            if !finite(&[turn, travel]) {
                return Err(PreyError::Arithmetic);
            }
            p.corrections.ring.advance(step.whole_steps);
            match p.direction {
                Direction::None => p.heading = p.wanted_heading,
                direction => {
                    match direction {
                        Direction::Decreasing => p.heading -= turn,
                        Direction::Increasing => p.heading += turn,
                        Direction::None => unreachable!(),
                    }
                    if !p.heading.is_finite() {
                        return Err(PreyError::Arithmetic);
                    }
                    if p.heading < 0. || p.heading >= 2. * PI {
                        p.heading %= 2. * PI;
                    }
                    if p.heading < 0. {
                        p.heading += 2. * PI;
                    }
                    let difference = p.wanted_heading - p.heading;
                    if !difference.is_finite() {
                        return Err(PreyError::Arithmetic);
                    }
                    let mut difference = difference % (2. * PI);
                    if difference < 0. {
                        difference += 2. * PI;
                    }
                    if difference > PI {
                        difference -= 2. * PI;
                    }
                    if (direction == Direction::Decreasing && difference > 0.)
                        || (direction == Direction::Increasing && difference < 0.)
                    {
                        p.heading = p.wanted_heading;
                        p.direction = Direction::None;
                    }
                }
            }
            p.position.x += math::cos(p.heading) * travel;
            p.position.y += math::sin(p.heading) * travel;
            p.glow_phase += step.delta * p.glow_rate;
            if p.eaten {
                p.fade += step.delta / 150.;
                if p.fade >= 1.5 {
                    p.fade = 1.5;
                }
                p.consumption_progress += step.delta / 47.;
                p.glow_phase += step.delta;
            } else if p.fade != 1. {
                p.fade += step.delta / 150.;
                if p.fade >= 1. {
                    p.fade = 1.;
                    p.scale = 1.;
                } else {
                    p.scale = 0.5 * (1. - math::cos(PI * p.fade));
                    p.scale += (0.5 * (1. - math::cos(PI * p.scale)) - p.scale) * 0.66;
                }
            }
            if !finite(&[
                p.position.x,
                p.position.y,
                p.heading,
                p.glow_phase,
                p.fade,
                p.consumption_progress,
            ]) {
                return Err(PreyError::Arithmetic);
            }
            if p.eaten {
                if p.consumption_progress >= 1. || p.eater.is_none() {
                    preys.remove(index);
                    continue;
                }
                let token = p.eater.expect("checked captured eater");
                let pose = resolve_eater(token)?;
                if !finite(&[
                    pose.head.x,
                    pose.head.y,
                    pose.head_offset.x,
                    pose.head_offset.y,
                    pose.heading,
                    pose.angle_offset,
                ]) {
                    return Err(PreyError::Arithmetic);
                }
                p.scale = 1. - math::pow(p.consumption_progress, 3.);
            }
            if !p.scale.is_finite() {
                return Err(PreyError::Arithmetic);
            }
        }
        self.preys = preys;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhausted_serial_rejects_without_reusing_after_clear() {
        let mut world = PreyWorld {
            preys: Vec::new(),
            last_instance_serial: u64::MAX,
        };
        world.clear();
        let spawn = PreySpawnInput {
            id: 0,
            absolute_position: Point { x: 0., y: 0. },
            size_byte: 0,
            base_size: 0.,
            raw_color: 0,
            direction: Direction::None,
            heading: 0.,
            wanted_heading: 0.,
            speed_per_32ms: 0.,
        };
        let input = PreyFactoryInput {
            random_phase_unit: 0.,
            random_rate_unit: 0.,
            creation_zoom: 1.,
            palette: PreyPalette {
                palette: 0,
                bodies: &[],
                glows: &[],
            },
        };
        assert_eq!(world.spawn(spawn, input), Err(PreyError::SerialExhausted));
        assert_eq!(world.last_instance_serial, u64::MAX);
        assert!(world.preys.is_empty());
    }
}
