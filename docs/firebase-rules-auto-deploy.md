# Firestore Rules automatic deployment

Reference: `REF-NCC-FIREBASE-AUTO-DEPLOY-50`

The production Firestore rules are maintained in `firestore.rules` and deployed
to the Firebase project `ncc-member` by GitHub Actions.

## Required repository secret

- Name: `FIREBASE_SERVICE_ACCOUNT_NCC_MEMBER`
- Value: the complete JSON key for the dedicated deployment service account

The service account should have only these project roles:

- Firebase Rules Admin (`roles/firebaserules.admin`)
- Service Usage Consumer (`roles/serviceusage.serviceUsageConsumer`)

Never commit the JSON key to the repository or paste it into a chat message.

## Deployment trigger

The workflow runs when `firestore.rules`, `firebase.json`, or `.firebaserc`
changes on `main`. It can also be started manually from GitHub Actions.

Console edits and CLI deployments overwrite each other. After automation is
enabled, `firestore.rules` is the production source of truth.
