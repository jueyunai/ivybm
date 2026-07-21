# Platform Contract Fixtures

These fixtures preserve the public webhook shapes documented by Meta while using synthetic IDs,
message text, URLs, and timestamps. They contain no customer data, access token, app secret, or live
account identifier.

Reference structures:

- Meta Messenger webhook events: https://developers.facebook.com/docs/messenger-platform/webhooks
- Instagram messaging webhooks: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook

The fixtures are contract inputs only. Passing them does not prove that an account has the required
permissions or that Meta App Review has completed. TikTok fixtures are intentionally absent until an
official private-message event schema is available for the target business account and region.
