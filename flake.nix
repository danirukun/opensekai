{
  description = "OpenSekai development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # rustup (rust-toolchain.toml), Node, pnpm, and Xcode stay on the host.
      # The hook drops the stdenv tools (GNU sed, coreutils, ...) and the darwin
      # build variables, so host commands and Cargo fingerprints do not change.
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShellNoCC {
          shellHook = ''
            export PATH="${pkgs.cargo-sweep}/bin:$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/nix/store/' | paste -sd: -)"
            unset MACOSX_DEPLOYMENT_TARGET SOURCE_DATE_EPOCH
            export CARGO_TARGET_DIR="$HOME/.cache/opensekai/target"
          '';
        };
      });
    };
}
