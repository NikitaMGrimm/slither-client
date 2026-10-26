//! Bounded received scene state for a documented subset of protocol 19.
//!
//! This original presentation model reads transmitted anchors, not authoritative
//! physics. Bodies are head-to-tail; coordinates are centered on setup's grid
//! center. It does not extrapolate motion or reproduce body contraction. Unknown
//! packet families (including prey, HUD, minimap and game-over) are counted and
//! ignored without claiming to decode them.

use crate::protocol::{self, ElapsedHeader, ProtocolError};
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
        let decoded = protocol::decode_frame(bytes, header)?;
        let mut staged = self.clone();
        let mut ignored = 0;
        for command in &decoded.commands {
            if !staged.apply_command(command)? {
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

    fn apply_command(&mut self, p: &[u8]) -> Result<bool, StateError> {
        let code = p[0];
        if code == b'a' {
            let setup = parse_setup(p)?;
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
            b's' => self.appearance(p, &setup)?,
            b'g' | b'n' | b'G' | b'N' | b'=' | b'+' => self.anchor(p, &setup)?,
            b'e' | b'E' | b'3' | b'4' | b'5' | b'd' | b'7' => self.motion(p)?,
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
            }
            _ => unreachable!(),
        }
        Ok(true)
    }

    fn appearance(&mut self, p: &[u8], setup: &Setup) -> Result<(), StateError> {
        let id = word(p, 1)?;
        if p.len() <= 7 {
            require(p, matches!(p.len(), 3 | 4))?;
            self.snakes.remove(&id);
            return Ok(());
        }
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
        let mut anchor_direction = None;
        if at < p.len() {
            require(p, p.len() >= at + 6 && (p.len() - at - 6).is_multiple_of(2))?;
            let mut point = centered(
                setup,
                f64::from(triple(p, at)?) / 5.,
                f64::from(triple(p, at + 3)?) / 5.,
            )?;
            body.push(point);
            let rest = &p[at + 6..];
            for (index, pair) in rest.as_chunks::<2>().0.iter().enumerate() {
                if index * 2 + 2 == rest.len() {
                    let direction = u16::from_be_bytes([pair[0], pair[1]]);
                    point = advance(point, direction, setup.body_spacing)?;
                    anchor_direction = Some(direction);
                } else {
                    point = checked_point(
                        point.x + (f64::from(pair[0]) - 127.) / 2.,
                        point.y + (f64::from(pair[1]) - 127.) / 2.,
                    )?;
                }
                body.push(point);
                if body.len() > MAX_BODY_POINTS {
                    return Err(StateError::Limit);
                }
            }
            body.reverse();
        }
        if body.len() > MAX_BODY_POINTS
            || (!self.snakes.contains_key(&id) && self.snakes.len() >= MAX_SNAKES)
        {
            return Err(StateError::Limit);
        }
        let snake = Snake {
            id,
            skin: byte(p, 15)?,
            name: name.iter().map(|&b| char::from(b)).collect(),
            custom_skin: custom_skin.to_vec(),
            cosmetic,
            head: centered(
                setup,
                f64::from(triple(p, 16)?) / 5.,
                f64::from(triple(p, 19)?) / 5.,
            )?,
            body,
            heading: f64::from(triple(p, 3)?) * TAU / 16_777_215.,
            wanted_heading: f64::from(triple(p, 7)?) * TAU / 16_777_215.,
            speed: f64::from(word(p, 10)?) / 1000. / 0.032,
            fam: fraction(p, 12)?,
            radius: 6.,
            anchor_direction,
        };
        self.snakes.insert(id, snake);
        self.check_total_body()?;
        self.own_snake_id.get_or_insert(id);
        Ok(())
    }

    fn anchor(&mut self, p: &[u8], setup: &Setup) -> Result<(), StateError> {
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
        let position = if absolute {
            Some(centered(
                setup,
                f64::from(word(p, at + 2)?),
                f64::from(word(p, at + 4)?),
            )?)
        } else {
            None
        };
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

    fn motion(&mut self, p: &[u8]) -> Result<(), StateError> {
        let code = p[0];
        let own = matches!(code, b'd' | b'7') || p.len() <= 3;
        let at = if own { 1 } else { 3 };
        let count = p
            .len()
            .checked_sub(at)
            .ok_or(StateError::InvalidPacket(code))?;
        let (heading, wanted, speed) = match (code, count) {
            (b'd' | b'7', 3) | (b'e' | b'E', 3) if !own || matches!(code, b'd' | b'7') => {
                (Some(p[at]), Some(p[at + 1]), Some(p[at + 2]))
            }
            (b'e', 2) => (Some(p[at]), None, Some(p[at + 1])),
            (b'E' | b'4', 2) => (None, Some(p[at]), Some(p[at + 1])),
            (b'3' | b'5', 2) => (Some(p[at]), Some(p[at + 1]), None),
            (b'e', 1) => (Some(p[at]), None, None),
            (b'E' | b'4', 1) => (None, Some(p[at]), None),
            (b'3', 1) => (None, None, Some(p[at])),
            _ => return Err(StateError::InvalidPacket(code)),
        };
        let id = if own {
            self.own_snake_id
        } else {
            Some(word(p, 1)?)
        };
        if let Some(snake) = id.and_then(|id| self.snakes.get_mut(&id)) {
            if let Some(value) = heading {
                snake.heading = f64::from(value) * TAU / 256.;
            }
            if let Some(value) = wanted {
                snake.wanted_heading = f64::from(value) * TAU / 256.;
            }
            if let Some(value) = speed {
                snake.speed = f64::from(value) / 18. / 0.032;
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
        point.x + angle.cos() * spacing,
        point.y + angle.sin() * spacing,
    )
}
fn food_key(sector: (u8, u8), rx: u8, ry: u8) -> u32 {
    u32::from_be_bytes([sector.0, sector.1, rx, ry])
}
