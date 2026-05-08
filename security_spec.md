# Security Specification for MyFriend

## Data Invariants
1. A user can only write to their own profile in `users/{userId}`.
2. A user can only read/write their own `friends` subcollection.
3. Chat messages in `chats/{chatId}/messages` can only be read/written by users whose UIDs form the `chatId`.
4. `chatId` must be a stable combination of two UIDs (e.g., `uid1_uid2` where `uid1 < uid2`).

## The Dirty Dozen Payloads (Targeting Logic Leaks)

1. **Identity Spoofing**: User A trying to create a profile for User B.
2. **Shadow Field Injection**: Adding `isAdmin: true` to a profile.
3. **Orphaned Message**: Writing to a chat the user is not part of.
4. **ID Poisoning**: Using a 1MB string as a `chatId`.
5. **PII Leak**: Authenticated User A trying to read User B's profile.
6. **State Shortcutting**: Modifying `createdAt` during an update.
7. **Resource Poisoning**: Sending a 2MB string as a message.
8. **Malicious ID Hijack**: User A trying to delete User B's friend list.
9. **Spam Attack**: Sending messages with non-server timestamps.
10. **Query Scraping**: Listing all users without a stable `code` lookup.
11. **Shadow Update**: Changing the `code` of a user profile after it's set.
12. **Terminal State Break**: Attempting to edit a sent message's `fromUid`.

## Test Runner (Conceptual)
`firestore.rules.test.ts` would verify that these payloads return `PERMISSION_DENIED`.
