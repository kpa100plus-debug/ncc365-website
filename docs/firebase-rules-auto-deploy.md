# Firestore Rules automatic deployment

Reference: `REF-NCC-FIREBASE-AUTO-DEPLOY-50`

The production Firestore rules are maintained in `firestore.rules` and deployed
to the Firebase project `ncc-member` by GitHub Actions.

## Authentication

The workflow uses Google Cloud Workload Identity Federation. It does not use
or store a long-lived service-account JSON key.

- Workload Identity Pool: `ncc-github-actions`
- Provider: `github`
- Repository restriction: `kpa100plus-debug/ncc365-website`
- Branch restriction: `refs/heads/main`
- Service account: `ncc-firestore-rules-deployer@ncc-member.iam.gserviceaccount.com`

The service account should have only these project roles:

- Firebase Rules Admin (`roles/firebaserules.admin`)
- Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`)

Do not create or commit a JSON key for this deployment workflow.

## Deployment trigger

The workflow runs when `firestore.rules`, `firebase.json`, or `.firebaserc`
changes on `main`. It can also be started manually from GitHub Actions.

Console edits and CLI deployments overwrite each other. After automation is
enabled, `firestore.rules` is the production source of truth.
