# REF-NCC-CODEX-MASTER-03 — NCC Platform Architecture

## Public routes

| Route | Purpose |
|---|---|
| `index.html` | HOME / platform overview |
| `benefits.html` | Benefit Center: FIRST, PREMIUM, DAILY |
| `experience.html` | Free-experience campaigns |
| `groupbuy.html` | Group-buy campaigns |
| `centers.html` | Nationwide consumer-center network |
| `partner-center.html` | Partner registration and campaign creation |
| `consumer-channel.html` | Consumer ON / TV |
| `wallet.html` | NCC Wallet, member QR, activity |
| `join.html` | Consumer membership |

Existing public URLs remain as compatibility entry points until migration is complete.

## Administration routes

| Route | Purpose |
|---|---|
| `admin.html` | Unified administration dashboard |
| `admin-members.html` | Member CRM |
| `admin-applications.html` | Benefit/experience applications |
| `admin-partners.html` | Partner review and management |
| `admin-benefits.html` | Benefit and experience campaigns |
| `admin-groupbuys.html` | Group-buy operations |
| `admin-centers.html` | Center hierarchy and staff |
| `admin-reviews.html` | Reviews and completion checks |

## Firestore collections

### members
`memberNumber, name, gender, birthDate, phone, phoneKey, email, address, region, interests, referrer, referralCode, centerId, centerCode, memberStatus, joinedAt, updatedAt`

### wallets
`memberId, memberNumber, qrTokenHash, qrStatus, firstBenefitCount, premiumBenefitCount, dailyBenefitCount, updatedAt`

### partners
`partnerNumber, businessType, businessName, representativeName, phone, email, address, region, category, description, selectedBenefitClasses, status, centerId, createdAt, updatedAt`

### benefits
`benefitNumber, title, benefitClass, benefitType, partnerId, partnerName, region, startAt, endAt, capacity, qrRequired, status, summary, terms, imageUrl, createdAt, updatedAt`

### experiences
`experienceNumber, title, productName, serviceName, partnerId, quantity, recruitmentStartAt, recruitmentEndAt, region, selectionCount, reviewRequirement, benefitClass, fulfillmentType, status, createdAt, updatedAt`

### benefitApplications
`receipt, memberId, memberNumber, type, name, phone, region, message, offerId, offerTitle, status, source, createdAt, updatedAt`

### groupBuys
`groupBuyNumber, title, partnerId, productName, regularPrice, memberPrice, minimumQuantity, maximumQuantity, orderStartAt, orderEndAt, deliveryType, deliveryFee, status, createdAt, updatedAt`

### groupBuyOrders
`orderNumber, groupBuyId, memberId, quantity, amount, paymentStatus, fulfillmentStatus, deliveryAddress, createdAt, updatedAt`

### benefitUses
`useNumber, memberId, benefitId, partnerId, qrToken, verifiedBy, usedAt, status`

### reviews
`reviewNumber, memberId, experienceId, groupBuyId, rating, content, imageUrls, reviewStatus, createdAt, updatedAt`

### centers
`centerCode, centerName, centerLevel, parentCenterCode, regionCode, leaderMemberId, leaderName, phone, status, createdAt, updatedAt`

### centerStaff
`staffNumber, centerCode, memberId, role, status, joinedAt, updatedAt`

### activityLogs
`memberId, activityType, targetCollection, targetId, centerCode, partnerId, metadata, createdAt`

## Fixed enums

- `benefitClass`: `FIRST | PREMIUM | DAILY`
- `benefitType`: `EXPERIENCE | SERVICE | EVENT | GROUP_BUY | LOCAL`
- `record status`: `draft | pending | active | paused | completed | rejected | archived`
- `application status`: `new | checking | contacted | approved | hold`
- `centerLevel`: `HEADQUARTERS | PROVINCE | CITY_COUNTY | TOWN`

## Data flow

Every operational form follows:

`HTML name attribute → Firestore field → CSV column → CRM field`

No production form may introduce a field without adding it to this mapping first.

## Migration policy

1. Preserve `members`, `memberPhones`, `counters/memberNumbers`, and current member numbers.
2. Preserve the existing administrator Firebase Authentication account.
3. Add new collections without changing existing membership transactions.
4. Keep old public URLs working through the migration.
5. Remove duplicate `pages/` routes only after all inbound links point to the new routes.
