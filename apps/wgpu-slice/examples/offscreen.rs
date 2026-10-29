//! One finite, explicitly requested GPU check. No window, browser, sockets or game server.
#![forbid(unsafe_code)]
use slither_wgpu_slice::{
    Result,
    gpu::{Renderer, instance},
    scene::Scene,
};
use std::{io::Write, path::PathBuf, sync::mpsc, time::Duration};

async fn check() -> Result<()> {
    let output = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("explicit new output directory required")?,
    );
    std::fs::create_dir(&output).map_err(|e| e.to_string())?;
    let i = instance();
    let mut renderer = Renderer::new(&i, None, wgpu::TextureFormat::Rgba8Unorm).await?;
    println!("actual_adapter={:?}", renderer.adapter_info);
    println!("actual_sample_count={}", renderer.sample_count);
    let validation = renderer
        .device
        .push_error_scope(wgpu::ErrorFilter::Validation);
    let mut scene = Scene::new()?;
    for resource in &scene.resources {
        renderer.upload(resource)?;
    }
    let texture = renderer.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("finite offscreen target"),
        size: wgpu::Extent3d {
            width: 960,
            height: 540,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&Default::default());
    let mut captures = Vec::new();
    for tick in 1..=240 {
        let frame = scene.next_frame([960, 540], 1.)?;
        if tick != 60 && tick != 240 {
            continue;
        }
        renderer.render(&frame, &view)?;
        let row = 960 * 4;
        let buffer = renderer.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("bounded readback"),
            size: u64::from(row * 540),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = renderer.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(540),
                },
            },
            wgpu::Extent3d {
                width: 960,
                height: 540,
                depth_or_array_layers: 1,
            },
        );
        renderer.queue.submit([encoder.finish()]);
        let (tx, rx) = mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        renderer
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(Duration::from_secs(10)),
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(1))
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let data = buffer
            .slice(..)
            .get_mapped_range()
            .map_err(|e| e.to_string())?
            .to_vec();
        buffer.unmap();
        let background = &data[..4];
        let covered = data
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p.as_slice() != background)
            .count();
        if covered < 100 {
            return Err("no meaningful gameplay coverage".into());
        }
        println!(
            "tick={tick} draws={} non_background_pixels={covered}",
            frame.draws.len()
        );
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output.join(format!("tick-{tick}-960x540-premult-rgba8.raw")))
            .map_err(|e| e.to_string())?;
        file.write_all(&data).map_err(|e| e.to_string())?;
        captures.push(data);
    }
    if captures[0] == captures[1] {
        return Err("normal and boost frames unexpectedly identical".into());
    }
    // Real owner lifetime controls, not just key comparisons.
    let first = scene.resources[0].clone();
    let old_key = first.asset.into();
    if renderer.upload(&first).is_ok() {
        return Err("duplicate revision admitted".into());
    }
    let mut newer = first.clone();
    newer.asset.revision += 1;
    renderer.upload(&newer)?;
    if renderer.release(old_key) {
        return Err("retired revision still resident".into());
    }
    if renderer.upload(&first).is_ok() {
        return Err("stale revision admitted".into());
    }
    if !renderer.release(newer.asset.into()) || renderer.release(newer.asset.into()) {
        return Err("release identity".into());
    }
    renderer
        .device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(Duration::from_secs(10)),
        })
        .map_err(|e| e.to_string())?;
    if let Some(error) = validation.pop().await {
        return Err(format!("validation: {error}"));
    }
    println!(
        "PASS: two finite gameplay readbacks + duplicate/stale/update/release controls; no visual/performance acceptance"
    );
    Ok(())
}
fn main() {
    if let Err(e) = pollster::block_on(check()) {
        eprintln!("OFFSCREEN_NOT_ACCEPTED: {e}");
        std::process::exit(1);
    }
}
