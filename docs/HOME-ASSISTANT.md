# Home Assistant voice (Assist) with pi-durable-web

Home Assistant can send voice requests to pi-durable-web through an OpenAI-compatible API. Each folder (workspace)
appears as one model. The Extended OpenAI Conversation integration (installed from HACS) is the client.

## Endpoints

| Environment | Base URL | Notes |
|---|---|---|
| Production | `http://<host-ip>:8790/v1` | Local network only, plain HTTP |
| Development | `http://127.0.0.1:8787/v1` | This host only |

Plain HTTP means the API key and the conversation cross the network unencrypted. Use the endpoint only on your home
network.

## Authentication

- Send `Authorization: Bearer <key>`. Cookies are not accepted on this API.
- Create keys in the web app, under global settings, in the Home Assistant voice keys section. A key is shown once,
  so copy it then.
- Keys are stored as hashes in `api-keys.json`. Revoking a key takes effect on the next request, which then returns 401.

## Models and folders

- `GET /v1/models` lists one model per folder, named `pi/<folder>`, for example `pi/lifemanager`.
- `POST /v1/chat/completions` uses the folder named in `model`. Only the last user message is answered.
- Each folder has one voice chat, titled "Voice", and its history is kept there.
- The folder's model, context limit, maximum tool rounds and MCP settings apply to voice requests.

## Voice tools

By default a voice chat is chat only: the agent gets no runner tools (`read`, `write`, `edit`, `bash`).

To allow tools, turn on **Voice requests may use this folder's tools** in the folder settings. With this on, a spoken
request can change files or run commands in that folder. Turn it on only for folders you are comfortable with.

## Responses

| Status | When | Body |
|---|---|---|
| 200 | Answer produced | Chat completion JSON, non-streaming |
| 400 | Body is not JSON or not an object; `stream: true`; no user message | `error.message` says which problem it is |
| 401 | Missing or unknown key | |
| 404 | Unknown model or folder (`No workspace named X.`) | `error.code` is `model_not_found` |
| 409 | The folder's voice chat is busy with another run | Try again later |

Streaming is not supported. Send `stream: false`.

## Setup in Home Assistant

1. Go to **Settings, Devices and services, Extended OpenAI Conversation** and add an entry named "Pi Durable".
2. Set **API key** to a voice key from the web app, **Base URL** to the endpoint above, and **Model** to `pi/<folder>`.
3. Select the Pi Durable agent in an Assist pipeline. Existing preferred pipelines are not changed automatically.

## Tests

- `tests/openai-http.test.ts` covers the model list, folder routing, the 400, 404 and 409 responses, and bearer-only
  authentication.
- `tests/voice-keys-ws.test.ts` covers creating a key, listing keys without their hashes, rejecting a blank label, and
  revoking a key.
