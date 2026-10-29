//! Authored source-plan witnesses. No external program, images or source generation.

use slither_client::authored_sources::{CanvasRecipe, PaintCommand, authored_source_recipes};

fn arc(recipe: &CanvasRecipe) -> [f64; 5] {
    recipe
        .commands
        .iter()
        .find_map(|command| match command {
            PaintCommand::Arc(values) => Some(*values),
            _ => None,
        })
        .unwrap()
}

#[test]
fn source_pool_counts_order_and_existing_native_dimensions_are_fixed() {
    let recipes = authored_source_recipes();
    assert_eq!(
        recipes.palette_rgb,
        [[131, 213, 176], [239, 187, 98], [118, 185, 237]]
    );
    assert_eq!(recipes.palettes.len(), 3);
    for palette in &recipes.palettes {
        assert_eq!((palette.width, palette.height), (32, 32));
        assert_eq!(arc(palette), [16., 16., 16., 0., std::f64::consts::PI * 2.]);
    }
    assert_eq!((recipes.tile.width, recipes.tile.height), (324, 192));
    assert_eq!(
        (recipes.backdrop.width, recipes.backdrop.height),
        (512, 512)
    );
    assert_eq!(recipes.body_sources.palettes.len(), 3);
    assert!(
        recipes
            .body_sources
            .palettes
            .iter()
            .all(|p| p.variants.len() == 7)
    );
    assert_eq!(recipes.food.len(), 10);
    assert_eq!(recipes.prey.len(), 9);
    assert_eq!(
        recipes
            .food
            .iter()
            .map(|p| p.bodies.len() + p.outlines.len() + p.glows.len())
            .sum::<usize>(),
        240
    );
    assert_eq!(
        recipes
            .prey
            .iter()
            .map(|p| p.bodies.len() + p.glows.len())
            .sum::<usize>(),
        63
    );
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
fn shaded_sources_preserve_rounding_light_and_gradient_stop_order() {
    let recipes = authored_source_recipes();
    let PaintCommand::RadialGradient { circles, stops } =
        &recipes.body_sources.palettes[0].variants[0].commands[0]
    else {
        panic!()
    };
    assert_eq!(*circles, [25., 23., 0., 32., 32., 31.]);
    assert_eq!(
        stops,
        &vec![
            (0., "rgba(151,220,189,1)".into()),
            (0.42, "rgba(113,184,152,1)".into()),
            (0.82, "rgba(77,125,103,1)".into()),
            (0.96, "rgba(50,82,68,0.9)".into()),
            (1., "rgba(50,82,68,0)".into()),
        ]
    );
    assert_eq!(
        recipes.body_sources.palettes[0].variants[0].commands[1],
        PaintCommand::FillRect([0., 0., 64., 64.])
    );
    let PaintCommand::RadialGradient { circles, .. } =
        &recipes.body_sources.palettes[0].boost_glow.commands[0]
    else {
        panic!()
    };
    assert_eq!(*circles, [32., 32., 0., 32., 32., 31.]);
}

#[test]
fn food_and_prey_keep_every_source_extent_center_radius_and_alpha() {
    let recipes = authored_source_recipes();
    for palette in &recipes.food {
        assert_eq!(palette.count, 8);
        for (kind, family) in [&palette.bodies, &palette.outlines, &palette.glows]
            .into_iter()
            .enumerate()
        {
            for (index, source) in family.iter().enumerate() {
                let width = 15 + 4 * index;
                let height = 13 + 2 * index;
                assert_eq!((source.width, source.height), (width as u32, height as u32));
                assert_eq!(
                    (source.half_width, source.half_height),
                    (width as f64 / 2., height as f64 / 2.)
                );
                assert_eq!(
                    arc(source)[2],
                    (height as f64 / 2. - if kind == 0 { 2. } else { 0. }).max(1.)
                );
                assert_eq!(
                    source.commands[1],
                    PaintCommand::GlobalAlpha(if kind == 2 { 0.25 } else { 1. })
                );
            }
        }
    }
    for palette in &recipes.prey {
        assert!(palette.outlines.is_empty());
        for (glow, family) in [(false, &palette.bodies), (true, &palette.glows)] {
            for (index, source) in family.iter().enumerate() {
                let width = if glow { 57 + index * 8 } else { 21 + index * 4 };
                let height = if glow { 53 + index * 6 } else { 19 + index * 4 };
                assert_eq!((source.width, source.height), (width as u32, height as u32));
                assert_eq!(
                    arc(source)[2].to_bits(),
                    (height as f64 / if glow { 2. } else { 3. }).to_bits()
                );
                assert_eq!(
                    source.commands[1],
                    PaintCommand::GlobalAlpha(if glow { 0.18 } else { 1. })
                );
            }
        }
    }
}

#[test]
fn returned_numeric_plans_are_independent() {
    let mut first = authored_source_recipes();
    let expected = first.clone();
    first.palette_rgb[0][0] = 0;
    first.body_sources.palettes[0].variants.clear();
    first.food.clear();
    assert_eq!(authored_source_recipes(), expected);
}
