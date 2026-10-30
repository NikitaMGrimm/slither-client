//! ORIGINAL SYNTHETIC images and packets. No external artwork, sockets or GPU.
use slither_client::{presentation::*, protocol::ElapsedHeader};
use slither_wgpu_slice::{
    bank::Bank,
    cosmetics::{self, Cosmetics, Images},
    frame::MAX_DRAWS,
    hud, render,
};
use std::io::Cursor;

fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([180, (x % 256) as u8, (y % 256) as u8, 128])
    });
    let mut out = Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}
fn cosmetics(own: Option<u8>) -> Cosmetics {
    let bytes = png(8, 8);
    Cosmetics::load(|_| Ok(bytes.clone()), own).unwrap()
}
fn quality() -> QualitySnapshot {
    QualityState::new(QualityMode::High, 0.).unwrap().snapshot()
}
fn u24(n: u32) -> [u8; 3] {
    let b = n.to_be_bytes();
    [b[1], b[2], b[3]]
}
fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for v in [430u16, 100, 20] {
        p.extend(v.to_be_bytes());
    }
    p.push(48);
    for v in [539u16, 40, 1400, 33, 28, 430] {
        p.extend(v.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}
fn spawn(skin: u8, cosmetic: u8) -> Vec<u8> {
    let mut p = vec![b's', 0, 7];
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250u16.to_be_bytes());
    p.extend(u24(0));
    p.push(skin);
    p.extend(u24(5500));
    p.extend(u24(5000));
    p.extend([0, 0, cosmetic]);
    p.extend(u24(4780));
    p.extend(u24(5000));
    for _ in 2..12 {
        p.extend([151, 127]);
    }
    p.extend([0, 0]);
    p
}
fn client(bank: &Bank, skin: u8, accessory: u8) -> AnimatedClient {
    client_named(bank, skin, accessory, "")
}
fn named(mut packet: Vec<u8>, name: &str) -> Vec<u8> {
    packet[22] = name.len() as u8;
    packet.splice(23..23, name.bytes());
    packet
}
fn client_named(bank: &Bank, skin: u8, accessory: u8, name: &str) -> AnimatedClient {
    let packets: Vec<_> = [setup(), named(spawn(skin, accessory), name)]
        .into_iter()
        .flat_map(|p| {
            let mut out = (p.len() as u16).to_be_bytes().to_vec();
            out.extend(p);
            out
        })
        .collect();
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_nicknames().unwrap();
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &packets,
        ElapsedHeader::Absent,
        |a, context| {
            Ok(bank
                .cosmetics
                .as_ref()
                .unwrap()
                .appearance(a, context.own)
                .unwrap())
        },
    )
    .unwrap();
    c.advance(100., false).unwrap();
    c
}

#[test]
fn bounded_png_jpeg_decode_premultiplies_and_rejects_bad_inputs() {
    let image = cosmetics::decode(&png(2, 3)).unwrap();
    assert_eq!((image.width, image.height), (2, 3));
    assert_eq!(&image.pixels[..4], &[90, 0, 0, 128]);
    let mut jpeg = Cursor::new(Vec::new());
    image::RgbImage::from_pixel(2, 2, image::Rgb([80, 120, 200]))
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .unwrap();
    let decoded = cosmetics::decode(jpeg.get_ref()).unwrap();
    assert!(
        decoded
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[3] == 255)
    );
    assert!(cosmetics::decode(b"not an image").is_err());
    assert!(cosmetics::decode(&vec![0; cosmetics::MAX_ENCODED_BYTES + 1]).is_err());
    assert!(cosmetics::decode(&png(1025, 1)).is_err());
    let mut images = Images::default();
    images.add("s/a_cap.png", &png(1, 1)).unwrap();
    assert!(images.add("s/a_cap.png", &png(1, 1)).is_err());
    assert!(images.add("../s/a_cap.png", &png(1, 1)).is_err());
    assert!(
        Cosmetics::from_images(images, Some(30))
            .unwrap()
            .accessory(true)
            .is_some()
    );
}

#[test]
fn every_stock_skin_prepares_and_binds_only_its_active_resources() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    for skin in 0..=65 {
        let mut c = client(&bank, skin, 255);
        let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality())
            .unwrap()
            .frame;
        let resources = bank.resources(&frame).unwrap();
        assert!(!frame.draws.is_empty(), "skin {skin}");
        assert!(resources.len() < 100, "skin {skin}");
        assert!(
            resources
                .iter()
                .flat_map(|r| r.image.pixels.as_chunks::<4>().0.iter())
                .all(|p| p[..3].iter().all(|v| *v <= p[3]))
        );
        let expected = resolve_skin(skin, &[], false).unwrap();
        let token = c.own_token().unwrap();
        assert_eq!(
            *c.snake_object(token).unwrap().active_face_geometry(),
            expected.face
        );
        assert_eq!(
            c.antenna_geometry(token),
            expected.antenna.map(|v| v.geometry)
        );
        let roles = bank.cosmetics.as_ref().unwrap();
        let image_count = match expected.face_sources {
            SkinFaceSources::None => 0,
            SkinFaceSources::PairedSide(_) | SkinFaceSources::SingleImage { .. } => 2,
            SkinFaceSources::Mouth { .. } => 3,
        };
        let actual = frame
            .draws
            .iter()
            .filter(|d| roles.resources().any(|r| r.asset == d.asset))
            .count();
        assert_eq!(
            actual,
            image_count + usize::from(expected.antenna.is_some()),
            "skin {skin}"
        );
    }
}

#[test]
fn all_explicit_own_accessories_use_retained_attachment() {
    let mut bank = Bank::new().unwrap();
    for id in 0..32 {
        bank.cosmetics = Some(cosmetics(Some(id)));
        let mut c = client(&bank, 0, 255);
        let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality())
            .unwrap()
            .frame;
        let token = c.own_token().unwrap();
        let geometry = c.static_accessory_geometry(token).unwrap();
        let data = cosmetics::ACCESSORIES[usize::from(id)];
        assert_eq!(
            (geometry.image_scale, geometry.pivot_x, geometry.pivot_y),
            (data.1, data.2, data.3)
        );
        let asset = bank
            .cosmetics
            .as_ref()
            .unwrap()
            .accessory(true)
            .unwrap()
            .asset;
        assert_eq!(frame.draws.iter().filter(|d| d.asset == asset).count(), 1);
    }
    bank.cosmetics = Some(cosmetics(Some(30)));
    let c = client(&bank, 40, 255);
    let token = c.own_token().unwrap();
    assert_eq!(c.static_accessory_geometry(token).unwrap().pivot_x, 194.);
    let c = client(&bank, 27, 30);
    assert!(
        c.static_accessory_geometry(c.own_token().unwrap())
            .is_none()
    );
}

#[test]
fn antenna_state_advances_once_and_bulb_precedes_death_highlights() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    let mut c = client(&bank, 37, 255);
    let token = c.own_token().unwrap();
    render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality()).unwrap();
    let first = c.antenna_snapshot(token).unwrap();
    let removal = [0, 4, b's', 0, 7, 1];
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &removal,
        ElapsedHeader::Absent,
        |_, _| unreachable!(),
    )
    .unwrap();
    c.advance(200., false).unwrap();
    let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 2, quality())
        .unwrap()
        .frame;
    assert_ne!(first, c.antenna_snapshot(token).unwrap());
    let bulb = bank
        .cosmetics
        .as_ref()
        .unwrap()
        .role(SkinSourceRole::KwkBulb)
        .unwrap();
    let bulb = frame.draws.iter().position(|d| d.asset == bulb).unwrap();
    let death = bank.assets[bank.death.asset];
    let death = frame.draws.iter().position(|d| d.asset == death).unwrap();
    assert!(bulb < death);
    assert!(frame.draws[death].effective_alpha > 0.);
    bank.resources(&frame).unwrap();
}

#[test]
fn dense_and_swell_styles_reach_body_sampling() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    let mut c = client(&bank, 60, 255);
    let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality())
        .unwrap()
        .frame;
    let family = |frame: &slither_wgpu_slice::frame::Frame, bank: &Bank, palette: usize| {
        frame
            .draws
            .iter()
            .filter(|d| {
                bank.bodies[palette]
                    .variants
                    .iter()
                    .any(|v| bank.assets[v.asset] == d.asset)
            })
            .count()
    };
    assert!(
        family(&frame, &bank, 37) > 0,
        "head fade reaches submission"
    );
    assert!(
        family(&frame, &bank, 38) > 0,
        "tail fade reaches submission"
    );
    let mut plain = Bank::new().unwrap();
    let mut ordinary = client(&bank, 60, 255);
    let ordinary = render::prepare(&mut ordinary, &mut plain, [960, 540], 1., 1, quality())
        .unwrap()
        .frame;
    assert!(
        family(&frame, &bank, 36) > family(&ordinary, &plain, 36),
        "dense sampling reaches submission"
    );
    let mut swollen = client(&bank, 27, 255);
    let mut ordinary = swollen.clone();
    let swollen = render::prepare(&mut swollen, &mut bank, [960, 540], 1., 2, quality())
        .unwrap()
        .frame;
    let ordinary = render::prepare(&mut ordinary, &mut plain, [960, 540], 1., 2, quality())
        .unwrap()
        .frame;
    let width = |frame: &slither_wgpu_slice::frame::Frame, bank: &Bank| {
        frame
            .draws
            .iter()
            .filter(|d| {
                bank.bodies[25]
                    .variants
                    .iter()
                    .any(|v| bank.assets[v.asset] == d.asset)
            })
            .map(|d| d.destination.width)
            .fold(0., f64::max)
    };
    assert!(
        width(&swollen, &bank) > width(&ordinary, &plain),
        "swell reaches submission"
    );
}

#[test]
fn wire_markers_never_select_an_own_or_remote_accessory() {
    let mut bank = Bank::new().unwrap();
    for own in [None, Some(30)] {
        bank.cosmetics = Some(cosmetics(own));
        for marker in [0, 30] {
            let mut c = client(&bank, 0, marker);
            let mut remote = spawn(0, marker);
            remote[2] = 8;
            let mut packet = (remote.len() as u16).to_be_bytes().to_vec();
            packet.extend(remote);
            c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
                &packet,
                ElapsedHeader::Absent,
                |a, context| {
                    Ok(bank
                        .cosmetics
                        .as_ref()
                        .unwrap()
                        .appearance(a, context.own)
                        .unwrap())
                },
            )
            .unwrap();
            for (token, _, _, _) in c.snake_objects() {
                assert_eq!(
                    c.static_accessory_geometry(token).is_some(),
                    Some(token) == c.own_token() && own.is_some()
                );
            }
            let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality())
                .unwrap()
                .frame;
            if let Some(source) = bank.cosmetics.as_ref().unwrap().accessory(true) {
                assert_eq!(
                    frame
                        .draws
                        .iter()
                        .filter(|d| d.asset == source.asset)
                        .count(),
                    1
                );
            }
            assert!(bank.cosmetics.as_ref().unwrap().accessory(false).is_none());
            bank.resources(&frame).unwrap();
        }
    }
}

#[test]
fn missing_and_corrupt_native_images_preserve_play_and_other_cosmetics() {
    use slither_wgpu_slice::game::LocalGame;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    let directory = std::env::temp_dir().join(format!(
        "synthetic-cosmetic-startup-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&directory).unwrap();
    let bytes = png(8, 8);
    for path in cosmetics::paths() {
        let file = directory.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, &bytes).unwrap();
    }
    for failed in [
        "s/a_hardhat.png",
        "s/jmou3.png",
        "s/kwk6.png",
        "s2/sest5.png",
    ] {
        for corrupt in [false, true] {
            if corrupt {
                fs::write(directory.join(failed), b"corrupt synthetic image").unwrap();
            } else {
                fs::remove_file(directory.join(failed)).unwrap();
            }
            let mut game = LocalGame::new(0.).unwrap();
            game.configure_cosmetics(Cosmetics::directory(&directory, Some(31)).unwrap())
                .unwrap();
            assert!(game.can_play());
            game.play("ws://127.0.0.1:19491/slither", "Synthetic", 0)
                .unwrap();
            game.begin_frame(1., [960, 540], 1.).unwrap();
            assert!(game.take_frame().is_some());
            let sources = game.bank.cosmetics.as_ref().unwrap();
            assert!(sources.role(SkinSourceRole::PlayBulb).is_some());
            if failed == "s/a_hardhat.png" {
                assert!(sources.accessory(true).is_none());
            }
            if failed == "s/jmou3.png" {
                assert!(matches!(
                    sources.skin(40, &[]).unwrap().face,
                    FaceGeometry::Paired(_)
                ));
            }
            if failed == "s/kwk6.png" {
                assert!(sources.skin(37, &[]).unwrap().antenna.is_none());
            }
            if failed == "s2/sest5.png" {
                assert_eq!(
                    sources.skin(41, &[]).unwrap().face_sources,
                    SkinFaceSources::None
                );
            }
            for skin in [0, 37, 40, 41, 42] {
                let mut world = client(&game.bank, skin, 30);
                let frame =
                    render::prepare(&mut world, &mut game.bank, [960, 540], 1., 2, quality())
                        .unwrap()
                        .frame;
                game.bank.resources(&frame).unwrap();
            }
            fs::write(directory.join(failed), &bytes).unwrap();
        }
    }
    // This exact, newly created synthetic directory is the sole cleanup target.
    assert!(
        directory
            .canonicalize()
            .unwrap()
            .starts_with(std::env::temp_dir().canonicalize().unwrap())
    );
    fs::remove_dir_all(directory).unwrap();
}

#[test]
#[cfg(windows)]
fn named_plain_and_image_faces_resolve_text_and_cosmetics_together() {
    use slither_wgpu_slice::bank::{HANDLE_NAMESPACE_SIZE, TEXT_HANDLE_BASE};
    for skin in [0, 40] {
        let mut bank = Bank::new().unwrap();
        bank.cosmetics = Some(cosmetics(Some(30)));
        let mut c = client_named(&bank, skin, 255, "Named snake");
        let prepared = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality()).unwrap();
        let text = prepared
            .frame
            .draws
            .iter()
            .find(|d| {
                (TEXT_HANDLE_BASE..TEXT_HANDLE_BASE + HANDLE_NAMESPACE_SIZE)
                    .contains(&d.asset.handle)
            })
            .expect("nickname texture");
        let cosmetics = bank.cosmetics.as_ref().unwrap();
        let image = if skin == 40 {
            cosmetics.role(SkinSourceRole::Mouth).unwrap()
        } else {
            cosmetics.accessory(true).unwrap().asset
        };
        let cosmetic = prepared
            .frame
            .draws
            .iter()
            .find(|d| d.asset == image)
            .unwrap();
        assert!(!cosmetic.black_effect);
        assert!(!text.black_effect);
        assert_ne!(text.asset.handle, image.handle);
        for asset in [text.asset, image] {
            assert_eq!(
                prepared
                    .resources
                    .iter()
                    .filter(|r| r.asset == asset)
                    .count(),
                1
            );
        }
        let resident = prepared
            .resources
            .iter()
            .map(|r| (r.asset.into(), r.asset))
            .collect();
        assert!(prepared.frame.quads(&resident).is_ok());
    }
}

fn crowd_client(bank: &Bank, skin: u8) -> AnimatedClient {
    let packets: Vec<_> = std::iter::once(setup())
        .chain((1u16..=100).map(|id| {
            let mut packet = spawn(skin, 255);
            packet[1..3].copy_from_slice(&id.to_be_bytes());
            // Short contiguous bodies keep this focused on eye draw cost.
            packet[16..19].copy_from_slice(&u24(4880));
            packet.truncate(31);
            packet.extend([0, 0]);
            named(packet, &format!("Player{id}"))
        }))
        .chain(std::iter::once(vec![b'M', 0, 8, 64]))
        .flat_map(|packet| {
            let mut out = (packet.len() as u16).to_be_bytes().to_vec();
            out.extend(packet);
            out
        })
        .collect();
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_minimap_tracking().unwrap();
    c.enable_nicknames().unwrap();
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &packets,
        ElapsedHeader::Absent,
        |appearance, context| {
            Ok(bank
                .cosmetics
                .as_ref()
                .unwrap()
                .appearance(appearance, context.own)
                .unwrap())
        },
    )
    .unwrap();
    c.advance(100., false).unwrap();
    c.observe_minimap_ui_fraction(1.).unwrap();
    c
}

#[test]
fn hundred_alive_outlined_snakes_with_hud_and_minimap_fit_the_draw_budget() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    let mut c = crowd_client(&bank, 41);
    let prepared = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality()).unwrap();
    assert_eq!(c.nickname_draws().len(), 100);
    #[cfg(windows)]
    assert_eq!(
        prepared
            .frame
            .draws
            .iter()
            .filter(|d| d.asset.handle >> 60 == 4)
            .count(),
        100
    );
    assert_eq!(prepared.frame.snakes.len(), 100);
    assert!(
        prepared
            .frame
            .snakes
            .iter()
            .all(|s| s.viewport_body_commands > 0)
    );
    let white = bank.disk([255; 3]).unwrap();
    let eyes: Vec<_> = prepared
        .frame
        .draws
        .iter()
        .filter(|d| d.asset == white)
        .collect();
    assert_eq!(eyes.len(), 200);
    assert!(eyes.iter().all(|d| d.effective_alpha == 1.));
    finish_crowd(prepared, &mut bank);
}

#[test]
fn antenna_crowd_skips_whole_antennas_and_preserves_hud_and_minimap() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    let mut c = crowd_client(&bank, 37);
    let prepared = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality()).unwrap();
    assert_eq!(prepared.frame.snakes.len(), 100);
    assert!(
        prepared
            .frame
            .snakes
            .iter()
            .all(|s| s.viewport_body_commands > 0)
    );
    let bulb = bank
        .cosmetics
        .as_ref()
        .unwrap()
        .role(SkinSourceRole::KwkBulb)
        .unwrap();
    let admitted = prepared
        .frame
        .draws
        .iter()
        .filter(|d| d.asset == bulb)
        .count();
    assert!((1..100).contains(&admitted), "admitted {admitted} antennas");
    finish_crowd(prepared, &mut bank);
}

fn finish_crowd(prepared: render::PreparedFrame, bank: &mut Bank) {
    let view = hud::View {
        playing: true,
        opacity: HudOpacity {
            readout: 1.,
            header: 1.,
            rows: 1.,
            announcement: 1.,
        },
        status: "CONNECTED".into(),
        score: "10000".into(),
        final_score: String::new(),
        rank: "1".into(),
        population: "100".into(),
        rows: (1..=10)
            .map(|ordinal| LeaderboardRow {
                ordinal,
                number_text: format!("#{ordinal}"),
                score: 10000.,
                score_text: "10000".into(),
                name_text: format!("Player{ordinal}"),
                css_color: "#ffffff",
                own: ordinal == 1,
                opacity_request: 1.,
            })
            .collect(),
        message: None,
    };
    let prepared = render::finish_hud(prepared, bank, &view).unwrap();
    assert!(
        prepared
            .frame
            .draws
            .iter()
            .any(|d| d.asset.handle >> 60 == 5)
    );
    assert_eq!(
        prepared
            .frame
            .draws
            .iter()
            .filter(|d| d.asset == bank.hud.asset)
            .count(),
        2
    );
    assert!(prepared.frame.draws.len() <= MAX_DRAWS);
    let resident = prepared
        .resources
        .iter()
        .map(|r| (r.asset.into(), r.asset))
        .collect();
    assert!(prepared.frame.quads(&resident).is_ok());
}

#[test]
fn dying_skin_41_outline_does_not_cover_the_eye_interior() {
    use slither_wgpu_slice::frame::Draw;
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    let mut c = client(&bank, 41, 255);
    let token = c.own_token().unwrap();
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &[0, 4, b's', 0, 7, 1],
        ElapsedHeader::Absent,
        |_, _| unreachable!(),
    )
    .unwrap();
    for tick in 1..=30 {
        c.advance(100. + f64::from(tick) * 50., false).unwrap();
        if c.snake_object(token).unwrap().metrics().death_progress >= 0.65 {
            break;
        }
    }
    let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1, quality())
        .unwrap()
        .frame;
    let white = bank.disk([255; 3]).unwrap();
    let black = bank.disk([0; 3]).unwrap();
    let ring = bank.solid([0; 3]);
    let eye_index = frame.draws.iter().position(|d| d.asset == white).unwrap();
    let eye = &frame.draws[eye_index];
    let pupil = &frame.draws[eye_index + 1];
    let center = |d: &Draw| {
        [
            d.destination.x + d.destination.width / 2.,
            d.destination.y + d.destination.height / 2.,
        ]
    };
    let e = center(eye);
    let p = center(pupil);
    let distance = (e[0] - p[0]).hypot(e[1] - p[1]);
    let direction = if distance > 0. {
        [(e[0] - p[0]) / distance, (e[1] - p[1]) / distance]
    } else {
        [1., 0.]
    };
    let radius = eye.destination.width / 2.;
    let stroke = 3. * c.camera().zoom();
    let inner = radius - stroke / 2.;
    let sample = [
        e[0] + direction[0] * inner * 0.9,
        e[1] + direction[1] * inner * 0.9,
    ];
    let resources = bank.resources(&frame).unwrap();
    let mut alpha = 0.;
    // The background reuses the black solid; measure the eye scope after it.
    let outline_start = frame
        .draws
        .iter()
        .position(|d| d.asset == ring && d.corners.is_some())
        .unwrap();
    for draw in frame
        .draws
        .iter()
        .skip(outline_start)
        .filter(|d| [white, black, ring].contains(&d.asset))
    {
        let coverage = if let Some(corners) = draw.corners {
            let crosses: Vec<_> = (0..4)
                .map(|i| {
                    let a = corners[i];
                    let b = corners[(i + 1) % 4];
                    (b[0] - a[0]) * (sample[1] - a[1]) - (b[1] - a[1]) * (sample[0] - a[0])
                })
                .collect();
            f64::from(crosses.iter().all(|v| *v >= 0.) || crosses.iter().all(|v| *v <= 0.))
        } else {
            let d = draw.destination;
            let u = (sample[0] - d.x) / d.width;
            let v = (sample[1] - d.y) / d.height;
            if !(0. ..1.).contains(&u) || !(0. ..1.).contains(&v) {
                0.
            } else {
                let image = &resources
                    .iter()
                    .find(|r| r.asset == draw.asset)
                    .unwrap()
                    .image;
                let x = (u * f64::from(image.width)) as usize;
                let y = (v * f64::from(image.height)) as usize;
                f64::from(image.pixels[(y * image.width as usize + x) * 4 + 3]) / 255.
            }
        };
        let a = coverage * draw.effective_alpha;
        alpha = a + alpha * (1. - a);
    }
    assert!((0.2..0.8).contains(&eye.effective_alpha));
    assert!(
        (alpha - eye.effective_alpha).abs() < 1e-12,
        "interior alpha {alpha}, eye fill {}",
        eye.effective_alpha
    );
    let first_ring = &frame.draws[outline_start];
    let corner = first_ring.corners.unwrap()[0];
    assert!(((corner[0] - e[0]).hypot(corner[1] - e[1]) - radius - stroke / 2.).abs() < 1e-10);
}
