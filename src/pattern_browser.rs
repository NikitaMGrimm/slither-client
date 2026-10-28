//! One isolated rectangular path for a prepared background-pattern submission.

use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, Path2d};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(extends = Path2d, js_name = Path2D)]
    type CheckedPath;

    #[wasm_bindgen(catch, method, js_name = rect)]
    fn checked_rect(
        this: &CheckedPath,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> Result<(), JsValue>;
}

pub(crate) struct PatternRectangle(Path2d);

impl PatternRectangle {
    pub(crate) fn new(rect: Option<[f64; 4]>) -> Result<Self, JsValue> {
        let path = Path2d::new()?;
        if let Some([x, y, width, height]) = rect {
            // Populate every path during preflight, before any target is cleared.
            path.unchecked_ref::<CheckedPath>()
                .checked_rect(x, y, width, height)?;
        }
        Ok(Self(path))
    }

    pub(crate) fn fill(self, context: &CanvasRenderingContext2d) {
        // A separate path preserves the current path, just as fillRect does.
        context.fill_with_path_2d(&self.0);
    }
}
