//! Bounded received scene state for a documented subset of protocol 19.
//!
//! This original presentation model reads transmitted anchors, not authoritative
//! physics. Bodies are head-to-tail; coordinates are centered on setup's grid
//! center. It does not extrapolate motion or reproduce body contraction. Unknown
//! packet families (including prey, HUD, minimap and game-over) are counted and
//! ignored without claiming to decode them.

use crate::{
    math,
    protocol::{self, ElapsedHeader, ProtocolError},
};
use std::{collections::BTreeMap, f64::consts::TAU, fmt};

/// Maximum simultaneously retained snakes.
pub const MAX_SNAKES: usize = 256;
/// Maximum anchors per snake, an independent scene retention policy.
pub const MAX_BODY_POINTS: usize = 4096;
/// Maximum total retained anchors across snakes.
pub const MAX_TOTAL_BODY_POINTS: usize = 65_536;
/// Maximum simultaneously retained food positions.
pub const MAX_FOODS: usize = 65_536;
/// Absolute bound on each centered coordinate and advertised radius.
pub const MAX_COORDINATE: f64 = 16_777_215.0;

/// A centered world position.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    /// Horizontal position.
    pub x: f64,
    /// Vertical position.
    pub y: f64,
}

/// Typed transmitted world configuration. No physics constants are inferred.
#[derive(Clone, Debug, PartialEq)]
pub struct Setup {
    /// Advertised protocol; this module accepts only 19.
    pub protocol: u8,
    /// Offset subtracted from wire positions on both axes.
    pub grid_center: f64,
    /// Advertised arena radius, or 0.98 times grid center when absent.
    pub radius: f64,
    /// Sector side length in world units.
    pub sector_size: u16,
    /// Advertised sector count along an edge.
    pub sector_count: u16,
    /// Maximum segment score-table index (`mscps`), not a physical body cap.
    pub max_segments: u16,
    /// Distance between directed anchors.
    pub body_spacing: f64,
    /// Advertised contraction coefficient; retained but not simulated.
    pub body_contraction: f64,
    /// Advertised speed-angle divisor.
    pub spangdv: f64,
    /// Advertised base speed coefficient.
    pub nsp1: f64,
    /// Advertised size speed coefficient.
    pub nsp2: f64,
    /// Advertised boost speed coefficient.
    pub nsp3: f64,
    /// Advertised turn coefficient.
    pub mamu: f64,
    /// Advertised secondary turn coefficient.
    pub mamu2: f64,
    /// Optional server number; never used as the own snake identifier.
    pub server_number: Option<u16>,
    /// Optional mode byte.
    pub game_mode: Option<u8>,
    /// Optional team byte when mode is 2.
    pub team: Option<u8>,
}

/// A received snake and its original presentation fields.
#[derive(Clone, Debug, PartialEq)]
pub struct Snake {
    /// Wire identifier.
    pub id: u16,
    /// Wire skin index.
    pub skin: u8,
    /// Name decoded one byte per Unicode scalar (Latin-1).
    pub name: String,
    /// Opaque custom appearance bytes, bounded by their one-byte length.
    pub custom_skin: Vec<u8>,
    /// Cosmetic marker.
    pub cosmetic: u8,
    /// Latest transmitted head or front anchor.
    pub head: Point,
    /// Received anchors, head to tail. No contraction/interpolation is applied.
    pub body: Vec<Point>,
    /// Reported heading in radians.
    pub heading: f64,
    /// Reported desired heading in radians.
    pub wanted_heading: f64,
    /// Reported speed in world units per second (wire time unit is 32 ms).
    pub speed: f64,
    /// Fractional mass report, in the inclusive range 0 through 1.
    pub fam: f64,
    /// Fixed six-unit presentation radius, not a decoded physical hitbox.
    pub radius: f64,
    anchor_direction: Option<u16>,
}

/// One food position keyed by its four wire sector/offset bytes.
#[derive(Clone, Debug, PartialEq)]
pub struct Food {
    /// Centered world position.
    pub position: Point,
    /// Transmitted size in world units.
    pub size: f64,
    /// Color byte; zero when the compact packet omits it.
    pub color: u8,
    /// Owning sector coordinates.
    pub sector: (u8, u8),
}

/// Outcome of one committed frame.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FrameReport {
    /// Structurally valid commands, including unsupported ones.
    pub commands: usize,
    /// Unsupported command families, not decoded by this module.
    pub ignored: usize,
}

/// Transmitted turning direction, independent of an omitted direction update.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Direction {
    /// No active turn.
    None,
    /// Turn toward decreasing angles.
    Decreasing,
    /// Turn toward increasing angles.
    Increasing,
}

/// Preserve compact own targeting even after removal from the received ID map.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SnakeTarget {
    /// The retained own presentation object, which may be dying.
    Own,
    /// An explicitly addressed live snake.
    Id(u16),
}

/// Complete initial presentation inputs, separate from centered received state.
///
/// Absolute geometry preserves wire arithmetic without a centering round trip.
/// Body points are head to tail. A final directed body segment supplies the
/// effective initial heading; otherwise the header heading is used. Initial
/// active turning is `Direction::None`, irrespective of `wire_direction`.
#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    /// Wire identifier, including zero.
    pub id: u16,
    /// Wire skin index.
    pub skin: u8,
    /// Latin-1 nickname.
    pub name: String,
    /// Opaque custom appearance bytes.
    pub custom_skin: Vec<u8>,
    /// Cosmetic marker.
    pub cosmetic: u8,
    /// Absolute transmitted head position.
    pub absolute_head: Point,
    /// Absolute body anchors, decoded before centering.
    pub absolute_body: Vec<Point>,
    /// Final directed body heading in wire units, for later compact anchors.
    pub anchor_direction: Option<u16>,
    /// Effective initial heading in radians.
    pub heading: f64,
    /// Transmitted wanted heading in radians.
    pub wanted_heading: f64,
    /// Exact wire speed scalar before conversion to world units per second.
    pub speed_per_32ms: f64,
    /// Received fractional mass.
    pub fam: f64,
    /// Validated header metadata; this does not start an active turn.
    pub wire_direction: Direction,
}

/// A validated presentation change in wire order, without advancing any clock.
#[derive(Clone, Debug, PartialEq)]
pub enum PresentationEvent {
    /// Reset presentation entities and apply this configuration.
    Setup(Setup),
    /// Create or replace a snake with complete initial presentation inputs.
    SnakeAppearance(Appearance),
    /// Apply only the motion fields present in this command.
    SnakeMotion {
        /// Explicit live ID or the retained own presentation object.
        target: SnakeTarget,
        /// Optional heading in radians.
        heading: Option<f64>,
        /// Optional wanted heading in radians.
        wanted_heading: Option<f64>,
        /// Optional turning direction; omission preserves the previous value.
        direction: Option<Direction>,
        /// Optional exact wire speed scalar.
        speed_per_32ms: Option<f64>,
    },
    /// Add a received front anchor, with optional growth and fractional mass.
    SnakeAnchor {
        /// Explicit live ID or the retained own presentation object.
        target: SnakeTarget,
        /// Absolute wire position, omitted by relative anchor commands.
        absolute_position: Option<Point>,
        /// Explicit wire direction; omission reuses presentation's cached value.
        direction: Option<u16>,
        /// Whether this anchor grows the body.
        grew: bool,
        /// Optional fractional mass accompanying growth.
        fam: Option<f64>,
    },
    /// Replace fractional mass independently of geometry.
    SnakeMass {
        /// Known wire identifier.
        id: u16,
        /// Received fractional mass.
        fam: f64,
    },
    /// Remove a tail anchor, optionally replacing fractional mass.
    SnakeTailRemoved {
        /// Known wire identifier.
        id: u16,
        /// Optional received fractional mass.
        fam: Option<f64>,
    },
    /// Remove a known snake, retaining whether death presentation was requested.
    SnakeRemoved {
        /// Removed wire identifier.
        id: u16,
        /// True only when the wire removal flag equals one.
        died: bool,
    },
    /// Replace the target arena radius, without advancing displayed easing.
    RadiusTarget(f64),
}

/// A completely committed frame and its ordered presentation changes.
#[derive(Clone, Debug, PartialEq)]
pub struct AppliedFrame {
    /// Received-state command counts.
    pub report: FrameReport,
    /// Changes published only after the entire frame succeeds.
    pub events: Vec<PresentationEvent>,
}

/// A malformed or out-of-policy frame never changes the scene or counters.
#[derive(Clone, Debug, PartialEq)]
pub enum StateError {
    /// Existing framing or setup-boundary validation failed.
    Protocol(ProtocolError),
    /// A supported command has an invalid length or scalar value.
    InvalidPacket(u8),
    /// A world command arrived before setup.
    MissingSetup,
    /// The advertised protocol is unsupported.
    UnsupportedProtocol(u8),
    /// A bounded entity, body, or food collection would overflow.
    Limit,
    /// A received/reconstructed position exceeds the coordinate bound.
    Coordinate,
    /// A compact food packet needs a previous sector in its own stream.
    MissingSector,
    /// A compact anchor lacks a previous anchor or direction.
    MissingAnchor(u16),
}

impl fmt::Display for StateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Protocol(error) => error.fmt(f),
            Self::InvalidPacket(code) => {
                write!(f, "invalid supported '{}' packet", char::from(*code))
            }
            Self::MissingSetup => f.write_str("world command requires setup"),
            Self::UnsupportedProtocol(version) => write!(f, "unsupported scene protocol {version}"),
            Self::Limit => f.write_str("scene collection limit exceeded"),
            Self::Coordinate => f.write_str("scene coordinate exceeds bound"),
            Self::MissingSector => f.write_str("compact food packet has no previous sector"),
            Self::MissingAnchor(id) => write!(f, "snake {id} has no known anchor direction"),
        }
    }
}
impl std::error::Error for StateError {}
impl From<ProtocolError> for StateError {
    fn from(error: ProtocolError) -> Self {
        Self::Protocol(error)
    }
}

/// Deterministically ordered received scene, independent of browser and network I/O.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClientState {
    /// Current configuration. A new setup clears entities and compact caches.
    pub setup: Option<Setup>,
    /// Current snakes, in wire identifier order.
    pub snakes: BTreeMap<u16, Snake>,
    /// Current foods, in packed `(sector x, sector y, offset x, offset y)` order.
    pub foods: BTreeMap<u32, Food>,
    /// First full appearance after setup; retained when that snake is removed.
    pub own_snake_id: Option<u16>,
    /// Successfully committed frames; saturates rather than overflowing.
    pub frames_applied: u64,
    /// Commands in committed frames, including ignored commands; saturates.
    pub commands_applied: u64,
    /// Unsupported commands in committed frames; saturates.
    pub ignored_commands: u64,
    /// Latest committed frame's explicitly selected elapsed header.
    pub last_elapsed_ms: Option<u16>,
    added_sector: Option<(u8, u8)>,
    eaten_sector: Option<(u8, u8)>,
}

impl ClientState {
    /// Validate framing, then stage all supported decoding and changes atomically.
    ///
    /// Accepted world families: `s`, `g/n/G/N/=/+`, `e/E/3/4/5/d/7`,
    /// `h/r`, `F/f/b/c/C/<`, `w`, and radius `z`; setup is `a`.
    /// Unknown snake updates are validated then ignored. Unsupported families
    /// are opaque and counted even before setup. No clocks or simulation advance.
    pub fn apply_frame(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
    ) -> Result<FrameReport, StateError> {
        self.apply_transaction(bytes, header, None)
    }

    /// Atomically apply a frame and return every supported presentation change.
    ///
    /// Events retain wire order, including replacements and mid-frame resets.
    /// Unknown explicit IDs and food commands emit no events. Compact own
    /// commands retain `Own` targeting after received-state removal, until setup.
    /// Elapsed headers never advance presentation here.
    pub fn apply_frame_with_events(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
    ) -> Result<AppliedFrame, StateError> {
        let mut events = Vec::new();
        let report = self.apply_transaction(bytes, header, Some(&mut events))?;
        Ok(AppliedFrame { report, events })
    }

    fn apply_transaction(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut events: Option<&mut Vec<PresentationEvent>>,
    ) -> Result<FrameReport, StateError> {
        let decoded = protocol::decode_frame(bytes, header)?;
        let mut staged = self.clone();
        let mut ignored = 0;
        for command in &decoded.commands {
            if !staged.apply_command(command, events.as_deref_mut())? {
                ignored += 1;
            }
        }
        staged.frames_applied = staged.frames_applied.saturating_add(1);
        staged.commands_applied = staged
            .commands_applied
            .saturating_add(decoded.commands.len() as u64);
        staged.ignored_commands = staged.ignored_commands.saturating_add(ignored as u64);
        staged.last_elapsed_ms = decoded.elapsed_ms;
        let report = FrameReport {
            commands: decoded.commands.len(),
            ignored,
        };
        *self = staged;
        Ok(report)
    }

    fn apply_command(
        &mut self,
        p: &[u8],
        events: Option<&mut Vec<PresentationEvent>>,
    ) -> Result<bool, StateError> {
        let code = p[0];
        if code == b'a' {
            let setup = parse_setup(p)?;
            if let Some(events) = events {
                events.push(PresentationEvent::Setup(setup.clone()));
            }
            self.setup = Some(setup);
            self.snakes.clear();
            self.foods.clear();
            self.own_snake_id = None;
            self.added_sector = None;
            self.eaten_sector = None;
            return Ok(true);
        }
        if !matches!(
            code,
            b's' | b'g'
                | b'n'
                | b'G'
                | b'N'
                | b'='
                | b'+'
                | b'e'
                | b'E'
                | b'3'
                | b'4'
                | b'5'
                | b'd'
                | b'7'
                | b'h'
                | b'r'
                | b'F'
                | b'f'
                | b'b'
                | b'c'
                | b'C'
                | b'<'
                | b'w'
                | b'z'
        ) {
            return Ok(false);
        }
        let setup = self.setup.as_ref().ok_or(StateError::MissingSetup)?.clone();
        match code {
            b's' => self.appearance(p, &setup, events)?,
            b'g' | b'n' | b'G' | b'N' | b'=' | b'+' => self.anchor(p, &setup, events)?,
            b'e' | b'E' | b'3' | b'4' | b'5' | b'd' | b'7' => self.motion(p, events)?,
            b'h' | b'r' => {
                require(
                    p,
                    if code == b'h' {
                        p.len() == 6
                    } else {
                        matches!(p.len(), 3 | 6)
                    },
                )?;
                let id = word(p, 1)?;
                let fam = if p.len() == 6 {
                    Some(fraction(p, 3)?)
                } else {
                    None
                };
                if let Some(snake) = self.snakes.get_mut(&id) {
                    if code == b'r' {
                        snake.body.pop();
                    }
                    if let Some(fam) = fam {
                        snake.fam = fam;
                    }
                    if let Some(events) = events {
                        events.push(if code == b'r' {
                            PresentationEvent::SnakeTailRemoved { id, fam }
                        } else {
                            PresentationEvent::SnakeMass {
                                id,
                                fam: fam.expect("mass packet requires fractional mass"),
                            }
                        });
                    }
                }
            }
            b'F' => {
                require(p, p.len() >= 3 && (p.len() - 3).is_multiple_of(4))?;
                let sector = (p[1], p[2]);
                // F is a possibly split listing, not a replacement of the sector.
                for food in p[3..].as_chunks::<4>().0 {
                    self.insert_food(&setup, sector, food[1], food[2], food[3], food[0])?;
                }
            }
            b'f' | b'b' => {
                require(p, (4..=7).contains(&p.len()))?;
                let explicit = p.len() >= 6;
                let sector = if explicit {
                    (p[1], p[2])
                } else {
                    self.added_sector.ok_or(StateError::MissingSector)?
                };
                let at = if explicit { 3 } else { 1 };
                let color = if p.len() == at + 4 { p[at + 2] } else { 0 };
                self.insert_food(&setup, sector, p[at], p[at + 1], p[p.len() - 1], color)?;
                self.added_sector = Some(sector);
            }
            b'c' | b'C' | b'<' => {
                let extra = if code == b'<' { 2 } else { 0 };
                require(p, p.len() == 3 + extra || p.len() == 5 + extra)?;
                let explicit = p.len() == 5 + extra;
                let sector = if explicit {
                    (p[1], p[2])
                } else {
                    self.eaten_sector.ok_or(StateError::MissingSector)?
                };
                let at = if explicit { 3 } else { 1 };
                self.foods.remove(&food_key(sector, p[at], p[at + 1]));
                self.eaten_sector = Some(sector);
            }
            b'w' => {
                require(p, p.len() == 3)?;
                self.foods.retain(|_, food| food.sector != (p[1], p[2]));
            }
            b'z' => {
                require(p, p.len() == 4)?;
                let radius = f64::from(triple(p, 1)?);
                require(p, radius > 0.)?;
                self.setup.as_mut().ok_or(StateError::MissingSetup)?.radius = radius;
                if let Some(events) = events {
                    events.push(PresentationEvent::RadiusTarget(radius));
                }
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    fn appearance(
        &mut self,
        p: &[u8],
        setup: &Setup,
        events: Option<&mut Vec<PresentationEvent>>,
    ) -> Result<(), StateError> {
        let id = word(p, 1)?;
        if p.len() <= 7 {
            require(p, matches!(p.len(), 3 | 4))?;
            if self.snakes.remove(&id).is_some()
                && let Some(events) = events
            {
                events.push(PresentationEvent::SnakeRemoved {
                    id,
                    died: p.get(3) == Some(&1),
                });
            }
            return Ok(());
        }
        let direction = match byte(p, 6)? {
            b'0' => Direction::None,
            b'1' => Direction::Decreasing,
            b'2' => Direction::Increasing,
            _ => return Err(StateError::InvalidPacket(p[0])),
        };
        let speed_per_32ms = f64::from(word(p, 10)?) / 1000.;
        let name_len = usize::from(byte(p, 22)?);
        let name_end = 23 + name_len;
        let name = p.get(23..name_end).ok_or(StateError::InvalidPacket(p[0]))?;
        let custom_len = usize::from(byte(p, name_end)?);
        let custom_end = name_end + 1 + custom_len;
        let custom_skin = p
            .get(name_end + 1..custom_end)
            .ok_or(StateError::InvalidPacket(p[0]))?;
        let cosmetic = byte(p, custom_end)?;
        let at = custom_end + 1;
        let mut body = Vec::new();
        let mut absolute_body = events.as_ref().map(|_| Vec::new());
        let mut anchor_direction = None;
        let mut effective_heading = f64::from(triple(p, 3)?) * TAU / 16_777_215.;
        if at < p.len() {
            require(p, p.len() >= at + 6 && (p.len() - at - 6).is_multiple_of(2))?;
            let mut absolute_point = Point {
                x: f64::from(triple(p, at)?) / 5.,
                y: f64::from(triple(p, at + 3)?) / 5.,
            };
            let mut point = centered(setup, absolute_point.x, absolute_point.y)?;
            body.push(point);
            if let Some(body) = &mut absolute_body {
                body.push(absolute_point);
            }
            let rest = &p[at + 6..];
            for (index, pair) in rest.as_chunks::<2>().0.iter().enumerate() {
                if index * 2 + 2 == rest.len() {
                    let direction = u16::from_be_bytes([pair[0], pair[1]]);
                    point = advance(point, direction, setup.body_spacing)?;
                    anchor_direction = Some(direction);
                    effective_heading = f64::from(direction) * (TAU / 65_536.);
                    if absolute_body.is_some() {
                        absolute_point.x += math::cos(effective_heading) * setup.body_spacing;
                        absolute_point.y += math::sin(effective_heading) * setup.body_spacing;
                    }
                } else {
                    let dx = (f64::from(pair[0]) - 127.) / 2.;
                    let dy = (f64::from(pair[1]) - 127.) / 2.;
                    point = checked_point(point.x + dx, point.y + dy)?;
                    if absolute_body.is_some() {
                        absolute_point.x += dx;
                        absolute_point.y += dy;
                    }
                }
                body.push(point);
                if let Some(body) = &mut absolute_body {
                    body.push(absolute_point);
                }
                if body.len() > MAX_BODY_POINTS {
                    return Err(StateError::Limit);
                }
            }
            body.reverse();
            if let Some(body) = &mut absolute_body {
                body.reverse();
            }
        }
        if body.len() > MAX_BODY_POINTS
            || (!self.snakes.contains_key(&id) && self.snakes.len() >= MAX_SNAKES)
        {
            return Err(StateError::Limit);
        }
        let absolute_head = Point {
            x: f64::from(triple(p, 16)?) / 5.,
            y: f64::from(triple(p, 19)?) / 5.,
        };
        let snake = Snake {
            id,
            skin: byte(p, 15)?,
            name: name.iter().map(|&b| char::from(b)).collect(),
            custom_skin: custom_skin.to_vec(),
            cosmetic,
            head: centered(setup, absolute_head.x, absolute_head.y)?,
            body,
            heading: f64::from(triple(p, 3)?) * TAU / 16_777_215.,
            wanted_heading: f64::from(triple(p, 7)?) * TAU / 16_777_215.,
            speed: speed_per_32ms / 0.032,
            fam: fraction(p, 12)?,
            radius: 6.,
            anchor_direction,
        };
        self.snakes.insert(id, snake);
        self.check_total_body()?;
        self.own_snake_id.get_or_insert(id);
        if let Some((events, absolute_body)) = events.zip(absolute_body) {
            let snake = &self.snakes[&id];
            events.push(PresentationEvent::SnakeAppearance(Appearance {
                id,
                skin: snake.skin,
                name: snake.name.clone(),
                custom_skin: snake.custom_skin.clone(),
                cosmetic,
                absolute_head,
                absolute_body,
                anchor_direction,
                heading: effective_heading,
                wanted_heading: snake.wanted_heading,
                speed_per_32ms,
                fam: snake.fam,
                wire_direction: direction,
            }));
        }
        Ok(())
    }

    fn anchor(
        &mut self,
        p: &[u8],
        setup: &Setup,
        events: Option<&mut Vec<PresentationEvent>>,
    ) -> Result<(), StateError> {
        let code = p[0];
        let absolute = matches!(code, b'=' | b'+');
        let grow = matches!(code, b'n' | b'N' | b'+');
        let own = matches!(code, b'G' | b'N')
            || (code == b'=' && p.len() == 7)
            || (code == b'+' && p.len() == 10);
        let at = if own { 1 } else { 3 };
        let mass_bytes = if grow { 3 } else { 0 };
        let payload = p
            .len()
            .checked_sub(at)
            .ok_or(StateError::InvalidPacket(code))?;
        require(
            p,
            if absolute {
                payload == 6 + mass_bytes
            } else {
                payload == mass_bytes || payload == 2 + mass_bytes
            },
        )?;
        let direction = if absolute || payload == 2 + mass_bytes {
            Some(word(p, at)?)
        } else {
            None
        };
        let absolute_position = if absolute {
            Some(Point {
                x: f64::from(word(p, at + 2)?),
                y: f64::from(word(p, at + 4)?),
            })
        } else {
            None
        };
        let position = absolute_position
            .map(|point| centered(setup, point.x, point.y))
            .transpose()?;
        let fam = if grow {
            Some(fraction(p, p.len() - 3)?)
        } else {
            None
        };
        let id = if own {
            self.own_snake_id
        } else {
            Some(word(p, 1)?)
        };
        if let Some(id) = id
            && (own || self.snakes.contains_key(&id))
            && let Some(events) = events
        {
            events.push(PresentationEvent::SnakeAnchor {
                target: if own {
                    SnakeTarget::Own
                } else {
                    SnakeTarget::Id(id)
                },
                absolute_position,
                direction,
                grew: grow,
                fam,
            });
        }
        let Some(snake) = id.and_then(|id| self.snakes.get_mut(&id)) else {
            return Ok(());
        };
        let next_direction = direction.or(snake.anchor_direction);
        let point = if let Some(point) = position {
            point
        } else {
            advance(
                *snake
                    .body
                    .first()
                    .ok_or(StateError::MissingAnchor(snake.id))?,
                next_direction.ok_or(StateError::MissingAnchor(snake.id))?,
                setup.body_spacing,
            )?
        };
        let next_len = snake.body.len() + usize::from(grow || snake.body.is_empty());
        if next_len > MAX_BODY_POINTS {
            return Err(StateError::Limit);
        }
        if !grow && !snake.body.is_empty() {
            snake.body.pop();
        }
        snake.body.insert(0, point);
        snake.head = point;
        snake.anchor_direction = next_direction;
        if let Some(fam) = fam {
            snake.fam = fam;
        }
        self.check_total_body()
    }

    fn motion(
        &mut self,
        p: &[u8],
        events: Option<&mut Vec<PresentationEvent>>,
    ) -> Result<(), StateError> {
        let code = p[0];
        let own = matches!(code, b'd' | b'7') || p.len() <= 3;
        let at = if own { 1 } else { 3 };
        let count = p
            .len()
            .checked_sub(at)
            .ok_or(StateError::InvalidPacket(code))?;
        let (heading, wanted, speed) = match (code, count) {
            (b'd' | b'7', 3) | (b'e' | b'E' | b'3' | b'4' | b'5', 3)
                if !own || matches!(code, b'd' | b'7') =>
            {
                (Some(p[at]), Some(p[at + 1]), Some(p[at + 2]))
            }
            (b'e', 2) => (Some(p[at]), None, Some(p[at + 1])),
            (b'E' | b'4', 2) => (None, Some(p[at]), Some(p[at + 1])),
            (b'3' | b'5', 2) => (Some(p[at]), Some(p[at + 1]), None),
            (b'e', 1) => (Some(p[at]), None, None),
            (b'E' | b'4', 1) => (None, Some(p[at]), None),
            (b'3', 1) => (None, None, Some(p[at])),
            // The single-field 5 shape is valid but changes no motion fields.
            (b'5', 1) => return Ok(()),
            _ => return Err(StateError::InvalidPacket(code)),
        };
        let direction = match (code, count) {
            (b'e', 3) | (b'd', 3) | (b'E' | b'3', 2) | (b'E', 1) => Some(Direction::Decreasing),
            (b'E' | b'3' | b'4' | b'5' | b'7', 3) | (b'4' | b'5', 2) | (b'4', 1) => {
                Some(Direction::Increasing)
            }
            _ => None,
        };
        let heading = heading.map(|value| f64::from(value) * TAU / 256.);
        let wanted_heading = wanted.map(|value| f64::from(value) * TAU / 256.);
        let speed_per_32ms = speed.map(|value| f64::from(value) / 18.);
        let id = if own {
            self.own_snake_id
        } else {
            Some(word(p, 1)?)
        };
        if let Some(id) = id
            && (own || self.snakes.contains_key(&id))
            && let Some(events) = events
        {
            events.push(PresentationEvent::SnakeMotion {
                target: if own {
                    SnakeTarget::Own
                } else {
                    SnakeTarget::Id(id)
                },
                heading,
                wanted_heading,
                direction,
                speed_per_32ms,
            });
        }
        if let Some(snake) = id.and_then(|id| self.snakes.get_mut(&id)) {
            if let Some(value) = heading {
                snake.heading = value;
            }
            if let Some(value) = wanted_heading {
                snake.wanted_heading = value;
            }
            if let Some(value) = speed_per_32ms {
                snake.speed = value / 0.032;
            }
        }
        Ok(())
    }

    fn insert_food(
        &mut self,
        setup: &Setup,
        sector: (u8, u8),
        rx: u8,
        ry: u8,
        size: u8,
        color: u8,
    ) -> Result<(), StateError> {
        let key = food_key(sector, rx, ry);
        if !self.foods.contains_key(&key) && self.foods.len() >= MAX_FOODS {
            return Err(StateError::Limit);
        }
        let unit = f64::from(setup.sector_size);
        let position = centered(
            setup,
            (f64::from(sector.0) + f64::from(rx) / 256.) * unit,
            (f64::from(sector.1) + f64::from(ry) / 256.) * unit,
        )?;
        self.foods.insert(
            key,
            Food {
                position,
                size: f64::from(size) / 5.,
                color,
                sector,
            },
        );
        Ok(())
    }

    fn check_total_body(&self) -> Result<(), StateError> {
        if self
            .snakes
            .values()
            .map(|snake| snake.body.len())
            .sum::<usize>()
            > MAX_TOTAL_BODY_POINTS
        {
            Err(StateError::Limit)
        } else {
            Ok(())
        }
    }
}

fn parse_setup(p: &[u8]) -> Result<Setup, StateError> {
    protocol::setup_protocol_version(p)?;
    if p[23] != 19 {
        return Err(StateError::UnsupportedProtocol(p[23]));
    }
    let grid_center = f64::from(triple(p, 1)?);
    let max_segments = word(p, 4)?;
    let sector_size = word(p, 6)?;
    let contraction = f64::from(word(p, 21)?) / 1000.;
    let radius = if p.len() >= 30 {
        f64::from(triple(p, 27)?)
    } else {
        grid_center * 0.98
    };
    require(
        p,
        grid_center > 0.
            && max_segments > 0
            && sector_size > 0
            && word(p, 8)? > 0
            && p[24] > 0
            && contraction <= 1.
            && radius > 0.,
    )?;
    Ok(Setup {
        protocol: 19,
        grid_center,
        radius,
        sector_size,
        sector_count: word(p, 8)?,
        max_segments,
        body_spacing: f64::from(p[24]),
        body_contraction: contraction,
        spangdv: f64::from(p[10]) / 10.,
        nsp1: f64::from(word(p, 11)?) / 100.,
        nsp2: f64::from(word(p, 13)?) / 100.,
        nsp3: f64::from(word(p, 15)?) / 100.,
        mamu: f64::from(word(p, 17)?) / 1000.,
        mamu2: f64::from(word(p, 19)?) / 1000.,
        server_number: if p.len() >= 27 {
            Some(word(p, 25)?)
        } else {
            None
        },
        game_mode: p.get(30).copied(),
        team: if p.get(30) == Some(&2) {
            Some(byte(p, 31)?)
        } else {
            None
        },
    })
}
fn require(p: &[u8], valid: bool) -> Result<(), StateError> {
    if valid {
        Ok(())
    } else {
        Err(StateError::InvalidPacket(p[0]))
    }
}
fn byte(p: &[u8], at: usize) -> Result<u8, StateError> {
    p.get(at).copied().ok_or(StateError::InvalidPacket(p[0]))
}
fn word(p: &[u8], at: usize) -> Result<u16, StateError> {
    Ok(u16::from_be_bytes([byte(p, at)?, byte(p, at + 1)?]))
}
fn triple(p: &[u8], at: usize) -> Result<u32, StateError> {
    Ok(u32::from_be_bytes([
        0,
        byte(p, at)?,
        byte(p, at + 1)?,
        byte(p, at + 2)?,
    ]))
}
fn fraction(p: &[u8], at: usize) -> Result<f64, StateError> {
    Ok(f64::from(triple(p, at)?) / 16_777_215.)
}
fn checked_point(x: f64, y: f64) -> Result<Point, StateError> {
    if x.is_finite() && y.is_finite() && x.abs() <= MAX_COORDINATE && y.abs() <= MAX_COORDINATE {
        Ok(Point { x, y })
    } else {
        Err(StateError::Coordinate)
    }
}
fn centered(setup: &Setup, x: f64, y: f64) -> Result<Point, StateError> {
    checked_point(x - setup.grid_center, y - setup.grid_center)
}
fn advance(point: Point, direction: u16, spacing: f64) -> Result<Point, StateError> {
    let angle = f64::from(direction) * TAU / 65_536.;
    checked_point(
        point.x + math::cos(angle) * spacing,
        point.y + math::sin(angle) * spacing,
    )
}
fn food_key(sector: (u8, u8), rx: u8, ry: u8) -> u32 {
    u32::from_be_bytes([sector.0, sector.1, rx, ry])
}
