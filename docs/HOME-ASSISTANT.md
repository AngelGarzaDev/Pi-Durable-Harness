# Home Assistant voice (Assist) with Pi Durable

Home Assistant can send voice requests to a Pi Durable folder through an OpenAI-compatible API.
Each folder (workspace) is one model. The Extended OpenAI Conversation integration in Home
Assistant (HACS) is the client.

## Endpoint

| Environment | Base URL | Notes |
|---|---|---|
| Production | `http://192.168.1.30:8790/v1` | LAN only, plain HTTP |
| Development | `http://127.0.0.1:8787/v1` | This host only |

Plain HTTP on the LAN means the key and the conversation cross the network unencrypted. Use it only on the home network.

## Authentication

- Send `Authorization: Bearer <key>`. Cookies are not accepted on this API.
- Keys are created in the web app: global settings, Home Assistant voice keys. A key is shown once, so copy it then.
- Keys are stored hashed (`api-keys.json`). Revoking a key takes effect on the next request (401).

## Models and folders

- `GET /v1/models` lists one model per folder, named `pi/<folder>`, for example `pi/lifemanager`.
- `POST /v1/chat/completions` uses the folder in `model`. Only the last user message is answered.
- Each folder has one voice chat, titled "Voice". Its history is kept there.
- The folder's model, context limit, max tool rounds and MCP settings apply.

## Voice tools (per folder, off by default)

By default a voice chat is chat-only: the agent gets no runner tools (read, write, edit, bash).
Turn on "Voice requests may use this folder's tools" in the folder settings to allow them.
Turning it on means a spoken request can change files or run commands in that folder.

## Responses

| Status | When | Body |
|---|---|---|
| 200 | Answer produced | Chat completion JSON, non-streaming |
| 400 | Body is not JSON or not an object; `stream: true`; no user message | `error.message` says which |
| 401 | Missing or unknown key | |
| 404 | Unknown model or folder (`No workspace named X.`) | `error.code` `model_not_found` |
| 409 | The folder's voice chat is busy with another run | Try again later |

Streaming is not supported yet. Send `stream: false`.

## Home Assistant setup

1. Settings, Devices and services, Extended OpenAI Conversation: add entry "Pi Durable".
2. API key: the voice key from the web app. Base URL: the endpoint above. Model: `pi/<folder>`.
3. Pick the Pi Durable agent in an Assist pipeline. Preferred pipelines are not changed automatically.

## Tests

`tests/openai-http.test.ts` covers model list, folder routing, 400/404/409, and bearer-only auth.
`tests/voice-keys-ws.test.ts` covers create, list without hashes, blank label, revoke.
