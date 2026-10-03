# Release Checklist

This repo publishes two artifacts for each release, from the same tarball:

- npm: `worksplice` — what `npx worksplice` installs
- GitHub Release: `whutlichao/worksplice` — the same tarball attached as an asset, for machines that cannot reach the npm registry

Both come out of `npm pack` at the same commit, so they carry the **same file list and contents** — but they are **not byte-identical**: the tarball embeds file metadata, so two packs of the same tree differ by a few bytes (v0.1.0: 5,888,706 vs 5,888,682). Treat them as equivalent builds, not as the same bytes; verify by file list, not by hash. See `README.md` for the install steps.

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.

## 2. Bump the Version and Verify the Build

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build
```

Notes:

- This bumps the version in `package.json`. It touches no lockfile, so there is nothing else to stage in step 3.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.

## 3. Commit the Version Bump

Replace `<version>` with the new package version, for example `0.7.5`.

```bash
git diff -- package.json
git add package.json
git commit -m "Release v<version>"
```

## 4. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo whutlichao/worksplice
```

## 5. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- ...

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- ...
```

## 6. Publish to npm

`prepack` regenerates the demo database (`scripts/build-demo-db.mjs`), and `files` already excludes `.next/cache`, so there is nothing to assemble by hand.

```bash
npm login                 # once per machine; the account must have 2FA enabled
npm pack --dry-run        # check the file list and the size before publishing
npm publish               # produces worksplice-<version>.tgz in the repo root
```

Expected file list: `bin`, `demo`, `.next`, `public`, `next.config.ts`, `package.json`, plus the usual `README` / `LICENSE`. The tarball is roughly 6 MB, of which `demo/worksplice.db` is about 250 KB.

Notes:

- npm versions are immutable. A mistake costs a patch release, not an edit.
- `npm publish` also runs `prepack`, so the published tarball always carries a freshly seeded demo database.

## 7. Create or Update the GitHub Release

Attach the tarball that npm just accepted, so both artifacts are the same bytes:

```bash
gh release create v<version> \
  --repo whutlichao/worksplice \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md \
  worksplice-<version>.tgz
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo whutlichao/worksplice \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo whutlichao/worksplice --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

## 8. Final Verification

```bash
gh release view v<version> --repo whutlichao/worksplice
npm view worksplice version
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists, carries the `worksplice-<version>.tgz` asset, and is not a draft unless intentionally published as one.
- `npm view worksplice version` prints the version just tagged.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
- A clean machine can run `npx worksplice --demo` (see the release-verification item in the launch checklist).
