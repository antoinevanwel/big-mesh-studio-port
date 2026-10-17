# big-mesh-studio-port

A port of the SDF modeller from
[big-mesh-studios](https://github.com/big-mesh-studios/big-mesh-studios)
(`apps/sdf-modeller`) to SolidRT. [UPSTREAM.md](UPSTREAM.md) records the
upstream commit it matches and what became of each upstream change since;
`scripts/upstream.sh` lists what is new.

## Download

[Linux x86-64](https://github.com/antoinevanwel/big-mesh-studio-port/releases/latest/download/sdf-modeller-linux-x64.tar.xz),
the latest release. Extract it and run the app inside:

```sh
tar xf sdf-modeller-linux-x64.tar.xz
./sdf-modeller-linux-x64/sdf-modeller
```

It needs glibc and the system's OpenGL ES (EGL) drivers. The folder also
holds the third-party notices of the SolidRT runtime the app is built on.

[Android (arm64)](https://github.com/antoinevanwel/big-mesh-studio-port/releases/latest/download/sdf-modeller-arm64-v8a.apk),
for current phones and tablets: open it on the device to install (allow
installs from your browser or file manager when asked).

## Run

```sh
bun install
bun run sol run     # dev server and a client window
bun run sol test    # tests
```

## License

MIT, as the original. See [LICENSE](LICENSE).
