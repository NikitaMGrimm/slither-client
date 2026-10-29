//! Original standard-material numeric witnesses. No browser or external input is executed.
use slither_client::authored_sources::{CanvasRecipe, PaintCommand, authored_source_recipes};
fn pixel(recipe: &CanvasRecipe, x: usize, y: usize) -> [u8; 4] {
    let PaintCommand::Pixels { width, rgba, .. } = &recipe.commands[0] else {
        panic!("owned sample tape required")
    };
    rgba[(y * (*width as usize) + x) * 4..][..4]
        .try_into()
        .unwrap()
}
#[test]
fn standard_pool_uses_independent_palette_ids_and_native_source_extents() {
    let p = authored_source_recipes();
    assert_eq!(p.palette_rgb.len(), 42);
    assert_eq!(p.palette_rgb[0], [192, 128, 255]);
    assert_eq!(p.palette_rgb[3], [128, 255, 128]);
    assert_eq!(p.palette_rgb[39], [104, 40, 170]);
    assert_eq!(p.palette_rgb[41], [128, 128, 255]);
    assert_eq!(p.palettes.len(), 3);
    assert_eq!(p.body_sources.palettes.len(), 42);
    for (id, family) in p.body_sources.palettes.iter().enumerate() {
        assert_eq!(family.variants.len(), if id == 36 { 60 } else { 7 });
        assert!(
            family
                .variants
                .iter()
                .all(|v| v.width == 48 && v.height == 48)
        );
        assert_eq!(
            (family.boost_glow.width, family.boost_glow.height),
            (62, 62)
        );
    }
    assert_eq!(
        (
            p.body_sources.outline.width,
            p.body_sources.shadow.width,
            p.body_sources.death_highlight.width
        ),
        (52, 62, 32)
    );
    assert_eq!(
        (
            p.food.len(),
            p.food[0].count,
            p.prey.len(),
            p.prey[0].bodies.len(),
            p.prey[0].glows.len()
        ),
        (10, 17, 9, 22, 17)
    );
}
#[test]
fn ordinary_material_samples_and_ring_effects_have_known_independent_values() {
    let p = authored_source_recipes();
    let b = &p.body_sources;
    assert_eq!(
        pixel(&b.palettes[0].variants[0], 24, 24),
        [234, 156, 255, 255]
    );
    assert_eq!(
        pixel(&b.palettes[0].variants[3], 24, 24),
        [192, 128, 255, 255]
    );
    assert_eq!(
        pixel(&b.palettes[0].variants[6], 24, 24),
        [149, 99, 198, 255]
    );
    assert_eq!(
        pixel(&b.palettes[0].boost_glow, 31, 31),
        [120, 80, 159, 255]
    );
    assert_eq!(pixel(&b.outline, 26, 26), [0, 0, 0, 0]);
    assert_eq!(pixel(&b.outline, 42, 26), [0, 0, 0, 204]);
    assert_eq!(pixel(&b.shadow, 46, 34), [0, 0, 0, 63]);
    for id in [10, 19, 20] {
        assert!(
            b.palettes[id].variants[0]
                .commands
                .iter()
                .any(|c| matches!(c, PaintCommand::LineTo(_)))
        );
    }
    assert_ne!(
        pixel(&b.palettes[36].variants[0], 24, 24),
        pixel(&b.palettes[36].variants[30], 24, 24)
    );
}
#[test]
fn food_and_prey_sizes_glows_and_shadows_use_the_standard_material_contract() {
    let p = authored_source_recipes();
    assert_eq!(p.food[0].bodies[0].width, 4);
    assert_eq!(p.food[0].glows[0].width, 29);
    assert_eq!(p.food[0].outlines[0].width, 26);
    assert_eq!(p.food[0].bodies[16].width, 25);
    assert_eq!(p.prey[0].bodies[0].width, 44);
    assert_eq!(p.prey[0].bodies[21].width, 86);
    assert!(matches!(
        p.prey[0].bodies[0].commands[0],
        PaintCommand::Shadow {
            blur: 22.,
            offset_y: 0.,
            ..
        }
    ));
    assert_eq!(
        p.prey[0].bodies[0]
            .commands
            .iter()
            .filter(|c| matches!(c, PaintCommand::Fill))
            .count(),
        2
    );
    assert_eq!(p.prey[0].glows, p.food[0].glows);
}
#[test]
fn hexagons_preserve_nested_column_row_layer_and_operand_order() {
    let tile = authored_source_recipes().tile;
    assert_eq!(tile.commands.len(), 600);
    assert_eq!(
        &tile.commands[..10],
        &[
            PaintCommand::FillStyle("#09131d".into()),
            PaintCommand::BeginPath,
            PaintCommand::MoveTo([45., -84.75]),
            PaintCommand::LineTo([11.25, -51.]),
            PaintCommand::LineTo([-33.75, -62.25]),
            PaintCommand::LineTo([-45., -107.25]),
            PaintCommand::LineTo([-11.25, -141.]),
            PaintCommand::LineTo([33.75, -129.75]),
            PaintCommand::ClosePath,
            PaintCommand::Fill,
        ]
    );
    assert_eq!(tile.commands[10], PaintCommand::FillStyle("#26384a".into()));
    assert_eq!(tile.commands[20], PaintCommand::FillStyle("#1c2b3b".into()));
    assert_eq!(tile.commands[122], PaintCommand::MoveTo([126., -36.75]));
}

#[test]
fn numeric_plans_and_pixel_buffers_are_owned_fresh_values() {
    let mut a = authored_source_recipes();
    let expected = a.clone();
    if let PaintCommand::Pixels { rgba, .. } =
        &mut a.body_sources.palettes[0].variants[0].commands[0]
    {
        rgba[(24 * 48 + 24) * 4] ^= 255;
    }
    a.palette_rgb[0][0] = 0;
    a.food.clear();
    assert_eq!(authored_source_recipes(), expected);
}
