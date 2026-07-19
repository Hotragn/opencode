import { afterAll, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { Provider } from "@/provider/provider"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin/index"
import { ProviderV2 } from "@opencode-ai/core/provider"

// A real local OpenAI-compatible endpoint, like Ollama or LM Studio, that reports the models it
// currently has available at GET /v1/models. No fetch mocking: discovery hits this over HTTP.
const server = Bun.serve({
  port: 0,
  fetch(req) {
    if (new URL(req.url).pathname === "/v1/models") {
      return Response.json({
        object: "list",
        data: [{ id: "llama3.2:latest", object: "model" }, { id: "qwen2.5-coder:7b", object: "model" }],
      })
    }
    return new Response("not found", { status: 404 })
  },
})
const baseURL = `http://localhost:${server.port}/v1`
afterAll(() => server.stop(true))

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))
const list = Provider.use.list()

it.instance(
  "discovers models from an OpenAI-compatible endpoint when none are configured",
  Effect.gen(function* () {
    const provider = (yield* list)[ProviderV2.ID.make("local")]
    expect(provider).toBeDefined()
    const models = Object.keys(provider.models)
    expect(models).toContain("llama3.2:latest")
    expect(models).toContain("qwen2.5-coder:7b")
    // discovered models route through the openai-compatible SDK at the provider baseURL
    expect(provider.models["llama3.2:latest"].api.npm).toBe("@ai-sdk/openai-compatible")
    expect(provider.models["llama3.2:latest"].api.url).toBe(baseURL)
  }),
  {
    config: {
      provider: {
        local: { name: "Local", npm: "@ai-sdk/openai-compatible", env: [], options: { baseURL } },
      },
    },
  },
)

it.instance(
  "keeps configured metadata and only adds newly discovered ids",
  Effect.gen(function* () {
    const provider = (yield* list)[ProviderV2.ID.make("local")]
    // the pinned model keeps its explicit config name; discovery must not overwrite it
    expect(provider.models["llama3.2:latest"].name).toBe("Llama 3.2 (pinned)")
    // the id only the endpoint knows about is still discovered and added
    expect(Object.keys(provider.models)).toContain("qwen2.5-coder:7b")
  }),
  {
    config: {
      provider: {
        local: {
          name: "Local",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "llama3.2:latest": { name: "Llama 3.2 (pinned)" } },
          options: { baseURL },
        },
      },
    },
  },
)

it.instance(
  "does not attempt discovery for providers without a baseURL",
  Effect.gen(function* () {
    const provider = (yield* list)[ProviderV2.ID.make("static")]
    expect(provider).toBeDefined()
    expect(Object.keys(provider.models)).toEqual(["only-model"])
  }),
  {
    config: {
      provider: {
        static: {
          name: "Static",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: { "only-model": { name: "Only Model", tool_call: true, limit: { context: 8000, output: 2000 } } },
          options: { apiKey: "test" },
        },
      },
    },
  },
)
