//! Authored synthetic packet recording and production body-plan replay. No external inputs.

use slither_client::{
    presentation::{
        AnimatedClient, BodyAsset, BodyAssetStatus, BodyAssetUse, BodyPaintInput, BodyPaintPlan,
        BodyPaintQuality, BodyPaintRecipe, BodyPaintView, BodyPaintVisual, BodyPalette, BodyStyle,
        BodyVariantMode, MAX_BODY_PAINT_COMMANDS, PreparedSnake, plan_standard_body,
    },
    protocol::ElapsedHeader,
};

pub const FRAME_COUNT: usize = 96;
pub const SNAKE_COUNT: u16 = 40;
pub const BODY_POINTS: u32 = 48;
pub const WIDTH: u32 = 1500;
pub const HEIGHT: u32 = 938;

#[derive(Clone)]
pub struct RecordedFrame {
    pub now_ms: f64,
    pub packet: Vec<u8>,
    pub high_quality: bool,
}

pub struct Recording {
    pub initial: Vec<u8>,
    pub frames: Vec<RecordedFrame>,
}

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup() -> Vec<u8> {
    let mut packet = vec![b'a'];
    packet.extend(u24(10_000));
    for value in [430_u16, 100, 20] {
        packet.extend(value.to_be_bytes());
    }
    packet.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        packet.extend(value.to_be_bytes());
    }
    packet.extend([19, 42]);
    packet
}

fn position(id: u16) -> (u32, u32) {
    // Eight offscreen snakes exercise whole-body culling without removing update work.
    let x = if id <= 32 { 5200 } else { 15_000 };
    (
        x + u32::from((id - 1) % 8) * 45,
        4800 + u32::from((id - 1) / 8) * 65,
    )
}

fn appearance(id: u16) -> Vec<u8> {
    let (x, y) = position(id);
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.extend(u24(0));
    packet.push(b'0');
    packet.extend(u24(0));
    // Alternate boosted and ordinary appearances; all metadata is authored.
    packet.extend(
        (if id.is_multiple_of(2) {
            11_000_u16
        } else {
            4250
        })
        .to_be_bytes(),
    );
    packet.extend(u24(4_194_304));
    packet.push(0);
    packet.extend(u24(x * 5));
    packet.extend(u24(y * 5));
    packet.extend([0, 0, 255]);
    packet.extend(u24((x - BODY_POINTS * 8) * 5));
    packet.extend(u24(y * 5));
    for point in 2..BODY_POINTS {
        packet.extend([143, if point.is_multiple_of(2) { 129 } else { 125 }]);
    }
    packet.extend(0_u16.to_be_bytes());
    packet
}

fn anchor(id: u16, frame: u32, growth: bool) -> Vec<u8> {
    let (x, y) = position(id);
    let mut packet = vec![if growth { b'+' } else { b'=' }];
    packet.extend(id.to_be_bytes());
    packet.extend(0_u16.to_be_bytes());
    packet.extend(((x + frame * 2) as u16).to_be_bytes());
    packet.extend(((y + frame % 3) as u16).to_be_bytes());
    if growth {
        packet.extend(u24(4_194_304));
    }
    packet
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut frame = Vec::new();
    for command in commands {
        frame.extend(u16::try_from(command.len()).unwrap().to_be_bytes());
        frame.extend(command);
    }
    frame
}

impl Recording {
    pub fn crowded() -> Self {
        let mut initial = vec![setup()];
        initial.extend((1..=SNAKE_COUNT).map(appearance));
        let frames =
            (0..FRAME_COUNT)
                .map(|frame| {
                    let mut commands = Vec::new();
                    if frame.is_multiple_of(6) {
                        commands.extend((1..=SNAKE_COUNT).map(|id| {
                            anchor(id, frame as u32, frame == 24 && id.is_multiple_of(3))
                        }));
                    }
                    if frame == 36 {
                        commands.push(vec![b's', 0, 8, 1]); // Retain a dying appearance.
                    }
                    if frame == 42 {
                        commands.push(appearance(8)); // Wire-ID reuse while the old body fades.
                    }
                    if frame == 72 {
                        commands.push(vec![b's', 0, 16, 0]); // Immediate removal.
                    }
                    RecordedFrame {
                        now_ms: (frame + 1) as f64 * (1000. / 60.),
                        packet: bundle(&commands),
                        high_quality: !(48..72).contains(&frame),
                    }
                })
                .collect();
        Self {
            initial: bundle(&initial),
            frames,
        }
    }

    pub fn client(&self) -> AnimatedClient {
        let mut client = AnimatedClient::new(0.).unwrap();
        client
            .apply_frame(&self.initial, ElapsedHeader::Absent)
            .unwrap();
        client.set_follows(false);
        client
            .set_camera_position(slither_client::state::Point { x: 5400., y: 4930. })
            .unwrap();
        client
    }
}

pub fn ingest(client: &mut AnimatedClient, frame: &RecordedFrame) {
    if !frame.packet.is_empty() {
        client
            .apply_frame(&frame.packet, ElapsedHeader::Absent)
            .unwrap();
    }
}

pub fn prepare(client: &mut AnimatedClient, frame: &RecordedFrame) -> Vec<PreparedSnake> {
    client
        .prepare_draw_with_style(
            WIDTH,
            HEIGHT,
            if frame.high_quality { 1. } else { 1.7 },
            false,
        )
        .unwrap()
}

// Only opaque numeric source metadata is used; no browser objects or pixels exist here.
const ASSETS: [BodyAsset; 4] = [asset(1), asset(2), asset(3), asset(4)];
const fn asset(handle: u64) -> BodyAsset {
    BodyAsset {
        handle,
        revision: 1,
        width: 48,
        height: 48,
        status: BodyAssetStatus::Ready,
    }
}
const fn usage(asset: usize) -> BodyAssetUse {
    BodyAssetUse {
        asset,
        source_rect: None,
    }
}
const VARIANTS: [BodyAssetUse; 1] = [usage(0)];

pub fn plans(
    client: &AnimatedClient,
    snakes: &[PreparedSnake],
    high_quality: bool,
) -> Vec<BodyPaintPlan> {
    let palettes = [BodyPalette {
        variants: &VARIANTS,
        boost_glow: Some(usage(1)),
    }];
    snakes
        .iter()
        .map(|snake| {
            let geometry = snake
                .body_geometry
                .as_ref()
                .expect("recording has multi-anchor bodies");
            let m = snake.metrics;
            plan_standard_body(BodyPaintInput {
                geometry: geometry.as_paint_geometry(),
                recipe: BodyPaintRecipe {
                    base_palette: 0,
                    palettes: &palettes,
                    runs: &[],
                    variant_mode: BodyVariantMode::First,
                    variant_period: 1,
                    custom: false,
                    style: Some(BodyStyle {
                        detailed_segments: false,
                        swell: 0.,
                        rotate_segments: true,
                        head_fade: None,
                        tail_fade: None,
                    }),
                    outline: Some(usage(2)),
                    shadow: Some(usage(2)),
                    death: Some(usage(3)),
                },
                assets: &ASSETS,
                view: BodyPaintView {
                    camera: client.camera().position(),
                    zoom: client.camera().zoom(),
                    half_width: f64::from(WIDTH) / 2.,
                    half_height: f64::from(HEIGHT) / 2.,
                },
                quality: BodyPaintQuality {
                    high_quality,
                    blend: if high_quality { 1. } else { 0. },
                },
                visual: BodyPaintVisual {
                    scale: m.scale,
                    spawn: m.spawn_progress,
                    death: m.death_progress,
                    dead: !m.alive,
                    smoothed_speed: m.visual_speed,
                    boost_threshold: m.boost_threshold_speed,
                    cruise_speed: m.cruise_speed,
                    maximum_speed: m.maximum_speed,
                    boost_phase: m.boost_phase,
                },
                entry_alpha: 1.,
                command_limit: MAX_BODY_PAINT_COMMANDS,
            })
            .unwrap()
        })
        .collect()
}
