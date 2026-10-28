//! Native fast tier: authored synthetic replay, no Wasm/browser/network/reference.

#[path = "support/draw_list_fixture.rs"]
mod fixture;

use fixture::{Recording, ingest, plans, prepare};
use slither_client::presentation::{BodyPaintPass, BodyPaintPlan, PreparedSnake};

// Pin portable structural snapshots separately from complete same-process numeric equality.
// Native libm and browser Math do not promise cross-platform last-bit identity.
fn snapshot(frame: usize, snakes: &[PreparedSnake], plans: &[BodyPaintPlan]) -> String {
    assert_eq!(snakes.len(), plans.len());
    let mut passes = [0; 11];
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for (snake, plan) in snakes.iter().zip(plans) {
        hash = (hash ^ u64::from(snake.metrics.id)).wrapping_mul(0x100_0000_01b3);
        for value in [plan.commands.len(), plan.antenna_barrier] {
            hash = (hash ^ value as u64).wrapping_mul(0x100_0000_01b3);
        }
        for c in &plan.commands {
            let pass = match c.pass {
                BodyPaintPass::OuterBoost => 0,
                BodyPaintPass::Outline => 1,
                BodyPaintPass::NearHeadShadow => 2,
                BodyPaintPass::TailOutline => 3,
                BodyPaintPass::TailShadow => 4,
                BodyPaintPass::BodyShadow => 5,
                BodyPaintPass::Body => 6,
                BodyPaintPass::HeadFade => 7,
                BodyPaintPass::TailFade => 8,
                BodyPaintPass::InnerBoost => 9,
                BodyPaintPass::Death => 10,
            };
            passes[pass] += 1;
            for value in [c.sequence, pass, c.ordinal, c.asset_index] {
                hash = (hash ^ value as u64).wrapping_mul(0x100_0000_01b3);
            }
        }
    }
    format!(
        "{frame}: bodies={} passes={passes:?} order={hash:016x}\n",
        plans.len()
    )
}

fn numeric_bits(plans: &[BodyPaintPlan]) -> Vec<u64> {
    let mut bits = Vec::new();
    for plan in plans {
        bits.extend([
            plan.final_distance_cursor.x.to_bits(),
            plan.final_distance_cursor.y.to_bits(),
        ]);
        for command in &plan.commands {
            bits.extend([
                command.center.x.to_bits(),
                command.center.y.to_bits(),
                command.translation.x.to_bits(),
                command.translation.y.to_bits(),
                command.alpha.requested.to_bits(),
                command.alpha.effective.to_bits(),
            ]);
            bits.extend(command.rotation.map(f64::to_bits));
            for rect in [command.source_rect, Some(command.destination)]
                .into_iter()
                .flatten()
            {
                bits.extend([
                    rect.x.to_bits(),
                    rect.y.to_bits(),
                    rect.width.to_bits(),
                    rect.height.to_bits(),
                ]);
            }
        }
    }
    bits
}

// Pin representative coordinates independently of same-version determinism.
// Absolute tolerance covers native libm rounding, far below a rendered pixel.
fn numeric_samples(plans: &[BodyPaintPlan]) -> Vec<f64> {
    let commands: Vec<_> = plans.iter().flat_map(|plan| &plan.commands).collect();
    let mut samples = Vec::new();
    for index in [0, plans.len() / 2, plans.len() - 1] {
        let cursor = plans[index].final_distance_cursor;
        samples.extend([cursor.x, cursor.y]);
    }
    for index in [0, commands.len() / 2, commands.len() - 1] {
        let command = commands[index];
        samples.extend([
            command.center.x,
            command.center.y,
            command.translation.x,
            command.translation.y,
            f64::from(command.rotation.is_some()),
            command.rotation.unwrap_or(0.),
            command.destination.x,
            command.destination.y,
            command.destination.width,
            command.destination.height,
            command.alpha.requested,
            command.alpha.effective,
        ]);
    }
    samples
}

fn numeric_samples_match(actual: &[f64], expected: &[f64]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| (actual - expected).abs() <= 0.000_001)
}

#[test]
fn crowded_recording_replays_complete_ordered_plans_and_matches_snapshots() {
    let recording = Recording::crowded();
    let mut first = recording.client();
    let mut second = recording.client();
    let mut snapshots = String::new();
    let mut expected_numeric = include_str!("support/draw_list_numeric.txt").lines();
    for (index, frame) in recording.frames.iter().enumerate() {
        ingest(&mut first, frame);
        ingest(&mut second, frame);
        first.advance(frame.now_ms, false).unwrap();
        second.advance(frame.now_ms, false).unwrap();
        let prepared_a = prepare(&mut first, frame);
        let prepared_b = prepare(&mut second, frame);
        assert_eq!(prepared_a, prepared_b, "prepared geometry frame {index}");
        assert!(prepared_a.len() >= 24, "crowded visibility frame {index}");
        assert!(prepared_a.iter().all(|snake| snake.metrics.id <= 32));
        if index == 42 {
            let fresh = prepared_a
                .iter()
                .find(|snake| snake.metrics.id == 8 && snake.metrics.alive)
                .expect("live reused ID 8");
            let dying = prepared_a
                .iter()
                .find(|snake| snake.metrics.id == 8 && !snake.metrics.alive)
                .expect("retained dying ID 8");
            assert_ne!(
                fresh.metrics.raw_head, dying.metrics.raw_head,
                "a reused ID must not inherit the dying body's position"
            );
        }
        let a = plans(&first, &prepared_a, frame.high_quality);
        let b = plans(&second, &prepared_b, frame.high_quality);
        assert_eq!(a, b, "complete numeric draw lists frame {index}");
        assert_eq!(
            numeric_bits(&a),
            numeric_bits(&b),
            "including signed zero frame {index}"
        );
        if [0, 24, 36, 42, 48, 71, 72, 95].contains(&index) {
            snapshots.push_str(&snapshot(index, &prepared_a, &a));
            let mut expected = expected_numeric.next().unwrap().split_whitespace();
            assert_eq!(expected.next().unwrap().parse::<usize>().unwrap(), index);
            let expected: Vec<f64> = expected.map(|value| value.parse().unwrap()).collect();
            let actual = numeric_samples(&a);
            assert!(
                numeric_samples_match(&actual, &expected),
                "pinned numeric draw samples frame {index}: {actual:?}"
            );
        }
    }
    assert!(expected_numeric.next().is_none());
    assert_eq!(snapshots, include_str!("support/draw_list_snapshots.txt"));
}

#[test]
fn numeric_snapshot_detects_changes_without_command_topology_changes() {
    let recording = Recording::crowded();
    let mut client = recording.client();
    let mut output = Vec::new();
    let mut prepared = Vec::new();
    for frame in &recording.frames[..=24] {
        ingest(&mut client, frame);
        client.advance(frame.now_ms, false).unwrap();
        prepared = prepare(&mut client, frame);
        output = plans(&client, &prepared, frame.high_quality);
    }
    let expected = numeric_samples(&output);
    let topology = snapshot(24, &prepared, &output);
    for field in 0..4 {
        let mut changed = output.clone();
        let command = &mut changed[0].commands[0];
        match field {
            0 => command.center.x += 1.,
            1 => command.rotation = Some(command.rotation.unwrap_or(0.) + 0.125),
            2 => command.destination.width += 1.,
            3 => command.alpha.effective += 0.125,
            _ => unreachable!(),
        }
        assert_eq!(snapshot(24, &prepared, &changed), topology);
        assert!(!numeric_samples_match(
            &numeric_samples(&changed),
            &expected
        ));
    }
}

#[test]
fn identity_snapshot_detects_swaps_between_unsampled_same_structure_snakes() {
    let recording = Recording::crowded();
    let mut client = recording.client();
    let frame = &recording.frames[0];
    ingest(&mut client, frame);
    client.advance(frame.now_ms, false).unwrap();
    let snakes = prepare(&mut client, frame);
    let output = plans(&client, &snakes, frame.high_quality);
    let mut swapped_snakes = snakes.clone();
    let mut swapped_output = output.clone();
    swapped_snakes.swap(2, 4);
    swapped_output.swap(2, 4);
    assert_eq!(numeric_samples(&swapped_output), numeric_samples(&output));
    assert_ne!(
        snapshot(0, &swapped_snakes, &swapped_output),
        snapshot(0, &snakes, &output)
    );
}

#[test]
fn replay_observes_packet_and_quality_changes() {
    let recording = Recording::crowded();
    let mut client = recording.client();
    for frame in &recording.frames[..36] {
        ingest(&mut client, frame);
        client.advance(frame.now_ms, false).unwrap();
        prepare(&mut client, frame);
    }
    let frame = &recording.frames[36];
    let mut without_death = client.clone();
    let mut control = frame.clone();
    assert!(control.packet.ends_with(&[0, 4, b's', 0, 8, 1]));
    control.packet.truncate(control.packet.len() - 6);
    ingest(&mut without_death, &control);
    ingest(&mut client, frame);
    client.advance(frame.now_ms, false).unwrap();
    without_death.advance(frame.now_ms, false).unwrap();
    let dying = prepare(&mut client, frame);
    let live = prepare(&mut without_death, frame);
    let high = plans(&client, &dying, true);
    assert_ne!(high, plans(&without_death, &live, true));
    assert!(
        high.iter()
            .flat_map(|p| &p.commands)
            .any(|c| c.pass == BodyPaintPass::Death)
    );
    let low = plans(&client, &dying, false);
    assert!(
        low.iter().map(|p| p.commands.len()).sum::<usize>()
            < high.iter().map(|p| p.commands.len()).sum::<usize>()
    );
    assert!(
        low.iter()
            .flat_map(|p| &p.commands)
            .all(|c| !matches!(c.pass, BodyPaintPass::Outline | BodyPaintPass::InnerBoost))
    );
}
