# Publishing Draw It

This is the release checklist. Nothing here has been run yet. Steps marked **(public)** create things on
Little's servers or make the app visible to others, so do them on purpose.

Facts checked locally: `little doctor` is all green, the manifest validates and "will publish", the production
build (`npm run build`) works and loads from a sub-folder, the bundle has no dev hook and makes no network
requests of its own, and `/little/manifest.json` is in `dist/`.

## 0. Decisions to make first

| Decision | Notes |
| --- | --- |
| Publisher org name | Shown to viewers as the publisher. Created under the signed-in Little account (check `little whoami`). |
| App slug | Defaults to the folder name (`draw-it`). Lowercase letters, digits, single hyphens, up to 63 characters. |
| Where to host | Must serve the built `dist/` folder at the **root** of an origin you control, for example `https://drawit.example.com/`. Little fetches `/little/manifest.json` from the origin root, so a path like `example.com/apps/draw-it/` will not work. |
| Store category | `kids` or `games` (set after the first publish with `little apps set --category`). |
| First audience | Recommended: a `beta` channel with a few testers before production (below). |

## 1. Test on a real TV first

Everything so far was tested in the simulator only. Voice, hand tracking, audio levels and the remote behave
differently on hardware.

```bash
little device pair <code>      # pair your computer with a Little television once
little dev --device            # run this app on it and play a full game
```

## 2. Build

```bash
npm run build                  # type-checks, then writes dist/
little manifest validate --strict
```

## 3. Create the org and link the project (public: creates an org)

```bash
little org create "Your Org Name" --use
little link --slug draw-it     # writes little.json (org + slug)
```

## 4. Deploy `dist/` to your origin

Upload the contents of `dist/` to the root of your host (Cloudflare Pages, Netlify, Vercel, S3 + CDN, and similar
all work). The app is a static site; it needs no server. Check these two URLs return 200 in a browser:

- `https://<your-origin>/`
- `https://<your-origin>/little/manifest.json`

## 5. Verify the origin (public)

```bash
little domains add https://<your-origin>
```

It prints a line like `little-site-verification=<token>`. Serve exactly that text, as `text/plain`, at
`/.well-known/little-challenge`. The easiest way is to put it in `public/.well-known/little-challenge`, run
`npm run build`, and deploy again. Hosts that ignore dot-folders (GitHub Pages without `.nojekyll`) will not work.

```bash
little domains verify https://<your-origin>    # re-run until it passes
```

## 6. Publish to a beta channel first (public)

A build published only to a non-production channel stays hidden from regular viewers.

```bash
little publish --url https://<your-origin> --channel beta --status draft
little apps set --category kids
little invite create draw-it --channel beta            # prints a link + QR for testers
little invite create draw-it --channel beta --max-uses 20
```

Testers open the link on a phone that has the Little app and tap **Join beta**. They see their name and email
shared with you. Play real games with real families before going wider.

## 7. Launch (public)

```bash
little channels promote draw-it beta        # production now serves the beta build
little apps status draw-it published
```

Roll back with `little channels create draw-it --name production --version <earlier-version>`
(find versions with `little apps versions`).

## Before you launch: things to decide or fix

1. **Camera permission (done).** Hand drawing is off by default and opt-in: players choose "Hand (camera)" on the
   setup screen, or tap Hand on the drawing toolbar. The camera and hand tracking are not touched, and the
   TV's camera permission card does not appear, until then. If the card is declined (or the profile cannot
   answer one, as with a kid's profile), the game says so and goes back to drawing with the remote. The
   manifest `reason` text shown on that card says it is only used for hand drawing and that nothing is recorded
   or sent. Hand tracking itself is still unproven: it never calibrated in the simulator, so test it on a real
   TV. To try it in the simulator without the card, run `little dev environment permissions="camera"` and
   relaunch the app.
2. **The secret word is visible on the shared screen.** The look-away countdown is the only protection. A
   second screen (a phone) for the artist would fix it.
3. **Voice reliability.** The simulator's voice agent failed to connect at startup in several runs. Check on
   real hardware that "hold to talk" works and that guesses are heard.
4. **Audio.** Sounds and music are synthesized and were never heard by a person. Check levels and the
   wrong-guess buzzer on a real TV.
5. **Listing assets.** The CLI docs list no icon or screenshot requirements. Check the developer portal
   (`little open`) for anything it asks for after the first publish.
6. **Privacy.** The game makes no network requests of its own. The camera preview stays on the device. Audio
   preferences are stored in local browser storage. That is a good story for a kids' app. Review it before
   writing any store description.
7. **Bundle size.** The JavaScript is about 956 KB (224 KB compressed), mostly the 128 drawings. Fine for
   now; code-splitting would shrink first load if needed.
