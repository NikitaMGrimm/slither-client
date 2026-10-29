// Authored responsive composition. No reference geometry or lifecycle policy.
const logo = new URL('../assets/logo.svg', import.meta.url).href;
const freeze = entries => Object.freeze(entries.map(entry => Object.freeze(entry)));
export const startPageLayout = Object.freeze({
  loadingSurface: freeze([
    ['position', 'absolute'], ['left', '50%'], ['top', 'clamp(48px, 18vh, 180px)'],
    ['transform', 'translateX(-50%)'], ['width', 'min(420px, calc(100% - 32px))'],
    ['box-sizing', 'border-box'], ['padding-top', '112px'], ['margin', '0'],
    ['font-family', 'Arial, sans-serif'], ['font-size', '16px'], ['text-align', 'center'],
    ['white-space', 'normal'], ['pointer-events', 'none'],
    ['background-image', `url("${logo}")`], ['background-repeat', 'no-repeat'],
    ['background-position', 'center top'], ['background-size', '100% auto'],
  ]),
  loadingLabel: freeze([['display', 'block'], ['font-family', 'inherit'], ['text-align', 'center']]),
  loadingProgress: freeze([['display', 'inline-block'], ['width', '64px'], ['height', '8px'],
    ['margin-left', '8px'], ['vertical-align', 'middle'], ['border-radius', '0']]),
  panel: freeze([
    ['position', 'absolute'], ['left', '50%'], ['top', 'clamp(48px, 18vh, 180px)'],
    ['transform', 'translateX(-50%)'], ['width', 'min(420px, calc(100% - 32px))'],
    ['max-height', 'calc(100% - clamp(48px, 18vh, 180px) - 16px)'], ['overflow', 'auto'], ['box-sizing', 'border-box'],
    ['padding-top', '112px'], ['display', 'block'], ['color', '#eee'], ['color-scheme', 'dark'],
    ['font-family', 'Arial, sans-serif'], ['font-size', '16px'], ['text-align', 'center'],
    ['font-variant-numeric', 'tabular-nums'], ['border', '0'], ['border-radius', '0'],
    ['background-image', `url("${logo}")`], ['background-repeat', 'no-repeat'],
    ['background-position', 'center top'], ['background-size', '100% auto'],
  ]),
  label: freeze([['display', 'block'], ['margin-bottom', '16px'], ['text-align', 'left']]),
  configuredEndpoint: freeze([['display', 'none']]),
  field: freeze([['display', 'block'], ['width', '100%'], ['min-height', '40px'],
    ['box-sizing', 'border-box'], ['padding', '8px'], ['margin-top', '6px'],
    ['font-family', 'inherit'], ['font-size', '18px'], ['border-radius', '0']]),
  button: freeze([['position', 'static'], ['display', 'block'], ['width', '100%'], ['min-height', '44px'],
    ['font-family', 'inherit'], ['font-size', '20px'], ['border-radius', '0']]),
  status: freeze([['display', 'block'], ['width', '100%'], ['min-height', '3em'],
    ['margin-top', '12px'], ['white-space', 'pre-wrap'], ['font-size', '14px']]),
  menu: freeze([['display', 'block'], ['margin-top', '8px'], ['text-align', 'center']]),
  menuButton: freeze([['position', 'static'], ['display', 'inline-block'], ['margin', '4px'],
    ['min-height', '36px'], ['font-family', 'inherit'], ['font-size', '14px'], ['border-radius', '0']]),
});
