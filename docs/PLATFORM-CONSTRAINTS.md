# Platform constraints verified during implementation

Verified on 2026-09-01 against official vendor documentation.

## Instagram messaging

Meta's official Instagram Send API requires the recipient to have sent a message to the professional account before an API response can be sent. New conversations begin from the Instagram user, and group messaging is not supported. The implementation therefore uses the operator's dedicated Chrome session for the first contact and transfers ownership to the official API only after a signed inbound webhook.

Official references:

- [Meta Instagram Send API collection](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api)
- [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

## OpenAI Responses API

The Responses API exposes input and output token usage, and the selected GPT-5.4 models support structured outputs. Production defaults use fixed snapshots so behavior does not drift silently.

Official references:

- [GPT-5.4 model](https://developers.openai.com/api/docs/models/gpt-5.4)
- [GPT-5.4 Mini model](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [Responses API reference](https://developers.openai.com/api/reference/resources/responses)
