# big-mesh-studio-port

A port of the SDF modeller from
[big-mesh-studios](https://github.com/big-mesh-studios/big-mesh-studios)
(`apps/sdf-modeller`) to SolidRT. [UPSTREAM.md](UPSTREAM.md) records the
upstream commit it matches and what became of each upstream change since;
`scripts/upstream.sh` lists what is new.

## Run

```sh
bun install
bun run sol run     # dev server and a client window
bun run sol test    # tests
```

## License

MIT, as the original. See [LICENSE](LICENSE).
