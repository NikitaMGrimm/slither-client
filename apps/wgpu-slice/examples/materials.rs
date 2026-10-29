//! Pure CPU source-byte ledger for selected resources; never initializes a GPU.
#![forbid(unsafe_code)]
use slither_wgpu_slice::{Result, scene::Scene};
use std::{io::Write, path::PathBuf};
fn capture() -> Result<()> {
    let output = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("new output directory required")?,
    );
    std::fs::create_dir(&output).map_err(|e| e.to_string())?;
    let scene = Scene::new()?;
    for resource in &scene.resources {
        let a = resource.asset;
        let p = output.join(format!(
            "{}-{}-{}x{}.rgba",
            a.handle, a.revision, a.width, a.height
        ));
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(p)
            .map_err(|e| e.to_string())?;
        file.write_all(&resource.image.pixels)
            .map_err(|e| e.to_string())?;
    }
    println!(
        "captured {} selected material resources; pure CPU only",
        scene.resources.len()
    );
    Ok(())
}
fn main() {
    if let Err(e) = capture() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
