import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateSurgeModelRequest,
  estimateSurgeModelReservationMicroUsd,
  generateSurgeModelAnswer,
} from "../src/lib/energy-assistant-model.ts";

const NOW = new Date("2026-08-21T00:00:00.000Z");

function deterministicAnswer(directAnswer = "Use the supplied household facts to explain the decision.") {
  return {
    directAnswer,
    practicalSteps: [],
    nextAction: "",
    status: "answered",
    citations: [],
    assumptions: [],
    confidence: "medium",
    suggestedQuestions: [],
    toolActions: [],
    sourceBoundary: "",
  };
}

function request(overrides = {}) {
  return {
    message: "How should I improve my home?",
    audience: "household",
    pageContext: "/plan",
    asOf: NOW,
    recentTurns: [],
    continuation: null,
    deterministicAnswer: deterministicAnswer(),
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    version: 1,
    activeTopic: "general",
    goal: "Improve the home",
    facts: [],
    pendingQuestion: "",
    lastAnswerSummary: "Explained the first decision.",
    ...overrides,
  };
}

function modelPayload(overrides = {}) {
  return {
    answer: "Start with the part of the home causing the biggest comfort problem.",
    followUpQuestion: null,
    confidence: "medium",
    state: state(),
    usedSourceIds: [],
    ...overrides,
  };
}

function jsonResponse(output, options = {}) {
  const responseBody = options.nested
    ? {
        output: [{
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        }],
      }
    : { output_text: JSON.stringify(output) };
  return new Response(JSON.stringify(responseBody), {
    status: options.status || 200,
    headers: { "content-type": "application/json" },
  });
}

test("model adapter sends a stateless strict Responses request with bounded schema", async () => {
  let observedUrl;
  let observedOptions;
  const result = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async (url, options) => {
      observedUrl = url;
      observedOptions = options;
      return jsonResponse(modelPayload());
    },
  });

  assert.ok(result);
  assert.equal(observedUrl, "https://api.openai.com/v1/responses");
  assert.equal(observedOptions.method, "POST");
  assert.equal(observedOptions.headers.Authorization, "Bearer test-api-key");
  assert.equal(observedOptions.headers["Content-Type"], "application/json");
  assert.ok(observedOptions.signal instanceof AbortSignal);

  const body = JSON.parse(observedOptions.body);
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: "none" });
  assert.equal(body.max_output_tokens, 600);
  assert.equal(body.text.verbosity, "low");
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "surge_energy_answer");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.additionalProperties, false);
  assert.deepEqual(body.text.format.schema.required, [
    "answer",
    "followUpQuestion",
    "confidence",
    "state",
    "usedSourceIds",
  ]);
  assert.equal(body.text.format.schema.properties.state.additionalProperties, false);
  assert.equal(body.text.format.schema.properties.state.properties.facts.maxItems, 16);
  assert.equal(body.text.format.schema.properties.usedSourceIds.maxItems, 6);
  assert.equal(body.input.length, 2);
  assert.equal(body.input[0].role, "developer");
  assert.equal(body.input[1].role, "user");
});

test("only the reviewed Terra model is allowed", async () => {
  const previousModel = process.env.SURGE_MODEL;
  let calls = 0;
  process.env.SURGE_MODEL = "gpt-5.6-luna";
  try {
    const rejected = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(rejected, null);
    assert.equal(calls, 0);

    const supported = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.ok(supported);
    assert.equal(calls, 1);
  } finally {
    if (previousModel === undefined) delete process.env.SURGE_MODEL;
    else process.env.SURGE_MODEL = previousModel;
  }
});

test("cost estimator exactly matches the serialized provider body and reviewed worst-case rate", async () => {
  const modelRequest = request();
  const estimate = estimateSurgeModelRequest(modelRequest);
  let serializedBody = "";
  const result = await generateSurgeModelAnswer(modelRequest, {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async (_url, options) => {
      serializedBody = options.body;
      return jsonResponse(modelPayload());
    },
  });

  assert.ok(result);
  assert.ok(estimate);
  const exactBytes = new TextEncoder().encode(serializedBody).byteLength;
  assert.equal(estimate.model, "gpt-5.6-terra");
  assert.equal(estimate.serializedBodyBytes, exactBytes);
  assert.equal(estimate.maxOutputTokens, 600);
  assert.equal(
    estimate.worstCaseMicroUsd,
    Math.ceil(((exactBytes * 2) + (600 * 12)) * 1.25),
  );
  assert.equal(
    estimateSurgeModelReservationMicroUsd(modelRequest),
    estimate.worstCaseMicroUsd,
  );
});

test("oversized serialized model input is rejected before provider fetch", async () => {
  const oversizedRequest = request({ message: "large input ".repeat(3_000) });
  assert.equal(estimateSurgeModelRequest(oversizedRequest), null);
  let calls = 0;
  const result = await generateSurgeModelAnswer(oversizedRequest, {
    apiKey: "test-api-key",
    model: "gpt-5.6-terra",
    fetch: async () => {
      calls += 1;
      return jsonResponse(modelPayload());
    },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("successful output is parsed, bounded and stripped of public internal names, URLs and source lines", async () => {
  const longExplanation = "A".repeat(2_100);
  const result = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: `TLink guidance is at https://internal.example.test/path.\nSources: private reference\nCreditex context. ${longExplanation}`,
      followUpQuestion: "What is your postcode? What size is the home?",
      confidence: "high",
      state: state({ pendingQuestion: "This must be replaced." }),
    })),
  });

  assert.ok(result);
  assert.equal(result.answer.status, "needs_context");
  assert.equal(result.answer.confidence, "high");
  assert.equal(result.answer.suggestedQuestions.length, 1);
  assert.equal(result.answer.suggestedQuestions[0], "What is your postcode?");
  assert.equal(result.continuation.pendingQuestion, "What is your postcode?");
  assert.ok(result.answer.directAnswer.length <= 2_000);
  assert.doesNotMatch(result.answer.directAnswer, /TLink|Creditex|https?:\/\/|Sources?:/i);
  assert.match(result.answer.directAnswer, /trade platform/i);
  assert.deepEqual(result.answer.citations, []);
  assert.deepEqual(result.answer.toolActions, []);
});

test("nested Responses output accepts quantities only when they are grounded in supplied context", async () => {
  const grounded = await generateSurgeModelAnswer(request({
    message: "I am considering a 6.6 kW solar system.",
    deterministicAnswer: deterministicAnswer("A 6.6 kW proposal still needs site-specific checks."),
  }), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: "A 6.6 kW proposal can be discussed using the supplied system size.",
    }), { nested: true }),
  });
  assert.ok(grounded);
  assert.match(grounded.answer.directAnswer, /6\.6 kW/i);

  const invented = await generateSurgeModelAnswer(request(), {
    apiKey: "test-api-key",
    fetch: async () => jsonResponse(modelPayload({
      answer: "This upgrade will save $999 each year.",
    })),
  });
  assert.equal(invented, null);
});

test("provider errors and timeout make one attempt and fail soft with null", async (t) => {
  for (const status of [500, 429]) {
    await t.test(`provider status ${status}`, async () => {
      let calls = 0;
      const result = await generateSurgeModelAnswer(request(), {
        apiKey: "test-api-key",
        model: "gpt-5.6-terra",
        fetch: async () => {
          calls += 1;
          return new Response("unavailable", { status });
        },
      });
      assert.equal(result, null);
      assert.equal(calls, 1);
    });
  }

  await t.test("provider timeout", async () => {
    let calls = 0;
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      timeoutMs: 1,
      fetch: async (_url, options) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(new DOMException("Timed out", "AbortError"));
          }, { once: true });
        });
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 1);
  });
});

test("malformed model output fails soft with null", async (t) => {
  await t.test("invalid JSON output", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => new Response(JSON.stringify({ output_text: "{not-json" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });
    assert.equal(result, null);
  });

  await t.test("invalid conversation state", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => jsonResponse(modelPayload({
        state: state({ facts: Array.from({ length: 17 }, (_, index) => ({
          key: `fact_${index}`,
          value: "value",
        })) }),
      })),
    });
    assert.equal(result, null);
  });

  await t.test("unknown evidence id", async () => {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => jsonResponse(modelPayload({
        usedSourceIds: ["invented-source-id"],
      })),
    });
    assert.equal(result, null);
  });
});

test("disabled model path returns null without calling the provider", async () => {
  const previous = process.env.SURGE_AI_ENABLED;
  process.env.SURGE_AI_ENABLED = "false";
  let calls = 0;
  try {
    const result = await generateSurgeModelAnswer(request(), {
      apiKey: "test-api-key",
      model: "gpt-5.6-terra",
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.SURGE_AI_ENABLED;
    else process.env.SURGE_AI_ENABLED = previous;
  }
});

test("API secret is never included in the serialized request body, estimate or result", async () => {
  const secret = "sk-test-private-value-never-output";
  let serializedBody = "";
  const modelRequest = request();
  const estimate = estimateSurgeModelRequest(modelRequest);
  const result = await generateSurgeModelAnswer(modelRequest, {
    apiKey: secret,
    model: "gpt-5.6-terra",
    fetch: async (_url, options) => {
      serializedBody = options.body;
      return jsonResponse(modelPayload());
    },
  });
  assert.ok(result);
  assert.ok(estimate);
  assert.doesNotMatch(serializedBody, new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(estimate), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("missing API key returns null without calling the provider", async () => {
  let calls = 0;
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await generateSurgeModelAnswer(request(), {
      fetch: async () => {
        calls += 1;
        return jsonResponse(modelPayload());
      },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
