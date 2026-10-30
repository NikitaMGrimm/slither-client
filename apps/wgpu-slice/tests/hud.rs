//! Original synthetic HUD data and actual CPU bitmap/ordered-frame contracts; no GPU/host.
use slither_client::presentation::{BodyAssetStatus, BodyBlend, BodyRect, LeaderboardRow};
use slither_wgpu_slice::{
    bank::Bank,
    frame::{Draw, Frame},
    hud::{self, Line, Role, View},
    render,
};
fn row(i: usize) -> LeaderboardRow {
    LeaderboardRow {
        ordinal: i,
        number_text: format!("#{i}"),
        score: 12345.,
        score_text: "12345".into(),
        name_text: format!("Player{i}"),
        css_color: "#ffffff",
        own: i == 5,
        opacity_request: 1.,
    }
}
fn view() -> View {
    View {
        playing: true,
        opacity: slither_client::presentation::HudOpacity {
            readout: 1.,
            header: 0.85,
            rows: 1.,
            announcement: 1.,
        },
        status: "CONNECTED".into(),
        score: "10000".into(),
        final_score: "9000".into(),
        rank: "5".into(),
        population: "100".into(),
        rows: (1..=10).map(row).collect(),
        message: None,
    }
}
fn rect_contains(r: BodyRect, x: f64, y: f64) -> bool {
    x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}
#[test]
fn ordinary_layout_has_ten_exact_rows_and_keeps_scene_center_clear() {
    let v = view();
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    assert_eq!(p.glyph_scale, 1);
    assert_eq!(p.panels.len(), 2);
    let board = p
        .panels
        .iter()
        .find(|p| p.role == Role::Leaderboard)
        .unwrap();
    let rows: Vec<_> = board
        .lines
        .iter()
        .filter_map(|l| if let Line::Row(r) = l { Some(r) } else { None })
        .collect();
    assert_eq!(rows, v.rows.iter().collect::<Vec<_>>());
    assert!(rows[4].own);
    for panel in &p.panels {
        assert!(!rect_contains(panel.destination, 480., 270.));
    }
    let score = p.panels.iter().find(|p| p.role == Role::Score).unwrap();
    assert!(score.lines.contains(&Line::Current("10000".into())));
    assert!(
        !score
            .lines
            .iter()
            .any(|l| matches!(l, Line::Final(_) | Line::Status(_)))
    );
    assert!(score.lines.contains(&Line::Rank {
        rank: "5".into(),
        population: "100".into()
    }));
}
#[test]
fn all_extents_and_fractional_dpr_bound_the_atlas_panels_and_work() {
    let v = view();
    for extent in [
        [0, 0],
        [0, 540],
        [32, 24],
        [64, 48],
        [160, 120],
        [320, 200],
        [640, 80],
        [640, 100],
        [960, 120],
        [640, 360],
        [960, 540],
        [1920, 1080],
        [8192, 8192],
    ] {
        for scale in [1., 1.25, 2., 4., 32.] {
            let p = hud::plan(&v, extent, scale).unwrap();
            let mut resource = hud::resource();
            hud::rasterize(&p, &mut resource).unwrap();
            assert!(p.extent.iter().all(|n| *n <= 512));
            assert!(resource.image.pixels.len() <= 512 * 512 * 4);
            for panel in &p.panels {
                let r = panel.destination;
                assert!(r.x >= 0. && r.y >= 0.);
                assert!(r.x + r.width <= f64::from(extent[0]) / scale);
                assert!(r.y + r.height <= f64::from(extent[1]) / scale);
            }
            assert!(
                resource
                    .image
                    .pixels
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .all(|p| p[..3].iter().all(|c| *c <= p[3]))
            );
        }
    }
    for scale in [0., -1., f64::NAN, f64::INFINITY, 1e-300] {
        assert!(hud::plan(&v, [960, 540], scale).is_err());
    }
    assert!(hud::plan(&v, [8193, 540], 1.).is_err());
}
#[test]
fn constrained_height_reduces_rows_in_order_and_tiny_views_submit_none() {
    let v = view();
    let p = hud::plan(&v, [640, 120], 1.).unwrap();
    let ids: Vec<_> = p
        .panels
        .iter()
        .flat_map(|p| &p.lines)
        .filter_map(|l| {
            if let Line::Row(r) = l {
                Some(r.ordinal)
            } else {
                None
            }
        })
        .collect();
    assert!(!ids.is_empty() && ids.len() < 10);
    assert_eq!(ids, (1..=ids.len()).collect::<Vec<_>>());
    assert_eq!(hud::plan(&v, [320, 200], 1.).unwrap().panels.len(), 2);
    for extent in [[32, 32], [0, 540], [1920, 1080]] {
        let scale = if extent[0] == 1920 { 64. } else { 1. };
        assert!(hud::plan(&v, extent, scale).unwrap().panels.is_empty());
    }
}
#[test]
fn names_are_clipped_without_overwriting_stable_score_columns() {
    let mut a = view();
    let p = hud::plan(&a, [960, 540], 1.).unwrap();
    let mut before = hud::resource();
    hud::rasterize(&p, &mut before).unwrap();
    a.rows[0].name_text = "Z".repeat(255);
    a.rows[0].score = -0.;
    a.rows[0].score_text = "12345".into();
    let after_plan = hud::plan(&a, [960, 540], 1.).unwrap();
    let mut after = hud::resource();
    hud::rasterize(&after_plan, &mut after).unwrap();
    let panel = p
        .panels
        .iter()
        .find(|p| p.role == Role::Leaderboard)
        .unwrap();
    let s = p.glyph_scale;
    let cols = (panel.size[0] - 8) / (6 * s);
    let start = panel.origin[0] + 4 + (cols - hud::SCORE_CELLS) * 6 * s;
    for y in panel.origin[1]..panel.origin[1] + panel.size[1] {
        for x in start..panel.origin[0] + panel.size[0] {
            let i = ((y * p.extent[0] + x) * 4) as usize;
            assert_eq!(
                &before.image.pixels[i..i + 4],
                &after.image.pixels[i..i + 4]
            );
        }
    }
    let projected = after_plan
        .panels
        .iter()
        .flat_map(|p| &p.lines)
        .find_map(|l| if let Line::Row(r) = l { Some(r) } else { None })
        .unwrap();
    assert_eq!(projected.name_text.len(), 255);
    assert_eq!(projected.score.to_bits(), (-0_f64).to_bits());
    assert_eq!(projected.score_text, "12345");
}
#[test]
fn own_name_emphasis_changes_only_its_row_and_unicode_has_explicit_fallback() {
    let mut v = view();
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    let mut own = hud::resource();
    hud::rasterize(&p, &mut own).unwrap();
    v.rows[4].own = false;
    let mut plain = hud::resource();
    hud::rasterize(&hud::plan(&v, [960, 540], 1.).unwrap(), &mut plain).unwrap();
    let panel = p
        .panels
        .iter()
        .find(|p| p.role == Role::Leaderboard)
        .unwrap();
    let y = panel.origin[1] + 4 + 5 * 9 * p.glyph_scale;
    for row in 0..p.extent[1] {
        for x in 0..p.extent[0] {
            let i = ((row * p.extent[0] + x) * 4) as usize;
            if own.image.pixels[i..i + 4] != plain.image.pixels[i..i + 4] {
                assert!((y - 1..y - 1 + 9 * p.glyph_scale).contains(&row));
            }
        }
    }
    assert_ne!(own.image.pixels, plain.image.pixels);
    let mut a = hud::resource();
    let mut b = hud::resource();
    hud::rasterize(&hud::plan_text("é🙂", [640, 360], 1.).unwrap(), &mut a).unwrap();
    hud::rasterize(&hud::plan_text("??", [640, 360], 1.).unwrap(), &mut b).unwrap();
    assert_eq!(a.image.pixels, b.image.pixels);
}
#[test]
fn resource_revisions_track_visible_bytes_and_dimensions_atomically() {
    let mut v = view();
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    let mut r = hud::resource();
    hud::rasterize(&p, &mut r).unwrap();
    let first = r.clone();
    hud::rasterize(&p, &mut r).unwrap();
    assert_eq!(r.asset, first.asset);
    hud::rasterize(&hud::plan(&v, [1000, 600], 1.).unwrap(), &mut r).unwrap();
    assert_eq!(r.asset, first.asset); // Position-only changes need no new texture.
    v.rows[8].score_text = "98765".into();
    hud::rasterize(&hud::plan(&v, [960, 540], 1.).unwrap(), &mut r).unwrap();
    assert!(r.asset.revision > first.asset.revision);
    let before = r.clone();
    hud::rasterize(&hud::plan(&v, [0, 0], 1.).unwrap(), &mut r).unwrap();
    assert_eq!(r.asset, before.asset);
    assert_eq!(r.image.pixels, before.image.pixels);
    hud::rasterize(&hud::plan(&v, [300, 120], 1.).unwrap(), &mut r).unwrap();
    assert!(r.asset.revision > before.asset.revision);
    assert_ne!(
        [r.asset.width, r.asset.height],
        [before.asset.width, before.asset.height]
    );
    r.asset.revision = u64::MAX;
    let saved = r.clone();
    v.score = "123".into();
    assert!(hud::rasterize(&hud::plan(&v, [960, 540], 1.).unwrap(), &mut r).is_err());
    assert_eq!(r.asset, saved.asset);
    assert_eq!(r.image.pixels, saved.image.pixels);
    let mut invalid = p;
    invalid.extent = [513, 512];
    assert!(hud::rasterize(&invalid, &mut r).is_err());
    assert_eq!(r.asset, saved.asset);
}
#[test]
fn signed_safe_integer_columns_retain_the_exact_rust_score_text() {
    let mut v = view();
    for score in [-9_007_199_254_740_991., 9_007_199_254_740_991., -0.] {
        let text = slither_client::presentation::hud_score_text(score).unwrap();
        assert!(text.chars().count() <= 17);
        v.rows[0].score = score;
        v.rows[0].score_text = text.clone();
        v.score = text.clone();
        v.final_score = text.clone();
        let p = hud::plan(&v, [960, 540], 1.).unwrap();
        let mut target = hud::resource();
        hud::rasterize(&p, &mut target).unwrap();
        let row = p
            .panels
            .iter()
            .flat_map(|p| &p.lines)
            .find_map(|l| if let Line::Row(r) = l { Some(r) } else { None })
            .unwrap();
        assert_eq!(row.score_text, text);
        assert_eq!(row.score.to_bits(), score.to_bits());
        assert!(p.panels[0].lines.contains(&Line::Current(text.clone())));
        assert!(
            !p.panels[0]
                .lines
                .iter()
                .any(|l| matches!(l, Line::Final(_)))
        );
    }
    let nan = f64::from_bits(0x7ff8_0000_0000_0123);
    v.rows[0].score = nan;
    v.rows[0].score_text = "NaN".into();
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    let row = p
        .panels
        .iter()
        .flat_map(|p| &p.lines)
        .find_map(|l| if let Line::Row(r) = l { Some(r) } else { None })
        .unwrap();
    assert_eq!(row.score.to_bits(), nan.to_bits());
    assert_eq!(row.score_text, "NaN");
}
#[test]
fn ordinary_composition_preserves_body_order_and_uses_two_cropped_panels() {
    let mut bank = Bank::new().unwrap();
    let asset = bank.solid([255, 0, 0]);
    let draw = Draw {
        corners: None,
        asset,
        source: None,
        destination: BodyRect {
            x: 100.,
            y: 100.,
            width: 5.,
            height: 5.,
        },
        translation: [0., 0.],
        rotation: 0.,
        effective_alpha: 0.5,
        blend: BodyBlend::Lighter,
    };
    let frame = Frame {
        identity: 53,
        tick: 20,
        extent: [960, 540],
        viewport_scale: 1.,
        draws: vec![draw.clone()],
    };
    let resources = bank.resources(&frame).unwrap();
    let result = render::finish_hud(
        render::PreparedFrame { frame, resources },
        &mut bank,
        &view(),
    )
    .unwrap();
    assert_eq!(result.frame.identity, 53);
    assert_eq!(result.frame.draws[0], draw);
    assert_eq!(result.frame.draws.len(), 3);
    assert!(result.frame.draws[1..].iter().all(|d| d.source.is_some()
        && d.asset == bank.hud.asset
        && d.asset.status == BodyAssetStatus::Ready
        && d.blend == BodyBlend::SourceOver));
    let resident = result
        .resources
        .iter()
        .map(|r| (r.asset.into(), r.asset))
        .collect();
    assert_eq!(result.frame.quads(&resident).unwrap().len(), 3);
}

#[test]
fn normalized_name_spaces_keep_their_blank_glyph_and_projected_text() {
    let mut ordinary = view();
    ordinary.rows[0].name_text = "Two words".into();
    let mut normalized = ordinary.clone();
    normalized.rows[0].name_text = "Two\u{a0}words".into();
    let plan = hud::plan(&normalized, [960, 540], 1.).unwrap();
    let name = plan
        .panels
        .iter()
        .flat_map(|p| &p.lines)
        .find_map(|line| {
            if let Line::Row(row) = line {
                Some(&row.name_text)
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(name, "Two\u{a0}words");
    let mut expected = hud::resource();
    let mut actual = hud::resource();
    hud::rasterize(
        &hud::plan(&ordinary, [960, 540], 1.).unwrap(),
        &mut expected,
    )
    .unwrap();
    hud::rasterize(&plan, &mut actual).unwrap();
    assert_eq!(actual.image.pixels, expected.image.pixels);
}

#[test]
fn fixed_logical_layout_keeps_ten_rows_on_small_windows_and_at_double_dpr() {
    let v = view();
    let ordinary = hud::plan(&v, [960, 540], 1.).unwrap();
    assert_eq!(ordinary, hud::plan(&v, [1920, 1080], 2.).unwrap());
    for extent in [[640, 360], [400, 700]] {
        let p = hud::plan(&v, extent, 1.).unwrap();
        let board = p
            .panels
            .iter()
            .find(|p| p.role == Role::Leaderboard)
            .unwrap();
        assert_eq!(
            board
                .lines
                .iter()
                .filter(|l| matches!(l, Line::Row(_)))
                .count(),
            10
        );
    }
}

#[test]
fn projected_row_color_opacity_and_lifecycle_alpha_reach_the_rendered_frame() {
    let mut v = view();
    v.rows[0].css_color = "#80d0d0";
    v.rows[0].opacity_request = 0.5;
    v.opacity.readout = 0.25;
    v.opacity.rows = 0.4;
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    let mut r = hud::resource();
    hud::rasterize(&p, &mut r).unwrap();
    let board = p
        .panels
        .iter()
        .find(|p| p.role == Role::Leaderboard)
        .unwrap();
    let top = board.origin[1] + 4 + 9;
    let colors = r.image.pixels.as_chunks::<4>().0;
    let row = &colors[(top * p.extent[0]) as usize..((top + 7) * p.extent[0]) as usize];
    assert!(row.contains(&[64, 104, 104, 128]));
    assert!(row.iter().all(|c| c[3] == 0 || *c == [64, 104, 104, 128]));
    let mut bank = Bank::new().unwrap();
    let frame = Frame {
        identity: 1,
        tick: 0,
        extent: [960, 540],
        viewport_scale: 1.,
        draws: vec![],
    };
    let resources = bank.resources(&frame).unwrap();
    let out =
        render::finish_hud(render::PreparedFrame { frame, resources }, &mut bank, &v).unwrap();
    assert_eq!(
        out.frame
            .draws
            .iter()
            .map(|d| d.effective_alpha)
            .collect::<Vec<_>>(),
        vec![0.25, 0.4]
    );
}

#[test]
fn final_readout_is_separate_from_active_gameplay() {
    let mut v = view();
    v.playing = false;
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    assert!(p.panels[0].lines.contains(&Line::Final("9000".into())));
    assert!(
        !p.panels[0]
            .lines
            .iter()
            .any(|l| matches!(l, Line::Current(_) | Line::Rank { .. }))
    );
    v.playing = true;
    v.score = "--".into();
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    assert_eq!(p.panels.len(), 1);
    assert_eq!(p.panels[0].role, Role::Leaderboard);
}

#[test]
fn readout_fields_have_their_own_premultiplied_opacity_before_lifecycle_fading() {
    let mut v = view();
    v.rows.clear();
    v.opacity.readout = 0.5;
    let p = hud::plan(&v, [960, 540], 1.).unwrap();
    let mut r = hud::resource();
    hud::rasterize(&p, &mut r).unwrap();
    let pixels = r.image.pixels.as_chunks::<4>().0;
    let check = |x: u32, y: u32, width: u32, expected: [u8; 4]| {
        let visible: Vec<_> = (y..y + 7)
            .flat_map(|y| (x..x + width).map(move |x| pixels[(y * p.extent[0] + x) as usize]))
            .filter(|pixel| pixel[3] != 0)
            .collect();
        assert!(!visible.is_empty());
        assert!(
            visible.iter().all(|pixel| *pixel == expected),
            "{visible:?}"
        );
    };
    check(4, 4, 13 * 6, [102; 4]); // Length label: 0.4.
    check(4 + 13 * 6, 4, 20 * 6, [204; 4]); // Length value: 0.8.
    check(4, 13, 11 * 6, [77; 4]); // Rank label: 0.3.
    check(4 + 11 * 6, 13, 9 * 6, [89; 4]); // Rank value: 0.35.
    check(4 + 20 * 6, 13, 4 * 6, [77; 4]); // Separator: 0.3.
    check(4 + 24 * 6, 13, 9 * 6, [89; 4]); // Population: 0.35.
    assert_eq!(p.panels[0].opacity, 0.5);
}

#[test]
fn narrow_short_board_reserves_the_readout_height_only_when_columns_overlap() {
    let v = view();
    for (extent, dpr) in [
        ([320, 180], 1.),
        ([640, 360], 2.),
        ([320, 200], 1.),
        ([320, 120], 1.),
    ] {
        let p = hud::plan(&v, extent, dpr).unwrap();
        let score = p.panels.iter().find(|p| p.role == Role::Score).unwrap();
        let board = p
            .panels
            .iter()
            .find(|p| p.role == Role::Leaderboard)
            .unwrap();
        assert!(board.destination.x < score.destination.x + score.destination.width);
        assert!(board.destination.y + board.destination.height <= score.destination.y);
        let count = board
            .lines
            .iter()
            .filter(|l| matches!(l, Line::Row(_)))
            .count();
        assert!(count > 0 && count < 10);
    }
    let wide = hud::plan(&v, [960, 180], 1.).unwrap();
    assert_eq!(wide.panels[1].lines.len(), 11);
}
