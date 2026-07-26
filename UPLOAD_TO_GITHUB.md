# Upload the final 97 LIVE build to GitHub

Download the fresh ZIP, extract it on your computer, and upload the extracted
contents into the repository root. Do not upload the ZIP file itself.

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
3. Drag in everything extracted from the ZIP. Confirm that `index.html` is
   visible at the top level of the upload, not inside a second folder.
4. If GitHub asks whether to replace existing files, allow the matching files
   from this build to replace them. Do not delete unrelated repository files.
5. Commit the upload. Using a new branch first is safest; merge it after the
   upload looks correct.
6. Open **Settings → Pages**.
7. Choose **Deploy from a branch → main → /(root)** and save.

Wait about a minute, then open the GitHub Pages URL.
