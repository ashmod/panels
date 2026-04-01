<picture>
  <source srcset="assets/panels_white.svg" media="(prefers-color-scheme: dark)">
  <img src="assets/panels.svg" alt="Panels logo">
</picture>

<br><br>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/ashmod/panels/ci.yml?branch=main&label=CI&logo=github&style=flat-square)](https://github.com/ashmod/panels/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/github/actions/workflow/status/ashmod/panels/tests.yml?branch=main&label=Tests&logo=github&style=flat-square)](https://github.com/ashmod/panels/actions/workflows/tests.yml)
[![Deployment](https://img.shields.io/website?url=https%3A%2F%2Fpanels.ashmod.dev%2Fapi%2Fhealth&label=Deployment&logo=heroku&style=flat-square)](https://panels.ashmod.dev)

</div>

Panels is a simple Rust based web server for delivering the Sunday Funnies anytime, anywhere. This build uses a host-friendly catalog that avoids scraping heavily restricted domains like GoComics.

For the full Panels experience, self-host or run locally from [main](https://github.com/ashmod/panels/tree/main)

> [!NOTE]
Panels is a personal project and is not affiliated with any comic publishers. All comics are sourced from publicly available data and are intended for personal use and enjoyment. All comics are property of their respective creators and publishers.

## Contributing

Contributions are welcome. Feel free to open an issue or submit a pull request. Let me know if a comic you love is missing or if you have ideas for new features!

### Issue reporting

When reporting an issue, please include:
- A clear description of the problem.
- Steps to reproduce the issue.
- Expected vs actual behavior.
- Any relevant logs or error messages.  
 
### Pull request guidelines

1. Fork the repo and create a feature branch.
2. Make focused changes with clear commit messages.
3. Run the local quality checks.
4. Open the PR with context and testing notes.

### Local quality checks

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test
```

### Pull request checklist

- Scope is limited to one feature or fix.
- API behavior changes are documented in `README.md`.
- New behavior is covered by tests in `tests/` or module tests.
- Clippy and tests pass locally.

## License

MIT. See [`LICENSE`](LICENSE).
