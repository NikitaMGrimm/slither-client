//! Original synthetic GPU regression. Opt-in only: normal tests never initialize a GPU.
#![cfg(not(target_arch = "wasm32"))]
use slither_client::presentation::{BodyAsset, BodyAssetStatus, BodyBlend, BodyRect};
use slither_wgpu_slice::{
    Result,
    frame::{Draw, Frame},
    gpu::{Renderer, instance},
    materials::RgbaImage,
    scene::Resource,
};
use std::{sync::mpsc, time::Duration};

fn upload(r: &mut Renderer, handle: u64, size: [u32; 2], pixels: Vec<u8>) -> Result<BodyAsset> {
    let asset = BodyAsset {
        handle,
        revision: 1,
        width: size[0],
        height: size[1],
        status: BodyAssetStatus::Ready,
    };
    r.upload(&Resource {
        asset,
        image: RgbaImage {
            width: size[0],
            height: size[1],
            pixels,
        },
    })?;
    Ok(asset)
}
fn draw(asset: BodyAsset, rect: [f64; 4], black_effect: bool, alpha: f64) -> Draw {
    Draw {
        corners: None,
        asset,
        source: None,
        repeat_uv: None,
        black_effect,
        destination: BodyRect {
            x: rect[0],
            y: rect[1],
            width: rect[2],
            height: rect[3],
        },
        translation: [0.; 2],
        rotation: 0.,
        effective_alpha: alpha,
        blend: BodyBlend::SourceOver,
    }
}
async fn pixels() -> Result<Vec<u8>> {
    let mut r = Renderer::new(&instance(), None, wgpu::TextureFormat::Rgba8Unorm).await?;
    println!(
        "black-effect regression: {:?}, MSAA{}",
        r.adapter_info, r.sample_count
    );
    let mut background = Vec::new();
    let mut shadow = Vec::new();
    for a in 0..=255_u8 {
        for c in 0..=255_u8 {
            background.extend([c, c, c, 255]);
            shadow.extend([0, 0, 0, a]);
        }
    }
    let bg = upload(&mut r, 1, [256, 256], background)?;
    let shadow = upload(&mut r, 2, [256, 256], shadow)?;
    let flat = upload(&mut r, 3, [1, 1], vec![9, 11, 15, 255])?;
    let weak = upload(&mut r, 4, [1, 1], vec![0, 0, 0, 8])?;
    let colored = upload(&mut r, 5, [1, 1], vec![32, 0, 0, 64])?;
    let mut draws = vec![
        draw(bg, [0., 0., 256., 1536.], false, 1.),
        draw(shadow, [0., 0., 256., 256.], false, 1.),
        draw(shadow, [0., 256., 256., 256.], true, 1.),
        draw(shadow, [0., 512., 256., 256.], true, 0.),
        draw(flat, [0., 768., 256., 512.], false, 1.),
    ];
    // Fourteen authored weak layers expose the accumulated truncation difference.
    draws.extend((0..14).map(|_| draw(weak, [0., 768., 256., 256.], true, 1.)));
    draws.push(draw(colored, [0., 1024., 128., 256.], false, 0.5));
    draws.push(draw(colored, [128., 1024., 128., 256.], true, 0.5));
    draws.extend((0..14).map(|_| draw(weak, [0., 1280., 256., 256.], true, 1.)));
    let frame = Frame {
        identity: 1,
        extent: [256, 1536],
        viewport_scale: 1.,
        tick: 1,
        draws,
        snakes: Vec::new(),
    };
    let texture = r.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("synthetic black-effect grid"),
        size: wgpu::Extent3d {
            width: 256,
            height: 1536,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    r.render(&frame, &texture.create_view(&Default::default()))?;
    let buffer = r.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("synthetic blend readback"),
        size: 256 * 1536 * 4,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = r.device.create_command_encoder(&Default::default());
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
                bytes_per_row: Some(1024),
                rows_per_image: Some(1536),
            },
        },
        wgpu::Extent3d {
            width: 256,
            height: 1536,
            depth_or_array_layers: 1,
        },
    );
    r.queue.submit([encoder.finish()]);
    let (tx, rx) = mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
    r.device
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
    Ok(data)
}

#[test]
#[ignore = "requires a hardware GPU; run explicitly with --ignored"]
fn shadow_truncation_precision_bounds_and_controls() {
    // Largest exact prefixes measured on Vulkan/MSAA4. Brighter destinations
    // retain a one-byte precision bound, including the fourteen-layer recurrence.
    const SINGLE_EXACT_MAX: usize = 18;
    const STACKED_EXACT_MAX: usize = 159;
    let data = pollster::block_on(pixels()).unwrap();
    let pixel = |x: usize, y: usize| &data[(y * 256 + x) * 4..(y * 256 + x) * 4 + 4];
    let mut single_first_mismatch = 256;
    let mut single_max_error = 0;
    let mut single_mismatches = 0;
    for a in 1..=255_usize {
        for c in 0..=255_usize {
            let expected = (c * (256 - a) / 256) as u8;
            let actual = pixel(c, 256 + a);
            let error = actual[..3]
                .iter()
                .map(|v| v.abs_diff(expected))
                .max()
                .unwrap();
            single_max_error = single_max_error.max(error);
            if error != 0 {
                single_first_mismatch = single_first_mismatch.min(c);
                single_mismatches += 1;
            }
            if c <= SINGLE_EXACT_MAX {
                assert_eq!(error, 0, "exact range: background={c}, alpha={a}");
            }
            assert!(
                error <= 1,
                "background={c}, alpha={a}, actual={actual:?}, expected={expected}"
            );
            assert_eq!(actual[3], 255);
        }
    }
    let mut stacked_first_mismatch = 256;
    let mut stacked_max_error = 0;
    let mut stacked_mismatches = 0;
    for c in 0..=255_usize {
        let expected = (0..14).fold(c, |value, _| value * (256 - 8) / 256) as u8;
        let actual = pixel(c, 1408);
        let error = actual[..3]
            .iter()
            .map(|v| v.abs_diff(expected))
            .max()
            .unwrap();
        stacked_max_error = stacked_max_error.max(error);
        if error != 0 {
            stacked_first_mismatch = stacked_first_mismatch.min(c);
            stacked_mismatches += 1;
        }
        if c <= STACKED_EXACT_MAX {
            assert_eq!(error, 0, "exact stacked range: starting value={c}");
        }
        assert!(
            error <= 1,
            "stacked starting value={c}, actual={actual:?}, expected={expected}"
        );
        assert_eq!(actual[3], 255);
    }
    println!(
        "single: first mismatch destination={single_first_mismatch}, max error={single_max_error}, mismatch pairs={single_mismatches}; stacked: first mismatch destination={stacked_first_mismatch}, max error={stacked_max_error}, mismatch starts={stacked_mismatches}"
    );
    for a in 0..=255_usize {
        for c in 0..=255_usize {
            assert_eq!(pixel(c, 512 + a), [c as u8, c as u8, c as u8, 255]);
        }
    }
    for c in 0..=255_usize {
        assert_eq!(pixel(c, 256), [c as u8, c as u8, c as u8, 255]);
    }
    assert_eq!(
        pixel(9, 1),
        [9, 9, 9, 255],
        "ordinary image blending is retained"
    );
    assert_eq!(
        pixel(128, 896),
        [0, 0, 1, 255],
        "fourteen weak black layers must accumulate"
    );
    assert_eq!(
        pixel(64, 1152),
        pixel(192, 1152),
        "colored body effects retain ordinary source-over"
    );
}
