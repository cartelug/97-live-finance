# Upload 97 LIVE to GitHub

Upload the contents of this ZIP into the repository root. Do not upload the ZIP file inside the repository.

Keep this structure:

```text
index.html
experience-v2.js
sync.js
sw.js
manifest.webmanifest
reset.html
.nojekyll
icons/
extension/
```

`index.html` must be in the root. Keep the `icons/` and `extension/` folders beside it; do not rename them or put the files inside another folder.

On GitHub:

1. Open `cartelug/97-live-finance`.
2. Choose **Add file → Upload files**.
3. Drag in the ZIP contents, including the folders.
4. Commit to the `main` branch.
5. Open **Settings → Pages**.
6. Choose **Deploy from a branch → main → /(root)** and save.

Wait about a minute, then open the GitHub Pages URL.
