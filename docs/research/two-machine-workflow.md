# Two-machine workflow for the Space Apps repo (proposal)

Repo: https://github.com/srisura1010/LLSN-NASA-Space-Apps-2026 (Team Zenacor, "Moon Planner (TBD)")
Ryan's two computers: **Mac** clone at `~/Downloads/space-apps/LLSN-NASA-Space-Apps-2026`,
**HP (Windows)** clone at `F:\space-apps`.

Everything below is a **proposal for the team**. Nothing has been set up, and
no branches, commits or files have been added to the repo. The branch names and
lanes are suggestions to bring to Alvin, Benjamin and Srivatsav, not decisions.

---

## 1. What's in the repo right now (read from `git log`, as of commit `61ce6fd`)

- **One branch:** `main`. 8 commits, all on Fri Nov 13.
- **Who:** Srivatsav Sura made 7 of the 8 commits (repo setup, Next.js scaffold,
  hydration fix, 3D packages). One README edit is by the GitHub user
  `TomatoBiske`. I can't tell which teammate that is, so worth asking.
- **The app:** `moon-planner/` is a fresh Next.js starter.
  - Next.js **16.4.6**, React **19.3.0**, TypeScript, Tailwind **4.3.3**, ESLint.
  - 3D packages just added: `three` 0.187, `@react-three/fiber` 9.8, `@react-three/drei` 10.7.
  - `src/app/` holds only the starter `layout.tsx`, `page.tsx` and `globals.css`. `public/` holds the default starter SVGs.
  - `moon-planner/AGENTS.md` is auto-written by `next dev`. It warns that this
    Next.js version differs from older docs, so check `node_modules/next/dist/docs/` before using an API.
- **Top-level README:** team names, event (Phoenix, AZ), submitting Nov 15.
- **Not there yet:** no data, no components, no API routes, no Python, no CI.

**Read:** Srivatsav owns the scaffold and the 3D setup. Plan around it, don't replace it.

---

## 2. The idea
With 4 people and up to 5 machines on one repo, the goal is that nobody's push
breaks anybody else. Each person works on a short-lived branch in their own
area, and ships small pieces to `main` often. `main` stays working at all times.

## 3. Branch names
**Ryan's own rule (already decided):** Ryan works on `ryan/<feature>` branches and
never pushes to `main`. Claude never pushes, merges, opens a PR or deploys
without asking Ryan and getting a "yes".

For everyone else (team to agree): by person (`sri/3d-scene`, `alvin/...`,
`ben/...`) would match Ryan's. The alternative is by type (`feat/...`, `data/...`).

For Ryan's two computers, the branch is the same whichever machine you're on.
Push before switching computers, pull after. Don't work on the same branch on
both machines at once. If you want both computers busy at the same time, give
each one its own task branch (for example `ryan/data-horizons` on the Mac and
`ryan/site-list` on the HP).

## 4. Proposed lanes (match these to who does what, team decides)
| Lane | Mostly touches | Notes |
|------|----------------|-------|
| 3D view | `moon-planner/src/components/scene/…` | builds on Srivatsav's three.js setup |
| Layout / controls / compare panel | `moon-planner/src/app/`, `src/components/ui/…` | sidebar sliders, time scrubber |
| Data: Sun/Earth angles | `moon-planner/src/lib/…` or a separate `data/` folder | Horizons or SPICE output |
| Data: sites, terrain, slope | `moon-planner/public/data/…` | site list with cited coordinates, LOLA |
| Submission | `README.md`, slides, video | needed by Sun 11:59pm |

**Danger files** that several lanes will touch: `package.json`,
`package-lock.json`, `src/app/page.tsx`, `src/app/layout.tsx`, `globals.css`.
Proposal: whoever adds a dependency ships *just that change* to `main` right
away and posts in the group chat so everyone pulls. Agree early on how
`page.tsx` gets split into components, so people stop editing the same file.

## 5. Task board
Use GitHub Issues (or a pinned checklist in the group chat): one line per task,
plus who claimed it and their branch. Claim before you start.

## 6. The loop on each machine
1. **Start:** `git switch main`, `git pull --rebase origin main`, `git switch -c ryan/<task>`
2. **Every 30 to 60 minutes:** commit, `git fetch origin`, `git rebase origin/main`,
   `git push --force-with-lease -u origin ryan/<task>` (backs up your work and keeps you close to main).
3. **Ship:** in `moon-planner/` run `npm run lint` and `npm run build`. Then open a PR,
   or merge into `main` if the team prefers to skip PRs (team decides). Delete the branch.
4. **Switching computers:** push on the one you're leaving, then `git pull` on the one you're joining.
5. **Rejected push:** someone shipped first. `git pull --rebase origin main`, fix conflicts, rebuild, push again.

## 7. Mac + HP specifics
- **Line endings:** Windows can turn every line into a changed line. On the HP, run
  `git config core.autocrlf true` once. Better for the team: add a `.gitattributes` with
  `* text=auto` (that's a repo change, so it's a team decision).
- **Node version:** use the same major Node on both machines (Next 16 needs a recent
  LTS). Check with `node -v`.
- **`npm install` vs `npm ci`:** after pulling, use `npm ci` so `package-lock.json` doesn't
  get rewritten and then show up as a conflict.
- **Untracked secrets:** if anyone adds API keys, they go in `moon-planner/.env.local`
  (gitignored by Next). Copy that between machines yourself. It never goes in git.
- **`AGENTS.md`:** `next dev` rewrites it. If it shows up as changed, just commit it
  as it is (that's what the file itself recommends).

## 8. A third "machine": Claude in the cloud
Besides the Mac and the HP, you can hand self-contained tasks to cloud Claude
sessions and keep working locally:
- Send: `claude --cloud "<task>"` from the cloned repo. Check on it: `/tasks`.
- Bring it back: `claude --teleport` (or `/teleport`). This only goes one way, web to terminal.
- **Blocker:** cloud sessions can't see Sri's repo yet. Fix one of two ways:
  (a) `gh auth login` as GloryComrade, then `/web-setup` in Claude Code to sync the token; or
  (b) ask Sri to install the Claude GitHub App on the repo (github.com/apps/claude → Configure → add repo).
  Also approve the pending Claude app permission update at github.com/settings/installations.
- Good cloud tasks: research (site coordinates, LOLA products), and isolated pieces
  on their own `ryan/<feature>` branch. Same rules apply: nothing gets pushed without Ryan's yes.

## 9. Schedule (Arizona time)
| When | What |
|------|------|
| Sat Nov 14, 9:00am | Judge intros + livestream; submission opens; coding may start |
| Sat 3pm and 6pm | Mentor Zoom sessions |
| Sun Nov 15, 3pm and 6pm | Judges available for questions |
| **Sun Nov 15, 11:59pm** | **Submission deadline** |
| By Nov 22 | Winners emailed |

Submission guide: https://www.spaceappschallenge.org/resources/project-submission-guide/

## 10. Loose ends for Ryan
- **Ansh's signup:** create a Space Apps account, register, pick the Phoenix AZ
  event, request to join team Zenacor, then send his GitHub username to Sri for a repo invite.
- **Deploys:** confirm with the team where the site is hosted (e.g. Vercel) and who owns deploys.

## 11. Questions to bring to the team
1. Branch naming for the others: by person (like Ryan's `ryan/...`), or by type?
2. Pull requests with a quick review, or push straight to `main`? (With 4 people
   in 39 hours, short PRs with one approval are usually worth it.)
3. Who owns which lane? Does Srivatsav want to keep the 3D view?
4. How should `page.tsx` be split into components, and who sets that up first?
5. Agree on a Node version, and is a `.gitattributes` for line endings OK?
6. Who is GitHub user `TomatoBiske`?
7. GitHub Issues as the task board, or a checklist in the group chat?
8. Where is the site hosted, and who owns deploys?
9. Sri: OK to install the Claude GitHub App on the repo so cloud sessions can help?
10. Is Ansh joining, and which lane would he take?
