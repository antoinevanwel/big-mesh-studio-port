//! The app's runtime: lattice's program with the stock modules and fonts,
//! built with fewer capabilities (Cargo.toml says which and why).

/// No modules beside lattice's built-ins.
pub fn modules() -> lattice::Modules {
  lattice::Modules::new()
}

/// The stock font set (Noto Sans, Noto Serif and Noto Sans Mono under
/// `sans`, `serif` and `mono`): package.json's solidrt.fonts keeps all three.
pub fn fonts() -> lattice::Fonts {
  lattice::Fonts::stock()
}

/// The program: the modules, the fonts, and the failure screen, from the
/// @solidrt/cli package beside the app.
pub fn program() -> lattice::Program {
  lattice::Program {
    modules: modules(),
    fonts: fonts(),
    bsod: include_str!("../../node_modules/@solidrt/cli/player/bsod.sol.js"),
  }
}

// The Android .so's entry; nothing on other targets.
lattice::android_entry!(crate::program());
