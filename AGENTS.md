# Repository Guidelines

## Project Structure & Module Organization

This repository is currently an empty starting point: no source code, tests, assets, or build configuration is present. When introducing the initial implementation, document its layout in `README.md`.

Use clear top-level directories where appropriate: `src/` for application code, `tests/` for automated tests, `assets/` for static resources, and `docs/` for supporting documentation. Group related code by feature or responsibility and keep generated files separate from maintained source.

## Build, Test, and Development Commands

No installation, development, build, or test commands are configured yet. When adding tooling, provide reproducible commands in `README.md` and the relevant package manifest or task runner. Explain prerequisites, required runtime versions, and configuration steps. Include the dependency lockfile supported by the selected tooling.

## Coding Style & Naming Conventions

No language-specific conventions or formatter are established. Follow the idioms of the language selected for the initial implementation, and configure formatting and linting alongside it. Use consistent indentation within each file, descriptive identifiers, and filenames that reflect their purpose. Avoid unrelated formatting changes in functional patches.

## Testing Guidelines

No testing framework or coverage threshold is configured. Add automated tests with the first executable functionality, covering expected behavior, boundary cases, and failure paths. Use descriptive test names that identify the behavior under test. Document test discovery conventions and the exact command for running the suite.

## Commit & Pull Request Guidelines

There is no Git history available from which to infer commit conventions. Use concise, imperative commit subjects, such as `Add initial project configuration`, and keep changes focused.

Pull requests should describe the problem, implementation, and validation performed. Link relevant issues and include screenshots for visible UI changes. Clearly identify any setup steps, compatibility changes, or checks that could not be run.

## Security & Configuration

Keep credentials and local configuration out of version control. Provide placeholder values in an example configuration file when needed, and exclude secrets, generated artifacts, and local caches through `.gitignore`.
