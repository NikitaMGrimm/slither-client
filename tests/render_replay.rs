//! Native fast tier: authored synthetic replay, no Wasm/browser/network/reference.

#[path = "support/draw_list_fixture.rs"]
mod fixture;

use fixture::{Recording, ingest, plans, prepare};
use slither_client::presentation::{BodyPaintPass, BodyPaintPlan};

// Pin portable structural snapshots separately from complete same-process numeric equality.
// Native libm and browser Math do not promise cross-platform last-bit identity.
fn snapshot(frame: usize, plans: &[BodyPaintPlan]) -> String {
    let mut passes = [0; 11];
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for plan in plans {
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

#[test]
fn crowded_recording_replays_complete_ordered_plans_and_matches_snapshots() {
    let recording = Recording::crowded();
    let mut first = recording.client();
    let mut second = recording.client();
    let mut snapshots = String::new();
    for (index, frame) in recording.frames.iter().enumerate() {
        ingest(&mut first, frame);
        ingest(&mut second, frame);
        first.advance(frame.now_ms, false).unwrap();
        second.advance(frame.now_ms, false).unwrap();
        let a = prepare(&mut first, frame);
        let b = prepare(&mut second, frame);
        assert_eq!(a, b, "prepared geometry frame {index}");
        assert!(a.len() >= 24, "crowded visibility frame {index}");
        assert!(a.iter().all(|snake| snake.metrics.id <= 32));
        let a = plans(&first, &a, frame.high_quality);
        let b = plans(&second, &b, frame.high_quality);
        assert_eq!(a, b, "complete numeric draw lists frame {index}");
        assert_eq!(
            numeric_bits(&a),
            numeric_bits(&b),
            "including signed zero frame {index}"
        );
        if [0, 24, 36, 42, 48, 71, 72, 95].contains(&index) {
            snapshots.push_str(&snapshot(index, &a));
        }
    }
    assert_eq!(snapshots, include_str!("support/draw_list_snapshots.txt"));
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
