//! ORIGINAL SYNTHETIC images and packets. No external artwork, sockets or GPU.
use slither_client::{presentation::*, protocol::ElapsedHeader};
use slither_wgpu_slice::{
    bank::Bank,
    cosmetics::{self, Cosmetics, Images},
    render,
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
    let packets: Vec<_> = [setup(), spawn(skin, accessory)]
        .into_iter()
        .flat_map(|p| {
            let mut out = (p.len() as u16).to_be_bytes().to_vec();
            out.extend(p);
            out
        })
        .collect();
    let mut c = AnimatedClient::new(0.).unwrap();
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
    assert!(Cosmetics::from_images(images, None).is_err());
}

#[test]
fn every_stock_skin_prepares_and_binds_only_its_active_resources() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    for skin in 0..=65 {
        let mut c = client(&bank, skin, 255);
        let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1).unwrap();
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
fn all_accessories_use_retained_attachment_and_own_choice_overrides_wire_marker() {
    let mut bank = Bank::new().unwrap();
    bank.cosmetics = Some(cosmetics(None));
    for id in 0..32 {
        let mut c = client(&bank, 0, id);
        let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1).unwrap();
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
            .accessory(true, id)
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
    render::prepare(&mut c, &mut bank, [960, 540], 1., 1).unwrap();
    let first = c.antenna_snapshot(token).unwrap();
    let removal = [0, 4, b's', 0, 7, 1];
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &removal,
        ElapsedHeader::Absent,
        |_, _| unreachable!(),
    )
    .unwrap();
    c.advance(200., false).unwrap();
    let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 2).unwrap();
    assert_ne!(first, c.antenna_snapshot(token).unwrap());
    let bulb = bank
        .cosmetics
        .as_ref()
        .unwrap()
        .role(SkinSourceRole::KwkBulb);
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
    let frame = render::prepare(&mut c, &mut bank, [960, 540], 1., 1).unwrap();
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
    let ordinary = render::prepare(&mut ordinary, &mut plain, [960, 540], 1., 1).unwrap();
    assert!(
        family(&frame, &bank, 36) > family(&ordinary, &plain, 36),
        "dense sampling reaches submission"
    );
    let mut swollen = client(&bank, 27, 255);
    let mut ordinary = swollen.clone();
    let swollen = render::prepare(&mut swollen, &mut bank, [960, 540], 1., 2).unwrap();
    let ordinary = render::prepare(&mut ordinary, &mut plain, [960, 540], 1., 2).unwrap();
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
