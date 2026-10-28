//! Authored synthetic native CPU benchmark. No browser submission or external recording.

#[path = "../tests/support/draw_list_fixture.rs"]
mod fixture;

use fixture::{Recording, ingest, plans, prepare};
use std::{
    hint::black_box,
    time::{Duration, Instant},
};

#[derive(Default)]
struct Sample {
    ingress: Duration,
    update: Duration,
    draw: Duration,
    plan: Duration,
    total: Duration,
    commands: usize,
    bodies: usize,
}

fn run(recording: &Recording) -> Sample {
    let mut client = recording.client();
    let mut sample = Sample::default();
    let total = Instant::now();
    for frame in &recording.frames {
        let start = Instant::now();
        ingest(black_box(&mut client), black_box(frame));
        sample.ingress += start.elapsed();
        let start = Instant::now();
        black_box(client.advance(black_box(frame.now_ms), false).unwrap());
        sample.update += start.elapsed();
        let start = Instant::now();
        let snakes = black_box(prepare(black_box(&mut client), black_box(frame)));
        sample.draw += start.elapsed();
        let start = Instant::now();
        let lists = black_box(plans(
            black_box(&client),
            black_box(&snakes),
            frame.high_quality,
        ));
        sample.plan += start.elapsed();
        sample.bodies += snakes.len();
        sample.commands += lists.iter().map(|plan| plan.commands.len()).sum::<usize>();
        // Output is consumed and allocations are released before the total timer ends.
        black_box(lists);
    }
    sample.total = total.elapsed();
    sample
}

fn main() {
    // Cargo can run a harness-free bench during all-target tests without --test.
    // Timing samples therefore require an explicit opt-in; CI gets one count smoke.
    let measure = std::env::args().any(|arg| arg == "--measure");
    let recording = Recording::crowded();
    let expected = run(&recording);
    assert_eq!(expected.bodies, 3065);
    assert_eq!(expected.commands, 1_289_338);
    if !measure {
        println!(
            "draw_list smoke: {} frames, {} bodies, {} commands",
            recording.frames.len(),
            expected.bodies,
            expected.commands
        );
        return;
    }
    println!(
        "native CPU only; {} frames, {} snakes, {} anchors/appearance, {}x{}; one warmup, five samples",
        recording.frames.len(),
        fixture::SNAKE_COUNT,
        fixture::BODY_POINTS,
        fixture::WIDTH,
        fixture::HEIGHT
    );
    println!(
        "us/frame: ingress update draw_prepare body_plan total; total includes output destruction/accounting; setup excluded"
    );
    let mut totals = Vec::new();
    for index in 0..5 {
        let result = run(&recording);
        assert_eq!(
            (result.bodies, result.commands),
            (expected.bodies, expected.commands)
        );
        let us = |time: Duration| time.as_secs_f64() * 1_000_000. / recording.frames.len() as f64;
        println!(
            "sample {}: {:.3} {:.3} {:.3} {:.3} {:.3}; bodies={} commands={}",
            index + 1,
            us(result.ingress),
            us(result.update),
            us(result.draw),
            us(result.plan),
            us(result.total),
            result.bodies,
            result.commands
        );
        totals.push(us(result.total));
    }
    totals.sort_by(f64::total_cmp);
    println!(
        "total us/frame median={:.3} range={:.3}..{:.3}",
        totals[2], totals[0], totals[4]
    );
}
