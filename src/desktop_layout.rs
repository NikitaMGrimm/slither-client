//! Pure desktop viewport-to-backing dimensions, without browser observations.

/// Copied dimensions after diagonal scaling and ordered caps.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DesktopBackingSize {
    /// Canvas backing width, without a DPR multiplier or UI inset.
    pub width: u32,
    /// Canvas backing height, without a DPR multiplier or UI inset.
    pub height: u32,
}

/// Preserve the desktop policy's exact operation order for a positive viewport.
///
/// Ceiling precedes squaring. The diagonal deliberately uses the squared sum,
/// not `hypot`: overflowing that sum must reject even for finite inputs.
pub fn desktop_backing_size(
    area_width: f64,
    area_height: f64,
) -> Result<DesktopBackingSize, &'static str> {
    if !area_width.is_finite() || !area_height.is_finite() || area_width <= 0. || area_height <= 0.
    {
        return Err("Desktop viewport dimensions must be positive finite numbers");
    }
    let width = area_width.ceil();
    let height = area_height.ceil();
    let diagonal = (width * width + height * height).sqrt();
    if !diagonal.is_finite() || diagonal == 0. {
        return Err("Desktop viewport diagonal is invalid");
    }
    let mut backing_width = (width * 1800. / diagonal).ceil();
    let mut backing_height = (height * 1800. / diagonal).ceil();
    if backing_width > 1500. {
        backing_height = (backing_height * 1500. / backing_width).ceil();
        backing_width = 1500.;
    }
    if backing_height > 1500. {
        backing_width = (backing_width * 1500. / backing_height).ceil();
        backing_height = 1500.;
    }
    Ok(DesktopBackingSize {
        width: backing_width as u32,
        height: backing_height as u32,
    })
}
