//! Authored loading presentation over existing startup observations; no admission state.

use crate::start_page::project_start_page;

/// Passive copied surface. It never enables Play, starts work or owns a clock.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MenuLoadingView {
    /// Keep startup visible until every selected DOM owner has mounted, or on failure.
    pub visible: bool,
    /// Show a native indeterminate indicator for an existing busy observation.
    pub busy: bool,
    /// Fixed authored plain text, without endpoint, exception or credential content.
    pub text: &'static str,
}

/// Project the existing typed startup/status observation and completed DOM handoff.
/// Connection-busy presentation continues to use `StartPageView` in the Play panel.
/// No readiness, retry, timing or admission policy is introduced here.
pub fn project_menu_loading(
    code: &str,
    owners_mounted: bool,
) -> Result<MenuLoadingView, &'static str> {
    let (status, text, terminal) = match code {
        "loading" => ("preparing", Some("Loading client…"), false),
        "waiting-assets" => ("preparing", Some("Preparing appearance sources…"), false),
        "ready-not-connected" => ("ready", None, false),
        "connected" => ("connected", None, false),
        "disconnected" => ("not-connected", None, false),
        "host-unavailable" | "csp-or-module-unavailable" => ("unavailable", None, true),
        "client-failed" => ("failed", None, true),
        "disposed" => ("not-connected", None, true),
        _ => return Err("Unknown menu loading observation"),
    };
    let view = project_start_page(status, false, false)?;
    let visible = terminal || !owners_mounted;
    Ok(MenuLoadingView {
        visible,
        busy: visible && view.busy,
        text: text.unwrap_or(view.status),
    })
}
