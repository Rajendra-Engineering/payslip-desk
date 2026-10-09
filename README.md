# Payslip Desk

Monthly payslip checker and PDF maker for **Rajendra Engineering** and **RS Automation**.

- Hosted free on GitHub Pages. Login with Google (Gmail) through Firebase.
- The salary Excel is read **in the browser** and never uploaded. Firebase stores only: people and roles, rates, company details, employee details, language/reason choices, column choices, month status, the activity log, and the figures of **Final** months (kept 12 months, then emailed as an archive to the address set under *Company details → Archive email* – default `makudapathycibi@gmail.com` – and deleted).
- Main owner: `makudapathycibi@gmail.com` (fixed in `firestore.rules`, cannot be removed).

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `core.js` | Excel reading, checks, payslip layout, PDF making |
| `app.js` | Google login, roles, shared data, month lock / Final, records, archive |
| `firebase-config.js` | Firebase project `payslip-desk-re` (not secret) |
| `assets/` | Rajendra logo and icon |
| `firestore.rules` | Security rules – paste into Firebase |
| `apps-script/Code.gs` | Archive mailer – runs in the company Gmail |

## One-time setup

1. **GitHub Pages** – repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save. The site appears at `https://<organization>.github.io/payslip-desk/` within a few minutes.
2. **Firebase authorized domain** – Firebase console → Authentication → Settings → Authorized domains → Add domain → `<organization>.github.io`.
3. **Security rules** – Firebase console → Firestore Database → Rules → replace everything with `firestore.rules` → Publish.
4. **First login** – open the site, sign in as the main owner. The tool saves the default rates and company details on first login.
5. **People** – add owners and up to 5 managers by Gmail under *People*.
6. **Archive email (optional, recommended)** – follow the steps at the top of `apps-script/Code.gs`, signed in as the Gmail that should send the archives. Under *Company details → Archive email*, enter where archives go (can be changed later), paste the web app URL and secret word, then *Send a test email*.

## Roles

| | Main owner | Owner | Manager |
|---|---|---|---|
| Upload, review, reasons, employee details, column choices | ✓ | ✓ | ✓ |
| Make payslips, mark a month Final, re-make payslips from records | ✓ | ✓ | ✓ |
| Change rates/ceilings and company details | ✓ | ✓ | view only |
| Reopen or archive a Final month | ✓ | ✓ | – |
| Add / remove people | ✓ | ✓ | – |
| Can be removed | never | by owners | by owners |

## Updating the tool

Replace the changed files in the repo (Add file → Upload files → Commit). GitHub Pages republishes in a minute or two. Ask everyone to reload the page.
