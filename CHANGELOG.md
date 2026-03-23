# Changelog

## v1.0.0

[compare changes](https://github.com/AntelopeJS/api/compare/v0.2.0...v1.0.0)

### 🚀 Enhancements

- **api:** Add PartialController helper ([#17](https://github.com/AntelopeJS/api/pull/17))
- **api:** Add catch-all route parameter support ([#16](https://github.com/AntelopeJS/api/pull/16))
- **api:** Add manual listen control for server startup ([#18](https://github.com/AntelopeJS/api/pull/18))
- **api:** Add @Monitor decorator for always-run observers ([#19](https://github.com/AntelopeJS/api/pull/19))

### 🩹 Fixes

- Handle empty body in JSONBody decorator ([ab6eee8](https://github.com/AntelopeJS/api/commit/ab6eee8))

### 📦 Build

- Upgrade api-util to beta version ([bfc9577](https://github.com/AntelopeJS/api/commit/bfc9577))
- Replace rm -rf with rimraf ([#13](https://github.com/AntelopeJS/api/pull/13))

### 🏡 Chore

- Remove unused script ([80db286](https://github.com/AntelopeJS/api/commit/80db286))
- Replicate ai agent config files (.agents/.claude) ([#14](https://github.com/AntelopeJS/api/pull/14))
- Simplify CI workflow triggers and update AGENTS.md ([0f1137b](https://github.com/AntelopeJS/api/commit/0f1137b))
- Migrate from eslint and prettier to biome ([#20](https://github.com/AntelopeJS/api/pull/20))
- Migrate from local beta interfaces to published @antelopejs packages ([55a3d1e](https://github.com/AntelopeJS/api/commit/55a3d1e))
- Bump release-it to 19.2.4 ([12c85ce](https://github.com/AntelopeJS/api/commit/12c85ce))

### 🎨 Styles

- Format destroy function ([feec286](https://github.com/AntelopeJS/api/commit/feec286))

### 🤖 CI

- Remove test:coverage step from CI workflow ([3803084](https://github.com/AntelopeJS/api/commit/3803084))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- MrSociety404 <fabrice@altab.be>
- Glastis ([@Glastis](http://github.com/Glastis))

## v0.2.0

[compare changes](https://github.com/AntelopeJS/api/compare/v0.1.0...v0.2.0)

### 🚀 Enhancements

- Changelog generation is now using changelogen ([#9](https://github.com/AntelopeJS/api/pull/9))
- Api-util@dev interface ([#11](https://github.com/AntelopeJS/api/pull/11))

### 📖 Documentation

- Improved shields ([#7](https://github.com/AntelopeJS/api/pull/7))

### 📦 Build

- Update prepare command ([9e0cd3f](https://github.com/AntelopeJS/api/commit/9e0cd3f))
- Command 'build' that remove previous one before building ([#8](https://github.com/AntelopeJS/api/pull/8))
- Update changelog config ([57dc4f2](https://github.com/AntelopeJS/api/commit/57dc4f2))
- Update lock file ([97b7c9a](https://github.com/AntelopeJS/api/commit/97b7c9a))
- Add release-it-changelogen dep ([006b77a](https://github.com/AntelopeJS/api/commit/006b77a))

### 🏡 Chore

- Add example for assertValidation ([7d1248b](https://github.com/AntelopeJS/api/commit/7d1248b))
- Update tsconfig.json paths ([455636c](https://github.com/AntelopeJS/api/commit/455636c))

### 🤖 CI

- Validate export generation ([#10](https://github.com/AntelopeJS/api/pull/10))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Thomas ([@Thomasims](http://github.com/Thomasims))
- Thomasims <thomas@antelopejs.com>
- Fabrice Cst <fabrice@altab.be>
- Glastis ([@Glastis](http://github.com/Glastis))

## [0.1.0](https://github.com/AntelopeJS/api/compare/v0.0.1...v0.1.0) (2025-05-29)

### Features

* add JSONBody parameter provider and assert utility function ([#3](https://github.com/AntelopeJS/api/issues/3)) ([2349558](https://github.com/AntelopeJS/api/commit/23495586ff3618795ce7585a601d0dac5bed5d92))
* default config ([#6](https://github.com/AntelopeJS/api/issues/6)) ([cc00ddc](https://github.com/AntelopeJS/api/commit/cc00ddc8aaee3ba0ad196682a2a3bdd219182b7c))

### Bug Fixes

* default config ([900ea22](https://github.com/AntelopeJS/api/commit/900ea2202589c54ea63a0c3f52e9df40ec217388))
* use correct path mappings for playground interfaces ([#2](https://github.com/AntelopeJS/api/issues/2)) ([3ed7582](https://github.com/AntelopeJS/api/commit/3ed7582d65112adc20ef24cdcdb01a10a9192177))

## 0.0.1 (2025-05-08)
