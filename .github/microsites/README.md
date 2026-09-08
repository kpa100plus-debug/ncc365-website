# Existing revenue microsites

Production sites: https://daily-fortune-now.pages.dev/ and https://arcana-day.pages.dev/.

The archive at `.github/assets/adsense-microsites-text.zip` contains compiled deployment files, not the missing React authoring source. `improve-fortune.py` documents a guarded transformation of the original archive from commit `849b45158e7448135b27054e3b00ef6f4f6efdae`; do not run it on an already patched archive.

## Safe maintenance

Keep reviewed changes on main so future microsite deployments retain the latest fixes. The deployment workflow accepts production execution only from main. Change only the microsite archive, this folder, and the microsite workflow. Preserve all NCC application, Firebase, member, and deployment configuration files.

NCC Pages watches every repository path. For a microsite-only commit or squash merge, prefix the final commit title with `[CF-Pages-Skip]` to skip the unrelated automatic NCC Pages deployment. This is Cloudflare's documented commit-level control; it does not disable the GitHub Actions microsite deployment or security checks. Never apply the prefix to a commit containing NCC changes that require deployment.

Before and after integration, read the NCC Pages canonical deployment ID and compare it. Inspect the microsite Actions deployment and public URLs separately. Do not treat installed AdSense code as approval, served ads, or revenue.
