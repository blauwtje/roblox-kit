# ProcessReceipt facts (step 8)

State these to the user and build for them:

- Set it once, in one server script.
- It also receives Store tab purchases made outside the experience.
- It has no time-based retry: after `NotProcessedYet` it runs again only when the user starts another purchase or rejoins any server.
- It has no timeout.
- Unresolved purchases are not removed or refunded.
- A missing callback auto-acknowledges receipts, so a game that sells products must set one.
- It may run on two servers at once.
- A returned `PurchaseGranted` may fail to record and run again, so the `PurchaseId` cache must make a rerun grant nothing twice.
