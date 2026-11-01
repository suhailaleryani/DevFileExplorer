# Publishing the guide site with GitHub Pages

GitHub Pages serves static files straight from your repository for free. The `docs/` folder here is already a complete static site: `index.html` is the user guide, `screenshots/` and `icon.png` are its images, and the empty `.nojekyll` file tells GitHub not to run Jekyll on it.

The site will be at `https://<your-user>.github.io/<repository>/`.

## 1. Put the repository on GitHub

If it is not there yet:

```
gh repo create DevFileExplorer --public --source . --remote origin --push
```

(or create an empty repository on github.com and run `git remote add origin <url>` then `git push -u origin main`).

## 2. Turn on Pages (pick ONE of the two options)

### Option A: deploy from the `docs/` folder (simplest, nothing to maintain)

1. Open the repository on GitHub, **Settings**, **Pages**.
2. Under **Build and deployment**, **Source**: choose **Deploy from a branch**.
3. **Branch**: `main`, folder: `/docs`, then **Save**.
4. Wait a minute; the page address appears at the top of that settings page.

### Option B: deploy with the included GitHub Actions workflow

`.github/workflows/pages.yml` publishes `docs/` every time a change to `docs/` is pushed to `main`, and can also be started by hand from the **Actions** tab (**Publish guide site**, **Run workflow**).

1. **Settings**, **Pages**, **Source**: choose **GitHub Actions**.
2. Push to `main` (or run the workflow by hand). The page address is shown in the run summary.

Pages has a single "Source" setting, so only one option is active at a time. Switching the source later is fine.

## 3. Update the site

Edit `docs/index.html` (plain HTML and CSS, no build step), commit and push. Option A refreshes within a minute or two, Option B on the next workflow run.

To refresh the screenshots after changing the UI:

```
powershell -File tests/demo/make-demo.ps1     # rebuild the fake projects (D:\DevDemo)
npm run tauri dev                              # keep it running; the capture tool needs the dev server
node tests/demo/capture.mjs                    # rewrites docs/screenshots/*.png
```

## 4. Fix the links

- The repository links in `docs/index.html` and the README already point to `https://github.com/suhailaleryani/DevFileExplorer`. If you fork or rename the repository, search for that URL and replace it.

## 5. Optional: a custom domain

In **Settings**, **Pages**, **Custom domain**, enter the domain, add a `CNAME` DNS record pointing to `<your-user>.github.io`, and tick **Enforce HTTPS** once the certificate is ready.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| 404 on the page | Pages is not enabled yet, or the branch/folder is wrong. Check Settings, Pages. Allow a few minutes. |
| Page loads but images are missing | Image paths are relative (`screenshots/...`); keep `index.html` and `screenshots/` together in `docs/`. |
| Old content still shows | Hard refresh (Ctrl+F5); check the Actions tab for a failed run. |
| Private repository | Pages from private repositories needs a paid GitHub plan; make the repository public or upgrade. |
