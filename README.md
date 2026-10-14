# big-mesh-studio-port

A port of the SDF modeller from
[big-mesh-studios](https://github.com/big-mesh-studios/big-mesh-studios)
(`apps/sdf-modeller`) to SolidRT. [UPSTREAM.md](UPSTREAM.md) records the
upstream commit it matches and what became of each upstream change since;
`scripts/upstream.sh` lists what is new.

## Download

[Linux x86-64](https://github.com/antoinevanwel/big-mesh-studio-port/releases/latest/download/sdf-modeller-linux-x64.tar.gz),
the latest release. Extract it and run the app inside:

```sh
tar xzf sdf-modeller-linux-x64.tar.gz
./sdf-modeller-linux-x64/sdf-modeller
```

It needs glibc and the system's OpenGL ES (EGL) drivers. The folder also
holds the third-party notices of the SolidRT runtime the app is built on.

## Run

```sh
bun install
bun run sol run     # dev server and a client window
bun run sol test    # tests
```

## License

MIT, as the original. See [LICENSE](LICENSE).
