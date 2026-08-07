# Platform Contract Fixtures

These fixtures preserve the public webhook shapes documented by Meta while using synthetic IDs,
message text, URLs, and timestamps. They contain no customer data, access token, app secret, or live
account identifier.

Reference structures:

- Meta Messenger webhook events: https://developers.facebook.com/docs/messenger-platform/webhooks
- Instagram messaging webhooks: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
- Instagram Login authorization and token exchange:
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- Instagram long-lived token exchange:
  https://developers.facebook.com/documentation/instagram-platform/reference/access_token
- Instagram token-bound identity lookup:
  https://developers.facebook.com/documentation/instagram-platform/reference/me

The fixtures are contract inputs only. Passing them does not prove that an account has the required
permissions or that Meta App Review has completed. TikTok fixtures are intentionally absent until an
official private-message event schema is available for the target business account and region.

`instagram-oauth-success.json` records the supported provider request sequence and representative
response fields with synthetic values. Instagram Login returns the granted permission string during
the initial code exchange and does not document a `/me/permissions` readback endpoint; the fixture
therefore validates that grant before exchanging the long-lived token, then verifies token identity
through `/me`.
